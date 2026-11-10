/* Real CSV/H5 and Ctrl+wheel regression for the Heat viewport-fit zoom floor.
 * node scripts/test_heat_zoom_fit.cjs <dedicated-server-url> <output-directory>
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const [base, output] = process.argv.slice(2);
fs.mkdirSync(output, { recursive: true });
const result = { checks: [], errors: [], snapshots: [] };
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const fixtures = new Map();
function fixture(count) {
    if (fixtures.has(count)) return fixtures.get(count);
    const csv = path.join(output, `samples-${count}.csv`), h5 = csv.replace(/csv$/, 'h5');
    fs.writeFileSync(csv, 'sample,' + Array.from({ length: count }, (_, i) => i).join(',') + '\nsamplePeriod,100\n' +
        ['traffic', 'active'].map((name, row) => name + ',' +
            Array.from({ length: count }, (_, i) => row * 10000 + i).join(',')).join('\n') + '\n');
    execFileSync('python3', ['-B', path.join(__dirname, 'csv2hdf.py'), '-i', csv, '-o', h5], { stdio: 'pipe' });
    fixtures.set(count, h5); return h5;
}
(async () => {
    const browser = await chromium.launch({ executablePath: process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome',
        headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    page.on('pageerror', e => result.errors.push(String(e)));
    const cards = panel => page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    async function load(count, panel = 1, maps = 2) {
        await page.evaluate(({ file, panel }) => { setActivePanel(panel); requestServerFile(file, panel, false); },
            { file: fixture(count), panel });
        await page.waitForFunction(() => !fileLoadBusy && $.active === 0);
        await page.locator('#metricMode').selectOption('heat');
        await page.evaluate(async ({ panel, maps }) => {
            ClearAll(panel);
            for (let i = 0; i < maps; ++i) await metricHeat.plot([i % 2 ? 'active' : 'traffic'], panel);
        }, { panel, maps });
        await frames();
    }
    async function fresh(count, maps = 2) {
        await page.goto(base + '/metricviewer'); await page.waitForFunction(() => window.metricHeat);
        await load(count, 1, maps);
    }
    async function snapshot(label, panel = 1) {
        await frames();
        const maps = await cards(panel).evaluateAll(cards => cards.map(card => {
            const viewport = card.querySelector('.heat-viewport'), dom = card.querySelector('.heat-canvas');
            const chart = echarts.getInstanceByDom(dom);
            if (!chart) return { unrendered: true };
            const o = chart.getOption(), labels = o.xAxis[0].data, names = o.yAxis[0].data;
            const cells = o.series.filter(s => s.id === 'heat-values' || s.id === 'heat-missing').flatMap(s => s.data);
            for (const [x, y, , raw, sample] of cells) {
                const expected = (names[y] === 'active' ? 10000 : 0) + sample;
                if (raw !== expected || labels[x] !== String(sample)) throw new Error('Raw samples or labels changed');
            }
            return { cell: o.grid[0].width / labels.length, grid: o.grid[0].width,
                area: chart.getWidth() - o.grid[0].left - (20 + 8 + 3 * 16),
                count: labels.length, first: Number(labels[0]), last: Number(labels.at(-1)),
                cells: cells.length, row: o.grid[0].height / names.length, statistics: o.grid[1].width,
                scroll: viewport.scrollLeft, sidebar: Number(card.querySelector('.heat-sidebar-resizer').getAttribute('aria-valuenow')) };
        }));
        result.snapshots.push({ label, panel, maps });
        for (const m of maps.filter(m => !m.unrendered)) { close(m.row, 16); close(m.statistics, 48); }
        return maps;
    }
    async function wheel(delta = 120, panel = 1, modifier = 'Control') {
        const p = await cards(panel).first().evaluate(card => {
            const dom = card.querySelector('.heat-canvas'), chart = echarts.getInstanceByDom(dom), o = chart.getOption();
            const rect = dom.getBoundingClientRect();
            return { x: rect.left + o.grid[0].left + 10, y: rect.top + o.grid[0].top + 8 };
        });
        await page.mouse.move(p.x, p.y);
        if (modifier) await page.keyboard.down(modifier);
        await page.mouse.wheel(0, delta);
        if (modifier) await page.keyboard.up(modifier);
        await frames();
    }
    async function zoomOut(panel = 1) { for (let i = 0; i < 12; ++i) await wheel(120, panel); }
    function fitted(maps, count, start = 0) {
        const floor = Math.min(16, Math.max(1, Math.max(...maps.map(m => m.area)) / count));
        for (const m of maps) {
            close(m.cell, floor);
            if (count * floor <= m.area + 1e-9) {
                assert.equal(m.count, count); assert.equal(m.cells, count); assert.equal(m.first, start);
                assert.equal(m.last, start + count - 1); assert.equal(m.scroll, 0);
            }
        }
    }
    async function range(start, end) {
        await page.evaluate(({ start, end }) => {
            setActivePanel(1); zoom_start.value = start; zoom_end.value = end; metricHeat.zoomFromInputs(1);
        }, { start, end }); await frames();
    }
    async function drag(locator, dx, dy = 0) {
        const box = await locator.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
        await page.mouse.up(); await frames();
    }
    try {
        await fresh(400);
        await cards(1).first().locator('.heat-viewport').evaluate(el => { el.scrollLeft = 500; }); await frames();
        assert((await snapshot('panned before fit'))[0].scroll > 0);
        await zoomOut(); let maps = await snapshot('400 samples at fit'); fitted(maps, 400);
        result.checks.push('400 samples clamp to fractional viewport-fit width; both maps show all raw samples and reset horizontal scroll');
        const fit = maps[0].cell;
        await zoomOut(); maps = await snapshot('repeated zoom-out at floor'); fitted(maps, 400); close(maps[0].cell, fit);
        result.checks.push('further zoom-out leaves the sample grid width unchanged');
        await wheel(0.01); fitted(await snapshot('tiny zoom-out at fractional floor'), 400);
        await wheel(-0.01); maps = await snapshot('tiny zoom-in at fractional floor'); assert(maps.every(m => m.cell >= fit));
        await zoomOut(); fitted(await snapshot('fractional floor after tiny steps'), 400);
        result.checks.push('fractional cell rounding never reverses the direction of a tiny wheel step');
        await page.screenshot({ path: path.join(output, 'fit-400.png') });
        await wheel(-120); maps = await snapshot('zoom in from fit'); assert(maps.every(m => m.cell > fit));
        await zoomOut(); fitted(await snapshot('zoom back to fit'), 400);
        result.checks.push('zoom-in remains available and zoom-out returns exactly to the shared floor');

        await range(50, 61); maps = await snapshot('short range raises floor'); fitted(maps, 12, 50);
        await zoomOut(); fitted(await snapshot('short range cannot shrink'), 12, 50);
        await range(0, 399); maps = await snapshot('range expansion preserves 16px'); assert(maps.every(m => m.cell === 16));
        await zoomOut(); fitted(await snapshot('range expansion permits zoom-out'), 400);
        result.checks.push('range changes raise an insufficient width, preserve a larger width, and update the zoom floor');

        await page.setViewportSize({ width: 1800, height: 900 }); maps = await snapshot('wider window'); fitted(maps, 400);
        const wide = maps[0].cell;
        await page.setViewportSize({ width: 1300, height: 900 }); maps = await snapshot('narrower window'); close(maps[0].cell, wide);
        await zoomOut(); fitted(await snapshot('narrower window new floor'), 400);
        result.checks.push('window expansion raises the floor; window contraction preserves zoom until the user zooms out');

        await drag(cards(1).first().locator('.heat-sidebar-resizer'), 250);
        maps = await snapshot('sidebars hidden'); assert(maps.every(m => m.sidebar === 0)); fitted(maps, 400);
        const hidden = maps[0].cell;
        await drag(cards(1).first().locator('.heat-sidebar-resizer'), -240);
        maps = await snapshot('sidebars restored'); assert(maps.every(m => m.sidebar > 0)); close(maps[0].cell, hidden);
        await zoomOut(); fitted(await snapshot('sidebar width new floor'), 400);
        result.checks.push('dragging the sidebar to zero and restoring it recomputes the common sample-area floor');

        await page.setViewportSize({ width: 1800, height: 1000 }); await frames();
        await page.evaluate(() => setSplitMode('horizontal')); await load(12, 2, 1);
        await zoomOut(1); fitted(await snapshot('side-by-side primary'), 400);
        const secondary = await snapshot('side-by-side secondary', 2); fitted(secondary, 12);
        await drag(page.locator('.split-resizer'), 180);
        fitted(await snapshot('split drag expands primary'), 400);
        const secondaryResized = await snapshot('secondary after divider drag', 2);
        assert(secondaryResized[0].area < secondary[0].area);
        const content = maps => maps.map(({ area, ...rest }) => rest);
        assert.deepEqual(content(secondaryResized), content(secondary));
        result.checks.push('side-by-side split resizing recalculates the primary floor without changing secondary samples or zoom');
        await page.evaluate(() => setSplitMode('vertical')); fitted(await snapshot('stacked split'), 400);
        await drag(page.locator('.split-resizer'), 0, 80); fitted(await snapshot('stacked split vertical drag'), 400);
        result.checks.push('stacked split and vertical divider dragging preserve the width floor');

        await page.evaluate(() => setSplitMode('single')); await frames();
        await page.evaluate(async () => { for (let i = 0; i < 9; ++i) await metricHeat.plot(['traffic'], 1); });
        await cards(1).last().scrollIntoViewIfNeeded(); await frames();
        const last = (await snapshot('offscreen map after scrolling')).at(-1); close(last.cell, Math.min(16, Math.max(1, last.area / 400)));
        assert.equal(last.first, 0); assert.equal(last.last, 399);
        result.checks.push('new and previously offscreen maps inherit the same fit width and full sample range');
        await page.locator('.heat-host[data-panel="1"]').evaluate(el => { el.scrollTop = 0; }); await frames();
        const native = (await snapshot('before ordinary wheel'))[0].cell;
        await wheel(120, 1, null);
        assert(await page.locator('.heat-host[data-panel="1"]').evaluate(el => el.scrollTop > 0));
        close((await snapshot('after ordinary wheel'))[0].cell, native);
        result.checks.push('ordinary wheel scrolls the map list without zooming');

        for (const count of [12, 1]) {
            await fresh(count); await zoomOut(); fitted(await snapshot(`${count} samples retain 16px`), count);
        }
        result.checks.push('short datasets, including one sample, remain at the 16px maximum');
        await fresh(2000); await zoomOut(); maps = await snapshot('large dataset at 1px'); fitted(maps, 2000);
        assert(maps.every(m => m.cell === 1 && m.count < 2000));
        await wheel(120, 1, 'Shift'); maps = await snapshot('pan large dataset');
        assert(maps.every(m => m.scroll > 0 && m.first > 0 && m.cell === 1));
        result.checks.push('datasets wider than the viewport at 1px retain the 1px floor and horizontal panning');

        await load(12); fitted(await snapshot('new small dataset after 1px zoom'), 12);
        result.checks.push('loading a shorter dataset raises the previous zoom width to its new floor');
        await page.evaluate(() => { setActivePanel(1); document.querySelector('#reloadLoadItem').click(); });
        await page.waitForFunction(() => !fileLoadBusy && $.active === 0); fitted(await snapshot('reload fit'), 12);
        result.checks.push('Reload preserves valid fitting samples and geometry');
        await page.locator('#metricMode').selectOption('line'); await frames();
        await page.locator('#metricMode').selectOption('heat'); await page.waitForFunction(() => $.active === 0);
        fitted(await snapshot('Line Heat round trip'), 12);
        result.checks.push('Line/Heat round trip retains fitting ranges and values');

        await page.evaluate(() => {
            window.zoomFitUpdates = 0;
            document.querySelectorAll('.heat-host[data-panel="1"] .heat-canvas').forEach(el => {
                const chart = echarts.getInstanceByDom(el), original = chart.setOption;
                chart.setOption = function (...args) { ++window.zoomFitUpdates; return original.apply(this, args); };
            });
        });
        await page.waitForTimeout(400); assert.equal(await page.evaluate(() => zoomFitUpdates), 0);
        result.checks.push('stable fit does not trigger a chart-update feedback loop');
        await page.evaluate(() => ClearAll(1)); await frames(); assert.equal(await cards(1).count(), 0);
        result.checks.push('Clear leaves an empty Heat panel without a layout or zoom error');
        assert.deepEqual(result.errors, []); result.status = 'PASS';
    } catch (e) { result.status = 'FAIL'; result.error = e.stack; throw e; }
    finally { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n'); await browser.close(); }
    console.log(JSON.stringify({ status: result.status, checks: result.checks }));
})().catch(e => { console.error(e); process.exitCode = 1; });
