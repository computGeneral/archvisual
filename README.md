# ArchVisual

A web-based visualization tool for exploring and analyzing architectural data using Django and HDF5.

## Requirements

- Workspace Python 3.10.12 at repo-root `.venv/bin/python`
- pip (Python package manager)

## Installation

### Step 1: Install Python Dependencies

From the repository root, explicitly prepare and check the shared environment:

```bash
bash scripts/setup_workspace_python.sh --prepare
bash scripts/setup_workspace_python.sh --check
```

Root requirements include this module, perfmodel and ISAGEN. Do not install
packages during a frozen candidate run or create a separate module venv.
Build/run wrappers hold a task-lifetime Python environment read lock. For bare
Django commands use the managed entry from repo root, for example:
`.venv/bin/python -B scripts/workspace_python.py run -- .venv/bin/python -B archvisual/archvisual.py check`.
The packaged application does not depend on a workspace-only guard.

**Required packages:**
- Django (4.2.23) - Web framework
- django-cors-headers (4.4.0) - CORS support
- pandas (2.0.3) - Data manipulation and analysis
- numpy (1.24.4) - Numerical computing
- numexpr (2.8.6) - Fast numerical expression evaluation
- blosc2 (2.0.0) - Data compression
- nuitka (4.0.3) - Python compiler

### Step 2: Verify Installation

```bash
.venv/bin/python -B -c "import django; import pandas; print('Installation successful!')"
```

## Input Data Format

### HDF5 Files

ArchVisual primarily works with **HDF5 (Hierarchical Data Format 5)** files for efficient data storage and retrieval.

**File Requirements:**
- File extension: `.h5` or `.hdf5`
- Format: HDF5 binary format
- Supported data types: Numeric arrays, tables, and hierarchical datasets

**Example HDF5 File Structure:**
```
mydata.h5
├── /dataset1
│   └── (numerical array or table data)
├── /dataset2
│   └── (numerical array or table data)
└── /metadata
    └── (optional metadata)
```

**Creating HDF5 Files with Python:**
```python
import pandas as pd

# Create sample data
data = pd.DataFrame({
    'column1': [1, 2, 3, 4, 5],
    'column2': [10.5, 20.3, 15.7, 30.2, 25.1]
})

# Save to HDF5
data.to_hdf('mydata.h5', key='dataset', mode='w')
```

**Reading HDF5 Files:**
```python
import pandas as pd

# Read HDF5 file
data = pd.read_hdf('mydata.h5', key='dataset')
print(data)
```

### CSV Files

ArchVisual also supports **CSV (Comma-Separated Values)** files as an alternative input format.

**File Requirements:**
- File extension: `.csv`
- Standard CSV format with headers

## Server Management

### Starting the Server

```bash
bash ./run_visual.sh 8000
```

Or use the provided shell script:

```bash
bash ./run_visual.sh 8000
```

**Note:** The default port is 8086 if not specified.

### Accessing the Application

Open your web browser and navigate to:

```
http://localhost:8000/
```

Or replace `localhost` with your server's IP address if running remotely.




## MetricViewer Heat mode

Load an `.h5` file through **Load → Local File / Server File**, choose
**Heat** in the Line/Heat selector, search for metrics (press Enter), and click **Plot**.
Each **Plot** appends a new heatmap below the existing ones, containing only
the metrics selected for that Plot. Multiple maps use compact, row-based heights
(minimum **140 px**) and **6 px** spacing. The default top margin is **52 px**,
with extra room for long sample labels; bottom space is **40 px**. Single maps
fill the panel. The same metric may appear in several maps.
Heat does not require a group name. Every row represents one selected metric
instance and every sample cell represents one sample, in the file's original order.
Hover a cell for the full metric name, sample label and raw value.

- Each map has independent **Color / Min / Max** settings and its own color bar.
  The complete color bar is centered below the visible **sample grid**,
  with an **8 px** gap. Its endpoint labels stay visible in narrow plots by
  shortening the bar and reducing the label font as needed.
  Adding another map does not change existing maps' color bounds.
