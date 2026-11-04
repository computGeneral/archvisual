#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/shared_env.sh"
action="${1:-}"
case "$action" in
    --check)
        shift
        archvisual_use_python
        exec "$ARCHVISUAL_PYTHON" -B "$ARCHVISUAL_PROJECT_ROOT/archvisual_env.py" check "$@"
        ;;
    --prepare)
        shift
        bootstrap="${ARCHVISUAL_BOOTSTRAP_PYTHON:-python3}"
        if [[ "${1:-}" == --python && $# == 2 ]]; then
            bootstrap="$2"
        elif (( $# != 0 )); then
            echo 'Usage: setup_python.sh --prepare [--python python3.10]' >&2
            exit 2
        fi
        exec "$bootstrap" -B "$ARCHVISUAL_PROJECT_ROOT/archvisual_env.py" prepare
        ;;
    *)
        echo 'Usage: setup_python.sh --prepare [--python python3.10] | --check [--build]' >&2
        exit 2
        ;;
esac
