#!/bin/bash
# Release build script for the archvisual project.
#
# Builds in isolation and validates a platform-tagged release archive before
# atomically publishing it and updating version.txt. Existing releases survive
# build/packaging failures.
#
# Usage: bash rel_visual.sh {maj|mid|min}

set -euo pipefail

# Resolve roots from the script location so it runs from anywhere.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

VERSION_FILE="$PROJECT_ROOT/version.txt"
RELEASE_README="$PROJECT_ROOT/scripts/README.release.md"
MODULE_OUTPUT="$(python3 -B -c 'from scripts.paths import output_root; print(output_root())')"
RELEASE_DIR="$(python3 -B -c 'from scripts.paths import release_root; print(release_root())')"
STAGING_ROOT="$MODULE_OUTPUT/.release-staging"
case "$RELEASE_DIR" in
    "$MODULE_OUTPUT/output"|"$MODULE_OUTPUT/output/"*|\
    "$MODULE_OUTPUT/build"|"$MODULE_OUTPUT/build/"*|\
    "$MODULE_OUTPUT/staticfiles"|"$MODULE_OUTPUT/staticfiles/"*|\
    "$STAGING_ROOT"|"$STAGING_ROOT/"*)
        echo "ERROR: releases must be outside cleaned build/staging directories: $RELEASE_DIR" >&2
        exit 1 ;;
esac

# ---------------------------------------------------------------------------
# 1. Validate argument
# ---------------------------------------------------------------------------
ARG="${1:-}"
case "$ARG" in
    maj|mid|min) : ;;
    *)
        echo "Usage: bash rel_visual.sh {maj|mid|min}" >&2
        echo "  maj  - bump major   (MAJ+1.0.0)" >&2
        echo "  mid  - bump minor   (MAJ.MIN+1.0)" >&2
        echo "  min  - bump patch   (MAJ.MIN.MIN+1)" >&2
        exit 1
        ;;
esac

if [[ ! -f "$RELEASE_README" || ! -s "$RELEASE_README" ]]; then
    echo "ERROR: release README is missing or empty: $RELEASE_README" >&2
    exit 1
fi

# Serializes version reads and publication even when output overrides differ.
mkdir -p "$MODULE_OUTPUT" "$RELEASE_DIR" "$STAGING_ROOT"
exec {release_lock_fd}>"$PROJECT_ROOT/.archvisual-release.lock"
if ! flock -n "$release_lock_fd"; then
    echo "ERROR: another ArchVisual release is running" >&2
    exit 75
fi

# ---------------------------------------------------------------------------
# 2. Read + parse version.txt
# ---------------------------------------------------------------------------
if [[ ! -f "$VERSION_FILE" ]]; then
    echo "ERROR: version.txt not found at $VERSION_FILE" >&2
    exit 1
fi

