/* Run with: node --test archvisual/dataviewer/test_metric_heat.cjs */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const heat = require('./static/js/metric_heat.js');

test('rows preserve requested order, exact samples, and deduplicate across groups', () => {
    const groups = { a: { Sig: ['port1', 'port0'] }, b: { Sig: ['port1'] } };
    const data = { a: { Sig: { port0: [0, 5, null], port1: [7, -2, 4] } }, b: { Sig: { port1: [7, -2, 4] } } };
    const before = JSON.stringify(data);
    const rows = heat.rowsFromGroups(groups, data, 3);
    assert.deepEqual(rows.map(r => r.name), ['port1', 'port0']);
    assert.deepEqual(rows.map(r => r.values), [[7, -2, 4], [0, 5, null]]);
    assert.equal(JSON.stringify(data), before);
});

test('normalization includes the full row, preserves raw values, and handles constants', () => {
    const row = { values: [-5, 5, 15], min: -5, max: 15 };
    assert.deepEqual(row.values.map(v => heat.colorValue(row, v, true)), [0, 0.5, 1]);
    assert.deepEqual(row.values, [-5, 5, 15]);
    for (const value of [0, 7, -3]) assert.equal(heat.colorValue({ min: value, max: value }, value, true), 0);
    assert.equal(heat.colorValue(row, null, true), null);
    assert.equal(heat.colorValue(row, 0, false), 0);
    assert.equal(heat.colorValue({ min: -1e308, max: 1e308 }, 0, true), 0.5);
});

test('shared bounds use every selected row and manual bounds remain explicit', () => {
    const rows = [{ min: -4, max: 12 }, { min: 0, max: 90 }];
    assert.deepEqual(heat.bounds(rows, false, '', ''), [-4, 90]);
    assert.deepEqual(heat.bounds(rows, false, '0', '25'), [0, 25]);
    assert.deepEqual(heat.bounds(rows, true, '', ''), [0, 1]);
    assert.deepEqual(heat.bounds([{ min: 0, max: 0 }], false, '', ''), [0, 1]);
    assert.deepEqual(heat.bounds([{ min: Infinity, max: -Infinity }], false, '', ''), [0, 1]);
    for (const [a,b] of [['2','1'], ['1','1'], ['NaN','4'], ['0','Infinity']]) {
        assert.throws(() => heat.bounds(rows, false, a, b));
    }
});

test('invalid lengths and unsupported values fail explicitly', () => {
    for (const values of [[1], [1, 'bad'], [1, NaN], [1, Infinity]]) {
        assert.throws(() => heat.rowsFromGroups({ g: { Sig: ['p'] } }, { g: { Sig: { p: values } } }, 2));
    }
    assert.equal(heat.escapeHtml('<port & "name">'), '&lt;port &amp; &quot;name&quot;&gt;');
});

function row(values) {
    return heat.rowsFromGroups({ g: { Sig: ['p'] } }, { g: { Sig: { p: values } } }, values.length)[0];
}

test('full-file statistics include zero, skip missing values and preserve the samples', () => {
    const values = Object.freeze([0, null, 6, -2, null]);
    const r = row(values);
    assert.deepEqual([r.min, r.avg, r.max, r.validCount], [-2, 4 / 3, 6, 3]);
    assert.equal(r.values, values);
    assert.deepEqual(values, [0, null, 6, -2, null]);
    for (const value of [0, 7, -3]) {
        const r = row([value, null, value]);
        assert.deepEqual([r.min, r.avg, r.max, r.validCount], [value, value, value, 2]);
    }
    assert.equal(row([0, 0.5, 1, null]).avg, 0.5);
});

test('statistics handle missing rows, cancellation and finite values whose sum overflows', () => {
    for (const values of [[], [null], [null, null]]) {
        const r = row(values);
        assert.equal(r.validCount, 0); assert.equal(r.avg, null);
        assert.equal(r.min, Infinity); assert.equal(r.max, -Infinity);
    }
    assert.equal(row([1e16, 1, -1e16]).avg, 1 / 3);
    assert.equal(row([1e308, 1, -1e308]).avg, 1 / 3);
    assert.equal(row([1e308, 1e308]).avg, 1e308);
    assert.equal(row([-Number.MAX_VALUE, -Number.MAX_VALUE]).avg, -Number.MAX_VALUE);
});

