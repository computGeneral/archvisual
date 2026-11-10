/* Real browser lifecycle and DPR changes for the direct Heat sample renderer. */
'use strict';
const {chromium} = require('playwright');
const {observeHeat} = require('./heat_test_support.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const [base, output] = process.argv.slice(2); assert(base && output); fs.mkdirSync(output, {recursive: true});
const result = {checks: [], errors: [], dpr: []};
(async () => {
    const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true,
        ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage']});
    process.once('SIGTERM', () => browser.close().finally(() => process.exit(143)));
    const page = await browser.newPage({viewport: {width: 1400, height: 950}});
    await observeHeat(page); page.on('pageerror', e => result.errors.push(String(e)));
    const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    try {
        await page.goto(base + '/metricviewer'); await page.waitForFunction(() => window.metricHeat);
        await page.evaluate(file => requestServerFile(file, 1, false), path.resolve(__dirname, '../examples/metricview.h5'));
        await page.waitForFunction(() => !fileLoadBusy && $.active === 0);
        await page.locator('#metricMode').selectOption('heat');
        assert(await page.evaluate(() => metricHeat.plot(MetricNames.slice(0, 8), 1))); await frames();
        const card = page.locator('.heat-host[data-panel="1"] .heat-map').first();
        const counts = () => page.evaluate(() => [...heatTestInstances].map(r => r.renders));
        const before = await counts();
        await page.evaluate(() => {
            const host = document.querySelector('.heat-canvas'), chart = heatTestChart(host), set = chart.setOption;
            window.hoverSetOptions = 0; chart.setOption = function(...args) {++hoverSetOptions; return set.apply(this, args);};
        });
        const points = await card.evaluate(card => {
            const h = card.querySelector('.heat-canvas'), f = heatTestFrame(h), r = h.getBoundingClientRect();
            return [0, 1, 2, 3, 4].map(x => ({x: r.x + f.x[x], y: r.y + f.y[0]}));
        });
        for (const p of points) {await page.mouse.move(p.x, p.y); await frames();}
        assert.deepEqual(await counts(), before); assert.equal(await page.evaluate(() => hoverSetOptions), 0);
        result.checks.push('sample hover updates no ECharts options and does not rerender the visible data frame');
        const cdp = await page.context().newCDPSession(page);
        for (const dpr of [1.25, 1.5, 2, 1]) {
            await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1400, height: 950, deviceScaleFactor: dpr, mobile: false});
            await page.waitForFunction(dpr => {
                const host = document.querySelector('.heat-canvas'), f = heatTestFrame(host);
                return f && f.dpr === dpr && heatTestChart(host).getZr().painter.dpr === dpr;
            }, dpr); await frames();
            const info = await card.evaluate(card => {
                const h = card.querySelector('.heat-canvas'), f = heatTestFrame(h), c = h.querySelector('.heat-samples');
                return {dpr: f.dpr, sampleWidth: c.width, sampleCSS: parseFloat(c.style.width),
                    instances: heatTestInstances.size, canvasCount: h.querySelectorAll('.heat-samples').length};
            });
            assert.equal(info.sampleWidth, Math.round(info.sampleCSS * dpr));
            assert.equal(info.instances, 1); assert.equal(info.canvasCount, 1); result.dpr.push(info);
        }
        result.checks.push('live DPR 1→1.25→1.5→2→1 rebuilds both renderers with one live sample instance');
        await page.locator('#metricMode').selectOption('line'); await frames();
        assert(await page.evaluate(() => [...document.querySelectorAll('.heat-samples,.heat-sample-highlight')].every(c => !c.width && !c.height)));
        await page.locator('#metricMode').selectOption('heat'); await page.waitForFunction(() => $.active === 0); await frames();
        assert(await page.evaluate(() => !!heatTestFrame(document.querySelector('.heat-canvas'))));
        result.checks.push('Line suspends sample bitmaps and Heat restores real data');
        await page.evaluate(() => {
            window.oldHeatHost = document.querySelector('.heat-canvas'); window.oldHeatCanvas = oldHeatHost.querySelector('.heat-samples');
            metricHeat.clear(1);
        }); await frames();
        assert(await page.evaluate(() => heatTestInstances.size === 0 && !heatTestFrame(oldHeatHost) &&
            !oldHeatCanvas.width && !oldHeatCanvas.height && !oldHeatCanvas.isConnected && !oldHeatHost.isConnected));
        await page.evaluate(() => {oldHeatHost.dispatchEvent(new MouseEvent('mousemove', {clientX: 400, clientY: 60})); oldHeatHost.dispatchEvent(new MouseEvent('click'));});
        await frames(); assert.equal(await page.locator('.heat-map').count(), 0);
        await page.evaluate(() => {delete window.oldHeatHost; delete window.oldHeatCanvas;});
        result.checks.push('Clear releases frames/bitmaps and detached sample nodes cannot select metrics');
        for (let i = 0; i < 10; ++i) {
            assert(await page.evaluate(() => metricHeat.plot(MetricNames.slice(0, 8), 1))); await frames();
            assert.equal(await page.evaluate(() => heatTestInstances.size), 1);
            await page.evaluate(() => metricHeat.clear(1)); await frames();
            assert.equal(await page.evaluate(() => heatTestInstances.size), 0);
        }
        result.checks.push('ten Plot/Clear cycles leave zero sample instances, nodes and bitmaps');
        assert.equal(await page.locator('.heat-samples,.heat-sample-highlight,.heat-sample-tooltip').count(), 0);
        assert(await page.evaluate(() => metricHeat.plot(MetricNames.slice(0, 1), 1))); await frames();
        const p = await card.evaluate(card => {
            const h = card.querySelector('.heat-canvas'), f = heatTestFrame(h), r = h.getBoundingClientRect(); return {x: r.x + f.x[0], y: r.y + f.y[0]};
        });
        await page.mouse.click(p.x, p.y); await page.keyboard.press('Delete'); await frames();
        assert.equal(await page.evaluate(() => heatTestInstances.size), 0); assert.equal(await page.locator('.heat-map').count(), 0);
        result.checks.push('click/Delete of the last metric disposes its renderer');
        assert.deepEqual(result.errors, []); result.status = 'PASS';
    } catch (e) {result.status = 'FAIL'; result.failure = e.stack; throw e;}
    finally {fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
