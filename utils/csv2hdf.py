#!/usr/bin/env python3
"""Convert a CSV file (row-per-metric, columns-per-sample) to HDF5 using PyTables."""

import argparse
import os
import sys

import pandas as pd
import tables


def csv_to_hdf5(csv_path: str, output: str = None) -> str:
    df = pd.read_csv(csv_path, index_col=0)

    if output:
        h5_path = output
    else:
        base, _ = os.path.splitext(csv_path)
        h5_path = base + ".h5"

    filters = tables.Filters(complevel=5, complib="blosc")

    with tables.open_file(h5_path, mode="w", title=os.path.basename(csv_path)) as hf:
        # Store column headers (sample indices) as a VLArray
        cols = hf.create_vlarray("/", "columns", tables.VLStringAtom(), filters=filters)
        for c in df.columns.astype(str):
            cols.append(c.encode("utf-8"))

        for metric, row in df.iterrows():
            data = row.values.astype("float64")
            node_name = _safe_name(str(metric))
            arr = hf.create_carray("/", node_name, obj=data, title=str(metric), filters=filters)
            arr.attrs["metric"] = str(metric)

    print(f"Written: {h5_path}  ({len(df)} metrics × {len(df.columns)} samples)")
    return h5_path


def _safe_name(name: str) -> str:
    """Return a PyTables-safe node name (alphanumeric + underscore, no leading digit)."""
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in name)
    if safe and safe[0].isdigit():
        safe = "_" + safe
    return safe


def main():
    parser = argparse.ArgumentParser(
        description="Pack a CSV file into an HDF5 file using PyTables."
    )
    parser.add_argument(
        "-i", "--input", required=True, metavar="CSV_FILE",
        help="Path to the input CSV file"
    )
    parser.add_argument(
        "-o", "--output", default=None, metavar="H5_FILE",
        help="Path for the output HDF5 file (default: same location and name as input)"
    )
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"Error: file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    csv_to_hdf5(args.input, args.output)


if __name__ == "__main__":
    main()
