"""ArchVisual's local environment; bootstrap and paths use only the standard library."""
import argparse
from contextlib import contextmanager
from importlib import import_module, metadata
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import venv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENVIRONMENT_LOCK = PROJECT_ROOT / '.archvisual-python.lock'
MIN_PYTHON = (3, 10)
REFERENCE_PYTHON = (3, 10)
DEFAULT_PYPI_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple'


def local_python():
    return PROJECT_ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def check_python_version():
    version = sys.version_info[:2]
    if version < MIN_PYTHON:
        raise RuntimeError('ArchVisual requires Python 3.10 or newer; select an interpreter with --python')
    if version != REFERENCE_PYTHON:
        print(f'WARNING: Python {version[0]}.{version[1]} differs from the reference Python 3.10; '
              'compatibility depends on the installed dependencies.', file=sys.stderr)


def requirements_path():
    return PROJECT_ROOT / 'requirements.txt'


def reference_requirements():
    """Read package names and reference versions from the shared pin file."""
    requirements = []
    for lineno, raw in enumerate(requirements_path().read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        name, separator, version = line.partition('==')
        if (not separator or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', name)
                or not re.fullmatch(r'[A-Za-z0-9.+!-]+', version)):
            raise ValueError(f'Invalid reference requirement at line {lineno}: {line}')
        requirements.append((name, version))
    if not requirements:
        raise ValueError('Reference requirements cannot be empty')
    return requirements


def check_environment(build=False):
    """Check the selected interpreter without installing or changing packages."""
    check_python_version()
    modules = {'django': 'django', 'django-cors-headers': 'corsheaders',
               'pandas': 'pandas', 'numpy': 'numpy', 'numexpr': 'numexpr',
               'blosc2': 'blosc2', 'tables': 'tables', 'nuitka': 'nuitka'}
    requirements = requirements_path()
    errors, differences = [], []
    for name, expected in reference_requirements():
        if name.lower() == 'nuitka' and not build:
            continue
        try:
            actual = metadata.version(name)
        except metadata.PackageNotFoundError:
            errors.append(f'{name}: package is not installed')
            continue
        if actual != expected:
            differences.append(f'{name}: reference {expected}, found {actual}')
        if name in modules:
            try:
                import_module(modules[name])
            except Exception as error:
                errors.append(f'{name}: import failed: {error}')
    if differences:
        print('WARNING: installed dependency versions differ from the reference:\n  '
              + '\n  '.join(differences), file=sys.stderr)
    if errors:
        raise RuntimeError(f'Python environment is not ready ({requirements.name}):\n  ' + '\n  '.join(errors)
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


def prepare_environment(index_url=DEFAULT_PYPI_INDEX_URL):
    check_python_version()
    if not index_url:
        raise ValueError('package index URL cannot be empty')
    package_names = [name for name, _ in reference_requirements()]
    directory = PROJECT_ROOT / '.venv'
    if directory.is_symlink():
        raise ValueError('refusing to prepare a symlinked .venv; only the local environment is managed')
    with environment_lock(exclusive=True):
        if not directory.exists():
            # Match `python -m venv` on POSIX. Copies lose stdlib discovery for
            # relocatable interpreters invoked through a launcher symlink (uv).
            venv.EnvBuilder(with_pip=True, symlinks=os.name != 'nt').create(directory)
        if not (directory / 'pyvenv.cfg').is_file():
            raise ValueError(f'{directory} is not a virtual environment')
        python = str(local_python())  # Preserve the venv entry; never resolve its symlink.
        subprocess.check_call([python, '-B', '-c',
                               'import sys; from pathlib import Path; '
                               f'assert sys.version_info[:2] >= {MIN_PYTHON!r}, "Python 3.10 or newer required"; '
                               'assert sys.prefix != sys.base_prefix and '
                               'Path(sys.prefix).resolve() == Path(sys.argv[1]).resolve(), '
                               '"refusing to install into an environment outside ArchVisual .venv"; '
                               f'assert sys.version_info[:2] == {sys.version_info[:2]!r}, '
                               '"existing .venv uses a different Python version; prepare a separate checkout or move it aside explicitly"',
                               str(directory)])
        subprocess.check_call([python, '-m', 'pip', 'install', '--index-url', index_url, *package_names])
        subprocess.check_call([python, '-B', str(Path(__file__)), 'check', '--build'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'prepare', 'shell'))
    parser.add_argument('--build', action='store_true', help='also check the Nuitka version')
    parser.add_argument('--index-url', default=None, help='package index URL for preparation')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare_environment(args.index_url if args.index_url is not None else DEFAULT_PYPI_INDEX_URL)
    elif args.action == 'check':
        if args.index_url is not None:
            parser.error('--index-url is only valid for preparation')
        check_environment(build=args.build)
        print(f'ArchVisual Python ready: {sys.executable} ({requirements_path().name})')
    else:
        if args.index_url is not None:
            parser.error('--index-url is only valid for preparation')
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
