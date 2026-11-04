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
- Prepare deps explicitly from this repository: `bash scripts/setup_python.sh --prepare --python python3.10`
- Check only: `bash scripts/setup_python.sh --check --build`
- Run dev server from this directory: `.venv/bin/python -B archvisual.py runserver 0.0.0.0:8000`
- Alternative run script: `bash ./run_visual.sh 8000`
- Django checks: `.venv/bin/python -B archvisual.py check`
- Tests: `.venv/bin/python -B archvisual.py test`
- Environment/release tests: `.venv/bin/python -B -m unittest test_archvisual_env test_release_visual -v`

## Code Map
- Routing: `visualizer/urls.py`
- Settings: `visualizer/settings.py`
- View handlers and API endpoints: `dataviewer/views.py`
- In-memory shared state for loaded datasets: `dataviewer/globalvar.py`
- Frontend templates: `dataviewer/templates/*.html`
- Static JS/assets: `dataviewer/static/`

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
  repository. Maintain environment helpers in `scripts/shared_env.sh` and
  `archvisual_env.py`, with dependency pins in this repository's `requirements.txt`.
- Only explicit `scripts/setup_python.sh --prepare` may create/update the local
  `.venv`. Checking, running and building never install packages. Consumers may
  select an existing interpreter with `ARCHVISUAL_PYTHON`; do not discover a parent venv.
- Outputs default to this repository's `__output__/`; use `ARCHVISUAL_OUTPUT_ROOT`
  for an explicit external output tree. Keep source files outside build cleanup.
- Environment and release locks are per source repository, independent of output
  overrides. Preserve release rollback and version protection.

## Change Guidelines For Agents
- Prefer minimal, targeted edits. Do not reformat unrelated files.
- When changing endpoints, update both URL routes and corresponding frontend usage in templates/static JS.
- Validate with at least `.venv/bin/python -B archvisual.py check` after backend changes.
- If adding nontrivial behavior, include or update tests under `dataviewer/tests.py`.
