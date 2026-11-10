/* Direct sample Canvas versus an independent ECharts heatmap reference, including edges. */
'use strict';
const {chromium} = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {observeHeat} = require('./heat_test_support.cjs');
const [base = 'http://127.0.0.1:18167', output] = process.argv.slice(2);
assert(output, 'An explicit output directory is required'); fs.mkdirSync(output, {recursive: true});
const result = {checks: [], pixels: [], errors: []};
const names = ['ramp', 'zero', 'constant', 'missing_metric', 'signed', 'mixed', 'fraction'];
const values = Object.fromEntries(names.map((n, r) => [n, Array.from({length: 10000}, (_, c) =>
    r === 0 ? c % 101 : r === 1 ? 0 : r === 2 ? 7 : r === 3 ? null : r === 4 ? c % 101 - 50 :
        r === 5 ? (c % 3 === 0 ? null : c % 100) : c % 5 / 4)]));
const csv = path.join(output, 'colors.csv'), h5 = path.join(output, 'colors.h5');
fs.writeFileSync(csv, 'sample,' + Array.from({length: 10000}, (_, i) => (i + 1) * 100).join(',') +
    '\nsamplePeriod,100\n' + names.map(n => n + ',' + values[n].map(v => v === null ? '' : v).join(',')).join('\n') + '\n');
