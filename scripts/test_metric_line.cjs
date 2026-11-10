/* Real Line layout/interaction checks against a dedicated ArchVisual server.
 * NODE_PATH=<existing Playwright> node scripts/test_metric_line.cjs URL NEW_OUTPUT
 * METRIC_LINE_RENDERER is an assertion for a diagnostic renderer override;
 * the production page has no renderer selector. Fixtures stay in NEW_OUTPUT.
 */
'use strict';
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [base, outputArg] = process.argv.slice(2);
if (!base || !outputArg) throw Error('Usage: URL NEW_OUTPUT');
const output = path.resolve(outputArg), expectedRenderer = process.env.METRIC_LINE_RENDERER || 'canvas';
fs.mkdirSync(output, {recursive:false});
const file = path.join(output, 'line.csv'), count = 300;
const expected = Array.from({length:4}, (_, metric) =>
    Array.from({length:count}, (_, sample) => metric * 1000 + sample));
fs.writeFileSync(file, 'sample,' + Array.from({length:count}, (_, i) => i).join(',') + '\n' +
    'samplePeriod,100\n' + expected.map((values, i) => 'port' + i + ',' + values.join(',')).join('\n') + '\n');
const result = {renderer:expectedRenderer, checks:[], errors:[], dialogs:[], resize:[]};
(async () => {
    const browser = await chromium.launch({executablePath:process.env.METRIC_LINE_CHROME || '/usr/bin/google-chrome',
        headless:true, args:['--no-sandbox','--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:1500,height:850}});
    page.setDefaultTimeout(30000);
    page.on('pageerror', e => result.errors.push(String(e)));
    page.on('dialog', async d => {result.dialogs.push(d.message()); await d.dismiss();});
    const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const idle = async () => {await page.waitForFunction(() => !fileLoadBusy && $.active === 0); await frames();};
    const state = panel => page.evaluate(panel => {
        const c = getPanelChart(panel), o = c.getOption();
        return {size:[c.getWidth(),c.getHeight()], actual:[c.getDom().clientWidth,c.getDom().clientHeight],
            renderer:c.getZr().painter.getType(), series:(o.series || []).map(s => ({id:s.id,data:s.data,stack:s.stack})),
            grids:(o.grid || []).length, zoom:o.dataZoom.map(z => [z.startValue,z.endValue])};
    }, panel);
    async function load(panel) {
        await page.evaluate(({file,panel}) => requestServerFile(file,panel,false), {file,panel}); await idle();
        assert.equal((await state(panel)).renderer, expectedRenderer);
        await page.evaluate(panel => {
            const c = getPanelChart(panel), resize = c.resize;
            c.resize = function(...args) {
                lineResizes.push({panel,before:[c.getWidth(),c.getHeight()],
                    actual:[c.getDom().clientWidth,c.getDom().clientHeight]});
                return resize.apply(this,args);
            };
        }, panel);
    }
    // Production query and append path, also usable for a late reply to a hidden panel.
    async function append(panel, groups) {
        await page.evaluate(async ({panel,groups}) => {
            const response = await fetch('/api/show/query', {method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({secondary:panel === 2,query:groups})}).then(r => r.json());
            if (response.code) throw Error(response.msg);
            append_metrics(response.data,panel);
        }, {panel,groups}); await frames();
    }
    const group = (names=['port0'], stack=false) => ({Sig:names,Max:null,Stack:stack});
    const resetCalls = () => page.evaluate(() => {lineResizes=[];});
    const calls = () => page.evaluate(() => lineResizes);
    const checkNoCalls = async label => {assert.deepEqual(await calls(),[],label); result.checks.push(label);};
    const checkActualSize = async panel => {const s=await state(panel); assert.deepEqual(s.size,s.actual); return s;};
    try {
        await page.goto(base+'/metricviewer'); await page.waitForFunction(() => window.metricHeat);
        await page.evaluate(() => {window.lineResizes=[];});
        await load(1); await resetCalls();
        await append(1,{Primary:group(['port0','port1'])});
        await append(1,{Second:group(['port2'])});
        await checkNoCalls('Primary Plot below CSS minimum height does not resize');
        assert.deepEqual((await state(1)).series.map(s=>s.data),expected.slice(0,3));
        await page.evaluate(() => setSplitMode('horizontal')); await frames();
        await load(2); await resetCalls();
        await append(2,{Secondary:group(['port0','port1'])});
        await append(2,{Stacked:group(['port2','port3'],true)});
        await checkNoCalls('Secondary Plot below CSS minimum height does not resize');
        assert.equal((await state(2)).series[2].stack,'Stacked');
        assert.deepEqual((await state(2)).series.map(s=>s.data),expected);
        result.checks.push('Both panels retain all queried values; stacked series retain their group');

        for (const panel of [1,2]) {
            const initial=await state(panel); await resetCalls();
            const groups=Object.fromEntries(Array.from({length:10},(_,i)=>['Grow '+i,group()]));
            await append(panel,groups);
            const grown=await checkActualSize(panel), growing=await calls();
            assert(grown.size[1]>initial.size[1]); assert(growing.length>0);
            assert(growing.every(c=>JSON.stringify(c.before)!==JSON.stringify(c.actual)), 'Growth never resizes equal dimensions');
            await resetCalls();
            // Remove from the middle so every remaining axis must be compacted.
            await page.evaluate(panel => {for(let i=0;i<10;i++)delete_metric_group('Grow '+i,panel);},panel);
            const shrunk=await checkActualSize(panel), shrinking=await calls();
            assert.equal(shrunk.size[1],initial.size[1]); assert(shrinking.length>0);
            assert(shrinking.every(c=>JSON.stringify(c.before)!==JSON.stringify(c.actual)), 'Shrink never resizes equal dimensions');
            result.resize.push({panel,growing,shrinking});
            result.checks.push(`Panel ${panel}: real height growth/shrink still resizes and preserves remaining groups`);
        }
        await page.evaluate(() => setSplitMode('single')); await frames(); await resetCalls();
        await append(2,{HiddenReply:group()}); await checkNoCalls('Hidden panel reply never resizes to zero dimensions');
        await page.evaluate(() => setSplitMode('horizontal')); await frames();
        await checkActualSize(1); await checkActualSize(2);
        assert.equal((await state(2)).grids,3);
        result.checks.push('Revealing a hidden panel restores its real chart dimensions and all groups');
        await page.setViewportSize({width:1250,height:950}); await frames();
        await checkActualSize(1); await checkActualSize(2);
        await resetCalls(); await page.waitForTimeout(150); await checkNoCalls('Layout settles without a resize loop');
        await page.evaluate(() => {setSplitMode('single');setActivePanel(1);}); await frames();

        // Actual mouse interaction exercises the renderer's event registration.
        const point = await page.evaluate(() => {
            const r=dom.getBoundingClientRect();
            return {x:r.left+myChart.convertToPixel({xAxisIndex:0},80),y:r.top+55};
        });
        await page.mouse.move(point.x,point.y);
        await page.waitForFunction(() => currentHoverSnapshot[1] && currentHoverSnapshot[1].dataIndex === 80);
        assert.equal(await page.evaluate(() => currentHoverSnapshot[1].values.port0.value),80);
        await page.mouse.dblclick(point.x,point.y);
        await page.waitForFunction(() => pinnedCards[1].length===1 && markerPositions[1].length===1);
        assert.equal(await page.evaluate(() => pinnedCards[1][0].dataIndex),80);
        result.checks.push('Real mouse hover reports exact sample; double-click creates a pin and marker');
        await page.locator('.pinned-card .pin-close').click();
        assert.equal(await page.evaluate(() => markerPositions[1].length),0);
        result.checks.push('Closing the pinned card removes its matching marker');
        const beforeZoom=await state(1);
        const box=await page.locator('#container').boundingBox();
        await page.mouse.move(box.x+box.width*.3,box.y+45); await page.mouse.down();
        await page.mouse.move(box.x+box.width*.6,box.y+75,{steps:8}); await page.mouse.up(); await frames();
        assert.notDeepEqual((await state(1)).zoom,beforeZoom.zoom);
        const beforePan=await state(1);
        await page.evaluate(() => myChart.dispatchAction({type:'dataZoom',startValue:40,endValue:100})); await frames();
        assert.notDeepEqual((await state(1)).zoom,beforePan.zoom);
        result.checks.push('Mouse rectangle zoom and subsequent range update preserve working event handlers');

        const beforeReload=await state(1);
        await page.evaluate(() => reloadFile()); await idle();
        assert.deepEqual((await state(1)).series,beforeReload.series);
        assert.deepEqual((await state(1)).zoom,beforeReload.zoom);
        result.checks.push('Reload retains Line values, groups and zoom range');
        await page.locator('#metricMode').selectOption('heat'); await idle();
        await page.waitForFunction(() => document.querySelectorAll('.heat-map').length===2);
        assert(await page.evaluate(() => Array.from(document.querySelectorAll('.heat-canvas')).every(e=>
            echarts.getInstanceByDom(e).getZr().painter.getType()==='canvas')));
        await page.locator('#metricMode').selectOption('line'); await idle();
        assert.deepEqual((await state(1)).series,beforeReload.series);
        assert.equal((await state(1)).renderer,expectedRenderer);
        result.checks.push('Line/Heat round trip retains all Line samples; Heat renderer remains Canvas');
        await page.evaluate(() => delete_metric_group('Second',1)); await frames();
        assert.equal((await state(1)).grids,1);
        await page.evaluate(() => ClearAll()); await frames();
        assert.equal((await state(1)).series.length,0);
        assert.equal((await state(2)).grids,3);
        result.checks.push('Delete group and Clear affect only the intended panel');
        assert.deepEqual(result.errors,[]); assert.deepEqual(result.dialogs,[]);
        await page.screenshot({path:path.join(output,'line.png')});
        result.status='PASS'; console.log(`PASS: ${result.checks.length} Line checks (${expectedRenderer})`);
    } catch(error) {
        result.status='FAIL'; result.failure=error.stack;
        await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); throw error;
    } finally {
        fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
