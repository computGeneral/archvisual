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
