#!/usr/bin/env python3
"""Isolated, instrumented production Django server for metric load measurements.

This entry point only adds timers/RSS sampling in its own process. It changes no
production files, data schemas or view behavior. Linux /proc supplies memory
measurements without additional dependencies. Start with:
python3 -B -m scripts.benchmark_metric_load --output /path/to/new-run --port 18149
Then run benchmark_metric_load.cjs against that loopback address.
"""
import argparse
import functools
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import threading
import time
import urllib.request

from scripts.paths import validate_output_path


def memory():
    values = {}
    for line in Path('/proc/self/status').read_text().splitlines():
        if line.startswith(('VmRSS:', 'VmHWM:')):
            key, value, _ = line.split()
            values[key.rstrip(':') + '_kib'] = int(value)
    return values


def browser_tree_rss(pid):
    """Sum child RSS, including shared pages; this is not unique physical RAM."""
    total = 0
    pending = [pid]
    while pending:
        child = pending.pop()
        try:
            status = Path(f'/proc/{child}/status').read_text()
            total += next(int(line.split()[1]) for line in status.splitlines() if line.startswith('VmRSS:'))
            pending.extend(map(int, Path(f'/proc/{child}/task/{child}/children').read_text().split()))
        except (OSError, StopIteration):
            pass
    return total


