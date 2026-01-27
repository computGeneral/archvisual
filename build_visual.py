#!/usr/bin/env python3
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
# Filename        : ./perfsim/utils/build_perf.py
# Last Revision   : 0.0.1
# Author          : gene@computGeneral.com
# Note            :Nuitka build script for the perfsim project.

import os
import sys
import platform
import shutil
import subprocess
from pathlib import Path

import os
import sys
import shutil
import platform
import subprocess
from pathlib import Path

def collect_data_files(project_root=None):
    """Collect data files for inclusion in the build - Updated for Django"""
    data_files = []
    
    # Include Django static files
    static_dir = os.path.join(project_root, "static")
    if os.path.exists(static_dir):
        data_files.append((static_dir, "static"))
    
    # Include Django template files
    templates_dir = os.path.join(project_root, "templates")
    if os.path.exists(templates_dir):
        data_files.append((templates_dir, "templates"))
    
    # Include app-specific templates
    #for app in ["dataviewer", "app2"]:  # Add your app names here
    for app in ["dataviewer"]:  # Add your app names here
        app_static = os.path.join(project_root, app, "static")
        if os.path.exists(app_static):
            data_files.append((app_static, os.path.join(app, "static")))
        app_templates = os.path.join(project_root, app, "templates")
        if os.path.exists(app_templates):
            data_files.append((app_templates, os.path.join(app, "templates")))

    
    # Include Django configuration files
    django_configs = [
        (f'{project_root}/archvisual/settings.py', 'archvisual/settings.py'),
        (f'{project_root}/archvisual/urls.py',     'archvisual/urls.py'),
        (f'{project_root}/archvisual/wsgi.py',     'archvisual/wsgi.py'),
    ]
    data_files.extend(django_configs)
    
    return data_files

def check_python_source():
    """Check if we're using Apple Python on macOS"""
    if platform.system().lower() == 'darwin':
        # Check for signs of Apple Python
        apple_python_indicator = (
            'Python.framework/Versions' in sys.executable or 
            '/System/Library' in sys.executable or
            'Apple' in sys.version
        )
        
        if apple_python_indicator:
            print("\n" + "=" * 80)
            print("FATAL: You are using Apple's system Python which is not compatible with Nuitka")
            print("Solution: Please install Python from https://www.python.org/downloads/macos/")
            print("Then create a virtual environment with the downloaded Python:")
            print("   python3 -m venv venv")
            print("   source venv/bin/activate")
            print("   pip install -r requirements.txt")
            print("Then run this build script again.")
            print("=" * 80 + "\n")
            sys.exit(1)

def collect_static_files(entry_point):
    """Collect Django static files for production"""
    print("Collecting static files...")
    try:
        subprocess.check_call([sys.executable, f"{entry_point}", "collectstatic", "--noinput"])
        print("Static files collected successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Warning: Static file collection may have failed: {e}")

def get_platform_specifics():
    """Get platform-specific configuration"""
    system = platform.system().lower()
    if system == "windows":
        return {
            "exe_extension": ".exe",
            "icon_extension": ".ico"
        }
    elif system == "darwin":
        return {
            "exe_extension": "",
            "icon_extension": ".icns"
        }
    else:  # Linux
        return {
            "exe_extension": "",
            "icon_extension": ".ico"
        }

