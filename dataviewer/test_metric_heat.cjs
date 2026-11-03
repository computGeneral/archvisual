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
