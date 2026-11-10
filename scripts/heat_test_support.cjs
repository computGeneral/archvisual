/* Browser-test observation of real renderer input. No production data API shim. */
'use strict';
async function observeHeat(page) {
    await page.addInitScript(() => {
        const frames = new WeakMap(), instances = new Set(); let api;
        Object.defineProperty(window, 'MetricHeatCanvas', {configurable: true,
            get() {return api;}, set(value) {
                api = value; const create = api.create;
                api.create = function(host, options) {
                    const renderer = create.call(this, host, options);
                    const record = {host, renders: 0, disposed: false}; instances.add(record);
                    const render = renderer.render, suspend = renderer.suspend, dispose = renderer.dispose;
                    renderer.render = function(frame) {frames.set(host, frame); ++record.renders; return render.call(this, frame);};
                    renderer.suspend = function() {frames.delete(host); return suspend.call(this);};
                    renderer.dispose = function() {frames.delete(host); instances.delete(record); record.disposed = true; return dispose.call(this);};
                    return renderer;
                };
            }
        });
        window.heatTestInstances = instances;
        window.heatTestFrame = dom => frames.get(dom);
        window.heatTestChart = dom => echarts.getInstanceByDom(dom.querySelector('.heat-axes') || dom);
        window.heatTestCells = dom => {
            const frame = frames.get(dom), chart = heatTestChart(dom);
            const series = chart.getOption().series.filter(s => s.id === 'heat-values' || s.id === 'heat-missing');
            if (!frame) return series.flatMap(s => s.data);
            if (series.some(s => s.data.length)) throw Error('Canvas samples must not duplicate ECharts cell arrays');
            const cells = [];
            for (let y = frame.firstRow; y < frame.lastRow; ++y) for (let c = frame.firstCol; c < frame.lastCol; ++c) {
                const raw = frame.rows[y].values[c], value = MetricHeat.colorValue(frame.rows[y], raw, frame.normal);
                cells.push([c - frame.firstCol, y - frame.firstRow, value === null ? 0 : value, raw, c, y]);
            }
            return cells;
        };
    });
}
module.exports = {observeHeat};
