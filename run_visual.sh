#!/usr/bin/env bash
set -euo pipefail
module_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${module_dir}/scripts/setup_python.sh"
archvisual_use_python
archvisual_hold_python
archvisual_check_python
exec "${ARCHVISUAL_PYTHON}" -B "${module_dir}/archvisual.py" runserver "0.0.0.0:${1:?port required}" "${@:2}"
