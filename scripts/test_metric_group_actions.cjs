/* Group/metric removal against real CSV, production API and pointer/keyboard events.
 * Run against a dedicated server (both dataset slots are changed):
 * NODE_PATH=<existing Playwright> node scripts/test_metric_group_actions.cjs URL NEW_OUTPUT
 * Response-delay cases retain real server bytes; no query response/data stubs.
 */
'use strict';
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {observeHeat} = require('./heat_test_support.cjs');
const [base, outputArg] = process.argv.slice(2);
if (!base || !outputArg) throw Error('Usage: URL NEW_OUTPUT');
const output = path.resolve(outputArg);
fs.mkdirSync(output, {recursive:false});
const file = path.join(output, 'group-actions.csv');
const count = 200;
fs.writeFileSync(file, 'sample,' + Array.from({length:count}, (_, i) => i).join(',') + '\nsamplePeriod,100\n' +
    Array.from({length:256}, (_, m) => 'port' + m + ',' + Array.from({length:count}, (_, i) =>
        (m === 1 ? 0 : m) * 1000 + i).join(',')).join('\n') + '\n');
const report = {checks:[], errors:[], dialogs:[], delayedResponses:[], fixture:file};
(async () => {
    const browser = await chromium.launch({executablePath:process.env.METRIC_GROUP_CHROME || '/usr/bin/google-chrome',
        headless:true, args:['--no-sandbox', '--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:1500, height:950}});
    page.setDefaultTimeout(30000);
    await observeHeat(page);
    page.on('pageerror', error => report.errors.push(error.stack || String(error)));
    page.on('dialog', async dialog => {report.dialogs.push(dialog.message()); await dialog.dismiss();});
    const releases = [];
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const idle = async () => {await page.waitForFunction(() => !fileLoadBusy && $.active === 0); await frames();};
    const groups = panel => page.evaluate(panel => structuredClone(metricHeat.isHeat(panel)
        ? metricHeat.reloadSelection(panel) : panel === 2 ? MetricSelectList2 : MetricSelectList), panel);
    const signals = async panel => Object.fromEntries(Object.entries(await groups(panel)).map(([name, value]) => [name, value.Sig]));
    const card = (panel, group) => page.locator(`#panel${panel} .heat-map`).filter({has:page.locator(
        '.metric-group-actions' + '[data-group=' + JSON.stringify(group) + ']')});
    const actions = (panel, group) => page.locator(`#panel${panel} .metric-group-actions[data-group=${JSON.stringify(group)}]:visible`);
    async function menu(panel, group) {
        const toggle = actions(panel, group).locator('.metric-group-actions-toggle');
        await toggle.scrollIntoViewIfNeeded();
        assert.equal(await toggle.getAttribute('aria-label'), 'Actions for ' + group);
        await toggle.click();
        const popup = page.locator('.metric-group-menu:visible');
        await popup.waitFor({state:'visible'});
        assert.equal(await popup.getAttribute('data-group'), group);
        return popup;
    }
    async function removeMetric(panel, group, name) {
        const popup = await menu(panel, group);
        await popup.getByRole('button', {name:'Remove metric…', exact:true}).click();
        await popup.locator(`.metric-group-metric-remove[data-metric=${JSON.stringify(name)}]`).click();
        await frames();
    }
    async function removeGroup(panel, group) {
        await (await menu(panel, group)).getByRole('button', {name:'Remove group', exact:true}).click();
        await frames();
    }
    async function selectMode(panel, mode) {
        await page.evaluate(panel => setActivePanel(panel), panel);
        await page.locator('#metricMode').selectOption(mode); await idle();
    }
    async function plot(panel, group, names, wait = true) {
        await page.evaluate(({panel, group, names}) => {
            setActivePanel(panel);
            const selected = panel === 2 ? CurMetricSelectList2 : CurMetricSelectList;
            selected.splice(0, selected.length, ...names);
            document.getElementById('filterMetricGroup').value = group;
            MetricSelectSubmit();
        }, {panel, group, names});
        if (wait) await idle();
    }
    async function heatPlot(panel, names, wait = true) {
        const before = Object.keys(await groups(panel));
        await page.evaluate(({panel, names}) => {window.latestHeatPlot = metricHeat.plot(names, panel);}, {panel, names});
        if (wait) {await page.evaluate(() => latestHeatPlot); await idle();}
        const added = Object.keys(await groups(panel)).filter(key => !before.includes(key));
        assert.equal(added.length, 1); return added[0];
    }
    async function lineState(panel) {
        return page.evaluate(panel => {
            const o = getPanelChart(panel).getOption();
            return {groups:structuredClone(panel === 2 ? MetricSelectList2 : MetricSelectList),
                series:o.series.map(s => ({id:s.id, name:s.name, data:s.data, line:s.lineStyle,
                    area:s.areaStyle, smooth:s.smooth, stack:s.stack, symbol:s.symbol, symbolSize:s.symbolSize})),
                grid:o.grid.map(g => ({id:g.id, top:g.top, height:g.height})),
                axes:['xAxis','yAxis'].map(key => o[key].map(a => ({id:a.id, grid:a.gridIndex, min:a.min, max:a.max, data:a.data}))),
                zoom:o.dataZoom.map(z => [z.start, z.end, z.startValue, z.endValue]),
                markers:structuredClone(markerPositions[panel]),
                pins:(pinnedCards[panel] || []).map(p => ({id:p.id, index:p.dataIndex, text:p.cardEl.textContent}))};
        }, panel);
    }
    async function lineClick(panel, group, name) {
        // The real curve must finish drawing before its sample is hit-tested.
        await page.waitForFunction(panel => getPanelChart(panel).getZr().animation.isFinished(), panel);
        await page.evaluate(panel => {
            setActivePanel(panel);
            getPanelChart(panel).dispatchAction({type:'takeGlobalCursor', key:'dataZoomSelect', dataZoomSelectActive:false});
        }, panel);
        const point = await page.evaluate(({panel, group, name}) => {
            const chart = getPanelChart(panel), o = chart.getOption(), index = o.series.findIndex(s => s.id === group + '&' + name);
            if (index < 0) throw Error('Missing series: ' + group + '&' + name);
            const xy = chart.convertToPixel({seriesIndex:index}, [70, o.series[index].data[70]]), rect = chart.getDom().getBoundingClientRect();
            return {x:rect.left + xy[0], y:rect.top + xy[1]};
        }, {panel, group, name});
        await page.mouse.click(point.x, point.y); await frames();
    }
    async function heatClick(panel, group, row = 0) {
        await card(panel, group).scrollIntoViewIfNeeded(); await frames();
        const point = await card(panel, group).evaluate((el, row) => {
            const host = el.querySelector('.heat-canvas'), chart = heatTestChart(host), rect = host.getBoundingClientRect();
            const xy = chart.convertToPixel({seriesIndex:0}, [1, row]);
            return {x:rect.left + xy[0], y:rect.top + xy[1]};
        }, row);
        await page.mouse.click(point.x, point.y); await frames();
    }
    async function waitFor(promise, label) {
        let timer;
        try {return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Timed out: ' + label)), 30000);
        })]);} finally {clearTimeout(timer);}
    }
    async function holdQuery(match = () => true) {
        let release, arrive, finish, consumed = false;
        const gate = new Promise(resolve => {release = resolve;}); releases.push(release);
        const waiting = new Promise(resolve => {arrive = resolve;}), completed = new Promise(resolve => {finish = resolve;});
        const handler = async route => {
            const request = route.request().postDataJSON();
            if (consumed || !match(request)) {await route.continue(); return;}
            consumed = true;
            const response = await route.fetch(), body = await response.json();
            report.delayedResponses.push({query:request.query, code:body.code});
            arrive({request, body}); await gate; await route.fulfill({response}); finish();
        };
        await page.route('**/api/show/query', handler);
        return {waiting, async release() {release(); await waitFor(completed, 'delayed query delivery');
            await page.unroute('**/api/show/query', handler); await idle();}};
    }
    async function reload(panel) {
        await page.evaluate(panel => {setActivePanel(panel); reloadFile();}, panel); await idle();
    }
    try {
        await page.goto(base + '/metricviewer'); await page.waitForFunction(() => window.metricHeat);
        await page.evaluate(() => setSplitMode('horizontal')); await frames();
        for (const panel of [1,2]) {
            await page.evaluate(({panel, file}) => requestServerFile(file, panel, false), {panel, file}); await idle();
        }
        await plot(1, 'A', ['port0','port1']); await plot(1, 'B', ['port0','port2']);
        await plot(1, 'C', ['port3']); await plot(1, 'D', ['port4']); await plot(2, 'A', ['port0','port1']);
        await page.evaluate(() => {
            myChart.dispatchAction({type:'dataZoom', startValue:20, endValue:150, disable_propagation:true});
            pinSnapshot(1, buildSnapshotForSample(1, 40, 'C'));
        }); await frames();
        const original = await lineState(1), other = await lineState(2);
        await removeMetric(1, 'A', 'port0');
        const afterMetric = await lineState(1);
        assert.deepEqual(afterMetric.series, original.series.filter(s => s.id !== 'A&port0'));
        assert.deepEqual(afterMetric.grid, original.grid); assert.deepEqual(afterMetric.axes, original.axes);
        for (const key of ['zoom','markers','pins']) assert.deepEqual(afterMetric[key], original[key]);
        assert.deepEqual((await signals(1)).A, ['port1']); assert.deepEqual((await signals(1)).B, ['port0','port2']);
        assert.deepEqual(await lineState(2), other);
        report.checks.push('Line metric menu removes only the chosen overlapping curve; other groups/panel, exact survivor data/style, axes, zoom, markers and pins remain');
        await removeGroup(1, 'C');
        const afterMiddle = await lineState(1);
        assert.deepEqual(afterMiddle.grid.map(g => g.id), ['A','B','D']);
        assert.deepEqual(afterMiddle.series, afterMetric.series.filter(s => s.name !== 'C'));
        assert.deepEqual(afterMiddle.zoom, afterMetric.zoom); assert.deepEqual(await lineState(2), other);
        for (const axes of afterMiddle.axes) assert.deepEqual(axes.map(a => a.grid), [0,1,2]);
        report.checks.push('Line middle-group menu removal compacts axes without modifying survivor series or other-panel state');
        await removeMetric(1, 'D', 'port4'); assert.deepEqual(Object.keys(await groups(1)), ['A','B']);
        report.checks.push('Line removing the last metric removes its empty group and actions menu');
        // Opening the group menu selects only the group. Plain Delete must not delete it.
        await menu(1, 'B'); await page.keyboard.press('Escape'); await page.keyboard.press('Delete'); await frames();
        assert.deepEqual((await signals(1)).B, ['port0','port2']);
        report.checks.push('Line group-only selection cannot turn plain Delete into whole-group removal');
        await lineClick(1, 'B', 'port2'); await page.keyboard.press('Delete'); await frames();
        assert.deepEqual((await signals(1)).B, ['port0']);
        assert.deepEqual(await lineState(2), other);
        report.checks.push('Line real curve click + Delete removes precisely that metric');
        await lineClick(1, 'A', 'port1'); await page.keyboard.press('Shift+Delete'); await frames();
        assert.deepEqual(await signals(1), {B:['port0']});
        report.checks.push('Line real curve click + Shift+Delete removes its complete group');
        await selectMode(1, 'heat'); assert.deepEqual(await signals(1), {B:['port0']});
        await reload(1); assert.deepEqual(await signals(1), {B:['port0']});
        await selectMode(1, 'line'); assert.deepEqual(await signals(1), {B:['port0']});
        report.checks.push('Line deletions survive Line/Heat round trip and real CSV reload');

        await plot(1, 'PendingMetric', ['port0','port1']);
        let delayed = await holdQuery(body => Object.hasOwn(body.query, 'PendingMetric'));
        await plot(1, 'PendingMetric', ['port0','port5'], false); await waitFor(delayed.waiting, 'Line append response');
        await removeMetric(1, 'PendingMetric', 'port0'); await plot(1, 'Independent', ['port6'], false);
        await page.waitForFunction(() => MetricSelectList.Independent && MetricSelectList.Independent.Sig.includes('port6'));
        await delayed.release();
        assert.deepEqual((await signals(1)).PendingMetric, ['port1','port5']);
        assert.deepEqual((await signals(1)).Independent, ['port6']);
        assert.equal((await lineState(1)).series.find(s => s.id === 'PendingMetric&port5').data[70], 5070);
        report.checks.push('Line delayed append cannot resurrect a deleted metric; surviving/new metrics and another group finish from genuine API responses');
        delayed = await holdQuery(body => Object.hasOwn(body.query, 'PendingMetric'));
        await plot(1, 'PendingMetric', ['port7'], false); await waitFor(delayed.waiting, 'Line group append response');
        await removeGroup(1, 'PendingMetric'); await delayed.release();
        assert.equal((await groups(1)).PendingMetric, undefined);
        assert.deepEqual((await signals(1)).Independent, ['port6']);
        report.checks.push('Line delayed append cannot resurrect a deleted group');

        await selectMode(1, 'heat'); await selectMode(2, 'heat');
        const heatOther = await signals(2);
        await card(1, 'B').locator('.heat-sidebar-resizer').press('Home'); await frames();
        assert.equal(await card(1, 'B').locator('.heat-sidebar-resizer').getAttribute('aria-valuenow'), '0');
        await removeGroup(1, 'B'); assert.equal((await groups(1)).B, undefined);
        assert.deepEqual(await signals(2), heatOther);
        report.checks.push('Heat whole-group menu remains pointer-accessible with sidebar width zero; other panel is unchanged');
        const first = await heatPlot(1, ['port0','port1']), duplicate = await heatPlot(1, ['port0','port2']);
        await removeMetric(1, first, 'port0');
        assert.deepEqual((await signals(1))[first], ['port1']); assert.deepEqual((await signals(1))[duplicate], ['port0','port2']);
        assert.deepEqual(await signals(2), heatOther);
        report.checks.push('Heat metric list deletes only one group occurrence, including a metric shared by another group and panel');
        await heatClick(1, duplicate, 1); await page.keyboard.press('Delete'); await frames();
        assert.deepEqual((await signals(1))[duplicate], ['port0']);
        report.checks.push('Heat real cell click + Delete removes the selected row');
        await heatClick(1, duplicate); await page.keyboard.press('Shift+Delete'); await frames();
        assert.equal((await groups(1))[duplicate], undefined);
        await removeMetric(1, first, 'port1'); assert.equal((await groups(1))[first], undefined);
        report.checks.push('Heat Shift+Delete removes the selected group; removing the final row also removes an empty group');
        const kept = await signals(1);
        await selectMode(1, 'line'); assert.deepEqual(await signals(1), kept);
        await reload(1); assert.deepEqual(await signals(1), kept);
        await selectMode(1, 'heat'); await reload(1); assert.deepEqual(await signals(1), kept);
        report.checks.push('Heat deletions survive Line/Heat round trips and reload in both modes');

        delayed = await holdQuery();
        const pendingMetric = await heatPlot(1, ['port10','port11'], false);
        await waitFor(delayed.waiting, 'Heat metric response');
        await removeMetric(1, pendingMetric, 'port10');
        const independentHeat = await heatPlot(1, ['port12'], false);
        await page.waitForFunction(key => metricHeat.selection(1)[key], independentHeat);
        await delayed.release();
        assert.deepEqual((await signals(1))[pendingMetric], ['port11']);
        assert.deepEqual((await signals(1))[independentHeat], ['port12']);
        await card(1, pendingMetric).scrollIntoViewIfNeeded(); await frames();
        const renderedNames = await card(1, pendingMetric).evaluate(el => heatTestFrame(el.querySelector('.heat-canvas')).rows.map(r => r.name));
        assert.deepEqual(renderedNames, ['port11']);
        report.checks.push('Heat deleting one pending metric filters the real response while its surviving metric and another pending map finish');
        delayed = await holdQuery();
        const pendingGroup = await heatPlot(1, ['port13'], false);
        await waitFor(delayed.waiting, 'Heat group response');
        // Attempting Line while a map is busy uses the existing wait notice.
        await page.evaluate(() => setActivePanel(1)); await page.locator('#metricMode').selectOption('line'); await frames();
        assert.equal(await page.evaluate(() => metricHeat.isHeat(1)), true);
        await removeGroup(1, pendingGroup); await delayed.release();
        assert.equal((await groups(1))[pendingGroup], undefined);
        assert.equal(await page.locator('#panel1 .heat-panel-status').evaluate(el => el.textContent.includes('Wait for')), false);
        const finalGroups = await signals(1);
        await selectMode(1, 'line'); assert.deepEqual(await signals(1), finalGroups);
        await reload(1); assert.deepEqual(await signals(1), finalGroups);
        assert.deepEqual(await signals(2), heatOther);
        report.checks.push('Heat pending-group removal clears obsolete waiting state, ignores its late response, allows Line and remains deleted after reload');

        // A Line response may arrive after the active renderer has become Heat.
        // Keep it in flight while using normal mode/menu actions; waiting on
        // $.active here would deadlock on the deliberately held response.
        await page.evaluate(() => ClearAll(1)); await frames();
        await plot(1, 'CrossMetric', ['port0','port1']);
        await plot(1, 'CrossGroup', ['port2','port3']);
        await plot(1, 'CrossKeep', ['port4']);
        delayed = await holdQuery(body => Object.hasOwn(body.query, 'CrossMetric'));
        await plot(1, 'CrossMetric', ['port0','port14'], false);
        await waitFor(delayed.waiting, 'cross-mode Line metric append');
        await page.locator('#metricMode').selectOption('heat');
        await page.waitForFunction(() => metricHeat.isHeat(1) && ['CrossMetric','CrossGroup','CrossKeep'].every(
            name => metricHeat.selection(1)[name])); await frames();
        await removeMetric(1, 'CrossMetric', 'port0');
        const crossIndependent = await heatPlot(1, ['port16'], false);
        await page.waitForFunction(key => metricHeat.selection(1)[key], crossIndependent);
        await delayed.release();
        const crossMetricGroups = await signals(1);
        assert.deepEqual(crossMetricGroups.CrossMetric, ['port1']);
        assert(!Object.entries(crossMetricGroups).filter(([key]) => key.startsWith('CrossMetric')).some(([, names]) => names.includes('port0')));
        assert(Object.entries(crossMetricGroups).filter(([key]) => key.startsWith('CrossMetric')).some(([, names]) => names.includes('port14')));
        assert.deepEqual(crossMetricGroups.CrossKeep, ['port4']);
        assert.deepEqual(crossMetricGroups[crossIndependent], ['port16']);
        report.checks.push('Late Line append after switching to Heat cannot resurrect a deleted metric; remaining new data and an independent query are retained');
        await selectMode(1, 'line');
        delayed = await holdQuery(body => Object.hasOwn(body.query, 'CrossGroup'));
        await plot(1, 'CrossGroup', ['port17'], false);
        await waitFor(delayed.waiting, 'cross-mode Line group append');
        await page.locator('#metricMode').selectOption('heat');
        await page.waitForFunction(() => metricHeat.isHeat(1) && metricHeat.selection(1).CrossGroup); await frames();
        await removeGroup(1, 'CrossGroup');
        const crossOther = await heatPlot(1, ['port18'], false);
        await page.waitForFunction(key => metricHeat.selection(1)[key], crossOther);
        await delayed.release();
        assert(!Object.keys(await groups(1)).some(key => key.startsWith('CrossGroup')));
        assert.deepEqual((await signals(1)).CrossKeep, ['port4']);
        assert.deepEqual((await signals(1))[crossOther], ['port18']);
        assert.deepEqual(await signals(2), heatOther);
        report.checks.push('Late Line append after switching to Heat cannot resurrect a deleted group or cancel another group/panel');

        await menu(1, 'CrossKeep');
        await page.locator('#metricMode').focus();
        assert.equal(await page.locator('.metric-group-menu:visible').count(), 1);
        await page.keyboard.press('Home'); await page.keyboard.press('Tab'); await idle();
        assert.equal(await page.locator('#metricMode').inputValue(), 'line');
        assert.equal(await page.locator('.metric-group-menu:visible').count(), 0);
        await menu(1, 'CrossKeep');
        const otherHandle = card(2, 'A').locator('.heat-sidebar-resizer');
        await otherHandle.focus();
        assert.equal(await page.locator('.metric-group-menu:visible').count(), 1);
        await page.keyboard.press('ArrowLeft'); await frames();
        assert.equal(await page.evaluate(() => activePanel), 2);
        assert.equal(await page.locator('.metric-group-menu:visible').count(), 0);
        assert.deepEqual(await signals(2), heatOther);
        report.checks.push('A pointer-opened menu closes on native keyboard mode change and keyboard activation of the other panel');

        await selectMode(1, 'heat');
        await page.evaluate(() => {ClearAll(1); setSplitMode('vertical');}); await frames();
        const manyNames = Array.from({length:256}, (_, i) => 'port' + i);
        const large = await heatPlot(1, manyNames);
        await card(1, large).locator('.heat-sidebar-resizer').press('Home'); await frames();
        assert.equal(await card(1, large).locator('.heat-sidebar-resizer').getAttribute('aria-valuenow'), '0');
        const largeMenu = await menu(1, large);
        await largeMenu.getByRole('button', {name:'Remove metric…', exact:true}).click();
        const list = largeMenu.locator('.metric-group-metrics');
        const mounted = () => largeMenu.locator('.metric-group-metric-remove').count();
        assert((await mounted()) > 0 && (await mounted()) <= 16, 'Only the visible list window may be mounted');
        await list.hover(); await page.mouse.wheel(0, 20000);
        await page.waitForFunction(() => {
            const list = document.querySelector('.metric-group-menu .metric-group-metrics');
            return list && list.scrollTop >= list.scrollHeight - list.clientHeight - 1;
        }); await frames();
        assert((await mounted()) <= 16, 'Scrolling must keep the metric menu DOM bounded');
        const penultimate = largeMenu.locator('.metric-group-metric-remove[data-metric="port254"]');
        await penultimate.focus(); await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.metric), 'port255');
        await page.keyboard.press('Enter'); await frames();
        assert.deepEqual((await signals(1))[large], manyNames.slice(0, -1));
        assert.equal(await page.locator('.metric-group-menu:visible').count(), 0);
        await card(1, large).scrollIntoViewIfNeeded(); await frames();
        const dataCheck = await card(1, large).evaluate(el => {
            const frame = heatTestFrame(el.querySelector('.heat-canvas'));
            return {rows:frame.rows.length, failures:frame.rows.filter(row => {
                const number = Number(row.name.slice(4)), offset = number === 1 ? 0 : number * 1000;
                return row.values.length !== 200 || row.values.some((value, sample) => value !== offset + sample) ||
                    row.min !== offset || row.avg !== offset + 99.5 || row.max !== offset + 199;
            }).map(row => row.name)};
        });
        assert.deepEqual(dataCheck, {rows:255, failures:[]});
        assert.deepEqual(await signals(2), heatOther);
        report.checks.push('Vertical split with hidden Heat sidebar: 256-metric menu mounts at most 16 rows, real wheel/keyboard removes the tail, and all 255 survivor sample arrays/statistics remain exact');
        assert.deepEqual(report.errors, []);
        assert(report.dialogs.every(text => /select|click/i.test(text)), 'Only the group-only Delete selection hint may open a dialog');
        report.status = 'PASS';
        await page.screenshot({path:path.join(output, 'group-actions.png')});
        console.log(`PASS: ${report.checks.length} metric/group action checks`);
    } catch (error) {
        report.status = 'FAIL'; report.failure = error.stack;
        await page.screenshot({path:path.join(output, 'failure.png')}).catch(() => {}); throw error;
    } finally {
        releases.forEach(release => release());
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
        await browser.close();
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
