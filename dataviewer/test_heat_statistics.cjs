/* Real H5/Chrome regression for the fixed min/avg/max columns.
 * node archvisual/dataviewer/test_heat_statistics.cjs [http://127.0.0.1:8097]
 * Generates independent math.fsum reference fixtures under HEAT_TEST_OUTPUT.
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.HEAT_TEST_OUTPUT || path.join(root, '__output__/heat_statistics'));
const baseUrl = process.argv[2] || 'http://127.0.0.1:8097';

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const fixture = spawnSync('bash', ['-c', 'set -e\nsource \"$1/scripts/setup_python.sh\"\narchvisual_use_python\narchvisual_hold_python\nexec \"$ARCHVISUAL_PYTHON\" -B -', 'heat-statistics', root], {
        cwd: root, encoding: 'utf8', env: { ...process.env, HEAT_STATS_OUTPUT: output }, input: `
import json, math, os
from pathlib import Path
import pandas as pd
out = Path(os.environ['HEAT_STATS_OUTPUT'])
for label, count, offset in [('original', 257, 0), ('reload', 137, 500), ('longlabels', 257, 0)]:
    data = {f'port_{r}.traffic_bytes': [r * 1000 + c for c in range(count)] for r in range(60)}
    data['port_1.traffic_bytes'] = [0, None, 0, 10] + [None] * (count - 4)
    data['port_2.traffic_bytes'] = [7] * count
    data['port_3.traffic_bytes'] = [None] * count
    data['port_4.traffic_bytes'] = [0, 0.5, 1] + [None] * (count - 3)
    data['port_5.traffic_bytes'] = [1e16, 1, -1e16] + [None] * (count - 3)
    data = {name: [None if v is None else v + offset for v in values] for name, values in data.items()}
    times = [10**15 + i * 100 if label == 'longlabels' else (i + 1) * 100 for i in range(count)]
    frame = pd.DataFrame(data, index=times, dtype='float64')
    with pd.HDFStore(out / (label + '.h5'), 'w') as store:
        store.put('data', frame)
        store.put('config', pd.Series({'SamplePeriod': 100}))
    stats = {}
    for name, values in data.items():
        valid = [v for v in values if v is not None]
        stats[name] = [min(valid), math.fsum(valid) / len(valid), max(valid)] if valid else [None] * 3
    (out / (label + '.json')).write_text(json.dumps({'times': times, 'names': list(data), 'values': data, 'stats': stats}))
` });
    fs.writeFileSync(path.join(output, 'fixture.log'), fixture.stdout + fixture.stderr);
    assert.equal(fixture.status, 0, 'ArchVisual Python must generate independent reference fixtures');
    const browser = await chromium.launch({ executablePath: process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome',
        headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
    const errors = [], checks = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const cards = panel => page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
    async function ready(panel) {
        await page.waitForFunction(panel => {
            const list = Array.from(document.querySelectorAll(`.heat-host[data-panel="${panel}"] .heat-map`));
            return list.length && list.every(card => card.querySelector('.heat-status').textContent.includes('× ' + statsExpected[panel].times.length + ' samples'));
        }, panel);
        await frames();
    }
    async function load(panel, label) {
        const expected = JSON.parse(fs.readFileSync(path.join(output, label + '.json')));
        await page.evaluate(async ({ panel, file, expected }) => {
            const meta = await fetch('/api/show/server_load', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: file, secondary: panel === 2 }) }).then(r => r.json());
            if (meta.code !== 0) throw Error(meta.msg);
            window.statsExpected ||= {}; statsExpected[panel] = expected; ProcessH5(meta, panel);
        }, { panel, file: path.join(output, label + '.h5'), expected });
        return expected.names;
    }
    async function plot(panel, names) {
        assert(await page.evaluate(({ panel, names }) => metricHeat.plot(names, panel), { panel, names }));
        await ready(panel);
    }
    async function measure(panel = 1, index = 0) {
        await cards(panel).nth(index).scrollIntoViewIfNeeded(); await frames();
        return cards(panel).nth(index).evaluate((card, panel) => {
            const canvas = card.querySelector('.heat-canvas'), chart = echarts.getInstanceByDom(canvas), o = chart.getOption();
            const expected = statsExpected[panel], names = o.yAxis[0].data, labels = o.xAxis[0].data, grid = o.grid[0], stats = o.grid[1];
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
                legendRect.x + legendRect.width > chart.getWidth() + 1) throw Error('Color bar must center under sample cells and fit the viewport');
            const cells = o.series.filter(s => s.id === 'heat-values' || s.id === 'heat-missing').flatMap(s => s.data);
            const summary = o.series.filter(s => s.id === 'heat-statistics' || s.id === 'heat-statistics-missing').flatMap(s => s.data);
            if (cells.length !== names.length * labels.length || summary.length !== names.length * 3 ||
                new Set(summary.map(v => v[0] + ':' + v[1])).size !== summary.length) throw Error('Missing or duplicate sample/statistic cells');
            if (o.xAxis[1].data.join(',') !== 'min,avg,max' || JSON.stringify(o.yAxis[1].data) !== JSON.stringify(names)) throw Error('Statistic labels/rows changed');
            if (stats.width !== 48 || stats.top !== grid.top || stats.height !== grid.height ||
                Math.abs(stats.left - grid.left - grid.width - 8) > 1e-9 || stats.left + stats.width > chart.getWidth()) throw Error('Statistic geometry changed');
            for (const [x, y, , raw, sample] of cells) {
                if (raw !== expected.values[names[y]][sample] || labels[x] !== String(expected.times[sample])) throw Error('Raw sample or label changed');
            }
            for (const series of o.series.filter(s => s.id.startsWith('heat-statistics'))) {
                for (const [x, y, color, raw, sample] of series.data) {
                    if (raw !== expected.stats[names[y]][x] || sample !== -1) throw Error('Full-file statistic changed: ' + names[y] + '/' + x);
                    if ((raw === null) !== series.id.endsWith('-missing')) throw Error('Missing statistic must use gray series');
                    if (card.querySelector('[name="heatColor"]').value === 'row' && raw !== null) {
                        const constant = expected.stats[names[y]][0] === expected.stats[names[y]][2];
                        if (constant && color !== 0 || !constant && x === 0 && color !== 0 || !constant && x === 2 && color !== 1) throw Error('Normalized statistic endpoints changed');
                    }
                }
            }
            const a = chart.convertToPixel({ seriesIndex: 2 }, [0, 0]), b = chart.convertToPixel({ seriesIndex: 2 }, [1, 0]);
            const m = chart.convertToPixel({ seriesIndex: 0 }, [0, 0]), rect = canvas.getBoundingClientRect();
            if (b[0] - a[0] !== 16 || a[1] !== m[1] || stats.height / names.length !== 16) throw Error('Statistic cells must be aligned 16px squares');
            return { names, values: Object.fromEntries(names.map(name => [name, expected.stats[name]])), width: grid.width / labels.length,
                first: Number(labels[0]), last: Number(labels.at(-1)),
                point: { x: rect.left + b[0], y: rect.top + b[1] }, mainPoint: { x: rect.left + m[0], y: rect.top + m[1] } };
        }, panel);
    }
    async function statisticPoint(column, row) {
        return cards(1).first().evaluate((card, { column, row }) => {
            const canvas = card.querySelector('.heat-canvas'), chart = echarts.getInstanceByDom(canvas), rect = canvas.getBoundingClientRect();
            const p = chart.convertToPixel({ seriesIndex: 2 }, [column, row]);
            return { x: rect.left + p[0], y: rect.top + p[1] };
        }, { column, row });
    }
    try {
        await page.goto(baseUrl + '/metricviewer'); await page.waitForFunction(() => window.metricHeat);
        await page.locator('#metricMode').selectOption('heat'); const names = await load(1, 'original');
        await plot(1, names); let m = await measure();
        checks.push('independent math.fsum reference matches every visible min/avg/max and unchanged raw sample exactly');
        assert.deepEqual(m.values[names[1]], [0, 10 / 3, 10]);
        assert.deepEqual(m.values[names[3]], [null, null, null]); assert.equal(m.values[names[5]][1], 1 / 3);
        checks.push('zero, missing, constant, ratio-like and cancellation cases retain the approved statistical meaning');
        await page.mouse.move(m.point.x, m.point.y);
        await page.waitForFunction(() => document.querySelector('.heat-canvas').textContent.includes('Statistic: avg'));
        const tooltip = await cards(1).first().locator('.heat-canvas').innerText();
        assert.match(tooltip, /Scope: all samples in file/); assert.match(tooltip, /Raw value: 128/);
        assert.match(tooltip, /Valid samples: 257 \/ 257/);
        checks.push('real mouse hover reports statistic, full-file scope, valid sample count and complete raw value');
        await page.screenshot({ path: path.join(output, 'statistics-tooltip.png') });
        let p = await statisticPoint(1, 3); await page.mouse.move(p.x, p.y);
        await page.waitForFunction(() => document.querySelector('.heat-canvas').textContent.includes('Valid samples: 0 / 257'));
        assert.match(await cards(1).first().locator('.heat-canvas').innerText(), /No valid data/);
        checks.push('entirely missing metric reports no valid value with zero valid samples');
        for (const [name, value] of [['heatMin', '0'], ['heatMax', '100']]) {
            const input = cards(1).first().locator(`[name="${name}"]`); await input.fill(value); await input.press('Tab'); await frames();
        }
        await measure();
        const pixel = await cards(1).first().evaluate(card => {
            const el = card.querySelector('.heat-canvas'), chart = echarts.getInstanceByDom(el), canvas = el.querySelector('canvas');
            const p = chart.convertToPixel({ seriesIndex: 2 }, [2, 0]), ratio = canvas.width / chart.getWidth();
            return Array.from(canvas.getContext('2d').getImageData(Math.floor(p[0] * ratio), Math.floor(p[1] * ratio), 1, 1).data);
        });
        assert.deepEqual(pixel, [215, 48, 39, 255]);
        p = await statisticPoint(2, 0); await page.mouse.move(p.x, p.y);
        await page.waitForFunction(() => document.querySelector('.heat-canvas').textContent.includes('Statistic: max'));
        assert.match(await cards(1).first().locator('.heat-canvas').innerText(), /Raw value: 256/);
        checks.push('manual color bounds clamp statistic color while preserving the full raw statistic and tooltip');
        await page.mouse.move(m.mainPoint.x, m.mainPoint.y); await page.keyboard.down('Control');
        await page.mouse.wheel(0, 120); await page.keyboard.up('Control'); await frames(); m = await measure();
        assert(m.width < 16); checks.push('Ctrl zoom changes sample width while all statistic squares stay 16px');
        await page.locator('#zoom_start').fill('2100'); await page.locator('#zoom_end').fill('3500');
        await page.evaluate(() => metricHeat.zoomFromInputs(1)); await frames(); m = await measure();
        assert.equal(m.first, 2100); assert.equal(m.last, 3500); assert.deepEqual(m.values[names[0]], [0, 128, 256]);
        checks.push('Start/End restrict sample cells while statistics retain all file samples');
        await cards(1).first().locator('[name="heatColor"]').selectOption('row'); await frames(); await measure();
        checks.push('per-metric normalization colors statistics with the same row scale and preserves raw values');
        await page.locator('#zoom_start').fill('100'); await page.locator('#zoom_end').fill('25700');
        await page.evaluate(() => metricHeat.zoomFromInputs(1)); await frames();
        await cards(1).first().locator('.heat-viewport').evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
        await frames(); m = await measure(); assert.equal(m.last, 25700); assert(m.names.includes(names.at(-1)));
        checks.push('last sample and last metric remain reachable with aligned full-file statistics after two-axis scrolling');
        await cards(1).first().locator('.heat-viewport').evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; }); await frames();
        await plot(1, [names[0]]); await measure(1, 1);
        assert.equal(await cards(1).nth(1).locator('[name="heatColor"]').inputValue(), 'raw');
        checks.push('each Plot creates its own statistics and keeps colors independent');
        await page.evaluate(() => setSplitMode('horizontal')); await page.evaluate(() => setActivePanel(2));
        await page.locator('#metricMode').selectOption('heat'); await load(2, 'reload'); await plot(2, names.slice(0, 6));
        const other = (await measure(2)).values; await measure(1);
        await page.setViewportSize({ width: 641, height: 481 }); await frames();
        await measure(1); await measure(2);
        assert(await cards(2).first().evaluate(card => {
            const vm = echarts.getInstanceByDom(card.querySelector('.heat-canvas')).getOption().visualMap[0];
            return vm.itemHeight < 130 || vm.textStyle.fontSize < 12;
        }));
        await page.screenshot({ path: path.join(output, 'narrow-colorbar.png') });
        checks.push('long endpoint labels fit a narrow split view while the complete color bar follows the sample-grid center');
        await page.setViewportSize({ width: 1500, height: 1050 }); await frames();
        await page.evaluate(() => setActivePanel(1)); await load(1, 'reload'); await ready(1); m = await measure(1);
        assert.deepEqual(m.values[names[0]], [500, 568, 636]); assert.deepEqual((await measure(2)).values, other);
        checks.push('H5 reload refreshes cached statistics and leaves the other split panel unchanged');
        await cards(1).first().locator('.heat-sidebar-resizer').press('Home'); await frames(); await measure(1);
        checks.push('hidden controls keep statistic columns visible and aligned');
        await page.locator('#metricMode').selectOption('line'); await page.locator('#metricMode').selectOption('heat'); await ready(1); await measure(1);
        checks.push('Line/Heat round trip retains full-file statistics');
        m = await measure(1); await page.mouse.click(m.point.x, m.point.y); await page.keyboard.press('Delete'); await frames();
        const selection = await page.evaluate(() => Object.values(metricHeat.selection(1)).map(group => group.Sig));
        assert(!selection[0].includes(names[0])); assert.deepEqual(selection[1], [names[0]]); await measure(1);
        checks.push('clicking a statistic selects the metric for Delete without changing the same metric in another map');
        await page.screenshot({ path: path.join(output, 'statistics-split.png') });
        await page.evaluate(() => setSplitMode('single')); await page.evaluate(() => setActivePanel(1));
        await load(1, 'longlabels'); await ready(1); await measure(1, 1);
        const longLayout = await cards(1).nth(1).evaluate(card => ({
            top: echarts.getInstanceByDom(card.querySelector('.heat-canvas')).getOption().grid[0].top,
            height: card.getBoundingClientRect().height
        }));
        assert(longLayout.top > 52); assert(longLayout.height >= 140 && longLayout.height < 241);
        await page.screenshot({ path: path.join(output, 'long-sample-labels.png') });
        checks.push('16-digit sample labels reserve stable extra top space while short maps remain compact');
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output, 'statistics-result.json'), JSON.stringify({ status: 'PASS', checks, errors }, null, 2));
        console.log(`PASS: ${checks.length} Heat statistics checks with independent reference values`);
    } catch (error) {
        fs.writeFileSync(path.join(output, 'statistics-result.json'), JSON.stringify({ status: 'FAIL', checks, errors, error: String(error) }, null, 2));
        await page.screenshot({ path: path.join(output, 'statistics-failure.png') }); throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
