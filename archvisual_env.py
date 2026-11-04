"""ArchVisual's local Python environment and output paths (standard library only)."""
import argparse
from contextlib import contextmanager
from importlib import import_module, metadata
import os
from pathlib import Path
import shlex
import subprocess
import sys
import venv

PROJECT_ROOT = Path(__file__).resolve().parent
ENVIRONMENT_LOCK = PROJECT_ROOT / '.archvisual-python.lock'


def local_python():
    return PROJECT_ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def check_python_version():
    if sys.version_info[:2] != (3, 10):
        raise RuntimeError('ArchVisual requires Python 3.10; prepare with --python python3.10')


def check_environment(build=False):
    """Check the selected interpreter without installing or changing packages."""
    check_python_version()
    modules = {'django': 'django', 'django-cors-headers': 'corsheaders',
               'pandas': 'pandas', 'numpy': 'numpy', 'numexpr': 'numexpr',
               'blosc2': 'blosc2', 'tables': 'tables'}
    errors = []
    for line in (PROJECT_ROOT / 'requirements.txt').read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        name, expected = line.split('==', 1)
        if name.lower() == 'nuitka' and not build:
            continue
        try:
            actual = metadata.version(name)
            if actual != expected:
                errors.append(f'{name}: expected {expected}, found {actual}')
            if name in modules:
                import_module(modules[name])
        except (metadata.PackageNotFoundError, ImportError, OSError, ValueError) as error:
            errors.append(f'{name}: {error}')
    if errors:
        raise RuntimeError('Python environment is not ready:\n  ' + '\n  '.join(errors)
                           + '\nRun bash scripts/setup_python.sh --prepare explicitly.')


@contextmanager
def environment_lock(exclusive=False):
    """Coordinate local preparation with builds, regardless of output overrides."""
    with ENVIRONMENT_LOCK.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            if stream.tell() == 0:
                stream.write(b'\0')
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(stream, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError('ArchVisual Python environment is in use; preparation and runs must not overlap') from error
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def configured_path(name, *aliases, default):
    for key in (name, *aliases):
        if key in os.environ:
            value = os.environ[key]
            if not value:
                raise ValueError(f'{key} cannot be empty')
            break
    else:
        value = default
    path = Path(value).expanduser()
    return (path if path.is_absolute() else PROJECT_ROOT / path).resolve()


def validate_output_path(path):
    path = Path(path).resolve()
    if PROJECT_ROOT.is_relative_to(path):
        raise ValueError(f'output must not contain the ArchVisual source directory: {path}')
    if path.is_relative_to(PROJECT_ROOT) and not path.is_relative_to(PROJECT_ROOT / '__output__'):
        raise ValueError(f'output inside the ArchVisual repository must be under __output__: {path}')
    return path


def output_root():
    return validate_output_path(configured_path(
        'ARCHVISUAL_OUTPUT_ROOT', 'ARCHEXPLOR_ARCHVISUAL_OUTPUT_ROOT',
        default=PROJECT_ROOT / '__output__'))


def static_root():
    return validate_output_path(configured_path(
        'ARCHVISUAL_STATIC_ROOT', 'ARCHEXPLOR_ARCHVISUAL_STATIC_ROOT',
        default=output_root() / 'staticfiles'))


def temp_root():
    return validate_output_path(configured_path(
        'ARCHVISUAL_TEMP_ROOT', 'ARCHEXPLOR_ARCHVISUAL_TEMP_ROOT',
        default=output_root() / 'tmp'))


def release_root():
    root = output_root()
    release = validate_output_path(configured_path(
        'ARCHVISUAL_RELEASE_DIR', 'ARCHEXPLOR_ARCHVISUAL_RELEASE_DIR',
        'ARCHEXPLOR_ARCHVISUAL_OUTPUT_DIR', default=root / 'releases'))
    for cleaned in (root / 'output', root / 'build', static_root(), root / '.release-staging'):
        # Ancestors are unsafe too: a build must not remove its release directory.
        if release.is_relative_to(cleaned) or cleaned.is_relative_to(release):
            raise ValueError(f'releases must be outside cleaned build/staging directories: {release}')
    return release


def prepare_environment():
    check_python_version()
    directory = PROJECT_ROOT / '.venv'
    if directory.is_symlink():
        raise ValueError('refusing to prepare a symlinked .venv; only the local environment is managed')
    with environment_lock(exclusive=True):
        if not directory.exists():
            venv.EnvBuilder(with_pip=True).create(directory)
        if not (directory / 'pyvenv.cfg').is_file():
            raise ValueError(f'{directory} is not a virtual environment')
        python = str(local_python())  # Preserve the venv entry; never resolve its symlink.
        subprocess.check_call([python, '-B', '-c',
                               'import sys; from pathlib import Path; '
                               'assert sys.version_info[:2] == (3, 10), "Python 3.10 required"; '
                               'assert sys.prefix != sys.base_prefix and '
                               'Path(sys.prefix).resolve() == Path(sys.argv[1]).resolve(), '
                               '"refusing to install into an environment outside ArchVisual .venv"',
                               str(directory)])
        subprocess.check_call([python, '-m', 'pip', 'install', '-r', str(PROJECT_ROOT / 'requirements.txt')])
        subprocess.check_call([python, '-B', str(Path(__file__)), 'check', '--build'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'prepare', 'shell'))
    parser.add_argument('--build', action='store_true', help='also check the Nuitka version')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare_environment()
    elif args.action == 'check':
        check_environment(build=args.build)
        print(f'ArchVisual Python ready: {sys.executable}')
    else:
        paths = {'ARCHVISUAL_OUTPUT_ROOT': output_root(), 'ARCHVISUAL_STATIC_ROOT': static_root(),
                 'ARCHVISUAL_TEMP_ROOT': temp_root(), 'ARCHVISUAL_RELEASE_DIR': release_root()}
        for name, value in paths.items():
            print(f'export {name}={shlex.quote(str(value))}')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