- **Shared raw scale** compares absolute values across metrics within that map. Auto
  bounds use all selected samples and stay fixed while scrolling or zooming.
  Set **Min / Max** to choose explicit color bounds; values outside the color
  bounds retain their original tooltip values.
- **Per-metric normalized** compares each metric's trend using its full-row minimum
  and maximum. Constant rows map to 0. Raw values remain available in tooltips.
- The three **min / avg / max** columns immediately to the right summarize
  every sample in the loaded file for each metric. Their cells stay **16 × 16 px**
  while sample columns zoom; they track metric rows when scrolling. Hover for
  full raw values. Statistics share the map’s color scale. **avg** is the
  arithmetic mean of valid samples, including zero; missing samples are skipped.
  An entirely missing row stays gray. Start/End and panning do not change these
  full-file statistics. Ratio metrics use the sample mean. Statistics are cached
  after data queries and refreshed when the file reloads.
- Gray cells mean missing or nonfinite values; valid zero values use the normal
  color scale. Missing or nonnumeric metric columns produce an explicit error.
- Cells start at **16 × 16 CSS px**, with a fixed **16 px row height** and no
  Cell size setting. Use **Ctrl+wheel** over the plot to zoom horizontally
  between **1 and 16 px per sample**, centered on the sample under the pointer.
  Maps in the same panel share horizontal zoom, panning and Start/End so their
  samples stay aligned. Scroll vertically through the list of maps.
  Use **Shift+wheel** to pan horizontally, or use the horizontal/vertical
  scrollbars. Ordinary wheel gestures retain native vertical scrolling, over
  both data cells and metric labels. At narrow scales
  fewer x-axis labels are shown; every sample still has its own cell.
  Enter sample labels into **Start / End** and press Enter to select a range.
  Data is rendered by visible windows without merging or downsampling samples.
- Each map places its title, **Color / Min / Max**, dynamic status and
  sample/value explanations and instructions **inside the right sidebar**.
  The three controls are equally **100 px** wide; hover Color to read its full
  selected label. The sidebar defaults to **180 px**. **Drag its left edge**
  to resize between **0 and 400 px**; at **0 px** the sidebar is hidden. Drag
  the plot's rightmost **8 px** edge left to show it again. This drag area
  overlays the plot and reserves no sidebar width. Every map in the same panel
  resizes together, keeping sample axes aligned; split panels remain independent.
  Focus the edge and use Left/Right (10 px), Home or End for keyboard resizing.
  New plots, mode switches, Clear and H5 reload retain the panel sidebar width.
  Status and instructions wrap and scroll without changing the plot height.
  Narrow panels scroll horizontally to reach the sidebar. Heat adds no extra
  control row to the main page toolbar.
- **Line / Heat** switches retain Plot groups, metrics and the selected sample range.
  Template export/import also preserves the groups and per-map color settings.
  Each split panel keeps its own data, mode, horizontal scale and color settings.
  **Clear** removes all maps in the active panel. Click a heat cell, then press
  Delete to remove that metric only from its own map; an empty map is removed.
- Reloading a file refreshes values and retains metrics present in the new file;
  absent metrics are reported in the panel's status bar.

Compatible H5 files contain `/data` (pandas DataFrame: rows=samples,
columns=metric names) and optional `/config`. Perfmodel's generated
`*_perf_metric_*.h5` files use this structure. The x-axis displays sample labels;
Heat does not infer a physical time unit from the file name.

Validation from the repository root, after binding workspace Python:

```bash
.venv/bin/python -B archvisual/archvisual.py check
.venv/bin/python -B archvisual/archvisual.py test dataviewer --noinput
node archvisual/dataviewer/test_metric_heat.cjs
```

Heat viewport stability is covered by an additional browser regression. With
Playwright available to Node and a local Chrome executable, start ArchVisual
and run from the repository root:

```bash
node archvisual/dataviewer/test_heat_stability.cjs http://127.0.0.1:8000
node archvisual/dataviewer/test_heat_scale.cjs http://127.0.0.1:8000
node archvisual/dataviewer/test_heat_multiple_plot.cjs http://127.0.0.1:8000
node archvisual/dataviewer/test_heat_statistics.cjs http://127.0.0.1:8000
```

