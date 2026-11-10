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
from unittest import mock
import weakref

import numpy as np
import pandas as pd
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile, TemporaryUploadedFile
from django.test import RequestFactory, SimpleTestCase

from dataviewer import gl, views
from scripts import metric_hdf


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
            store.put('data', frame, format='table' if not frame.columns.is_unique else 'fixed')
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

    def test_reload_returns_values_missing_placeholders_and_resolved_source(self):
        path = self.write_h5(pd.DataFrame({'port': [7, 9]}))
        query = {'first': {'Max': 30, 'Stack': True, 'Sig': ['gone', 'port']},
                 'second': {'Sig': ['port'], 'Heat': {'color': 'row'}}}
        response = self.post('/api/show/server_load', {
            'path': str(path), 'reloadQuery': query}).json()
        self.assertEqual(response['data']['source'], {'kind': 'server', 'path': str(path)})
        self.assertEqual(response['missing'], ['gone'])
        self.assertEqual(response['reload']['first'], {
            'Max': 30, 'Stack': True, 'Sig': {'gone': [None, None], 'port': [7, 9]}})
        self.assertEqual(response['reload']['second']['Heat'], {'color': 'row'})
        self.assertEqual(response['reload']['second']['Sig']['port'], [7, 9])

    def test_csv_local_reload_updates_only_its_panel(self):
        self.load_csv('server', 'port,1,2\n')
        response = self.client.post('/api/show/upload', {
            'file': SimpleUploadedFile('local.csv', b'sample,100,200\nsamplePeriod,100\nport,8,9\n'),
            'secondary': 'true', 'reloadQuery': json.dumps({'g': {'Sig': ['port']}})}).json()
        self.assertEqual(response['data']['source'], {'kind': 'local', 'name': 'local.csv'})
        self.assertEqual(response['reload']['g']['Sig']['port'], [8, 9])
        self.assertEqual(response['data']['config']['SamplePeriod'], 100)
        self.assertEqual(self.query(['port']).json()['data']['ports']['Sig']['port'], [1, 2])
        self.assertEqual(self.query(['port'], secondary=True).json()['data']['ports']['Sig']['port'], [8, 9])

    def test_failed_reload_validation_keeps_previous_backend_data(self):
        self.load_csv('server', 'port,1,2\n')
        for frame in [pd.DataFrame({'port': ['abc']}),
                      pd.DataFrame([[1, 2]], columns=['port', 'port'])]:
            path = self.write_h5(frame)
            for method in ['server', 'upload']:
                with self.subTest(frame=str(frame), method=method):
                    query = {'g': {'Sig': ['port']}}
                    if method == 'server':
                        response = self.post('/api/show/server_load', {'path': str(path), 'reloadQuery': query})
                    else:
                        response = self.client.post('/api/show/upload', {
                            'file': SimpleUploadedFile(path.name, path.read_bytes()), 'reloadQuery': json.dumps(query)})
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.json()['code'], 1)
                    self.assertEqual(self.query(['port']).json()['data']['ports']['Sig']['port'], [1, 2])

    def test_reload_empty_plot_and_invalid_query(self):
        path = self.write_h5(pd.DataFrame({'port': [7]}))
        self.assertEqual(self.post('/api/show/server_load', {
            'path': str(path), 'reloadQuery': {}}).json()['reload'], {})
        for query in ['{', [], {'g': {'Sig': 'port'}}]:
            response = self.post('/api/show/server_load', {'path': str(path), 'reloadQuery': query})
            self.assertEqual(response.status_code, 400)

    def test_reload_relative_server_source_is_absolute(self):
        folder = Path(self.temp.name) / 'dataviewer' / 'static' / 'data'
        folder.mkdir(parents=True)
        (folder / 'metrics.csv').write_text('port,1,2\n')
        with self.settings(BASE_DIR=Path(self.temp.name)):
            response = self.post('/api/show/server_load', {'path': 'metrics.csv'}).json()
        self.assertEqual(response['data']['source']['path'], str(folder / 'metrics.csv'))

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

    def load_csv(self, method, content, secondary=False):
        if method == 'upload':
            return self.client.post('/api/show/upload', {
                'file': SimpleUploadedFile('metrics.csv', content.encode('utf-8')),
                'secondary': str(secondary).lower()})
        path = Path(self.temp.name) / 'metrics.csv'
        path.write_text(content)
        return self.post('/api/show/server_load', {'path': str(path), 'secondary': secondary})

    def test_csv_upload_and_server_load_agree_on_metadata_axis_and_raw_values(self):
        body = 'sample,100,200,300\nsamplePeriod,100\ntraffic_bytes,1.5,0,-2.25\n'
        for method in ['upload', 'server']:
            with self.subTest(method=method):
                response = self.load_csv(method, body)
                self.assertEqual(response.status_code, 200)
                meta = response.json()['data']
                self.assertEqual(meta['config']['SamplePeriod'], 100)
                self.assertEqual(meta['times'], ['100', '200', '300'])
                self.assertEqual(meta['signal'], ['traffic_bytes'])
                self.assertEqual(self.query(['traffic_bytes']).json()['data']['ports']['Sig'],
                                 {'traffic_bytes': [1.5, 0, -2.25]})

    def test_csv_reload_does_not_infer_or_retain_a_period(self):
        for method in ['upload', 'server']:
            for header in ['sample,100,200,300\n', '']:
                with self.subTest(method=method, header=header):
                    self.load_csv(method, 'sample,0,1\nsamplePeriod,200\nport,1,2\n')
                    response = self.load_csv(method, header + 'port,1,2,3\nsecond,4,5,6\n')
                    meta = response.json()['data']
                    self.assertNotIn('SamplePeriod', meta['config'])
                    self.assertEqual(meta['signal'], ['port', 'second'])
                    self.assertEqual(meta['times'], ['100', '200', '300'] if header else [0, 1, 2])
                    self.assertEqual(self.query(['port']).json()['data']['ports']['Sig']['port'], [1, 2, 3])

    def test_csv_period_and_metric_values_remain_independent_per_panel(self):
        self.load_csv('server', 'sample,0,1\nsamplePeriod,100\nport,1,2\n')
        secondary = self.load_csv('upload', 'sample,0,1\nsamplePeriod,250\nport,3,4\n', True)
        self.assertEqual(secondary.json()['data']['config']['SamplePeriod'], 250)
        self.assertEqual(gl.get_all()['config']['SamplePeriod'], 100)
        self.assertEqual(self.query(['port']).json()['data']['ports']['Sig']['port'], [1, 2])
        self.assertEqual(self.query(['port'], secondary=True).json()['data']['ports']['Sig']['port'], [3, 4])

    def test_invalid_csv_period_does_not_replace_loaded_dataset(self):
        for method in ['upload', 'server']:
            with self.subTest(method=method):
                self.load_csv(method, 'sample,0,1\nsamplePeriod,100\nport,1,2\n')
                response = self.load_csv(method, 'sample,0,1\nsamplePeriod,invalid\nport,3,4\n')
                self.assertIn('samplePeriod', response.content.decode())
                self.assertEqual(gl.get_all()['config']['SamplePeriod'], 100)
                self.assertEqual(self.query(['port']).json()['data']['ports']['Sig']['port'], [1, 2])

    def test_h5_missing_period_stays_missing_for_upload_and_server_load(self):
        for config in [None, {'ClockGHz': 1.8}, {'interval': 100}]:
            for method in ['upload', 'server']:
                with self.subTest(config=config, method=method):
                    path = Path(self.temp.name) / 'without-period.h5'
                    with pd.HDFStore(path, mode='w') as store:
                        store.put('data', pd.DataFrame({'port': [1, 2]}, index=[100, 200]))
                        if config is not None:
                            store.put('config', pd.Series(config))
                    if method == 'upload':
                        response = self.client.post('/api/show/upload', {
                            'file': SimpleUploadedFile(path.name, path.read_bytes())})
                    else:
                        response = self.post('/api/show/server_load', {'path': str(path)})
                    self.assertEqual(response.status_code, 200)
                    self.assertNotIn('SamplePeriod', response.json()['data']['config'])


