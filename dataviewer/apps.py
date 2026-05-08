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
# Filename        : ./visualizer/dataviewer/apps.py
# Last Revision   : 0.0.1
# Author          : gene@computGeneral.com

from django.apps import AppConfig


class dataviewerConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'dataviewer'
