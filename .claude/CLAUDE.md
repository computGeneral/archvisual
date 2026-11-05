# ArchVisual - Claude Documentation

## Introduction

ArchVisual is a Django-based visualization project for metric and trace data analysis. It provides multiple viewers for different visualization needs.

## Views/Features

### Viewers
- **MetricViewer**: Visualize metric data with line/area charts, supporting multiple metrics in stacked groups
- **TraceViewer**: View trace data with timeline visualization
- **CrossViewer**: Correlate cross-viewer data between different views
- **SummaryViewer**: Summary statistics dashboard

## Project Structure

```
archvisual/
├── scripts/             # Output paths, release, conversion helpers and support tests
├── visualizer/          # Django project configuration
├── dataviewer/           # Main application
│   ├── templates/         # HTML templates
│   │   ├── metricviewer.html
│   │   ├── traceviewer.html
│   │   ├── crossviewer.html
│   │   └── summaryviewer.html
│   └── views.py           # Backend view handlers
└── static/               # Static assets
    ├── js/
    └── image/
```

## Dependencies

- Python 3
- Django
- Pandas
- ECharts (JavaScript library)

## Running the Server

Use the Python and dependencies already available through your terminal's PATH:

```shell
python3 -B archvisual.py runserver 0.0.0.0:8000
# Or use the provided wrapper:
bash ./run_visual.sh 8000
```

Access the application at: `http://0.0.0.0:8000/`.

ArchVisual does not select interpreters, prepare environments or compare package
versions. Shell wrappers use `python3`; build subprocesses use `sys.executable`.
Installed dependencies determine compatibility. `requirements.txt` retains its
reference versions but is not read at startup or build time. Install missing
packages separately according to the environment's package-management policy.

Do not source parent-repository environment scripts. `scripts.paths` maintains
output routing and source-path protection; outputs default to `__output__/`
with optional `ARCHVISUAL_OUTPUT_ROOT` and individual path overrides. Release
publication retains its source-local lock and rollback via `scripts.release_tools`.
CSV converters and support tests live in `scripts/`. Run support tests with:

```shell
python3 -B -m unittest scripts.test_paths scripts.test_release_visual scripts.test_conversion_scripts -v
```

## Recent Changes

### MetricViewer Updates
- **Color Theme**: Each metric signal now has a unique random border color
- **Fill Opacity**: Default 25% transparency for area fill
- **Grid Height**: Set to 70 pixels per metric bar
- **Border Width**: 2px for metric lines

### TraceViewer Development Rules
- **TraceViewer is integrated with `static/catapult_trace_viewer.html` via iframes**: Any modification to TraceViewer must consider both `traceviewer.html` (the host page) and the `catapult_trace_viewer.html` iframe content.
- The catapult trace viewer (chrome://tracing) exposes `window._tview` (a `tr-ui-timeline-track-view` element) on the iframe window. Use `_tview.setActiveTrace(filename, data)` to programmatically load trace data.
- Trace data files are typically JSON format; local files are read via `FileReader.readAsText()`, and server files are fetched via `/api/show/server_file` which returns raw file content.
- The server file browser endpoint `/api/show/server_list` defaults to the project root but can navigate the entire filesystem.
- When modifying iframe communication, test both single-panel and split-view modes.
- **When updating TraceViewer behavior, always check both the parent template and the Catapult iframe implementation.** Do not assume changes in `dataviewer/templates/traceviewer.html` are sufficient.
- TraceViewer embeds `/static/catapult_trace_viewer.html` in iframes. Catapult UI behavior may be implemented in `dataviewer/static/catapult_trace_viewer.html` or related files under `dataviewer/static/js/`.
- The visible Catapult **Load** button is created by `dataviewer/static/js/catapult_trace_viewer.js`, not only by the parent TraceViewer template.
- For parent-level features that affect Catapult controls, patch each iframe after it loads from `traceviewer.html`; direct parent-page handlers do not see clicks inside the iframe.
- **Cache-busting**: Static Catapult HTML/JS can be browser-cached aggressively. Update cache-busting query strings on iframe/script URLs when changing Catapult assets (e.g., `src="/static/catapult_trace_viewer.html?v=2"`).
