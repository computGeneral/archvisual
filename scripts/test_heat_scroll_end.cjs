/* Native scrolling must expose every sample, including stable-gutter layouts.
 * node scripts/test_heat_scroll_end.cjs URL OUTPUT
 */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const [base, output] = process.argv.slice(2);
fs.mkdirSync(output, { recursive: true });
const result = { checks: [], errors: [], windows: [] };
const fixtures = new Map();
function fixture(count) {
    if (fixtures.has(count)) return fixtures.get(count);
    const csv = path.join(output, `samples-${count}.csv`), h5 = csv.replace(/csv$/, 'h5');
    fs.writeFileSync(csv, 'sample,' + Array.from({ length: count }, (_, i) => i).join(',') + '\nsamplePeriod,100\n' +
        Array.from({ length: 80 }, (_, r) => `p${r},` +
            Array.from({ length: count }, (_, c) => r * 10000 + c).join(',')).join('\n') + '\n');
    execFileSync('python3', ['-B', path.join(__dirname, 'csv2hdf.py'), '-i', csv, '-o', h5], { stdio: 'pipe' });
    fixtures.set(count, h5); return h5;
}
(async () => {
    const browser = await chromium.launch({ executablePath: process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome',
        headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
    page.on('pageerror', e => result.errors.push(String(e)));
    const cards = panel => page.locator(`.heat-host[data-panel="${panel}"] .heat-map`);
    const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    async function load(count, panel = 2) {
        await page.evaluate(({ file, panel }) => { setActivePanel(panel); requestServerFile(file, panel, false); },
            { file: fixture(count), panel });
        await page.waitForFunction(() => !fileLoadBusy && $.active === 0);
        await page.locator('#metricMode').selectOption('heat');
        await page.evaluate(panel => ClearAll(panel), panel); await frames();
    }
    async function plot(names, panel = 2) { await page.evaluate(({ names, panel }) => metricHeat.plot(names, panel), { names, panel }); await frames(); }
    async function snapshot(label, panel = 2) {
        await frames();
        const maps = await cards(panel).evaluateAll(cards => cards.map(card => {
            const v = card.querySelector('.heat-viewport'), chart = echarts.getInstanceByDom(card.querySelector('.heat-canvas'));
            if (!chart) return null;
            const o = chart.getOption(), labels = o.xAxis[0].data.map(Number), names = o.yAxis[0].data;
            const cells = o.series.filter(s => s.id === 'heat-values' || s.id === 'heat-missing').flatMap(s => s.data);
            for (const [x, y, , raw, c] of cells) {
                if (raw !== Number(names[y].slice(1)) * 10000 + c || labels[x] !== c) throw Error('Sample value/order changed');
            }
            return { labels, names, left: v.scrollLeft, client: v.clientWidth, offset: v.offsetWidth,
                scrollWidth: v.scrollWidth, vertical: v.scrollHeight > v.clientHeight,
                cell: o.grid[0].width / labels.length, row: o.grid[0].height / names.length,
                stats: o.grid[1].width, area: chart.getWidth() - o.grid[0].left - 76 };
        }));
        result.windows.push({ label, panel, maps });
        for (const m of maps.filter(Boolean)) { assert.equal(m.row, 16); assert.equal(m.stats, 48); }
        return maps;
    }
    async function scroll(value, index = 0, panel = 2) {
        await cards(panel).nth(index).locator('.heat-viewport').evaluate((v, value) => {
            v.scrollLeft = value === 'end' ? v.scrollWidth : value;
        }, value); await frames();
    }
    async function endpoints(label, start = 0, end = 23, panel = 2) {
        await scroll(0, 0, panel); let maps = await snapshot(label + ': start', panel);
        for (const m of maps.filter(Boolean)) assert.equal(m.labels[0], start);
        const seen = new Set(maps[0].labels);
        const limit = maps[0].scrollWidth, step = Math.max(1, Math.floor(maps[0].area / 3));
        for (let x = step; x <= limit + step; x += step) {
            await scroll(x, 0, panel); maps = await snapshot(label + ': scroll ' + x, panel);
            maps[0].labels.forEach(x => seen.add(x));
            if (maps[0].labels.at(-1) === end) break;
        }
        await scroll('end', 0, panel); maps = await snapshot(label + ': end', panel);
        for (const m of maps.filter(Boolean)) assert.equal(m.labels.at(-1), end, label + ': final sample must be visible');
        assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: end - start + 1 }, (_, i) => i + start));
        return maps;
    }
    async function wheel(delta, modifier = 'Shift', panel = 2) {
        const p = await cards(panel).first().evaluate(card => {
            const dom = card.querySelector('.heat-canvas'), o = echarts.getInstanceByDom(dom).getOption(), r = dom.getBoundingClientRect();
            return { x: r.left + o.grid[0].left + 10, y: r.top + o.grid[0].top + 8 };
        });
        await page.mouse.move(p.x, p.y); await page.keyboard.down(modifier);
        await page.mouse.wheel(0, delta); await page.keyboard.up(modifier); await frames();
    }
    try {
        await page.goto(base + '/metricviewer'); await page.waitForFunction(() => metricHeat);
        await page.evaluate(() => setSplitMode('horizontal')); await load(24); await plot(['p0']);
        await endpoints('narrow split without vertical scrollbar');
        result.checks.push('24 samples in the original narrow split are all reachable, including indices 22 and 23');
        await scroll(0); await wheel(10000);
        assert.equal((await snapshot('Shift+wheel reaches end'))[0].labels.at(-1), 23);
        await wheel(-10000); assert.equal((await snapshot('Shift+wheel returns to start'))[0].labels[0], 0);
        result.checks.push('real Shift+wheel reaches both horizontal endpoints');

        await plot(Array.from({ length: 80 }, (_, i) => 'p' + i));
        let maps = await endpoints('mixed vertical scrollbar maps');
        assert.equal(maps[0].vertical, false); assert.equal(maps[1].vertical, true);
        assert.deepEqual(maps[0].labels, maps[1].labels);
        for (const index of [1, 0]) {
            await scroll(40, index); maps = await snapshot('linked middle from map ' + index);
            assert.deepEqual(maps[0].labels, maps[1].labels);
            await scroll('end', index); maps = await snapshot('linked end from map ' + index);
            assert.deepEqual(maps[0].labels, maps[1].labels); assert.equal(maps[0].labels.at(-1), 23);
        }
        result.checks.push('maps with and without vertical scrollbars share sample positions when either map is scrolled');
        await cards(2).nth(1).locator('.heat-viewport').evaluate(v => { v.scrollTop = v.scrollHeight; }); await frames();
        assert((await snapshot('last metric'))[1].names.includes('p79'));
        result.checks.push('the final metric remains reachable by vertical scrolling');

        await load(17); await plot(['p0']);
        maps = await endpoints('less than one gutter of horizontal overflow', 0, 16);
        assert(17 * maps[0].cell - maps[0].area > 0 && 17 * maps[0].cell - maps[0].area < 15);
        result.checks.push('a sample range overflowing by less than one scrollbar gutter still reaches its last cell');
        await cards(2).first().locator('.heat-sidebar-resizer').press('Home'); await frames();
        await endpoints('hidden sidebar', 0, 16);
        await cards(2).first().locator('.heat-sidebar-resizer').press('End'); await frames();
        await endpoints('wide sidebar', 0, 16);
        result.checks.push('hiding and widening the sidebar updates both scroll endpoints');

        await load(80); await plot(['p0']);
        await wheel(120, 'Control'); maps = await snapshot('fractional column width'); assert(maps[0].cell < 16 && maps[0].cell % 1 !== 0);
        await endpoints('fractional cell width', 0, 79);
        result.checks.push('fractional cell widths retain complete sample coverage');
        await page.evaluate(() => { setActivePanel(2); zoom_start.value = '10'; zoom_end.value = '49'; metricHeat.zoomFromInputs(2); });
        await endpoints('restricted sample range', 10, 49);
        result.checks.push('Start/End limits retain both requested endpoints');
        for (const mode of ['vertical', 'horizontal', 'single']) {
            await page.evaluate(mode => setSplitMode(mode), mode);
            const panel = mode === 'single' ? 1 : 2;
            if (mode === 'single') { await load(80, 1); await plot(['p0'], 1); }
            await endpoints(mode + ' split', mode === 'single' ? 0 : 10, mode === 'single' ? 79 : 49, panel);
        }
        result.checks.push('single, side-by-side and stacked views retain complete horizontal coverage');
        await page.evaluate(() => setSplitMode('horizontal'));
        for (const width of [1100, 1651, 1500]) {
            await page.setViewportSize({ width, height: 900 }); await endpoints('window width ' + width, 10, 49);
        }
        result.checks.push('viewport resizing recalculates scroll extents');
        const style = await page.addStyleTag({ content: '.heat-viewport { scrollbar-width: none; }' });
        await endpoints('scrollbars hidden', 10, 49); await style.evaluate(el => el.remove());
        await endpoints('scrollbars restored', 10, 49);
        result.checks.push('hidden and visible scrollbar geometry both reach the final sample');
        await page.evaluate(() => { setActivePanel(2); document.querySelector('#reloadLoadItem').click(); });
        await page.waitForFunction(() => !fileLoadBusy && $.active === 0); await endpoints('reload', 10, 49);
        result.checks.push('Reload preserves the range and complete scroll coverage');

        await page.evaluate(() => {
            window.endUpdates = 0;
            document.querySelectorAll('.heat-canvas').forEach(el => {
                const c = echarts.getInstanceByDom(el); if (!c) return;
                const original = c.setOption; c.setOption = function (...args) { ++endUpdates; return original.apply(this, args); };
            });
        });
        await page.waitForTimeout(400); assert.equal(await page.evaluate(() => endUpdates), 0);
        result.checks.push('settled scroll geometry causes no chart-update loop');
        await page.screenshot({ path: path.join(output, 'end-visible.png') });
        assert.deepEqual(result.errors, []); result.status = 'PASS';
    } catch (e) { result.status = 'FAIL'; result.error = e.stack; throw e; }
    finally { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n'); await browser.close(); }
    console.log(JSON.stringify({ status: result.status, checks: result.checks }));
})().catch(e => { console.error(e); process.exitCode = 1; });
