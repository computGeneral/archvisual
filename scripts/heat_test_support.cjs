/* Browser-test observation of real renderer input. No production data API shim. */
'use strict';
async function observeHeat(page) {
    await page.addInitScript(() => {
        const frames = new WeakMap(), records = new WeakMap(), instances = new Set(); let api;
        Object.defineProperty(window, 'MetricHeatCanvas', {configurable: true,
            get() {return api;}, set(value) {
                api = value; const create = api.create;
                api.create = function(host, options) {
                    const renderer = create.call(this, host, options);
                    const record = {host, renderer, options, renders: 0, disposed: false, reference: null};
                    instances.add(record); records.set(host, record);
                    const render = renderer.render, suspend = renderer.suspend, dispose = renderer.dispose;
                    function referenceFrame(frame) {
                        const ref = record.reference;
                        if (!ref) return;
                        ref.host.style.width = frame.width + 'px'; ref.host.style.height = frame.height + 'px';
                        ref.renderer.render(frame);
                    }
                    record.fullReference = function() {
                        if (!record.reference) {
                            const dom = document.createElement('div');
                            Object.assign(dom.style, {position: 'fixed', left: '-10000px', top: '0'});
                            document.body.appendChild(dom);
                            // Bypass this observer's create wrapper: this oracle
                            // is not a second production map or measured instance.
                            record.reference = {host: dom, renderer: create.call(api, dom, Object.assign({}, options, {
                                bitmapReuse: false, cursor() {}, showIndicator() {}, hideIndicator() {}, select() {}
                            }))};
                            if (frames.has(host)) referenceFrame(frames.get(host));
                        }
                        return record.reference;
                    };
                    // Forward the same CSS pointer coordinates and public legend
                    // operations; comparisons must retain identical hover state.
                    function pointer(event) {
                        if (!record.reference) return;
                        const a = host.getBoundingClientRect(), b = record.reference.host.getBoundingClientRect();
                        record.reference.host.dispatchEvent(new PointerEvent(event.type, {
                            clientX: b.left + event.clientX - a.left, clientY: b.top + event.clientY - a.top,
                            bubbles: false
                        }));
                    }
                    host.addEventListener('pointermove', pointer); host.addEventListener('pointerleave', pointer);
                    for (const name of ['highlightRange', 'hide']) {
                        const original = renderer[name];
                        renderer[name] = function(...args) {
                            const answer = original.apply(this, args);
                            if (record.reference) record.reference.renderer[name](...args);
                            return answer;
                        };
                    }
                    renderer.render = function(frame) {
                        frames.set(host, frame); ++record.renders;
                        const answer = render.call(this, frame); referenceFrame(frame); return answer;
                    };
                    renderer.suspend = function() {
                        frames.delete(host); if (record.reference) record.reference.renderer.suspend();
                        return suspend.call(this);
                    };
                    renderer.dispose = function() {
                        frames.delete(host); records.delete(host); instances.delete(record); record.disposed = true;
                        host.removeEventListener('pointermove', pointer); host.removeEventListener('pointerleave', pointer);
                        if (record.reference) {record.reference.renderer.dispose(); record.reference.host.remove();}
                        return dispose.call(this);
                    };
                    return renderer;
                };
            }
        });
        window.heatTestInstances = instances;
        window.heatTestFrame = dom => frames.get(dom);
        window.heatTestRecord = dom => records.get(dom);
        window.heatTestFullReference = dom => records.get(dom).fullReference();
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
