"""Read row-per-metric CSV files and their optional samplePeriod metadata."""
import csv
import io
import math
from contextlib import contextmanager

import pandas as pd


@contextmanager
def _text_source(source):
    if hasattr(source, 'read'):
        # Uploaded files are binary. Leave ownership of the upload to Django.
        stream = io.TextIOWrapper(source, encoding='utf-8-sig', newline='')
        try:
            yield stream
        finally:
            stream.detach()
    else:
        with open(source, encoding='utf-8-sig', newline='') as stream:
            yield stream


def read_metric_csv(source):
    """Return (sample-by-metric data, config), without inferring a period.

    samplePeriod contains one finite positive value, optionally padded with
    empty cells. It is metadata, wherever it occurs, never a plotted metric.
    Sample/Samples (case insensitive) or an empty top-left cell marks a header;
    files without a header retain their first metric and use ordinal labels.
    """
    config = {}
    with _text_source(source) as stream, io.StringIO(newline='') as samples:
        writer = csv.writer(samples)
        has_header = None
        for row in csv.reader(stream):
            if not row or not any(cell.strip() for cell in row):
                continue
            key = row[0].strip().casefold()
            if key == 'sampleperiod':
                if 'SamplePeriod' in config:
                    raise ValueError('Duplicate samplePeriod row')
                values = [cell.strip() for cell in row[1:] if cell.strip()]
                if len(values) != 1:
                    raise ValueError('samplePeriod requires one finite positive number')
                try:
                    period = float(values[0])
                except ValueError:
                    raise ValueError('samplePeriod requires one finite positive number') from None
                if not math.isfinite(period) or period <= 0:
                    raise ValueError('samplePeriod requires one finite positive number')
                config['SamplePeriod'] = period
                continue
            if has_header is None:
                has_header = key in ('sample', 'samples', '')
            writer.writerow(row)
        samples.seek(0)
        frame = pd.read_csv(samples, index_col=0, header=0 if has_header else None)
    if not has_header:
        frame.columns = pd.RangeIndex(frame.shape[1])
    return frame.T, config
