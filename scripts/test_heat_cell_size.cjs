/* Real CSV/H5, production API and browser checks for panel-local Heat cell size.
 * NODE_PATH=<existing Playwright> node scripts/test_heat_cell_size.cjs URL NEW_OUTPUT
 * Use a dedicated server: this test loads both process-wide dataset slots.
 */
'use strict';
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {observeHeat} = require('./heat_test_support.cjs');
const [base, outputArg] = process.argv.slice(2);
assert(base && outputArg, 'Usage: URL NEW_OUTPUT');
const output = path.resolve(outputArg); fs.mkdirSync(output, {recursive:false});
const count = 400, metricNames = Array.from({length:80}, (_, i) => 'port' + i);
function fixture(name, offset) {
    const file = path.join(output, name + '.csv');
    fs.writeFileSync(file, 'sample,' + Array.from({length:count}, (_, i) => i).join(',') + '\nsamplePeriod,100\n' +
        metricNames.map((name, row) => name + ',' + Array.from({length:count}, (_, sample) => offset + row * 1000 + sample).join(',')).join('\n') + '\n');
    return file;
}
const csv = fixture('cell-size', 0), otherCsv = fixture('cell-size-offset', 500000), h5 = path.join(output, 'cell-size-offset.h5');
execFileSync('python3', ['-B', path.join(__dirname, 'csv2hdf.py'), '-i', otherCsv, '-o', h5], {stdio:'pipe'});
const result = {checks:[], errors:[], dialogs:[], snapshots:[], queryCount:0};
(async () => {
    const browser = await chromium.launch({executablePath:process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome',
        headless:true, ignoreDefaultArgs:['--hide-scrollbars'], args:['--no-sandbox','--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:1500, height:1000}});
    page.setDefaultTimeout(30000); await observeHeat(page);
    page.on('pageerror', error => result.errors.push(String(error)));
    page.on('dialog', async dialog => {result.dialogs.push(dialog.message()); await dialog.dismiss();});
    page.on('request', request => {if (new URL(request.url()).pathname === '/api/show/query') ++result.queryCount;});
    const cards = panel => page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const idle = async () => {await page.waitForFunction(() => !fileLoadBusy && $.active === 0); await frames();};
    async function load(file, panel = 1) {
        await page.evaluate(({file,panel}) => {setActivePanel(panel); requestServerFile(file,panel,false);}, {file,panel}); await idle();
    }
    async function mode(value, panel = 1) {
        await page.evaluate(panel => setActivePanel(panel), panel);
        await page.locator('#metricMode').selectOption(value); await idle();
    }
    async function plot(names, panel = 1) {
        assert(await page.evaluate(({names,panel}) => metricHeat.plot(names,panel), {names,panel})); await idle();
    }
    async function setSize(size, panel = 1, index = 0) {
        const control = cards(panel).nth(index).locator('[name="heatCellSize"]');
        await control.scrollIntoViewIfNeeded(); await control.selectOption(String(size)); await frames();
    }
    async function controls(panel, expected) {
        const actual = await cards(panel).evaluateAll(cards => cards.map(card => ({
            value:card.querySelector('[name="heatCellSize"]').value,
            options:Array.from(card.querySelector('[name="heatCellSize"]').options).map(o => o.value),
            widths:Array.from(card.querySelectorAll('.heat-toolbar select,.heat-toolbar input')).map(el => el.getBoundingClientRect().width)
        })));
        assert(actual.length > 0);
        for (const control of actual) {
            assert.equal(control.value, String(expected)); assert.deepEqual(control.options, ['16','8']);
            assert(control.widths.every(width => width === 100), 'All right-sidebar inputs/selects remain 100 CSS px');
        }
    }
    async function inspect(label, size, panel = 1, index = 0, offset = 0, identities = '') {
        await cards(panel).nth(index).scrollIntoViewIfNeeded(); await frames();
        const state = await cards(panel).nth(index).evaluate((card, {offset,identities}) => {
            const host = card.querySelector('.heat-canvas'), frame = heatTestFrame(host), chart = heatTestChart(host), o = chart.getOption();
            if (!frame) throw Error('Expected a visible real Canvas frame');
            const labels = [], axisView = chart.getViewOfComponentModel(chart.getModel().getComponent('yAxis',0));
            axisView.group.traverse(el => {
                if (el.type === 'text' && !el.ignore && !el.invisible && /^port\d+$/.test(el.style.text)) labels.push(el.style.text);
            });
            const key = card.closest('.heat-host').dataset.panel + ':' + card.dataset.group;
            window.cellSizeArrayReferences ||= new Map();
            if (identities === 'save') cellSizeArrayReferences.set(key, new Map(frame.rows.map(row => [row.name,row.values])));
            const saved = cellSizeArrayReferences.get(key);
            const wrong = frame.rows.filter(row => {
                const start = offset + Number(row.name.slice(4)) * 1000;
                return row.values.length !== 400 || row.values.some((value,i) => value !== start+i) ||
                    row.min !== start || row.max !== start+399 || row.avg !== start+199.5;
            }).map(row => row.name);
            return {key:card.dataset.group, rowHeight:frame.bandHeight, width:frame.columnWidth,
                statisticsWidth:o.grid[1].width, statisticsRowHeight:o.grid[1].height/o.yAxis[0].data.length,
                first:frame.firstCol, last:frame.lastCol, totalRows:frame.rows.length, names:o.yAxis[0].data, labels,
                valuesUnchanged:!identities || identities === 'save' || !!saved && frame.rows.every(row => saved.get(row.name) === row.values),
                area:chart.getWidth()-o.grid[0].left-(20+8+o.grid[1].width), wrong};
        }, {offset,identities});
        assert.equal(state.rowHeight,size); assert.equal(state.statisticsWidth,size*3); assert.equal(state.statisticsRowHeight,size);
        assert(state.width >= 1 && state.width <= size); assert.deepEqual(state.wrong,[]); assert(state.valuesUnchanged);
        if (size === 16) assert.deepEqual([...state.labels].sort(), [...state.names].sort(), '16px displays every visible metric name');
        result.snapshots.push({label,panel,index,size,...state}); return state;
    }
    async function wheel(delta, panel = 1) {
        await cards(panel).first().scrollIntoViewIfNeeded(); await frames();
        const point = await cards(panel).first().evaluate(card => {
            const host = card.querySelector('.heat-canvas'), f = heatTestFrame(host), r = host.getBoundingClientRect();
            return {x:r.left+f.x[1],y:r.top+f.y[0]};
        });
        await page.mouse.move(point.x,point.y); await page.keyboard.down('Control');
        await page.mouse.wheel(0,delta); await page.keyboard.up('Control'); await frames();
    }
    async function reload(panel = 1) {
        await page.evaluate(panel => {setActivePanel(panel); reloadFile();},panel); await idle();
    }
    try {
        await page.goto(base+'/metricviewer'); await page.waitForFunction(() => window.metricHeat);
        await load(csv); await mode('heat');
        await plot(metricNames.slice(0,60)); await plot(['port1','port2','port3']); await plot(['port4']);
        await controls(1,16);
        for (let i=0;i<3;++i) assert.equal((await inspect('default 16px',16,1,i,0,'save')).width,16);
        result.checks.push('Fresh page defaults to 16px samples/rows/statistics; all visible metric names render and all sidebar controls are 100px wide');
        const queries = result.queryCount;
        await setSize(8,1,1); await controls(1,8);
        for (let i=0;i<3;++i) assert.equal((await inspect('linked 8px',8,1,i,0,'compare')).width,8);
        assert.equal(result.queryCount,queries,'Cell size must not query samples again');
        result.checks.push('Changing a nonfirst map to 8px updates all maps without a query, sample-array copies, value changes or statistic changes');
        const dense = await inspect('8px metric labels',8);
        assert.equal(dense.totalRows,60); assert(dense.labels.length < dense.names.length,'8px metric labels remain automatically sparse');
        const omitted = dense.names.find(name => !dense.labels.includes(name)); assert(omitted);
        const point = await cards(1).first().evaluate((card,name) => {
            const host=card.querySelector('.heat-canvas'), chart=heatTestChart(host), o=chart.getOption(), r=host.getBoundingClientRect();
            const row=o.yAxis[0].data.indexOf(name), xy=chart.convertToPixel({seriesIndex:0},[1,row]);
            return {x:r.left+xy[0],y:r.top+xy[1],raw:Number(name.slice(4))*1000+Number(o.xAxis[0].data[1])};
        },omitted);
        await page.mouse.move(point.x,point.y); await frames();
        const tooltip=await cards(1).first().locator('.heat-sample-tooltip').innerText();
        assert(tooltip.includes(omitted)&&tooltip.includes('Raw value: '+point.raw));
        result.checks.push('8px retains all metric data and exact pointer hits even for a row whose axis label is omitted');
        for(let i=0;i<8;++i) await plot(['port'+(i+10)]);
        await controls(1,8); const lastIndex=(await cards(1).count())-1;
        assert.equal((await inspect('new initially offscreen map',8,1,lastIndex)).width,8);
        const beforeSwitch=result.queryCount;
        await setSize(16,1,lastIndex); await controls(1,16);
        assert.equal((await inspect('offscreen map switches panel to16',16,1,lastIndex)).width,16);
        assert.equal((await inspect('old first map follows16',16)).width,16); assert.equal(result.queryCount,beforeSwitch);
        result.checks.push('New/offscreen maps inherit the panel size, and changing the last map updates older maps without requests');
        await page.evaluate(()=>setSplitMode('horizontal')); await load(h5,2); await mode('heat',2); await plot(metricNames.slice(0,5),2);
        await controls(2,16); await inspect('secondary default16',16,2,0,500000,'save');
        await setSize(8,1); await controls(1,8); await controls(2,16);
        await inspect('secondary unaffected by primary8',16,2,0,500000,'compare');
        await setSize(8,2); await setSize(16,1); await controls(1,16); await controls(2,8);
        await inspect('secondary independent8',8,2,0,500000,'compare');
        result.checks.push('Two split panels keep independent size settings and original samples across either panel size change');
        await page.evaluate(()=>{setSplitMode('single');ClearAll(1);}); await plot(metricNames.slice(0,20));
        for(const size of [8,16]) {
            await setSize(size); await wheel(-5000); let s=await inspect('zoom maximum '+size,size);
            assert.equal(s.width,size); await wheel(-5000); assert.equal((await inspect('repeated maximum '+size,size)).width,size);
            await wheel(5000); s=await inspect('viewport fit '+size,size);
            assert(Math.abs(s.width-s.area/count)<1e-9); assert.equal(s.first,0); assert.equal(s.last,count);
            await wheel(5000); assert.equal((await inspect('repeated viewport fit '+size,size)).width,s.width);
        }
        result.checks.push('Both size choices enforce their own zoom maximum and stop zooming out exactly when every sample fits the viewport');
        await setSize(8); await reload(); await controls(1,8); await inspect('CSV reload keeps8',8);
        await mode('line'); await mode('heat'); await controls(1,8); await inspect('Line Heat keeps8',8);
        await page.evaluate(()=>ClearAll(1)); await plot(['port0']); await controls(1,8); await inspect('Clear Plot keeps8',8);
        await load(h5); await controls(1,8); await inspect('new H5 keeps8',8,1,0,500000);
        await load(csv); await controls(1,8); await inspect('new CSV keeps8',8);
        await page.evaluate(()=>setSplitMode('horizontal')); await controls(2,8); await inspect('other panel persists8',8,2,0,500000);
        result.checks.push('Cell size survives real Reload, Line/Heat, Clear/new Plot and different CSV/H5 datasets while the other panel remains independent');
        await page.reload(); await page.waitForFunction(()=>window.metricHeat); await load(csv); await mode('heat'); await plot(['port0']);
        await controls(1,16); assert.equal((await inspect('page refresh resets16',16)).width,16);
        result.checks.push('A fresh browser page restores the default16 without persistent browser storage');
        assert.deepEqual(result.errors,[]); assert.deepEqual(result.dialogs,[]); result.status='PASS';
        await page.screenshot({path:path.join(output,'cell-size.png')});
        console.log(`PASS: ${result.checks.length} Heat cell-size checks`);
    } catch(error) {
        result.status='FAIL'; result.failure=error.stack;
        await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); throw error;
    } finally {
        fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n'); await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
