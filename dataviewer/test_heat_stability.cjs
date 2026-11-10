/* Browser regression: run against a local ArchVisual server with Playwright.
 * node archvisual/dataviewer/test_heat_stability.cjs [http://127.0.0.1:8097]
 * Uses the real example H5 and ordinary 15px scrollbars, including split views.
 */
'use strict';
const {observeHeat} = require('../scripts/heat_test_support.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.argv[2] || 'http://127.0.0.1:8097';
const fixture = path.resolve(__dirname, '../examples/metricview.h5');
const output = process.env.HEAT_TEST_OUTPUT || path.resolve(__dirname, '../__output__/heat_stability');

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({
        executablePath: process.env.HEAT_TEST_CHROME || '/usr/bin/google-chrome',
        headless: true, ignoreDefaultArgs: ['--hide-scrollbars'],
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    await observeHeat(page);
    const errors = [], checks = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    try {
        await page.goto(baseUrl + '/metricviewer');
        await page.waitForFunction(() => window.metricHeat);
        await page.evaluate(() => {
            window.heatStability = { resizes: 0, renders: 0, errors: [] };
            window.addEventListener('error', event => heatStability.errors.push(event.message));
            const original = echarts.init;
            echarts.init = function (...args) {
                const chart = original.apply(this, args);
                if (args[0].classList.contains('heat-axes')) {
                    const resize = chart.resize;
                    chart.resize = function (...resizeArgs) {
                        heatStability.resizes++;
                        return resize.apply(this, resizeArgs);
                    };
                    chart.on('rendered', () => heatStability.renders++);
                }
                return chart;
            };
        });
        async function load(panel) {
            await page.evaluate(async ({ panel, fixture }) => {
                const meta = await fetch('/api/show/server_load', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: fixture, secondary: panel === 2 })
                }).then(response => response.json());
                if (meta.code !== 0) throw new Error(meta.msg);
                ProcessH5(meta, panel);
                metricHeat.plot(meta.data.signal.slice(0, 6), panel);
            }, { panel, fixture });
            await page.waitForFunction(panel => {
                const host = document.querySelector(`.heat-host[data-panel="${panel}"]`);
                return host && /^6 metrics ×/.test(host.querySelector('.heat-status').textContent);
            }, panel);
        }
        async function counts() {
            return page.evaluate(() => {
                document.querySelectorAll('.heat-canvas').forEach(element => {
                    if (!element.getBoundingClientRect().height) return;
                    const chart = heatTestChart(element), option = chart.getOption(), grid = option.grid[0], stats = option.grid[1];
                    if (stats.width !== 48 || stats.top !== grid.top || stats.height !== grid.height ||
                        Math.abs(stats.left - grid.left - grid.width - 8) > 1e-9 || stats.left + stats.width > chart.getWidth()) {
                        throw new Error('Statistics must stay aligned and visible at fixed 16px width');
                    }
                    const axis = chart.getViewOfComponentModel(chart.getModel().getComponent('xAxis', 0)).group;
                    const axisRect = axis.getBoundingRect().clone();
                    if (axis.getComputedTransform()) axisRect.applyTransform(axis.getComputedTransform());
                    if (axisRect.y < -1) throw new Error('Sample tick labels must fit above the heatmap');
                    const legend = chart.getViewOfComponentModel(chart.getModel().getComponent('visualMap')).group;
                    const rect = legend.getBoundingRect().clone();
                    if (legend.getComputedTransform()) rect.applyTransform(legend.getComputedTransform());
                    const targetLeft = Math.max(0, Math.min(chart.getWidth() - rect.width,
                        grid.left + grid.width / 2 - rect.width / 2));
                    if (Math.abs(rect.x - targetLeft) > 1 || rect.x < -1 || rect.x + rect.width > chart.getWidth() + 1) {
                        throw new Error('Color bar must center under sample cells and fit the viewport');
                    }
                    const gap = rect.y - grid.top - grid.height;
                    if (gap < 7 || gap > 9 || rect.y + rect.height > chart.getHeight()) {
                        throw new Error('Color bar must stay about 8px below the visible heatmap without vertical clipping: ' + gap);
                    }
                });
                return { resizes: heatStability.resizes, renders: heatStability.renders };
            });
        }
        async function idle(label, duration = 700) {
            // Observe a quiet interval after layout, without hiding scrollbar UI.
            await page.waitForTimeout(300);
            const before = await counts();
            await page.waitForTimeout(duration);
            assert.deepEqual(await counts(), before, label + ': idle Heat must not resize or repaint');
            assert.deepEqual(await page.evaluate(() => heatStability.errors), [], label + ': browser layout errors');
            assert.deepEqual(errors, [], label + ': JavaScript errors');
            checks.push(label);
        }
        await page.locator('#metricMode').selectOption('heat');
        await load(1);
        // Make the ordinary scrollbar assumption explicit; hidden scrollbars
        // missed the original ResizeObserver feedback in the first UI gate.
        assert(await page.locator('.heat-viewport').first().evaluate(el => el.offsetWidth - el.clientWidth) > 0);
        for (const mode of ['single', 'horizontal', 'vertical']) {
            await page.evaluate(mode => setSplitMode(mode), mode);
            if (mode === 'horizontal') {
                await page.evaluate(() => setActivePanel(2));
                await page.locator('#metricMode').selectOption('heat');
                await load(2);
            }
            for (const [width, height] of [[1600, 950], [1200, 800], [961, 601], [641, 481], [401, 261]]) {
                await page.setViewportSize({ width, height });
                await idle(`${mode} ${width}×${height}`);
            }
        }
        await page.setViewportSize({ width: 1200, height: 800 });
        await page.evaluate(() => setSplitMode('single'));
        await idle('return to single', 5000);
        const beforeScroll = await counts();
        await page.locator('.heat-host[data-panel="1"] .heat-viewport').evaluate(el => {
            for (let i = 0; i < 8; i++) el.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(300);
        assert.deepEqual(await counts(), beforeScroll, 'unchanged viewport must not repaint or resize');
        checks.push('coalesce unchanged scroll notifications');
        await page.locator('.heat-host[data-panel="1"] .heat-viewport').evaluate(el => { el.scrollLeft = 240; });
        await idle('scroll to new samples');
        assert((await counts()).renders > beforeScroll.renders, 'actual scrolling must update visible samples');
        const point = await page.evaluate(() => {
            const element = document.querySelector('.heat-host[data-panel="1"] .heat-canvas');
            const chart = heatTestChart(element), rect = element.getBoundingClientRect();
            const point = chart.convertToPixel({ seriesIndex: 0 }, [0, 0]);
            return { x: rect.left + point[0], y: rect.top + point[1] };
        });
        await page.mouse.move(point.x, point.y);
        await page.waitForFunction(() => document.querySelector('.heat-host[data-panel="1"] .heat-canvas').innerText.includes('Raw value:'));
        await idle('hover tooltip', 5000);
        const tooltipCounts = await counts();
        await page.locator('.heat-host[data-panel="1"] .heat-viewport').evaluate(el => el.dispatchEvent(new Event('scroll')));
        await page.waitForTimeout(300);
        assert.deepEqual(await counts(), tooltipCounts, 'unchanged scroll must preserve hover without redrawing');
        assert(await page.locator('.heat-host[data-panel="1"] .heat-canvas').innerText().then(text => text.includes('Raw value:')));
        checks.push('stable tooltip across unchanged scroll notifications');
        fs.writeFileSync(path.join(output, 'stability-result.json'), JSON.stringify({ status: 'PASS', checks, errors }, null, 2));
        await page.screenshot({ path: path.join(output, 'stable-heat.png') });
        console.log(`PASS: ${checks.length} Heat stability checks; no resize loops or idle repaint`);
    } catch (error) {
        fs.writeFileSync(path.join(output, 'stability-result.json'), JSON.stringify({ status: 'FAIL', checks, error: String(error), errors }, null, 2));
        await page.screenshot({ path: path.join(output, 'stability-failure.png') });
        throw error;
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