class H5UploadTests(SimpleTestCase):
    """Exercise both real Django upload handlers and temporary-file ownership."""

    def setUp(self):
        root = Path(settings.ARCHVISUAL_TEMP_ROOT)
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app_temp = self.root / 'app'
        self.multipart = self.root / 'multipart'
        self.app_temp.mkdir()
        self.multipart.mkdir()
        self.settings_override = self.settings(
            ARCHVISUAL_TEMP_ROOT=str(self.app_temp), FILE_UPLOAD_TEMP_DIR=str(self.multipart))
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        gl.clear()
        gl.clear(secondary=True)
        self.addCleanup(gl.clear)
        self.addCleanup(lambda: gl.clear(secondary=True))
        self.frame = pd.DataFrame({'port': [0.0, 7.5, -2.25], 'other': [3.0, 2.0, 1.0]},
                                  index=['last', 'first', 'middle'])
        self.config = pd.Series({'ClockGHz': 1.6, 'SamplePeriod': 100})

    def h5_bytes(self, *, frame=None, config=True, data=True):
        path = self.root / 'source.h5'
        with pd.HDFStore(path, mode='w') as store:
            if data:
                store.put('data', self.frame if frame is None else frame)
            if config:
                store.put('config', self.config)
        return path.read_bytes()

    def request(self, content, *, disk, **fields):
        # Keep the request open to verify the view borrows Django's path without
        # deleting it; request.close() remains the owner's cleanup operation.
        with self.settings(FILE_UPLOAD_MAX_MEMORY_SIZE=0 if disk else 10 * 1024 * 1024):
            request = RequestFactory().post('/api/show/upload', {
                'file': SimpleUploadedFile('metrics.h5', content), **fields})
            uploaded = request.FILES['file']
        self.assertEqual(isinstance(uploaded, TemporaryUploadedFile), disk)
        self.addCleanup(request.close)
        return request, uploaded

    def assert_empty_temp(self):
        self.assertEqual(list(self.app_temp.iterdir()), [])
        self.assertEqual(list(self.multipart.iterdir()), [])

    def test_disk_upload_borrows_path_without_copy_and_request_owns_cleanup(self):
        request, uploaded = self.request(self.h5_bytes(), disk=True)
        path = Path(uploaded.temporary_file_path())
        with mock.patch.object(uploaded, 'chunks', side_effect=AssertionError('unexpected copy')), \
                mock.patch.object(views, '_temporary_root', side_effect=AssertionError('unexpected app temp')):
            response = views.api_show_upload(request)
        self.assertEqual(response.status_code, 200, response.content)
        meta = json.loads(response.content)['data']
        self.assertEqual(meta['times'], self.frame.index.tolist())
        self.assertEqual(meta['signal'], self.frame.columns.tolist())
        self.assertEqual(meta['config'], self.config.to_dict())
        self.assertEqual(meta['source'], {'kind': 'local', 'name': 'metrics.h5'})
        pd.testing.assert_frame_equal(gl.get_all()['data'], self.frame)
        self.assertTrue(path.exists())
        self.assertFalse(uploaded.closed)
        request.close()
        self.assertFalse(path.exists())
        self.assert_empty_temp()

    def test_memory_upload_cleans_copy_and_loaded_values_survive_request_close(self):
        request, _ = self.request(self.h5_bytes(), disk=False)
        response = views.api_show_upload(request)
        self.assertEqual(response.status_code, 200, response.content)
        request.close()
        self.assert_empty_temp()
        pd.testing.assert_frame_equal(gl.get_all()['data'], self.frame)
        result = self.client.post('/api/show/query', json.dumps({
            'mode': 'heat', 'query': {'g': {'Sig': ['other', 'port']}}}),
            content_type='application/json').json()
        self.assertEqual(result['data']['g']['Sig'], {'other': [3, 2, 1], 'port': [0, 7.5, -2.25]})

    def test_real_multipart_response_closes_disk_upload_and_preserves_secondary(self):
        old = pd.DataFrame({'port': [99.0]})
        gl.set_value('data', old)
        with self.settings(FILE_UPLOAD_MAX_MEMORY_SIZE=0):
            response = self.client.post('/api/show/upload', {
                'file': SimpleUploadedFile('metrics.h5', self.h5_bytes()), 'secondary': 'true',
                'reloadQuery': json.dumps({'g': {'Sig': ['port', 'gone']}})})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.wsgi_request.FILES['file'].closed)
        self.assertIs(gl.get_all()['data'], old)
        pd.testing.assert_frame_equal(gl.get_all(secondary=True)['data'], self.frame)
        self.assertEqual(response.json()['reload']['g']['Sig'],
                         {'port': [0, 7.5, -2.25], 'gone': [None, None, None]})
        self.assertEqual(response.json()['missing'], ['gone'])
        self.assert_empty_temp()

    def test_failed_upload_or_reload_keeps_both_datasets_and_cleans_owned_files(self):
        cases = [
            (b'not HDF5', None, 500),
            (self.h5_bytes(data=False), None, 500),
            (self.h5_bytes(), '{', 400),
            (self.h5_bytes(frame=pd.DataFrame({'port': ['invalid']})),
             json.dumps({'g': {'Sig': ['port']}}), 400),
        ]
        for disk in [False, True]:
            for content, query, status in cases:
                with self.subTest(disk=disk, query=query, status=status):
                    previous = []
                    for panel in [False, True]:
                        old = {'data': pd.DataFrame({'port': [99.0]}), 'title': 'previous.h5',
                               'config': pd.Series({'SamplePeriod': 7})}
                        previous.append(old)
                        for key, value in old.items():
                            gl.set_value(key, value, secondary=panel)
                    fields = {'secondary': 'true'}
                    if query is not None:
                        fields['reloadQuery'] = query
                    request, uploaded = self.request(content, disk=disk, **fields)
                    response = views.api_show_upload(request)
                    self.assertEqual(response.status_code, status, response.content)
                    for panel in [False, True]:
                        for key, value in previous[panel].items():
                            self.assertIs(gl.get_all(secondary=panel)[key], value)
                    if disk:
                        self.assertTrue(Path(uploaded.temporary_file_path()).exists())
                    request.close()
                    self.assert_empty_temp()

    def test_partial_memory_copy_failure_cleans_temporary_file(self):
        request, uploaded = self.request(b'partial data', disk=False)
        old = pd.DataFrame({'port': [99.0]})
        gl.set_value('data', old)

        def broken_chunks():
            yield b'partial'
            raise OSError('copy interrupted')

        with mock.patch.object(uploaded, 'chunks', broken_chunks):
            response = views.api_show_upload(request)
        self.assertEqual(response.status_code, 500)
        self.assertIn(b'copy interrupted', response.content)
        self.assertIs(gl.get_all()['data'], old)
        request.close()
        self.assert_empty_temp()

    def test_missing_config_and_repeated_uploads_leave_no_temporary_files(self):
        content = self.h5_bytes(config=False)
        for disk in [False, True, True, False]:
            request, _ = self.request(content, disk=disk)
            response = views.api_show_upload(request)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(json.loads(response.content)['data']['config'], {})
            request.close()
            self.assert_empty_temp()
            pd.testing.assert_frame_equal(gl.get_all()['data'], self.frame)


