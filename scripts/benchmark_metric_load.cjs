/* Production MetricViewer load/Plot/Reload measurements in an existing Chrome.
 * NODE_PATH must point at an already installed Playwright if it isn't local.
 * node scripts/benchmark_metric_load.cjs URL FILE server|local NEW_OUTPUT
 * Browser startup is excluded. page_ms includes automation/picker overhead;
 * ajax_to_render_ms starts at the first real jQuery request send.
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [base, input, kind, outputArg] = process.argv.slice(2);
if (!base || !input || !['server', 'local'].includes(kind) || !outputArg) {
    throw new Error('Usage: URL FILE server|local NEW_OUTPUT');
}
const file = path.resolve(input), output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: false });
const result = { file, kind, operations: [], errors: [], dialogs: [],
    note: 'Loopback, no cache flush. Timings include lightweight instrumentation. Two RAFs indicate a render opportunity, not GPU presentation.' };

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.METRIC_BENCH_CHROME || '/usr/bin/google-chrome',
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    process.once('SIGTERM', () => { browser.close().finally(() => process.exit(143)); });
    result.browser = browser.version();
    result.node = process.version;
    result.playwright = require('playwright/package.json').version;
    const page = await browser.newPage({ viewport: { width: 1500, height: 850 } });
    page.setDefaultTimeout(600000);
    page.on('pageerror', error => result.errors.push(String(error)));
    page.on('dialog', async dialog => { result.dialogs.push(dialog.message()); await dialog.dismiss(); });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const save = () => fs.writeFileSync(path.join(output, 'browser.json'), JSON.stringify(result, null, 2) + '\n');
    try {
        await page.goto(base + '/metricviewer');
        await page.waitForFunction(() => typeof ProcessH5 === 'function' && typeof metricHeat === 'object');
        await page.evaluate(() => {
            window.bench = { phases: [], tasks: [], marks: [], active: false };
            function wrap(obj, name) {
                const fn = obj[name];
                obj[name] = function (...args) {
                    const start = performance.now();
                    try { return fn.apply(this, args); }
                    finally { if (bench.active) bench.phases.push({ name, start, ms: performance.now() - start }); }
                };
            }
            wrap(window, 'ProcessH5');
            wrap(window, 'rebuildMetricSelectDiv');
            wrap(metricHeat, 'datasetLoaded'); wrap(metricHeat, 'datasetReloaded');
            new PerformanceObserver(list => {
                for (const e of list.getEntries()) bench.tasks.push({ start: e.startTime, ms: e.duration });
            }).observe({ type: 'longtask', buffered: true });
            $(document).ajaxSend(() => { if (bench.active) bench.marks.push({name:'ajaxSend', time:performance.now()}); });
            $(document).ajaxComplete(() => { if (bench.active) bench.marks.push({name:'ajaxComplete', time:performance.now()}); });
        });

        async function operation(name, action, ready) {
            await page.evaluate(() => {
                performance.clearResourceTimings(); bench.phases = []; bench.marks = [];
                bench.started = performance.now(); bench.active = true;
            });
            const hostStarted = performance.now();
            await action();
            if (ready) await ready();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const measured = await page.evaluate(() => {
                const end = performance.now(); bench.active = false;
                const sent = bench.marks.find(m => m.name === 'ajaxSend');
                return { page_ms: end - bench.started, ajax_to_render_ms: sent ? end - sent.time : null,
                    phases: bench.phases, marks: bench.marks,
                    long_tasks: bench.tasks.filter(t => t.start >= bench.started && t.start <= end),
                    resources: performance.getEntriesByType('resource').filter(r => r.name.includes('/api/show/')).map(r => ({
                        url: r.name, duration_ms: r.duration, request_to_first_byte_ms: r.responseStart - r.requestStart,
                        download_ms: r.responseEnd - r.responseStart, response_end: r.responseEnd,
                        transfer_bytes: r.transferSize, body_bytes: r.encodedBodySize,
                        server_timing: r.serverTiming.map(t => ({name:t.name, ms:t.duration})) })),
                    metrics: MetricNames.length, samples: TimeLine.length,
                    sample_period_display: document.getElementById('sample_rate').value,
                    checkbox_count: document.getElementsByName('MetricCheckBox').length,
                    line_series: myChart.getOption().series?.length || 0,
                    heat_maps: document.querySelectorAll('.heat-map').length };
            });
            const perf = await cdp.send('Performance.getMetrics');
            measured.browser_metrics = Object.fromEntries(perf.metrics.filter(m =>
                ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents'].includes(m.name)).map(m => [m.name, m.value]));
            measured.host_ms = performance.now() - hostStarted;
            result.operations.push({ name, ...measured });
            save();
            assert.deepEqual(result.errors, []); assert.deepEqual(result.dialogs, []);
            console.log(JSON.stringify({ name, ms: measured.page_ms, metrics: measured.metrics, samples: measured.samples }));
        }
        const idle = () => page.waitForFunction(() => !fileLoadBusy && $.active === 0);
        async function load(reload = false) {
            if (kind === 'server') {
                await page.evaluate(({file, reload}) => {
                    if (reload) reloadFile();
                    else { document.getElementById('serverBrowserSelectedPath').value = file; loadServerFile(); }
                }, {file, reload});
            } else {
                const chooserPromise = page.waitForEvent('filechooser');
                await page.evaluate(reload => reload ? reloadFile() : loadLocal(), reload);
                const chooser = await chooserPromise;
                await chooser.setFiles(file);
            }
        }
        await operation('first_load', () => load(), idle);
        assert(result.operations[0].metrics > 0 && result.operations[0].samples > 0);
        await operation('repeat_load', () => load(), idle);
        const names = await page.evaluate(() => MetricNames.filter((_, i) => i % Math.max(1, Math.floor(MetricNames.length / 16)) === 0).slice(0,16));
        assert.equal(names.length, 16, 'This fixed Plot benchmark requires at least 16 metrics');
        result.selected_metrics = names;
        await operation('line_plot_8', () => page.evaluate(names => {
            CurMetricSelectList.splice(0, CurMetricSelectList.length, ...names);
            document.getElementById('filterMetricGroup').value = 'Benchmark line'; MetricSelectSubmit();
        }, names.slice(0,8)), () => page.waitForFunction(() => $.active === 0 && myChart.getOption().series.length === 8));
        await operation('line_reload_8', () => load(true), idle);
        assert.equal(result.operations.at(-1).line_series, 8);
        await page.evaluate(() => ClearAll());
        await page.locator('#metricMode').selectOption('heat');
        await operation('heat_plot_8', () => page.evaluate(names => metricHeat.plot(names, 1), names.slice(0,8)), idle);
        await operation('heat_append_8', () => page.evaluate(names => metricHeat.plot(names, 1), names.slice(8,16)), idle);
        await operation('heat_reload_16', () => load(true), idle);
        assert.equal(result.operations.at(-1).heat_maps, 2);
        await page.screenshot({path:path.join(output, 'heat.png')});
        result.status = 'PASS';
    } catch (error) {
        result.status = 'FAIL'; result.failure = error.stack;
        await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 10000 }).catch(() => {});
        throw error;
    } finally { save(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
