/* Browser regression for fixed Heat row height and horizontal wheel zoom.
 * node archvisual/dataviewer/test_heat_scale.cjs [http://127.0.0.1:8097]
 * HEAT_TEST_FIXTURE may select a larger H5; the real example is the default.
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseUrl = process.argv[2] || 'http://127.0.0.1:8097';
const fixture = process.env.HEAT_TEST_FIXTURE || path.resolve(__dirname, '../examples/metricview.h5');
const output = process.env.HEAT_TEST_OUTPUT || path.resolve(__dirname, '../../__output__/archvisual/heat_scale');

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({
        executablePath: process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome', headless: true,
        ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errors = [], checks = [], measurements = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const host = panel => `.heat-host[data-panel="${panel}"]`;
    async function load(panel) {
        await page.evaluate(async ({ panel, fixture }) => {
            const meta = await fetch('/api/show/server_load', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: fixture, secondary: panel === 2 })
            }).then(r => r.json());
            if (meta.code !== 0) throw new Error(meta.msg);
            ProcessH5(meta, panel);
            const names = meta.data.signal.slice(0, 60);
            window.scaleExpected ||= {};
            const data = await fetch('/api/show/query', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: { expected: { Max: 'dataMax', Stack: false, Sig: names } },
                    secondary: panel === 2, mode: 'heat' })
            }).then(r => r.json());
            if (data.code !== 0) throw new Error(data.msg);
            scaleExpected[panel] = { times: meta.data.times, names, values: data.data.expected.Sig };
            metricHeat.plot(names, panel);
        }, { panel, fixture });
        await page.waitForFunction(panel => {
            const el = document.querySelector(`.heat-host[data-panel="${panel}"] .heat-status`);
            return el && /^\d+ metrics ×/.test(el.textContent);
        }, panel);
    }
    async function measure(panel = 1) {
        return page.evaluate(panel => {
            const host = document.querySelector(`.heat-host[data-panel="${panel}"]`);
            const chart = echarts.getInstanceByDom(host.querySelector('.heat-canvas'));
            const opt = chart.getOption(), viewport = host.querySelector('.heat-viewport');
            const cells = opt.series.filter(s => s.id === 'heat-values' || s.id === 'heat-missing').flatMap(s => s.data), expected = scaleExpected[panel];
            const names = opt.yAxis[0].data, labels = opt.xAxis[0].data;
            if (cells.length !== names.length * labels.length ||
                new Set(cells.map(c => c[4] + ':' + c[5])).size !== cells.length) {
                throw new Error('Every visible sample must have exactly one cell per metric');
            }
            for (const cell of cells) {
                const [x, y, , raw, sample, row] = cell;
                if (raw !== expected.values[expected.names[row]][sample]) throw new Error('Raw sample changed');
                if (labels[x] !== String(expected.times[sample])) throw new Error('Sample label changed');
                if (names[y] !== expected.names[row]) throw new Error('Metric order changed');
            }
            const grid = opt.grid[0], rect = host.querySelector('.heat-canvas').getBoundingClientRect();
            const stats = opt.series.filter(s => s.id === 'heat-statistics' || s.id === 'heat-statistics-missing').flatMap(s => s.data);
            if (opt.grid[1].width !== 48 || opt.grid[1].height !== grid.height || stats.length !== names.length * 3 ||
                Math.abs(opt.grid[1].left - grid.left - grid.width - 8) > 1e-9) throw new Error('Statistics must remain three aligned 16px columns');
            const axis = chart.getViewOfComponentModel(chart.getModel().getComponent('xAxis', 0)).group;
            const axisRect = axis.getBoundingRect().clone();
            if (axis.getComputedTransform()) axisRect.applyTransform(axis.getComputedTransform());
            if (axisRect.y < -1) throw new Error('Sample tick labels must fit above the heatmap');
            const legend = chart.getViewOfComponentModel(chart.getModel().getComponent('visualMap')).group;
            const legendRect = legend.getBoundingRect().clone();
            if (legend.getComputedTransform()) legendRect.applyTransform(legend.getComputedTransform());
            const targetLeft = Math.max(0, Math.min(chart.getWidth() - legendRect.width,
                grid.left + grid.width / 2 - legendRect.width / 2));
            if (Math.abs(legendRect.x - targetLeft) > 1 || legendRect.x < -1 ||
                legendRect.x + legendRect.width > chart.getWidth() + 1) throw new Error('Color bar must center under sample cells and fit the viewport');
            const legendGap = legendRect.y - grid.top - grid.height;
            if (legendGap < 7 || legendGap > 9 || legendRect.y + legendRect.height > chart.getHeight()) {
                throw new Error('Color bar must follow the visible heatmap by about 8px without vertical clipping: ' + legendGap);
            }
            const viewRect = viewport.getBoundingClientRect();
            if (Math.abs(rect.left - viewRect.left) > 1 || Math.abs(rect.top - viewRect.top) > 1) {
                throw new Error('Canvas must remain at the viewport origin while panning');
            }
            return { columnWidth: grid.width / labels.length, rowHeight: grid.height / names.length,
                first: Math.min(...cells.map(c => c[4])), last: Math.max(...cells.map(c => c[4])),
                firstRow: Math.min(...cells.map(c => c[5])), count: cells.length,
                visibleRows: names.length, lastRow: Math.max(...cells.map(c => c[5])),
                scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop,
                scrollHeight: viewport.scrollHeight, scale: [opt.visualMap[0].min, opt.visualMap[0].max],
                legendGap, legendBottom: legendRect.y + legendRect.height,
                border: opt.series[0].itemStyle.borderWidth,
                pointer: { x: rect.left + grid.left + 80, y: rect.top + grid.top + 24 },
                center: { x: rect.left + grid.left + 80, y: rect.top + grid.top + 8 },
                sampleCount: expected.times.length, rows: expected.names.length };
        }, panel);
    }
    async function wheel(delta, panel = 1, shift = false) {
        const m = await measure(panel);
        await page.mouse.move(m.pointer.x, m.pointer.y);
        if (shift) await page.keyboard.down('Shift');
        else await page.keyboard.down('Control');
        await page.mouse.wheel(0, delta);
        if (shift) await page.keyboard.up('Shift');
        else await page.keyboard.up('Control');
        await page.waitForTimeout(180);
        return measure(panel);
    }
    async function idle(label) {
        const before = await page.evaluate(() => window.scaleRenders || 0);
        await page.waitForTimeout(700);
        assert.equal(await page.evaluate(() => window.scaleRenders || 0), before, label);
        checks.push(label);
    }
    try {
        await page.goto(baseUrl + '/metricviewer');
        await page.waitForFunction(() => window.metricHeat);
        await page.locator('#metricMode').selectOption('heat');
        await load(1);
        assert.equal(await page.locator('[name="heatCell"]').count(), 0);
        let m = await measure();
        assert.equal(m.columnWidth, 16); assert.equal(m.rowHeight, 16);
        checks.push('no Cell size control; initial cells are 16 × 16 CSS px');
        const ordinaryBefore = await measure();
        await page.mouse.move(ordinaryBefore.pointer.x, ordinaryBefore.pointer.y);
        await page.mouse.wheel(0, 80); await page.waitForTimeout(180);
        m = await measure(); assert.equal(m.columnWidth, ordinaryBefore.columnWidth);
        assert(m.scrollTop > ordinaryBefore.scrollTop);
        checks.push('ordinary wheel over data scrolls vertically without zooming');
        const browserDpr = await page.evaluate(() => devicePixelRatio);
        await page.evaluate(() => {
            const host = document.querySelector('.heat-host[data-panel="1"]');
            echarts.getInstanceByDom(host.querySelector('.heat-canvas')).on('rendered', () => {
                window.scaleRenders = (window.scaleRenders || 0) + 1;
            });
            host.querySelector('.heat-viewport').scrollLeft = 500;
            host.querySelector('.heat-viewport').scrollTop = 160;
        });
        await page.waitForTimeout(200);
        const before = await measure();
        m = await wheel(120);
        assert(m.columnWidth < 16 && m.columnWidth > 1);
        assert.equal(m.rowHeight, 16); assert.equal(m.scrollTop, before.scrollTop);
        assert.equal(m.scrollHeight, before.scrollHeight); assert.deepEqual(m.scale, before.scale);
        const anchorBefore = before.first + 80 / before.columnWidth;
        const anchorAfter = m.first + 80 / m.columnWidth;
        assert(Math.abs(anchorAfter - anchorBefore) <= 1, 'pointer sample remains within one cell');
        measurements.push({ before, after: m });
        checks.push('Ctrl+wheel changes only horizontal scale and preserves pointer sample, vertical position and color bounds');
        m = await wheel(10000);
        assert.equal(m.columnWidth, 1); assert.equal(m.rowHeight, 16); assert.equal(m.border, 0);
        await idle('no idle redraw at 1 px/sample');
        const pixel = await page.evaluate(() => {
            const element = document.querySelector('.heat-host[data-panel="1"] .heat-canvas');
            const chart = echarts.getInstanceByDom(element), canvas = element.querySelector('canvas');
            const point = chart.convertToPixel({ seriesIndex: 0 }, [0, 0]);
            const ratio = canvas.width / chart.getWidth();
            return Array.from(canvas.getContext('2d').getImageData(Math.floor(point[0] * ratio),
                Math.floor(point[1] * ratio), 1, 1).data);
        });
        assert.equal(pixel[3], 255, 'a 1 px cell must have a visible fill');
        await page.screenshot({ path: path.join(output, 'heat-scale-1px.png') });
        checks.push('minimum 1 px/sample keeps fills visible without cell borders; raw values remain exact');
        const min = await measure();
        assert.equal((await wheel(10000)).columnWidth, 1);
        m = await wheel(-10000);
        assert.equal(m.columnWidth, 16); assert.equal(m.rowHeight, 16);
        assert.equal((await wheel(-10000)).columnWidth, 16);
        assert.equal(await page.evaluate(() => devicePixelRatio), browserDpr, 'Ctrl+wheel must not change browser zoom');
        checks.push('wheel clamps at both 1 px and 16 px');
        const panBefore = await measure();
        m = await wheel(240, 1, true);
        assert.equal(m.columnWidth, 16); assert(m.scrollLeft > panBefore.scrollLeft);
        checks.push('Shift+wheel pans horizontally without changing scale');
        const verticalBefore = m;
        await page.mouse.move(m.pointer.x - 100, m.pointer.y);
        await page.mouse.wheel(0, 80);
        await page.waitForTimeout(180);
        m = await measure();
        assert.equal(m.columnWidth, verticalBefore.columnWidth);
        assert(m.scrollTop > verticalBefore.scrollTop);
        checks.push('wheel over metric labels scrolls vertically without zooming');
        await page.locator(host(1) + ' .heat-viewport').evaluate(el => {
            el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight;
        });
        await page.waitForTimeout(200);
        m = await measure(); assert.equal(m.last, m.sampleCount - 1); assert.equal(m.lastRow, m.rows - 1);
        checks.push('last original sample and last metric remain accessible');
        await page.evaluate(() => setSplitMode('horizontal'));
        await page.evaluate(() => setActivePanel(2));
        await page.locator('#metricMode').selectOption('heat');
        await load(2);
        const other = await measure(1);
        m = await wheel(120, 2);
        assert(m.columnWidth < 16); assert.equal(m.rowHeight, 16);
        assert.deepEqual(await measure(1), other);
        checks.push('split panels keep independent horizontal scales and scroll positions');
        await page.locator(host(2) + ' [name="heatColor"]').selectOption('row');
        await page.waitForFunction(() => {
            const chart = echarts.getInstanceByDom(document.querySelector('.heat-host[data-panel="2"] .heat-canvas'));
            const scale = chart.getOption().visualMap[0];
            return scale.min === 0 && scale.max === 1;
        });
        m = await measure(2); assert.deepEqual(m.scale, [0, 1]); assert.equal(m.rowHeight, 16);
        checks.push('per-metric normalization preserves exact original samples when zoomed');
        const savedWidth = m.columnWidth;
        await page.locator('#metricMode').selectOption('line');
        await page.waitForTimeout(150);
        await page.locator('#metricMode').selectOption('heat');
        await page.waitForTimeout(350);
        m = await measure(2); assert.equal(m.columnWidth, savedWidth); assert.equal(m.rowHeight, 16);
        checks.push('Line/Heat round trip preserves the horizontal scale and metric selection');
        await page.evaluate(() => setActivePanel(2));
        await page.locator('#zoom_start').fill(await page.evaluate(() => String(scaleExpected[2].times[3])));
        await page.locator('#zoom_end').fill(await page.evaluate(() => String(scaleExpected[2].times[17])));
        await page.evaluate(() => metricHeat.zoomFromInputs(2));
        await page.waitForFunction(() => {
            const chart = echarts.getInstanceByDom(document.querySelector('.heat-host[data-panel="2"] .heat-canvas'));
            return chart.getOption().xAxis[0].data[0] === String(scaleExpected[2].times[3]);
        });
        m = await measure(2); assert.equal(m.first, 3); assert.equal(m.last, 17);
        assert.equal(m.count, m.visibleRows * 15);
        // Multiplying the same width by a different category count, then
        // dividing it back, can differ by one floating-point ULP. This bound
        // applies only to CSS geometry; all raw samples above remain exact.
        assert(Math.abs(m.columnWidth - savedWidth) < 1e-9, 'range selection must preserve CSS cell width');
        checks.push('Start/End retains 15 individual samples with no aggregation');
        await idle('no idle redraw after wheel zoom and range changes');
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(output, 'heat-scale.png') });
        fs.writeFileSync(path.join(output, 'scale-result.json'), JSON.stringify({ status: 'PASS', fixture, checks, measurements, min, errors }, null, 2));
        console.log(`PASS: ${checks.length} Heat scale checks; raw values and 16 px row height preserved`);
    } catch (error) {
        fs.writeFileSync(path.join(output, 'scale-result.json'), JSON.stringify({ status: 'FAIL', checks, measurements, error: String(error), errors }, null, 2));
        await page.screenshot({ path: path.join(output, 'heat-scale-failure.png') });
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
