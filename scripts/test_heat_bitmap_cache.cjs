'use strict';

// Pure Node control-flow checks. Fake canvases record calls; they do not
// validate browser raster pixels, GPU allocation, or the pending low-DPR choice.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(__dirname, '../dataviewer/static/js/metric_heat_canvas.js');
const output = process.argv[2] ? path.resolve(process.argv[2]) : null;
const api = require(source);
const result = {
    status: 'RUNNING',
    source,
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
    node: process.version,
    scope: 'Pure Node renderer lifecycle and optional-cache failure injection',
    exclusions: ['Browser RGBA and DOM composition', 'Real GPU or memory exhaustion', 'DPR below 1 semantics'],
    checks: []
};

function environment(mode) {
    let number = 0, fail = true, paintFailure = false;
    const elements = [], selected = [];
    const error = name => Object.assign(new Error('injected optional cache failure'), { name });
    function element(tag) {
        const n = tag === 'canvas' ? ++number : 0;
        const e = { tag, n, className: '', style: {}, width: 0, height: 0,
            innerHTML: '', offsetWidth: 0, offsetHeight: 0,
            remove() { this.removed = true; } };
        const ctx = {
            save() {}, restore() {}, setTransform() {}, clearRect() {}, beginPath() {}, rect() {}, clip() {},
            fills: 0,
            fillRect() { ++this.fills; },
            isContextLost() { return mode === 'lost-cache' && e.n === 4 && this.lost; },
            drawImage(sourceCanvas) {
                if (fail && ((mode === 'cache-copy' && e.n === 4) ||
                    (mode === 'visible-copy' && e.n === 1 && sourceCanvas.n === 4))) {
                    throw error('InvalidStateError');
                }
                if (fail && mode === 'coding-error' && e.n === 4) {
                    throw new TypeError('injected coding defect');
                }
            }
        };
        e.ctx = ctx;
        e.getContext = () => fail && mode === 'null-context' && e.n === 4 ? null : ctx;
        if (mode === 'allocation' && e.n === 4) {
            let width = 0;
            Object.defineProperty(e, 'width', {
                get() { return width; },
                set(value) {
                    if (fail && value > 0) throw new RangeError('injected allocation failure');
                    width = value;
                }
            });
        }
        elements.push(e);
        return e;
    }
    global.document = { createElement: element };
    global.requestAnimationFrame = () => 1;
    global.cancelAnimationFrame = () => {};
    const host = {
        children: [], listeners: {},
        appendChild(e) { this.children.push(e); },
        addEventListener(key, callback) { this.listeners[key] = callback; },
        removeEventListener(key) { delete this.listeners[key]; },
        getBoundingClientRect() { return { left: 0, top: 0 }; }
    };
    const options = {
        echarts: {
            color: {
                parse: () => [10, 20, 30, 1],
                fastLerp(t, palette, out) { out.splice(0, 4, 10, 20, 30, 1); },
                stringify: () => 'rgba(10,20,30,1)', liftColor: color => color
            },
            number: { linearMap: () => .5 }
        },
        palette: ['#abc'],
        colorValue(row, value) { if (paintFailure) throw new Error('normal paint failure'); return value; },
        format: () => '', cursor() {}, hideIndicator() {}, showIndicator() {},
        select(value) { selected.push(value); }
    };
    const rows = Array.from({ length: 4 }, (_, r) => ({ values: Array.from({ length: 32 }, (_, c) => r * 100 + c) }));
    const times = Array.from({ length: 32 }, (_, i) => i);
    const frame = (firstCol = 0) => ({
        rows, times, normal: false, scale: [0, 400], firstCol, lastCol: firstCol + 12, firstRow: 0, lastRow: 4,
        left: 20, top: 24, width: 240, height: 120, gridWidth: 192, gridHeight: 64,
        columnWidth: 16, bandWidth: 16, bandHeight: 16,
        x: Array.from({ length: 12 }, (_, i) => 28 + 16 * i), y: [32, 48, 64, 80], dpr: 1, hoverLayer: true
    });
    return { host, options, frame, elements, selected,
        allowCache() { fail = false; }, breakPaint() { paintFailure = true; }, canvases() { return number; } };
}

function check(name, run) {
    try { run(); result.checks.push({ name, status: 'PASS' }); }
    catch (error) { result.checks.push({ name, status: 'FAIL', error: error.stack }); throw error; }
}

