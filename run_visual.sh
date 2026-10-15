#!/usr/bin/env bash
set -euo pipefail
module_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${module_dir}/../scripts/shared_env.sh"
archexplor_use_workspace_python
archexplor_hold_workspace_python || exit $?
exec "${ARCHEXPLOR_PYTHON_BIN}" "${module_dir}/archvisual.py" runserver "0.0.0.0:${1:?port required}"