The test keeps ordinary scrollbars visible and checks idle repaint, resize
feedback, fractional split dimensions, scrolling and tooltip stability.
`HEAT_TEST_CHROME` selects another Chrome executable; `HEAT_TEST_OUTPUT` selects
a report directory under the repository output tree. The scale regression
checks Ctrl+wheel zoom limits, ordinary scrolling, fixed row height, exact raw cells, pointer anchoring,
last-sample access and independent split-panel scales. Set `HEAT_TEST_FIXTURE`
to exercise another H5 file through the same server load/query flow. The multiple
Plot regression covers real Plot clicks, linked horizontal views, independent
colors, templates, out-of-order requests, Clear/Delete, reload and multi-map
layout stability. It also verifies compact controls and sidebar instructions,
error-status wrapping, shared drag resizing and limits, pointer cleanup,
keyboard resizing, hidden sidebar state and real edge-drag reopening (including
1–10 px widths), and real control clicks after narrow-panel horizontal scrolling.
`HEAT_TEST_RELOAD_FIXTURE` optionally selects a different H5 for its reload check. Template test artifacts are written under the output tree.
The statistics regression uses workspace Python to generate H5 fixtures and
independent math.fsum reference means under its output directory.

## Metric / Trace keyboard synchronization

In **Metric vs. Trace**, enable MetricViewer's **Sync** checkbox, then click
inside the Trace timeline to focus its keyboard controls. `a` pans left and
`d` / `e` pan right; `Shift+A` / `Shift+D` use the larger existing pan step.
The Metric sample range follows the Trace pan. Turning Sync off keeps Metric
independent. Received Trace updates do not echo a rounded Metric range back
into a Trace zoom; user changes in Metric still synchronize to Trace.

Keyboard synchronization is covered by a browser regression using actual
key events, the example H5, and a minimal Catapult trace. It checks normal and
high pixel density, rapid repeated panning, Sync off, and standalone Trace:

```bash
node archvisual/dataviewer/test_trace_metric_sync.cjs http://127.0.0.1:8000
```

`TRACE_SYNC_CHROME` selects Chrome; `TRACE_SYNC_TEST_OUTPUT` selects a report
directory under the repository output tree. Playwright must be available to Node.
The existing time conversion and Trace display padding remain unchanged.

## Safe release packaging

From the repository root, run `bash archvisual/rel_visual.sh min` (or `mid` /
`maj`). The script uses the managed workspace Python and serializes releases
with a project release lock. It builds inside a unique directory under
`__output__/archvisual/.release-staging/`; regular standalone build outputs
and existing release packages are kept separate.

Validated packages are published under `__output__/archvisual/releases/` as
`archvisual.<version>.<system>.<machine>.tar.bz2`, for example
`archvisual.0.4.1.linux.x86_64.tar.bz2`. Source `version.txt` stays at its old
value while building and validating. The temporary archive is atomically
renamed into place, then the version is atomically updated. Publication errors
restore the previous archive/version; a failed rollback retains recovery
artifacts and reports their location. Cleanup failures after a completed
publication are reported separately. Package permissions follow the current umask.

`ARCHEXPLOR_ARCHVISUAL_RELEASE_DIR` overrides the release destination within
repo-root `__output__/`. The older `ARCHEXPLOR_ARCHVISUAL_OUTPUT_DIR` remains a
fallback for safe destinations; locations inside cleaned output/build/static
or release-staging directories are rejected. Existing packages are not moved
automatically. `build_visual.py` retains its standalone output layout.

The archive temporary file lives beside its final destination. Staged version
files must share a filesystem with source `version.txt`; cross-filesystem
copy fallback is deliberately avoided for atomic publication. This is a
rollback protocol around two atomic file replacements, not a crash-durable
multi-file transaction.

Release failure-path tests use isolated repositories and injected build/tar
failures; they do not compile Nuitka or publish a real release:

```bash
.venv/bin/python -B -m unittest discover -s archvisual -p test_release_visual.py -v
```