class MetricHdfReaderTests(SimpleTestCase):
    def setUp(self):
        root = Path(settings.ARCHVISUAL_TEMP_ROOT)
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'metrics.h5'
        self.frame = pd.DataFrame(
            [[0.0, -0.0, np.nan], [1.25, np.inf, -np.inf], [-2.5, 9.0, 8.0], [3.0, 4.0, 5.0]],
            index=pd.Index(['末尾', 'first', 'first', '100'], name='采样'),
            columns=pd.Index(['流量', 'port, bytes', 'active'], name='metrics'))
        self.config = pd.Series({'ClockGHz': 1.6, 'SamplePeriod': 100}, name='config')

    def write(self, frame=None, *, format='fixed', compressed=True, config=True):
        with pd.HDFStore(self.path, mode='w', complevel=4 if compressed else 0, complib='blosc') as store:
            store.put('data', self.frame if frame is None else frame, format=format)
            if config:
                store.put('config', self.config)

    def compare(self, *, fast):
        with pd.HDFStore(self.path, mode='r') as store:
            expected = store['data']
            try:
                expected_config = store['config']
            except KeyError:
                expected_config = pd.DataFrame()
        calls, stores = [], []
        original = pd.HDFStore.__getitem__

        def get(store, key):
            calls.append(key)
            stores.append(store)
            return original(store, key)

        with mock.patch.object(pd.HDFStore, '__getitem__', get):
            actual, config = metric_hdf.read_metric_hdf(self.path)
        self.assertEqual('data' not in calls, fast, calls)
        self.assertTrue(stores and all(not store.is_open for store in stores))
        pd.testing.assert_frame_equal(actual, expected, check_exact=True)
        if isinstance(config, pd.Series):
            pd.testing.assert_series_equal(config, expected_config, check_exact=True)
        else:
            pd.testing.assert_frame_equal(config, expected_config, check_exact=True)
        if all(dtype == np.dtype('float64') for dtype in actual.dtypes):
            self.assertEqual(actual.to_numpy().tobytes(), expected.to_numpy().tobytes())
        return actual

    def test_fast_fixed_preserves_labels_names_order_and_float_bits(self):
        for compressed in [False, True]:
            for index in [self.frame.index, pd.Index([900, -2, -2, 100], name='SAMPLEs'),
                          pd.Index(np.array([9, 2, 2, 1], dtype='uint32')),
                          pd.Index(['', ' 100 ', 'NaN', 'sample-4'])]:
                with self.subTest(compressed=compressed, index=index):
                    self.write(self.frame.set_axis(index), compressed=compressed)
                    self.compare(fast=True)

    def test_fast_result_shares_read_array_and_survives_file_close_and_removal(self):
        import tables
        self.write()
        arrays = []
        original = tables.Array.read

        def read(node, *args, **kwargs):
            array = original(node, *args, **kwargs)
            if node._v_pathname == '/data/block0_values':
                arrays.append(weakref.ref(array))
            return array

        with mock.patch.object(tables.Array, 'read', read):
            result, _ = metric_hdf.read_metric_hdf(self.path)
        self.assertEqual(len(arrays), 1)
        self.assertIsNotNone(arrays[0]())
        self.assertTrue(np.shares_memory(result.to_numpy(copy=False), arrays[0]()))
        self.path.unlink()
        pd.testing.assert_frame_equal(result, self.frame, check_exact=True)
        self.assertEqual(result['流量'].tolist(), [0, 1.25, -2.5, 3])

    def test_fast_missing_config_and_copy_on_write_option(self):
        for enabled in [False, True]:
            with self.subTest(copy_on_write=enabled), pd.option_context('mode.copy_on_write', enabled):
                self.write(config=False)
                self.compare(fast=True)

    def test_other_dtypes_and_multiple_blocks_use_pandas(self):
        frames = [
            pd.DataFrame({'port': np.array([1, 2], dtype='float32')}),
            pd.DataFrame({'port': [1, 2]}),
            pd.DataFrame({'port': [True, False]}),
            pd.DataFrame({'port': [1 + 2j, 3 + 4j]}),
            pd.DataFrame({'port': ['text', 'value']}),
            pd.DataFrame({'port': pd.to_datetime(['2020-01-01', '2020-01-02'])}),
            pd.DataFrame({'traffic': [1.25, 2.5], 'count': [1, 2]}),
        ]
        for frame in frames:
            with self.subTest(dtypes=frame.dtypes.tolist()):
                self.write(frame)
                self.compare(fast=False)

    def test_table_format_and_empty_frames_use_pandas(self):
        self.write(format='table')
        self.compare(fast=False)
        for frame in [self.frame.iloc[:0], self.frame.iloc[:, :0], pd.DataFrame()]:
            with self.subTest(shape=frame.shape):
                self.write(frame)
                self.compare(fast=False)

    def test_special_sample_axes_use_pandas(self):
        indexes = [
            pd.MultiIndex.from_tuples([('a', 1), ('b', 2), ('a', 1), ('c', 4)]),
            pd.date_range('2020-01-01', periods=4, tz='UTC'),
            pd.timedelta_range('1 day', periods=4),
            pd.period_range('2020-01', periods=4, freq='M'),
            pd.Index([1.5, 2.5, 3.5, 4.5]), pd.Index([True, False, True, False]),
            pd.Index(['nan', 'a', 'b', 'c']),
            pd.Index([1, 2, 3, 4], name=('sample', 'axis')),
        ]
        for index in indexes:
            with self.subTest(index=index):
                self.write(self.frame.set_axis(index))
                self.compare(fast=False)

    def test_special_metric_axes_use_pandas(self):
        columns = [pd.Index([1, 2, 3]), pd.Index(['nan', 'b', 'c']),
                   pd.MultiIndex.from_tuples([('port', 1), ('port', 2), ('port', 3)]),
                   pd.Index(['a', 'b', 'c'], name=42)]
        for names in columns:
            with self.subTest(columns=names):
                self.write(self.frame.set_axis(names, axis=1))
                self.compare(fast=False)

    def test_unrecognized_metadata_uses_pandas_without_changing_values(self):
        for path, attribute, value in [('/data', 'future_metadata', 'extension'),
                                       ('/data/axis1', 'future_metadata', 42),
                                       ('/data/block0_values', 'future_metadata', 'extension')]:
            with self.subTest(path=path):
                self.write()
                with pd.HDFStore(self.path, mode='a') as store:
                    store.get_node(path)._v_attrs[attribute] = value
                self.compare(fast=False)

    def test_non_utf8_encoding_uses_pandas(self):
        frame = pd.DataFrame({'café': [1.5, 2.5]}, index=['début', 'fin'])
        with pd.HDFStore(self.path, mode='w') as store:
            store.put('data', frame, encoding='latin-1')
        self.compare(fast=False)

    def test_reordered_block_items_use_pandas_to_restore_column_order(self):
        self.write()
        with pd.HDFStore(self.path, mode='a') as store:
            items = store.get_node('/data/block0_items')
            items[:] = items.read()[::-1]
        self.compare(fast=False)

    def test_unsupported_value_orientation_uses_pandas(self):
        import tables
        self.write()
        with tables.open_file(self.path, mode='a') as handle:
            values = handle.get_node('/data/block0_values').read().T
            handle.remove_node('/data/block0_values')
            node = handle.create_array('/data', 'block0_values', values)
            node._v_attrs.transposed = False
        self.compare(fast=False)

    def test_missing_data_and_corrupt_file_raise_without_retaining_handles(self):
        with pd.HDFStore(self.path, mode='w') as store:
            store.put('config', self.config)
        with self.assertRaises(KeyError):
            metric_hdf.read_metric_hdf(self.path)
        self.path.write_bytes(b'not HDF5')
        with self.assertRaises(Exception):
            metric_hdf.read_metric_hdf(self.path)
        self.write()
        self.compare(fast=True)

    def test_fast_read_io_error_does_not_retry_or_replace_either_panel(self):
        import tables
        self.write()
        previous = [pd.DataFrame({'old': [1.0]}), pd.DataFrame({'other': [2.0]})]
        for secondary in [False, True]:
            gl.set_value('data', previous[secondary], secondary=secondary)
        self.addCleanup(gl.clear)
        self.addCleanup(lambda: gl.clear(secondary=True))
        original = tables.Array.read
        attempts = []

        def read(node, *args, **kwargs):
            if node._v_pathname == '/data/block0_values':
                attempts.append(node._v_pathname)
                raise OSError('injected H5 read failure')
            return original(node, *args, **kwargs)

        for method in ['server', 'upload']:
            with self.subTest(method=method), mock.patch.object(tables.Array, 'read', read), \
                    mock.patch.object(pd.HDFStore, '__getitem__', side_effect=AssertionError('unexpected retry')):
                if method == 'server':
                    response = self.client.post('/api/show/server_load', json.dumps({
                        'path': str(self.path), 'secondary': True}), content_type='application/json')
                    self.assertEqual(response.json()['code'], 1)
                else:
                    response = self.client.post('/api/show/upload', {
                        'file': SimpleUploadedFile('metrics.h5', self.path.read_bytes()), 'secondary': 'true'})
                    self.assertEqual(response.status_code, 500)
                self.assertIn(b'injected H5 read failure', response.content)
                for panel in [False, True]:
                    self.assertIs(gl.get_all(secondary=panel)['data'], previous[panel])
        self.assertEqual(len(attempts), 2)

    def test_fast_reload_validation_failure_retains_old_dataset(self):
        self.write()
        original = pd.DataFrame({'old': [99.0]})
        gl.set_value('data', original)
        self.addCleanup(gl.clear)
        response = self.client.post('/api/show/server_load', json.dumps({
            'path': str(self.path), 'reloadQuery': {'g': {'Sig': 'invalid'}}}),
            content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertIs(gl.get_all()['data'], original)
