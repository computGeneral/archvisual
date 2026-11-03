"""Release control-flow fault injection; no real Nuitka build or publication.

Run from repo root with the admitted workspace interpreter:
  .venv/bin/python -B -m unittest discover -s archvisual -p test_release_visual.py -v
Fixture environment helpers do not test workspace Python admission. Every child
Python process uses the same repo-root interpreter under the caller's lease.
"""
import importlib.util
import io
import os
import platform
import shlex
import shutil
import signal
import subprocess
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import release_tools

PROJECT = Path(__file__).resolve().parent
ROOT = PROJECT.parent
PYTHON = ROOT / '.venv/bin/python'
TEST_OUTPUT = Path(os.environ.get('ARCHVISUAL_RELEASE_TEST_OUTPUT', ROOT / '__output__/archvisual/release-tests'))


class ReleaseFixture(unittest.TestCase):
    def setUp(self):
        TEST_OUTPUT.mkdir(parents=True, exist_ok=True)
        self.case = Path(tempfile.mkdtemp(prefix=self._testMethodName + '_', dir=TEST_OUTPUT))


class ReleaseControlTests(ReleaseFixture):
    def setUp(self):
        super().setUp()
        self.repo = self.case / 'repo'
        self.project = self.repo / 'archvisual'
        self.module = self.repo / '__output__/archvisual'
        self.releases = self.module / 'releases'
        self.project.mkdir(parents=True)
        self.releases.mkdir(parents=True)
        for name in ('rel_visual.sh', 'release_tools.py'):
            shutil.copy2(PROJECT / name, self.project / name)
        self.version = self.project / 'version.txt'
        self.version.write_text('1.2.3\n')
        self.old = self.releases / self.filename('1.2.3')
        self.old.write_bytes(b'previous version archive')
        self.destination = self.releases / self.filename('1.2.4')
        self.destination.write_bytes(b'previous same-name archive')
        self.legacy = self.module / 'output/legacy.tar.bz2'
        self.legacy.parent.mkdir()
        self.legacy.write_bytes(b'legacy archive outside staging')
        scripts = self.repo / 'scripts'
        scripts.mkdir()
        (scripts / 'shared_env.sh').write_text(f'''archexplor_use_workspace_python() {{ export ARCHEXPLOR_PYTHON_BIN={shlex.quote(str(PYTHON))}; }}
archexplor_hold_workspace_python() {{ :; }}
archexplor_configure_output_environment() {{ :; }}
archexplor_require_output_path() {{
    local normalized
    normalized="$(realpath -m -- "$1")" || return 1
    case "$normalized" in
        {shlex.quote(str(self.repo / '__output__'))}/*) printf '%s\\n' "$normalized" ;;
        *) echo 'fixture output outside repository output root' >&2; return 1 ;;
    esac
}}
''')
        (self.project / 'build_visual.py').write_text('''from pathlib import Path
import os, platform, shutil, time
project = Path(__file__).parent
root = Path(os.environ['ARCHEXPLOR_ARCHVISUAL_OUTPUT_ROOT'])
assert root.is_relative_to(project.parent / '__output__/archvisual/.release-staging')
(project.parent / 'observed-version.txt').write_bytes((project / 'version.txt').read_bytes())
(project.parent / 'observed-root.txt').write_text(str(root))
shutil.rmtree(root / 'output', ignore_errors=True)
shutil.rmtree(root / 'build', ignore_errors=True)
mode = os.environ.get('RELEASE_TEST_MODE', '')
if mode == 'fail':
    raise SystemExit(42)
if mode == 'block':
    (project.parent / 'started').touch()
    deadline = time.monotonic() + 10
    while not (project.parent / 'continue').exists():
        if time.monotonic() > deadline:
            raise SystemExit(43)
        time.sleep(0.02)
binary = root / 'output/archvisual'
binary.mkdir(parents=True)
if mode == 'missing':
    raise SystemExit(0)
executable = binary / ('archvisual.exe' if platform.system().lower() == 'windows' else 'archvisual')
executable.write_text('Build fixture, not a real compiled executable')
executable.chmod(0o644 if mode == 'not-executable' else 0o755)
if mode == 'external-version':
    (project / 'version.txt').write_text('9.9.9\\n')
''')
        self.env = dict(os.environ)
        for key in ('ARCHEXPLOR_ARCHVISUAL_OUTPUT_DIR', 'ARCHEXPLOR_ARCHVISUAL_RELEASE_DIR', 'RELEASE_TEST_MODE'):
            self.env.pop(key, None)

    def filename(self, version):
        system, machine, _ = release_tools.platform_tags()
        return f'archvisual.{version}.{system}.{machine}.tar.bz2'

    def run_release(self, mode='', argument='min', env=None):
        environment = dict(self.env, RELEASE_TEST_MODE=mode)
        environment.update(env or {})
        result = subprocess.run(['bash', str(self.project / 'rel_visual.sh'), argument],
                                cwd=self.case, env=environment, capture_output=True, text=True, timeout=20)
        (self.case / 'stdout.log').write_text(result.stdout)
        (self.case / 'stderr.log').write_text(result.stderr)
        return result

    def assert_preserved(self):
        self.assertEqual(self.version.read_text(), '1.2.3\n')
        self.assertEqual(self.old.read_bytes(), b'previous version archive')
        self.assertEqual(self.destination.read_bytes(), b'previous same-name archive')
        self.assertEqual(self.legacy.read_bytes(), b'legacy archive outside staging')

    def assert_clean(self):
        self.assertFalse(list(self.module.glob('.release-staging/release.*')))
        self.assertFalse(list(self.releases.glob('.*tmp*')))
        self.assertFalse(list(self.releases.glob('.*rollback*')))

    def fake_tar(self, exit_code):
        folder = self.case / 'fake-bin'
        folder.mkdir()
        command = folder / 'tar'
        command.write_text(f'#!/bin/bash\nprintf "incomplete archive\\n" > "$4"\nexit {exit_code}\n')
        command.chmod(0o755)
        return {'PATH': str(folder) + os.pathsep + self.env['PATH']}

    def test_success_updates_version_only_after_build_and_preserves_old_releases(self):
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'observed-version.txt').read_text(), '1.2.3\n')
        self.assertEqual(self.version.read_text(), '1.2.4\n')
        self.assertEqual(self.old.read_bytes(), b'previous version archive')
        self.assertEqual(self.legacy.read_bytes(), b'legacy archive outside staging')
        release_tools.verify_archive(self.destination, '1.2.4', release_tools.platform_tags()[2])
        self.assert_clean()

    def test_build_failure_keeps_version_and_old_packages(self):
        self.assertEqual(self.run_release('fail').returncode, 42)
        self.assert_preserved()
        self.assert_clean()

    def test_tar_failure_keeps_old_package_instead_of_partial_file(self):
        self.assertEqual(self.run_release(env=self.fake_tar(66)).returncode, 66)
        self.assert_preserved()
        self.assert_clean()

    def test_corrupt_archive_with_success_exit_is_not_published(self):
        self.assertNotEqual(self.run_release(env=self.fake_tar(0)).returncode, 0)
        self.assert_preserved()
        self.assert_clean()

    def test_missing_build_executable_is_rejected(self):
        self.assertNotEqual(self.run_release('missing').returncode, 0)
        self.assert_preserved()
        self.assert_clean()

    @unittest.skipIf(platform.system().lower() == 'windows', 'POSIX executable permission')
    def test_nonexecutable_build_output_is_rejected(self):
        self.assertNotEqual(self.run_release('not-executable').returncode, 0)
        self.assert_preserved()
        self.assert_clean()

    def test_major_and_minor_bumps(self):
        for argument, version in [('maj', '2.0.0'), ('mid', '1.3.0')]:
            with self.subTest(argument=argument):
                self.version.write_text('1.2.3\n')
                result = self.run_release(argument=argument)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.version.read_text(), version + '\n')
                release_tools.verify_archive(self.releases / self.filename(version), version, release_tools.platform_tags()[2])
                self.assert_clean()

    def test_invalid_argument_does_not_build_or_change_version(self):
        self.assertNotEqual(self.run_release(argument='invalid').returncode, 0)
        self.assert_preserved()
        self.assertFalse((self.repo / 'observed-version.txt').exists())

    def test_invalid_version_does_not_build(self):
        self.version.write_text('not-a-version\n')
        self.assertNotEqual(self.run_release().returncode, 0)
        self.assertEqual(self.version.read_text(), 'not-a-version\n')
        self.assertFalse((self.repo / 'observed-version.txt').exists())

    def test_cleaned_output_or_staging_override_is_rejected(self):
        for folder in [self.module / 'output', self.module / 'build',
                       self.module / 'staticfiles', self.module / '.release-staging/nested']:
            with self.subTest(folder=folder):
                self.assertNotEqual(self.run_release(env={'ARCHEXPLOR_ARCHVISUAL_RELEASE_DIR': str(folder)}).returncode, 0)
                self.assert_preserved()
        self.assertFalse((self.repo / 'observed-version.txt').exists())

    def test_safe_legacy_output_override_is_honored(self):
        folder = self.module / 'custom-releases'
        result = self.run_release(env={'ARCHEXPLOR_ARCHVISUAL_OUTPUT_DIR': str(folder)})
        self.assertEqual(result.returncode, 0, result.stderr)
        release_tools.verify_archive(folder / self.filename('1.2.4'), '1.2.4', release_tools.platform_tags()[2])
        self.assertEqual(self.destination.read_bytes(), b'previous same-name archive')

    def test_external_version_change_is_not_overwritten(self):
        result = self.run_release('external-version')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('version.txt changed during the build', result.stderr)
        self.assertEqual(self.version.read_text(), '9.9.9\n')
        self.assertEqual(self.destination.read_bytes(), b'previous same-name archive')
        self.assert_clean()

    def inject_version_commit_failure(self, fail_rollback=False):
        # Fault injection exists only in this fixture copy, never production.
        with (self.project / 'release_tools.py').open('a') as helper:
            helper.write(f'''
_fixture_replace = os.replace
def _fail_fixture_commit(source, destination):
    if Path(source).name == 'version.candidate' or ({fail_rollback!r} and '.rollback-' in Path(source).name):
        raise PermissionError('fixture publication failure')
    return _fixture_replace(source, destination)
os.replace = _fail_fixture_commit
''')

    def test_release_entrypoint_rolls_back_on_version_commit_failure(self):
        self.inject_version_commit_failure()
        self.assertNotEqual(self.run_release().returncode, 0)
        self.assert_preserved()
        self.assert_clean()

    def test_release_entrypoint_keeps_artifacts_when_rollback_fails(self):
        self.inject_version_commit_failure(fail_rollback=True)
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('recovery artifacts retained', result.stderr)
        self.assertEqual(self.version.read_text(), '1.2.3\n')
        markers = list(self.module.glob('.release-staging/release.*/KEEP_FOR_RECOVERY'))
        backups = list(self.releases.glob('.*rollback*'))
        self.assertEqual(len(markers), 1)
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), b'previous same-name archive')
        self.assertTrue((markers[0].parent / 'version.original').exists())

    def blocked_release(self):
        environment = dict(self.env, RELEASE_TEST_MODE='block')
        process = subprocess.Popen(['bash', str(self.project / 'rel_visual.sh'), 'min'],
                                   cwd=self.case, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        deadline = time.monotonic() + 8
        while not (self.repo / 'started').exists():
            if process.poll() is not None or time.monotonic() > deadline:
                stdout, stderr = process.communicate(timeout=2)
                self.fail(f'Blocked build did not start: {stdout}\n{stderr}')
            time.sleep(0.02)
        return process

    def test_parallel_release_is_rejected_before_reading_version(self):
        process = self.blocked_release()
        second = self.run_release()
        self.assertEqual(second.returncode, 75, second.stderr)
        self.assertEqual(self.version.read_text(), '1.2.3\n')
        (self.repo / 'continue').touch()
        stdout, stderr = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0, stdout + stderr)
        self.assertEqual(self.version.read_text(), '1.2.4\n')
        self.assert_clean()

    def test_interrupted_build_preserves_version_and_archives(self):
        process = self.blocked_release()
        process.send_signal(signal.SIGTERM)
        (self.repo / 'continue').touch()
        process.communicate(timeout=10)
        self.assertEqual(process.returncode, 143)
        self.assert_preserved()
        self.assert_clean()


