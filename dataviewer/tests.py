"""/usr/bin/env python3"""
# The confidential and proprietary information contained in this file may 
# only be used by a person authorized under and to the extent permitted   
# by a subsisting licensing agreement from computGene@gmail.com.                 
#                 (c) Copyright 2024-2029 computGene@gmail.com.                  
#                     ALL RIGHTS RESERVED                                 
# This entire notice must be reproduced on all copies of this file        
# and copies of this file may only be made by a person if such person is  
# permitted to do so under the terms of a subsisting license agreement    
# from computGene@gmail.com.                                                     
# 
# Filename        : ./visualizer/dataviewer/tests.py
# Last Revision   : 0.0.1
# Author          : gene@computGeneral.com


import json
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from dataviewer import gl


class HeatQueryTests(SimpleTestCase):
    def setUp(self):
        gl.clear()
        gl.clear(secondary=True)
        Path(settings.ARCHVISUAL_TEMP_ROOT).mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=settings.ARCHVISUAL_TEMP_ROOT)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(gl.clear)
        self.addCleanup(lambda: gl.clear(secondary=True))

    def write_h5(self, frame, name='metrics.h5'):
        path = Path(self.temp.name) / name
        with pd.HDFStore(path, mode='w') as store:
            store.put('data', frame)
            store.put('config', pd.Series({'ClockGHz': 1.6, 'SamplePeriod': 100}))
        return path

    def post(self, endpoint, payload):
        return self.client.post(endpoint, json.dumps(payload), content_type='application/json')

    def query(self, names, **extra):
        return self.post('/api/show/query', dict(
            query={'ports': {'Max': 'dataMax', 'Stack': False, 'Sig': names}}, mode='heat', **extra))

    def test_server_h5_preserves_sample_order_names_and_values(self):
        frame = pd.DataFrame({'soc.port0.traffic': [7.5, 0, -3], 'soc.port1.traffic': [2, 8, 1]},
                             index=['sample-9', 'sample-2', 'sample-7'])
        path = self.write_h5(frame)
        meta = self.post('/api/show/server_load', {'path': str(path)}).json()['data']
        self.assertEqual(meta['times'], frame.index.tolist())
        self.assertEqual(meta['signal'], frame.columns.tolist())
        self.assertEqual(meta['config']['SamplePeriod'], 100)
        response = self.query(['soc.port1.traffic', 'soc.port0.traffic'])
        self.assertEqual(response.status_code, 200)
        sig = response.json()['data']['ports']['Sig']
        self.assertEqual(list(sig), ['soc.port1.traffic', 'soc.port0.traffic'])
        self.assertEqual(sig['soc.port0.traffic'], [7.5, 0, -3])
        self.assertEqual(sig['soc.port1.traffic'], [2, 8, 1])

    def test_upload_and_secondary_dataset_are_independent(self):
        primary = pd.DataFrame({'port': [1, 2]})
        secondary = pd.DataFrame({'port': [10, 20]})
        self.post('/api/show/server_load', {'path': str(self.write_h5(primary))})
        path = self.write_h5(secondary, 'secondary.h5')
        response = self.client.post('/api/show/upload', {
            'file': SimpleUploadedFile('secondary.h5', path.read_bytes()), 'secondary': 'true'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.query(['port']).json()['data']['ports']['Sig']['port'], [1, 2])
        self.assertEqual(self.query(['port'], secondary=True).json()['data']['ports']['Sig']['port'], [10, 20])

    def test_nonfinite_values_are_json_null_and_zero_remains_zero(self):
        gl.set_value('data', pd.DataFrame({'port': [0, np.nan, np.inf, -np.inf, 1.25]}))
        response = self.query(['port'])
        self.assertNotIn(b'NaN', response.content)
        self.assertNotIn(b'Infinity', response.content)
        self.assertEqual(response.json()['data']['ports']['Sig']['port'], [0, None, None, None, 1.25])

    def test_missing_metric_reports_error_instead_of_partial_result(self):
        gl.set_value('data', pd.DataFrame({'present': [3]}))
        response = self.query(['present', 'absent'])
        self.assertEqual(response.status_code, 400)
        self.assertIn('absent', response.json()['msg'])

    def test_non_numeric_and_complex_metrics_report_error(self):
        for values in [['abc'], ['1.5'], [1 + 2j]]:
            with self.subTest(values=values):
                gl.set_value('data', pd.DataFrame({'port': values}))
                response = self.query(['port'])
                self.assertEqual(response.status_code, 400)
                self.assertIn('real numeric', response.json()['msg'])

    def test_duplicate_metric_columns_report_error(self):
        gl.set_value('data', pd.DataFrame([[1, 2]], columns=['port', 'port']))
        self.assertEqual(self.query(['port']).status_code, 400)

    def test_no_file_and_invalid_group_report_errors(self):
        self.assertEqual(self.query(['port']).status_code, 400)
        gl.set_value('data', pd.DataFrame({'port': [1]}))
        for query in [[], {'ports': {}}, {'ports': {'Sig': 'port'}}, {'ports': {'Sig': [1]}}]:
            with self.subTest(query=query):
                response = self.post('/api/show/query', {'mode': 'heat', 'query': query})
                self.assertEqual(response.status_code, 400)

    def test_reload_uses_new_values_and_sample_count(self):
        for values in [[1, 2, 3], [7]]:
            path = self.write_h5(pd.DataFrame({'port': values}))
            self.post('/api/show/server_load', {'path': str(path)})
            self.assertEqual(self.query(['port']).json()['data']['ports']['Sig']['port'], values)

    def test_legacy_line_query_keeps_response_structure(self):
        gl.set_value('data', pd.DataFrame({'port': [0, 5]}))
        response = self.post('/api/show/query', {'query': {'g': {'Max': 10, 'Stack': False, 'Sig': ['port']}}})
        self.assertEqual(response.json(), {'code': 0, 'data': {
            'g': {'Max': 10, 'Stack': False, 'Sig': {'port': [0.0, 5.0]}}}})

    def test_invalid_json_and_missing_query_are_client_errors(self):
        for payload in ['{', '[]', '{}']:
            response = self.client.post('/api/show/query', payload, content_type='application/json')
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()['code'], 1)

    def test_heat_template_import_uses_the_same_numeric_validation(self):
        folder = Path(self.temp.name) / 'dataviewer' / 'static' / 'data'
        folder.mkdir(parents=True)
        (folder / 'ports.json').write_text(json.dumps({'g': {'Sig': ['port']}}))
        gl.set_value('data', pd.DataFrame({'port': [0, np.nan]}))
        with self.settings(BASE_DIR=Path(self.temp.name)):
            response = self.post('/api/temp/import', {'import': 'ports', 'mode': 'heat'})
        self.assertEqual(response.json()['data']['g']['Sig']['port'], [0, None])
