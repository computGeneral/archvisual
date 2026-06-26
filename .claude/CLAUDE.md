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
├── archvisual/          # Django project configuration
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

## Installation

```shell
pip3 install Django -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
pip3 install pandas -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
```

## Running the Server

```shell
# Direct Django command
python archvisual.py runserver 0.0.0.0:8000

# Using the provided shell script
bash ./run_visual.sh 8000
```

Access the application at: `http://0.0.0.0:8000/`

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
