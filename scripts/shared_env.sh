#!/usr/bin/env bash
# ArchVisual owns these helpers; no parent repository scripts are sourced.
ARCHVISUAL_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

archvisual_use_python() {
    local candidate="${ARCHVISUAL_PYTHON:-}"
    if [[ -z "$candidate" ]]; then
        if [[ -x "$ARCHVISUAL_PROJECT_ROOT/.venv/bin/python" ]]; then
            candidate="$ARCHVISUAL_PROJECT_ROOT/.venv/bin/python"
        elif [[ -x "$ARCHVISUAL_PROJECT_ROOT/.venv/Scripts/python.exe" ]]; then
            candidate="$ARCHVISUAL_PROJECT_ROOT/.venv/Scripts/python.exe"
        elif [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/bin/python" ]]; then
            candidate="$VIRTUAL_ENV/bin/python"
        elif [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/Scripts/python.exe" ]]; then
            candidate="$VIRTUAL_ENV/Scripts/python.exe"
        else
            echo "ERROR: no ArchVisual Python environment; run bash $ARCHVISUAL_PROJECT_ROOT/scripts/setup_python.sh --prepare or set ARCHVISUAL_PYTHON" >&2
            return 1
        fi
    fi
    candidate="$(command -v -- "$candidate")" || {
        echo 'ERROR: ARCHVISUAL_PYTHON is not executable' >&2; return 1;
    }
    if [[ "$candidate" != /* ]]; then
        candidate="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
    fi
    export ARCHVISUAL_PYTHON="$candidate" PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1
}

archvisual_hold_python() {
    # Stable per-source lock: changing output roots cannot bypass preparation.
    exec {ARCHVISUAL_PYTHON_LOCK_FD}>"$ARCHVISUAL_PROJECT_ROOT/.archvisual-python.lock"
    if ! flock -n -s "$ARCHVISUAL_PYTHON_LOCK_FD"; then
        echo 'ERROR: ArchVisual Python preparation is active' >&2
        return 75
    fi
}

archvisual_check_python() {
    "$ARCHVISUAL_PYTHON" -B "$ARCHVISUAL_PROJECT_ROOT/archvisual_env.py" check "$@"
}

archvisual_configure_paths() {
    local declarations
    declarations="$("$ARCHVISUAL_PYTHON" -B "$ARCHVISUAL_PROJECT_ROOT/archvisual_env.py" shell)" || return $?
    # Values are emitted by our local helper with shlex.quote, never interpolated.
    eval "$declarations"
}
