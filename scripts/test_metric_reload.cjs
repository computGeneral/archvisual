/* Real CSV/H5 and Chrome checks for Load > reload. Run against a dedicated server.
 * METRIC_RELOAD_TEST_OUTPUT selects fixtures, screenshots and result.json.
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const base = process.argv[2] || 'http://127.0.0.1:18139';
const output = path.resolve(process.env.METRIC_RELOAD_TEST_OUTPUT || path.join(__dirname, '../__output__/metric_reload'));
const checks = [], errors = [], dialogs = [];
fs.mkdirSync(output, { recursive:true });
function csv(name, offset = 0, count = 400, missing = [], period = 100) {
    const file = path.join(output, name + '.csv');
    fs.writeFileSync(file, 'sample,' + Array.from({length:count}, (_, i) => i).join(',') + '\n' +
        (period === null ? '' : 'samplePeriod,' + period + '\n') +
        Array.from({length:30}, (_, row) => row).filter(row => !missing.includes(row)).map(row =>
            'port' + row + ',' + Array.from({length:count}, (_, i) => offset + row * 1000 + i).join(',')).join('\n') + '\n');
    return file;
}
function h5(name, offset = 0, count = 400, missing = [], period = 100) {
    const source = csv(name, offset, count, missing, period), file = path.join(output, name + '.h5');
    execFileSync('python3', ['-B', path.join(__dirname, 'csv2hdf.py'), '-i', source, '-o', file], {stdio:'pipe'});
    return file;
}
(async () => {
    const browser = await chromium.launch({executablePath:process.env.METRIC_RELOAD_CHROME || '/usr/bin/google-chrome',
        headless:true, ignoreDefaultArgs:['--hide-scrollbars'], args:['--no-sandbox', '--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:1500, height:850}});
    page.on('pageerror', error => errors.push(String(error)));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const idle = async () => { await page.waitForFunction(() => !fileLoadBusy); await frames(); };
    const cards = panel => page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    async function server(file, panel = 1) {
        await page.evaluate(({file, panel}) => {
            setActivePanel(panel); document.getElementById('serverBrowserSelectedPath').value = file; loadServerFile();
        }, {file, panel});
        await idle();
        assert.equal(await page.evaluate(panel => loadedSources[panel].path, panel), file);
    }
    async function reload(panel = 1) {
        await page.evaluate(panel => setActivePanel(panel), panel);
        await page.locator('#initBtn').click(); await page.locator('#reloadLoadItem').click(); await idle();
    }
    async function plot(group, names, panel = 1) {
        await page.evaluate(({group, names, panel}) => {
            setActivePanel(panel);
            const selected = panel === 2 ? CurMetricSelectList2 : CurMetricSelectList;
            selected.splice(0, selected.length, ...names);
            document.getElementById('filterMetricGroup').value = group; MetricSelectSubmit();
        }, {group, names, panel});
        await page.waitForFunction(({group, panel}) => (panel === 2 ? MetricSelectList2 : MetricSelectList)[group], {group, panel});
        await frames();
    }
    async function line(panel = 1) {
        return page.evaluate(panel => {
            const chart = getPanelChart(panel), o = chart.getOption(), z = o.dataZoom[0];
            return {groups:panel === 2 ? MetricSelectList2 : MetricSelectList,
                series:o.series.map(s => ({id:s.id, data:s.data, style:s.lineStyle, stack:s.stack})),
                max:o.yAxis.map(a => a.max), legend:o.legend, range:[z.startValue,z.endValue],
                markers:markerPositions[panel], pins:(pinnedCards[panel] || []).map(p => ({id:p.id, text:p.cardEl.textContent})),
                scroll:document.getElementById('panel' + panel).scrollTop};
        }, panel);
    }
    async function heat(panel = 1) {
        await frames();
        return page.evaluate(panel => {
            const host = document.querySelector(`.heat-host[data-panel="${panel}"]`);
            return {groups:metricHeat.selection(panel), top:host.scrollTop, left:host.scrollLeft,
                maps:Array.from(host.querySelectorAll('.heat-map')).map(card => {
                    const viewport = card.querySelector('.heat-viewport');
                    const chart = echarts.getInstanceByDom(card.querySelector('.heat-canvas'));
                    const o = chart && chart.getOption();
                    return {key:card.dataset.group, top:viewport.scrollTop, left:viewport.scrollLeft,
                        sidebar:card.querySelector('.heat-sidebar-resizer').getAttribute('aria-valuenow'),
                        colors:Array.from(card.querySelectorAll('select,input')).map(el => el.value),
                        status:card.querySelector('.heat-status').textContent,
                        values:o && o.series[0].data, statistics:o && o.series[2].data,
                        missing:o && o.series[1].data, names:o && o.yAxis[0].data, labels:o && o.xAxis[0].data};
                })};
        }, panel);
    }
    async function hold(url) {
        let release, arrived;
        const gate = new Promise(resolve => { release = resolve; });
        const waiting = new Promise(resolve => { arrived = resolve; });
        await page.route('**' + url, async route => {
            const response = await route.fetch(); arrived(); await gate; await route.fulfill({response});
        }, {times:1});
        return {release, waiting};
    }
    try {
        await page.goto(base + '/metricviewer'); await page.waitForFunction(() => metricHeat);
        assert(await page.locator('#reloadLoadItem').isDisabled());
        assert.equal(await page.locator('#loadMenu').evaluate(el => el.firstElementChild.textContent), 'reload');
        checks.push('reload is first and disabled before loading');
        const first = csv('primary'), other = h5('secondary', 90000);
        await server(first);
        await plot('Traffic', ['port0','port1']); await plot('Requests', ['port2']);
        await page.evaluate(() => {
            myChart.dispatchAction({type:'dataZoom', startValue:40, endValue:220, disable_propagation:true});
            myChart.dispatchAction({type:'legendUnSelect', name:'Requests'});
            lastTooltipPos[1] = {x:300, y:200};
            pinSnapshot(1, {dataIndex:50, time:50, timeName:'', groupName:'Traffic', values:{port0:{value:100,color:'#123456'}}});
            document.getElementById('panel1').scrollTop = 25;
            document.getElementById('serverBrowserSelectedPath').value = '/not/the/loaded/file.csv';
        });
        await frames();
        const before = await line(); csv('primary', 500, 500, [], 250); await reload(); const after = await line();
        assert.deepEqual(after.groups, before.groups); assert.deepEqual(after.range, before.range);
        assert.deepEqual(after.legend, before.legend); assert.deepEqual(after.markers, before.markers);
        assert.deepEqual(after.pins, before.pins); assert.equal(after.scroll, before.scroll);
        assert.deepEqual(after.series.map(s => s.style), before.series.map(s => s.style));
        assert.equal(after.series[0].data[0], 500); assert.equal(after.series[0].data.length, 500);
        assert.equal(await page.locator('#sample_rate').inputValue(), '250');
        checks.push('server CSV reload uses remembered source, updates values/period and preserves groups, colors, legend, zoom, scroll and pinned snapshots');
        csv('primary', 700, 90, [1], null); await reload();
        const missingLine = await line(); assert.deepEqual(missingLine.range, [40,89]);
        assert(missingLine.series[1].data.every(v => v === null)); assert.equal(missingLine.series[1].data.length, 90);
        assert(dialogs.pop().includes('port1')); assert.equal(await page.locator('#sample_rate').inputValue(), '');
        csv('primary', 800, 100); await reload(); assert.equal((await line()).series[1].data[0], 1800);
        checks.push('shrinking samples clamps only out-of-range zoom; missing metrics keep their slots without stale values and recover on later reload');
        fs.writeFileSync(first, 'samplePeriod,invalid\nport0,99\n');
        const good = await line(); await reload(); assert.deepEqual(await line(), good); assert(dialogs.pop().includes('samplePeriod'));
        const backend = await page.evaluate(() => fetch('/api/show/query', {method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({query:{g:{Sig:['port0']}}})}).then(r=>r.json()));
        assert.equal(backend.data.g.Sig.port0[0], 800); csv('primary', 800, 100);
        checks.push('failed CSV reload preserves both visible charts and queryable backend data');
        await page.evaluate(() => setSplitMode('horizontal')); await server(other, 2); await plot('Secondary', ['port0'], 2);
        const secondaryBefore = await line(2); csv('primary', 900, 100); await reload(1);
        assert.deepEqual(await line(2), secondaryBefore);
        h5('secondary', 91000, 80, [], 125); await reload(2);
        assert.equal((await line(2)).series[0].data[0], 91000); assert.equal((await line()).series[0].data[0], 900);
        checks.push('server H5 reload and CSV reload affect only their originating split panel');
        // A completed older query must not append stale values after reload.
        await page.evaluate(() => setActivePanel(1)); const delayed = await hold('/api/show/query');
        await page.evaluate(() => { CurMetricSelectList=['port3']; document.getElementById('filterMetricGroup').value='Late'; MetricSelectSubmit(); });
        await delayed.waiting; csv('primary', 950, 100); await reload(1); delayed.release();
        await page.waitForResponse(r=>r.url().endsWith('/api/show/query')); await frames();
        assert(!(await line()).groups.Late);
        checks.push('late pre-reload Line query cannot append stale data');
        // Local selection belongs to the panel that opened the picker.
        const local = csv('local', 10000, 100);
        await page.evaluate(() => { setActivePanel(1); ClearAll(); });
        let chooserPromise = page.waitForEvent('filechooser'); await page.evaluate(() => loadLocal());
        let chooser = await chooserPromise; await chooser.setFiles(local); await idle(); await plot('Local', ['port0']);
        csv('local', 11000, 120);
        chooserPromise = page.waitForEvent('filechooser'); await page.evaluate(() => reloadFile()); chooser = await chooserPromise;
        await page.evaluate(() => setActivePanel(2)); await chooser.setFiles(local); await idle();
        assert.equal((await line()).series[0].data[0], 11000); assert.equal((await line(2)).series[0].data[0], 91000);
        const localGood = await line();
        chooserPromise = page.waitForEvent('filechooser'); await page.evaluate(() => { setActivePanel(1); reloadFile(); });
        chooser = await chooserPromise; await chooser.setFiles(first); await idle();
        assert(dialogs.pop().includes('local.csv')); assert.deepEqual(await line(), localGood);
        chooserPromise = page.waitForEvent('filechooser'); await page.evaluate(() => reloadFile()); await chooserPromise;
        await page.locator('#fileInput').dispatchEvent('cancel'); assert.deepEqual(await line(), localGood);
        checks.push('local CSV reselection refreshes the same filename, keeps the originating panel and leaves plots intact on wrong file or cancel');
        await page.evaluate(() => { ClearAll(); setSplitMode('single'); });
        const localH5 = h5('local-h5', 15000);
        chooserPromise = page.waitForEvent('filechooser'); await page.evaluate(() => loadLocal()); chooser = await chooserPromise;
        await chooser.setFiles(localH5); await idle(); await plot('Local H5', ['port0']); h5('local-h5', 16000);
        chooserPromise = page.waitForEvent('filechooser'); await page.evaluate(() => reloadFile()); chooser = await chooserPromise;
        await chooser.setFiles(localH5); await idle(); assert.equal((await line()).series[0].data[0], 16000);
        checks.push('local H5 reselection reloads current on-disk content');
        // Heat maps preserve their DOM and controls; independently calculated statistics must refresh.
        await page.evaluate(() => ClearAll()); csv('primary', 0); await server(first); await page.locator('#metricMode').selectOption('heat');
        await page.evaluate(async () => {
            await metricHeat.plot(Array.from({length:30},(_,i)=>'port'+i),1);
            await metricHeat.plot(['port0'],1); await metricHeat.plot(['port1'],1);
        }); await frames();
        await cards(1).nth(0).locator('[name="heatColor"]').selectOption('row');
        await cards(1).nth(1).locator('[name="heatMin"]').fill('-100'); await cards(1).nth(1).locator('[name="heatMin"]').dispatchEvent('change');
        await cards(1).nth(1).locator('[name="heatMax"]').fill('2000'); await cards(1).nth(1).locator('[name="heatMax"]').dispatchEvent('change');
        await cards(1).nth(1).locator('.heat-sidebar-resizer').press('ArrowRight');
        await cards(1).first().scrollIntoViewIfNeeded(); await frames();
        await page.evaluate(() => {
            const card=document.querySelector('.heat-map'), canvas=card.querySelector('.heat-canvas');
            const grid=echarts.getInstanceByDom(canvas).getOption().grid[0], rect=canvas.getBoundingClientRect();
            card.querySelector('.heat-viewport').dispatchEvent(new WheelEvent('wheel', {
                bubbles:true, cancelable:true, ctrlKey:true, deltaY:90,
                clientX:rect.left+grid.left+20, clientY:rect.top+grid.top+8}));
        }); await frames();
        await page.evaluate(() => {
            document.getElementById('zoom_start').value=30; document.getElementById('zoom_end').value=350; metricHeat.zoomFromInputs(1);
            const v=document.querySelector('.heat-viewport'); v.scrollLeft=500; v.scrollTop=32;
        }); await frames();
        await page.evaluate(() => { document.querySelector('.heat-host').scrollTop=350; window.savedHeatCards=Array.from(document.querySelectorAll('.heat-map')); });
        await frames(); const heatBefore = await heat(); csv('primary', 100, 420); await reload();
        const heatAfter = await heat(); assert.deepEqual(heatAfter.groups,heatBefore.groups);
        const sampleWidth = state => state.maps[1].status.match(/· ([\d.]+) px/)[1];
        assert.notEqual(sampleWidth(heatBefore),'16'); assert.equal(sampleWidth(heatAfter), sampleWidth(heatBefore));
        assert.equal(heatAfter.top, heatBefore.top); assert.equal(heatAfter.left, heatBefore.left);
        for (let i=0;i<3;i++) for(const key of ['top','left','sidebar','colors']) assert.deepEqual(heatAfter.maps[i][key],heatBefore.maps[i][key],key);
        assert(await page.evaluate(() => savedHeatCards.every((card,i)=>card===document.querySelectorAll('.heat-map')[i])));
        assert.equal(await page.locator('#zoom_start').inputValue(),'30'); assert.equal(await page.locator('#zoom_end').inputValue(),'350');
        await cards(1).nth(1).scrollIntoViewIfNeeded(); await frames();
        let stats=(await heat()).maps[1].statistics.map(v=>v[3]); assert.deepEqual(stats,[100,309.5,519]);
        await page.screenshot({path:path.join(output,'heat-reload.png')});
        checks.push('multiple Heat plots keep DOM, order, range, scroll, color limits and sidebar width while refreshing full-file min/avg/max');
        csv('primary', 200, 80, [0]); await reload(); assert(dialogs.pop().includes('port0'));
        await cards(1).nth(1).scrollIntoViewIfNeeded(); await frames(); const missingHeat=(await heat()).maps[1];
        assert(missingHeat.missing.length>0); assert(missingHeat.missing.every(v=>v[3]===null));
        assert.equal(await page.locator('#zoom_end').inputValue(),'79');
        await page.locator('#metricMode').selectOption('line');
        assert((await line()).series.find(s=>s.id==='Heatmap 2&port0').data.every(v=>v===null));
        await page.locator('#metricMode').selectOption('heat');
        await page.waitForFunction(() => Object.keys(metricHeat.selection(1)).length===3);
        await cards(1).nth(1).scrollIntoViewIfNeeded(); await frames();
        assert((await heat()).maps[1].missing.every(v=>v[3]===null));
        checks.push('missing metric placeholders survive Line/Heat round trips');
        csv('primary', 300, 120); await reload(); await frames(); assert.deepEqual((await heat()).maps[1].statistics.map(v=>v[3]),[300,359.5,419]);
        checks.push('Heat missing metrics show gray cells, preserve maps and recover; shrinking range clamps to new last sample');
        const delayedHeat = await hold('/api/show/query');
        await page.evaluate(() => { window.pendingHeatPlot=metricHeat.plot(['port3'],1); }); await delayedHeat.waiting;
        csv('primary', 400, 120); await reload(); delayedHeat.release(); await page.evaluate(() => pendingHeatPlot); await frames();
        await cards(1).nth(3).scrollIntoViewIfNeeded(); await frames();
        assert.equal((await heat()).maps[3].statistics[0][3],3400);
        checks.push('pending Heat plot refreshes from the new dataset and ignores its older response');
        const delayedReload = await hold('/api/show/server_load');
        await page.evaluate(() => reloadFile()); await delayedReload.waiting; await page.evaluate(() => ClearAll()); delayedReload.release(); await idle();
        assert.equal(await cards(1).count(),0);
        checks.push('Clear during pending reload is respected and cannot resurrect plots');
        await reload(); assert.equal(await cards(1).count(),0);
        await page.locator('#metricMode').selectOption('line'); await reload();
        assert.equal((await line()).series.length,0);
        checks.push('reloading with no plots works in both Heat and Line');
        assert.deepEqual(errors,[]); assert.deepEqual(dialogs,[]);
        fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'PASS',checks,errors},null,2));
        console.log(`PASS: ${checks.length} MetricViewer reload checks`);
    } catch(error) {
        fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'FAIL',checks,errors,dialogs,error:String(error)},null,2));
        await page.screenshot({path:path.join(output,'failure.png')}); throw error;
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
