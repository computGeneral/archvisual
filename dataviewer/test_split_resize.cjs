/* Real mouse regression. Uses the checked-in H5 and a small Catapult trace.
 * NODE_PATH=<playwright modules> node dataviewer/test_split_resize.cjs [base URL]
 * SPLIT_TEST_OUTPUT selects the evidence directory; no source fixtures written.
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:18137';
const output = process.env.SPLIT_TEST_OUTPUT || path.resolve(__dirname, '../__output__/split_resize');
const fixture = path.resolve(__dirname, '../examples/metricview.h5');
const checks = [], errors = [];
const near = (a, b, message, tolerance = 1) => assert(Math.abs(a - b) <= tolerance, `${message}: ${a} != ${b}`);
async function settle(frame) { await frame.waitForTimeout(250); }
async function child(frame, selector) { return (await frame.locator(selector).elementHandle()).contentFrame(); }
async function sizes(frame, direction = 'horizontal', first = '#panel1', second = '#panel2') {
    return frame.evaluate(({ direction, first, second }) => {
        const key = direction === 'horizontal' ? 'width' : 'height';
        const a = document.querySelector(first).getBoundingClientRect()[key];
        const b = document.querySelector(second).getBoundingClientRect()[key];
        return { a, b, ratio: a / (a + b) };
    }, { direction, first, second });
}
async function drag(page, frame, direction, ratio, release = true) {
    const active = await frame.evaluate(() => window.activePanel);
    const rect = await frame.locator('#splitContainer').boundingBox();
    const handle = await frame.locator('#splitContainer > .split-resizer').boundingBox();
    near(direction === 'horizontal' ? handle.width : handle.height, 2, 'separator hit area is 2 CSS px', 0.01);
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(direction === 'horizontal' ? rect.x + 1 + (rect.width - 2) * ratio : x,
        direction === 'vertical' ? rect.y + 1 + (rect.height - 2) * ratio : y, { steps: 12 });
    if (release) await page.mouse.up();
    await settle(frame);
    assert.equal(await frame.evaluate(() => window.activePanel), active, 'drag retains active panel');
}
async function clean(frame) {
    assert.equal(await frame.locator('.split-drag-shield').count(), 0);
    assert.equal(await frame.evaluate(() => document.documentElement.classList.contains('split-dragging')), false);
}
async function modes(page, frame, label) {
    await frame.evaluate(() => setSplitMode('vertical')); await settle(frame);
    await frame.locator('.split-resizer').dblclick(); await settle(frame);
    await frame.evaluate(() => setSplitMode('horizontal')); await settle(frame);
    await drag(page, frame, 'horizontal', 0.67);
    near((await sizes(frame)).ratio, 0.67, label + ' horizontal ratio', 0.003);
    await frame.evaluate(() => setSplitMode('vertical')); await settle(frame);
    near((await sizes(frame, 'vertical')).ratio, 0.5, label + ' initial vertical ratio', 0.003);
    await drag(page, frame, 'vertical', 0.38);
    near((await sizes(frame, 'vertical')).ratio, 0.38, label + ' vertical ratio', 0.003);
    await frame.evaluate(() => setSplitMode('single')); await settle(frame);
    assert.equal(await frame.locator('.split-resizer').isVisible(), false);
    await frame.evaluate(() => setSplitMode('horizontal')); await settle(frame);
    near((await sizes(frame)).ratio, 0.67, label + ' horizontal restore', 0.003);
    await frame.evaluate(() => setSplitMode('vertical')); await settle(frame);
    near((await sizes(frame, 'vertical')).ratio, 0.38, label + ' vertical restore', 0.003);
    await frame.locator('.split-resizer').dblclick(); await settle(frame);
    near((await sizes(frame, 'vertical')).ratio, 0.5, label + ' double click reset', 0.003);
    const keyboardBefore = await sizes(frame, 'vertical');
    await frame.locator('.split-resizer').focus();
    await frame.locator('.split-resizer').press('ArrowDown'); await settle(frame);
    near((await sizes(frame, 'vertical')).a, keyboardBefore.a + 10, label + ' keyboard adjustment');
    for (const direction of ['horizontal', 'vertical']) {
        await frame.evaluate(mode => setSplitMode(mode), direction); await settle(frame);
        await drag(page, frame, direction, 0);
        near((await sizes(frame, direction)).a, 120, label + ' first minimum');
        await drag(page, frame, direction, 1);
        near((await sizes(frame, direction)).b, 120, label + ' second minimum');
    }
    await clean(frame);
    checks.push(label + ': both drag directions, per-direction restore, Single, double-click and 120px bounds');
}
async function loadMetric(frame, panel) {
    await frame.waitForFunction(() => window.metricHeat);
    await frame.evaluate(async ({ fixture, panel }) => {
        const meta = await fetch('/api/show/server_load', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: fixture, secondary: panel === 2 }) }).then(r => r.json());
        if (meta.code !== 0) throw Error(meta.msg);
        ProcessH5(meta, panel); setActivePanel(panel);
        (panel === 2 ? CurMetricSelectList2 : CurMetricSelectList).push(meta.data.signal[0]);
    }, { fixture, panel });
    await frame.locator('#filterMetricGroup').fill('Split group ' + panel);
    await frame.getByRole('button', { name: 'Plot', exact: true }).click();
    await frame.waitForFunction(panel => getPanelChart(panel).getOption().series.some(s => s.data.length), panel);
}
async function lineState(frame) {
    return frame.evaluate(() => [myChart, myChart2].filter(Boolean).map(chart => {
        const o = chart.getOption();
        return { data: o.series.map(s => s.data), zoom: o.dataZoom.map(z => [z.start, z.end, z.startValue, z.endValue]) };
    }));
}
async function loadTrace(frame) {
    await frame.waitForFunction(() => window.profilingView && profilingView.setActiveTrace);
    await frame.evaluate(() => profilingView.setActiveTrace('split.json', JSON.stringify({ traceEvents: [
        { ph: 'X', name: 'Split resize workload', pid: 1, tid: 1, ts: 0, dur: 20000 }
    ] })));
    await frame.waitForFunction(() => window._tview && _tview.model && !_tview.model.bounds.isEmpty);
    await frame.waitForTimeout(800);
}
async function traceBounds(frame) {
    return frame.evaluate(() => {
        const dt = _tview.viewport_.currentDisplayTransform, width = _tview.modelTrackContainer_.canvas.width;
        return [dt.xViewToWorld(0), dt.xViewToWorld(width)];
    });
}
async function sameTrace(frame, before) {
    const after = await traceBounds(frame);
    before.forEach((value, index) => near(after[index], value, 'Trace world bounds preserved', 1e-7));
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.SPLIT_TEST_CHROME || '/usr/bin/google-chrome',
        headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    let page;
    try {
        page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
        page.on('pageerror', error => errors.push(error.stack || error.message));
        await page.goto(base + '/metricviewer'); await loadMetric(page, 1);
        await page.evaluate(() => setSplitMode('horizontal')); await loadMetric(page, 2);
        await page.evaluate(() => {
            [myChart, myChart2].forEach(chart => chart.dispatchAction({ type: 'dataZoom', start: 20, end: 75 }));
            window.splitMessages = []; const post = bc.postMessage.bind(bc);
            bc.postMessage = message => { splitMessages.push(message); post(message); };
        });
        const before = await lineState(page);
        await modes(page, page, 'Metric Line');
        assert.deepEqual(await lineState(page), before);
        assert.equal(await page.evaluate(() => splitMessages.length), 0);
        assert(await page.evaluate(() => [myChart, myChart2].every(c => c.getWidth() === c.getDom().clientWidth)));
        checks.push('Line data, zoom and active panel retained; both charts resized; no sync broadcast');

        await page.evaluate(() => setSplitMode('horizontal')); await settle(page);
        for (const panel of [1, 2]) {
            await page.evaluate(panel => setActivePanel(panel), panel);
            await page.locator('#metricMode').selectOption('heat');
            await page.waitForFunction(panel => document.querySelector(`.heat-host[data-panel="${panel}"] .heat-status`).textContent.includes('samples'), panel);
            await page.evaluate(panel => metricHeat.plot(Object.values(metricHeat.selection(panel))[0].Sig, panel), panel);
            await page.waitForFunction(panel => {
                const maps = Array.from(document.querySelectorAll(`.heat-host[data-panel="${panel}"] .heat-map`));
                return maps.length === 2 && maps.every(map => map.querySelector('.heat-status').textContent.includes('samples'));
            }, panel);
        }
        await modes(page, page, 'Metric Heat');
        const heatState = () => page.evaluate(() => Array.from(document.querySelectorAll('.heat-host')).map(h => ({
            selection: metricHeat.selection(Number(h.dataset.panel)),
            count: h.querySelectorAll('.heat-map').length,
            sidebar: getComputedStyle(h).getPropertyValue('--heat-sidebar-width')
        })));
        const heat = await heatState();
        await page.evaluate(() => setSplitMode('horizontal')); await drag(page, page, 'horizontal', 0.5);
        assert.deepEqual(await heatState(), heat);
        await page.evaluate(() => {
            window.splitPaints = 0;
            document.querySelectorAll('.heat-canvas').forEach(e => echarts.getInstanceByDom(e).on('rendered', () => splitPaints++));
        });
        await settle(page); const paints = await page.evaluate(() => splitPaints);
        await page.waitForTimeout(700); assert.equal(await page.evaluate(() => splitPaints), paints);
        await page.screenshot({ path: path.join(output, 'metric-heat.png') });
        checks.push('Heat retains Plot groups/sidebar settings and is idle after layout settles');

        await drag(page, page, 'horizontal', 0.6, false);
        await page.keyboard.press('Escape'); await page.mouse.up(); await clean(page);
        await drag(page, page, 'horizontal', 0.4, false);
        await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up(); await clean(page);
        await drag(page, page, 'horizontal', 0.6, false);
        await page.evaluate(() => document.querySelector('.split-resizer').dispatchEvent(new PointerEvent('pointercancel')));
        await page.mouse.up(); await clean(page);
        await page.setViewportSize({ width: 230, height: 190 }); await settle(page);
        let small = await sizes(page); assert(small.a > 0 && small.b > 0); near(small.ratio, 0.5, 'narrow viewport bounds', 0.01);
        await page.setViewportSize({ width: 1600, height: 950 }); await settle(page);
        near((await sizes(page)).ratio, 0.6, 'ratio restored after window resize', 0.003);
        await page.reload(); await page.evaluate(() => setSplitMode('horizontal')); await settle(page);
        near((await sizes(page)).ratio, 0.5, 'refresh defaults', 0.003);
        checks.push('Escape/blur/pointer cancellation cleanup, small viewport fallback, window resize and refresh');

        await page.goto(base + '/traceviewer');
        let trace1 = await child(page, '#catapult_frame1'); await loadTrace(trace1);
        await page.evaluate(() => setSplitMode('horizontal')); await settle(page);
        let trace2 = await child(page, '#catapult_frame2'); await loadTrace(trace2);
        const bounds1 = await traceBounds(trace1), bounds2 = await traceBounds(trace2);
        await modes(page, page, 'Trace');
        await sameTrace(trace1, bounds1); await sameTrace(trace2, bounds2);
        checks.push('Both loaded Trace timelines preserve world bounds while resizing and switching layouts');

        for (const dpr of [1, 2]) {
            const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: dpr });
            page = await context.newPage(); page.on('pageerror', error => errors.push(error.stack || error.message));
            await page.goto(base + '/crossviewer');
            const metric = await child(page, '#metricFrame'), traceParent = await child(page, '#traceFrame');
            const trace = await child(traceParent, '#catapult_frame1');
            await loadMetric(metric, 1); await loadTrace(trace);
            const bounds = await traceBounds(trace), line = await lineState(metric);
            await metric.evaluate(() => { window.splitMessages = []; bc.postMessage = message => splitMessages.push(message); });
            await traceParent.evaluate(() => { window.splitMessages = []; bc.postMessage = message => splitMessages.push(message); });
            await drag(page, page, 'horizontal', 0.32);
            near((await sizes(page, 'horizontal', '#metricPanel', '#tracePanel')).ratio, 0.32, 'outer split', 0.003);
            await sameTrace(trace, bounds); assert.deepEqual(await lineState(metric), line);
            await metric.evaluate(() => setSplitMode('horizontal')); await settle(metric);
            // Drag beyond the embedded document into its sibling iframe, then
            // return without releasing: pointer capture must remain attached.
            await drag(page, metric, 'horizontal', 0.5, false);
            await page.mouse.move(1400, 500, { steps: 12 });
            const inner = await metric.locator('#splitContainer').boundingBox();
            await page.mouse.move(inner.x + 1 + (inner.width - 2) * 0.55, inner.y + inner.height / 2, { steps: 12 });
            await page.mouse.up(); await settle(metric); await clean(metric);
            near((await sizes(metric)).ratio, 0.55, 'nested drag returns from sibling iframe', 0.01);
            near((await sizes(page, 'horizontal', '#metricPanel', '#tracePanel')).ratio, 0.32, 'inner drag leaves outer ratio', 0.003);
            await drag(page, page, 'horizontal', 0.55);
            await modes(page, traceParent, 'Embedded Trace DPR ' + dpr);
            await sameTrace(trace, bounds);
            assert.equal(await metric.evaluate(() => splitMessages.length), 0);
            assert.equal(await traceParent.evaluate(() => splitMessages.length), 0);
            await page.screenshot({ path: path.join(output, `cross-dpr-${dpr}.png`) });
            checks.push(`Nested iframe drag and independent ratios, stable Line/Trace ranges and no resize broadcasts at DPR ${dpr}`);
            await context.close();
        }
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, errors }, null, 2));
        console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
    } catch (error) {
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'FAIL', checks, errors, failure: error.stack }, null, 2));
        if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
