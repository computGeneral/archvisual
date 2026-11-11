/* Real large H5 search, keyboard selection and deferred Heat layout regression.
 * node scripts/test_metric_search_virtual.cjs URL REFERENCE_H5 LARGE_H5 OUTPUT
 * Keyboard-only regression with page-local names (no load/query requests):
 * node scripts/test_metric_search_virtual.cjs --keyboard-only URL OUTPUT
 */
'use strict';
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const keyboardOnly = process.argv[2] === '--keyboard-only';
const [base, reference, large, output] = keyboardOnly
    ? [process.argv[3], null, null, process.argv[4]] : process.argv.slice(2);
fs.mkdirSync(output, {recursive:false});
const checks = [], errors = [], dialogs = [];
(async () => {
    const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome', headless:true,
        args:['--no-sandbox', '--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:1500,height:850}});
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
    if (keyboardOnly) await page.route('**/*', route => {
        if (['GET', 'HEAD'].includes(route.request().method())) return route.continue();
        errors.push('Unexpected write request: ' + route.request().url());
        return route.abort();
    });
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
    async function keyboardSearchChecks() {
        const names = ['port0.traffic', 'port1.traffic', 'port0.active'];
        await page.evaluate(names => {
            MetricNames = names.slice();
            MetricNames2 = names.map(name => 'secondary.' + name);
            rebuildMetricSelectDiv();
            window.searchInputClicks = 0;
            document.getElementById('filterMetric').addEventListener('click', () => ++window.searchInputClicks);
        }, names);
        async function tabToInput() {
            for (let i = 0; i < 40; ++i) {
                if (await page.evaluate(() => document.activeElement.id === 'filterMetric')) return;
                await page.keyboard.press('Tab');
            }
            assert.fail('Tab did not reach Metric Name');
        }
        async function type(expression) {
            await page.keyboard.press('ControlOrMeta+A');
            if (expression) await page.keyboard.type(expression);
            else await page.keyboard.press('Backspace');
        }
        const state = () => page.evaluate(() => ({
            visible: document.getElementById('MetricSelectDiv').getClientRects().length > 0,
            selected: (activePanel === 2 ? CurMetricSelectList2 : CurMetricSelectList).slice(),
            group: document.getElementById('filterMetricGroup').value,
            focus: document.activeElement.id
        }));
        for (const split of ['single', 'horizontal', 'vertical']) {
            await page.evaluate(split => setSplitMode(split), split);
            for (const panel of split === 'single' ? [1] : [1, 2]) {
                for (const mode of ['line', 'heat']) {
                    await page.evaluate(panel => setActivePanel(panel), panel);
                    await page.locator('#metricMode').selectOption(mode);
                    const otherSelection = await selected(panel === 1 ? 2 : 1);
                    // Close outside the popup, then use Tab rather than clicking/focusing Metric Name.
                    await page.locator('#sample_rate').click();
                    await page.mouse.move(1450, 800);
                    await tabToInput();
                    const before = await state();
                    assert.equal(before.visible, false);
                    const expression = panel === 1 ? '^PORT[0-9]+ TRAFFIC$' : '^SECONDARY PORT[0-9]+ TRAFFIC$';
                    await type(expression);
                    assert.deepEqual(await state(), before, 'typing alone must not submit');
                    // Synthetic IME flags cover the handler guard, not an OS input-method session.
                    for (const init of [{key:'Enter', keyCode:13, isComposing:true}, {key:'Enter', keyCode:229}]) {
                        assert.equal(await page.locator('#filterMetric').evaluate((input, init) => {
                            const event = new KeyboardEvent('keydown', {...init, bubbles:true, cancelable:true});
                            input.dispatchEvent(event);
                            return event.defaultPrevented;
                        }, init), false);
                        assert.deepEqual(await state(), before, 'IME confirmation must not submit');
                    }
                    await page.keyboard.press('Enter'); await settle();
                    const matches = names.slice(0, 2).map(name => panel === 2 ? 'secondary.' + name : name);
                    assert.deepEqual(await state(), {visible:true, selected:matches, group:expression, focus:'filterMetric'});
                    assert.equal(await count(), 2);
                    assert.deepEqual(await selected(panel === 1 ? 2 : 1), otherSelection);
                    assert.equal(await page.evaluate(() => searchInputClicks), 0);
                    checks.push(`${split}, panel ${panel}, ${mode}: Tab/type/Enter opens results, keeps focus and selection isolated; IME ignored`);
                }
            }
        }
        // Check Enter identification independently of native Chrome keyCode behavior.
        for (const init of [{key:'Enter', keyCode:0}, {key:'', keyCode:13}]) {
            await page.locator('#sample_rate').click(); await tabToInput();
            await type('^secondary\\.port0\\.active$');
            assert.equal(await page.locator('#filterMetric').evaluate((input, init) => {
                const event = new KeyboardEvent('keydown', {...init, bubbles:true, cancelable:true});
                input.dispatchEvent(event);
                return event.defaultPrevented;
            }, init), true);
            await settle();
            assert.equal((await state()).visible, true);
            assert.equal((await state()).focus, 'filterMetric');
            assert.deepEqual(await selected(2), ['secondary.port0.active']);
        }
        await type('^NO_SUCH_METRIC$'); await page.keyboard.press('Enter'); await settle();
        assert.equal(await count(), 0); assert.deepEqual(await selected(2), []);
        await type(''); await page.keyboard.press('Enter'); await settle();
        assert.equal(await count(), 0); assert.deepEqual(await selected(2), []);
        assert.equal((await state()).focus, 'filterMetric');
        checks.push('key-only and legacy Enter prevent default and reopen; no-match/empty searches clear selection without losing focus');
        await page.locator('#sample_rate').click();
        await page.keyboard.press('Enter'); await settle();
        assert.equal((await state()).visible, false, 'Enter outside Metric Name must not open results');
        await page.locator('#filterMetric').click();
        assert.equal((await state()).visible, true, 'mouse opening remains available');
        checks.push('Enter in another input does not search; mouse click still opens results');
    }
    try {
        await page.goto(base+'/metricviewer');
        await keyboardSearchChecks();
        if (keyboardOnly) {
            assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
            fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'PASS',checks,errors,dialogs,
                browser:browser.version(), scope:'Page-local names, no H5 load or Plot; IME flags are synthetic',
                searchHandler:await page.evaluate(() => MetricSearchFunc.toString())},null,2));
            return;
        }
        await page.reload();
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