def build_executable():
    """Build executable using Nuitka - Updated for Django"""
    project_root = str(os.path.dirname(os.path.abspath(__file__)))
    platform_cfg = get_platform_specifics()
    
    app_name = "archvis"
    entry_point = f"{project_root}/archvisual.py"  # Django entry point
    dist_path = os.path.join(project_root, "_output_/archvisual/output/")
    build_path = os.path.join(project_root, "_output_/archvisual/build/")
    build_temp_dir = os.path.join(build_path, "temp")
    
    # Clean existing directories
    shutil.rmtree(dist_path, ignore_errors=True)
    shutil.rmtree(build_path, ignore_errors=True)
    os.makedirs(build_temp_dir, exist_ok=True)
    os.makedirs(dist_path, exist_ok=True)
    
    # Collect static files before building
    collect_static_files(entry_point)
    
    # Prepare Nuitka command
    cmd = [
        sys.executable,
        "-m", 
        "nuitka",
        "--standalone",
        "--assume-yes-for-downloads",
        f"--output-dir={build_temp_dir}",
        "--remove-output",  # Clean previous build artifacts

        # Django-specific plugins and settings
        #"--enable-plugin=pylint-wtf",  # Useful for Django
        "--include-package=django",
        "--include-package=archvisual",  # Your Django project
        "--include-package=dataviewer",  # Your Django apps
        # Add more apps as needed

        # Add these plugins for removing unused imports
        "--plugin-enable=anti-bloat",
    ]
    
    # Add data files for Django
    for src, dest in collect_data_files(project_root):
        if os.path.isdir(src):
            cmd.append(f"--include-data-dir={src}={dest}")
        else:
            cmd.append(f"--include-data-files={src}={dest}")
    
    # Add hidden imports for Django and common dependencies
    hidden_imports = [
        # Django core
        "django.core.management",
        "django.core.handlers.wsgi",
        "django.core.handlers.exception",
        "django.utils",
        "django.conf",
        "django.urls",
        "django.db",
        "django.db.models",
        "django.contrib.admin",
        "django.contrib.auth",
        "django.contrib.contenttypes",
        "django.contrib.sessions",
        "django.contrib.messages",
        "django.contrib.staticfiles",
        
        # Other common imports
        "re", "_sre", "sre_compile", "sre_constants", "sre_parse", "copyreg",
        "encodings", "encodings.utf_8", "encodings.latin_1",
        "collections", "functools", "itertools", 
        "logging", "enum", "argparse",
    ]
    for imp in hidden_imports:
        cmd.extend([f"--include-module={imp}"])
    
    # Add plugins
    cmd.extend([
        "--enable-plugin=implicit-imports",    # Handles indirect imports
        "--enable-plugin=pylint-warnings",
        "--enable-plugin=no-qt",
    ])
    
    # Platform-specific options
    system = platform.system().lower()
    icon_path = f"{project_root}/dataviewer/static/image/visualizer{platform_cfg['icon_extension']}"  # Update path as needed
    
    if system == "windows":
        if os.path.exists(icon_path):
            cmd.extend(["--windows-icon-from-ico", icon_path])
        cmd.extend(["--windows-disable-console"])  # Optional: remove console window
    elif system == "darwin":
        cmd.extend([
            "--static-libpython=no",
            "--macos-target-arch=arm64",
            "--macos-create-app-bundle",
            f"--macos-app-name={app_name}"
        ])
    else:  # Linux
        if os.path.exists(icon_path):
            cmd.extend([f"--linux-icon={icon_path}"])
    
    # Final arguments
    cmd.extend([
        f"--output-filename={app_name}{platform_cfg['exe_extension']}",
        "--show-progress",
        "--show-modules",
    ])
    
    cmd.append(os.path.join(project_root, entry_point))
    
    # Execute Nuitka build
    try:
        print("Starting Nuitka build...")
        print("Command:", " ".join(cmd))
        subprocess.check_call(cmd, cwd=project_root)
    except subprocess.CalledProcessError as e:
        print(f"Build failed with error: {e}")
        return
    
    # Move and organize build artifacts
    entry_point_name = os.path.splitext(os.path.basename(entry_point))[0]
    source_dir = os.path.join(build_temp_dir, f"{entry_point_name}.dist")
    if platform.system().lower() == "darwin":
        source_dir = os.path.join(build_temp_dir, f"{entry_point_name}.app/Contents/MacOS")
    target_dir = os.path.join(dist_path, app_name)
    
    if os.path.exists(source_dir):
        shutil.rmtree(target_dir, ignore_errors=True)
        shutil.move(source_dir, target_dir)
        print(source_dir, "->", target_dir)
        print(f"Build successful! Output in: {target_dir}")
        
        # Create a simple run script
        run_script_content = """#!/bin/bash
# Run the Django application
cd "$(dirname "$0")"
./archvis runserver 0.0.0.0:8000
"""
        with open(os.path.join(target_dir, "run_archvis.sh"), "w") as f:
            f.write(run_script_content)
        
        # On Windows, create a batch file too
        if platform.system().lower() == "windows":
            batch_content = """@echo off
./archvis.exe runserver 0.0.0.0:8000
pause
"""
            with open(os.path.join(target_dir, "run_archvis.bat"), "w") as f:
                f.write(batch_content)
    else:
        print("Error: Build artifacts not found")

if __name__ == "__main__":
    try:
        check_python_source()
        build_executable()
    except Exception as e:
        print(f"[FATAL] BUILD FAILED: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
