# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview
- This is a Django web app for architecture metric/trace visualization.
- Main Django project: `visualizer/`
- Main app: `dataviewer/`
- Entry script: `archvisual.py`

For product/setup details, see [README.md](README.md).
For additional architecture notes, see [.claude/CLAUDE.md](.claude/CLAUDE.md).

## Fast Start Commands
- Use the current terminal's `python3` and its installed dependencies.
- Run dev server from this directory: `python3 -B archvisual.py runserver 0.0.0.0:8000`
- Alternative run script: `bash ./run_visual.sh 8000`
- Django checks: `python3 -B archvisual.py check`
- Tests: `python3 -B archvisual.py test`
- Build: `python3 -B build_visual.py`
- Path/entrypoint/release/conversion tests: `python3 -B -m unittest scripts.test_paths scripts.test_release_visual scripts.test_conversion_scripts -v`

## Code Map
- Routing: `visualizer/urls.py`
- Settings: `visualizer/settings.py`
- View handlers and API endpoints: `dataviewer/views.py`
- In-memory shared state for loaded datasets: `dataviewer/globalvar.py`
- Frontend templates: `dataviewer/templates/*.html`
- Static JS/assets: `dataviewer/static/`
- Output paths, release helpers, CSV conversion and support tests: `scripts/`
- Output path helper: `scripts/paths.py` (import as `scripts.paths`)

## Project-Specific Conventions
- Keep API endpoints as function-based Django views in `dataviewer/views.py`.
- Existing endpoints rely on in-memory process state (`dataviewer/globalvar.py`) instead of a database.
- Supported upload/load formats are `.h5` and `.csv`; CSV paths are converted to HDF5-like structures during processing.
- URL style currently omits trailing slashes (for example `/traceviewer`, `/api/show/query`) and `APPEND_SLASH=False` is set in settings.

## Important Pitfalls
- The app is stateful in-process. Restarting the server clears loaded data.
- `dataviewer/globalvar.py` is global mutable state and may have concurrency implications under multi-worker deployment.
- `dataviewer/tests.py` is currently minimal. Add tests for behavior changes, especially API request/response flow.
- ArchVisual is independent: never source/import environment scripts from a parent
  repository. Shell entrypoints invoke `python3` from PATH; Python subprocesses
  use `sys.executable`. An activated virtual environment works through PATH too.
- There is no interpreter selector, environment preparation, version comparison
  or Python environment lock. Do not recreate that machinery. Installed packages
  determine compatibility; report actual dependency errors. Running and building
  never install Python packages or modify existing environments.
- Python 3.10 or newer is the documented baseline. `requirements.txt` records
  reference package versions and is still consumed by the parent workspace;
  ArchVisual runtime/build do not read it or require exact matches. Record actual
  Python/dependency versions in validation; do not claim untested combinations pass.
- Outputs default to this repository's `__output__/`; use `ARCHVISUAL_OUTPUT_ROOT`
  for an explicit external output tree. Keep source files outside build cleanup.
- The release lock is per source repository, independent of output overrides.
  Preserve release rollback and version protection.

## Change Guidelines For Agents
- Prefer minimal, targeted edits. Do not reformat unrelated files.
- When changing endpoints, update both URL routes and corresponding frontend usage in templates/static JS.
- Validate with at least `python3 -B archvisual.py check` after backend changes.
- If adding nontrivial behavior, include or update tests under `dataviewer/tests.py`.
