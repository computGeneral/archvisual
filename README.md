# ArchVisual

A web-based visualization tool for exploring and analyzing architectural data using Django and HDF5.

## Requirements

- Python 3.10 or 3.11 and pip (Python 3.12 and newer are not supported)
- Bash and flock for the shell wrappers; tar for release packaging

## Installation and environment

ArchVisual is an independent repository. Run the following from its own root;
no ArcheXplor checkout, parent scripts or parent Python environment are needed.

```bash
bash scripts/setup_python.sh --prepare --python python3
bash scripts/setup_python.sh --check --build
bash run_visual.sh 8000
```

Preparation creates or updates only this repository's `.venv`. Python 3.10/3.11
use the fixed versions in `requirements.txt`. Preparation and environment
checks reject Python 3.12 and newer before creating a venv or installing packages.
Preparation refuses a symlinked `.venv` or an existing venv with a different
Python minor version, before any pip invocation. It does not delete or replace
that environment. To change versions, move the old `.venv` aside explicitly
or prepare a separate checkout with the intended `--python` interpreter.
Installation is explicit:
checking, running and building never install packages. Build checks also verify
Nuitka; runtime checks verify the remaining pinned packages and their imports.

Python selection for shell entry points is: explicit `ARCHVISUAL_PYTHON`,
this repository's `.venv`, then the virtual environment activated through
`VIRTUAL_ENV`. An invalid explicit interpreter fails without falling back.
The interpreter's venv path is preserved, and PATH is not rewritten.
For example, an existing external environment can be selected explicitly:

```bash
ARCHVISUAL_PYTHON=/absolute/path/to/venv/bin/python bash run_visual.sh 8000
```

The local `scripts/shared_env.sh` and `archvisual_env.py` own selection,
checks, paths and the environment lock. Preparation takes an exclusive local
lock; shell runs/releases and direct builds hold a shared lock. On Windows,
direct Python build/preparation uses an exclusive file lock. The lock is tied
to this source repository, so changing output directories cannot bypass it.
The packaged application does not require environment setup scripts.

```bash
.venv/bin/python -B archvisual.py check
.venv/bin/python -B archvisual.py test dataviewer --noinput
.venv/bin/python -B build_visual.py
```

Default build, static, upload temporary and test outputs are inside this
repository's `__output__/`. `ARCHVISUAL_OUTPUT_ROOT` overrides that root;
`ARCHVISUAL_STATIC_ROOT` and `ARCHVISUAL_TEMP_ROOT` optionally override their
individual directories. Relative paths are anchored to the ArchVisual root,
independent of the caller's working directory. Output must not overlap source
paths. An ArcheXplor consumer can explicitly set `ARCHVISUAL_PYTHON` and
`ARCHVISUAL_OUTPUT_ROOT` to reuse its environment and output tree.

Existing `ARCHEXPLOR_ARCHVISUAL_OUTPUT_ROOT`, `ARCHEXPLOR_ARCHVISUAL_STATIC_ROOT`
and `ARCHEXPLOR_ARCHVISUAL_TEMP_ROOT` remain aliases; the corresponding
`ARCHVISUAL_*` variable takes precedence. No parent helper is imported.

Dependency pins in `requirements.txt` are Django 4.2.23,
django-cors-headers 4.4.0, pandas 2.0.3, numpy 1.24.4, numexpr 2.8.6,
blosc2 2.3.0, tables 3.10.1 and Nuitka 4.0.3. Runtime/build checks enforce
these pins and actual imports, without silently upgrading dependencies.

Python 3.10.12 has been exercised on Linux x86_64. Python 3.11 is admitted
but has not yet been validated here. Nuitka application compilation was not
performed.

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

Validation from the ArchVisual repository root:

```bash
.venv/bin/python -B archvisual.py check
.venv/bin/python -B archvisual.py test dataviewer --noinput
node dataviewer/test_metric_heat.cjs
```

Heat viewport stability is covered by an additional browser regression. With
Playwright available to Node and a local Chrome executable, start ArchVisual
and run from the repository root:

```bash
node dataviewer/test_heat_stability.cjs http://127.0.0.1:8000
node dataviewer/test_heat_scale.cjs http://127.0.0.1:8000
node dataviewer/test_heat_multiple_plot.cjs http://127.0.0.1:8000
node dataviewer/test_heat_statistics.cjs http://127.0.0.1:8000
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
The statistics regression uses the locally selected Python to generate H5 fixtures and
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
node dataviewer/test_trace_metric_sync.cjs http://127.0.0.1:8000
```

`TRACE_SYNC_CHROME` selects Chrome; `TRACE_SYNC_TEST_OUTPUT` selects a report
directory under the repository output tree. Playwright must be available to Node.
The existing time conversion and Trace display padding remain unchanged.

## Safe release packaging

From the ArchVisual repository root, run `bash rel_visual.sh min` (or `mid` /
`maj`). The script uses the locally selected Python and serializes releases
with a source-project release lock, even when output overrides differ. It builds
inside a unique directory under `__output__/.release-staging/`; regular standalone build outputs
and existing release packages are kept separate.

Validated packages are published under `__output__/releases/` as
`archvisual.<version>.<system>.<machine>.tar.bz2`, for example
`archvisual.0.4.1.linux.x86_64.tar.bz2`. Source `version.txt` stays at its old
value while building and validating. The temporary archive is atomically
renamed into place, then the version is atomically updated. Publication errors
restore the previous archive/version; a failed rollback retains recovery
artifacts and reports their location. Cleanup failures after a completed
publication are reported separately. Package permissions follow the current umask.

`ARCHVISUAL_RELEASE_DIR` overrides the release destination. The legacy
`ARCHEXPLOR_ARCHVISUAL_RELEASE_DIR` and `ARCHEXPLOR_ARCHVISUAL_OUTPUT_DIR` remain
fallbacks for safe destinations; locations inside cleaned output/build/static
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
.venv/bin/python -B -m unittest test_archvisual_env test_release_visual -v
```
