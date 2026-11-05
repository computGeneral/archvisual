"""PATH-selected Python entrypoints and standalone output-path protection."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from scripts import paths

PROJECT = Path(__file__).resolve().parent.parent
TEST_OUTPUT = paths.output_root() / 'path-tests'


class OutputPathTests(unittest.TestCase):
    def setUp(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=TEST_OUTPUT)
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / 'independent project'
        self.project.mkdir()
        clean_env = {key: value for key, value in os.environ.items()
                     if not key.startswith(('ARCHVISUAL_', 'ARCHEXPLOR_ARCHVISUAL_'))}
        self.patch_root = mock.patch.object(paths, 'PROJECT_ROOT', self.project)
        self.patch_env = mock.patch.dict(os.environ, clean_env, clear=True)
        self.patch_root.start()
        self.patch_env.start()
        self.addCleanup(self.patch_root.stop)
        self.addCleanup(self.patch_env.stop)

    def test_default_paths_are_inside_the_standalone_repository(self):
        self.assertEqual(paths.output_root(), self.project / '__output__')
        self.assertEqual(paths.static_root(), self.project / '__output__/staticfiles')
        self.assertEqual(paths.temp_root(), self.project / '__output__/tmp')
        self.assertEqual(paths.release_root(), self.project / '__output__/releases')

    def test_explicit_paths_and_legacy_aliases_have_deterministic_precedence(self):
        os.environ['ARCHEXPLOR_ARCHVISUAL_OUTPUT_ROOT'] = str(self.project.parent / 'legacy')
        self.assertEqual(paths.output_root(), self.project.parent / 'legacy')
        os.environ['ARCHVISUAL_OUTPUT_ROOT'] = '__output__/new'
        self.assertEqual(paths.output_root(), self.project / '__output__/new')
        os.environ['ARCHEXPLOR_ARCHVISUAL_RELEASE_DIR'] = str(self.project.parent / 'old-releases')
        os.environ['ARCHVISUAL_RELEASE_DIR'] = str(self.project.parent / 'new-releases')
        self.assertEqual(paths.release_root(), self.project.parent / 'new-releases')

    def test_source_paths_and_cleaned_release_paths_are_rejected(self):
        for folder in (self.project, self.project.parent, self.project / 'dataviewer'):
            with self.subTest(folder=folder), mock.patch.dict(os.environ, {'ARCHVISUAL_OUTPUT_ROOT': str(folder)}):
                with self.assertRaises(ValueError):
                    paths.output_root()
        for folder in ('output', 'output/releases', 'build', 'staticfiles', '.release-staging/nested'):
            with self.subTest(folder=folder), mock.patch.dict(os.environ, {
                    'ARCHVISUAL_RELEASE_DIR': str(self.project / '__output__' / folder)}):
                with self.assertRaises(ValueError):
                    paths.release_root()

    def test_empty_override_and_symlink_into_source_are_rejected(self):
        with mock.patch.dict(os.environ, {'ARCHVISUAL_OUTPUT_ROOT': ''}):
            with self.assertRaisesRegex(ValueError, 'cannot be empty'):
                paths.output_root()
        link = self.project.parent / 'link'
        link.symlink_to(self.project, target_is_directory=True)
        with mock.patch.dict(os.environ, {'ARCHVISUAL_OUTPUT_ROOT': str(link)}):
            with self.assertRaises(ValueError):
                paths.output_root()

    def test_relocated_module_needs_only_standard_library_and_no_requirements(self):
        folder = self.project / 'scripts'
        folder.mkdir()
        shutil.copy2(PROJECT / 'scripts/paths.py', folder / 'paths.py')
        result = subprocess.run([sys.executable, '-I', '-B', '-c',
                                 'import runpy,sys; p=runpy.run_path(sys.argv[1]); '
                                 'print(p["output_root"]())', str(folder / 'paths.py')],
                                cwd=self.project.parent, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), str(self.project / '__output__'))
        self.assertFalse((self.project / 'requirements.txt').exists())


class PythonEntrypointTests(unittest.TestCase):
    def setUp(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=TEST_OUTPUT)
        self.addCleanup(self.temp.cleanup)
        self.case = Path(self.temp.name)
        self.project = self.case / 'independent project'
        self.project.mkdir()
        shutil.copy2(PROJECT / 'run_visual.sh', self.project / 'run_visual.sh')
        (self.project / 'archvisual.py').write_text(
            'import json,os,sys\n'
            'print(json.dumps({"python":sys.executable,"args":sys.argv[1:],'
            '"path":os.environ["PATH"],"no_bytecode":sys.dont_write_bytecode}))\n'
            'sys.exit(int(os.environ.get("ENTRYPOINT_EXIT", "0")))\n')
        self.bin = self.case / 'selected bin'
        self.bin.mkdir()
        python = self.bin / 'python3'
        python.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' "$@"\n')
        python.chmod(0o755)
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(('ARCHVISUAL_', 'ARCHEXPLOR_ARCHVISUAL_')) and key != 'VIRTUAL_ENV'}
        self.env['PATH'] = str(self.bin) + os.pathsep + self.env['PATH']

    def run_entry(self, **env):
        return subprocess.run(['bash', str(self.project / 'run_visual.sh'), '18000', '--noreload', 'with spaces'],
                              cwd=self.case, env={**self.env, **env}, capture_output=True, text=True, timeout=10)

    def test_run_from_other_cwd_uses_path_python_and_preserves_arguments(self):
        result = self.run_entry()
        self.assertEqual(result.returncode, 0, result.stderr)
        actual = json.loads(result.stdout)
        self.assertEqual(actual['python'], sys.executable)
        self.assertEqual(actual['args'], ['runserver', '0.0.0.0:18000', '--noreload', 'with spaces'])
        self.assertEqual(actual['path'], self.env['PATH'])
        self.assertTrue(actual['no_bytecode'])
        self.assertFalse((self.project / '.venv').exists())
        self.assertFalse(list(self.project.glob('.*.lock')))

    def test_local_and_parent_venvs_do_not_override_path(self):
        for root in (self.project, self.case):
            folder = root / '.venv/bin'
            folder.mkdir(parents=True)
            for name in ('python', 'python3'):
                script = folder / name
                script.write_text('#!/bin/sh\nexit 73\n')
                script.chmod(0o755)
        result = self.run_entry(VIRTUAL_ENV=str(self.project / '.venv'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['python'], sys.executable)

    def test_application_failure_status_is_preserved(self):
        self.assertEqual(self.run_entry(ENTRYPOINT_EXIT='41').returncode, 41)


if __name__ == '__main__':
    unittest.main()
