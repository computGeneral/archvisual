# ArchVisual

A web-based visualization tool for exploring and analyzing architectural data using Django and HDF5.

## Requirements

- Python 3.8 or higher
- pip (Python package manager)

## Installation

### Step 1: Install Python Dependencies

Use pip to install all required packages:

```bash
pip install -r requirements.txt
```

Or, if you prefer to use a specific mirror (e.g., Aliyun mirror in China):

```bash
pip install -r requirements.txt -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
```

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
python -c "import django; import pandas; print('Installation successful!')"
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
python archvisual.py runserver 0.0.0.0:8000
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