function counted(values) {
    let reads = 0;
    const array = new Proxy(Object.freeze(values), { get(target, key, receiver) {
        if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) ++reads;
        return Reflect.get(target, key, receiver);
    } });
    return { array, reads: () => reads };
}
function reuseRow(values, reusable) {
    return heat.rowsFromGroups({ g: { Sig: ['p'] } }, { g: { Sig: { p: values } } }, values.length, reusable)[0];
}

test('identical validated arrays reuse exact statistics without reading a sample', () => {
    const c = counted([-2, null, 0, 6]), original = reuseRow(c.array);
    assert.equal(c.reads(), 8);
    const reused = reuseRow(c.array, new Map([['p', original]]));
    assert.equal(c.reads(), 8); assert.deepEqual(reused, original);
    assert.notEqual(reused, original); assert.equal(reused.values, original.values);
    reused.min = -100;
    assert.equal(original.min, -2, 'row metadata is independent between maps');
    assert.deepEqual(heat.bounds([original], false, '', ''), [-2, 6]);
});

test('partially repeated selections scan only new arrays and preserve order/deduplication', () => {
    const p = counted([2, 4]), q = counted([0, null]);
    const reusable = new Map([['p', reuseRow(p.array)]]), before = p.reads();
    const rows = heat.rowsFromGroups({ g: { Sig: ['q', 'p'] }, h: { Sig: ['p'] } },
        { g: { Sig: { p: p.array, q: q.array } }, h: { Sig: { p: p.array } } }, 2, reusable);
    assert.deepEqual(rows.map(r => r.name), ['q', 'p']);
    assert.equal(p.reads(), before); assert.equal(q.reads(), 4);
    assert.deepEqual(rows.map(r => [r.min, r.avg, r.max, r.validCount]), [[0, 0, 0, 1], [2, 3, 4, 2]]);
    assert.equal(reusable.size, 1, 'helper does not retain new results');
});

test('same name and length with new array identity always validates and calculates again', () => {
    const old = reuseRow([1, 3]), reusable = new Map([['p', old]]), fresh = counted([20, 40]);
    const result = reuseRow(fresh.array, reusable);
    assert.equal(fresh.reads(), 4); assert.deepEqual([result.min, result.avg, result.max], [20, 30, 40]);
    for (const values of [[1, 'bad'], [1, NaN], [1, Infinity], [1, undefined], [1, true]]) {
        assert.throws(() => reuseRow(values, reusable), /Invalid numeric value/);
    }
    assert.deepEqual(old.values, [1, 3]);
});

test('length and metric identity guards remain active even with reusable statistics', () => {
    const values = [1, 3], old = reuseRow(values), reusable = new Map([['p', old]]);
    assert.throws(() => heat.rowsFromGroups({ g: { Sig: ['p'] } }, { g: { Sig: { p: values } } }, 3, reusable), /Sample count/);
    const c = counted([4, 8]);
    const renamed = reuseRow(c.array, new Map([['p', { ...old, name: 'other', values: c.array }]]));
    assert.equal(c.reads(), 4); assert.equal(renamed.avg, 6);
});

test('reused edge-case statistics retain null, signed zero, cancellation and overflow behavior', () => {
    for (const values of [[], [null, null], [-0, 0, null], [-3, -3], [1e16, 1, -1e16],
        [1e308, 1, -1e308], [1e308, 1e308], [-Number.MAX_VALUE, -Number.MAX_VALUE]]) {
        const c = counted(values), original = reuseRow(c.array), before = c.reads();
        const reused = reuseRow(c.array, new Map([['p', original]]));
        assert.deepEqual(reused, original); assert.equal(c.reads(), before);
        for (const key of ['min', 'avg', 'max', 'validCount']) assert(Object.is(reused[key], original[key]));
    }
});

test('statistics reuse is caller-scoped with no implicit persistent cache', () => {
    const c = counted([0, 2]), first = reuseRow(c.array);
    reuseRow(c.array); assert.equal(c.reads(), 8);
    reuseRow(c.array, new Map()); assert.equal(c.reads(), 12);
    reuseRow(c.array, new Map([['p', first]])); assert.equal(c.reads(), 12);
});
