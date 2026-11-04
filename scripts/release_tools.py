"""Validation and atomic publication for rel_visual.sh (no build side effects)."""
import errno
import os
import platform
import re
import shutil
import signal
import tarfile
import tempfile
import warnings
from pathlib import Path


def platform_tags():
    system, machine = platform.system().lower(), platform.machine().lower()
    for label in (system, machine):
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', label):
            raise ValueError(f'Cannot form a release platform tag from {label!r}')
    executable = 'archvisual.exe' if system == 'windows' else 'archvisual'
    return system, machine, executable


def verify_archive(path, version, executable):
    """Read all payloads and require the candidate executable and version."""
    with tarfile.open(path, 'r:bz2') as archive:
        binary = archive.getmember(f'archvisual/{executable}')
        marker = archive.getmember('archvisual/version.txt')
        if not binary.isfile() or not binary.size or not marker.isfile():
            raise ValueError('Release archive is missing the executable or version file')
        with archive.extractfile(marker) as stream:
            if stream.read() != (version + '\n').encode():
                raise ValueError('Release archive version does not match the candidate')
        for member in archive:
            if member.isfile():
                with archive.extractfile(member) as stream:
                    while stream.read(1024 * 1024):
                        pass


def publish_release(temporary, destination, candidate_version, original_version, version_file):
    """Commit two atomic renames; restore both files on a publication error.

    rel_visual.sh holds the project release lock. Temporary archives and any
    archive backup live beside the destination; version files stay under the
    staged build root and must share a filesystem with the tracked version.
    """
    temporary, destination, candidate_version, original_version, version_file = map(
        Path, (temporary, destination, candidate_version, original_version, version_file))
    if version_file.read_bytes() != original_version.read_bytes():
        raise RuntimeError('version.txt changed during the build; release was not published')
    if candidate_version.stat().st_dev != version_file.parent.stat().st_dev:
        raise OSError(errno.EXDEV, 'Staged version and version.txt must share a filesystem')
    if destination.is_symlink() or (destination.exists() and not destination.is_file()):
        raise ValueError(f'Release destination must be a regular file: {destination}')
    # mktemp starts private; publish with the same umask-derived permissions
    # that creating the final archive directly would have used.
    creation_mask = os.umask(0)
    os.umask(creation_mask)
    temporary.chmod(0o666 & ~creation_mask)

    backup = None
    keep_recovery = False
    previous_handlers = {}

    def interrupted(signum, frame):
        raise InterruptedError(f'Release publication interrupted by signal {signum}')

    try:
        if destination.exists():
            descriptor, name = tempfile.mkstemp(prefix=f'.{destination.name}.rollback-', dir=destination.parent)
            os.close(descriptor)
            backup = Path(name)
            shutil.copy2(destination, backup)
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[signum] = signal.signal(signum, interrupted)
        try:
            os.replace(temporary, destination)
            os.replace(candidate_version, version_file)
        except BaseException as failure:
            # A rename consumes its unique source path. This also detects a
            # signal arriving between a successful rename and its return.
            for signum in previous_handlers:
                signal.signal(signum, signal.SIG_IGN)
            rollback_errors = []
            if not candidate_version.exists():
                try:
                    os.replace(original_version, version_file)
                except OSError as error:
                    rollback_errors.append(f'version restore: {error}')
            if not temporary.exists():
                try:
                    if backup is None:
                        destination.unlink()
                    else:
                        os.replace(backup, destination)
                except OSError as error:
                    rollback_errors.append(f'archive restore: {error}')
            if rollback_errors:
                keep_recovery = True
                details = '\n'.join(rollback_errors)
                (original_version.parent / 'KEEP_FOR_RECOVERY').write_text(
                    f'{failure}\n{details}\nArchive backup: {backup}\n')
                raise RuntimeError(f'Release rollback needs recovery; artifacts preserved: {details}') from failure
            raise
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
        if backup is not None and not keep_recovery:
            try:
                backup.unlink(missing_ok=True)
            except OSError as error:
                # The transaction may already be committed. Keep the backup
                # and report cleanup separately from publication success.
                warnings.warn(f'Could not remove release backup {backup}: {error}', RuntimeWarning)
