/* Bitmap reuse must exactly match uncached device-aligned painting. ECharts
 * remains the independent value/color/statistic oracle; legacy pixel changes
 * are recorded separately because device alignment intentionally changes AA. */
'use strict';
const {chromium} = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {observeHeat} = require('./heat_test_support.cjs');
const MATRIX = [16,8].flatMap(size => [1,1.25,1.3,1.5,2].map(dpr => ({size,dpr})));
const SHARDS = {'pixel-a-v1':[0,1,2], 'pixel-b-v1':[3,4,5], 'pixel-c-v1':[6,7,8,9]};
assert([2,3].includes(process.argv.slice(2).length), 'Only BASE_URL OUTPUT and an exact fixed shard are accepted');
const [base, output, matrixShard] = process.argv.slice(2);
assert(matrixShard === undefined || Object.hasOwn(SHARDS,matrixShard), 'Unknown fixed matrix shard');
const caseIndices = matrixShard === undefined ? MATRIX.map((_,i)=>i) : SHARDS[matrixShard];
const diagnostic = ''; // Full default ten-configuration gate only.
assert(['', 'statistic-hover-baseline', 'statistic-hover-pointer'].includes(diagnostic), 'Unknown diagnostic mode');
assert(output, 'An explicit output directory is required'); fs.mkdirSync(output, {recursive: true});
const result = {checks: [], pixels: [], legacyPixels: [], errors: [], matrixShard:matrixShard || null, requestedCases:caseIndices.map(index=>({index,...MATRIX[index]})), completedCases:[]};
// The pointer candidate is opt-in. Keep the original highlight baseline and
// stop either diagnostic at the first avg hover, even if its pixels match.
if (diagnostic) {
    const sourcePaths = ['dataviewer/static/js/metric_heat.js', 'dataviewer/static/js/metric_heat_canvas.js',
        'dataviewer/static/js/echarts.min.js', 'dataviewer/templates/metricviewer.html',
        'scripts/test_heat_canvas_browser.cjs', 'scripts/heat_test_support.cjs'];
    result.diagnostic = {mode: diagnostic, sourceSha256: Object.fromEntries(sourcePaths.map(p =>
        [p, createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', p))).digest('hex')]))};
}

// Independent test preconditions, not the renderer's reuse decision.
function denseTranslation(a, b) {
    for (const key of ['dpr', 'columnWidth', 'left', 'top', 'gridWidth', 'gridHeight', 'xCount', 'yCount'])
        if (a[key] !== b[key]) return {compatible:false, reason:'geometry-' + key};
    let checkedEdges = 0, dx = 0, dy = 0;
    for (const [axis, first, count, start, extent] of [
        ['x','firstCol','xCount','left','gridWidth'], ['y','firstRow','yCount','top','gridHeight']]) {
        const begin = Math.max(a[first], b[first]), end = Math.min(a[first]+a[count], b[first]+b[count]);
        if (end <= begin) return {compatible:false, reason:axis+'-no-overlap'};
        const step = a[extent]/a[count], border = a.columnWidth >= 4 ? 1 : 0;
        const nominal = (f, i) => Math.round((f[start]+(i-f[first])*step)*f.dpr);
        const shift = nominal(b,begin)-nominal(a,begin);
        if (axis==='x') dx=shift; else dy=shift;
        for (let i=begin;i<end;i++) {
            for (const j of [i,i+1]) {
                ++checkedEdges;
                if (nominal(b,j)-nominal(a,j)!==shift)
                    return {compatible:false,reason:axis+'-nominal-edge-shift',firstMismatch:{index:j},checkedEdges};
            }
            // Fill +/- .25 CSS; normal/emphasis half-strokes: exact, no tolerance.
            for (const [endOffset, extra] of [[0,-.25],[1,.25],
                [0,-.25-border/2],[0,-.25+border/2],[1,.25-border/2],[1,.25+border/2],
                [0,-.25-border],[0,-.25+border],[1,.25-border],[1,.25+border]]) {
                const edge = f => Math.round((f[start]+(i-f[first]+endOffset)*step+extra)*f.dpr);
                ++checkedEdges;
                if (edge(b)-edge(a)!==shift)
                    return {compatible:false,reason:axis+'-fill-stroke-edge-shift',firstMismatch:{index:i},checkedEdges};
            }
        }
    }
    return {compatible:true,dx,dy,checkedEdges};
}
function denseNativePosition(frame, target) {
    assert(Number.isInteger(target) && target>=0 && frame.columnWidth===1);
    if (target===0) return {native:0,low:0,high:0,target};
    const logicalRange=frame.total*frame.columnWidth-frame.plotWidth;
    assert(logicalRange>0 && frame.nativeMax>0 && target+1<frame.total-frame.xCount);
    const low=target*frame.columnWidth/logicalRange*frame.nativeMax;
    const high=(target+1)*frame.columnWidth/logicalRange*frame.nativeMax;
    // CSS scroll coordinates are not device-pixel coordinates. Choose an exact
    // integral CSS input, then require the actual browser/frame to confirm it.
    const candidates=[];
    for (let native=Math.ceil(low);native<=Math.floor(high);native++) {
        if (native>=low && native<high && Math.floor(native/frame.nativeMax*logicalRange/frame.columnWidth)===target) candidates.push(native);
    }
    if (!candidates.length) return null;
    const native=candidates[Math.floor(candidates.length/2)];
    assert.equal(Math.floor(native/frame.nativeMax*logicalRange/frame.columnWidth),target);
    return {native,low,high,target};
}

function denseAlignedTarget(frame) {
    // Precompute only: no scrolling, no renderer verdict, no trial-and-error.
    const considered=[];
    for (let delta=20;delta<=200;delta+=20) {
        const target=frame.firstCol+delta;
        const geometry=denseTranslation(frame,{...frame,firstCol:target,lastCol:target+frame.xCount});
        const mapping=geometry.compatible ? denseNativePosition(frame,target) : null;
        considered.push({target,geometry,mapping});
        if (mapping && geometry.dx!==0) return {target,geometry,mapping,considered};
    }
    assert.fail('No independently proven aligned dense target in bounded 20-column periods');
}
const names = ['ramp', 'zero', 'constant', 'missing_metric', 'signed', 'mixed', 'fraction'];
const values = Object.fromEntries(names.map((n, r) => [n, Array.from({length: 10000}, (_, c) =>
    r === 0 ? c % 101 : r === 1 ? 0 : r === 2 ? 7 : r === 3 ? null : r === 4 ? c % 101 - 50 :
        r === 5 ? (c % 3 === 0 ? null : c % 100) : c % 5 / 4)]));
const csv = path.join(output, 'colors.csv'), h5 = path.join(output, 'colors.h5');
fs.writeFileSync(csv, 'sample,' + Array.from({length: 10000}, (_, i) => (i + 1) * 100).join(',') +
    '\nsamplePeriod,100\n' + names.map(n => n + ',' + values[n].map(v => v === null ? '' : v).join(',')).join('\n') + '\n');
execFileSync('python3', ['-B', path.join(__dirname, 'csv2hdf.py'), '-i', csv, '-o', h5], {stdio: 'pipe'});
if (diagnostic) result.diagnostic.inputSha256 = Object.fromEntries([csv, h5].map(p =>
    [path.basename(p), createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
(async () => {
    const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true,
        ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage']});
    process.once('SIGTERM', () => browser.close().finally(() => process.exit(143)));
    try {
        for (const caseIndex of caseIndices) {
            const {size,dpr}=MATRIX[caseIndex];
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
            await card.locator('[name="heatCellSize"]').selectOption(String(size)); await frames();
            async function reference(keepStatistics = false) {
                await page.evaluate(keepStatistics => {
                    if (window.pixelReference) {pixelReference.chart.dispose(); pixelReference.dom.remove();}
                    const host = document.querySelector('.heat-host[data-panel="1"] .heat-canvas');
                    const chart = heatTestChart(host), f = heatTestFrame(host), o = chart.getOption();
                    heatTestFullReference(host);
                    for (const row of f.rows) {
                        const valid = pixelExpected[row.name].filter(value => value !== null);
                        const stats = [valid.length ? Math.min(...valid) : null,
                            valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null,
                            valid.length ? Math.max(...valid) : null];
                        if (row.validCount !== valid.length) throw Error('Raw sample count changed');
                        const displayed = o.series[2].data.concat(o.series[3].data).filter(value => value[5] === f.rows.indexOf(row));
                        const rowIndex = f.rows.indexOf(row), visible = rowIndex >= f.firstRow && rowIndex < f.lastRow;
                        if (displayed.length !== (visible ? 3 : 0) || visible &&
                            displayed.map(v => v[0]).sort().join(',') !== '0,1,2')
                            throw Error('Each visible metric must have exactly one min, avg and max');
                        for (const point of displayed) if (point[3] !== stats[point[0]]) throw Error('Statistic does not match original samples');
                    }
                    if (keepStatistics && (o.series[0].data.length || o.series[1].data.length))
                        throw Error('The production statistics chart must have no sample series data');
                    // Statistics retain the actual ECharts scene. Only the
                    // sample oracle reconstructs samples and hides decorations.
                    if (!keepStatistics) {
                        o.series[0].data = []; o.series[1].data = [];
                        for (let y = f.firstRow; y < f.lastRow; ++y) for (let x = f.firstCol; x < f.lastCol; ++x) {
                            const row = f.rows[y], raw = pixelExpected[row.name][x];
                            if (raw !== row.values[x]) throw Error('Original raw sample changed');
                            const value = MetricHeat.colorValue(row, raw, f.normal);
                            o.series[value === null ? 1 : 0].data.push([x - f.firstCol, y - f.firstRow, value === null ? 0 : value, raw, x, y]);
                        }
                        o.series[2].data = []; o.series[3].data = [];
                        o.xAxis.forEach(a => {a.show = false;}); o.yAxis.forEach(a => {a.show = false;});
                        o.visualMap[0].show = false; o.tooltip[0].show = false; o.title[0].show = false;
                        // Hiding axes changes the reference's object count. Retain
                        // the hover-layer decision of the complete, visible chart.
                        o.hoverLayerThreshold = f.hoverLayer ? 0 : Infinity;
                    }
                    const dom = document.createElement('div');
                    Object.assign(dom.style, {position: 'fixed', left: '-10000px', top: '0', width: chart.getWidth() + 'px', height: chart.getHeight() + 'px'});
                    document.body.appendChild(dom);
                    const ref = echarts.init(dom, null, {renderer: 'canvas', devicePixelRatio}); ref.setOption(o); ref.getZr().flush();
                    if (keepStatistics) {
                        // getOption() omits the runtime emphasis-layer policy.
                        let displayCount = (f.lastCol - f.firstCol) * (f.lastRow - f.firstRow);
                        ref.getZr().storage.traverse(element => {if (!element.isGroup) ++displayCount;});
                        const hoverLayer = displayCount > ref.getModel().get('hoverLayerThreshold');
                        if (hoverLayer !== f.hoverLayer) throw Error('Statistic hover-layer decision differs from the independent count');
                        [2, 3].forEach(index => ref.getModel().getSeriesByIndex(index).getData().eachItemGraphicEl(element => {
                            if (element.states.emphasis) element.states.emphasis.hoverLayer = hoverLayer;
                        }));
                    }
                    const fill = MetricHeatCanvas.colorMap(echarts, o.visualMap[0].inRange.color);
                    for (let i = 0; i < o.series[0].data.length; ++i) {
                        const value = o.series[0].data[i][2];
                        if (ref.getVisual({seriesIndex: 0, dataIndex: i}, 'color') !== fill(value, f.scale))
                            throw Error('Sample color differs from independent ECharts visual mapping');
                    }
                    window.pixelReference = {dom, chart: ref};
                }, keepStatistics);
            }
            async function compare(label) {
                const m = await page.evaluate(() => {
                    const host = document.querySelector('.heat-host[data-panel="1"] .heat-canvas'), f = heatTestFrame(host);
                    const sample = host.querySelector('.heat-samples'), ref = pixelReference.chart;
                    const full = heatTestFullReference(host), fullSample = full.host.querySelector('.heat-samples');
                    if (!sample.width || !sample.height || sample.width !== fullSample.width || sample.height !== fullSample.height)
                        throw Error('Actual and full-reference bitmap dimensions must match and be nonempty');
                    const chart = heatTestChart(host), grid = chart.getOption().grid;
                    const axis = chart.getViewOfComponentModel(chart.getModel().getComponent('xAxis', 1));
                    const statisticHeaders = [];
                    axis.group.traverse(element => {
                        if (element.type !== 'text' || element.ignore || element.invisible ||
                            !['min','avg','max'].includes(element.style.text)) return;
                        const rect = element.getBoundingRect().clone(), transform = element.getComputedTransform();
                        const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
                            [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]].map(([x,y]) =>
                            transform ? [transform[0]*x + transform[2]*y + transform[4], transform[1]*x + transform[3]*y + transform[5]] : [x,y]);
                        if (transform) rect.applyTransform(transform);
                        statisticHeaders.push({text:element.style.text, x:rect.x, y:rect.y, width:rect.width, height:rect.height, corners});
                    });
                    statisticHeaders.sort((a, b) => a.x - b.x);
                    ref.getZr().flush();
                    const a = document.createElement('canvas'); a.width = Math.round(ref.getWidth() * devicePixelRatio); a.height = Math.round(ref.getHeight() * devicePixelRatio);
                    const ctx = a.getContext('2d', {willReadFrequently: true});
                    function composed(dom) {
                        ctx.clearRect(0, 0, a.width, a.height);
                        for (const canvas of [dom.querySelector('.heat-samples'), dom.querySelector('.heat-sample-highlight')])
                            if (canvas.width && canvas.height) ctx.drawImage(canvas,
                                Math.round(parseFloat(canvas.style.left) * f.dpr), Math.round(parseFloat(canvas.style.top) * f.dpr));
                        return ctx.getImageData(0, 0, a.width, a.height).data;
                    }
                    const aa = composed(host), bb = composed(full.host);
                    function difference(actual, expected) {
                        if (actual.length !== expected.length) throw Error('RGBA lengths must match');
                        let mismatchedChannels = 0, maxDifference = 0, first = null;
                        for (let i = 0; i < actual.length; ++i) if (actual[i] !== expected[i]) {
                            ++mismatchedChannels; maxDifference = Math.max(maxDifference, Math.abs(actual[i] - expected[i]));
                            if (!first) first = {x: Math.floor(i / 4) % a.width, y: Math.floor(i / 4 / a.width), channel: i % 4, actual: actual[i], expected: expected[i]};
                        }
                        return {mismatchedChannels, maxDifference, first, totalChannels: actual.length};
                    }
                    ctx.clearRect(0, 0, a.width, a.height);
                    for (const c of pixelReference.dom.querySelectorAll('canvas')) ctx.drawImage(c, 0, 0);
                    const legacy = difference(aa, ctx.getImageData(0, 0, a.width, a.height).data);
                    const referenceStats = full.renderer.bitmapStats(), stats = heatTestRecord(host).renderer.bitmapStats();
                    if (referenceStats.reuse !== 0 || referenceStats.cacheBytes !== 0) throw Error('Full reference must have no bitmap reuse or cache');
                    return {...difference(aa, bb), legacy, stats, referenceStats, columnWidth: f.columnWidth, rowHeight: f.bandHeight,
                        statisticsWidth: grid[1].width, statisticsRowHeight: grid[1].height / f.y.length,
                        statisticHeaders, statisticsLeft: grid[1].left, statisticsTop: grid[1].top, cells: f.x.length * f.y.length,
                        bitmapBytes: sample.width * sample.height * 4, totalChannels: aa.length};
                });
                assert.equal(m.rowHeight, size, 'Sample rows match the selected CSS pixel size');
                assert.equal(m.statisticsWidth, size * 3, 'Three statistic columns match the selected cell size');
                assert.equal(m.statisticsRowHeight, size, 'Statistic rows match the selected cell size');
                assert(m.columnWidth >= 1 && m.columnWidth <= size, 'Sample columns stay between 1px and the selected size');
                assert.deepEqual(m.statisticHeaders.map(h => h.text), ['min','avg','max'], 'All three statistic titles are visibly rendered');
                for (let i = 0; i < m.statisticHeaders.length; ++i) {
                    const h = m.statisticHeaders[i], center = m.statisticsLeft + i * size + size / 2;
                    if (size === 8) assert(Math.abs(h.x + h.width / 2 - center) < 1e-7, '8px statistic title is centered on its column');
                    else assert(h.x <= center + 1e-7 && h.x + h.width >= center - 1e-7, 'Slanted title covers its own column center');
                    assert(h.y + h.height <= m.statisticsTop + 1e-7, 'Statistic title stays above its grid');
                    if (i) {
                        const previous = m.statisticHeaders[i - 1];
                        if (size === 8) assert(previous.x + previous.width <= h.x + 1e-7, '8px statistic titles do not overlap horizontally');
                        // Slanted rectangles may overlap in their axis-aligned
                        // bounds. Test the actual transformed text rectangles.
                        const separated = [previous.corners, h.corners].some(poly => poly.some((p, j) => {
                            const q = poly[(j + 1) % poly.length], nx = p[1] - q[1], ny = q[0] - p[0];
                            const project = points => points.map(([x,y]) => x*nx + y*ny);
                            const a = project(previous.corners), b = project(h.corners);
                            return Math.max(...a) <= Math.min(...b) + 1e-7 || Math.max(...b) <= Math.min(...a) + 1e-7;
                        }));
                        assert(separated, 'Actual statistic title rectangles must not overlap');
                    }
                }
                result.pixels.push({size, dpr, label, ...m});
                result.legacyPixels.push({size, dpr, label, ...m.legacy});
                fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify(result, null, 2));
                assert.equal(m.mismatchedChannels, 0, `size${size} DPR${dpr} ${label}: reuse versus uncached full RGBA, including outer strokes`);
                return m;
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
                const capture = !!diagnostic && label === 'statistics-hover-0';
                const m = await page.evaluate(capture => {
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
                    const answer = {mismatchedChannels, maxDifference, totalChannels: a.length};
                    if (!capture) return answer;
                    const encode = bytes => {let s = ''; for (const n of bytes) s += String.fromCharCode(n); return btoa(s);};
                    // Freeze the original oracle BEFORE any source-layer read,
                    // private-field observation, or additional comparison.
                    answer.original = {time: performance.now(), crop: {x, y, width, height}, dpr: ratio,
                        actualRgbaBase64: encode(a), referenceRgbaBase64: encode(b), differences: []};
                    for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) answer.original.differences.push({
                        x: x + Math.floor(i / 4) % width, y: y + Math.floor(i / 4 / width), channel: i % 4,
                        actual: a[i], reference: b[i]});
                    try {
                        const plain = object => object == null ? null : Object.fromEntries(Object.entries(object)
                            .filter(([, v]) => v == null || ['string', 'number', 'boolean'].includes(typeof v) || Array.isArray(v)));
                        const style = s => s && ({...plain(s), opacity: s.opacity, fillOpacity: s.fillOpacity,
                            strokeOpacity: s.strokeOpacity, blend: s.blend});
                        const describe = el => el && ({id: el.id, type: el.type, shape: plain(el.shape),
                            transform: el.getComputedTransform(), z: el.z, z2: el.z2, zlevel: el.zlevel,
                            currentStates: el.currentStates, hoverState: el.hoverState, inHover: el.__inHover,
                            highByOuter: el.__highByOuter, invisible: el.invisible,
                            style: style(el.style), hoverStyle: style(el.__hoverStyle),
                            normalStyle: style(el._normalState && el._normalState.style),
                            emphasis: plain(el.states && el.states.emphasis),
                            emphasisStyle: style(el.states && el.states.emphasis && el.states.emphasis.style),
                            path: el.path && Array.from(el.path.data || []).slice(0, el.path.len()),
                            clips: (el.__clipPaths || []).map(p => ({shape: plain(p.shape), transform: p.getComputedTransform()}))});
                        const charts = [chart, pixelReference.chart], doms = [host.querySelector('.heat-axes'), pixelReference.dom];
                        const f = heatTestFrame(host);
                        answer.frame = {columnWidth: f.columnWidth, rowHeight: f.bandHeight, normal: f.normal,
                            firstCol: f.firstCol, firstRow: f.firstRow, rowName: f.rows[0].name};
                        answer.layers = {observedAfterOriginal: true, time: performance.now(), scenes: charts.map((c, side) => {
                            const zr = c.getZr(), data = c.getModel().getSeriesByIndex(2).getData();
                            const values = c.getOption().series[2].data;
                            const matches = values.map((v, i) => v[0] === 1 && v[1] === 0 ? i : -1).filter(i => i >= 0);
                            if (matches.length !== 1) throw Error('The ramp avg target must be unique');
                            const index = matches[0], el = data.getItemGraphicEl(index);
                            const vm = c.getModel().getComponent('visualMap'), shapes = c.getViewOfComponentModel(vm)._shapes;
                            const canvases = Array.from(doms[side].querySelectorAll('canvas'));
                            const rect = doms[side].getBoundingClientRect();
                            return {target: {seriesIndex: 2, dataIndex: index, value: values[index], element: describe(el)},
                                grid: plain(c.getOption().grid[1]), chartSize: [c.getWidth(), c.getHeight()],
                                clientRect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
                                indicator: describe(shapes.indicator), indicatorLabel: describe(shapes.indicatorLabel),
                                expectedIndicatorLabel: vm.formatValueText(values[index][2]),
                                animationFinished: zr.animation.isFinished(),
                                domOrder: canvases.map(layer => layer.getAttribute('data-zr-dom-id')),
                                displayOrder: zr.storage.getDisplayList().map(e => ({id: e.id, z: e.z, z2: e.z2,
                                    zlevel: e.zlevel, inHover: e.__inHover})),
                                layers: Object.entries(zr.painter._layers).map(([key, layer]) => {
                                    const first = layer.ctx.getImageData(x, y, width, height).data;
                                    const second = layer.ctx.getImageData(x, y, width, height).data;
                                    let changed = 0; for (let i = 0; i < first.length; ++i) if (first[i] !== second[i]) ++changed;
                                    const t = layer.ctx.getTransform();
                                    return {key, domIndex: canvases.indexOf(layer.dom), domId: layer.dom.getAttribute('data-zr-dom-id'),
                                        width: layer.dom.width, height: layer.dom.height, dpr: layer.dpr,
                                        start: layer.__startIndex, end: layer.__endIndex, draw: layer.__drawIndex,
                                        context: {transform: [t.a,t.b,t.c,t.d,t.e,t.f], alpha: layer.ctx.globalAlpha,
                                            composite: layer.ctx.globalCompositeOperation},
                                        rgbaBase64: encode(first), repeatedReadRgbaBase64: encode(second), repeatedReadDifferences: changed};
                                })};
                        })};
                        const afterA = pixels(doms[0]), afterB = pixels(doms[1]);
                        let actualChanged = 0, referenceChanged = 0, afterPair = 0;
                        for (let i = 0; i < a.length; ++i) {
                            if (a[i] !== afterA[i]) ++actualChanged;
                            if (b[i] !== afterB[i]) ++referenceChanged;
                            if (afterA[i] !== afterB[i]) ++afterPair;
                        }
                        answer.observerEffect = {actualChanged, referenceChanged, afterPair};
                    } catch (e) {answer.captureError = String(e.stack || e);}
                    return answer;
                }, capture);
                if (capture) {
                    // Evaluate and save identity/state checks even if the original
                    // pixel assertion will fail. The pixel failure keeps priority.
                    const scenes = m.layers && m.layers.scenes || [];
                    m.targetChecks = {twoScenes: scenes.length === 2,
                        frame: !!m.frame && m.frame.columnWidth === 1 && m.frame.rowHeight === 16 &&
                            m.frame.normal === true && m.frame.firstRow === 0 && m.frame.rowName === 'ramp',
                        scenes: scenes.map(scene => {
                            const target = scene.target, el = target.element;
                            return {target: target.seriesIndex === 2 && target.value[0] === 1 && target.value[1] === 0,
                                raw: target.value[3] === 49.995, normalized: target.value[2] === 49.995 / 100,
                                hoverLayer: !!el && el.inHover === true, hoverState: !!el && el.hoverState === 2,
                                emphasis: !!el && Array.isArray(el.currentStates) && el.currentStates.includes('emphasis'),
                                pointerEvents: diagnostic !== 'statistic-hover-pointer' ||
                                    (!!el && !!scene.indicator && !!scene.indicatorLabel && !!scene.indicatorLabel.style &&
                                        !el.highByOuter && scene.indicator.invisible === false &&
                                        scene.indicatorLabel.style.text === scene.expectedIndicatorLabel)};
                        })};
                    fs.writeFileSync(path.join(output, 'statistic-hover-original.json'), JSON.stringify({
                        ...result.diagnostic, size, dpr, label, mismatchedChannels: m.mismatchedChannels,
                        maxDifference: m.maxDifference, totalChannels: m.totalChannels, ...m.original}, null, 2));
                    fs.writeFileSync(path.join(output, 'statistic-hover-layers.json'), JSON.stringify({
                        ...result.diagnostic, layers: m.layers, captureError: m.captureError,
                        frame: m.frame, targetChecks: m.targetChecks, observerEffect: m.observerEffect}, null, 2));
                }
                result.pixels.push({size, dpr, label, ...m});
                assert.equal(m.mismatchedChannels, 0, `${dpr} ${label}: statistic highlight pixels must match`);
                if (capture) {
                    assert.equal(m.captureError, undefined, 'Layer capture must be complete');
                    assert(m.targetChecks.twoScenes && m.targetChecks.frame, 'The original dense ramp scene must be present');
                    for (const checks of m.targetChecks.scenes) for (const [name, ok] of Object.entries(checks))
                        assert(ok, 'Statistic target check failed: ' + name);
                }
            }
            const columnWidth = () => card.evaluate(card => heatTestFrame(card.querySelector('.heat-canvas')).columnWidth);
            assert.equal(await columnWidth(), size, 'Sample width matches the selected size');
            await wheel(-5000); assert.equal(await columnWidth(), size, 'Zoom-in is capped at the selected size');
            await snapshot('global-' + size);
            for (const [label, position] of [['pan-forward', 5.5 * size], ['pan-reverse', 0]]) {
                await card.locator('.heat-viewport').evaluate((viewport, x) => {viewport.scrollLeft = x;}, position); await frames();
                await page.mouse.move(10, 10); await frames(); await reference();
                const pan = await compare(label);
                assert.equal(pan.stats.last.kind, 'reuse', 'Regular integer-device pan must compare actual bitmap reuse');
            }
            for (const [x, y, text] of [[1, 0, 'Raw value: 1'], [0, 1, 'Raw value: 0'], [0, 2, 'Raw value: 7'],
                [0, 3, 'No valid data'], [0, 4, 'Raw value: -50'], [1, 5, 'Raw value: 1'], [1, 6, 'Raw value: 0.25']]) {
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
            // Both sides of the selected row must hit the same metric, while its
            // neighbor immediately below has a distinct value/name.
            const signedPoint = await point(0, 4);
            for (const offset of [1 - size / 2, size / 2 - 1]) {
                await page.mouse.move(signedPoint.x, signedPoint.y + offset); await frames();
                const text = await card.locator('.heat-sample-tooltip').innerText();
                assert(text.includes('signed') && text.includes('Raw value: -50'));
            }
            await page.mouse.move(10, 10); await frames();
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
            await snapshot('manual-' + size);
            await card.locator('[name="heatColor"]').selectOption('row'); await frames(); await snapshot('row-' + size);
            const normalizedPoint = await point(1, 0); await page.mouse.move(normalizedPoint.x, normalizedPoint.y); await frames();
            assert((await card.locator('.heat-sample-tooltip').innerText()).includes('Normalized: 0.0100000'));
            assert.equal(await card.evaluate(card => {
                const chart = heatTestChart(card.querySelector('.heat-canvas')), model = chart.getModel().getComponent('visualMap');
                return chart.getViewOfComponentModel(model)._shapes.indicatorLabel.style.text === model.formatValueText(.01);
            }), true, 'normalized sample drives the exact normalized legend value');
            await wheel(120); assert((await columnWidth()) < size && (await columnWidth()) % 1 !== 0); await snapshot('row-fractional');
            await hoverPixels('fractional-valid', 1, 0); await hoverPixels('fractional-missing', 0, 3);
            await wheel(5000); assert.equal(await columnWidth(), 1); await snapshot('row-1');
            async function denseFrame() {
                return card.evaluate(card => {
                    const host=card.querySelector('.heat-canvas'), f=heatTestFrame(host);
                    const viewport=card.querySelector('.heat-viewport'), saved=viewport.scrollLeft;
                    const observation=heatTestRecord(host), beforeRenders=observation.renders;
                    // Same bounded, synchronous native range measurement as the application.
                    viewport.scrollLeft=viewport.scrollWidth; const nativeMax=viewport.scrollLeft; viewport.scrollLeft=saved;
                    const previous=window.denseObservedFrame;
                    const sameDataset=!previous || previous.rows===f.rows && previous.times===f.times;
                    window.denseObservedFrame=f;
                    const width=Math.floor(parseFloat(getComputedStyle(viewport).width));
                    const plotWidth=width-f.left-20-8-3*f.bandHeight;
                    if (Math.floor(plotWidth/f.columnWidth)!==f.x.length) throw Error('Dense layout derivation must match actual frame capacity');
                    const rangeProbe={beforeScroll:saved,afterScroll:viewport.scrollLeft,beforeFirstCol:f.firstCol,afterFirstCol:heatTestFrame(host).firstCol,beforeRenders,afterRenders:observation.renders};
                    if (rangeProbe.beforeScroll!==rangeProbe.afterScroll || rangeProbe.beforeFirstCol!==rangeProbe.afterFirstCol || rangeProbe.beforeRenders!==rangeProbe.afterRenders) throw Error('Native range probe changed the measured renderer baseline');
                    return {dpr:f.dpr,columnWidth:f.columnWidth,left:f.left,top:f.top,
                        gridWidth:f.gridWidth,gridHeight:f.gridHeight,xCount:f.x.length,yCount:f.y.length,
                        firstCol:f.firstCol,lastCol:f.lastCol,firstRow:f.firstRow,total:f.times.length,
                        nativeScroll:viewport.scrollLeft,nativeMax,plotWidth,sameDataset,rangeProbe};
                });
            }
            async function densePan(label, position, expectedCol) {
                const before=await denseFrame();
                let target=position, planned=null;
                if (expectedCol!==undefined) {
                    planned=denseTranslation(before,{...before,firstCol:expectedCol,lastCol:expectedCol+before.xCount});
                    assert(planned.compatible && planned.dx!==0, 'Aligned dense input must prove exact nonzero edge translation before scrolling');
                    const mapping=denseNativePosition(before,expectedCol);
                    assert(mapping,'Planned aligned sample column must have an exact native preimage');
                    target=mapping.native;
                }
                await card.locator('.heat-viewport').evaluate((viewport,x)=>{viewport.scrollLeft=x;},target); await frames();
                await page.mouse.move(10,10); await frames(); await reference();
                const after=await denseFrame(), eligibility=denseTranslation(before,after);
                (result.denseInputs ||= []).push({size,dpr,label,requestedNative:target,before,after,planned,eligibility});
                assert(after.sameDataset, 'Dense pan must preserve original data identities');
                if (expectedCol!==undefined) assert.equal(after.firstCol,expectedCol,'Actual native scroll must land on the planned sample column');
                const pan=await compare(label);
                if (eligibility.compatible) {
                    assert.equal(pan.stats.last.kind,'reuse','Dense pan must verify a copied bitmap, not only full fallback');
                    assert.equal(pan.stats.last.dx,eligibility.dx,'Actual copy must match independently derived device shift');
                    assert.equal(pan.stats.last.dy,eligibility.dy);
                } else {
                    assert.equal(expectedCol,undefined,'Explicit aligned dense input cannot fall back');
                    assert.equal(pan.stats.last.kind,'full','Incompatible edge phase requires a full repaint');
                    assert.equal(pan.stats.last.reason,eligibility.reason,'Fallback must match the independent exact edge failure');
                }
            }
            const denseInitial=await denseFrame();
            assert.equal(denseInitial.firstCol,0,'Original dense fixture starts at sample zero');
            assert.equal(denseInitial.nativeScroll,0,'Original dense fixture starts at native origin');
            // Preserve original native scroll inputs and strict pixel/fallback coverage.
            await densePan('dense-pan-forward',20.5);
            await densePan('dense-pan-reverse',0);
            // Independent positive control chosen before any scroll from exact edge/mapping math.
            const aligned=denseAlignedTarget(await denseFrame());
            (result.densePlans ||= []).push({size,dpr,...aligned});
            await densePan('dense-aligned-forward',null,aligned.target);
            await densePan('dense-aligned-reverse',null,0);
            await hoverPixels('1px-valid', 1, 0); await hoverPixels('1px-missing', 0, 3);
            // Native compatibility mouse events can round .5 CSS coordinates.
            // The first dense cell must remain reachable after device alignment.
            await page.evaluate(() => {
                const r = heatTestRecord(document.querySelector('.heat-host[data-panel="1"] .heat-canvas'));
                const select = r.options.select;
                r.options.select = value => {window.pixelSelection = value; select(value);};
            });
            const denseFirst = await point(0, 3); await page.mouse.click(denseFirst.x, denseFirst.y); await frames();
            assert.deepEqual(await page.evaluate(() => pixelSelection.slice(3)), [null, 0, 3], 'Native click must select the first dense sample and its original missing value');
            await legendPixels('1px-legend');
            await reference(true); await statisticPixels('statistics-normal');
            async function recordStatisticInput(stage, input) {
                const state = await page.evaluate(() => {
                    const host = document.querySelector('.heat-host[data-panel="1"] .heat-canvas');
                    return [heatTestChart(host), pixelReference.chart].map(c => {
                        const zr = c.getZr(), el = zr.handler._hovered && zr.handler._hovered.target;
                        const vm = c.getModel().getComponent('visualMap'), shapes = c.getViewOfComponentModel(vm)._shapes;
                        return {hoveredTarget: el ? {id: el.id, type: el.type, currentStates: (el.currentStates || []).slice(),
                            hoverState: el.hoverState, highByOuter: el.__highByOuter || 0} : null,
                            indicatorVisible: !shapes.indicator.invisible, indicatorLabel: shapes.indicatorLabel.style.text};
                    });
                });
                (result.statisticInputs ||= []).push({size, dpr, stage, input, actual: state[0], reference: state[1],
                    scope: 'Observed state only; reference input is normalized ZRender motion, not a trusted OS event'});
            }
            for (const [seriesIndex, row] of [[2, 0], [3, 3]]) {
                const p = await card.evaluate((card, {seriesIndex, row}) => {
                    const h = card.querySelector('.heat-canvas'), chart = heatTestChart(h), r = h.getBoundingClientRect();
                    const p = chart.convertToPixel({seriesIndex}, [1, row]); return {x: r.x + p[0], y: r.y + p[1]};
                }, {seriesIndex, row});
                if (diagnostic) result.diagnostic.actualInput = {clientX: p.x, clientY: p.y, commandUtc: new Date().toISOString()};
                await page.mouse.move(p.x, p.y); await frames();
                const referenceInput = await page.evaluate(({seriesIndex, row, pointer}) => {
                    const ref = pixelReference.chart, data = ref.getOption().series[seriesIndex].data;
                    const matches = data.map((v, i) => v[0] === 1 && v[1] === row ? i : -1).filter(i => i >= 0);
                    if (matches.length !== 1) throw Error('Statistic hover target must be unique');
                    const dataIndex = matches[0];
                    const eventTime = performance.now();
                    if (pointer) {
                        const zr = ref.getZr(), point = ref.convertToPixel({seriesIndex}, [1, row]);
                        const el = ref.getModel().getSeriesByIndex(seriesIndex).getData().getItemGraphicEl(dataIndex);
                        if (!el || el.__highByOuter || zr.handler.findHover(point[0], point[1]).target !== el)
                            throw Error('Reference mouse path must hit its own statistic without an external highlight');
                        // Normalized ZRender input, not a trusted OS mouse event.
                        // Coordinates are reference-local CSS px, independent of DPR/DOM offset.
                        zr.handler.dispatch('mousemove', {type: 'mousemove', zrX: point[0], zrY: point[1],
                            zrByTouch: false, button: 0, buttons: 0, which: 0,
                            preventDefault() {}, stopPropagation() {}});
                        return {kind: 'zrender-mousemove', seriesIndex, dataIndex, localCssX: point[0], localCssY: point[1], eventTime};
                    } else ref.dispatchAction({type: 'highlight', seriesIndex, dataIndex});
                    return {kind: 'dispatchAction-highlight', seriesIndex, dataIndex, eventTime};
                }, {seriesIndex, row, pointer: true});
                if (diagnostic) result.diagnostic.referenceInput = referenceInput;
                await frames(); await recordStatisticInput('enter-' + row, {actualClient: p, referenceInput}); await statisticPixels('statistics-hover-' + row);
                if (diagnostic) {
                    assert.deepEqual(result.errors, []);
                    result.status = diagnostic === 'statistic-hover-baseline' ? 'BASELINE_ZERO_DIFFERENCE' : 'CANDIDATE_ZERO_DIFFERENCE';
                    result.scope = 'First DPR1/16px avg hover only; not a complete browser gate or historical failure resolution';
                    await page.close(); return;
                }
                await page.mouse.move(10, 10); await frames();
                await page.evaluate(() => {
                    const zr = pixelReference.chart.getZr();
                    zr.handler.dispatch('mousemove', {type: 'mousemove', zrX: -1, zrY: -1,
                        zrByTouch: false, button: 0, buttons: 0, which: 0,
                        preventDefault() {}, stopPropagation() {}});
                }); await frames(); await recordStatisticInput('leave-' + row, {actualClient: {x: 10, y: 10}, referenceLocal: {x: -1, y: -1}}); await statisticPixels('statistics-cleared-' + row);
            }
            await card.locator('.heat-viewport').evaluate(v => {v.scrollLeft = v.scrollWidth;}); await frames();
            await snapshot('row-end-1');
            assert.equal(await page.evaluate(() => heatTestFrame(document.querySelector('.heat-host[data-panel="1"] .heat-canvas')).lastCol), 10000);
            result.checks.push(`size${size} DPR${dpr}: exact reuse/full RGBA, independent ECharts colors/raw values/statistics, legacy AA differences recorded, ${size}px rows/statistic cells and 1–${size}px columns, hit/hover/legend/manual/row/end`);
            await page.screenshot({path: path.join(output, `size${size}-dpr${dpr}.png`)}); await page.close();
            result.completedCases.push({index:caseIndex,size,dpr});
        }
        assert.deepEqual(result.completedCases,result.requestedCases,'Every declared case must complete exactly once');
        assert.deepEqual(result.errors, []); result.status = 'PASS';
    } catch (e) {result.status = 'FAIL'; result.failure = e.stack; throw e;}
    finally {fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
