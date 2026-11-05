/* Integration: CSV upload/server load, real csv2hdf output, and toolbar/sync.
 * Uses python3 from PATH; no packages are installed.
 * SAMPLE_PERIOD_TEST_OUTPUT selects fixtures, screenshots and result.json.
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const base = process.argv[2] || 'http://127.0.0.1:18139';
const output = process.env.SAMPLE_PERIOD_TEST_OUTPUT || path.resolve(__dirname, '../__output__/sample_period');
const checks = [], errors = [];
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const fixtures = {};
    for (const [name, period] of [['period', 250], ['secondary', 125], ['absent', null]]) {
        fixtures[name] = path.join(output, name + '.csv');
        fs.writeFileSync(fixtures[name], 'sample,0,1,2,3,4,5,6,7\n' +
            (period === null ? '' : `samplePeriod,${period}\n`) + 'port,0,1.25,2,3,4,5,6,7\n');
        fixtures[name + 'H5'] = path.join(output, name + '.h5');
        execFileSync('python3', ['-B', path.join(__dirname, 'csv2hdf.py'),
            '-i', fixtures[name], '-o', fixtures[name + 'H5']], { cwd: output });
    }
    fixtures.headerless = path.join(output, 'headerless.csv');
    fs.writeFileSync(fixtures.headerless, 'port,1.5,2.25,3\nother,4,5,6\n');
    fixtures.timesOnly = path.join(output, 'times-only.csv');
    fs.writeFileSync(fixtures.timesOnly, 'sample,100,200,300\nport,1,2,3\n');
    const browser = await chromium.launch({ executablePath: process.env.SAMPLE_PERIOD_CHROME || '/usr/bin/google-chrome',
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
    async function field(expected) {
        await page.waitForFunction(expected => document.getElementById('sample_rate').value === expected, expected);
        assert.equal(await page.locator('#sample_rate').evaluate(el => el.readOnly), true);
    }
    async function load(name, method = 'server', panel = 1) {
        if (method === 'upload') {
            await page.evaluate(panel => setActivePanel(panel), panel);
            const response = page.waitForResponse(r => r.url().endsWith('/api/show/upload'));
            await page.locator('#fileInput').setInputFiles(fixtures[name]);
            const res = await response;
            assert.equal(res.status(), 200, await res.text());
            await page.waitForFunction(({ name, panel }) => (panel === 2 ? Title2 : Title) === name,
                { name: path.basename(fixtures[name]), panel });
        } else {
            await page.evaluate(async ({ fixture, panel }) => {
                const res = await fetch('/api/show/server_load', { method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: fixture, secondary: panel === 2 }) }).then(r => r.json());
                if (res.code !== 0) throw Error(res.msg);
                ProcessH5(res, panel);
            }, { fixture: fixtures[name], panel });
        }
    }
    async function plot(panel = 1) {
        await page.evaluate(panel => {
            setActivePanel(panel);
            const selected = panel === 2 ? CurMetricSelectList2 : CurMetricSelectList;
            selected.length = 0; selected.push('port');
        }, panel);
        await page.locator('#filterMetricGroup').fill('Period ' + panel);
        await page.getByRole('button', { name: 'Plot', exact: true }).click();
        await page.waitForFunction(panel => getPanelChart(panel).getOption().series.some(s => s.data.length), panel);
    }
    const messages = () => page.evaluate(() => periodMessages.slice());
    const resetMessages = () => page.evaluate(() => { periodMessages.length = 0; });
    const zoom = () => page.evaluate(() => {
        const z = myChart.getOption().dataZoom[0]; return { start: z.start, end: z.end };
    });
    try {
        await page.goto(base + '/metricviewer');
        await page.waitForFunction(() => window.metricHeat);
        await field('');
        checks.push('Initially empty and read-only');
        for (const method of ['upload', 'server']) {
            for (const name of ['period', 'periodH5', 'absent', 'absentH5']) {
                await load(name, method);
                await field(name.startsWith('period') ? '250' : '');
                assert.deepEqual(await page.evaluate(() => MetricNames), ['port']);
                assert.deepEqual(await page.evaluate(() => TimeLine), [0, 1, 2, 3, 4, 5, 6, 7]);
                checks.push(`${method} ${name}: metadata-only period and unchanged sample labels`);
            }
        }
        await load('headerless', 'upload'); await field('');
        assert.deepEqual(await page.evaluate(() => MetricNames), ['port', 'other']);
        await load('timesOnly'); await field('');
        assert.deepEqual(await page.evaluate(() => TimeLine), [100, 200, 300]);
        checks.push('Headerless first metric retained; time differences do not infer a period');

        await load('period'); await plot(); await field('250');
        await page.evaluate(() => {
            window.periodMessages = [];
            window.periodObserver = new BroadcastChannel('klxarch');
            periodObserver.onmessage = e => periodMessages.push(e.data);
        });
        await page.evaluate(() => myChart.dispatchAction({ type: 'dataZoom', startValue: 1, endValue: 5 }));
        await page.waitForTimeout(150);
        let sent = (await messages()).filter(m => m.type === 'SYNC_METRIC_TO_TRACE');
        assert.equal(sent.length, 1); near(sent[0].center, 0.75); near(sent[0].duration, 1);
        await resetMessages();
        await page.evaluate(() => periodObserver.postMessage({ type: 'SYNC_TRACE_TO_METRIC', center: 1, duration: 0.5 }));
        await page.waitForTimeout(150);
        near((await zoom()).start, 3 / 7 * 100); near((await zoom()).end, 5 / 7 * 100);
        assert.equal((await messages()).length, 0);
        checks.push('Period 250: both sync directions use reciprocal scaling without echo');

        await page.evaluate(() => setSplitMode('horizontal'));
        await load('secondaryH5', 'server', 2);
        await field('250'); // Background load must not overwrite active file metadata.
        await plot(2); await field('125');
        await resetMessages();
        await page.evaluate(() => myChart2.dispatchAction({ type: 'dataZoom', startValue: 2, endValue: 6 }));
        await page.waitForTimeout(150);
        sent = (await messages()).filter(m => m.type === 'SYNC_METRIC_TO_TRACE');
        assert.equal(sent.length, 1); near(sent[0].center, 0.5); near(sent[0].duration, 0.5);
        // Incoming Trace still targets primary, even while another file is active.
        await page.evaluate(() => periodObserver.postMessage({ type: 'SYNC_TRACE_TO_METRIC', center: 0.75, duration: 0.5 }));
        await page.waitForTimeout(150);
        near((await zoom()).start, 2 / 7 * 100); near((await zoom()).end, 4 / 7 * 100);
        await page.evaluate(() => setActivePanel(1)); await field('250');
        checks.push('Split files retain independent periods; sync uses source/target file metadata');

        await page.locator('#metricMode').selectOption('heat'); await field('250');
        await page.screenshot({ path: path.join(output, 'split-periods-heat.png'), fullPage: true });
        await page.evaluate(() => setActivePanel(2)); await field('125');
        await page.locator('#metricMode').selectOption('heat'); await field('125');
        await load('absentH5', 'server', 2); await field('');
        await page.evaluate(() => setActivePanel(1)); await field('250');
        checks.push('Line/Heat switches and reload clear only the affected file period');

        await page.locator('#metricMode').selectOption('line');
        await load('absentH5'); await field(''); await plot();
        await resetMessages();
        await page.evaluate(() => {
            myChart.dispatchAction({ type: 'dataZoom', startValue: 1, endValue: 5 });
            SyncToTraceView();
        });
        await page.waitForTimeout(150);
        assert.equal((await messages()).length, 0);
        const before = await zoom();
        await page.evaluate(() => periodObserver.postMessage({ type: 'SYNC_TRACE_TO_METRIC', center: 1, duration: 0.5 }));
        await page.waitForTimeout(150);
        assert.deepEqual(await zoom(), before);
        assert.equal(await page.locator('#sync').textContent(), 'sync');
        checks.push('Missing period: plotting works, manual/automatic sync emits no invalid range and ignores incoming range');
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
        console.log(`PASS ${checks.length} sample-period browser checks`);
    } catch (error) {
        await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
        throw error;
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
