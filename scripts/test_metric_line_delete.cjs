/* Group deletion against real CSV data and the production page/API.
 * NODE_PATH=<existing Playwright> node scripts/test_metric_line_delete.cjs URL NEW_OUTPUT
 * An external diagnostic may set METRIC_LINE_RENDERER=svg before initialization.
 */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const [base,outputArg]=process.argv.slice(2);
if(!base || !outputArg)throw Error('Usage: URL NEW_OUTPUT');
const output=path.resolve(outputArg),renderer=process.env.METRIC_LINE_RENDERER||'canvas';
fs.mkdirSync(output,{recursive:false});
const file=path.join(output,'groups.csv');
fs.writeFileSync(file,'sample,'+Array.from({length:200},(_,i)=>i).join(',')+'\nsamplePeriod,100\n'+
    Array.from({length:8},(_,m)=>'port'+m+','+Array.from({length:200},(_,i)=>m*1000+i).join(',')).join('\n')+'\n');
const result={renderer,checks:[],errors:[],dialogs:[]};
(async()=>{
    const browser=await chromium.launch({executablePath:process.env.METRIC_LINE_CHROME||'/usr/bin/google-chrome',
        headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:1500,height:850}});page.setDefaultTimeout(30000);
    page.on('pageerror',e=>result.errors.push(String(e)));page.on('dialog',async d=>{result.dialogs.push(d.message());await d.dismiss();});
    const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const idle=async()=>{await page.waitForFunction(()=>!fileLoadBusy&&$.active===0);await frames();};
    const state=panel=>page.evaluate(panel=>{
        const chart=getPanelChart(panel),o=chart.getOption();
        // ECharts' marker initialization copies label.show to emphasis.label.show
        // when omitted. Compare that effective default as well as all explicit
        // marker fields, without treating its later serialization as a change.
        const markerStyle=mark=>{
            if(!mark)return mark;
            const copy=structuredClone(mark);
            for(const item of copy.data||[]){
                if(item.label&&Object.hasOwn(item.label,'show')){
                    item.emphasis??={};item.emphasis.label??={};
                    if(!Object.hasOwn(item.emphasis.label,'show'))item.emphasis.label.show=item.label.show;
                }
            }
            return copy;
        };
        return {groups:panel===2?MetricSelectList2:MetricSelectList,grid:o.grid.map(g=>({id:g.id,top:g.top,height:g.height})),
            axes:['xAxis','yAxis'].map(key=>o[key].map(a=>({id:a.id,grid:a.gridIndex,data:a.data,min:a.min,max:a.max,
                labelColor:typeof a.axisLabel.color==='function'?a.axisLabel.color('',40):a.axisLabel.color}))),
            series:o.series.map(s=>({id:s.id,name:s.name,data:s.data,x:s.xAxisIndex,y:s.yAxisIndex,smooth:s.smooth,
                stack:s.stack,line:s.lineStyle,area:s.areaStyle,symbol:s.symbol,symbolSize:s.symbolSize,markLine:markerStyle(s.markLine)})),
            zoom:o.dataZoom.map(z=>({axes:z.xAxisIndex,range:[z.start,z.end,z.startValue,z.endValue]})),
            legend:o.legend.map(l=>({selected:l.selected,scroll:l.scrollDataIndex,orient:l.orient})),
            markers:markerPositions[panel],pins:(pinnedCards[panel]||[]).map(p=>({id:p.id,index:p.dataIndex,text:p.cardEl.textContent})),
            zoomSelectActive:o.toolbox[0].feature.dataZoom.iconStatus.zoom,
            zoomBackStatus:o.toolbox[0].feature.dataZoom.iconStatus.back,
            dimensions:[chart.getWidth(),chart.getHeight()],renderer:chart.getZr().painter.getType()};
    },panel);
    async function plot(panel,query){
        await page.evaluate(async({panel,query})=>{
            const response=await fetch('/api/show/query',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({query,secondary:panel===2})}).then(r=>r.json());
            if(response.code)throw Error(response.msg);append_metrics(response.data,panel);
        },{panel,query});await frames();
    }
    const group=(Sig,Stack=false,Max=null)=>({Sig,Stack,Max});
    function assertLayout(s,names){
        assert.deepEqual(s.grid.map(g=>g.id),names);
        assert.deepEqual(Object.keys(s.groups),names);
        for(let i=0;i<names.length;i++){
            assert.equal(s.grid[i].top,20+90*i);
            for(const axes of s.axes){assert.equal(axes[i].id,names[i]);assert.equal(axes[i].grid,i);}
        }
        for(const series of s.series){assert.equal(s.grid[series.x].id,series.name);assert.equal(s.grid[series.y].id,series.name);}
        for(const z of s.zoom)assert.deepEqual(Array.from(new Set(z.axes)),names.map((_,i)=>i));
        assert.equal(s.renderer,renderer);
    }
    const withoutIndices=s=>{const {x,y,...rest}=s;return rest;};
    async function remove(panel,name,label){
        const before=await state(panel),other=await state(3-panel);
        await page.evaluate(({panel,name})=>{
            const chart=getPanelChart(panel),rendered=[],sync=window.SyncToTraceView;
            const record=()=>rendered.push(chart.getOption().grid.map(g=>g.id));
            window.deletionProbe={rendered,syncCalls:0,stop(){chart.off('rendered',record);window.SyncToTraceView=sync;}};
            window.SyncToTraceView=function(...args){window.deletionProbe.syncCalls++;return sync.apply(this,args);};
            chart.on('rendered',record);delete_metric_group(name,panel);
        },{panel,name});await frames();
        const after=await state(panel),survivors=before.grid.map(g=>g.id).filter(id=>id!==name);
        const probe=await page.evaluate(()=>{deletionProbe.stop();return {rendered:deletionProbe.rendered,syncCalls:deletionProbe.syncCalls};});
        assert.equal(probe.syncCalls,0,'Deletion must not broadcast a new Trace range');
        assert.ok(probe.rendered.length>0,'Deletion must render');
        for(const ids of probe.rendered)assert.deepEqual(ids,survivors,'No intermediate empty chart frame');
        assertLayout(after,survivors);
        assert.deepEqual(after.series.map(withoutIndices),before.series.filter(s=>s.name!==name).map(withoutIndices));
        for(let axis=0;axis<2;axis++)assert.deepEqual(after.axes[axis].map(({grid,...a})=>a),
            before.axes[axis].filter(a=>a.id!==name).map(({grid,...a})=>a));
        assert.deepEqual(after.zoom.map(z=>z.range),before.zoom.map(z=>z.range));
        const legend=structuredClone(before.legend);for(const l of legend)delete l.selected[name];
        assert.deepEqual(after.legend,legend);
        assert.deepEqual(after.markers,before.markers);assert.deepEqual(after.pins,before.pins);
        assert.equal(after.zoomSelectActive,before.zoomSelectActive);
        assert.equal(after.zoomBackStatus,before.zoomBackStatus);
        assert.deepEqual(await state(3-panel),other);
        result.checks.push(label+': dense axes, exact values/styles/zoom/legend/markers/pins; other panel unchanged');
    }
    try{
        await page.goto(base+'/metricviewer');await page.waitForFunction(()=>window.metricHeat);
        await page.evaluate(()=>setSplitMode('horizontal'));await frames();
        for(const panel of [1,2]){
            await page.evaluate(({file,panel})=>requestServerFile(file,panel,false),{file,panel});await idle();
            await plot(panel,{A:group(['port0']),B:group(['port1','port2']),C:group(['port3','port4'],true,9000),D:group(['port5'])});
            assertLayout(await state(panel),['A','B','C','D']);
            await page.evaluate(panel=>{
                const chart=getPanelChart(panel);
                chart.dispatchAction({type:'dataZoom',startValue:20,endValue:150,disable_propagation:true});
                chart.dispatchAction({type:'legendUnSelect',name:'D'});
                if(panel===2)chart.dispatchAction({type:'takeGlobalCursor',key:'dataZoomSelect',dataZoomSelectActive:false});
                pinSnapshot(panel,buildSnapshotForSample(panel,40,'C'));
            },panel);await frames();
        }
        const preBrush=(await state(1)).zoom.map(z=>z.range);
        const brushBox=await page.locator('#container').boundingBox();
        await page.mouse.move(brushBox.x+brushBox.width*.3,brushBox.y+40);await page.mouse.down();
        await page.mouse.move(brushBox.x+brushBox.width*.6,brushBox.y+70,{steps:8});await page.mouse.up();await frames();
        assert.equal((await state(1)).zoomBackStatus,'emphasis');
        await remove(1,'B','Primary middle group with two series');
        // Default toolbox: zoom, zoom-back, data view; click the real back icon.
        await page.mouse.click(brushBox.x+brushBox.width-38,brushBox.y+15);await frames();
        assert.deepEqual((await state(1)).zoom.map(z=>z.range),preBrush);
        result.checks.push('Zoom-back after deletion restores the pre-brush range');
        await remove(2,'A','Secondary first group');
        await remove(2,'C','Secondary middle stacked group');
        await remove(2,'D','Secondary last hidden group');
        await remove(2,'B','Secondary final group');
        const empty=await state(2);
        await page.evaluate(()=>delete_metric_group('B',2));await frames();
        assert.deepEqual(await state(2),empty);result.checks.push('Repeated Delete of absent/final group is a no-op');
        await plot(2,{Again:group(['port6','port7'])});assertLayout(await state(2),['Again']);
        result.checks.push('Plot after deleting the final group starts at grid zero');
        await plot(1,{B:group(['port1','port2'])});assertLayout(await state(1),['A','C','D','B']);
        await plot(1,{C:group(['port7'])});assert.equal((await state(1)).series.filter(s=>s.name==='C').length,3);
        result.checks.push('Re-add a deleted name and append to a surviving stacked group');
        const beforeReload=await state(1);
        await page.evaluate(()=>{setActivePanel(1);reloadFile();});await idle();
        assert.deepEqual(await state(1),beforeReload);
        result.checks.push('Reload after compaction preserves all remaining/re-added groups and state');
        await page.evaluate(()=>{setSplitMode('single');setActivePanel(1);currentHoverSnapshot[1]=null;});await frames();
        const point=await page.evaluate(()=>({x:dom.getBoundingClientRect().left+myChart.convertToPixel({xAxisIndex:1},70),
            y:dom.getBoundingClientRect().top+myChart.getOption().grid[1].top+35}));
        await page.mouse.move(point.x,point.y);await page.waitForFunction(()=>currentHoverSnapshot[1]&&currentHoverSnapshot[1].dataIndex===70);
        assert.equal(await page.evaluate(()=>currentHoverSnapshot[1].values.port3.value),3070);
        await page.mouse.dblclick(point.x,point.y);await page.waitForFunction(()=>pinnedCards[1].length===2);
        result.checks.push('Surviving group still receives exact hover and double-click pin events');
        const beforeZoom=(await state(1)).zoom;
        const bounds=await page.locator('#container').boundingBox();
        await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+40);await page.mouse.down();
        await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+70,{steps:8});await page.mouse.up();await frames();
        assert.notDeepEqual((await state(1)).zoom,beforeZoom);
        result.checks.push('Mouse rectangle zoom remains active after deletion');
        await page.evaluate(()=>{lastClickedTarget.name='A';lastClickedTarget.type='series';document.activeElement.blur();});
        await page.keyboard.press('Delete');await frames();assertLayout(await state(1),['C','D','B']);
        result.checks.push('Actual Delete keyboard event removes the selected first group');
        await page.locator('#metricMode').selectOption('heat');await idle();
        await page.waitForFunction(()=>document.querySelectorAll('.heat-map').length===3);
        await page.locator('#metricMode').selectOption('line');await idle();assertLayout(await state(1),['C','D','B']);
        result.checks.push('Line/Heat round trip after deletion has no stale group');
        for(const name of ['D','C','B'])await remove(1,name,'Continuous delete '+name);
        assert.equal((await state(1)).series.length,0);
        await plot(1,{Fresh:group(['port0'])});assertLayout(await state(1),['Fresh']);
        await page.evaluate(()=>ClearAll());await frames();assert.equal((await state(1)).series.length,0);
        result.checks.push('Fresh Plot and Clear work after continuous middle/first/final deletion');
        assert.deepEqual(result.errors,[]);assert.deepEqual(result.dialogs,[]);
        result.status='PASS';console.log(`PASS: ${result.checks.length} group deletion checks (${renderer})`);
    }catch(error){result.status='FAIL';result.failure=error.stack;
        await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;
    }finally{fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
