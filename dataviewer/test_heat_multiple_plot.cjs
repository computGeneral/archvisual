/* Real-browser regression for one Heat map per Plot.
 * node archvisual/dataviewer/test_heat_multiple_plot.cjs [http://127.0.0.1:8097]
 * Uses the production H5 query/template paths and actual Plot button clicks.
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseUrl = process.argv[2] || 'http://127.0.0.1:8097';
const fixture = process.env.HEAT_TEST_FIXTURE || path.resolve(__dirname, '../examples/metricview.h5');
const output = process.env.HEAT_TEST_OUTPUT || path.resolve(__dirname, '../__output__/heat_multiple_plot');
const templateName = path.relative(path.resolve(__dirname, 'static/data'), path.join(output, 'roundtrip-template'));

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome',
        headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
    const errors = [], checks = [];
    const releases = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const cards = panel => page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    async function frames() {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function load(panel, selectedFixture = fixture) {
        return page.evaluate(async ({ panel, fixture }) => {
            const meta = await fetch('/api/show/server_load', { method: 'POST',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fixture, secondary: panel === 2 })
            }).then(r => r.json());
            if (meta.code !== 0) throw new Error(meta.msg);
            window.multiExpected ||= {};
            const names = meta.data.signal.slice(0, 6);
            const data = await fetch('/api/show/query', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: { expected: { Sig: names } }, mode: 'heat', secondary: panel === 2 })
            }).then(r => r.json());
            if (data.code !== 0) throw new Error(data.msg);
            multiExpected[panel] = { times: meta.data.times, names, values: data.data.expected.Sig };
            ProcessH5(meta, panel); return names;
        }, { panel, fixture: selectedFixture });
    }
    async function ready(panel, count) {
        await page.waitForFunction(({ panel, count }) => {
            const cards = Array.from(document.querySelectorAll(`.heat-host[data-panel="${panel}"] .heat-map`));
            return cards.length === count && Object.keys(metricHeat.selection(panel)).length === count &&
                cards.every(card => /^\d+ metrics ×/.test(card.querySelector('.heat-status').textContent));
        }, { panel, count });
        await frames();
    }
    async function plot(names, panel, count, wait = true) {
        await page.evaluate(panel => setActivePanel(panel), panel);
        const expression = '^(?:' + names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$';
        await page.locator('#filterMetric').fill(expression);
        await page.locator('#filterMetric').press('Enter');
        assert.deepEqual(await page.evaluate(panel => panel === 2 ? CurMetricSelectList2 : CurMetricSelectList, panel), names);
        await page.getByRole('button', { name: 'Plot', exact: true }).click();
        if (wait) await ready(panel, count);
    }
    async function snapshot(panel) {
        return page.evaluate(panel => {
            const expected = multiExpected[panel], selection = metricHeat.selection(panel);
            return Array.from(document.querySelectorAll(`.heat-host[data-panel="${panel}"] .heat-map`)).map(card => {
                const key = card.dataset.group, chart = echarts.getInstanceByDom(card.querySelector('.heat-canvas'));
                const base = { key, names: selection[key] && selection[key].Sig, color: card.querySelector('[name="heatColor"]').value };
                if (!chart || !chart.getOption().series) return base;
                const o = chart.getOption(), cells = o.series.filter(s => s.id === 'heat-values' || s.id === 'heat-missing').flatMap(s => s.data);
                const names = o.yAxis[0].data, labels = o.xAxis[0].data;
                const stats = o.series.filter(s => s.id === 'heat-statistics' || s.id === 'heat-statistics-missing').flatMap(s => s.data);
                if (stats.length !== names.length * 3 || o.grid[1].width !== 48 || o.grid[1].height !== o.grid[0].height ||
                    Math.abs(o.grid[1].left - o.grid[0].left - o.grid[0].width - 8) > 1e-9) throw new Error('Statistics must be three aligned 16px columns');
                const axis = chart.getViewOfComponentModel(chart.getModel().getComponent('xAxis', 0)).group;
                const axisRect = axis.getBoundingRect().clone();
                if (axis.getComputedTransform()) axisRect.applyTransform(axis.getComputedTransform());
                if (axisRect.y < -1) throw new Error('Sample tick labels must fit above the heatmap');
                const legend = chart.getViewOfComponentModel(chart.getModel().getComponent('visualMap')).group;
                const legendRect = legend.getBoundingRect().clone();
                if (legend.getComputedTransform()) legendRect.applyTransform(legend.getComputedTransform());
                const targetLeft = Math.max(0, Math.min(chart.getWidth() - legendRect.width,
                    o.grid[0].left + o.grid[0].width / 2 - legendRect.width / 2));
                if (Math.abs(legendRect.x - targetLeft) > 1 || legendRect.x < -1 ||
                    legendRect.x + legendRect.width > chart.getWidth() + 1) throw new Error('Color bar must center under sample cells and fit the viewport');
                const legendGap = legendRect.y - o.grid[0].top - o.grid[0].height;
                if (legendGap < 7 || legendGap > 9 || legendRect.y + legendRect.height > chart.getHeight()) {
                    throw new Error('Color bar must follow the visible heatmap by about 8px without vertical clipping: ' + legendGap);
                }
                if (cells.length !== names.length * labels.length) throw new Error('Missing per-sample cells');
                if (new Set(cells.map(c => c[4] + ':' + c[5])).size !== cells.length) throw new Error('Duplicate cells');
                for (const [x, y, , raw, sample, row] of cells) {
                    const name = selection[key].Sig[row];
                    if (raw !== expected.values[name][sample]) throw new Error('Raw value changed: ' + name);
                    if (labels[x] !== String(expected.times[sample]) || names[y] !== name) throw new Error('Sample/metric order changed');
                }
                return Object.assign(base, { columnWidth: o.grid[0].width / labels.length,
                    rowHeight: o.grid[0].height / names.length, scale: [o.visualMap[0].min, o.visualMap[0].max],
                    first: labels[0], last: labels.at(-1), scrollLeft: card.querySelector('.heat-viewport').scrollLeft });
            });
        }, panel);
    }
    async function point(panel, index, column = 0, row = 0) {
        await cards(panel).nth(index).scrollIntoViewIfNeeded(); await frames();
        return cards(panel).nth(index).evaluate((card, { column, row }) => {
            const canvas = card.querySelector('.heat-canvas'), chart = echarts.getInstanceByDom(canvas), rect = canvas.getBoundingClientRect();
            const xy = chart.convertToPixel({ seriesIndex: 0 }, [column, row]);
            return { x: rect.left + xy[0], y: rect.top + xy[1] };
        }, { column, row });
    }
    async function color(panel, index, name, value) {
        const card = cards(panel).nth(index); await card.scrollIntoViewIfNeeded();
        const input = card.locator(`[name="${name}"]`);
        if (name === 'heatColor') await input.selectOption(value);
        else { await input.fill(value); await input.press('Tab'); }
        await frames();
    }
    async function idle(label, duration = 600) {
        await frames(); await page.waitForTimeout(200);
        const before = await page.evaluate(() => ({ ...multiCounts }));
        await page.waitForTimeout(duration);
        assert.deepEqual(await page.evaluate(() => ({ ...multiCounts })), before, label);
        assert.deepEqual(errors, [], label);
        assert.deepEqual(await page.evaluate(() => multiLayoutErrors), [], label);
        checks.push(label);
    }
    async function sidebarLayout(panel) {
        const result = await cards(panel).evaluateAll(cards => cards.map(card => {
            const viewport = card.querySelector('.heat-viewport'), sidebar = card.querySelector('.heat-sidebar');
            const description = card.querySelector('.heat-description'), status = card.querySelector('.heat-status');
            const controls = card.querySelector('.heat-toolbar');
            if (!sidebar || !description) throw new Error('Missing right sidebar or instructions');
            if (!sidebar.contains(controls) || !sidebar.contains(status) || !sidebar.contains(description) || !sidebar.contains(card.querySelector('.heat-map-title'))) {
                throw new Error('Controls, title, status and instructions must be inside the sidebar');
            }
            if (controls.contains(description) || /Wheel|One cell|Gray =/.test(status.textContent)) {
                throw new Error('Static instructions must be separated from controls and dynamic status');
            }
            for (const text of ['One cell = one sample', 'Gray = no valid data', 'Ctrl+wheel:', 'Wheel: scroll', 'Drag left border:', 'Delete:']) {
                if (!description.textContent.includes(text)) throw new Error('Missing sidebar instruction: ' + text);
            }
            const widths = Array.from(controls.querySelectorAll('select, input')).map(el => el.getBoundingClientRect().width);
            if (!widths.every(width => width === 100)) throw new Error('All controls must be exactly 100 CSS px wide');
            const handle = card.querySelector('.heat-sidebar-resizer'), style = getComputedStyle(sidebar);
            return { plot: viewport.getBoundingClientRect().toJSON(), sidebar: sidebar.getBoundingClientRect().toJSON(),
                description: description.getBoundingClientRect().toJSON(), status: status.getBoundingClientRect().toJSON(),
                declaredWidth: Number(handle.getAttribute('aria-valuenow')), card: card.getBoundingClientRect().toJSON(),
                handle: handle.getBoundingClientRect().toJSON(), min: Number(handle.getAttribute('aria-valuemin')),
                max: Number(handle.getAttribute('aria-valuemax')), hidden: sidebar.getAttribute('aria-hidden'), inert: sidebar.inert,
                visibility: style.visibility, padding: style.padding, border: style.borderLeftWidth };
        }));
        for (const r of result) {
            assert(r.sidebar.left >= r.plot.right - 1, 'sidebar must be beside the plot');
            assert(Math.abs(r.sidebar.top - r.plot.top) <= 1, 'plot and sidebar must start at the same height');
            assert(r.sidebar.width >= 0 && r.sidebar.width <= 400);
            assert.equal(r.sidebar.width, r.declaredWidth); assert.equal(r.sidebar.width, result[0].sidebar.width);
            assert.equal(r.min, 0); assert.equal(r.max, 400); assert.equal(r.handle.width, 8);
            assert(r.handle.left >= r.plot.left && r.handle.right <= r.card.right, 'drag handle must stay inside the map');
            assert.equal(r.hidden, String(r.sidebar.width === 0)); assert.equal(r.inert, r.sidebar.width === 0);
            if (r.sidebar.width === 0) {
                assert.equal(r.visibility, 'hidden'); assert.equal(r.padding, '0px'); assert.equal(r.border, '0px');
                assert.equal(r.plot.right, r.card.right, 'collapsed sidebar must release its entire width');
                assert.equal(r.handle.right, r.card.right, 'hidden sidebar must keep an 8px handle at the right edge');
            } else assert.equal(r.visibility, 'visible');
            assert(r.description.top >= r.status.bottom, 'instructions must follow dynamic status inside the sidebar');
            assert(r.description.left >= r.sidebar.left && r.description.right <= r.sidebar.right);
            assert.equal(r.plot.width, result[0].plot.width, 'map axes must reserve the same width');
            assert.equal(r.plot.left, result[0].plot.left, 'map axes must stay aligned');
        }
        return result;
    }
    async function resizeSidebar(panel, delta) {
        const handle = cards(panel).first().locator('.heat-sidebar-resizer');
        await handle.scrollIntoViewIfNeeded(); await frames();
        const rect = await handle.boundingBox(), x = rect.x + rect.width / 2, y = rect.y + 20;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + delta, y, { steps: 8 }); await page.mouse.up(); await frames();
        assert.equal(await page.evaluate(() => document.body.classList.contains('heat-resizing')), false);
        return sidebarLayout(panel);
    }
    async function keyboardSidebar(panel, width) {
        const handle = cards(panel).first().locator('.heat-sidebar-resizer');
        await handle.focus(); await page.keyboard.press('Home');
        for (let value = 0; value < width; value += 10) await page.keyboard.press('ArrowLeft');
        await frames();
        assert((await sidebarLayout(panel)).every(r => r.sidebar.width === width));
    }
    try {
        await page.goto(baseUrl + '/metricviewer'); await page.waitForFunction(() => window.metricHeat);
        await page.evaluate(() => {
            window.multiCounts = { renders: 0, resizes: 0 }; window.multiLayoutErrors = [];
            window.addEventListener('error', event => multiLayoutErrors.push(event.message));
            const init = echarts.init;
            echarts.init = function (...args) {
                const chart = init.apply(this, args);
                if (args[0].classList.contains('heat-canvas')) {
                    chart.on('rendered', () => multiCounts.renders++);
                    const resize = chart.resize;
                    chart.resize = function (...args) { multiCounts.resizes++; return resize.apply(this, args); };
                }
                return chart;
            };
        });
        await page.locator('#metricMode').selectOption('heat'); const names = await load(1);
        await plot(names.slice(0, 2), 1, 1);
        await color(1, 0, 'heatMin', '0'); await color(1, 0, 'heatMax', '12345');
        const bounded = (await snapshot(1))[0];
        await plot([names[0], names[2]], 1, 2);
        let maps = await snapshot(1);
        assert.deepEqual(maps.map(m => m.names), [names.slice(0, 2), [names[0], names[2]]]);
        assert.deepEqual(maps[0].scale, bounded.scale); assert.deepEqual(maps[0].scale, [0, 12345]);
        const rects = await cards(1).evaluateAll(cards => cards.map(c => c.getBoundingClientRect().toJSON()));
        assert(rects[1].top >= rects[0].bottom, 'new map must appear below the previous map');
        assert.deepEqual(rects.map(r => r.height), [140, 140]);
        assert.equal(rects[1].top - rects[0].bottom, 6);
        checks.push('two-metric maps compact to 140px height with 6px inter-map spacing');
        checks.push('each actual Plot appends a separate map; prior metrics and bounds remain unchanged');
        checks.push('the same metric can appear in different maps');
        const beforeError = await sidebarLayout(1);
        await color(1, 0, 'heatMin', '20000');
        assert.match(await cards(1).first().locator('.heat-sidebar .heat-status').innerText(), /minimum must be smaller/);
        const afterError = await sidebarLayout(1);
        assert.deepEqual(afterError.map(r => r.plot), beforeError.map(r => r.plot), 'wrapped error status must not resize plots');
        await color(1, 0, 'heatMin', '0');
        checks.push('compact equal-width controls, status and instructions stay in the sidebar; errors do not resize plots');
        await color(1, 1, 'heatColor', 'row'); maps = await snapshot(1);
        assert.deepEqual(maps.map(m => m.scale), [[0, 12345], [0, 1]]);
        checks.push('Color and Min/Max are independent per map');
        let p = await point(1, 1, 5, 0); await page.mouse.move(p.x, p.y);
        await page.keyboard.down('Control'); await page.mouse.wheel(0, 120); await page.keyboard.up('Control'); await frames();
        maps = await snapshot(1);
        assert(maps[0].columnWidth < 16); assert.equal(maps[0].columnWidth, maps[1].columnWidth);
        assert.deepEqual(maps.map(m => m.rowHeight), [16, 16]);
        assert.equal(maps[0].first, maps[1].first);
        checks.push('Ctrl+wheel zoom links all maps in the panel while row height stays 16 px');
        await cards(1).nth(1).locator('.heat-viewport').evaluate(el => { el.scrollLeft = 640; }); await frames();
        maps = await snapshot(1); assert(maps[0].scrollLeft > 0);
        assert.equal(maps[0].scrollLeft, maps[1].scrollLeft); assert.equal(maps[0].first, maps[1].first);
        checks.push('native horizontal panning links sample windows without changing color bounds');
        await page.evaluate(() => { zoom_start.value = String(multiExpected[1].times[3]); zoom_end.value = String(multiExpected[1].times[17]); metricHeat.zoomFromInputs(1); });
        await frames(); maps = await snapshot(1);
        const range = await page.evaluate(() => [String(multiExpected[1].times[3]), String(multiExpected[1].times[17])]);
        assert(maps.every(m => m.first === range[0] && m.last === range[1]));
        checks.push('Start/End applies the same exact sample range to every map');
        const grouped = await page.evaluate(() => metricHeat.selection(1));
        await page.locator('#metricMode').selectOption('line');
        const line = await page.evaluate(() => ({ groups: MetricSelectList, grids: myChart.getOption().grid.length,
            series: myChart.getOption().series.map(s => ({ id: s.id, data: s.data })) }));
        assert.equal(line.grids, 2); assert.deepEqual(Object.keys(line.groups), Object.keys(grouped));
        assert.equal(line.series.filter(s => s.id.endsWith('&' + names[0])).length, 2);
        await page.locator('#metricMode').selectOption('heat'); await ready(1, 2);
        assert.deepEqual(await page.evaluate(() => metricHeat.selection(1)), grouped);
        maps = await snapshot(1); assert.deepEqual(maps.map(m => m.scale), [[0, 12345], [0, 1]]);
        checks.push('Line/Heat round trip preserves two groups, repeated metrics, sample range and independent colors');
        await page.locator('#templateBtn').click();
        await page.locator('#template_name').fill(templateName);
        const [exported] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/temp/export')),
            page.locator('#templateMenu [onclick="doTemplate(\'export\')"]').click()]);
        assert.equal((await exported.json()).code, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'roundtrip-template.json'))), grouped);
        await page.getByRole('button', { name: 'Clear', exact: true }).click(); await frames(); assert.equal(await cards(1).count(), 0);
        await page.locator('#templateBtn').click();
        const [imported] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/temp/import')),
            page.locator('#templateMenu [onclick="doTemplate(\'import\')"]').click()]);
        assert.equal((await imported.json()).code, 0); await ready(1, 2);
        assert.deepEqual(await page.evaluate(() => metricHeat.selection(1)), grouped);
        checks.push('production template export/import preserves map boundaries and color settings');
        p = await point(1, 1, 0, 0); await page.mouse.click(p.x, p.y); await page.keyboard.press('Delete'); await frames();
        maps = await snapshot(1); assert.deepEqual(maps.map(m => m.names), [names.slice(0, 2), [names[2]]]);
        checks.push('Delete removes the selected row only in its own map');
        let delayed = 0, releaseFirst;
        const firstQuery = new Promise(resolve => { releaseFirst = resolve; releases.push(resolve); });
        await page.route('**/api/show/query', async route => {
            const response = await route.fetch();
            const request = route.request().postDataJSON();
            if (request.mode === 'heat' && delayed++ === 0) await firstQuery;
            await route.fulfill({ response });
        });
        await plot([names[3]], 1, 3, false); await plot([names[4]], 1, 4, false);
        await page.waitForFunction(() => Object.keys(metricHeat.selection(1)).length === 3);
        await page.locator('#metricMode').selectOption('line'); assert.equal(await page.locator('#metricMode').inputValue(), 'heat');
        releaseFirst(); await ready(1, 4);
        assert(await page.locator('.heat-host[data-panel="1"] .heat-panel-status').evaluate(el => el.classList.contains('hidden')));
        checks.push('pending queries keep Heat active and the wait message clears when they finish');
        assert.deepEqual((await snapshot(1)).map(m => m.names), [names.slice(0, 2), [names[2]], [names[3]], [names[4]]]);
        await page.unroute('**/api/show/query');
        checks.push('rapid Plot requests completed out of order preserve both maps in click order');
        const linked = [];
        for (let i = 0; i < 4; i++) {
            await cards(1).nth(i).scrollIntoViewIfNeeded(); await frames();
            linked.push((await snapshot(1))[i]);
        }
        assert(linked.every(m => m.columnWidth === linked[0].columnWidth && m.first === linked[0].first && m.last === linked[0].last));
        checks.push('new and offscreen maps inherit the shared zoom and selected sample range');
        await page.setViewportSize({ width: 1500, height: 450 });
        p = await point(1, 0, 2, 0); const nativeBefore = await snapshot(1);
        const scrollBefore = await page.locator('.heat-host[data-panel="1"]').evaluate(el => el.scrollTop);
        await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, 120); await page.waitForTimeout(180); await frames();
        assert(await page.locator('.heat-host[data-panel="1"]').evaluate(el => el.scrollTop) > scrollBefore);
        assert.deepEqual((await snapshot(1)).map(m => m.columnWidth), nativeBefore.map(m => m.columnWidth));
        checks.push('ordinary wheel over a heatmap scrolls the map list without changing zoom');
        await page.setViewportSize({ width: 1500, height: 1050 }); await frames();
        const colorBounds = (await snapshot(1)).map(m => m.scale);
        let resized = await resizeSidebar(1, -60); assert(resized.every(r => r.sidebar.width === 240));
        assert.deepEqual((await snapshot(1)).map(m => m.scale), colorBounds);
        checks.push('dragging one left border widens all sidebars together without changing raw values or colors');
        await page.locator('#metricMode').selectOption('line'); await page.locator('#metricMode').selectOption('heat'); await ready(1, 4);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 240));
        checks.push('Line/Heat round trip retains the shared sidebar width');
        resized = await resizeSidebar(1, -500); assert(resized.every(r => r.sidebar.width === 400));
        await page.screenshot({ path: path.join(output, 'sidebar-max-400.png') });
        resized = await resizeSidebar(1, 500); assert(resized.every(r => r.sidebar.width === 0));
        await page.screenshot({ path: path.join(output, 'sidebar-hidden-0.png') });
        assert.deepEqual((await snapshot(1)).map(m => m.scale), colorBounds);
        assert.equal(await cards(1).first().locator('[name="heatMin"]').isVisible(), false);
        checks.push('pointer capture enforces 0–400 px bounds and zero width hides controls while releasing the full plot width');
        await page.locator('#metricMode').selectOption('line'); await page.locator('#metricMode').selectOption('heat'); await ready(1, 4);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
        checks.push('Line/Heat round trip preserves hidden sidebars without changing raw values or colors');
        for (const width of [1, 3, 10, 64, 180]) {
            const current = (await sidebarLayout(1))[0].sidebar.width;
            resized = await resizeSidebar(1, current - width);
            assert(resized.every(r => r.sidebar.width === width));
            await snapshot(1);
        }
        await page.screenshot({ path: path.join(output, 'sidebar-restored-180.png') });
        checks.push('real mouse drag reopens hidden sidebars through 1, 3, 10, 64 and 180 px without clipping the drag handle');
        const keyboardHandle = cards(1).first().locator('.heat-sidebar-resizer');
        await keyboardHandle.focus(); await page.keyboard.press('Home'); await frames();
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
        await page.keyboard.press('ArrowLeft'); await frames();
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 10));
        await page.keyboard.press('ArrowRight'); await frames();
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
        await page.keyboard.press('End'); await frames();
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 400));
        await keyboardSidebar(1, 180);
        checks.push('keyboard separator adjustment updates every map and its accessible width');
        const preserved = await page.evaluate(() => metricHeat.selection(1));
        assert.equal(await page.evaluate(() => metricHeat.plot(['missing_metric_for_regression'], 1)), false);
        await frames(); assert.deepEqual(await page.evaluate(() => metricHeat.selection(1)), preserved);
        assert.equal(await cards(1).count(), 4);
        checks.push('a failed new query reports an error and leaves existing maps intact');
        await page.locator('#filterMetric').fill(''); await page.locator('#filterMetric').press('Enter');
        await page.getByRole('button', { name: 'Plot', exact: true }).click(); assert.equal(await cards(1).count(), 4);
        checks.push('empty Plot creates no empty map');
        await page.evaluate(() => setSplitMode('horizontal')); await page.evaluate(() => setActivePanel(2));
        await page.locator('#metricMode').selectOption('heat'); await load(2); await plot(names.slice(4, 6), 2, 1);
        const other = await page.evaluate(() => metricHeat.selection(2));
        const otherMap = (await snapshot(2))[0];
        p = await point(1, 0, 1, 0); await page.mouse.move(p.x, p.y);
        await page.keyboard.down('Control'); await page.mouse.wheel(0, 120); await page.keyboard.up('Control'); await frames();
        assert.deepEqual((await snapshot(2))[0], otherMap);
        await resizeSidebar(1, -60);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 240));
        assert((await sidebarLayout(2)).every(r => r.sidebar.width === 180));
        await resizeSidebar(1, 500);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
        assert((await sidebarLayout(2)).every(r => r.sidebar.width === 180));
        await resizeSidebar(1, -180);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 180));
        checks.push('split-panel hide and real edge-drag reopen affect only the selected panel');
        checks.push('split panels keep separate maps, colors and horizontal view state');
        checks.push('sidebar dragging is linked within a panel and isolated from the other split panel');
        await page.evaluate(() => setSplitMode('single'));
        // Visit every card so all lazy chart instances participate in resize/idle checks.
        for (let i = 0; i < 4; i++) { await cards(1).nth(i).scrollIntoViewIfNeeded(); await frames(); }
        await cards(1).first().scrollIntoViewIfNeeded();
        for (const layout of ['single', 'horizontal', 'vertical']) {
            await page.evaluate(layout => setSplitMode(layout), layout);
            for (const [width, height] of [[1500, 1050], [961, 601], [641, 481], [401, 261]]) {
                await page.setViewportSize({ width, height }); await idle(`multi-map stability: ${layout} ${width}×${height}`);
                await sidebarLayout(1);
                checks.push(`resizable sidebar with instructions: ${layout} ${width}×${height}`);
                if (layout === 'horizontal' && width === 641) {
                    const min = cards(1).first().locator('[name="heatMin"]');
                    await min.scrollIntoViewIfNeeded(); await min.click(); await min.fill('0'); await min.press('Tab'); await frames();
                    const accessible = await min.evaluate(input => {
                        const host = input.closest('.heat-host'), a = input.getBoundingClientRect(), b = host.getBoundingClientRect();
                        return host.scrollWidth > host.clientWidth && host.scrollLeft > 0 && a.left >= b.left && a.right <= b.right;
                    });
                    assert(accessible, 'narrow split must scroll to accessible right-side controls');
                    const narrow = await resizeSidebar(1, -40);
                    assert(narrow.every(r => r.sidebar.width === 220));
                    assert((await sidebarLayout(2)).every(r => r.sidebar.width === 180));
                    await resizeSidebar(1, 500);
                    assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
                    assert((await sidebarLayout(2)).every(r => r.sidebar.width === 180));
                    await page.screenshot({ path: path.join(output, 'narrow-split-hidden.png') });
                    await resizeSidebar(1, -180);
                    assert((await sidebarLayout(1)).every(r => r.sidebar.width === 180));
                    checks.push('narrow split can hide and reopen sidebars from the visible right edge after horizontal scrolling');
                    checks.push('left-border dragging works after narrow-panel horizontal scrolling and keeps the other panel unchanged');
                    await page.locator('.heat-host[data-panel="1"]').evaluate(el => { el.scrollLeft = 0; }); await frames();
                    checks.push('narrow split preserves the right sidebar and supports real control clicks after horizontal scrolling');
                }
            }
        }
        await page.setViewportSize({ width: 1500, height: 1050 }); await page.evaluate(() => setSplitMode('single'));
        await page.evaluate(() => setActivePanel(1));
        await page.getByRole('button', { name: 'Clear', exact: true }).click(); await frames();
        assert.equal(await cards(1).count(), 0); assert.deepEqual(await page.evaluate(() => metricHeat.selection(1)), {});
        assert.deepEqual(await page.evaluate(() => metricHeat.selection(2)), other);
        checks.push('Clear empties only the active panel');
        await page.route('**/api/show/query', async route => {
            const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 400)); await route.fulfill({ response });
        });
        await plot([names[0]], 1, 1, false);
        await page.getByRole('button', { name: 'Clear', exact: true }).click(); await page.waitForTimeout(650);
        assert.equal(await cards(1).count(), 0); assert.deepEqual(await page.evaluate(() => metricHeat.selection(1)), {});
        await page.unroute('**/api/show/query');
        checks.push('Clear invalidates pending Plot responses without resurrecting removed maps');
        await plot(names.slice(0, 2), 1, 1);
        const activeHandle = cards(1).first().locator('.heat-sidebar-resizer');
        await activeHandle.scrollIntoViewIfNeeded(); const activeRect = await activeHandle.boundingBox();
        const dragX = activeRect.x + activeRect.width / 2, dragY = activeRect.y + 20;
        await page.mouse.move(dragX, dragY); await page.mouse.down();
        await page.mouse.move(dragX - 40, dragY, { steps: 4 }); await frames();
        assert(await page.evaluate(() => document.body.classList.contains('heat-resizing')));
        await page.evaluate(() => ClearAll(1)); await page.mouse.up(); await frames();
        assert.equal(await cards(1).count(), 0);
        assert.equal(await page.evaluate(() => document.body.classList.contains('heat-resizing')), false);
        checks.push('removing a map during an active drag releases pointer capture and the resize cursor');
        await plot(names.slice(0, 2), 1, 1); await plot([names[2]], 1, 2);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 220));
        checks.push('new Plot maps inherit the panel sidebar width after Clear');
        await plot([names[0]], 1, 3);
        p = await point(1, 2, 0, 0); await page.mouse.click(p.x, p.y); await page.keyboard.press('Delete'); await frames();
        assert.equal(await cards(1).count(), 2);
        assert.deepEqual((await snapshot(1)).map(m => m.names), [names.slice(0, 2), [names[2]]]);
        checks.push('deleting the final row removes only its empty map');
        await load(1, process.env.HEAT_TEST_RELOAD_FIXTURE || fixture); await ready(1, 2);
        maps = await snapshot(1); assert.deepEqual(maps.map(m => m.names), [names.slice(0, 2), [names[2]]]);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 220));
        checks.push('reloading H5 refreshes every map while retaining its metric grouping');
        await idle('multi-map idle after reload', 1500);
        await resizeSidebar(1, 500);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
        await idle('hidden sidebars remain idle without repaint or resize feedback', 1500);
        await plot([names[0]], 1, 3);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
        await snapshot(1);
        checks.push('new Plot inherits the hidden sidebar state and preserves exact raw sample cells');
        await load(1, process.env.HEAT_TEST_RELOAD_FIXTURE || fixture); await ready(1, 3);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
        await snapshot(1);
        checks.push('H5 reload retains zero-width sidebars and refreshes raw values for every map');
        await page.getByRole('button', { name: 'Clear', exact: true }).click();
        await plot(names.slice(0, 2), 1, 1); await plot([names[2]], 1, 2);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 0));
        await snapshot(1);
        checks.push('Clear followed by new Plot retains hidden sidebars');
        await resizeSidebar(1, -220);
        assert((await sidebarLayout(1)).every(r => r.sidebar.width === 220));
        await snapshot(1);
        await idle('reopened sidebars remain idle without repaint or resize feedback', 1500);
        assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => multiLayoutErrors), []);
        await page.screenshot({ path: path.join(output, 'multiple-heatmaps.png') });
        fs.writeFileSync(path.join(output, 'multiple-result.json'), JSON.stringify({ status: 'PASS', fixture, checks, errors, maps }, null, 2));
        console.log(`PASS: ${checks.length} multiple-Plot Heat checks`);
    } catch (error) {
        fs.writeFileSync(path.join(output, 'multiple-result.json'), JSON.stringify({ status: 'FAIL', checks, errors, error: String(error) }, null, 2));
        await page.screenshot({ path: path.join(output, 'multiple-failure.png') }); throw error;
    } finally { releases.forEach(release => release()); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
