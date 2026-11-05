"""Exercise CSV conversion through the scripts directory from another cwd."""
import json
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from scripts import paths
from scripts.metric_csv import read_metric_csv


class ConversionScriptTests(unittest.TestCase):
    def setUp(self):
        output = paths.output_root() / 'conversion-tests'
        output.mkdir(parents=True, exist_ok=True)
        self.case_dir = tempfile.TemporaryDirectory(prefix='csv_conversion_', dir=output)
        self.addCleanup(self.case_dir.cleanup)
        self.case = Path(self.case_dir.name)
        self.csv = self.case / 'metrics.csv'
        self.csv.write_text('Sample,0,100\ntraffic_bytes,10,20\nactive_cycles,1,2\n')

    def run_script(self, name, *arguments):
        script = Path(__file__).resolve().parent / name
        result = subprocess.run([sys.executable, '-B', str(script), *map(str, arguments)],
                                cwd=self.case, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_csv_to_hdf_preserves_metric_samples(self):
        output = self.case / 'metrics.h5'
        self.run_script('csv2hdf.py', '-i', self.csv, '-o', output)
        data = pd.read_hdf(output, 'data')
        self.assertEqual(list(data.index), ['0', '100'])
        self.assertEqual(list(data.columns), ['traffic_bytes', 'active_cycles'])
        self.assertEqual(data['traffic_bytes'].tolist(), [10, 20])
        self.assertEqual(data['active_cycles'].tolist(), [1, 2])
        self.assertNotIn('SamplePeriod', pd.read_hdf(output, 'config'))

    def test_csv_to_hdf_records_period_without_changing_samples(self):
        self.csv.write_text('sample,100,200,300\nsamplePeriod,100\ntraffic_bytes,1.5,0,-2.25\n')
        output = self.case / 'with-period.h5'
        self.run_script('csv2hdf.py', '-i', self.csv, '-o', output)
        data = pd.read_hdf(output, 'data')
        self.assertEqual(list(data.index), ['100', '200', '300'])
        self.assertEqual(list(data.columns), ['traffic_bytes'])
        self.assertEqual(data['traffic_bytes'].tolist(), [1.5, 0, -2.25])
        self.assertEqual(pd.read_hdf(output, 'config')['SamplePeriod'], 100)

    def test_csv_without_header_keeps_first_metric_and_has_no_period(self):
        self.csv.write_text('traffic_bytes,1.5,2.25\nactive_cycles,1,2\n')
        output = self.case / 'headerless.h5'
        self.run_script('csv2hdf.py', '-i', self.csv, '-o', output)
        data = pd.read_hdf(output, 'data')
        self.assertEqual(list(data.index), [0, 1])
        self.assertEqual(list(data.columns), ['traffic_bytes', 'active_cycles'])
        self.assertEqual(data['traffic_bytes'].tolist(), [1.5, 2.25])
        self.assertNotIn('SamplePeriod', pd.read_hdf(output, 'config'))

    def test_period_row_is_metadata_regardless_of_position_case_or_padding(self):
        for body in [
            '\ufeff SamplePeriod ,12.5,,\nSample,0,1\n"port, traffic",1,2\n',
            'Samples,0,1\n"port, traffic",1,2\nSAMPLEPERIOD,12.5\n',
            ',0,1\nsamplePeriod,12.5,\n"port, traffic",1,2\n',
            'samplePeriod,12.5\n"port, traffic",1,2\n',
        ]:
            with self.subTest(body=body):
                stream = io.BytesIO(body.encode('utf-8'))
                data, config = read_metric_csv(stream)
                self.assertFalse(stream.closed)
                self.assertEqual(config, {'SamplePeriod': 12.5})
                self.assertEqual(list(data.columns), ['port, traffic'])
                self.assertEqual(data['port, traffic'].tolist(), [1, 2])

    def test_invalid_or_duplicate_period_is_rejected(self):
        for row in ['samplePeriod,', 'samplePeriod,0', 'samplePeriod,-100',
                    'samplePeriod,nan', 'samplePeriod,inf', 'samplePeriod,abc',
                    'samplePeriod,100,200', 'samplePeriod,100\nsamplePeriod,100']:
            with self.subTest(row=row), self.assertRaisesRegex(ValueError, 'samplePeriod'):
                read_metric_csv(io.BytesIO(('Sample,0,1\n' + row + '\nport,1,2\n').encode()))

    def test_csv_to_json_preserves_metric_samples(self):
        output = self.case / 'metrics.json'
        self.run_script('csv2json.py', self.csv, '-o', output, '--bin-us', '2')
        events = json.loads(output.read_text())['traceEvents']
        self.assertEqual([(event['name'], event['ts'], event['args']['value']) for event in events],
                         [('traffic_bytes', 0.0, 10), ('traffic_bytes', 2.0, 20),
                          ('active_cycles', 0.0, 1), ('active_cycles', 2.0, 2)])


if __name__ == '__main__':
    unittest.main()
