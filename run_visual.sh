#!/usr/bin/env bash
set -euo pipefail
module_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 -B "${module_dir}/archvisual.py" runserver "0.0.0.0:${1:?port required}" "${@:2}"
