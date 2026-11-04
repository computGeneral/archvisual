"""Exercise CSV conversion through the scripts directory from another cwd."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from scripts import archvisual_env as environment


class ConversionScriptTests(unittest.TestCase):
    def setUp(self):
        output = environment.output_root() / 'conversion-tests'
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

    def test_csv_to_json_preserves_metric_samples(self):
        output = self.case / 'metrics.json'
        self.run_script('csv2json.py', self.csv, '-o', output, '--bin-us', '2')
        events = json.loads(output.read_text())['traceEvents']
        self.assertEqual([(event['name'], event['ts'], event['args']['value']) for event in events],
                         [('traffic_bytes', 0.0, 10), ('traffic_bytes', 2.0, 20),
                          ('active_cycles', 0.0, 1), ('active_cycles', 2.0, 2)])


if __name__ == '__main__':
    unittest.main()
