/* Run against a local ArchVisual server with Playwright and Chrome installed:
 * node archvisual/dataviewer/test_trace_metric_sync.cjs [http://127.0.0.1:8097]
 * Uses actual keyboard events, the example H5, and a Catapult trace fixture.
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.argv[2] || 'http://127.0.0.1:8097';
const output = process.env.TRACE_SYNC_TEST_OUTPUT || path.resolve(__dirname, '../../__output__/archvisual/trace_metric_sync');
const fixture = path.resolve(__dirname, '../examples/metricview.h5');
const trace = JSON.stringify({ traceEvents: [
    { ph: 'X', name: 'keyboard sync workload', pid: 1, tid: 1, ts: 0, dur: 20000 }
] });

async function childFrame(parent, selector) {
    return (await parent.locator(selector).elementHandle()).contentFrame();
}
async function loadTrace(frame) {
    await frame.waitForFunction(() => window.profilingView && profilingView.setActiveTrace);
    await frame.evaluate(trace => profilingView.setActiveTrace('keyboard-sync.json', trace), trace);
    await frame.waitForFunction(() => window._tview && _tview.model && !_tview.model.bounds.isEmpty);
    await frame.waitForTimeout(500); // Initial viewport is set by a 250ms timer.
}
async function focusTrace(page, frame) {
    const canvas = await frame.evaluate(() => {
        const rect = _tview.modelTrackContainer_.canvas.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + Math.min(60, rect.height / 2) };
    });
    const box = frame.parentFrame() ? await (await frame.frameElement()).boundingBox() : { x: 0, y: 0 };
    await page.mouse.click(box.x + canvas.x, box.y + canvas.y);
}
async function traceRange(frame) {
    return frame.evaluate(() => {
        const dt = _tview.viewport_.currentDisplayTransform;
        const width = _tview.modelTrackContainer_.canvas.width;
        return { center: dt.xViewVectorToWorld(width / 2) - dt.panX,
            duration: dt.xViewVectorToWorld(width) / 1.25, scale: dt.scaleX, pan: dt.panX };
    });
}
async function metricRange(frame) {
    return frame.evaluate(() => {
        const zoom = myChart.getOption().dataZoom[0];
        return { start: zoom.start, end: zoom.end };
    });
}
function near(actual, expected, label) {
    assert(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`);
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.TRACE_SYNC_CHROME || '/usr/bin/google-chrome',
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const checks = [], errors = [], measurements = [];
    let currentPage;
    try {
        for (const deviceScaleFactor of [1, 2]) {
            const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor });
            const page = currentPage = await context.newPage();
            page.on('pageerror', error => errors.push(String(error)));
            if (process.env.TRACE_SYNC_OLD_JS) {
                await page.route('**/js/catapult_trace_viewer.js?*', route => route.fulfill({
                    contentType: 'application/javascript', body: fs.readFileSync(process.env.TRACE_SYNC_OLD_JS) }));
            }
            if (process.env.TRACE_SYNC_OLD_METRIC) {
                await page.route('**/metricviewer?embedded=true', route => route.fulfill({
                    contentType: 'text/html', body: fs.readFileSync(process.env.TRACE_SYNC_OLD_METRIC) }));
            }
            await page.goto(baseUrl + '/crossviewer');
            const metric = await childFrame(page, '#metricFrame');
            const traceParent = await childFrame(page, '#traceFrame');
            const traceFrame = await childFrame(traceParent, '#catapult_frame1');
            await loadTrace(traceFrame);
            await metric.waitForFunction(() => window.metricHeat);
            const name = await metric.evaluate(async fixture => {
                const meta = await fetch('/api/show/server_load', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: fixture }) }).then(response => response.json());
                if (meta.code !== 0) throw new Error(meta.msg);
                ProcessH5(meta, 1);
                CurMetricSelectList.push(meta.data.signal[0]);
                return meta.data.signal[0];
            }, fixture);
            await metric.locator('#filterMetricGroup').fill('Keyboard sync');
            await metric.getByRole('button', { name: 'Plot', exact: true }).click();
            await metric.waitForFunction(() => myChart.getOption().series.some(series => series.data.length > 0));
            await page.evaluate(() => {
                window.traceSyncMessages = [];
                window.traceSyncObserver = new BroadcastChannel('klxarch');
                traceSyncObserver.onmessage = event => traceSyncMessages.push(event.data);
            });
            async function messages() { return page.evaluate(() => traceSyncMessages.slice()); }
            async function resetRange() {
                await metric.evaluate(() => myChart.dispatchAction({ type: 'dataZoom',
                    startValue: Math.floor((TimeLine.length - 1) * 0.4), endValue: Math.floor((TimeLine.length - 1) * 0.6) }));
                await page.waitForTimeout(300);
                await page.evaluate(() => { traceSyncMessages.length = 0; });
            }
            await resetRange();
            const initial = await traceRange(traceFrame);
            const expected = await metric.evaluate(() => ({ center: 0.1 * (zoom_start_val + zoom_end_val) / 2,
                duration: 0.1 * (zoom_end_val - zoom_start_val) }));
            near(initial.center, expected.center, 'Metric → Trace center');
            near(initial.duration, expected.duration, 'Metric → Trace duration');
            checks.push(`DPR ${deviceScaleFactor}: existing Metric → Trace range synchronization`);

            for (const key of ['a', 'd', 'e', 'Shift+A', 'Shift+D']) {
                await resetRange();
                const before = await traceRange(traceFrame);
                const metricBefore = await metricRange(metric);
                await focusTrace(page, traceFrame);
                await page.keyboard.press(key);
                await page.waitForTimeout(350);
                const after = await traceRange(traceFrame), received = await messages();
                assert.notEqual(after.pan, before.pan, key + ': actual keyboard event pans Trace');
                const forwarded = received.filter(message => message.type === 'SYNC_TRACE_TO_METRIC');
                assert.equal(forwarded.length, 1, key + ': exactly one Trace range notification');
                assert.equal(received.filter(message => message.type === 'SYNC_METRIC_TO_TRACE').length, 0, key + ': Metric must not echo');
                near(after.scale, before.scale, key + ': pan must not zoom Trace');
                near(forwarded[0].center, after.center, key + ': target center');
                near(forwarded[0].duration, after.duration, key + ': target duration');
                const metricAfter = await metricRange(metric);
                assert.notDeepEqual(metricAfter, metricBefore, key + ': Metric range follows');
                const expectedMetric = await metric.evaluate(message => {
                    const span = TimeLine[TimeLine.length - 1] - TimeLine[0];
                    return { start: Math.max(0, ((message.center - message.duration / 2) / 0.1 - TimeLine[0]) / span * 100),
                        end: Math.min(100, ((message.center + message.duration / 2) / 0.1 - TimeLine[0]) / span * 100) };
                }, forwarded[0]);
                near(metricAfter.start, expectedMetric.start, key + ': Metric start');
                near(metricAfter.end, expectedMetric.end, key + ': Metric end');
                assert.deepEqual(errors, []);
                measurements.push({ deviceScaleFactor, key, before, after, metricBefore, metricAfter, received });
                checks.push(`DPR ${deviceScaleFactor}: ${key} pans and syncs without reverse notification`);
            }
            await resetRange();
            await focusTrace(page, traceFrame);
            for (const key of ['a', 'a', 'a', 'a', 'd', 'd', 'd', 'd']) await page.keyboard.press(key);
            await page.waitForTimeout(350);
            const rapid = await messages(), final = await traceRange(traceFrame);
            const pans = rapid.filter(message => message.type === 'SYNC_TRACE_TO_METRIC');
            assert.equal(pans.length, 8);
            near(pans.at(-1).center, final.center, 'rapid keys: accumulated target center');
            near(pans.at(-1).duration, final.duration, 'rapid keys: unchanged duration');
            assert.equal(rapid.filter(message => message.type === 'SYNC_METRIC_TO_TRACE').length, 0);
            checks.push(`DPR ${deviceScaleFactor}: rapid pan animation takeover retains final synchronized range`);

            // Narrow split layouts may wrap the existing checkbox under the
            // chart. Toggle it with its native keyboard action for this gate.
            await metric.locator('#sync').focus();
            await page.keyboard.press('Space');
            assert.equal(await metric.locator('#sync').isChecked(), false);
            const disabled = await metricRange(metric), beforeOff = await traceRange(traceFrame);
            await focusTrace(page, traceFrame);
            await page.keyboard.press('a');
            await page.waitForTimeout(350);
            assert.notEqual((await traceRange(traceFrame)).pan, beforeOff.pan);
            assert.deepEqual(await metricRange(metric), disabled);
            checks.push(`DPR ${deviceScaleFactor}: Sync off retains independent Metric range`);
            assert.deepEqual(errors, []);
            await page.screenshot({ path: path.join(output, `trace-metric-sync-dpr${deviceScaleFactor}.png`) });
            await context.close();
        }
        const page = currentPage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        page.on('pageerror', error => errors.push(String(error)));
        await page.goto(baseUrl + '/static/catapult_trace_viewer.html?v=20261103pan');
        await loadTrace(page.mainFrame());
        await focusTrace(page, page.mainFrame());
        const standalone = await traceRange(page.mainFrame());
        await page.keyboard.press('Shift+A');
        await page.waitForTimeout(250);
        assert.notEqual((await traceRange(page.mainFrame())).pan, standalone.pan);
        assert.deepEqual(errors, []);
        checks.push('Standalone Catapult pans without a parent synchronization callback');
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, errors, measurements }, null, 2));
        console.log(`PASS: ${checks.length} keyboard/Metric–Trace checks; zero frontend errors`);
    } catch (error) {
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'FAIL', checks, errors, measurements, error: String(error) }, null, 2));
        if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(output, 'failure.png') });
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
