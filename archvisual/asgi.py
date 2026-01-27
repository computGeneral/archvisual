""/usr/bin/env python3"""
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
# Filename        : ./visualizer/archvisual/asgi.py
# Last Revision   : 0.0.1
# Author          : gene@computGeneral.com
"""
ASGI config for archvisual project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/3.2/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'archvisual.settings')

application = get_asgi_application()
