#!/usr/bin/env python3
"""Create a deterministic load fixture using real metric names and csv2hdf.

Run from ArchVisual: python3 -B -m scripts.generate_metric_benchmark
    --reference /path/to/reference.h5 --output /path/to/new-directory
No hardware correctness is implied by the generated values.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import resource
import subprocess
import sys
import time

import numpy as np
import pandas as pd

from scripts.paths import validate_output_path


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def values_for(index, samples, seed):
    """Quarter-integers stay exactly representable through CSV and float64 H5."""
    rng = np.random.default_rng(np.random.SeedSequence([seed, index]))
    x = np.arange(samples)
    noise = rng.integers(0, 400000, samples)
    kind = index % 5
    if kind == 0:
        noise[x % 13 < 8] = 0
    elif kind == 1:
        noise = (x * (index % 31 + 1) % 8192) * 16 + noise % 256
    elif kind == 2:
        noise = (index % 500 + 1) * 400 + noise % 401
    elif kind == 3:
        noise[x % 257 > 32] %= 80
    return noise.astype(np.float64) / 4


def verify(csv_path, h5_path, names, samples, period):
    started = time.perf_counter()
    with pd.HDFStore(h5_path, 'r') as store:
        data, config = store['data'], store['config']
        assert data.shape == (samples, len(names)), data.shape
        assert data.columns.tolist() == names
        assert list(map(str, data.index)) == list(map(str, range(1, samples + 1)))
        assert all(dtype == np.dtype('float64') for dtype in data.dtypes)
        assert config['SamplePeriod'] == period
        assert config['ClockGHz'] == 1.6
        storer = store.get_storer('data')
        filters = str(storer.group.block0_values.filters)
        assert storer.format_type == 'fixed'
        with csv_path.open() as stream:
            header = next(csv.reader([next(stream)]))
            assert header == [''] + list(map(str, range(1, samples + 1)))
            assert next(stream).strip() == f'samplePeriod,{period:g}'
            count = 0
            for count, line in enumerate(stream, 1):
                name, raw = line.rstrip('\n').split(',', 1)
                assert name == names[count - 1]
                row = np.fromstring(raw, sep=',')
                assert row.size == samples
                assert np.array_equal(row, data.iloc[:, count - 1].to_numpy()), name
            assert count == len(names)
    return {'all_values_equal': True, 'compared_values': samples * len(names),
            'shape_samples_metrics': [samples, len(names)], 'dtype': 'float64',
            'format': 'fixed', 'filters': filters, 'config': config.to_dict(),
            'elapsed_s': time.perf_counter() - started}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--metrics', type=int, default=10000)
    parser.add_argument('--samples', type=int, default=10000)
    parser.add_argument('--period', type=float, default=100)
    parser.add_argument('--seed', type=int, default=20261109)
    args = parser.parse_args()
    if min(args.metrics, args.samples) <= 0 or not np.isfinite(args.period) or args.period <= 0:
        parser.error('counts and period must be positive and finite')
    output = validate_output_path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    with pd.HDFStore(args.reference, 'r') as store:
        all_names = store.get_storer('data').group.axis0.read().astype(str).tolist()
    if args.metrics > len(all_names):
        parser.error('reference contains fewer metric names than requested')
    indices = np.linspace(0, len(all_names) - 1, args.metrics, dtype=int)
    names = [all_names[i] for i in indices]
    assert len(set(names)) == len(names)
    stem = f'metrics_{args.metrics}_samples_{args.samples}'
    csv_path, h5_path = output / (stem + '.csv'), output / (stem + '.h5')
    report = {'kind': 'synthetic load fixture; not hardware results',
              'reference': str(args.reference.resolve()), 'reference_sha256': digest(args.reference),
              'metrics': args.metrics, 'samples': args.samples, 'seed': args.seed,
              'metric_name_selection': 'evenly spaced indices in reference axis0',
              'patterns': ['sparse random', 'periodic ramp with noise', 'steady with noise',
                           'bursts', 'uniform random'], 'quantum': 0.25}
    started = time.perf_counter()
    with csv_path.open('x', newline='') as stream:
        writer = csv.writer(stream, lineterminator='\n')
        writer.writerow([''] + list(range(1, args.samples + 1)))
        writer.writerow(['samplePeriod', f'{args.period:g}'])
        for i, name in enumerate(names):
            writer.writerow([name] + [f'{v:.2f}' for v in values_for(i, args.samples, args.seed)])
            if (i + 1) % 1000 == 0:
                print(f'CSV: {i + 1}/{args.metrics} metrics', flush=True)
    report['csv_generation_s'] = time.perf_counter() - started
    command = [sys.executable, '-B', '-m', 'scripts.csv2hdf', '-i', str(csv_path), '-o', str(h5_path)]
    report['conversion_command'] = command
    print('Converting with production scripts.csv2hdf', flush=True)
    started = time.perf_counter()
    with (output / 'conversion.log').open('x') as log:
        result = subprocess.run(['/usr/bin/time', '-v', *command], stdout=log, stderr=log)
    report['conversion_s'] = time.perf_counter() - started
    report['conversion_exit'] = result.returncode
    (output / 'generation.json').write_text(json.dumps(report, indent=2) + '\n')
    result.check_returncode()
    print('Comparing every CSV/H5 value', flush=True)
    report['verification'] = verify(csv_path, h5_path, names, args.samples, args.period)
    report['files'] = {p.suffix[1:]: {'path': str(p), 'bytes': p.stat().st_size, 'sha256': digest(p)}
                       for p in (csv_path, h5_path)}
    report['generator_verify_peak_rss_kib'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    (output / 'generation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
