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
# Filename        : ./visualizer/dataviewer/globalvar.py
# Last Revision   : 0.0.1
# Author          : gene@computGeneral.com


# -*- coding:utf-8 -*-

__my_show = {}
__my_show_secondary = {}

def set_value(key, value, secondary=False):
    if secondary:
        __my_show_secondary[key] = value
    else:
        __my_show[key] = value


def get_all(secondary=False):
    if secondary:
        return __my_show_secondary
    return __my_show


def clear(secondary=False):
    if secondary:
        __my_show_secondary.clear()
    else:
        __my_show.clear()