RAW="$(tr -d '[:space:]' < "$VERSION_FILE")"
if [[ ! "$RAW" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    echo "ERROR: version.txt must be MAJ.MID.MIN (got '$RAW')" >&2
    exit 1
fi

MAJ="${BASH_REMATCH[1]}"
MID="${BASH_REMATCH[2]}"
MIN="${BASH_REMATCH[3]}"

# ---------------------------------------------------------------------------
# 3. Bump per argument
# ---------------------------------------------------------------------------
case "$ARG" in
    maj) MAJ=$((10#$MAJ + 1)); MID=0; MIN=0 ;;
    mid) MID=$((10#$MID + 1)); MIN=0 ;;
    min) MIN=$((10#$MIN + 1)) ;;
esac

NEW_VERSION="${MAJ}.${MID}.${MIN}"
echo "Candidate version: ${RAW} -> ${NEW_VERSION}"

# ---------------------------------------------------------------------------
# 4. Prepare an isolated build and a candidate version; keep version.txt intact.
# ---------------------------------------------------------------------------
STAGE_DIR="$(mktemp -d "$STAGING_ROOT/release.XXXXXX")"
ARCHIVE_TEMP=""
cleanup() {
    local release_status=$?
    trap - EXIT
    if [[ -n "$ARCHIVE_TEMP" ]] && ! rm -f -- "$ARCHIVE_TEMP"; then
        echo "WARNING: could not remove temporary archive: $ARCHIVE_TEMP" >&2
    fi
    if [[ -f "$STAGE_DIR/KEEP_FOR_RECOVERY" ]]; then
        echo "ERROR: recovery artifacts retained at $STAGE_DIR" >&2
    elif ! rm -rf -- "$STAGE_DIR"; then
        echo "WARNING: could not remove build staging directory: $STAGE_DIR" >&2
    fi
    exit "$release_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp -p "$VERSION_FILE" "$STAGE_DIR/version.original"
cp -p "$VERSION_FILE" "$STAGE_DIR/version.candidate"
printf '%s\n' "$NEW_VERSION" > "$STAGE_DIR/version.candidate"
export ARCHVISUAL_OUTPUT_ROOT="$STAGE_DIR"
export ARCHVISUAL_STATIC_ROOT="$STAGE_DIR/staticfiles"
# Retain the legacy input name for existing external build adapters.
export ARCHEXPLOR_ARCHVISUAL_OUTPUT_ROOT="$STAGE_DIR"
BINARY_DIR="$STAGE_DIR/output/archvisual"
PLATFORM_INFO="$(python3 -B -c \
    'from scripts.release_tools import platform_tags; print(*platform_tags())')"
read -r OS_TAG ARCH_TAG EXECUTABLE_NAME <<< "$PLATFORM_INFO"

# ---------------------------------------------------------------------------
# 5. Run build_visual.py inside this release's private output root.
# ---------------------------------------------------------------------------
echo "=== Running build_visual.py ==="
python3 -B "$PROJECT_ROOT/build_visual.py"

if [[ ! -s "$BINARY_DIR/$EXECUTABLE_NAME" ]]; then
    echo "ERROR: build executable not found or empty: $BINARY_DIR/$EXECUTABLE_NAME" >&2
    exit 1
fi
if [[ "$OS_TAG" != windows && ! -x "$BINARY_DIR/$EXECUTABLE_NAME" ]]; then
    echo "ERROR: build output is not executable: $BINARY_DIR/$EXECUTABLE_NAME" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 6. Add the candidate version and binary-package usage instructions.
# ---------------------------------------------------------------------------
cp "$STAGE_DIR/version.candidate" "$BINARY_DIR/version.txt"
cp "$RELEASE_README" "$BINARY_DIR/README.md"

# ---------------------------------------------------------------------------
# 7. Build a temporary archive beside its destination and verify all payloads.
# ---------------------------------------------------------------------------
TARBALL="$RELEASE_DIR/archvisual.${NEW_VERSION}.${OS_TAG}.${ARCH_TAG}.tar.bz2"
echo "=== Creating $TARBALL ==="
ARCHIVE_TEMP="$(mktemp "$RELEASE_DIR/.archvisual.${NEW_VERSION}.${OS_TAG}.${ARCH_TAG}.tmp.XXXXXX")"
tar -C "$STAGE_DIR/output" -cjf "$ARCHIVE_TEMP" archvisual
python3 -B - "$ARCHIVE_TEMP" "$NEW_VERSION" "$EXECUTABLE_NAME" <<'PY'
import sys
from scripts.release_tools import verify_archive
verify_archive(*sys.argv[1:])
PY

# 8. Publish atomically, then update the source version. On a publication error,
# restore the original archive/version; no final pathname contains partial tar.
python3 -B - "$ARCHIVE_TEMP" "$TARBALL" \
    "$STAGE_DIR/version.candidate" "$STAGE_DIR/version.original" "$VERSION_FILE" <<'PY'
import sys
from scripts.release_tools import publish_release
publish_release(*sys.argv[1:])
PY

echo
echo "=== Release complete ==="
echo "  version : $NEW_VERSION"
echo "  platform: $OS_TAG/$ARCH_TAG"
echo "  tarball : $TARBALL"
