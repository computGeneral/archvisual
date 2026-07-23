#!/usr/bin/env python3
"""Convert a metric CSV into a Perfetto-openable Chrome Tracing JSON trace.

Input CSV layout (see examples/metricview.csv):
    Row 0 (header):  Sample,<bucket 0>,<bucket 1>,...,<bucket N-1>
    Row i (metric):  <metric name>,<value@0>,<value@1>,...,<value@N-1>

Each data row becomes one Perfetto *counter track* (a histogram data bar):
the column index is the time bucket and the cell value is the counter value
at that bucket. In the Perfetto UI each counter track renders as a stack of
rectangles whose height is proportional to the value -- i.e. a per-metric
histogram over the bucket index.

Output is Chrome Tracing JSON ("trace_events" with ph:"C" counter events),
which https://ui.perfetto.dev opens directly via "Open trace file".

Usage:
    python3 utils/csv2json.py examples/metricview.csv
    python3 utils/csv2json.py examples/metricview.csv -o out.json --bin-us 1.0
"""

import argparse
import csv
import json
import sys


def to_number(text):
    """Parse a CSV cell as int if integral, else float. Blank -> 0."""
    text = text.strip()
    if text == "":
        return 0
    try:
        f = float(text)
    except ValueError:
        # Non-numeric payload: fall back to 0 (keeps the trace well-formed).
        return 0
    if f.is_integer():
        return int(f)
    return f


def main(argv=None):
    p = argparse.ArgumentParser(
        description="Convert a metric CSV to a Perfetto Chrome Tracing JSON trace "
                    "(each row = a counter-track histogram bar; each column = a bucket sample).",
    )
    p.add_argument("input", help="Input CSV file.")
    p.add_argument(
        "-o", "--output",
        help="Output JSON path (default: replace .csv with .json).",
    )
    p.add_argument(
        "--bin-us", type=float, default=1.0,
        help="Time width of each bucket in microseconds (default: 1.0).",
    )
    p.add_argument(
        "--start-us", type=float, default=0.0,
        help="Starting timestamp in microseconds (default: 0.0).",
    )
    p.add_argument(
        "--pid", type=int, default=0,
        help="pid to group all counter tracks under (default: 0).",
    )
    args = p.parse_args(argv)

    out_path = args.output
    if not out_path:
        # Default: replace the .csv extension with .json.
        if args.input.lower().endswith(".csv"):
            out_path = args.input[: args.input.rfind(".")] + ".json"
        else:
            out_path = args.input + ".json"

    bin_us = args.bin_us
    start_us = args.start_us
    pid = args.pid

    track_iids = {}  # metric name -> track index (informational ordering only)

    with open(args.input, "r", newline="") as fin, open(out_path, "w") as fout:
        fout.write('{"traceEvents":[')
        first = True

        reader = csv.reader(fin)
        header = next(reader, None)
        if header is None:
            print("error: empty CSV (no header)", file=sys.stderr)
            return 1

        # Detect the metric column programmatically: the header's first cell.
        # Column count for samples = len(header) - 1.
        n_cols = len(header) - 1
        if n_cols <= 0:
            print("error: CSV has no sample columns", file=sys.stderr)
            return 1

        def emit(obj):
            nonlocal first
            if not first:
                fout.write(",")
            fout.write(json.dumps(obj))
            first = False

        metric_count = 0
        sample_count = 0

        for row in reader:
            if not row:
                continue
            name = row[0].strip()
            if name == "":
                # Skip nameless rows.
                continue

            # Distinct metric name -> distinct counter track. The counter track
            # is keyed by the series name (the metric name itself), so no extra
            # metadata event is needed: the track shows up in the UI labelled
            # purely by the metric name, with no " value" suffix.
            if name not in track_iids:
                track_iids[name] = len(track_iids) + 1
            tid = track_iids[name]
            metrics_vals = row[1:1 + n_cols]

            for idx, cell in enumerate(metrics_vals):
                value = to_number(cell)
                ts = start_us + idx * bin_us
                emit({
                    "ph": "C",
                    "name": name,
                    "pid": pid,
                    "tid": tid,
                    "ts": ts,
                    "args": {"value": value},
                })
                sample_count += 1

            metric_count += 1

        fout.write(']}')

    print(
        "wrote {}: {} metric track(s), {} counter sample(s)".format(
            out_path, metric_count, sample_count
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
