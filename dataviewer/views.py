"""/usr/bin/env python3"""
# The confidential and proprietary information contained in this file may 
# only be used by a person authorized under and to the extent permitted   
# by a subsisting licensing agreement from computGeneral Limited.                 
#                 (c) Copyright 2024-2029 computGeneral Limited.                  
#                     ALL RIGHTS RESERVED                                 
# This entire notice must be reproduced on all copies of this file        
# and copies of this file may only be made by a person if such person is  
# permitted to do so under the terms of a subsisting license agreement    
# from computGeneral Limited.                                                     
# 
# Filename        : ./visualizer/dataviewer/views.py
# Last Revision   : 0.0.1
# Author          : gene@computGeneral.com

import json
import os
import io
import numpy as np
import pandas as pd
import tempfile

from dataviewer import gl
from django.conf import settings
from django.shortcuts import render, HttpResponse
from django.views.decorators.http import require_POST, require_GET


def page_admin(request):
    return render(request, 'admin.html')

def page_summaryviewer(request):
    return render(request, 'summaryviewer.html')

def page_metricviewer(request):
    return render(request, 'metricviewer.html')

def page_traceviewer(request):
    return render(request, 'traceviewer.html')

def page_crossviewer(request):
    return render(request, 'crossviewer.html')

#def page_traceviewerv2(request):
#    return render(request, 'traceviewerv2.html')

@require_POST
def api_show_upload(request):
    if 'file' not in request.FILES:
        return HttpResponse("No file part", status=400)
    file = request.FILES['file']
    secondary = request.POST.get('secondary', 'false').lower() == 'true'
    if not (file.name.endswith('.h5') or file.name.endswith('.csv')):
        return HttpResponse("File must be either HDF5(.h5) or CSV(.csv) format", status=400)
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.h5') as tmp_file:
            if file.name.endswith('.csv'):
                try:
                    firstline = file.readline().decode('utf-8')
                    columns = firstline.strip().split(',')[1:]
                    reader = pd.read_csv(file,
                                         index_col=0,
                                         header=None,
                                         na_filter=False,
                                         dtype={c: np.uint32 for c in columns},
                                         chunksize=5000,
                                         low_memory=False)
                    chunks = [chunk.T for chunk in reader]
                    df = pd.concat(chunks, axis=1).astype(int)
                    df = df.loc[:, ~df.columns.duplicated()]
                    with pd.HDFStore(tmp_file.name, mode='w', complevel=4, complib="blosc") as store:
                        store.put('data', df, data_columns=True)
                        store.put('config', pd.Series({'ClockGHz': 1.8, 'SamplePeriod': 100})) # FIXME
                except Exception as e:
                    return HttpResponse(f"Error processing CSV file: {str(e)}", status=500)
            else: # input is hdf5
                try:
                    for chunk in file.chunks():
                        tmp_file.write(chunk)
                    tmp_file.close()
                except Exception as e:
                    return HttpResponse(f"Error saving HDF5 file: {str(e)}", status=500)

            try:
                with pd.HDFStore(tmp_file.name, mode='r') as store:
                    now_data = store['data']
                    try:
                        now_config = store['config']
                    except KeyError:
                        now_config = pd.DataFrame()
                HttpResponse("File Process successfully", status=200)

            except Exception as e:
                return HttpResponse(f"Error reading HDF5 file: {str(e)}", status=500)
    except Exception as e:
        return HttpResponse(f"Error reading file: {str(e)}", status=500)

    #finally:
    #    if 'tmp_file' in locals() and os.path.exists(tmp_file.name):
    #        os.unlink(tmp_file.name)

    gl.clear(secondary=secondary)
    gl.set_value('title', file.name, secondary=secondary)
    gl.set_value('config', now_config, secondary=secondary)
    gl.set_value('data', now_data, secondary=secondary)
    #print(now_data.index.to_list())
    res = {
        'code': 0,
        'data': {
            'title': file.name,
            'config': now_config.to_dict(),
            'times': now_data.index.to_list(),
            'names': now_data.columns.to_list(),
            'signal': now_data.columns.to_list(),
        }
    }
    return HttpResponse(json.dumps(res), content_type='application/json')


# @require_GET
# def api_show_init(request):
#     res = {
#         'code': 0,
#     }

#     init_name = request.GET.get('name', '').strip()
#     if len(init_name) == 0:
#         init_name = 'perf_visualize_example.h5'
#     if '/' in init_name or '\\' in init_name:
#         file_path = init_name
#     else:
#         file_path = ''.join([
#             str(settings.BASE_DIR),
#             '/dataviewer/static/data/',
#             init_name,
#         ])
#     if os.path.exists(file_path):
#         gl.clear()
#         now_data = pd.read_hdf(file_path, 'data')
#         now_config = pd.read_hdf(file_path, 'config')
#         gl.set_value('title', init_name)
#         gl.set_value('config', now_config)
#         gl.set_value('data', now_data)
#         res['data'] = {
#             'title': init_name,
#             'config': now_config.to_dict(),
#             'times': now_data.index.to_list(),
#             'names': now_data.columns.to_list(),
#             'signal': now_data.columns.to_list(),
#         }
#     else:
#         res['code'] = 1
#         res['msg'] = 'Load metrics file failed'

#     return HttpResponse(json.dumps(res), content_type='application/json')


def get_query_data(query_list, secondary=False) -> dict:
    query_data = {}
    exist_obj = gl.get_all(secondary=secondary)['data']
    for key, sigs in query_list.items():
        query_data[key] = {k: v for k, v in sigs.items() if k != 'Sig'}
        query_data[key]['Sig'] = {}
        for sig in sigs['Sig']:
            if sig in exist_obj.columns:
                query_data[key]['Sig'][sig] = [float(v) for v in exist_obj.loc[:, sig].values]

    return query_data


@require_POST
def api_show_query(request):
    res = {
        'code': 0,
    }

    req_data = json.loads(request.body.decode())
    secondary = req_data.get('secondary', False)
    res['data'] = get_query_data(req_data['query'], secondary=secondary)

    return HttpResponse(json.dumps(res), content_type='application/json')


@require_POST
def api_temp_import(request):
    res = {
        'code': 0,
    }

    req_data = json.loads(request.body.decode())
    secondary = req_data.get('secondary', False)
    file_path = ''.join([
        str(settings.BASE_DIR),
        '/dataviewer/static/data/',
        req_data['import'],
        '.json',
    ])
    if os.path.exists(file_path):
        with open(file_path) as file_fb:
            json_data = json.loads(file_fb.read())
        file_fb.close()
        names = list(json_data.keys())
        for name in names:
            if name.startswith('#'):
                json_data.pop(name)
        res['data'] = get_query_data(json_data, secondary=secondary)
    else:
        res['code'] = 1
        res['msg'] = 'The metrics template file you specified is not existed'

    return HttpResponse(json.dumps(res), content_type='application/json')


@require_POST
def api_temp_export(request):
    res = {
        'code': 0,
    }

    req_data = json.loads(request.body.decode())
    file_path = ''.join([
        str(settings.BASE_DIR),
        '/dataviewer/static/data/',
        req_data['export'],
        '.json',
    ])
    with open(file_path, 'w+') as file_fb:
      file_fb.write(json.dumps(req_data['signal']))
    file_fb.close()

    res['data'] = 'ok'

    return HttpResponse(json.dumps(res), content_type='application/json')