execFileSync('python3', ['-B', path.join(__dirname, 'csv2hdf.py'), '-i', csv, '-o', h5], {stdio: 'pipe'});
(async () => {
    const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true,
        ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage']});
    process.once('SIGTERM', () => browser.close().finally(() => process.exit(143)));
    try {
        for (const dpr of [1, 1.25, 1.5, 2]) {
            const page = await browser.newPage({viewport: {width: 1500, height: 900}, deviceScaleFactor: dpr});
            await observeHeat(page); page.on('pageerror', e => result.errors.push(String(e)));
            const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            await page.goto(base + '/metricviewer'); await page.waitForFunction(() => window.metricHeat);
            await page.evaluate(h5 => requestServerFile(h5, 1, false), h5);
            await page.waitForFunction(() => !fileLoadBusy && $.active === 0);
            await page.locator('#metricMode').selectOption('heat');
            assert(await page.evaluate(names => metricHeat.plot(names, 1), names)); await frames();
            await page.evaluate(values => {window.pixelExpected = values;}, values);
            const card = page.locator('.heat-host[data-panel="1"] .heat-map').first();
            async function reference(keepStatistics = false) {
                await page.evaluate(keepStatistics => {
                    if (window.pixelReference) {pixelReference.chart.dispose(); pixelReference.dom.remove();}
                    const host = document.querySelector('.heat-host[data-panel="1"] .heat-canvas');
                    const chart = heatTestChart(host), f = heatTestFrame(host), o = chart.getOption();
                    o.series[0].data = []; o.series[1].data = [];
                    for (let y = f.firstRow; y < f.lastRow; ++y) for (let x = f.firstCol; x < f.lastCol; ++x) {
                        const row = f.rows[y], raw = pixelExpected[row.name][x];
                        if (raw !== row.values[x]) throw Error('Original raw sample changed');
                        const value = MetricHeat.colorValue(row, raw, f.normal);
                        o.series[value === null ? 1 : 0].data.push([x - f.firstCol, y - f.firstRow, value === null ? 0 : value, raw, x, y]);
                    }
                    if (!keepStatistics) {o.series[2].data = []; o.series[3].data = [];}
                    o.xAxis.forEach(a => {a.show = false;}); o.yAxis.forEach(a => {a.show = false;});
                    o.visualMap[0].show = false; o.tooltip[0].show = false; o.title[0].show = false;
                    // Hiding axes changes the reference's object count. Retain
                    // the hover-layer decision of the complete, visible chart.
                    o.hoverLayerThreshold = f.hoverLayer ? 0 : Infinity;
                    const dom = document.createElement('div');
                    Object.assign(dom.style, {position: 'fixed', left: '-10000px', top: '0', width: chart.getWidth() + 'px', height: chart.getHeight() + 'px'});
                    document.body.appendChild(dom);
                    const ref = echarts.init(dom, null, {renderer: 'canvas', devicePixelRatio}); ref.setOption(o); ref.getZr().flush();
                    window.pixelReference = {dom, chart: ref};
                }, keepStatistics);
            }
            async function compare(label) {
                const m = await page.evaluate(() => {
                    const host = document.querySelector('.heat-host[data-panel="1"] .heat-canvas'), f = heatTestFrame(host);
                    const sample = host.querySelector('.heat-samples'), ref = pixelReference.chart;
                    ref.getZr().flush();
                    const a = document.createElement('canvas'); a.width = Math.round(ref.getWidth() * devicePixelRatio); a.height = Math.round(ref.getHeight() * devicePixelRatio);
                    const ctx = a.getContext('2d', {willReadFrequently: true});
                    ctx.drawImage(sample, Math.round(parseFloat(sample.style.left) * devicePixelRatio), Math.round(parseFloat(sample.style.top) * devicePixelRatio));
                    const highlight = host.querySelector('.heat-sample-highlight');
                    if (highlight.width && highlight.height) ctx.drawImage(highlight,
                        Math.round(parseFloat(highlight.style.left) * devicePixelRatio), Math.round(parseFloat(highlight.style.top) * devicePixelRatio));
                    const aa = ctx.getImageData(0, 0, a.width, a.height).data;
                    ctx.clearRect(0, 0, a.width, a.height);
                    for (const c of pixelReference.dom.querySelectorAll('canvas')) ctx.drawImage(c, 0, 0);
                    const bb = ctx.getImageData(0, 0, a.width, a.height).data;
                    let mismatchedChannels = 0, maxDifference = 0, first = null;
                    for (let i = 0; i < aa.length; ++i) if (aa[i] !== bb[i]) {
                        ++mismatchedChannels; maxDifference = Math.max(maxDifference, Math.abs(aa[i] - bb[i]));
                        if (!first) first = {x: Math.floor(i / 4) % a.width, y: Math.floor(i / 4 / a.width), channel: i % 4, actual: aa[i], expected: bb[i]};
                    }
                    return {mismatchedChannels, maxDifference, first, columnWidth: f.columnWidth, cells: f.x.length * f.y.length,
                        bitmapBytes: sample.width * sample.height * 4, totalChannels: aa.length};
                });
                result.pixels.push({dpr, label, ...m});
                fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify(result, null, 2));
                assert.equal(m.mismatchedChannels, 0, `DPR${dpr} ${label}: full sample pixels, including outer strokes`);
            }
            async function snapshot(label) {await page.mouse.move(10, 10); await frames(); await reference(); await compare(label);}
            async function point(x, y) {
                return card.evaluate((card, {x, y}) => {
                    const host = card.querySelector('.heat-canvas'), f = heatTestFrame(host), r = host.getBoundingClientRect();
                    return {x: r.x + f.x[x], y: r.y + f.y[y]};
                }, {x, y});
            }
            async function wheel(delta) {
                const p = await point(1, 0); await page.mouse.move(p.x, p.y);
                await page.keyboard.down('Control'); await page.mouse.wheel(0, delta); await page.keyboard.up('Control'); await frames();
            }
            async function hoverPixels(label, x, y) {
                const p = await point(x, y); await page.mouse.move(p.x, p.y); await frames();
                const text = await page.evaluate(({x, y}) => {
                    const ref = pixelReference.chart, o = ref.getOption();
                    const seriesIndex = o.series[1].data.some(v => v[0] === x && v[1] === y) ? 1 : 0;
                    const dataIndex = o.series[seriesIndex].data.findIndex(v => v[0] === x && v[1] === y);
                    ref.dispatchAction({type: 'highlight', seriesIndex, dataIndex});
                    const raw = o.series[seriesIndex].data[dataIndex][3]; return raw === null ? 'No valid data' : 'Raw value: ' + raw;
                }, {x, y}); await frames();
                assert((await card.locator('.heat-sample-tooltip').innerText()).includes(text));
                await compare(label + '-hover');
                await page.mouse.move(10, 10); await frames();
                await page.evaluate(() => pixelReference.chart.dispatchAction({type: 'downplay'})); await frames();
                await compare(label + '-cleared');
            }
            async function legendPixels(label) {
                const legendPoint = await card.evaluate(card => {
                    const host = card.querySelector('.heat-canvas'), chart = heatTestChart(host), r = host.getBoundingClientRect();
                    const model = chart.getModel().getComponent('visualMap'), view = chart.getViewOfComponentModel(model);
                    const find = model.findTargetDataIndices;
                    window.restoreLegendProbe = () => {model.findTargetDataIndices = find;};
                    model.findTargetDataIndices = function(range) {window.pixelLegendRange = range.slice(); return find.apply(this, arguments);};
                    const p = view._shapes.mainGroup.transformCoordToGlobal(6, 65);
                    return {x: r.x + p[0], y: r.y + p[1]};
                });
                await page.mouse.move(legendPoint.x, legendPoint.y); await frames();
                assert(await page.evaluate(() => Array.isArray(window.pixelLegendRange)));
                await page.evaluate(() => {
                    const ref = pixelReference.chart, model = ref.getModel().getComponent('visualMap');
                    const batch = model.findTargetDataIndices(pixelLegendRange).map(item =>
                        ({seriesIndex: item.seriesId === model.ecModel.getSeriesByIndex(0).id ? 0 : 2, dataIndex: item.dataIndex}));
                    if (!batch.some(item => item.seriesIndex === 0 && item.dataIndex.length > 0)) throw Error('Legend test must emphasize real samples');
                    ref.dispatchAction({type: 'highlight', batch});
                }); await frames(); await compare(label + '-to-samples');
                await page.mouse.move(10, 10); await frames();
                await page.evaluate(() => pixelReference.chart.dispatchAction({type: 'downplay'})); await frames(); await compare(label + '-cleared');
                await page.evaluate(() => {restoreLegendProbe(); delete window.restoreLegendProbe;});
            }
            async function statisticPixels(label) {
                const m = await page.evaluate(() => {
                    const host = document.querySelector('.heat-host[data-panel="1"] .heat-canvas'), chart = heatTestChart(host);
                    const g = chart.getOption().grid[1], ratio = devicePixelRatio;
                    const x = Math.floor((g.left - 2) * ratio), y = Math.floor((g.top - 2) * ratio);
                    const width = Math.ceil((g.left + g.width + 2) * ratio) - x, height = Math.ceil((g.top + g.height + 2) * ratio) - y;
                    const c = document.createElement('canvas'); c.width = width; c.height = height;
                    const ctx = c.getContext('2d', {willReadFrequently: true});
                    function pixels(dom) {
                        ctx.clearRect(0, 0, width, height);
                        for (const layer of dom.querySelectorAll('canvas')) if (layer.width && layer.height) ctx.drawImage(layer, -x, -y);
                        return ctx.getImageData(0, 0, width, height).data;
                    }
                    chart.getZr().flush(); pixelReference.chart.getZr().flush();
                    const a = pixels(host.querySelector('.heat-axes')), b = pixels(pixelReference.dom);
                    let mismatchedChannels = 0, maxDifference = 0;
                    for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) {++mismatchedChannels; maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i]));}
                    return {mismatchedChannels, maxDifference, totalChannels: a.length};
                });
                result.pixels.push({dpr, label, ...m});
                assert.equal(m.mismatchedChannels, 0, `${dpr} ${label}: statistic highlight pixels must match`);
            }
            await snapshot('global-16');
            for (const [x, y, text] of [[1, 0, 'Raw value: 1'], [0, 1, 'Raw value: 0'], [0, 3, 'No valid data']]) {
                const p = await point(x, y); await page.mouse.move(p.x, p.y); await frames();
                assert((await card.locator('.heat-sample-tooltip').innerText()).includes(text));
                assert.equal(await card.evaluate(card => {
                    const chart = heatTestChart(card.querySelector('.heat-canvas'));
                    return chart.getViewOfComponentModel(chart.getModel().getComponent('visualMap'))._shapes.indicator.invisible;
                }), y === 3, 'valid samples show the legend indicator; missing values hide it');
                await page.evaluate(({x, y}) => {
                    const chart = pixelReference.chart;
                    chart.dispatchAction({type: 'downplay'});
                    const o = chart.getOption();
                    const seriesIndex = o.series[1].data.some(v => v[0] === x && v[1] === y) ? 1 : 0;
                    const dataIndex = o.series[seriesIndex].data.findIndex(v => v[0] === x && v[1] === y);
                    chart.dispatchAction({type: 'highlight', seriesIndex, dataIndex});
                }, {x, y}); await frames(); await compare('hover-' + x + '-' + y);
                await page.mouse.move(10, 10); await frames();
                await page.evaluate(() => pixelReference.chart.dispatchAction({type: 'downplay'})); await frames(); await compare('hover-cleared-' + y);
            }
            const samplePoint = await point(1, 0);
            for (const offset of [0, .1]) {
                await page.mouse.move(samplePoint.x + offset, samplePoint.y); await frames();
                assert.equal(await page.evaluate(p => getComputedStyle(document.elementFromPoint(p.x, p.y)).cursor, samplePoint), 'pointer');
            }
            const statisticPoint = await card.evaluate(card => {
                const h = card.querySelector('.heat-canvas'), chart = heatTestChart(h), r = h.getBoundingClientRect();
                const p = chart.convertToPixel({seriesIndex: 2}, [1, 0]); return {x: r.x + p[0], y: r.y + p[1]};
            });
            await page.mouse.move(statisticPoint.x, statisticPoint.y); await frames();
            assert(await card.evaluate(card => {
                const chart = heatTestChart(card.querySelector('.heat-canvas')), model = chart.getModel().getComponent('visualMap');
                const shapes = chart.getViewOfComponentModel(model)._shapes;
                return !shapes.indicator.invisible && shapes.indicatorLabel.style.text === model.formatValueText(49.995);
            }), 'sample mouseout must preserve the newly shown statistic indicator');
            await page.mouse.move(10, 10); await frames();
            await legendPixels('legend');
            for (const [n, v] of [['heatMin', '0'], ['heatMax', '50']]) {
                const el = card.locator(`[name="${n}"]`); await el.fill(v); await el.press('Tab'); await frames();
            }
            await snapshot('manual-16');
            await card.locator('[name="heatColor"]').selectOption('row'); await frames(); await snapshot('row-16');
            const normalizedPoint = await point(1, 0); await page.mouse.move(normalizedPoint.x, normalizedPoint.y); await frames();
            assert((await card.locator('.heat-sample-tooltip').innerText()).includes('Normalized: 0.0100000'));
            assert.equal(await card.evaluate(card => {
                const chart = heatTestChart(card.querySelector('.heat-canvas')), model = chart.getModel().getComponent('visualMap');
                return chart.getViewOfComponentModel(model)._shapes.indicatorLabel.style.text === model.formatValueText(.01);
            }), true, 'normalized sample drives the exact normalized legend value');
            await wheel(120); await snapshot('row-fractional');
            await hoverPixels('fractional-valid', 1, 0); await hoverPixels('fractional-missing', 0, 3);
            await wheel(5000); await snapshot('row-1');
            await hoverPixels('1px-valid', 1, 0); await hoverPixels('1px-missing', 0, 3);
            await legendPixels('1px-legend');
            await reference(true); await statisticPixels('statistics-normal');
            for (const [seriesIndex, row] of [[2, 0], [3, 3]]) {
                const p = await card.evaluate((card, {seriesIndex, row}) => {
                    const h = card.querySelector('.heat-canvas'), chart = heatTestChart(h), r = h.getBoundingClientRect();
                    const p = chart.convertToPixel({seriesIndex}, [1, row]); return {x: r.x + p[0], y: r.y + p[1]};
                }, {seriesIndex, row});
                await page.mouse.move(p.x, p.y); await frames();
                await page.evaluate(({seriesIndex, row}) => {
                    const ref = pixelReference.chart, data = ref.getOption().series[seriesIndex].data;
                    ref.dispatchAction({type: 'highlight', seriesIndex, dataIndex: data.findIndex(v => v[0] === 1 && v[1] === row)});
                }, {seriesIndex, row}); await frames(); await statisticPixels('statistics-hover-' + row);
                await page.mouse.move(10, 10); await frames();
                await page.evaluate(() => pixelReference.chart.dispatchAction({type: 'downplay'})); await frames(); await statisticPixels('statistics-cleared-' + row);
            }
            await card.locator('.heat-viewport').evaluate(v => {v.scrollLeft = v.scrollWidth;}); await frames();
            await snapshot('row-end-1');
            assert.equal(await page.evaluate(() => heatTestFrame(document.querySelector('.heat-host[data-panel="1"] .heat-canvas')).lastCol), 10000);
            result.checks.push(`DPR${dpr}: exact full sample pixels, original values, hover/clear, manual/row colors and last sample`);
            await page.screenshot({path: path.join(output, `dpr${dpr}.png`)}); await page.close();
        }
        assert.deepEqual(result.errors, []); result.status = 'PASS';
    } catch (e) {result.status = 'FAIL'; result.failure = e.stack; throw e;}
    finally {fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
