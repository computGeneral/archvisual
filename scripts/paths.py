"""ArchVisual output paths, independent of the Python environment."""
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


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
