/* Run against a dedicated production server:
 * NODE_PATH=<existing Playwright> node scripts/test_heat_template_import.cjs URL NEW_OUTPUT
 * CSV/H5 fixtures, templates and receipts stay in NEW_OUTPUT, outside the source tree.
 */
'use strict';
const {observeHeat} = require('./heat_test_support.cjs');
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const [base, outputArg] = process.argv.slice(2);
if (!base || !outputArg) throw Error('Usage: URL NEW_OUTPUT');
const output = path.resolve(outputArg);
fs.mkdirSync(output, {recursive:false});
const result = {checks:[], errors:[], dialogs:[], imports:[]};
const times = [900,100,700,200,800,300,600,400,500,1000,1200,1100];
function fixture(name, offset) {
    const values = {
        traffic:times.map((_,i) => offset + i * 10),
        requests:times.map((_,i) => offset - i),
        ratio:times.map((_,i) => i === 3 ? null : i / 4),
        absent:times.map(() => null)
    };
    const csv = path.join(output,name+'.csv'), h5 = path.join(output,name+'.h5');
    fs.writeFileSync(csv, 'sample,'+times.join(',')+'\nsamplePeriod,100\n'+
        Object.entries(values).map(([key,row]) => key+','+row.map(v=>v===null?'':v).join(',')).join('\n')+'\n');
    execFileSync('python3',['-B',path.join(__dirname,'csv2hdf.py'),'-i',csv,'-o',h5],{stdio:'pipe'});
    return {file:h5,values};
}
const primary = fixture('primary',0), secondary = fixture('secondary',10000);
const groups = {
    'Heatmap 1':{Max:'dataMax',Stack:false,Sig:['ratio','traffic'],Heat:{color:'raw',min:'-10',max:'1000'}},
    'Other':{Max:200,Stack:true,Sig:['absent','requests'],Heat:{color:'row',min:'',max:''}}
};
const templateFile = path.join(output,'import.json');
fs.writeFileSync(templateFile,JSON.stringify(groups));
// Existing template API accepts a relative path; keep all test writes outside static/data.
const template = path.relative(path.resolve(__dirname,'../dataviewer/static/data'),templateFile.slice(0,-5));
(async () => {
    const browser = await chromium.launch({executablePath:process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome',
        headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:1500,height:1050}});
    await observeHeat(page);
    const requests = [], releases = [];
    page.on('request',r => {if(r.url().includes('/api/')) requests.push(new URL(r.url()).pathname);});
    page.on('pageerror',e => result.errors.push(String(e)));
    page.on('dialog',async d => {result.dialogs.push(d.message()); await d.dismiss();});
    const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const idle = async () => {await page.waitForFunction(() => !fileLoadBusy && $.active===0); await frames();};
    const selection = panel => page.evaluate(panel => metricHeat.selection(panel),panel);
    const cards = panel => page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    async function load(panel,file) {
        await page.evaluate(({panel,file}) => requestServerFile(file,panel,false),{panel,file});
        await page.waitForFunction(() => !fileLoadBusy); await frames();
    }
    async function mode(panel,value) {
        await page.evaluate(panel => setActivePanel(panel),panel);
        await page.locator('#metricMode').selectOption(value); await idle();
    }
    async function importTemplate(panel) {
        await page.evaluate(panel => setActivePanel(panel),panel);
        await page.locator('#templateBtn').click(); await page.locator('#template_name').fill(template);
        const start = requests.length;
        const [response] = await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/temp/import')),
            page.locator('#templateMenu [onclick="doTemplate(\'import\')"]').click()]);
        const body = await response.json(); assert.equal(body.code,0);
        await idle();
        const seen = requests.slice(start), record = {panel,requests:seen,bytes:Buffer.byteLength(JSON.stringify(body))};
        result.imports.push(record);
        assert.deepEqual(seen,['/api/temp/import'],'Import must consume returned values without another query');
        return body.data;
    }
    async function verify(panel,key,names,values) {
        // Exact data-group avoids a prefix collision with the automatically suffixed group.
        const index = await cards(panel).evaluateAll((nodes,key)=>nodes.findIndex(n=>n.dataset.group===key),key);
        assert(index>=0); await cards(panel).nth(index).scrollIntoViewIfNeeded(); await frames();
        const actual = await cards(panel).nth(index).evaluate(card => {
            const o = heatTestChart(card.querySelector('.heat-canvas')).getOption();
            const cells = heatTestCells(card.querySelector('.heat-canvas'));
            const stats = o.series.filter(s=>['heat-statistics','heat-statistics-missing'].includes(s.id)).flatMap(s=>s.data);
            return {names:o.yAxis[0].data,times:o.xAxis[0].data,
                values:o.yAxis[0].data.map((_,row)=>cells.filter(c=>c[5]===row).sort((a,b)=>a[4]-b[4]).map(c=>c[3])),
                statistics:o.yAxis[0].data.map((_,row)=>stats.filter(c=>c[5]===row).sort((a,b)=>a[0]-b[0]).map(c=>c[3]))};
        });
        assert.deepEqual(actual.names,names); assert.deepEqual(actual.times,times.map(String));
        assert.deepEqual(actual.values,names.map(name=>values[name]));
        assert.deepEqual(actual.statistics,names.map(name=>{
            const valid=values[name].filter(v=>v!==null);
            return valid.length ? [Math.min(...valid),valid.reduce((a,b)=>a+b,0)/valid.length,Math.max(...valid)] : [null,null,null];
        }));
    }
    async function holdImport(panel) {
        let release,arrived;
        const gate=new Promise(r=>{release=r;releases.push(r);}), waiting=new Promise(r=>{arrived=r;});
        await page.route('**/api/temp/import',async route=>{
            const response=await route.fetch(); arrived(); await gate; await route.fulfill({response});
        },{times:1});
        await page.evaluate(({panel,template})=>{
            setActivePanel(panel); document.getElementById('template_name').value=template; ExportTemplate(false);
        },{panel,template});
        await waiting;
        return async () => {release();await idle();};
    }
    try {
        await page.goto(base+'/metricviewer'); await page.waitForFunction(()=>window.metricHeat);
        await load(1,primary.file); await mode(1,'heat');
        const start=requests.length;
        assert.equal(await page.evaluate(()=>metricHeat.plot(['traffic'],1)),true); await idle();
        assert.deepEqual(requests.slice(start),['/api/show/query']);
        const kept=(await selection(1))['Heatmap 1'];
        result.checks.push('Normal Heat Plot still makes its required query');
        await importTemplate(1);
        assert.deepEqual(await selection(1),{'Heatmap 1':kept,'Heatmap 1 (2)':groups['Heatmap 1'],Other:groups.Other});
        await verify(1,'Heatmap 1',['traffic'],primary.values);
        await verify(1,'Heatmap 1 (2)',groups['Heatmap 1'].Sig,primary.values);
        await verify(1,'Other',groups.Other.Sig,primary.values);
        result.checks.push('Import uses one request; collisions, order, previous Plot, settings, raw samples and statistics survive');
        await importTemplate(1);
        assert.deepEqual(Object.keys(await selection(1)),['Heatmap 1','Heatmap 1 (2)','Other','Heatmap 1 (3)','Other (2)']);
        result.checks.push('Repeated import retains all maps with distinct consecutive suffixes and no new queries');
        await mode(1,'line');
        const line=await page.evaluate(()=>myChart.getOption().series.map(s=>s.data));
        assert.deepEqual(line,[primary.values.traffic,...Object.values(groups).flatMap(g=>g.Sig.map(n=>primary.values[n])),
            ...Object.values(groups).flatMap(g=>g.Sig.map(n=>primary.values[n]))]);
        await mode(1,'heat');
        await verify(1,'Other (2)',groups.Other.Sig,primary.values);
        result.checks.push('Imported values survive Heat to Line and back, including all-null rows');
        await page.evaluate(()=>reloadFile()); await idle();
        await verify(1,'Heatmap 1 (3)',groups['Heatmap 1'].Sig,primary.values);
        result.checks.push('Imported and renamed groups remain compatible with Reload');
        await page.evaluate(()=>setSplitMode('horizontal')); await load(2,secondary.file); await mode(2,'heat');
        const primaryBefore=await selection(1), release=await holdImport(2);
        await page.evaluate(()=>setActivePanel(1));
        const beforeRelease=requests.length; await release();
        assert.deepEqual(requests.slice(beforeRelease),[]);
        assert.deepEqual(await selection(2),groups); assert.deepEqual(await selection(1),primaryBefore);
        await verify(2,'Heatmap 1',groups['Heatmap 1'].Sig,secondary.values);
        await verify(2,'Other',groups.Other.Sig,secondary.values);
        result.checks.push('An import completing after active-panel switch uses only its original panel and dataset');
        // Call the public append entry with frozen response data to check validation and Promise compatibility.
        await page.evaluate(()=>{ClearAll(1);setActivePanel(1);setSplitMode('single');}); await idle();
        const validationStart=requests.length;
        const validation=await page.evaluate(async ({values,count})=>{
            const data={Empty:{Sig:{}},Good:{Max:'dataMax',Stack:false,Sig:{traffic:values}},
                Short:{Sig:{traffic:[1]}},Text:{Sig:{traffic:Array(count).fill('bad')}},
                Infinite:{Sig:{traffic:Array(count).fill(Infinity)}}};
            Object.values(data).forEach(g=>{Object.values(g.Sig).forEach(Object.freeze);Object.freeze(g.Sig);Object.freeze(g);});
            Object.freeze(data);
            const promise=metricHeat.append(data,1);
            return {promise:typeof promise.then==='function',result:await promise};
        },{values:primary.values.traffic,count:times.length}); await idle();
        assert.deepEqual(validation,{promise:true,result:[false,true,false,false,false]});
        assert.deepEqual(requests.slice(validationStart),[]); assert.equal(await cards(1).count(),1);
        assert.deepEqual(Object.keys(await selection(1)),['Good']);
        assert.match(await page.locator('.heat-host[data-panel="1"] .heat-panel-status').innerText(),/Invalid numeric value/);
        await verify(1,'Good',['traffic'],primary.values);
        result.checks.push('Empty groups skip; malformed samples fail visibly per group without requerying or corrupting valid maps');
        result.checks.push('Append keeps its Promise result and accepts immutable response arrays without mutation');
        // Delay real API responses across existing dataset/clear epochs.
        for(const action of ['Clear','Load','Reload']) {
            const done=await holdImport(1);
            if(action==='Clear') await page.evaluate(()=>ClearAll(1));
            else if(action==='Load') await load(1,primary.file);
            else {await page.evaluate(()=>{setActivePanel(1);reloadFile();}); await page.waitForFunction(()=>!fileLoadBusy);}
            const expected=await selection(1), before=requests.length;
            await done(); assert.deepEqual(await selection(1),expected);
            assert.deepEqual(requests.slice(before),[]);
            result.checks.push(`Late import after ${action} is discarded by the existing epoch guard`);
        }
        await importTemplate(1); await verify(1,'Other',groups.Other.Sig,primary.values);
        result.checks.push('A fresh import still succeeds after stale responses were discarded');
        assert.deepEqual(result.errors,[]); assert.deepEqual(result.dialogs,[]);
        result.status='PASS'; await page.screenshot({path:path.join(output,'heat-import.png')});
    } catch(error) {
        result.status='FAIL';result.failure=error.stack;throw error;
    } finally {
        releases.forEach(release=>release());
        fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
        await browser.close();
    }
    console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
