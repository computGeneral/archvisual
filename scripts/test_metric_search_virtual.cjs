/* Real large H5 search, keyboard selection and deferred Heat layout regression.
 * node scripts/test_metric_search_virtual.cjs URL REFERENCE_H5 LARGE_H5 OUTPUT
 */
'use strict';
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [base, reference, large, output] = process.argv.slice(2);
fs.mkdirSync(output, {recursive:false});
const checks = [], errors = [], dialogs = [];
(async () => {
    const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome', headless:true,
        args:['--no-sandbox', '--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:1500,height:850}});
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    async function load(file, panel=1, reload=false) {
        await page.evaluate(({file,panel,reload}) => { setActivePanel(panel); requestServerFile(file,panel,reload); }, {file,panel,reload});
        await page.waitForFunction(() => !fileLoadBusy && $.active === 0); await settle();
    }
    async function search(text) {
        await page.locator('#filterMetric').click(); await page.locator('#filterMetric').fill(text);
        await page.locator('#filterMetric').press('Enter'); await settle();
    }
    const selected = panel => page.evaluate(p => (p === 2 ? CurMetricSelectList2 : CurMetricSelectList).slice(), panel || 1);
    const count = () => page.locator('[name="MetricCheckBox"]').count();
    const scroll = async bottom => {
        await page.locator('#MetricSelectResults').evaluate((el,b) => { el.scrollTop = b ? el.scrollHeight : 0; },bottom);
        await settle();
    };
    try {
        await page.goto(base+'/metricviewer');
        // getTextRect is only counted when called by Heat's axisTop, excluding
        // ECharts' own label rendering, legends and the actual visible Heat axes.
        await page.evaluate(() => {
            window.heatLabelMeasures = 0;
            const original = echarts.format.getTextRect;
            // ECharts freezes the format object; its exported binding is writable.
            echarts.format = Object.assign({},echarts.format,{getTextRect:function (...args) {
                if ((new Error().stack || '').includes('axisTop')) ++window.heatLabelMeasures;
                return original.apply(this,args);
            }});
        });
        await load(reference);
        assert.equal(await count(),0);
        assert.equal(await page.evaluate(() => heatLabelMeasures),0);
        const names = await page.evaluate(() => MetricNames.slice());
        assert.equal(names.length,56997);
        await search('.');
        assert.deepEqual(await selected(),names);
        assert(await count() < 60);
        await page.locator('[name="MetricCheckBox"]').first().uncheck();
        await scroll(true);
        const last = page.locator('[name="MetricCheckBox"]').last();
        assert.equal(await last.inputValue(),names.at(-1));
        await last.uncheck(); await scroll(false);
        assert.equal(await page.locator('[name="MetricCheckBox"]').first().isChecked(),false);
        assert.equal((await selected()).length,names.length-2);
        checks.push('56,997 metrics selected independently of fewer than 60 DOM rows; first/last deselection survives scrolling');
        await page.locator('[name="MetricSelectAllBox"]').uncheck();
        assert.equal((await selected()).length,0);
        await page.locator('[name="MetricSelectAllBox"]').check();
        assert.deepEqual(await selected(),names);
        await page.locator('[name="MetricSelectAllBox"]').focus();
        for (let i=0;i<55;i++) await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.value),names[54]);
        await page.keyboard.press('Space');
        assert(!(await selected()).includes(names[54]));
        await scroll(true);
        assert.equal(await page.evaluate(() => document.activeElement.value),names[54]);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.value),names[55]);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.value),names[54]);
        checks.push('SelectAll includes unmounted results; Tab/Shift+Tab and Space cross virtual windows and retain offscreen focus');
        await search('spc0 sm');
        const matches = names.filter(n=>/spc0.*sm/i.test(n));
        assert.deepEqual(await selected(),matches);
        await search('^NO_SUCH_METRIC_98765$'); assert.equal(await count(),0); assert.equal((await selected()).length,0);
        await search(''); assert.equal(await count(),0);
        await search('^'+names[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$');
        await page.locator('#MetricSelectDiv').evaluate(el=>{el.style.width='240px';}); await settle();
        assert(await page.locator('#MetricSelectResults').evaluate(el=>el.scrollWidth <= el.clientWidth + 1),
            'short names must not retain the previous 800px popup width');
        await page.mouse.click(1450,800); await page.locator('#filterMetric').click();
        assert.deepEqual(await selected(),[names[0]]);
        await page.getByRole('button',{name:'Plot',exact:true}).click();
        await page.waitForFunction(()=>$.active===0 && myChart.getOption().series.length===1);
        assert.equal((await selected()).length,0); assert.equal(await count(),0);
        checks.push('case-insensitive regex/space matching, empty results, reopen and real Line Plot preserve selection semantics');
        await page.evaluate(()=>{ ClearAll(); setSplitMode('horizontal'); });
        await load(large,2);
        const secondaryNames = await page.evaluate(()=>MetricNames2.slice());
        assert.equal(secondaryNames.length,10000);
        await search('^'+secondaryNames[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$');
        await page.evaluate(()=>setActivePanel(1));
        assert.equal(await count(),0); assert.equal((await selected()).length,0);
        await search('^'+names[2].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$');
        await page.evaluate(()=>setActivePanel(2));
        assert.deepEqual(await selected(2),[secondaryNames[1]]);
        await load(large,2,true);
        assert.deepEqual(await selected(2),[secondaryNames[1]]);
        assert.equal(await count(),0);
        assert.equal(await page.evaluate(()=>heatLabelMeasures),0);
        checks.push('two panels and Reload isolate pending selection; all Line loads/reloads perform zero Heat label measurements');
        await page.locator('#metricMode').selectOption('heat');
        await page.evaluate(names=>metricHeat.plot(names,2),secondaryNames.slice(0,2)); await settle();
        assert.equal(await page.evaluate(()=>heatLabelMeasures),10000);
        const firstTop = await page.evaluate(()=>{
            const node=document.querySelector('.heat-host[data-panel="2"] .heat-canvas');
            return echarts.getInstanceByDom(node).getOption().grid[0].top;
        });
        await load(large,2,true);
        assert.equal(await page.evaluate(()=>heatLabelMeasures),10000);
        await page.locator('#metricMode').selectOption('line'); await settle();
        await page.locator('#metricMode').selectOption('heat');
        await page.waitForFunction(()=>$.active===0); await settle();
        assert.equal(await page.evaluate(()=>heatLabelMeasures),10000);
        assert.equal(await page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('.heat-host[data-panel="2"] .heat-canvas')).getOption().grid[0].top),firstTop);
        await load(reference,2);
        assert.equal(await page.evaluate(()=>heatLabelMeasures),10015);
        checks.push('first Heat plot measures once; same-axis Reload and mode toggles reuse layout; changed axis recomputes');
        const axisFixture = path.resolve(output,'axis.csv');
        function writeAxis(start,offset=0) {
            fs.writeFileSync(axisFixture, ', '+Array.from({length:31},(_,i)=>start+i).join(',')+'\n'+
                'samplePeriod,100\n'+secondaryNames.slice(0,2).map((n,j)=>n+','+
                    Array.from({length:31},(_,i)=>i+j+offset).join(',')).join('\n')+'\n');
        }
        const top = () => page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('.heat-host[data-panel="2"] .heat-canvas')).getOption().grid[0].top);
        writeAxis(1); await load(axisFixture,2); const shortTop=await top();
        assert.equal(await page.evaluate(()=>heatLabelMeasures),10046);
        writeAxis(1,100); await load(axisFixture,2,true);
        assert.equal(await page.evaluate(()=>heatLabelMeasures),10046);
        writeAxis(1000000000000,200); await load(axisFixture,2,true);
        assert.equal(await page.evaluate(()=>heatLabelMeasures),10077);
        assert(await top()>shortTop);
        checks.push('value-only CSV Reload reuses layout; same-length changed labels recompute and increase the top margin');
        await page.screenshot({path:path.join(output,'split-heat.png')});
        assert.deepEqual(errors,[]); assert.deepEqual(dialogs,[]);
        fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'PASS',checks,errors,dialogs},null,2));
    } catch(error) {
        fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'FAIL',checks,errors,dialogs,failure:error.stack},null,2));
        await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); throw error;
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
