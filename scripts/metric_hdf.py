"""Read metric H5 files, avoiding pandas' full-block copy for a known layout.

Only a single float64 fixed block with ordinary string columns and string/integer
sample labels is recognized. Everything else keeps the normal pandas reader.
No pandas internals or process-wide options/functions are changed.
"""
import numpy as np
import pandas as pd


_FRAME_ATTRIBUTES = {
    'pandas_type', 'pandas_version', 'ndim', 'nblocks', 'encoding', 'errors',
    'axis0_variety', 'axis1_variety', 'block0_items_variety',
}
_INDEX_ATTRIBUTES = {'kind', 'name', 'transposed'}
_CHILDREN = {'axis0', 'axis1', 'block0_items', 'block0_values'}


def _plain_index(node, *, string_only=False):
    """Decode only regular labels whose pandas semantics are unambiguous."""
    attrs = node._v_attrs
    if (len(node.shape) != 1 or not node.shape[0]
            or not set(attrs._f_list('user')) <= _INDEX_ATTRIBUTES):
        return None
    name = getattr(attrs, 'name', None)
    if name is not None and not isinstance(name, str):
        return None
    if attrs.kind == 'string' and node.dtype.kind == 'S':
        labels = [value.decode('utf-8', errors='strict') for value in node.read()]
        # pandas treats the on-disk string "nan" as a missing label. Let its
        # reader handle that representation and any index inference it needs.
        if 'nan' in labels:
            return None
        labels = np.asarray(labels, dtype=object)
    elif not string_only and attrs.kind == 'integer' and node.dtype.kind in 'iu':
        labels = node.read()
    else:
        return None
    return pd.Index(labels, name=name)


def _fixed_layout(store):
    """Return validated metadata and the value node, before reading the matrix."""
    import tables

    group = store.get_node('/data')
    if not isinstance(group, tables.Group):
        return None
    attrs = group._v_attrs
    if (not set(attrs._f_list('user')) <= _FRAME_ATTRIBUTES
            or attrs.pandas_type != 'frame' or attrs.ndim != 2 or attrs.nblocks != 1
            or attrs.encoding not in ('UTF-8', 'utf-8') or attrs.errors != 'strict'
            or any(getattr(attrs, name + '_variety') != 'regular'
                   for name in ('axis0', 'axis1', 'block0_items'))
            or set(group._v_children) != _CHILDREN):
        return None
    nodes = {name: group._f_get_child(name) for name in _CHILDREN}
    if any(type(node) not in (tables.Array, tables.CArray) or node.flavor != 'numpy'
           for node in nodes.values()):
        return None
    values = nodes['block0_values']
    if (values.dtype != np.dtype('float64') or len(values.shape) != 2
            or set(values._v_attrs._f_list('user')) != {'transposed'}
            or not isinstance(values._v_attrs.transposed, (bool, np.bool_))
            or not values._v_attrs.transposed):
        return None
    columns = _plain_index(nodes['axis0'], string_only=True)
    index = _plain_index(nodes['axis1'])
    items = _plain_index(nodes['block0_items'], string_only=True)
    if (columns is None or index is None or items is None
            or not columns.is_unique or not columns.identical(items)
            or values.shape != (len(index), len(columns))):
        return None
    return index, columns, values


def _read_data(store):
    import tables

    try:
        layout = _fixed_layout(store)
    except (AttributeError, KeyError, TypeError, ValueError, tables.NoSuchNodeError):
        # Missing/unrecognized metadata or label encoding uses pandas' normal
        # interpretation, including its errors for malformed files.
        layout = None
    if layout is None:
        return store['data']
    index, columns, node = layout
    # This is an eager, owned NumPy allocation; closing HDFStore cannot invalidate
    # the DataFrame. I/O/allocation errors propagate, without rereading the file.
    values = node.read()
    return pd.DataFrame(values, index=index, columns=columns, copy=False)


def read_metric_hdf(path):
    """Load data and optional config, closing the file before returning either."""
    with pd.HDFStore(path, mode='r') as store:
        data = _read_data(store)
        try:
            config = store['config']
        except KeyError:
            config = pd.DataFrame()
    return data, config