try {
    check('Default reuse and releaseCache preserve display and click frame', () => {
        const e = environment('normal'), renderer = api.create(e.host, e.options);
        renderer.render(e.frame()); renderer.render(e.frame(1));
        assert.equal(renderer.bitmapStats().reuse, 1);
        assert.equal(renderer.bitmapStats().collectPaintCounts, false);
        assert.equal(renderer.bitmapStats().paintCandidates, 0);
        const main = e.host.children[0], dimensions = [main.width, main.height], fills = main.ctx.fills;
        renderer.releaseCache();
        assert.equal(renderer.bitmapStats().cacheBytes, 0);
        assert.deepEqual([main.width, main.height], dimensions);
        assert.equal(main.ctx.fills, fills);
        e.host.listeners.click({ clientX: 60, clientY: 32 });
        assert.equal(e.selected[0][4], 3);
        renderer.render(e.frame(2));
        assert.equal(renderer.bitmapStats().last.reason, 'empty-cache');
        renderer.suspend(); assert.equal(renderer.bitmapStats().cacheBytes, 0); renderer.dispose();
    });
    check('Full mode allocates no cache and detailed counting requires opt-in', () => {
        const e = environment('normal'), renderer = api.create(e.host, { ...e.options, bitmapReuse: false });
        renderer.render(e.frame()); renderer.render(e.frame(1));
        assert.equal(e.canvases(), 3);
        assert.equal(renderer.bitmapStats().reuse, 0);
        assert.equal(renderer.bitmapStats().cacheBytes, 0);
        renderer.bitmapStats(true); renderer.render(e.frame(2));
        assert(renderer.bitmapStats().paintCandidates > 0);
    });
    for (const mode of ['null-context', 'allocation', 'cache-copy']) {
        check('Optional cache failure degrades and can retry after release: ' + mode, () => {
            const e = environment(mode), renderer = api.create(e.host, e.options);
            renderer.render(e.frame());
            assert.equal(renderer.bitmapStats().cacheFailures, 1, mode);
            assert.equal(renderer.bitmapStats().cacheBytes, 0);
            renderer.render(e.frame(1));
            assert.equal(renderer.bitmapStats().last.reason, 'cache-unavailable');
            e.allowCache(); renderer.releaseCache(); renderer.render(e.frame(2));
            assert(renderer.bitmapStats().cacheBytes > 0);
        });
    }
    check('Failed bitmap-to-visible copy performs full paint', () => {
        const e = environment('visible-copy'), renderer = api.create(e.host, e.options);
        renderer.render(e.frame()); const before = e.host.children[0].ctx.fills;
        renderer.render(e.frame(1));
        assert.equal(renderer.bitmapStats().last.reason, 'cache-copy-failed');
        assert.equal(renderer.bitmapStats().full, 2);
        assert.equal(renderer.bitmapStats().reuse, 0);
        assert.equal(renderer.bitmapStats().cacheBytes, 0);
        assert(e.host.children[0].ctx.fills > before);
    });
    check('Lost optional cache context performs full paint', () => {
        const e = environment('lost-cache'), renderer = api.create(e.host, e.options);
        renderer.render(e.frame()); e.elements.find(x => x.n === 4).ctx.lost = true;
        renderer.render(e.frame(1));
        assert.equal(renderer.bitmapStats().last.reason, 'cache-copy-failed');
        assert.equal(renderer.bitmapStats().cacheBytes, 0);
    });
    check('Optional cache coding TypeError is not swallowed', () => {
        const e = environment('coding-error'), renderer = api.create(e.host, e.options);
        assert.throws(() => renderer.render(e.frame()), TypeError);
    });
    check('Normal paint failure is not swallowed', () => {
        const e = environment('normal'), renderer = api.create(e.host, e.options);
        e.breakPaint(); assert.throws(() => renderer.render(e.frame()), /normal paint failure/);
    });
    check('Fractional native pointer clicks remain precise and cannot survive a new/cancelled/synthetic gesture', () => {
        const originalWindow = global.window; global.window = {PointerEvent: function() {}};
        try {
            const e = environment('normal'), renderer = api.create(e.host, e.options), f = e.frame();
            Object.assign(f, {left:340, gridWidth:12, columnWidth:1, bandWidth:1, dpr:1.2999999523162842,
                x:Array.from({length:12}, (_, i) => 340.5 + i)});
            renderer.render(f);
            const up = {clientX:340.5,clientY:32,pointerId:1,button:0,isTrusted:true};
            const click = {clientX:340,clientY:32,pointerId:1,detail:1,isTrusted:true};
            e.host.listeners.pointerup(up); e.host.listeners.click(click);
            assert.equal(e.selected.length, 1); assert.deepEqual(e.selected[0].slice(3), [0,0,0]);
            e.host.listeners.click(click); assert.equal(e.selected.length, 1, 'pointerup is consumed once');
            for (const reset of ['pointerdown','pointercancel','pointerleave']) {
                e.host.listeners.pointerup(up); e.host.listeners[reset]({}); e.host.listeners.click(click);
                assert.equal(e.selected.length, 1, reset + ' clears the old fractional hit');
            }
            e.host.listeners.pointerup(up); e.host.listeners.click({...click,isTrusted:false});
            assert.equal(e.selected.length, 1, 'synthetic click does not use native pointerup');
            e.host.listeners.pointerup({...up,isTrusted:false}); e.host.listeners.click(click);
            assert.equal(e.selected.length, 1, 'synthetic pointerup does not supply native coordinates');
            renderer.dispose(); assert.equal(Object.keys(e.host.listeners).length,0);
        } finally {if (originalWindow === undefined) delete global.window; else global.window = originalWindow;}
    });
    assert.equal(result.checks.length, 10);
    result.status = 'PASS';
} catch (error) {
    result.status = 'FAIL'; result.failure = error.stack; process.exitCode = 1;
} finally {
    if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ status: result.status, checks: result.checks.length, sourceSha256: result.sourceSha256, output }));
}
