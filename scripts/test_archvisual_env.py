"""Standalone entry-point, output routing and preparation isolation regressions."""
from contextlib import redirect_stderr
import io
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

from scripts import archvisual_env as environment

PROJECT = Path(__file__).resolve().parent.parent
TEST_OUTPUT = environment.output_root() / 'environment-tests'


class StandaloneEnvironmentTests(unittest.TestCase):
    def setUp(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        self.case = Path(tempfile.mkdtemp(prefix=self._testMethodName + '_', dir=TEST_OUTPUT))
        self.project = self.case / 'independent project'
        self.project.mkdir()
        for name in ('requirements.txt', 'run_visual.sh'):
            shutil.copy2(PROJECT / name, self.project / name)
        shutil.copytree(PROJECT / 'scripts', self.project / 'scripts')
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(('ARCHVISUAL_', 'ARCHEXPLOR_ARCHVISUAL_')) and key != 'VIRTUAL_ENV'}
        self.env['PYTHONDONTWRITEBYTECODE'] = '1'

    def shell(self, text, env=None):
        return subprocess.run(['bash', '-c', 'set -euo pipefail\nsource "$1/scripts/setup_python.sh"\n' + text,
                               'environment-test', str(self.project)], cwd=self.case,
                              env={**self.env, **(env or {})}, text=True, capture_output=True, timeout=15)

    def test_sourcing_setup_preserves_shell_options_and_does_not_dispatch_cli(self):
        for options in ('', 'set -euo pipefail\n'):
            with self.subTest(options=options):
                command = options + '''before_flags="$-"
before_options="$SHELLOPTS"
source "$1/scripts/setup_python.sh" --prepare --python /missing-bootstrap
[[ "$-" == "$before_flags" && "$SHELLOPTS" == "$before_options" ]] || exit 1
[[ "$ARCHVISUAL_PROJECT_ROOT" == "$1" ]] || exit 1
declare -F archvisual_use_python archvisual_hold_python archvisual_check_python archvisual_configure_paths >/dev/null
'''
                result = subprocess.run(['bash', '-c', command, 'source-test', str(self.project)],
                                        cwd=self.case, env=self.env, text=True, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr, '')
                self.assertFalse((self.project / '.venv').exists())
                self.assertFalse((self.project / '.archvisual-python.lock').exists())

    def test_relocated_module_anchors_paths_and_lock_to_repository_root(self):
        result = subprocess.run([sys.executable, '-B', '-c',
                                 'from scripts import archvisual_env as env; import json; '
                                 'print(json.dumps([str(env.PROJECT_ROOT), str(env.ENVIRONMENT_LOCK), '
                                 'str(env.local_python()), str(env.requirements_path()), str(env.output_root())]))'],
                                cwd=self.project, env=self.env, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        python = '.venv/Scripts/python.exe' if os.name == 'nt' else '.venv/bin/python'
        self.assertEqual(json.loads(result.stdout), [str(self.project),
                         *[str(self.project / name) for name in
                           ('.archvisual-python.lock', python, 'requirements.txt', '__output__')]])

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

    def test_prepare_shell_passes_custom_index_with_either_option_order(self):
        bootstrap = self.case / 'fake python'
        bootstrap.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
        bootstrap.chmod(0o755)
        script = str(self.project / 'scripts/setup_python.sh')
        url = 'https://example.test/simple?key=one&other=two'
        for options in (['--python', str(bootstrap), '-i', url],
                        ['-i', url, '--python', str(bootstrap)]):
            result = subprocess.run(['bash', script, '--prepare', *options], cwd=self.case,
                                    env=self.env, text=True, capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.splitlines(),
                             ['-B', str(self.project / 'scripts/archvisual_env.py'), 'prepare', '--index-url', url])

    def test_prepare_shell_rejects_missing_option_values(self):
        script = str(self.project / 'scripts/setup_python.sh')
        for options in (['-i'], ['-i', ''], ['-i', '--python'], ['--python'], ['--python', '-i']):
            with self.subTest(options=options):
                result = subprocess.run(['bash', script, '--prepare', *options], cwd=self.case,
                                        env=self.env, text=True, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 2)
                self.assertIn('requires a value', result.stderr)

    def test_check_is_read_only_and_uses_local_requirements(self):
        result = subprocess.run(['bash', str(self.project / 'scripts/setup_python.sh'), '--check', '--build'],
                                cwd=self.case, env={**self.env, 'ARCHVISUAL_PYTHON': sys.executable},
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.project / '.venv').exists())
        self.assertFalse((self.project / '.archvisual-python.lock').exists())
        requirements = self.project / environment.requirements_path().name
        lines = requirements.read_text().splitlines()
        requirements.write_text('\n'.join('django==0.0.0' if line.startswith('django=') else line
                                          for line in lines) + '\n')
        result = subprocess.run([sys.executable, '-B', str(self.project / 'scripts/archvisual_env.py'), 'check'],
                                env=self.env, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('WARNING:', result.stderr)
        self.assertIn('django: reference ', result.stderr)
        self.assertIn('0.0.0', result.stderr)
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
        prepare = subprocess.run([sys.executable, '-B', str(self.project / 'scripts/archvisual_env.py'), 'prepare'],
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
        shutil.copy2(PROJECT / 'requirements.txt', self.project / 'requirements.txt')
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
        self.assertEqual(commands[1][6:], ['blosc2', 'django', 'django-cors-headers', 'numexpr',
                                           'numpy', 'pandas', 'nuitka', 'tables'])
        self.assertEqual(commands[1][commands[1].index('--index-url') + 1],
                         'https://pypi.tuna.tsinghua.edu.cn/simple')

        custom_url = 'https://example.test/simple?key=one&other=two'
        with mock.patch.object(environment, 'ENVIRONMENT_LOCK', self.project / '.archvisual-python.lock'), \
                mock.patch.object(environment.subprocess, 'check_call') as calls:
            environment.prepare_environment(custom_url)
        pip_command = calls.call_args_list[1].args[0]
        self.assertEqual(pip_command[pip_command.index('--index-url') + 1], custom_url)

    def test_prepare_creates_a_venv_that_can_import_the_standard_library(self):
        check_call = subprocess.check_call

        def check_without_external_dependencies(command, *args, **kwargs):
            if command[1:3] == ['-B', '-c']:
                return check_call(command, *args, **kwargs)  # Real production prefix/version probe.
            if command[1:4] == ['-m', 'pip', 'install'] or command[-2:] == ['check', '--build']:
                return 0  # This regression covers venv creation, not package downloads.
            self.fail(f'Unexpected preparation command: {command}')

        with mock.patch.object(environment, 'ENVIRONMENT_LOCK', self.project / '.archvisual-python.lock'), \
                mock.patch.object(environment.subprocess, 'check_call', side_effect=check_without_external_dependencies):
            environment.prepare_environment()  # Real EnvBuilder and its bundled ensurepip.
        check_call([str(environment.local_python()), '-B', '-c',
                    'import encodings,sys; from pathlib import Path; '
                    'assert Path(sys.prefix).resolve() == Path(sys.argv[1]).resolve()',
                    str(self.project / '.venv')])

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


class PythonCompatibilityTests(unittest.TestCase):
    def test_reference_requirements_skip_comments_and_reject_invalid_entries(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='reference_', dir=TEST_OUTPUT) as folder:
            reference = Path(folder) / 'requirements.txt'
            reference.write_text('# reference versions\n\ndjango==4.2.23\nnumpy==1.24.4\n')
            with mock.patch.object(environment, 'requirements_path', return_value=reference):
                self.assertEqual(environment.reference_requirements(), [('django', '4.2.23'), ('numpy', '1.24.4')])
                reference.write_text('django>=4\n')
                with self.assertRaisesRegex(ValueError, 'Invalid reference requirement at line 1'):
                    environment.reference_requirements()

    def test_prepare_cli_selects_default_or_explicit_package_index(self):
        for arguments, expected in ((['prepare'], 'https://pypi.tuna.tsinghua.edu.cn/simple'),
                                    (['prepare', '--index-url', 'https://example.test/simple'],
                                     'https://example.test/simple')):
            with self.subTest(arguments=arguments), \
                    mock.patch.object(environment.sys, 'argv', ['scripts/archvisual_env.py', *arguments]), \
                    mock.patch.object(environment, 'prepare_environment') as prepare:
                environment.main()
                prepare.assert_called_once_with(expected)

    def test_supported_versions(self):
        for version in ((3, 10), (3, 11), (3, 12), (3, 13), (3, 99), (4, 0)):
            with self.subTest(version=version), mock.patch.object(environment.sys, 'version_info', version):
                output = io.StringIO()
                with redirect_stderr(output):
                    environment.check_python_version()
                self.assertEqual('WARNING:' in output.getvalue(), version != (3, 10))

    def test_unsupported_versions_are_rejected_before_environment_work(self):
        for version in ((3, 8), (3, 9)):
            with self.subTest(version=version), mock.patch.object(environment.sys, 'version_info', version):
                with mock.patch.object(environment.venv.EnvBuilder, 'create') as create, \
                        mock.patch.object(environment.subprocess, 'check_call') as install, \
                        mock.patch.object(environment.metadata, 'version') as package_version:
                    for action in (environment.check_python_version, environment.check_environment,
                                   environment.prepare_environment):
                        with self.assertRaisesRegex(RuntimeError, 'Python 3.10 or newer'):
                            action()
                    create.assert_not_called()
                    install.assert_not_called()
                    package_version.assert_not_called()

    def test_package_version_mismatch_warns_and_runtime_skips_nuitka(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='reference_', dir=TEST_OUTPUT) as folder:
            reference = Path(folder) / 'requirements.txt'
            reference.write_text('django==4.2.23\nnuitka==4.0.3\n')
            versions = {'django': '5.2.19', 'nuitka': '5.0.0'}
            with mock.patch.object(environment, 'requirements_path', return_value=reference), \
                    mock.patch.object(environment.metadata, 'version', side_effect=versions.get), \
                    mock.patch.object(environment, 'import_module') as imports:
                output = io.StringIO()
                with redirect_stderr(output):
                    environment.check_environment()
                self.assertIn('django: reference 4.2.23, found 5.2.19', output.getvalue())
                self.assertNotIn('nuitka:', output.getvalue())
                imports.assert_called_once_with('django')
                output = io.StringIO()
                with redirect_stderr(output):
                    environment.check_environment(build=True)
                self.assertIn('nuitka: reference 4.0.3, found 5.0.0', output.getvalue())

    def test_missing_or_unimportable_package_fails_check(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='reference_', dir=TEST_OUTPUT) as folder:
            reference = Path(folder) / 'requirements.txt'
            reference.write_text('django==4.2.23\n')
            with mock.patch.object(environment, 'requirements_path', return_value=reference):
                with mock.patch.object(environment.metadata, 'version',
                                       side_effect=environment.metadata.PackageNotFoundError('django')):
                    with self.assertRaisesRegex(RuntimeError, 'django: package is not installed'):
                        environment.check_environment()
                with mock.patch.object(environment.metadata, 'version', return_value='5.2.19'), \
                        mock.patch.object(environment, 'import_module', side_effect=RuntimeError('broken ABI')), \
                        redirect_stderr(io.StringIO()):
                    with self.assertRaisesRegex(RuntimeError, 'django: import failed: broken ABI'):
                        environment.check_environment()

    def test_nuitka_is_required_only_for_build_check(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='reference_', dir=TEST_OUTPUT) as folder:
            reference = Path(folder) / 'requirements.txt'
            reference.write_text('django==4.2.23\nnuitka==4.0.3\n')

            def version(name):
                if name == 'nuitka':
                    raise environment.metadata.PackageNotFoundError(name)
                return '4.2.23'

            with mock.patch.object(environment, 'requirements_path', return_value=reference), \
                    mock.patch.object(environment.metadata, 'version', side_effect=version), \
                    mock.patch.object(environment, 'import_module'), redirect_stderr(io.StringIO()):
                environment.check_environment()
                with self.assertRaisesRegex(RuntimeError, 'nuitka: package is not installed'):
                    environment.check_environment(build=True)


if __name__ == '__main__':
    unittest.main()
