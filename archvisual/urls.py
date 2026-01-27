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
# Filename        : ./visualizer/archvisual/urls.py
# Last Revision   : 0.0.1
# Author          : gene@computGeneral.com


"""archvisual URL Configuration
The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/3.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path

import dataviewer.views


urlpatterns = [
    path('admin/', admin.site.urls),
    path(r'', dataviewer.views.page_admin),
    path('admin', dataviewer.views.page_admin),
    path('traceviewer', dataviewer.views.page_traceviewer),
    #path('traceviewerv2', dataviewer.views.page_traceviewerv2),
    path('metricviewer', dataviewer.views.page_metricviewer),
    path('summaryviewer', dataviewer.views.page_summaryviewer),
    path('crossviewer', dataviewer.views.page_crossviewer),
    path('api/show/upload', dataviewer.views.api_show_upload),
    # path('api/show/init', dataviewer.views.api_show_init),
    path('api/show/query', dataviewer.views.api_show_query),
    path('api/temp/import', dataviewer.views.api_temp_import),
    path('api/temp/export', dataviewer.views.api_temp_export),
]
