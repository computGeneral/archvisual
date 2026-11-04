"""Standalone entry-point, output routing and preparation isolation regressions."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import archvisual_env as environment

PROJECT = Path(__file__).resolve().parent
TEST_OUTPUT = environment.output_root() / 'environment-tests'


class StandaloneEnvironmentTests(unittest.TestCase):
    def setUp(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        self.case = Path(tempfile.mkdtemp(prefix=self._testMethodName + '_', dir=TEST_OUTPUT))
        self.project = self.case / 'independent project'
        self.project.mkdir()
        for name in ('archvisual_env.py', 'requirements.txt', 'run_visual.sh'):
            shutil.copy2(PROJECT / name, self.project / name)
        shutil.copytree(PROJECT / 'scripts', self.project / 'scripts')
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(('ARCHVISUAL_', 'ARCHEXPLOR_ARCHVISUAL_')) and key != 'VIRTUAL_ENV'}
        self.env['PYTHONDONTWRITEBYTECODE'] = '1'

    def shell(self, text, env=None):
        return subprocess.run(['bash', '-c', 'set -euo pipefail\nsource "$1/scripts/shared_env.sh"\n' + text,
                               'environment-test', str(self.project)], cwd=self.case,
                              env={**self.env, **(env or {})}, text=True, capture_output=True, timeout=15)

    def test_missing_local_environment_does_not_select_a_parent_venv(self):
        parent = self.case / '.venv/bin'
        parent.mkdir(parents=True)
        (parent / 'python').symlink_to(sys.executable)
        result = self.shell('archvisual_use_python')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no ArchVisual Python environment', result.stderr)

    def test_explicit_interpreter_takes_precedence_and_does_not_change_path(self):
        result = self.shell('old_path="$PATH"\narchvisual_use_python\n[[ "$PATH" == "$old_path" ]]\nprintf "%s" "$ARCHVISUAL_PYTHON"',
                            {'ARCHVISUAL_PYTHON': sys.executable})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, sys.executable)

    def test_local_venv_precedes_activated_environment_and_keeps_venv_path(self):
        folder = self.project / '.venv/bin'
        folder.mkdir(parents=True)
        (folder / 'python').symlink_to(sys.executable)
        result = self.shell('archvisual_use_python\nprintf "%s" "$ARCHVISUAL_PYTHON"',
                            {'VIRTUAL_ENV': str(Path(sys.executable).parent.parent)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, str(folder / 'python'))

    def test_activated_environment_can_be_used_explicitly(self):
        active = self.case / 'active/bin'
        active.mkdir(parents=True)
        (active / 'python').symlink_to(sys.executable)
        result = self.shell('archvisual_use_python\nprintf "%s" "$ARCHVISUAL_PYTHON"',
                            {'VIRTUAL_ENV': str(active.parent)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, str(active / 'python'))

    def test_invalid_explicit_interpreter_does_not_fall_back(self):
        result = self.shell('archvisual_use_python', {'ARCHVISUAL_PYTHON': str(self.case / 'missing-python')})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ARCHVISUAL_PYTHON is not executable', result.stderr)

    def test_check_is_read_only_and_uses_local_requirements(self):
        result = subprocess.run(['bash', str(self.project / 'scripts/setup_python.sh'), '--check', '--build'],
                                cwd=self.case, env={**self.env, 'ARCHVISUAL_PYTHON': sys.executable},
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.project / '.venv').exists())
        self.assertFalse((self.project / '.archvisual-python.lock').exists())
        requirements = self.project / 'requirements.txt'
        requirements.write_text(requirements.read_text().replace('django==4.2.23', 'django==0.0.0'))
        result = subprocess.run([sys.executable, '-B', str(self.project / 'archvisual_env.py'), 'check'],
                                env=self.env, text=True, capture_output=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('django: expected 0.0.0', result.stderr)
        self.assertFalse((self.project / '.venv').exists())

    def test_run_from_other_directory_preserves_arguments_and_environment_lock(self):
        entry = self.project / 'archvisual.py'
        entry.write_text('import json,sys,time\nfrom pathlib import Path\n'
                         'Path(__file__).with_name("started.json").write_text(json.dumps(sys.argv[1:]))\n'
                         'time.sleep(20)\n')
        process = subprocess.Popen(['bash', str(self.project / 'run_visual.sh'), '8123', '--noreload'],
                                   cwd=self.case, env={**self.env, 'ARCHVISUAL_PYTHON': sys.executable},
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        deadline = time.monotonic() + 10
        started = self.project / 'started.json'
        while not started.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        if not started.exists():
            process.terminate()
            stdout, stderr = process.communicate(timeout=5)
            self.fail(stdout + stderr)
        self.assertEqual(json.loads(started.read_text()), ['runserver', '0.0.0.0:8123', '--noreload'])
        prepare = subprocess.run([sys.executable, '-B', str(self.project / 'archvisual_env.py'), 'prepare'],
                                 env=self.env, text=True, capture_output=True, timeout=10)
        self.assertNotEqual(prepare.returncode, 0)
        self.assertIn('environment is in use', prepare.stderr)
        self.assertFalse((self.project / '.venv').exists())
        process.terminate()
        process.communicate(timeout=5)


class OutputAndPreparationTests(unittest.TestCase):
    def setUp(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        self.project = Path(tempfile.mkdtemp(prefix=self._testMethodName + '_', dir=TEST_OUTPUT))
        self.clean_env = {key: value for key, value in os.environ.items()
                          if not key.startswith(('ARCHVISUAL_', 'ARCHEXPLOR_ARCHVISUAL_'))}
        self.patch_root = mock.patch.object(environment, 'PROJECT_ROOT', self.project)
        self.patch_env = mock.patch.dict(os.environ, self.clean_env, clear=True)
        self.patch_root.start()
        self.patch_env.start()
        self.addCleanup(self.patch_root.stop)
        self.addCleanup(self.patch_env.stop)

    def test_default_paths_are_inside_the_standalone_repository(self):
        self.assertEqual(environment.output_root(), self.project / '__output__')
        self.assertEqual(environment.static_root(), self.project / '__output__/staticfiles')
        self.assertEqual(environment.temp_root(), self.project / '__output__/tmp')
        self.assertEqual(environment.release_root(), self.project / '__output__/releases')

    def test_explicit_paths_and_legacy_aliases_have_deterministic_precedence(self):
        os.environ['ARCHEXPLOR_ARCHVISUAL_OUTPUT_ROOT'] = str(self.project.parent / 'legacy')
        self.assertEqual(environment.output_root(), self.project.parent / 'legacy')
        os.environ['ARCHVISUAL_OUTPUT_ROOT'] = '__output__/new'
        self.assertEqual(environment.output_root(), self.project / '__output__/new')
        os.environ['ARCHEXPLOR_ARCHVISUAL_RELEASE_DIR'] = str(self.project.parent / 'old-releases')
        os.environ['ARCHVISUAL_RELEASE_DIR'] = str(self.project.parent / 'new-releases')
        self.assertEqual(environment.release_root(), self.project.parent / 'new-releases')

    def test_source_paths_and_cleaned_release_paths_are_rejected(self):
        for folder in (self.project, self.project.parent, self.project / 'dataviewer'):
            with self.subTest(folder=folder), mock.patch.dict(os.environ, {'ARCHVISUAL_OUTPUT_ROOT': str(folder)}):
                with self.assertRaises(ValueError):
                    environment.output_root()
        for folder in ('output', 'output/releases', 'build', 'staticfiles', '.release-staging/nested'):
            with self.subTest(folder=folder), mock.patch.dict(os.environ, {'ARCHVISUAL_RELEASE_DIR': str(self.project / '__output__' / folder)}):
                with self.assertRaises(ValueError):
                    environment.release_root()

    def test_prepare_refuses_a_symlinked_environment_before_installing(self):
        (self.project / '.venv').symlink_to(Path(sys.executable).parent.parent, target_is_directory=True)
        with mock.patch.object(environment.subprocess, 'check_call') as install:
            with self.assertRaisesRegex(ValueError, 'symlinked .venv'):
                environment.prepare_environment()
            install.assert_not_called()

    def test_prepare_targets_only_the_local_environment(self):
        folder = self.project / '.venv'
        folder.mkdir()
        (folder / 'pyvenv.cfg').write_text('test fixture\n')
        with mock.patch.object(environment, 'ENVIRONMENT_LOCK', self.project / '.archvisual-python.lock'), \
                mock.patch.object(environment.subprocess, 'check_call') as calls:
            environment.prepare_environment()
        commands = [call.args[0] for call in calls.call_args_list]
        self.assertEqual(len(commands), 3)
        self.assertTrue(all(command[0] == str(environment.local_python()) for command in commands))
        self.assertIn(str(self.project / 'requirements.txt'), commands[1])

    def test_prepare_rejects_an_interpreter_that_routes_to_another_environment(self):
        folder = self.project / '.venv'
        (folder / 'bin').mkdir(parents=True)
        (folder / 'pyvenv.cfg').write_text('fixture with incorrectly routed interpreter\n')
        python = folder / 'bin/python'
        # An existing executable wrapper must not redirect pip to another venv.
        import shlex
        python.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' "$@"\n')
        python.chmod(0o755)
        with mock.patch.object(environment, 'ENVIRONMENT_LOCK', self.project / '.archvisual-python.lock'), \
                mock.patch.object(environment.subprocess, 'check_call', wraps=subprocess.check_call) as calls:
            with self.assertRaises(subprocess.CalledProcessError):
                environment.prepare_environment()
        self.assertEqual(calls.call_count, 1)  # Fails the prefix probe before any pip invocation.


if __name__ == '__main__':
    unittest.main()
