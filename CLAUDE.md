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