class PublishTransactionTests(ReleaseFixture):
    def setUp(self):
        super().setUp()
        self.staging = self.case / 'staging'
        self.staging.mkdir()
        self.temporary = self.case / '.release.tmp'
        self.temporary.write_bytes(b'new complete archive')
        self.destination = self.case / 'release.tar.bz2'
        self.destination.write_bytes(b'old complete archive')
        self.version = self.case / 'version.txt'
        self.version.write_text('1.2.3\n')
        self.original = self.staging / 'version.original'
        self.candidate = self.staging / 'version.candidate'
        self.original.write_text('1.2.3\n')
        self.candidate.write_text('1.2.4\n')
        self.replace = os.replace

    def publish(self):
        release_tools.publish_release(self.temporary, self.destination, self.candidate, self.original, self.version)

    def assert_old(self):
        self.assertEqual(self.version.read_text(), '1.2.3\n')
        self.assertEqual(self.destination.read_bytes(), b'old complete archive')
        self.assertFalse(list(self.case.glob('.*rollback*')))

    def test_success_uses_atomic_replace_for_archive_then_version(self):
        with mock.patch.object(release_tools.os, 'replace', wraps=self.replace) as replace:
            self.publish()
        self.assertEqual(replace.call_args_list, [mock.call(self.temporary, self.destination), mock.call(self.candidate, self.version)])
        self.assertEqual(self.destination.read_bytes(), b'new complete archive')
        self.assertEqual(self.version.read_text(), '1.2.4\n')
        self.assertFalse(list(self.case.glob('.*rollback*')))

    def test_archive_commit_failure_preserves_both_old_files(self):
        with mock.patch.object(release_tools.os, 'replace', side_effect=PermissionError('injected archive commit failure')):
            with self.assertRaises(PermissionError):
                self.publish()
        self.assert_old()

    def test_published_archive_permissions_follow_umask(self):
        previous = os.umask(0o027)
        try:
            self.publish()
        finally:
            os.umask(previous)
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o640)

    def fail_version(self, source, destination):
        if Path(source) == self.candidate:
            raise PermissionError('injected version commit failure')
        return self.replace(source, destination)

    def test_version_commit_failure_restores_old_archive(self):
        with mock.patch.object(release_tools.os, 'replace', side_effect=self.fail_version):
            with self.assertRaises(PermissionError):
                self.publish()
        self.assert_old()

    def test_version_commit_failure_removes_only_new_archive(self):
        self.destination.unlink()
        with mock.patch.object(release_tools.os, 'replace', side_effect=self.fail_version):
            with self.assertRaises(PermissionError):
                self.publish()
        self.assertFalse(self.destination.exists())
        self.assertEqual(self.version.read_text(), '1.2.3\n')

    def test_interrupt_after_each_successful_rename_rolls_back(self):
        for interrupted_source in (self.temporary, self.candidate):
            with self.subTest(source=interrupted_source):
                self.temporary.write_bytes(b'new complete archive')
                self.candidate.write_text('1.2.4\n')
                self.original.write_text('1.2.3\n')
                def replace(source, destination):
                    self.replace(source, destination)
                    if Path(source) == interrupted_source:
                        raise InterruptedError('injected interrupt after rename')
                with mock.patch.object(release_tools.os, 'replace', side_effect=replace):
                    with self.assertRaises(InterruptedError):
                        self.publish()
                self.assert_old()

    def test_rollback_failure_keeps_recovery_artifacts(self):
        def replace(source, destination):
            if Path(source) != self.temporary:
                raise PermissionError('injected version/rollback failure')
            return self.replace(source, destination)
        with mock.patch.object(release_tools.os, 'replace', side_effect=replace):
            with self.assertRaisesRegex(RuntimeError, 'needs recovery'):
                self.publish()
        self.assertTrue((self.staging / 'KEEP_FOR_RECOVERY').is_file())
        backups = list(self.case.glob('.*rollback*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), b'old complete archive')

    def test_symlink_destination_is_not_replaced(self):
        self.destination.unlink()
        target = self.case / 'other-package'
        target.write_bytes(b'other package')
        self.destination.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'regular file'):
            self.publish()
        self.assertTrue(self.destination.is_symlink())
        self.assertEqual(target.read_bytes(), b'other package')

    def test_backup_cleanup_error_does_not_report_committed_release_as_failed(self):
        unlink = Path.unlink
        def fail_backup_cleanup(path, *args, **kwargs):
            if '.rollback-' in path.name:
                raise PermissionError('injected backup cleanup failure')
            return unlink(path, *args, **kwargs)
        with mock.patch.object(Path, 'unlink', fail_backup_cleanup):
            with self.assertWarnsRegex(RuntimeWarning, 'Could not remove release backup'):
                self.publish()
        self.assertEqual(self.version.read_text(), '1.2.4\n')
        self.assertEqual(self.destination.read_bytes(), b'new complete archive')
        self.assertEqual(len(list(self.case.glob('.*rollback*'))), 1)


class ArchiveAndPlatformTests(ReleaseFixture):
    def test_platform_tags_include_system_and_machine(self):
        for system, machine, expected in [('Linux', 'aarch64', ('linux', 'aarch64', 'archvisual')),
                                          ('Darwin', 'arm64', ('darwin', 'arm64', 'archvisual')),
                                          ('Windows', 'AMD64', ('windows', 'amd64', 'archvisual.exe'))]:
            with self.subTest(system=system):
                with mock.patch.object(release_tools.platform, 'system', return_value=system), \
                        mock.patch.object(release_tools.platform, 'machine', return_value=machine):
                    self.assertEqual(release_tools.platform_tags(), expected)

    def test_wrong_archive_version_is_rejected(self):
        archive = self.case / 'candidate.tar.bz2'
        with tarfile.open(archive, 'w:bz2') as stream:
            for name, content in [('archvisual/archvisual', b'executable fixture'), ('archvisual/version.txt', b'0.0.0\n')]:
                entry = tarfile.TarInfo(name)
                entry.size = len(content)
                stream.addfile(entry, io.BytesIO(content))
        with self.assertRaisesRegex(ValueError, 'version does not match'):
            release_tools.verify_archive(archive, '1.2.4', 'archvisual')


class BuildFailureTests(ReleaseFixture):
    def test_build_failure_and_missing_artifacts_do_not_return_success(self):
        spec = importlib.util.spec_from_file_location('release_build_under_test', PROJECT / 'build_visual.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # Keep the production builder's output routing contract; only the
        # compiler invocation and collectstatic are replaced in this test.
        for failure in (subprocess.CalledProcessError(32, ['nuitka']), None):
            with self.subTest(failure=failure):
                with mock.patch.dict(os.environ, {'ARCHEXPLOR_ARCHVISUAL_OUTPUT_ROOT': str(self.case / 'builder')}), \
                        mock.patch.object(module, 'collect_static_files'), \
                        mock.patch.object(module.workspace_python, 'managed_check_call', side_effect=failure):
                    with self.assertRaises(subprocess.CalledProcessError if failure else FileNotFoundError):
                        module.build_executable()


if __name__ == '__main__':
    unittest.main()
