/* Dedicated server; fixtures and receipts live in NEW_OUTPUT.
 * NODE_PATH=<existing Playwright> node scripts/test_metric_sample_reuse.cjs URL NEW_OUTPUT line|heat
 */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const [base,outputArg,mode='line']=process.argv.slice(2);
if(!base||!outputArg||!['line','heat'].includes(mode))throw Error('Usage: URL NEW_OUTPUT line|heat');
const output=path.resolve(outputArg);fs.mkdirSync(output,{recursive:false});
const count=24,result={mode,checks:[],queries:[],errors:[],dialogs:[],heatWindows:[]};
function fixture(name,offset=0,missing=[]) {
    const values=Object.fromEntries(Array.from({length:6},(_,m)=>['p'+m,
        Array.from({length:count},(_,s)=>m===5?null:m===4?(s===3?null:s/4):offset+m*1000+s)]));
    const csv=path.join(output,name+'.csv'),file=path.join(output,name+'.h5');
    fs.writeFileSync(csv,'sample,'+Array.from({length:count},(_,i)=>i).join(',')+'\nsamplePeriod,100\n'+
        Object.entries(values).filter(([name])=>!missing.includes(name)).map(([name,row])=>name+','+row.map(v=>v===null?'':v).join(',')).join('\n')+'\n');
    execFileSync('python3',['-B',path.join(__dirname,'csv2hdf.py'),'-i',csv,'-o',file],{stdio:'pipe'});
    return {file,values};
}
let primary=fixture('primary'),other=fixture('secondary',90000);
(async()=>{
    const browser=await chromium.launch({executablePath:process.env.HEAT_TEST_CHROME||'/usr/bin/google-chrome',
        headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:['--no-sandbox','--disable-dev-shm-usage']});
    // Keep all fixture samples visible in each split panel. The pre-existing
    // narrow-view scrollbar-gutter end-position defect is recorded separately.
    const page=await browser.newPage({viewport:{width:2400,height:1050}}),releases=[];
    page.on('pageerror',e=>result.errors.push(String(e)));
    page.on('dialog',async d=>{result.dialogs.push(d.message());await d.dismiss();});
    page.on('request',r=>{if(r.url().endsWith('/api/show/query'))result.queries.push(r.postDataJSON());});
    const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const idle=async()=>{await page.waitForFunction(()=>!fileLoadBusy&&$.active===0);await frames();};
    const cards=panel=>page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    async function load(panel,file) {
        await page.evaluate(({panel,file})=>requestServerFile(file,panel,false),{panel,file});
        await page.waitForFunction(()=>!fileLoadBusy);await frames();
    }
    async function selectMode(panel) {
        await page.evaluate(panel=>setActivePanel(panel),panel);
        await page.locator('#metricMode').selectOption(mode);await idle();
    }
    async function clear(panel=1) {await page.evaluate(panel=>ClearAll(panel),panel);await frames();}
    async function groups(panel=1) {return page.evaluate(({panel,mode})=>mode==='heat'?metricHeat.selection(panel):panel===2?MetricSelectList2:MetricSelectList,{panel,mode});}
    async function trigger(name,names,panel=1) {
        await page.evaluate(({name,names,panel})=>{
            setActivePanel(panel);const selected=panel===2?CurMetricSelectList2:CurMetricSelectList;
            selected.splice(0,selected.length,...names);document.getElementById('filterMetricGroup').value=name;MetricSelectSubmit();
        },{name,names,panel});
    }
    function queriedSince(start) {
        return result.queries.slice(start).map(q=>({secondary:!!q.secondary,names:Object.values(q.query).flatMap(g=>g.Sig)}));
    }
    async function plot(name,names,expected,panel=1) {
        const start=result.queries.length;await trigger(name,names,panel);await idle();
        assert.deepEqual(queriedSince(start),expected.length?[{secondary:panel===2,names:expected}]:[],name+' query scope');
        return Object.keys(await groups(panel)).at(-1);
    }
    async function verify(key,names,values,panel=1) {
        if(mode==='line') {
            const rows=await page.evaluate(({key,panel})=>getPanelChart(panel).getOption().series.filter(s=>s.name===key).map(s=>({name:s.id.slice(key.length+1),values:s.data})),{key,panel});
            assert.deepEqual(rows,names.map(name=>({name,values:values[name]})));
        } else {
            const index=await cards(panel).evaluateAll((nodes,key)=>nodes.findIndex(n=>n.dataset.group===key),key);
            assert(index>=0);const card=cards(panel).nth(index);await card.scrollIntoViewIfNeeded();await frames();
            const viewport=card.locator('.heat-viewport');
            const extent=await viewport.evaluate(el=>({old:el.scrollLeft,max:el.scrollWidth-el.clientWidth,step:Math.max(1,Math.floor(el.clientWidth*.75))}));
            const samples=names.map(()=>new Map());
            for(let left=0;;left=Math.min(extent.max,left+extent.step)) {
                await viewport.evaluate((el,left)=>{el.scrollLeft=left;},left);await frames();
                const rows=await card.evaluate(card=>{
                    const o=echarts.getInstanceByDom(card.querySelector('.heat-canvas')).getOption();
                    const cells=o.series.filter(s=>s.id==='heat-values'||s.id==='heat-missing').flatMap(s=>s.data);
                    return o.yAxis[0].data.map((name,row)=>({name,cells:cells.filter(c=>c[5]===row).map(c=>[c[4],c[3]])}));
                });
                result.heatWindows.push({panel,key,requestedLeft:left,extent,actual:await viewport.evaluate(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth,width:el.clientWidth})),
                    samples:rows.map(r=>r.cells.map(c=>c[0]))});
                assert.deepEqual(rows.map(r=>r.name),names);
                rows.forEach((row,i)=>row.cells.forEach(([sample,value])=>{
                    if(samples[i].has(sample))assert.equal(samples[i].get(sample),value);
                    samples[i].set(sample,value);
                }));
                if(left===extent.max)break;
            }
            await viewport.evaluate((el,left)=>{el.scrollLeft=left;},extent.old);await frames();
            samples.forEach((row,i)=>{
                const entries=[...row].sort((a,b)=>a[0]-b[0]);
                assert.deepEqual(entries.map(c=>c[0]),Array.from({length:count},(_,i)=>i));
                assert.deepEqual(entries.map(c=>c[1]),values[names[i]]);
            });
        }
    }
    async function remove(key,panel=1) {
        if(mode==='line') await page.evaluate(({key,panel})=>delete_metric_group(key,panel),{key,panel});
        else {
            while((await groups(panel))[key]) {
                const index=await cards(panel).evaluateAll((nodes,key)=>nodes.findIndex(n=>n.dataset.group===key),key);
                const card=cards(panel).nth(index);await card.scrollIntoViewIfNeeded();await frames();
                const point=await card.evaluate(card=>{
                    const dom=card.querySelector('.heat-canvas'),chart=echarts.getInstanceByDom(dom),rect=dom.getBoundingClientRect();
                    const xy=chart.convertToPixel({xAxisIndex:0,yAxisIndex:0},[0,0]);return {x:rect.x+xy[0],y:rect.y+xy[1]};
                });await page.mouse.click(point.x,point.y);await page.keyboard.press('Delete');await frames();
            }
        }
        await frames();
    }
    async function reload(panel=1,wait=true) {
        await page.evaluate(panel=>{setActivePanel(panel);reloadFile();},panel);
        await page.waitForFunction(()=>!fileLoadBusy);await frames();if(wait)await idle();
    }
    async function holdQuery() {
        let release,arrived;
        const gate=new Promise(r=>{release=r;releases.push(r);}),waiting=new Promise(r=>{arrived=r;});
        await page.route('**/api/show/query',async route=>{
            const response=await route.fetch();arrived();await gate;await route.fulfill({response});
        },{times:1});return {waiting,release:async()=>{release();await idle();}};
    }
    try {
        await page.goto(base+'/metricviewer');await page.waitForFunction(()=>window.metricHeat);
        await load(1,primary.file);await selectMode(1);
        const a=await plot('A',['p1','p0'],['p1','p0']);await verify(a,['p1','p0'],primary.values);
        result.checks.push('First Plot queries its complete selection');
        const b=await plot('B',['p0','p2','p1'],['p2']);await verify(b,['p0','p2','p1'],primary.values);
        result.checks.push('Partial overlap queries only the missing metric, retaining all values and selection order');
        const c=await plot('C',['p1','p0'],[]);await verify(c,['p1','p0'],primary.values);
        await verify(a,['p1','p0'],primary.values);
        result.checks.push('Fully repeated selection creates a new plot without a query or changing previous plots');
        await remove(a);
        const d=await plot('D',['p0'],[]);await verify(d,['p0'],primary.values);
        result.checks.push('Deleting one owner preserves reusable values still displayed by other groups');
        await clear();const e=await plot('E',['p3'],['p3']);await remove(e);
        const f=await plot('F',['p3'],['p3']);await verify(f,['p3'],primary.values);
        result.checks.push('Deleting the last owner releases reuse; the next Plot requests data again');
        await clear();const r=await plot('Reloaded',['p0','p1'],['p0','p1']);
        primary=fixture('primary',10000);await reload();await verify(r,['p0','p1'],primary.values);
        const s=await plot('AfterReload',['p1','p0'],[]);await verify(s,['p1','p0'],primary.values);
        result.checks.push('Same-path Reload replaces old reusable values with the new complete response');
        const saved=fs.readFileSync(primary.file);fs.writeFileSync(primary.file,'invalid H5');
        await reload();assert(result.dialogs.pop());fs.writeFileSync(primary.file,saved);
        const good=await plot('AfterFailedReload',['p0'],[]);await verify(good,['p0'],primary.values);
        result.checks.push('Failed Reload retains the valid dataset and its reusable values');
        // Both modes retain absent rows on Reload, but those placeholders are not queried data.
        primary=fixture('primary',11000,['p1']);await reload();assert(result.dialogs.pop().includes('p1'));
        const start=result.queries.length;await trigger('Absent',['p1']);await idle();
        assert.deepEqual(queriedSince(start),[{secondary:false,names:['p1']}]);
        if(mode==='heat')assert.match(await page.locator('.heat-host[data-panel="1"] .heat-panel-status').innerText(),/Metric not found/);
        result.checks.push('Reload missing-metric placeholders never bypass the ordinary query/error path');
        primary=fixture('primary',12000);await reload();
        const recovered=await plot('Recovered',['p1'],[]);await verify(recovered,['p1'],primary.values);
        result.checks.push('A metric restored by a later Reload becomes reusable with current values');
        primary=fixture('primary',20000);await load(1,primary.file);await idle();
        const changed=await plot('AfterLoad',['p0'],[]);await verify(changed,['p0'],primary.values);
        result.checks.push('Successful Load discards old arrays even when filename, metric names and sample count match');
        await page.evaluate(()=>setSplitMode('horizontal'));await load(2,other.file);await selectMode(2);
        const otherKey=await plot('Secondary',['p0'],['p0'],2);await verify(otherKey,['p0'],other.values,2);
        const otherAgain=await plot('SecondaryAgain',['p0'],[],2);await verify(otherAgain,['p0'],other.values,2);
        await verify(changed,['p0'],primary.values,1);
        result.checks.push('Panels never share values; each panel reuses only its own loaded dataset');
        await clear(1);await page.evaluate(()=>{setActivePanel(1);setSplitMode('single');});await idle();
        const source=await plot('Source',['p0'],['p0']);
        // Delay a genuinely new metric while a reused metric is captured from the old dataset.
        const held=await holdQuery();await trigger('Pending',['p0','p3']);await held.waiting;
        primary=fixture('primary',30000);await reload(1,false);await held.release();
        await verify(source,['p0'],primary.values);
        const pendingGroups=await groups();
        if(mode==='line')assert(!pendingGroups.Pending);
        else await verify(Object.keys(pendingGroups).at(-1),['p0','p3'],primary.values);
        const fresh=await plot('Fresh',['p0'],[]);await verify(fresh,['p0'],primary.values);
        result.checks.push('Late partial query cannot mix captured pre-Reload arrays into refreshed plots');
        // Fully reused work can also be invalidated in the same JavaScript turn.
        await page.evaluate(mode=>{
            if(mode==='heat')window.pendingReuse=metricHeat.plot(['p0'],1);
            else {CurMetricSelectList=['p0'];document.getElementById('filterMetricGroup').value='Discarded';MetricSelectSubmit();}
            ClearAll(1);
        },mode);await idle();assert.deepEqual(await groups(),{});
        const afterClear=await plot('AfterClear',['p0'],['p0']);await verify(afterClear,['p0'],primary.values);
        result.checks.push('Clear removes both plots and reusable values, including queued fully reused work');
        // A failed mixed request must never display just its reused subset.
        const preserved=await groups();
        await page.route('**/api/show/query',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:1,msg:'Injected query failure'})}),{times:1});
        await trigger('FailedMixed',['p0','p2']);await idle();assert.deepEqual(await groups(),preserved);
        if(mode==='line')assert.match(result.dialogs.pop(),/Failed to plot/);
        else assert.match(await page.locator('.heat-host[data-panel="1"] .heat-panel-status').innerText(),/Injected query failure/);
        const retry=await plot('Retry',['p2','p0'],['p2']);await verify(retry,['p2','p0'],primary.values);
        result.checks.push('A failed missing-metric request leaves existing plots intact; retry still queries missing values');
        if(mode==='heat') {
            const nulls=await plot('Nulls',['p4','p5'],['p4','p5']);await verify(nulls,['p4','p5'],primary.values);
            const repeated=await plot('NullsAgain',['p5','p4'],[]);await verify(repeated,['p5','p4'],primary.values);
            result.checks.push('Real all-null metrics remain reusable, distinct from absent-metric placeholders');
        }
        await page.locator('#metricMode').selectOption(mode==='heat'?'line':'heat');await idle();
        await page.locator('#metricMode').selectOption(mode);await idle();
        const roundtrip=await plot('Roundtrip',['p0'],[]);await verify(roundtrip,['p0'],primary.values);
        result.checks.push('Line/Heat round trip retains correct data and subsequent repeated Plot behavior');
        const templateFile=path.join(output,'reused-template.json');fs.writeFileSync(templateFile,JSON.stringify(await groups()));
        const template=path.relative(path.resolve(__dirname,'../dataviewer/static/data'),templateFile.slice(0,-5));
        await clear();await page.evaluate(template=>{
            document.getElementById('template_name').value=template;ExportTemplate(false);
        },template);await idle();
        const fromTemplate=await plot('TemplateValues',['p0'],[]);await verify(fromTemplate,['p0'],primary.values);
        result.checks.push('Template-imported samples are reusable by later Plot without another query');
        assert.deepEqual(result.errors,[]);assert.deepEqual(result.dialogs,[]);
        result.status='PASS';await page.screenshot({path:path.join(output,'reuse.png')});
    } catch(e) {result.status='FAIL';result.failure=e.stack;throw e;}
    finally {releases.forEach(r=>r());fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');await browser.close();}
    console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
