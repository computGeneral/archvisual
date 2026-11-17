/* Real existing H5 and pointer regression for the Heat device-pixel width floor.
 * node scripts/test_heat_device_floor.cjs BASE_URL OUTPUT EXISTING_H5
 * The supplied seams.h5 has 80 metrics and 10,000 samples. No fixture is written.
 */
'use strict';
const {chromium} = require('playwright');
const {observeHeat} = require('./heat_test_support.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const [base, output, file] = process.argv.slice(2);
assert(base && output && file, 'Usage: BASE_URL OUTPUT EXISTING_H5');
fs.mkdirSync(output, {recursive: true});
const result = {status: 'RUNNING', input: file, checks: [], snapshots: [], pixels: [], errors: [], dialogs: [], queryCount: 0};
const close = (a, b, message) => assert(Math.abs(a - b) <= 1e-9, `${message}: ${a} != ${b}`);
const physicalFloor = dpr => dpr >= 1 ? 1 : (Math.ceil(100 / dpr) + 1) / 100;
(async () => {
    const browser = await chromium.launch({executablePath: process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome',
        headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage']});
    process.once('SIGTERM', () => browser.close().finally(() => process.exit(143)));
    let page;
    const save = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const idle = async () => {await page.waitForFunction(() => !fileLoadBusy && $.active === 0); await frames();};
    const cards = panel => page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    async function newPage(dpr) {
        page = await browser.newPage({viewport: {width: 1500, height: 1000}, deviceScaleFactor: dpr});
        page.setDefaultTimeout(30000); await observeHeat(page);
        page.on('pageerror', error => result.errors.push(String(error)));
        page.on('dialog', async dialog => {result.dialogs.push(dialog.message()); await dialog.dismiss();});
        page.on('request', request => {if (new URL(request.url()).pathname === '/api/show/query') ++result.queryCount;});
        await page.goto(base + '/metricviewer'); await page.waitForFunction(() => window.metricHeat);
        await page.evaluate(() => {window.deviceFloorBaseline = new Map();});
    }
    async function load(panel = 1, mapCount = 2) {
        await page.evaluate(({file, panel}) => {setActivePanel(panel); requestServerFile(file, panel, false);}, {file, panel});
        await idle(); await page.locator('#metricMode').selectOption('heat');
        for (let index = 0; index < mapCount; ++index) {
            assert(await page.evaluate(({panel, index}) => {
                const names = panel === 1 ? MetricNames : MetricNames2;
                if (names.length !== 80) throw Error('Expected the unchanged 80-metric seams fixture');
                return metricHeat.plot(names.slice(index * 2, index * 2 + 2), panel);
            }, {panel, index})); await idle();
        }
        for (let index = 0; index < mapCount; ++index) {
            await cards(panel).nth(index).scrollIntoViewIfNeeded(); await frames();
            await cards(panel).nth(index).evaluate(card => {
                const f = heatTestFrame(card.querySelector('.heat-canvas'));
                if (!f || f.times.length !== 10000) throw Error('Expected 10,000 original samples');
                const key = card.closest('.heat-host').dataset.panel + ':' + card.dataset.group;
                deviceFloorBaseline.set(key, {times: f.times.slice(), rows: f.rows.map(row => ({name: row.name, array: row.values, values: row.values.slice()}))});
            });
        }
    }
    async function size(value, panel = 1, index = 0) {
        await cards(panel).nth(index).scrollIntoViewIfNeeded();
        await cards(panel).nth(index).locator('[name="heatCellSize"]').selectOption(String(value)); await frames();
    }
    async function show(panel = 1, index = 0) {await cards(panel).nth(index).scrollIntoViewIfNeeded(); await frames();}
    async function inspect(label, panel = 1, index = 0, retainHover = false) {
        await show(panel, index);
        if (!retainHover) {await page.mouse.move(10, 10); await frames();}
        const info = await cards(panel).nth(index).evaluate(card => {
            const host = card.querySelector('.heat-canvas'), f = heatTestFrame(host), chart = heatTestChart(host), record = heatTestRecord(host);
            const key = card.closest('.heat-host').dataset.panel + ':' + card.dataset.group, original = deviceFloorBaseline.get(key);
            if (!original || f.rows.length !== original.rows.length || f.times.length !== original.times.length) throw Error('Original data shape changed');
            for (let i = 0; i < f.rows.length; ++i) {
                const row = f.rows[i], old = original.rows[i];
                if (row.name !== old.name || row.values !== old.array || row.values.length !== old.values.length || row.values.some((value, sample) => value !== old.values[sample]))
                    throw Error('Original samples or their shared arrays changed');
            }
            if (f.times.some((value, sample) => value !== original.times[sample])) throw Error('Sample labels changed');
            const g = MetricHeatCanvas.geometry(f), nominal = [];
            for (let i = 0; i <= f.x.length; ++i) nominal.push(Math.round((f.left + i * (f.gridWidth / f.x.length)) * f.dpr));
            if (g.x.nominal.some((value, i) => value !== nominal[i])) throw Error('Nominal geometry does not match the independent grid');
            const gaps = nominal.slice(1).map((value, i) => value - nominal[i]);
            if (gaps.some(value => !Number.isInteger(value) || value < 1)) throw Error('A sample column has no device pixel');
            const full = heatTestFullReference(host), sample = host.querySelector('.heat-samples'), expected = full.host.querySelector('.heat-samples');
            if (!sample.width || !sample.height || sample.width !== expected.width || sample.height !== expected.height) throw Error('Full/reuse dimensions differ or are empty');
            function pixels(dom) {
                const c = document.createElement('canvas'); c.width = sample.width; c.height = sample.height;
                const ctx = c.getContext('2d', {willReadFrequently: true}), low = dom.querySelector('.heat-samples'), high = dom.querySelector('.heat-sample-highlight');
                ctx.drawImage(low, 0, 0);
                if (high.width && high.height) ctx.drawImage(high, Math.round((parseFloat(high.style.left) - parseFloat(low.style.left)) * f.dpr),
                    Math.round((parseFloat(high.style.top) - parseFloat(low.style.top)) * f.dpr));
                return ctx.getImageData(0, 0, c.width, c.height).data;
            }
            const actual = pixels(host), reference = pixels(full.host);
            let mismatchedChannels = 0, maxDifference = 0, firstDifference = null;
            for (let i = 0; i < actual.length; ++i) if (actual[i] !== reference[i]) {
                ++mismatchedChannels; maxDifference = Math.max(maxDifference, Math.abs(actual[i] - reference[i]));
                if (!firstDifference) firstDifference = {pixel: Math.floor(i / 4), channel: i % 4, actual: actual[i], reference: reference[i]};
            }
            const stats = record.renderer.bitmapStats(), referenceStats = full.renderer.bitmapStats(), option = chart.getOption();
            if (referenceStats.reuse !== 0 || referenceStats.cacheBytes !== 0) throw Error('The complete-render oracle must not allocate a cache');
            return {key: card.dataset.group, dpr: f.dpr, windowDpr: devicePixelRatio, rowHeight: f.bandHeight,
                size: Number(card.querySelector('[name="heatCellSize"]').value), width: f.columnWidth, actualStep: f.gridWidth / f.x.length,
                deviceStep: f.gridWidth / f.x.length * f.dpr, minDeviceGap: Math.min(...gaps), gridWidth: f.gridWidth,
                plotWidth: chart.getWidth() - option.grid[0].left - (20 + 8 + option.grid[1].width),
                statisticsWidth: option.grid[1].width, first: f.firstCol, last: f.lastCol, samples: f.times.length,
                stats, referenceStats, mismatchedChannels, maxDifference, firstDifference, rgbaChannels: actual.length};
        });
        result.snapshots.push({label, panel, index, ...info}); result.pixels.push({label, panel, index, channels: info.rgbaChannels, mismatchedChannels: info.mismatchedChannels}); save();
        assert.equal(info.dpr, info.windowDpr); close(info.actualStep, info.width, 'Grid width/count matches actual sample width');
        assert(info.deviceStep >= 1, 'Actual grid step must cover at least one device pixel');
        assert.equal(info.rowHeight, info.size); assert.equal(info.statisticsWidth, info.size * 3);
        assert.equal(info.mismatchedChannels, 0, label + ': full/reuse RGBA must be identical');
        return info;
    }
    async function wheel(delta, panel = 1) {
        await show(panel);
        const point = await cards(panel).first().evaluate(card => {
            const host = card.querySelector('.heat-canvas'), f = heatTestFrame(host), b = host.getBoundingClientRect();
            return {x: b.left + f.left + Math.min(20, f.gridWidth / 2), y: b.top + f.top + f.bandHeight / 2};
        });
        await page.mouse.move(point.x, point.y); await page.keyboard.down('Control');
        await page.mouse.wheel(0, delta); await page.keyboard.up('Control'); await frames();
    }
    async function floor(label, count, panel = 1) {
        const states = [];
        for (let index = 0; index < await cards(panel).count(); ++index) states.push(await inspect(label, panel, index));
        const expected = Math.max(physicalFloor(states[0].dpr), Math.min(states[0].size, Math.max(...states.map(state => state.plotWidth)) / count));
        for (const state of states) close(state.width, expected, label + ': physical and viewport-fit floor');
        return states;
    }
    async function pan(label, position, panel = 1) {
        await show(panel); await cards(panel).first().locator('.heat-viewport').evaluate((viewport, position) => {viewport.scrollLeft = position;}, position); await frames();
        return inspect(label, panel);
    }
    async function hit(label, last, panel = 1) {
        // Create the full reference before dispatching either pointer event.
        await inspect(label + ' before pointer', panel);
        const expected = await cards(panel).first().evaluate((card, last) => {
            const host = card.querySelector('.heat-canvas'), f = heatTestFrame(host), r = heatTestRecord(host), b = host.getBoundingClientRect();
            if (!r.deviceFloorSelectObserved) {
                const select = r.options.select;
                r.options.select = function(point) {window.deviceFloorSelected = point.slice(); return select.apply(this, arguments);};
                r.deviceFloorSelectObserved = true;
            }
            const col = last ? f.x.length - 1 : 0, row = 0, step = f.gridWidth / f.x.length;
            const low = Math.round((f.left + col * step) * f.dpr), high = Math.round((f.left + (col + 1) * step) * f.dpr);
            const top = Math.round(f.top * f.dpr), bottom = Math.round((f.top + f.gridHeight / f.y.length) * f.dpr);
            const sample = f.firstCol + col, metric = f.firstRow + row;
            return {x: b.left + (low + high) / 2 / f.dpr, y: b.top + (top + bottom) / 2 / f.dpr,
                sample, metric, name: f.rows[metric].name, raw: f.rows[metric].values[sample]};
        }, last);
        await page.mouse.move(expected.x, expected.y); await frames();
        const tooltip = await cards(panel).first().locator('.heat-sample-tooltip').innerText();
        assert(tooltip.includes(expected.name) && tooltip.includes('(index ' + expected.sample + ')'));
        assert(tooltip.includes(expected.raw === null ? 'No valid data' : 'Raw value: ' + expected.raw));
        await inspect(label + ' hovered', panel, 0, true);
        await page.mouse.click(expected.x, expected.y); await frames();
        const selected = await page.evaluate(() => window.deviceFloorSelected);
        assert.equal(selected[4], expected.sample); assert.equal(selected[5], expected.metric); assert.equal(selected[3], expected.raw);
        assert.equal(await cards(panel).first().locator('.heat-status').textContent(), 'Selected: ' + expected.name);
        await inspect(label + ' clicked', panel, 0, true);
        return expected;
    }
    async function range(first, last, panel = 1) {
        await page.evaluate(({first, last, panel}) => {
            setActivePanel(panel); const host = document.querySelector(`.heat-host[data-panel="${panel}"] .heat-canvas`), f = heatTestFrame(host);
            document.getElementById('zoom_start').value = String(f.times[first]); document.getElementById('zoom_end').value = String(f.times[last]);
            metricHeat.zoomFromInputs(panel);
        }, {first, last, panel}); await frames();
    }
    try {
        for (const requestedDpr of [.5, .75, .8, 1, 2]) for (const selectedSize of [16, 8]) {
            await newPage(requestedDpr); await load(); await size(selectedSize, 1, 1);
            const queries = result.queryCount;
            await wheel(5000); let states = await floor('device floor', 10000);
            for (const state of states) close(state.width, physicalFloor(state.dpr), 'Long input reaches the physical floor');
            await wheel(5000); await floor('repeated zoom-out is stopped', 10000);
            const start = await pan('start', 0); assert.equal(start.first, 0); assert.equal((await hit('first sample', false)).sample, 0);
            const middle = await pan('middle', 2500.5 * start.width); assert(middle.first > 0 && middle.last < 10000);
            let reused = false;
            // Fractional device widths have different phase periods. Every
            // attempt is pixel-checked, including legitimate full fallbacks.
            for (const delta of [40, 80, 100, 125, 200, 400, 500]) {
                const anchor = await pan('phase anchor before ' + delta, 2500.5 * start.width);
                const candidate = await pan('phase candidate ' + delta, (2500.5 + delta) * start.width);
                if (candidate.stats.reuse > anchor.stats.reuse && candidate.stats.last.kind === 'reuse') {reused = true; break;}
            }
            assert(reused, 'Pixel checks must include an actually reused bitmap, not only full fallback frames');
            const tail = await pan('tail', 1e9); assert.equal(tail.last, 10000); assert.equal((await hit('last sample', true)).sample, 9999);
            const actualBack = await cards(1).first().locator('.heat-viewport').evaluate((viewport, width) => {viewport.scrollLeft -= 200 * width; return viewport.scrollLeft;}, start.width);
            assert(Number.isFinite(actualBack)); await frames();
            const restored = await inspect('actual reverse tail');
            assert(restored.last < 10000);
            await range(200, 599); await wheel(5000); states = await floor('viewport fit precedes physical minimum', 400);
            assert(states.every(state => state.first === 200 && state.last === 600));
            await wheel(5000); await floor('repeated fit zoom-out', 400);
            await page.setViewportSize({width: 1750, height: 1000}); await frames(); states = await floor('wider viewport raises fit floor', 400);
            const widened = states[0].width;
            await page.setViewportSize({width: 1400, height: 1000}); await frames();
            close((await inspect('narrower viewport keeps width')).width, widened, 'Narrowing alone preserves scale');
            await wheel(5000); await floor('user zoom reaches smaller viewport floor', 400);
            const nextSize = selectedSize === 16 ? 8 : 16;
            await size(nextSize, 1, 1);
            for (let index = 0; index < 2; ++index) {
                const linked = await inspect('linked size change', 1, index);
                assert.equal(linked.size, nextSize); close(linked.width, Math.max(nextSize, physicalFloor(linked.dpr)), 'Size change resets legal width');
            }
            assert.equal(result.queryCount, queries, 'Zoom, pan, fit, resize and size change must not query sample data again');
            result.checks.push(`DPR requested ${requestedDpr}, actual ${start.dpr}, size ${selectedSize}: physical/fit floors, independent device gaps, original values, first/last pointer and click, full/reuse RGBA, real reuse and linked size`);
            await page.close(); save();
        }

        await newPage(2); await load(1, 1); await size(8); await wheel(5000);
        await page.evaluate(() => setSplitMode('horizontal')); await load(2, 1); await size(16, 2); await wheel(5000, 2);
        await inspect('idle primary at DPR2', 1); await inspect('idle secondary at DPR2', 2);
        const cdp = await page.context().newCDPSession(page), queries = result.queryCount;
        for (const requestedDpr of [.5, 2]) {
            await page.evaluate(() => {window.deviceFloorOldInstances = [...heatTestInstances];});
            await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1500, height: 1000, deviceScaleFactor: requestedDpr, mobile: false});
            await page.waitForFunction(dpr => devicePixelRatio === dpr, requestedDpr);
            // No pointer, resize, scroll or show() before both idle panels update.
            await page.waitForFunction(() => [1, 2].every(panel => {
                const host = document.querySelector(`.heat-host[data-panel="${panel}"] .heat-canvas`), f = heatTestFrame(host);
                return f && f.dpr === devicePixelRatio && heatTestChart(host).getZr().painter.dpr === devicePixelRatio;
            }), null, {timeout: 3000}); await frames();
            assert(await page.evaluate(() => deviceFloorOldInstances.every(record => record.disposed && record.renderer.bitmapStats().cacheBytes === 0)));
            for (const panel of [1, 2]) {
                const state = await inspect('idle DPR change to ' + requestedDpr, panel);
                close(state.width, 2.01, 'DPR decrease raises width; increase preserves existing width');
            }
        }
        assert.equal(result.queryCount, queries, 'DPR rebuilding must not query samples again');
        await wheel(5000, 1); close((await inspect('primary explicit zoom after DPR return', 1)).width, 1, 'Explicit zoom allows lower width again');
        close((await inspect('secondary remains at previous width', 2)).width, 2.01, 'Panels preserve independent scale');
        await wheel(5000, 2); close((await inspect('secondary explicit zoom', 2)).width, 1, 'Second panel can independently shrink');
        assert.equal((await pan('primary tail after live DPR', 1e9, 1)).last, 10000);
        assert.equal((await pan('secondary tail after live DPR', 1e9, 2)).last, 10000);
        result.checks.push('Idle split panels rebuild at DPR2→0.5→2; old caches release, minimum rises to2.01, returning DPR preserves width until each panel explicitly zooms, last samples remain reachable');
        await page.close();

        await newPage(.1); await load(1, 1); await size(8); await wheel(5000);
        const extreme = await floor('physical minimum overrides the 8px horizontal maximum', 10000);
        close(extreme[0].width, physicalFloor(extreme[0].dpr), 'Extreme DPR physical floor');
        assert(extreme[0].width > 8); assert.equal(extreme[0].rowHeight, 8); assert.equal(extreme[0].statisticsWidth, 24);
        await wheel(-5000); close((await inspect('extreme zoom-in remains legal')).width, extreme[0].width, 'Physical minimum has priority over horizontal size ceiling');
        await pan('extreme middle', 2500.5 * extreme[0].width); assert.equal((await pan('extreme tail', 1e9)).last, 10000);
        result.checks.push('Actual DPR near0.1 keeps 8CSSpx rows/24CSSpx statistics while the horizontal device floor exceeds8; raw values and strict full/reuse pixels remain intact');
        assert.deepEqual(result.errors, []); assert.deepEqual(result.dialogs, []);
        result.status = 'PASS'; console.log(JSON.stringify({status: result.status, checks: result.checks}));
    } catch (error) {
        result.status = 'FAIL'; result.failure = error.stack;
        if (page && !page.isClosed()) await page.screenshot({path: path.join(output, 'failure.png')}).catch(() => {});
        throw error;
    } finally {save(); await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
