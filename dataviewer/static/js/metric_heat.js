/* MetricViewer Heat mode. Raw sample values are independent of chart options. */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MetricHeat = api;
}(typeof window === 'undefined' ? this : window, function () {
    'use strict';
    var palette = ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#fdae61', '#d73027'];
    var rowHeight = 16, minColumnWidth = 1, maxColumnWidth = 16;
    var defaultAxisTop = 52, bottomSpace = 40, minMapHeight = 140, scrollbarSpace = 15;
    var statistics = ['min', 'avg', 'max'], statisticsGap = 8;
    var defaultSidebarWidth = 180, minSidebarWidth = 0, maxSidebarWidth = 400;

    function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function axisTop(times) {
        var height = defaultAxisTop, angle = 50 * Math.PI / 180;
        times.forEach(function (value) {
            var rect = echarts.format.getTextRect(String(value), '10px sans-serif');
            height = Math.max(height, Math.ceil(rect.width * Math.sin(angle) + rect.height * Math.cos(angle) + 16));
        });
        return height;
    }
    function updateTimes(state, times) {
        if (state.times.length === times.length && state.times.every(function (v, i) { return v === times[i]; })) return;
        state.times = times.slice();
        state.axisTop = null;
    }
    function visibleStart(scroll, maxScroll, total, capacity, size) {
        var last = Math.max(0, total - capacity);
        // The viewport's trailing partial cell is not rendered. Reach the
        // final complete window even when the scroll extent is not divisible
        // by the cell size (including fractional CSS-pixel rounding).
        return scroll > 0 && scroll >= maxScroll - 1 ? last : Math.min(Math.floor(scroll / size), last);
    }
    function samplesFit(count, columnWidth, plotWidth) {
        // Dividing the viewport into fractional cells can round the product a
        // few floating-point units above its width. Keep the final cell visible.
        return count > 0 && count * columnWidth <= plotWidth + 1e-7;
    }
    function mean(values, count, scale) {
        if (!count) return null;
        function sum(divisor) {
            var total = 0, correction = 0;
            values.forEach(function (value) {
                if (value === null) return;
                var v = value / divisor, next = total + v;
                correction += Math.abs(total) >= Math.abs(v) ? (total - next) + v : (v - next) + total;
                total = next;
            });
            return total + correction;
        }
        // Compensate cancellation; scale only if the ordinary sum overflows.
        var total = sum(1);
        return finite(total) ? total / count : (sum(scale) / count) * scale;
    }
    function rowsFromGroups(groups, data, count, reusableRows) {
        var seen = new Set(), rows = [];
        Object.keys(groups).forEach(function (group) {
            groups[group].Sig.forEach(function (name) {
                if (seen.has(name)) return;
                seen.add(name);
                var values = data[group] && data[group].Sig[name];
                if (!Array.isArray(values) || values.length !== count) {
                    throw new Error('Sample count does not match the file: ' + name);
                }
                // Callers supply validated rows from the same panel/data epoch.
                // Their sample arrays are read-only; identity, not metric name
                // alone, allows skipping validation and full-file statistics.
                var previous = reusableRows && reusableRows.get(name);
                if (previous && previous.name === name && previous.values === values) {
                    rows.push({ name: name, values: values, min: previous.min, max: previous.max,
                        validCount: previous.validCount, avg: previous.avg });
                    return;
                }
                var min = Infinity, max = -Infinity, validCount = 0;
                values.forEach(function (v) {
                    if (v !== null && !finite(v)) throw new Error('Invalid numeric value: ' + name);
                    if (finite(v)) { min = Math.min(min, v); max = Math.max(max, v); ++validCount; }
                });
                rows.push({ name: name, values: values, min: min, max: max, validCount: validCount,
                    avg: mean(values, validCount, Math.max(Math.abs(min), Math.abs(max))) });
            });
        });
        return rows;
    }
    function colorValue(row, value, normalized) {
        if (!finite(value)) return null;
        if (!normalized) return value;
        if (row.max === row.min) return 0;
        // Scale first to avoid overflow for finite values at opposite extremes.
        var scale = Math.max(Math.abs(row.min), Math.abs(row.max));
        return (value / scale - row.min / scale) / (row.max / scale - row.min / scale);
    }
    function bounds(rows, normalized, manualMin, manualMax) {
        if (normalized) return [0, 1];
        var low = Infinity, high = -Infinity;
        rows.forEach(function (row) { low = Math.min(low, row.min); high = Math.max(high, row.max); });
        if (!finite(low)) { low = 0; high = 1; }
        if (low === high) {
            low = Math.min(0, low);
            high = high === 0 ? 1 : Math.max(0, high);
        }
        if (manualMin !== '') low = Number(manualMin);
        if (manualMax !== '') high = Number(manualMax);
        if (!finite(low) || !finite(high) || low >= high) {
            throw new Error('Color minimum must be smaller than maximum; both must be finite');
        }
        return [low, high];
    }
    function newState() {
        return { mode: 'line', maps: [], times: [], axisTop: null, config: {}, columnWidth: maxColumnWidth,
            minColumnWidth: minColumnWidth,
            start: 0, end: -1, scrollLeft: 0, pendingScrollLeft: null, nextPlot: 1,
            token: 0, selected: null, notice: '', missing: [], loaded: false, waiting: false, sidebarWidth: defaultSidebarWidth };
    }

    function install(adapter) {
        var states = { 1: newState(), 2: newState() }, widgets = {}, active = 1;
        var mode = document.getElementById('metricMode');

        function syncControls() {
            var heat = states[active].mode === 'heat';
            mode.value = states[active].mode;
            document.getElementById('filterMetricGroup').disabled = heat;
            document.getElementById('max_value').disabled = heat;
        }
        function activatePanel(panel) {
            if (panel !== active) adapter.activatePanel(panel);
        }
        function rangeInputs(panel) {
            if (panel !== active) return;
            var s = states[panel];
            document.getElementById('zoom_start').value = s.times[s.start] === undefined ? '' : s.times[s.start];
            document.getElementById('zoom_end').value = s.times[s.end] === undefined ? '' : s.times[s.end];
            document.getElementById('zoom_duration').value = s.end >= s.start ? s.end - s.start + 1 : '';
        }
        function panelWidget(panel) {
            if (widgets[panel]) return widgets[panel];
            var host = document.createElement('div');
            host.className = 'heat-host hidden'; host.dataset.panel = panel;
            var info = document.createElement('div'); info.className = 'heat-panel-status hidden';
            info.setAttribute('role', 'status');
            var empty = document.createElement('div'); empty.className = 'heat-empty';
            host.appendChild(info); host.appendChild(empty);
            adapter.lineElement(panel).parentNode.appendChild(host);
            var w = { host: host, status: info, empty: empty, frame: null, drag: null };
            widgets[panel] = w;
            new ResizeObserver(function () { scheduleRender(panel); }).observe(host);
            host.addEventListener('scroll', function () { scheduleRender(panel); });
            w.intersections = new IntersectionObserver(function () { scheduleRender(panel); }, { root: host });
            return w;
        }
        function setSidebarWidth(panel, width) {
            states[panel].sidebarWidth = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, Math.round(width)));
            scheduleRender(panel);
        }
        function endSidebarDrag(panel) {
            var parent = widgets[panel], drag = parent && parent.drag;
            if (!drag) return;
            parent.drag = null;
            if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
            document.body.classList.toggle('heat-resizing', Object.values(widgets).some(function (w) { return !!w.drag; }));
        }
        function status(panel, message, error) {
            var w = panelWidget(panel);
            w.status.textContent = message || states[panel].notice;
            w.status.title = w.status.textContent;
            w.status.classList.toggle('hidden', !w.status.textContent);
            w.status.classList.toggle('heat-error', !!error);
        }
        function mapStatus(m, message, error) {
            m.widget.status.textContent = message;
            m.widget.status.title = message;
            m.widget.status.classList.toggle('heat-error', !!error);
        }
        function summarize(panel, m) {
            if (m.busy || m.error) return;
            var s = states[panel];
            mapStatus(m, m.rows.length + ' metrics × ' + s.times.length + ' samples · ' +
                Number(s.columnWidth.toFixed(2)) + ' px/sample');
        }
        function syncHeatControls(m) {
            var w = m.widget;
            w.color.value = m.color; w.min.value = m.min; w.max.value = m.max;
            w.color.title = w.color.options[w.color.selectedIndex].text;
            w.min.disabled = w.max.disabled = m.color === 'row';
        }
        function legendLeft(left, gridWidth, legendWidth, width) {
            return Math.max(0, Math.min(width - legendWidth, left + gridWidth / 2 - legendWidth / 2));
        }
        function fitLegend(w, width, left, gridWidth, key) {
            if (w.legendLayout && w.legendLayout.key === key) return;
            var group = w.chart.getViewOfComponentModel(w.chart.getModel().getComponent('visualMap')).group;
            var box = group.getBoundingRect(), length = 130, fontSize = 12;
            function resizeLegend() {
                w.chart.setOption({ visualMap: { itemHeight: length, textStyle: { fontSize: fontSize } } });
                box = group.getBoundingRect();
            }
            // Keep both endpoint labels visible in narrow split views. Cache
            // this fit so ordinary panning needs only the main chart update.
            if (box.width > width) {
                length = Math.max(12, length - (box.width - width)); resizeLegend();
                while (box.width > width && fontSize > 8) { --fontSize; resizeLegend(); }
            }
            w.legendLayout = { key: key, width: box.width, length: length, fontSize: fontSize };
            w.chart.setOption({ visualMap: { left: legendLeft(left, gridWidth, box.width, width) } });
        }
        function createMap(panel, key, group) {
            var s = states[panel], parent = panelWidget(panel), settings = group.Heat || {};
            var m = { key: key, group: clone(group), data: null, rows: [],
                color: settings.color === 'row' ? 'row' : 'raw',
                min: settings.min === undefined ? '' : String(settings.min),
                max: settings.max === undefined ? '' : String(settings.max),
                busy: false, loaded: false, error: '', token: 0, dataEpoch: -1 };
            m.group.Sig = Array.from(new Set(group.Sig));
            var card = document.createElement('section'); card.className = 'heat-map';
            card.dataset.group = key; card.setAttribute('aria-label', key);
            var controls = document.getElementById('heatControlsTemplate').content.firstElementChild.cloneNode(true);
            var description = controls.querySelector('.heat-toolbar-hint');
            description.className = 'heat-description';
            var title = document.createElement('strong'); title.className = 'heat-map-title'; title.textContent = key;
            controls.insertBefore(title, controls.firstChild);
            var info = document.createElement('div'); info.className = 'heat-status'; info.setAttribute('role', 'status');
            var sidebar = document.createElement('aside'); sidebar.className = 'heat-sidebar';
            sidebar.setAttribute('aria-label', key + ': controls and status');
            sidebar.appendChild(controls); sidebar.appendChild(info); sidebar.appendChild(description);
            var resizer = document.createElement('div'); resizer.className = 'heat-sidebar-resizer';
            resizer.tabIndex = 0; resizer.setAttribute('role', 'separator');
            resizer.setAttribute('aria-label', key + ': resize heat sidebars');
            resizer.setAttribute('aria-orientation', 'vertical');
            resizer.setAttribute('aria-valuemin', minSidebarWidth); resizer.setAttribute('aria-valuemax', maxSidebarWidth);
            var viewport = document.createElement('div'); viewport.className = 'heat-viewport';
            viewport.setAttribute('aria-label', key + ': samples and metrics');
            var spacer = document.createElement('div'); spacer.className = 'heat-spacer';
            var canvas = document.createElement('div'); canvas.className = 'heat-canvas';
            spacer.appendChild(canvas); viewport.appendChild(spacer);
            card.appendChild(viewport); card.appendChild(sidebar); card.appendChild(resizer);
            parent.host.appendChild(card);
            var w = m.widget = { card: card, sidebar: sidebar, controls: controls, status: info, viewport: viewport, description: description,
                spacer: spacer, canvas: canvas, resizer: resizer, chart: null, viewKey: null, layout: null, legendLayout: null, scrollLeft: 0,
                color: controls.querySelector('[name="heatColor"]'),
                min: controls.querySelector('[name="heatMin"]'), max: controls.querySelector('[name="heatMax"]') };
            syncHeatControls(m);
            resizer.addEventListener('pointerdown', function (event) {
                if (event.button !== 0 || parent.drag) return;
                event.preventDefault(); activatePanel(panel);
                parent.drag = { owner: m, handle: resizer, pointerId: event.pointerId, x: event.clientX,
                    width: s.sidebarWidth, scrollLeft: parent.host.scrollLeft, mapWidth: card.offsetWidth };
                resizer.setPointerCapture(event.pointerId); document.body.classList.add('heat-resizing');
            });
            resizer.addEventListener('pointermove', function (event) {
                var drag = parent.drag;
                if (!drag || drag.owner !== m || drag.pointerId !== event.pointerId) return;
                setSidebarWidth(panel, drag.width + drag.x - event.clientX);
            });
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
                resizer.addEventListener(name, function (event) {
                    if (parent.drag && parent.drag.owner === m && parent.drag.pointerId === event.pointerId) endSidebarDrag(panel);
                });
            });
            resizer.addEventListener('keydown', function (event) {
                var width;
                if (event.key === 'ArrowLeft') width = s.sidebarWidth + 10;
                else if (event.key === 'ArrowRight') width = s.sidebarWidth - 10;
                else if (event.key === 'Home') width = minSidebarWidth;
                else if (event.key === 'End') width = maxSidebarWidth;
                else return;
                event.preventDefault(); event.stopPropagation(); activatePanel(panel); setSidebarWidth(panel, width);
            });
            controls.addEventListener('focusin', function () { activatePanel(panel); });
            w.color.addEventListener('change', function () {
                activatePanel(panel); m.color = w.color.value; m.error = '';
                syncHeatControls(m); scheduleRender(panel);
            });
            [w.min, w.max].forEach(function (input) {
                input.addEventListener('change', function () {
                    activatePanel(panel);
                    try {
                        bounds(m.rows, m.color === 'row', w.min.value, w.max.value);
                        m.min = w.min.value; m.max = w.max.value; m.error = '';
                        scheduleRender(panel);
                    } catch (error) { m.error = error.message; mapStatus(m, error.message, true); }
                });
            });
            viewport.addEventListener('wheel', function (event) {
                var layout = w.layout;
                if (!event.ctrlKey && !event.shiftKey) return;
                if (s.mode !== 'heat' || !m.rows.length || !s.times.length || !layout) return;
                var rect = canvas.getBoundingClientRect();
                var x = event.clientX - rect.left - layout.left;
                var y = event.clientY - rect.top - layout.top;
                if (x < 0 || x >= layout.plotWidth || y < 0 || y >= layout.plotHeight) return;
                if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
                event.preventDefault(); activatePanel(panel);
                var delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? layout.plotWidth : 1);
                if (event.shiftKey && !event.ctrlKey) {
                    s.scrollLeft = Math.max(0, Math.min(layout.scrollRange, s.scrollLeft + delta));
                    s.pendingScrollLeft = null; scheduleRender(panel); return;
                }
                var oldWidth = s.columnWidth;
                var nextWidth = Math.max(s.minColumnWidth, Math.min(maxColumnWidth,
                    Math.round(oldWidth * Math.exp(-delta / 300) * 100) / 100));
                // The fit floor can have more than two decimal places. Rounding
                // a tiny wheel step must not reverse the requested direction.
                nextWidth = delta < 0 ? Math.max(oldWidth, nextWidth) : Math.min(oldWidth, nextWidth);
                if (nextWidth === oldWidth) return;
                var scroll = s.pendingScrollLeft === null ? s.scrollLeft : s.pendingScrollLeft;
                var count = s.end - s.start + 1;
                var first = visibleStart(scroll, Math.max(0, count * oldWidth - layout.plotWidth),
                    count, Math.max(1, Math.floor(layout.plotWidth / oldWidth)), oldWidth);
                var anchor = Math.min(count, first + x / oldWidth);
                s.columnWidth = nextWidth;
                s.pendingScrollLeft = Math.max(0, anchor * nextWidth - x);
                scheduleRender(panel);
            }, { passive: false, capture: true });
            viewport.addEventListener('scroll', function () {
                // Ignore the horizontal events generated while applying the
                // shared position. Native vertical scrolling remains local.
                if (viewport.scrollLeft !== w.scrollLeft) {
                    // Native ranges can differ when only some maps need a
                    // vertical scrollbar. Share a position in sample pixels.
                    s.scrollLeft = w.layout && w.layout.nativeMax > 0 ?
                        viewport.scrollLeft / w.layout.nativeMax * w.layout.scrollRange : 0;
                    s.pendingScrollLeft = null;
                    w.scrollLeft = viewport.scrollLeft;
                }
                scheduleRender(panel);
            });
            w.resize = new ResizeObserver(function () { scheduleRender(panel); }); w.resize.observe(viewport);
            parent.intersections.observe(card);
            return m;
        }
        function disposeMap(panel, m) {
            ++m.token;
            if (panelWidget(panel).drag && panelWidget(panel).drag.owner === m) endSidebarDrag(panel);
            var w = m.widget;
            w.resize.disconnect(); panelWidget(panel).intersections.unobserve(w.card);
            if (w.chart) w.chart.dispose();
            w.card.remove();
        }
        function removeMap(panel, m) {
            var s = states[panel];
            s.maps = s.maps.filter(function (entry) { return entry !== m; });
            disposeMap(panel, m);
        }
        function scheduleRender(panel) {
            var w = widgets[panel];
            if (!w || states[panel].mode !== 'heat' || w.frame !== null) return;
            w.frame = requestAnimationFrame(function () { w.frame = null; render(panel); });
        }
        function show(panel) {
            var s = states[panel], w = panelWidget(panel), heat = s.mode === 'heat';
            adapter.lineElement(panel).classList.toggle('hidden', heat);
            w.host.classList.toggle('hidden', !heat);
            if (!heat) endSidebarDrag(panel);
            if (heat) { rangeInputs(panel); scheduleRender(panel); }
            else adapter.resizeLine(panel);
            if (panel === active) syncControls();
        }
        function render(panel) {
            var s = states[panel], parent = panelWidget(panel);
            if (s.mode !== 'heat' || !parent.host.clientWidth) return;
            // Measure once when a Heat map actually needs layout. Line loads and
            // unchanged sample axes on Reload do not measure every label again.
            if (s.maps.length && s.axisTop === null) s.axisTop = axisTop(s.times);
            parent.empty.classList.toggle('hidden', !!s.maps.length);
            parent.empty.textContent = !s.times.length ? 'Load an H5 file' : 'Select metrics, then Plot';
            parent.host.style.setProperty('--heat-sidebar-width', s.sidebarWidth + 'px');
            parent.host.classList.toggle('heat-sidebar-collapsed', s.sidebarWidth === 0);
            if (parent.drag) {
                // Keep the map's right edge in view when resizing a sidebar in
                // a narrow split whose map is wider than its scroll viewport.
                parent.host.scrollLeft = Math.max(0, parent.drag.scrollLeft + parent.drag.owner.widget.card.offsetWidth - parent.drag.mapWidth);
            }
            var available = parent.host.clientHeight - parent.status.offsetHeight;
            s.maps.forEach(function (m) {
                // Sidebar content scrolls independently, so neither status nor
                // instruction wrapping can feed back into the plot height.
                var w = m.widget;
                w.sidebar.inert = s.sidebarWidth === 0;
                w.sidebar.setAttribute('aria-hidden', String(s.sidebarWidth === 0));
                w.resizer.setAttribute('aria-valuenow', s.sidebarWidth);
                w.resizer.setAttribute('aria-valuetext', s.sidebarWidth === 0 ? 'Hidden' : s.sidebarWidth + ' pixels');
                w.resizer.title = s.sidebarWidth === 0 ? 'Drag left to show sidebar' : 'Drag to resize sidebar; drag right to hide';
                var minimum = Math.max(minMapHeight, 1 + s.axisTop + rowHeight + bottomSpace + scrollbarSpace);
                var natural = Math.max(minimum, 1 + s.axisTop + m.group.Sig.length * rowHeight + bottomSpace + scrollbarSpace);
                var height = Math.max(minimum, s.maps.length === 1 ? available : Math.min(available, natural));
                var cssHeight = Math.floor(height) + 'px';
                if (w.card.style.height !== cssHeight) w.card.style.height = cssHeight;
            });
            // Measure after applying sidebar/card sizes, including offscreen
            // maps. One floor per panel keeps every map on the same x scale.
            var layouts = s.maps.map(function (m) { return mapLayout(m.widget, s.axisTop); });
            var sampleCount = Math.max(0, s.end - s.start + 1);
            var plotWidth = layouts.reduce(function (width, layout) { return Math.max(width, layout.plotWidth); }, 0);
            s.minColumnWidth = sampleCount ? Math.min(maxColumnWidth, Math.max(minColumnWidth, plotWidth / sampleCount)) : minColumnWidth;
            s.columnWidth = Math.max(s.columnWidth, s.minColumnWidth);
            if (samplesFit(sampleCount, s.columnWidth, plotWidth)) {
                s.scrollLeft = 0; s.pendingScrollLeft = null;
            }
            if (s.pendingScrollLeft !== null) {
                s.scrollLeft = s.pendingScrollLeft; s.pendingScrollLeft = null;
            }
            s.scrollLeft = Math.max(0, Math.min(s.scrollLeft, sampleCount * s.columnWidth - plotWidth));
            var hostRect = parent.host.getBoundingClientRect();
            s.maps.forEach(function (m, index) { renderMap(panel, m, hostRect, layouts[index]); });
        }
        function mapLayout(w, top) {
            var viewportStyle = getComputedStyle(w.viewport);
            var width = Math.max(1, Math.floor(parseFloat(viewportStyle.width)));
            var height = Math.max(1, Math.floor(parseFloat(viewportStyle.height)));
            var left = Math.min(340, Math.max(140, Math.floor(width * 0.35)));
            var right = 20 + statisticsGap + statistics.length * rowHeight;
            return { width: width, height: height, left: left, right: right, top: top,
                plotWidth: width - left - right, plotHeight: height - top - bottomSpace };
        }
        function nativeScrollMax(w) {
            var v = w.viewport;
            var key = [v.scrollWidth, v.clientWidth, v.offsetWidth, v.scrollHeight, v.clientHeight, v.offsetHeight].join(':');
            if (w.scrollRangeKey !== key) {
                // With scrollbar-gutter:stable, scrollWidth-clientWidth need
                // not equal the reachable range. Measure only on geometry
                // changes and restore synchronously before the browser paints.
                var left = v.scrollLeft;
                v.scrollLeft = v.scrollWidth;
                w.nativeMax = v.scrollLeft;
                v.scrollLeft = left;
                w.scrollRangeKey = key;
            }
            return w.nativeMax;
        }
        function renderMap(panel, m, hostRect, layout) {
            var s = states[panel], w = m.widget;
            var width = layout.width, height = layout.height, left = layout.left, top = layout.top;
            var bottom = bottomSpace, right = layout.right;
            var sampleCount = Math.max(0, s.end - s.start + 1);
            var fits = samplesFit(sampleCount, s.columnWidth, layout.plotWidth);
            var colCount = fits ? sampleCount : Math.max(1, Math.floor(layout.plotWidth / s.columnWidth));
            var rowCount = Math.max(1, Math.floor(layout.plotHeight / rowHeight));
            // Give even sub-gutter sample overflow a real native scroll range.
            var gutter = Math.max(0, w.viewport.offsetWidth - w.viewport.clientWidth);
            var spacerWidth = (fits ? width : Math.max(width, sampleCount * s.columnWidth + left + right) + gutter) + 'px';
            var spacerHeight = Math.max(height, m.rows.length * rowHeight + top + bottom) + 'px';
            if (w.spacer.style.width !== spacerWidth) w.spacer.style.width = spacerWidth;
            if (w.spacer.style.height !== spacerHeight) w.spacer.style.height = spacerHeight;
            // A stale canvas size must not inflate the measured scroll range.
            w.canvas.style.width = width + 'px'; w.canvas.style.height = height + 'px';
            layout.scrollRange = fits ? 0 : Math.max(0, sampleCount * s.columnWidth - layout.plotWidth);
            layout.nativeMax = nativeScrollMax(w);
            w.viewport.scrollLeft = layout.scrollRange ? s.scrollLeft / layout.scrollRange * layout.nativeMax : 0;
            w.scrollLeft = w.viewport.scrollLeft;
            w.layout = layout;
            var rect = w.viewport.getBoundingClientRect();
            if (rect.bottom <= hostRect.top || rect.top >= hostRect.bottom) return;
            var firstCol = s.start + visibleStart(s.scrollLeft, layout.scrollRange,
                sampleCount, colCount, s.columnWidth);
            var lastCol = Math.min(s.end + 1, firstCol + colCount);
            var firstRow = visibleStart(w.viewport.scrollTop, w.viewport.scrollHeight - w.viewport.clientHeight,
                m.rows.length, rowCount, rowHeight);
            var lastRow = Math.min(m.rows.length, firstRow + rowCount);
            var normal = m.color === 'row', scale;
            try { scale = bounds(m.rows, normal, m.min, m.max); }
            catch (error) { m.error = error.message; mapStatus(m, error.message, true); return; }
            var viewKey = JSON.stringify([width, height, firstCol, lastCol, firstRow, lastRow,
                s.columnWidth, m.color, scale, m.busy]);
            if (w.viewKey === viewKey && w.rows === m.rows && w.times === s.times) {
                if (!m.error) summarize(panel, m);
                return;
            }
            if (!w.chart) {
                w.chart = echarts.init(w.canvas, null, { renderer: 'canvas' });
                w.chart.on('click', function (params) {
                    if (!params.value || params.value[5] === undefined) return;
                    activatePanel(panel);
                    s.selected = { key: m.key, name: m.rows[params.value[5]].name };
                    s.maps.forEach(function (entry) { entry.widget.card.classList.toggle('heat-map-selected', entry === m); });
                    mapStatus(m, 'Selected: ' + s.selected.name);
                });
            }
            w.chart.dispatchAction({ type: 'hideTip' });
            if (w.chart.getWidth() !== width || w.chart.getHeight() !== height) {
                w.chart.resize({ width: width, height: height, silent: true });
            }
            var values = [], missing = [], statisticValues = [], statisticMissing = [], labels = [], names = [];
            for (var x = firstCol; x < lastCol; x++) labels.push(String(s.times[x]));
            for (var y = firstRow; y < lastRow; y++) {
                var row = m.rows[y]; names.push(row.name);
                for (var c = firstCol; c < lastCol; c++) {
                    var raw = row.values[c], v = colorValue(row, raw, normal);
                    var point = [c - firstCol, y - firstRow, v === null ? 0 : v, raw, c, y];
                    (v === null ? missing : values).push(point);
                }
                statistics.forEach(function (statistic, index) {
                    var raw = finite(row[statistic]) ? row[statistic] : null;
                    var v = colorValue(row, raw, normal);
                    var point = [index, y - firstRow, v === null ? 0 : v, raw, -1, y];
                    (v === null ? statisticMissing : statisticValues).push(point);
                });
            }
            var gridWidth = Math.max(1, labels.length) * s.columnWidth;
            var gridHeight = Math.max(1, names.length) * rowHeight;
            var borderWidth = s.columnWidth >= 4 ? 1 : 0;
            var legendText = [String(scale[1]) + (normal ? ' · normalized' : ' · raw'), String(scale[0])];
            var legendKey = JSON.stringify([width, legendText]);
            var legend = w.legendLayout && w.legendLayout.key === legendKey ? w.legendLayout : null;
            w.chart.setOption({
                animation: false,
                title: { show: !names.length || !labels.length, left: 'center', top: 'middle',
                    text: m.busy ? 'Loading metrics…' : !s.times.length ? 'Load an H5 file' :
                        !names.length ? 'Select metrics, then Plot' : 'No samples in this file',
                    textStyle: { fontSize: 14, fontWeight: 'normal', color: '#666' } },
                grid: [{ left: left, top: top, width: gridWidth, height: gridHeight },
                    { left: left + gridWidth + statisticsGap, top: top, width: statistics.length * rowHeight, height: gridHeight }],
                xAxis: [{ type: 'category', data: labels, position: 'top', name: '',
                    axisTick: { interval: 0 }, splitArea: { show: false },
                    axisLabel: { interval: Math.max(0, Math.ceil(48 / s.columnWidth) - 1), rotate: 50, fontSize: 10 } },
                    { type: 'category', gridIndex: 1, data: statistics, position: 'top', show: !!names.length,
                        axisTick: { show: false }, axisLine: { show: false },
                        axisLabel: { interval: 0, rotate: 50, fontSize: 10 } }],
                yAxis: [{ type: 'category', data: names, inverse: true,
                    axisLabel: { width: left - 20, overflow: 'truncate', fontSize: 11 },
                    axisTick: { show: false } },
                    { type: 'category', gridIndex: 1, data: names, inverse: true,
                        axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } }],
                tooltip: { trigger: 'item', confine: true, formatter: function (p) {
                    var v = p.value, r = m.rows[v[5]], statistic = v[4] === -1;
                    var raw = statistic ? v[3] : r.values[v[4]];
                    return '<b>' + escapeHtml(r.name) + '</b><br>' + (statistic ?
                        'Statistic: ' + statistics[v[0]] + '<br>Scope: all samples in file<br>Valid samples: ' +
                            r.validCount + ' / ' + s.times.length :
                        'Sample: ' + escapeHtml(s.times[v[4]]) + ' (index ' + v[4] + ')') +
                        '<br>Raw value: ' + (raw === null ? 'No valid data' : escapeHtml(raw)) +
                        (normal && raw !== null ? '<br>Normalized: ' + colorValue(r, raw, true).toPrecision(6) : '');
                } },
                visualMap: { type: 'continuous', min: scale[0], max: scale[1], dimension: 2,
                    seriesIndex: [0, 2], calculable: false, orient: 'horizontal',
                    left: legend ? legendLeft(left, gridWidth, legend.width, width) : 0,
                    top: top + gridHeight + 8, bottom: null, padding: 0,
                    itemWidth: 12, itemHeight: legend ? legend.length : 130, precision: 4,
                    textStyle: { fontSize: legend ? legend.fontSize : 12 }, text: legendText,
                    inRange: { color: palette } },
                series: [
                    { id: 'heat-values', type: 'heatmap', data: values, progressive: 0,
                        itemStyle: { borderColor: '#e2e8ee', borderWidth: borderWidth },
                        emphasis: { itemStyle: { borderColor: '#111', borderWidth: borderWidth * 2 } } },
                    { id: 'heat-missing', type: 'heatmap', data: missing, progressive: 0,
                        itemStyle: { color: '#b9bec5', borderColor: '#e2e8ee', borderWidth: borderWidth } },
                    { id: 'heat-statistics', type: 'heatmap', xAxisIndex: 1, yAxisIndex: 1, data: statisticValues, progressive: 0,
                        itemStyle: { borderColor: '#e2e8ee', borderWidth: 1 },
                        emphasis: { itemStyle: { borderColor: '#111', borderWidth: 2 } } },
                    { id: 'heat-statistics-missing', type: 'heatmap', xAxisIndex: 1, yAxisIndex: 1, data: statisticMissing, progressive: 0,
                        itemStyle: { color: '#b9bec5', borderColor: '#e2e8ee', borderWidth: 1 } }
                ]
            });
            fitLegend(w, width, left, gridWidth, legendKey);
            w.canvas.style.position = 'sticky';
            w.viewKey = viewKey; w.rows = m.rows; w.times = s.times;
            if (m.error) mapStatus(m, m.error, true);
            else if (m.busy) mapStatus(m, 'Loading metrics…');
            else summarize(panel, m);
        }
        function selection(panel) {
            var result = Object.create(null);
            states[panel].maps.forEach(function (m) {
                if (!m.loaded) return;
                result[m.key] = Object.assign({}, clone(m.group), {
                    Heat: { color: m.color, min: m.min, max: m.max }
                });
            });
            return clone(result);
        }
        function queryMap(panel, m, removeOnError) {
            var s = states[panel], epoch = s.token, token = ++m.token;
            m.busy = true; m.error = ''; mapStatus(m, 'Loading metrics…'); scheduleRender(panel);
            function current() { return s.token === epoch && m.token === token && s.maps.includes(m); }
            function finishWaiting() {
                if (s.waiting && !s.maps.some(function (entry) { return entry.busy; })) {
                    s.waiting = false;
                    if (!panelWidget(panel).status.classList.contains('heat-error')) status(panel, '');
                }
            }
            var query = clone(m.group), missing = removeOnError ? [] : query.Sig.filter(function (name) {
                return s.missing.includes(name);
            });
            // Restoring existing plots across Line/Heat keeps reload's absent
            // metrics as empty rows. New Plot queries stay strict.
            query.Sig = query.Sig.filter(function (name) { return !missing.includes(name); });
            var available = new Map(), reusableRows = new Map();
            if (removeOnError) s.maps.forEach(function (entry) {
                if (entry === m || !entry.loaded || entry.busy || entry.dataEpoch !== epoch) return;
                entry.rows.forEach(function (row) {
                    // Reload's absent-metric placeholders must not make a new
                    // Plot succeed for a metric that is not in the loaded file.
                    if (!s.missing.includes(row.name)) {
                        available.set(row.name, row.values);
                        reusableRows.set(row.name, row);
                    }
                });
            });
            var plan = MetricSamples.plan({ [m.key]: query }, available);
            var request = Object.keys(plan.query).length ? adapter.query(plan.query, panel) : Promise.resolve({});
            return request.then(function (data) {
                if (!current()) return false;
                data = plan.merge(data);
                missing.forEach(function (name) { data[m.key].Sig[name] = s.times.map(function () { return null; }); });
                var rows = rowsFromGroups({ [m.key]: m.group }, data, s.times.length, reusableRows);
                m.data = data[m.key]; m.rows = rows; m.busy = false; m.loaded = true; s.loaded = true;
                m.dataEpoch = epoch;
                summarize(panel, m); finishWaiting(); scheduleRender(panel); return true;
            }).catch(function (error) {
                if (current()) {
                    m.busy = false; m.error = error.message;
                    if (removeOnError) { removeMap(panel, m); status(panel, m.key + ': ' + error.message, true); }
                    else mapStatus(m, error.message, true);
                    finishWaiting();
                    scheduleRender(panel);
                }
                return false;
            });
        }
        function replaceGroups(groups, panel) {
            var s = states[panel], old = s.maps, maps = [];
            Object.keys(groups).forEach(function (key) {
                if (!groups[key].Sig.length) return;
                var m = old.find(function (entry) { return entry.key === key; });
                if (!m) m = createMap(panel, key, groups[key]);
                m.group = clone(groups[key]); m.group.Sig = Array.from(new Set(m.group.Sig));
                m.rows = []; m.data = null; m.loaded = false; m.error = '';
                syncHeatControls(m); m.widget.card.classList.remove('heat-map-selected');
                m.widget.viewport.scrollTop = 0;
                panelWidget(panel).host.appendChild(m.widget.card); maps.push(m);
            });
            old.forEach(function (m) { if (!maps.includes(m)) disposeMap(panel, m); });
            s.maps = maps; s.selected = null;
            return Promise.all(maps.map(function (m) { return queryMap(panel, m, false); }));
        }
        function setMode(value, panel) {
            var s = states[panel];
            if (value === s.mode) return;
            if (value === 'heat') {
                ++s.token;
                var groups = clone(adapter.selection(panel));
                var zoom = adapter.lineRange(panel, s.times.length);
                s.start = zoom[0]; s.end = zoom[1]; s.mode = 'heat';
                s.scrollLeft = 0; s.pendingScrollLeft = null;
                show(panel);
                if (s.times.length) { s.loaded = true; replaceGroups(groups, panel); }
            } else {
                if (s.maps.some(function (m) { return m.busy; })) {
                    s.waiting = true; status(panel, 'Wait for the metric query to finish'); syncControls(); return;
                }
                if (s.loaded) {
                    var data = Object.create(null), groups = selection(panel);
                    s.maps.forEach(function (m) {
                        if (!m.loaded) return;
                        var entry = Object.assign({}, m.data, groups[m.key], { Sig: {} });
                        m.group.Sig.forEach(function (name) { entry.Sig[name] = m.data.Sig[name]; });
                        data[m.key] = entry;
                    });
                    adapter.renderLine(data, panel, [s.start, s.end]);
                }
                s.mode = 'line'; status(panel, ''); show(panel);
            }
        }
        mode.addEventListener('change', function () { setMode(mode.value, active); });

        return {
            isHeat: function (panel) { return states[panel].mode === 'heat'; },
            activate: function (panel) { active = panel; syncControls(); if (states[panel].mode === 'heat') rangeInputs(panel); },
            selection: selection,
            reloadSelection: function (panel) {
                // Include pending Plots so a successful reload can finish them
                // from the new dataset without waiting for an older query.
                var result = Object.create(null);
                states[panel].maps.forEach(function (m) { result[m.key] = clone(m.group); });
                return result;
            },
            datasetReloaded: function (meta, panel, data, missing) {
                var s = states[panel];
                ++s.token; s.waiting = false;
                updateTimes(s, meta.times); s.config = meta.config || {};
                s.start = Math.max(0, Math.min(s.start, s.times.length - 1));
                s.end = Math.min(Math.max(s.start, s.end), s.times.length - 1);
                s.missing = missing.slice();
                s.notice = missing.length ? 'Absent from this file: ' + missing.join(', ') : '';
                if (s.mode !== 'heat') return;
                s.maps.forEach(function (m) {
                    ++m.token;
                    m.rows = rowsFromGroups({[m.key]:m.group}, data, s.times.length);
                    m.data = data[m.key]; m.loaded = true; m.busy = false; m.error = '';
                    m.dataEpoch = s.token;
                    m.widget.viewKey = null;
                });
                s.loaded = true; status(panel, ''); show(panel);
            },
            datasetLoaded: function (meta, panel) {
                var s = states[panel], groups = selection(panel), heat = s.mode === 'heat';
                endSidebarDrag(panel);
                ++s.token; s.loaded = false; s.selected = null; s.notice = ''; s.waiting = false;
                s.missing = [];
                updateTimes(s, meta.times); s.config = meta.config || {}; s.start = 0; s.end = s.times.length - 1;
                s.scrollLeft = 0; s.pendingScrollLeft = null;
                if (heat) {
                    var available = new Set(meta.signal), missing = [];
                    Object.keys(groups).forEach(function (group) {
                        groups[group].Sig = groups[group].Sig.filter(function (name) {
                            if (available.has(name)) return true;
                            missing.push(name); return false;
                        });
                        if (!groups[group].Sig.length) delete groups[group];
                    });
                    if (missing.length) s.notice = 'Absent from this file: ' + Array.from(new Set(missing)).join(', ');
                    status(panel, ''); panelWidget(panel).host.scrollTop = 0;
                    s.loaded = true; replaceGroups(groups, panel); show(panel);
                } else {
                    s.maps.forEach(function (m) { disposeMap(panel, m); }); s.maps = [];
                }
            },
            plot: function (names, panel) {
                var s = states[panel], unique = Array.from(new Set(names));
                if (!s.times.length) { status(panel, 'Load a file containing samples before plotting', true); return Promise.resolve(false); }
                if (!unique.length) { status(panel, 'Select at least one metric', true); return Promise.resolve(false); }
                var key;
                do { key = 'Heatmap ' + s.nextPlot++; } while (s.maps.some(function (m) { return m.key === key; }));
                var m = createMap(panel, key, { Max: 'dataMax', Stack: false, Sig: unique });
                s.maps.push(m); status(panel, '');
                return queryMap(panel, m, true);
            },
            append: function (data, panel) {
                var s = states[panel]; status(panel, '');
                return Promise.all(Object.keys(data).map(function (key) {
                    var group = Object.assign({}, data[key], { Sig: Object.keys(data[key].Sig) });
                    if (!group.Sig.length) return false;
                    var name = key, suffix = 2;
                    while (s.maps.some(function (m) { return m.key === name; })) name = key + ' (' + suffix++ + ')';
                    var m = createMap(panel, name, group); s.maps.push(m);
                    try {
                        // Template import already returned the samples. Validate
                        // them under the new map name without querying them again.
                        m.rows = rowsFromGroups({ [name]: m.group }, { [name]: data[key] }, s.times.length);
                        m.data = data[key]; m.loaded = true; s.loaded = true;
                        m.dataEpoch = s.token;
                        summarize(panel, m); scheduleRender(panel); return true;
                    } catch (error) {
                        removeMap(panel, m); status(panel, name + ': ' + error.message, true);
                        scheduleRender(panel); return false;
                    }
                }));
            },
            clear: function (panel) {
                var s = states[panel]; ++s.token;
                s.maps.forEach(function (m) { disposeMap(panel, m); });
                s.maps = []; s.selected = null; s.notice = ''; s.loaded = true; s.nextPlot = 1; s.waiting = false;
                status(panel, ''); scheduleRender(panel);
            },
            removeSelected: function (panel) {
                var s = states[panel], selected = s.selected;
                if (!selected) { status(panel, 'Click a cell to select a metric before pressing Delete'); return; }
                var m = s.maps.find(function (entry) { return entry.key === selected.key; });
                if (!m) return;
                m.group.Sig = m.group.Sig.filter(function (name) { return name !== selected.name; });
                if (!m.group.Sig.length) removeMap(panel, m);
                else {
                    m.rows = m.rows.filter(function (row) { return row.name !== selected.name; });
                    m.widget.card.classList.remove('heat-map-selected');
                }
                s.selected = null; status(panel, ''); scheduleRender(panel);
            },
            zoomFromInputs: function (panel) {
                var s = states[panel];
                var start = document.getElementById('zoom_start').value;
                var end = document.getElementById('zoom_end').value;
                var a = s.times.findIndex(function (t) { return String(t) === start; });
                var b = s.times.findIndex(function (t) { return String(t) === end; });
                if (a < 0 || b < a) { status(panel, 'Start and End must be sample labels in file order', true); return; }
                s.start = a; s.end = b; s.scrollLeft = 0; s.pendingScrollLeft = null;
                status(panel, ''); rangeInputs(panel); scheduleRender(panel);
            },
            syncLineZoom: function (panel, zoom) {
                var s = states[panel];
                if (s.mode !== 'heat' || !s.times.length) return;
                var a = zoom.startValue, b = zoom.endValue;
                if (!Number.isInteger(a) || !Number.isInteger(b)) return;
                s.start = Math.max(0, a); s.end = Math.min(s.times.length - 1, b);
                s.scrollLeft = 0; s.pendingScrollLeft = null;
                rangeInputs(panel); scheduleRender(panel);
            }
        };
    }
    return { install: install, rowsFromGroups: rowsFromGroups, colorValue: colorValue,
        bounds: bounds, escapeHtml: escapeHtml };
}));
