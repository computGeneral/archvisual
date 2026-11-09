/* Real pointer regression using the production H5 load, search and Plot paths.
 * NODE_PATH=<playwright modules> SEARCH_RESIZE_OUTPUT=<evidence directory>
 * node dataviewer/test_metric_search_resize.cjs [http://127.0.0.1:18145]
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:18145';
const output = process.env.SEARCH_RESIZE_OUTPUT || path.resolve(__dirname, '../__output__/metric_search_resize');
const fixture = path.resolve(__dirname, '../examples/metricview.h5');
const checks = [], errors = [];
const near = (a, b) => assert(Math.abs(a - b) < 1, `${a} != ${b}`);
const settle = frame => frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function geometry(frame) {
    return frame.locator('#MetricSelectDiv').evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
}
async function load(frame, panel = 1) {
    return frame.evaluate(async ({ fixture, panel }) => {
        setActivePanel(panel);
        const res = await fetch('/api/show/server_load', { method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: fixture, secondary: panel === 2 }) }).then(r => r.json());
        if (res.code !== 0) throw new Error(res.msg);
        ProcessH5(res, panel);
        return res.data.signal;
    }, { fixture, panel });
}
async function search(frame, expression = '.') {
    await frame.locator('#filterMetric').click();
    await frame.locator('#filterMetric').fill(expression);
    await frame.locator('#filterMetric').press('Enter');
}
async function drag(page, frame, axis, dx, dy, release = true) {
    const r = await frame.locator(`[data-metric-resize="${axis}"]`).boundingBox();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    if (release) await page.mouse.up();
    await settle(frame);
}
async function clean(frame) {
    assert.equal(await frame.locator('.metric-search-drag-shield').count(), 0);
    assert.equal(await frame.evaluate(() => document.documentElement.classList.contains('metric-search-resizing')), false);
}
async function bounded(frame) {
    const r = await geometry(frame);
    const view = await frame.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
    assert(r.x >= 0 && r.y >= 0 && r.x + r.width <= view.width + 1 && r.y + r.height <= view.height + 1);
}
(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.SEARCH_RESIZE_CHROME || '/usr/bin/google-chrome',
        headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('pageerror', error => errors.push(error.stack || error.message));
    try {
        await page.goto(base + '/metricviewer');
        const names = await load(page);
        await search(page);
        const initial = await geometry(page);
        near(initial.width, 800); near(initial.height, 300);
        assert.equal(await page.locator('[name="MetricCheckBox"]:visible').count(), names.length);
        const selection = await page.evaluate(() => CurMetricSelectList.slice());
        await drag(page, page, 'x', 150, 0);
        let r = await geometry(page);
        near(r.width, 950); near(r.height, 300); near(r.x, initial.x); near(r.y, initial.y);
        await drag(page, page, 'y', 0, 160);
        r = await geometry(page); near(r.width, 950); near(r.height, 460);
        await drag(page, page, 'xy', 100, 80);
        r = await geometry(page); near(r.width, 1050); near(r.height, 540);
        assert.deepEqual(await page.evaluate(() => CurMetricSelectList.slice()), selection);
        await clean(page);
        checks.push('800x300 default; real right/bottom/corner drags preserve anchor and selected metrics');
        await page.screenshot({ path: path.join(output, 'expanded.png') });

        await page.locator('[name="MetricCheckBox"]').first().uncheck();
        assert.equal(await page.evaluate(() => CurMetricSelectList.length), names.length - 1);
        await page.locator('[name="MetricSelectAllBox"]').uncheck();
        assert.equal(await page.evaluate(() => CurMetricSelectList.length), 0);
        await page.locator('[name="MetricSelectAllBox"]').check();
        assert.equal(await page.evaluate(() => CurMetricSelectList.length), names.length);
        await page.mouse.click(1450, 900);
        assert.equal(await page.locator('#MetricSelectDiv').isVisible(), false);
        await search(page);
        assert.deepEqual(await geometry(page), r);
        await load(page); await search(page);
        assert.deepEqual(await geometry(page), r);
        assert.equal(await page.locator('[data-metric-resize]').count(), 3);
        checks.push('checkbox/SelectAll/outside-close work; reopen and H5 reload retain size and handles');

        await drag(page, page, 'xy', -1300, -800);
        r = await geometry(page); near(r.width, 240); near(r.height, 120);
        const list = page.locator('#MetricSelectResults');
        assert(await list.evaluate(el => el.scrollHeight > el.clientHeight), 'real metric list must overflow');
        const box = await list.boundingBox();
        await page.mouse.move(box.x + 40, box.y + 50); await page.mouse.wheel(0, 250);
        await page.waitForFunction(() => document.getElementById('MetricSelectResults').scrollTop > 0);
        assert.deepEqual(await geometry(page), r);
        await drag(page, page, 'xy', 1700, 1200);
        await bounded(page); await clean(page);
        checks.push('240x120 minimum, independent result scrolling and viewport maximum');

        await drag(page, page, 'xy', -400, -300, false);
        await page.keyboard.press('Escape'); await clean(page);
        await page.locator('[name="MetricSelectAllBox"]').focus();
        await page.keyboard.press('Space');
        assert.equal(await page.evaluate(() => CurMetricSelectList.length), 0, 'keyboard selection after drag cancellation');
        await page.mouse.up();
        await drag(page, page, 'y', 0, -20, false);
        await page.evaluate(() => document.getElementById('MetricSelectDiv').style.display = 'none');
        await settle(page); await clean(page); await page.mouse.up();
        await search(page);
        await page.locator('[name="MetricSelectAllBox"]').uncheck();
        checks.push('Escape/hide release capture and shield; keyboard selection and the next mouse click still work');

        for (const mode of ['horizontal', 'vertical']) {
            await page.evaluate(mode => setSplitMode(mode), mode);
            await load(page, 2); await search(page);
            const before = await geometry(page);
            await page.evaluate(() => { setActivePanel(1); setActivePanel(2); });
            await search(page); assert.deepEqual(await geometry(page), before);
            await drag(page, page, 'y', 0, -30);
            await clean(page); await bounded(page);
        }
        checks.push('both split directions and active-panel list rebuilding retain usable drag handles');

        await page.evaluate(() => { setSplitMode('single'); setActivePanel(1); });
        for (const mode of ['line', 'heat']) {
            await page.locator('#metricMode').selectOption(mode);
            const escaped = '^' + names[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
            await search(page, escaped);
            const before = await geometry(page);
            await page.getByRole('button', { name: 'Plot', exact: true }).click();
            await page.waitForFunction(mode => mode === 'heat'
                ? !!document.querySelector('.heat-map .heat-status')?.textContent.includes('samples')
                : myChart.getOption().series.length > 0, mode);
            assert.equal(await page.locator('#MetricSelectDiv').isVisible(), false);
            await search(page, escaped); assert.deepEqual(await geometry(page), before);
        }
        checks.push('actual Line and Heat Plot requests succeed; Plot/reopen preserve popup size');

        await page.setViewportSize({ width: 200, height: 140 }); await settle(page); await bounded(page);
        await page.setViewportSize({ width: 1500, height: 1000 }); await settle(page);
        await page.reload(); await page.locator('#filterMetric').click();
        r = await geometry(page); near(r.width, 800); near(r.height, 300);
        checks.push('small viewport clamps below usual minimum; page refresh restores default size');

        await page.goto(base + '/crossviewer');
        const frame = await (await page.locator('#metricFrame').elementHandle()).contentFrame();
        await load(frame); await search(frame); await bounded(frame);
        await drag(page, frame, 'y', 0, 180);
        r = await geometry(frame); near(r.height, 480);
        await clean(frame); await bounded(frame);
        await frame.locator('[name="MetricCheckBox"]').first().uncheck();
        await page.setViewportSize({ width: 900, height: 600 }); await settle(frame); await bounded(frame);
        await page.screenshot({ path: path.join(output, 'embedded.png') });
        checks.push('Metric vs. Trace iframe supports dragging, selecting and resize bounds');
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, errors, fixture }, null, 2));
        console.log(JSON.stringify({ status: 'PASS', checks, errors }, null, 2));
    } catch (error) {
        await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'FAIL', checks, errors, failure: error.stack }, null, 2));
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
