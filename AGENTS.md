# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview
- This is a Django web app for architecture metric/trace visualization.
- Main Django project: `archvisual/`
- Main app: `dataviewer/`
- Entry script: `archvisual.py`

For product/setup details, see [README.md](README.md).
For additional architecture notes, see [.claude/CLAUDE.md](.claude/CLAUDE.md).

## Fast Start Commands
- Install deps: `pip install -r requirements.txt`
- Run dev server: `python archvisual.py runserver 0.0.0.0:8000`
- Alternative run script: `bash ./run_visual.sh 8000`
- Django checks: `python archvisual.py check`
- Tests: `python archvisual.py test`

## Code Map
- Routing: `archvisual/urls.py`
- Settings: `archvisual/settings.py`
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
- `requirements.txt` currently includes `tables=3.10.1` (single `=`). If dependency installation fails, correct this to `tables==3.10.1`.

## Change Guidelines For Agents
- Prefer minimal, targeted edits. Do not reformat unrelated files.
- When changing endpoints, update both URL routes and corresponding frontend usage in templates/static JS.
- Validate with at least `python archvisual.py check` after backend changes.
- If adding nontrivial behavior, include or update tests under `dataviewer/tests.py`.
