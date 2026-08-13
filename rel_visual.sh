#!/bin/bash
# Release build script for the archvisual project.
#
# Bumps version.txt per the requested domain (maj|mid|min), runs build_visual.py,
# copies version.txt into the built binary directory, and tars the result to
# archvisual.<version>.tar.bz2.
#
# Usage: bash rel_visual.sh {maj|mid|mid|min}

set -euo pipefail

# Resolve repo root (script location) so it runs from anywhere.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

VERSION_FILE="$PROJECT_ROOT/version.txt"
OUTPUT_DIR="$PROJECT_ROOT/__output__/output"
BINARY_DIR="$OUTPUT_DIR/archvisual"

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
    maj) MAJ=$((MAJ + 1)); MID=0; MIN=0 ;;
    mid) MID=$((MID + 1)); MIN=0 ;;
    min) MIN=$((MIN + 1)) ;;
esac

NEW_VERSION="${MAJ}.${MID}.${MIN}"
echo "Bumping version: ${RAW} -> ${NEW_VERSION}"

# ---------------------------------------------------------------------------
# 4. Write new version back to version.txt (with trailing newline)
# ---------------------------------------------------------------------------
printf '%s\n' "$NEW_VERSION" > "$VERSION_FILE"

# ---------------------------------------------------------------------------
# 5. Run build_visual.py (rebuilds __output__/output/archvisual/)
# ---------------------------------------------------------------------------
echo "=== Running build_visual.py ==="
python3 "$PROJECT_ROOT/build_visual.py"

if [[ ! -d "$BINARY_DIR" ]]; then
    echo "ERROR: build output dir not found: $BINARY_DIR" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 6. Copy version.txt into the binary directory
# ---------------------------------------------------------------------------
cp "$VERSION_FILE" "$BINARY_DIR/version.txt"
echo "Copied version.txt -> $BINARY_DIR/version.txt"

# ---------------------------------------------------------------------------
# 7. Tar the binary dir to archvisual.<version>.tar.bz2
# ---------------------------------------------------------------------------
TARBALL="$OUTPUT_DIR/archvisual.${NEW_VERSION}.tar.bz2"
echo "=== Creating $TARBALL ==="
rm -f "$TARBALL"
tar -C "$OUTPUT_DIR" -cjf "$TARBALL" archvisual

echo
echo "=== Release complete ==="
echo "  version : $NEW_VERSION"
echo "  binary  : $BINARY_DIR"
echo "  tarball : $TARBALL"