def run_suite(manifest, output, port):
    """Run cases serially, with a fresh server/browser for each file and route."""
    output = validate_output_path(output)
    output.mkdir(parents=True, exist_ok=False)
    cases = json.loads(manifest.read_text())
    summary = []
    for case in cases:
        name = case['name']
        if Path(name).name != name or name in ('.', '..'):
            raise ValueError('case name must be a single path component')
        directory = output / name
        directory.mkdir()
        server_command = [sys.executable, '-B', '-m', 'scripts.benchmark_metric_load',
                          '--output', str(directory / 'server'), '--port', str(port)]
        browser_command = ['node', str(Path(__file__).with_suffix('.cjs')),
                           f'http://127.0.0.1:{port}', case['file'], case['kind'], str(directory / 'browser')]
        record = {**case, 'server_command': server_command, 'browser_command': browser_command}
        print(f'Starting {name}', flush=True)
        server = browser = None
        try:
            with (directory / 'server.log').open('x') as log:
                server = subprocess.Popen(server_command, stdout=log, stderr=log)
            for _ in range(100):
                if server.poll() is not None:
                    raise RuntimeError('benchmark server exited; see server.log')
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/__metric_benchmark_health', timeout=1) as response:
                        identity = json.load(response)
                        if identity.get('pid') != server.pid:
                            raise RuntimeError('port belongs to another benchmark server')
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError('benchmark server did not become ready')
            # Ensure we did not accidentally connect to another service on the port.
            runtime = json.loads((directory / 'server/runtime.json').read_text())
            assert runtime['pid'] == server.pid and server.poll() is None
            started = time.perf_counter()
            with (directory / 'browser.log').open('x') as log:
                browser = subprocess.Popen(browser_command, stdout=log, stderr=log)
            peak = 0
            while browser.poll() is None:
                peak = max(peak, browser_tree_rss(browser.pid))
                if time.perf_counter() - started > 1800:
                    raise TimeoutError('case exceeded 30 minute budget')
                time.sleep(0.1)
            record.update(browser_exit=browser.returncode, elapsed_s=time.perf_counter() - started,
                          node_chrome_tree_peak_rss_kib=peak, rss_sample_interval_ms=100,
                          rss_note='Sum of process RSS includes shared pages; not unique physical memory')
            if browser.returncode:
                raise RuntimeError('browser measurement failed; see browser.log')
            record['status'] = 'PASS'
        except BaseException as exc:
            record.update(status='FAIL', failure=str(exc))
            raise
        finally:
            for process in (browser, server):
                if process is not None and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            record['processes_stopped'] = all(p is None or p.poll() is not None for p in (browser, server))
            # Production retains temporary H5 copies. Remove only this stopped
            # benchmark process's copies; retain sizes and all measurement logs.
            copies = []
            for subdir in ('tmp', 'multipart'):
                for path in (directory / 'server' / subdir).glob('*'):
                    if path.is_file():
                        copies.append({'path': str(path), 'bytes': path.stat().st_size})
                        path.unlink()
            record['removed_benchmark_temporary_copies'] = copies
            summary.append(record)
            (output / 'suite.json').write_text(json.dumps(summary, indent=2) + '\n')
        print(f'Finished {name}: {record["elapsed_s"]:.2f}s', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--port', type=int, default=18149)
    parser.add_argument('--suite', type=Path, help='JSON list of {name,file,kind}; serial fresh-process cases')
    args = parser.parse_args()
    if args.suite:
        run_suite(args.suite, args.output, args.port)
        return
    output = validate_output_path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    os.environ['DJANGO_SETTINGS_MODULE'] = 'visualizer.settings'
    os.environ['ARCHVISUAL_OUTPUT_ROOT'] = str(output)
    os.environ['ARCHVISUAL_TEMP_ROOT'] = str(output / 'tmp')
    # Django's upload handler and the application's copy both stay in this run.
    (output / 'multipart').mkdir()
    import django
    import numpy as np
    import pandas as pd
    import tables
    from django.conf import settings
    settings.FILE_UPLOAD_TEMP_DIR = str(output / 'multipart')
    django.setup()
    from dataviewer import views
    from django.http.multipartparser import MultiPartParser
    from django.contrib.staticfiles.handlers import StaticFilesHandler
    from django.core.wsgi import get_wsgi_application
    from django.core.servers.basehttp import run

    current = None

    def instrument(obj, attr, name):
        original = getattr(obj, attr)

        @functools.wraps(original)
        def timed(*a, **kw):
            if current is None:
                return original(*a, **kw)
            start = time.perf_counter()
            try:
                return original(*a, **kw)
            finally:
                elapsed = (time.perf_counter() - start) * 1000
                phase = name(*a, **kw) if callable(name) else name
                current['phases_ms'][phase] = current['phases_ms'].get(phase, 0) + elapsed
        setattr(obj, attr, timed)

    instrument(pd.HDFStore, '__getitem__', lambda self, key: 'hdf_read_' + key.strip('/'))
    instrument(pd.HDFStore, 'put', lambda self, key, *a, **kw: 'hdf_write_' + key.strip('/'))
    instrument(views, 'read_metric_csv', 'csv_parse')
    instrument(views, '_loaded_response', 'metadata_response')
    instrument(views, 'get_query_data', 'query_values')
    instrument(MultiPartParser, 'parse', 'multipart_parse')
    application = StaticFilesHandler(get_wsgi_application())
    count = 0

    def measured(environ, start_response):
        nonlocal current, count
        if environ['PATH_INFO'] == '/__metric_benchmark_health':
            body = json.dumps({'pid': os.getpid()}).encode()
            start_response('200 OK', [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
            yield body
            return
        if not environ['PATH_INFO'].startswith('/api/show/'):
            yield from application(environ, start_response)
            return
        count += 1
        record = {'id': count, 'path': environ['PATH_INFO'], 'phases_ms': {},
                  'request_bytes': int(environ.get('CONTENT_LENGTH') or 0),
                  'memory_start': memory(), 'rss_sample_interval_ms': 20}
        current = record
        peak = [record['memory_start']['VmRSS_kib']]
        stop = threading.Event()

        def sample():
            while not stop.wait(0.020):
                peak[0] = max(peak[0], memory()['VmRSS_kib'])

        thread = threading.Thread(target=sample, daemon=True)
        thread.start()
        started = time.perf_counter()

        def response(status, headers, exc_info=None):
            record['status'] = status
            record['backend_ms'] = (time.perf_counter() - started) * 1000
            timing = {'backend': record['backend_ms'], **record['phases_ms']}
            headers += [('Server-Timing', ', '.join(f'{k};dur={v:.3f}' for k, v in timing.items())),
                        ('X-Benchmark-Request', str(count))]
            return start_response(status, headers, exc_info)

        iterable = None
        try:
            iterable = application(environ, response)
            record['response_bytes'] = 0
            for chunk in iterable:
                record['response_bytes'] += len(chunk)
                yield chunk
        finally:
            if iterable is not None and hasattr(iterable, 'close'):
                iterable.close()
            record['through_send_ms'] = (time.perf_counter() - started) * 1000
            stop.set()
            thread.join()
            record['memory_end'] = memory()
            record['sampled_peak_rss_kib'] = max(peak[0], record['memory_end']['VmRSS_kib'])
            current = None
            with (output / 'backend.jsonl').open('a') as stream:
                stream.write(json.dumps(record) + '\n')

    (output / 'runtime.json').write_text(json.dumps({
        'pid': os.getpid(), 'python': sys.version, 'executable': sys.executable,
        'platform': platform.platform(), 'port': args.port,
        'versions': {'django': django.__version__, 'numpy': np.__version__,
                     'pandas': pd.__version__, 'tables': tables.__version__},
        'server': 'single-thread Django WSGI server with static handler; production views',
        'memory_note': 'RSS sampled each 20 ms; VmHWM is process lifetime; shared pages included',
        'cache_note': 'OS page cache is not dropped; first request is not a cold-disk claim',
        'timing_note': 'phase timers may nest; do not sum metadata_response and query_values',
    }, indent=2) + '\n')
    print(f'Benchmark server PID {os.getpid()} at http://127.0.0.1:{args.port}', flush=True)
    run('127.0.0.1', args.port, measured, threading=False)


if __name__ == '__main__':
    main()
