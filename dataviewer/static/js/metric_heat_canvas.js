/* Visible Heat samples. The caller owns data, statistics, axes and scroll state. */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MetricHeatCanvas = api;
}(typeof window === 'undefined' ? this : window, function () {
    'use strict';

    function indexAt(centers, size, coordinate) {
        if (!centers.length || coordinate < centers[0] - size / 2 ||
            coordinate >= centers[centers.length - 1] + size / 2) return -1;
        var lo = 0, hi = centers.length;
        while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (coordinate < centers[mid] + size / 2) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }
    function hitTest(frame, x, y) {
        if (!frame) return null;
        var col = indexAt(frame.x, frame.bandWidth, x), row = indexAt(frame.y, frame.bandHeight, y);
        return col < 0 || row < 0 ? null : { col: col, row: row };
    }
    function sameCell(a, b) { return a === b || !!a && !!b && a.col === b.col && a.row === b.row; }
    function sameRange(a, b) { return a === b || !!a && !!b && a[0] === b[0] && a[1] === b[1]; }
    function colorMap(ec, palette) {
        var colors = palette.map(function (c) { return ec.color.parse(c); });
        var scratch = [0, 0, 0, 1], unit = [0, 1];
        return function (value, scale) {
            if (value === null) return '#b9bec5';
            ec.color.fastLerp(ec.number.linearMap(value, scale, unit, true), colors, scratch);
            return ec.color.stringify(scratch, 'rgba');
        };
    }
    function create(host, options) {
        var ec = options.echarts, fill = colorMap(ec, options.palette);
        var canvas = document.createElement('canvas'); canvas.className = 'heat-samples';
        var highlight = document.createElement('canvas'); highlight.className = 'heat-sample-highlight';
        highlight.width = highlight.height = 0;
        var tip = document.createElement('div'); tip.className = 'heat-sample-tooltip';
        host.appendChild(canvas); host.appendChild(highlight); host.appendChild(tip);
        var ctx = canvas.getContext('2d'), frame = null, cell = null, range = null;
        var pointer = null, nextRange = null, raf = null, disposed = false, originX = 0, originY = 0;
        var saved = document.createElement('canvas'), savedArea = null;
        function point(at) {
            var row = frame.rows[frame.firstRow + at.row], col = frame.firstCol + at.col;
            var raw = row.values[col], value = options.colorValue(row, raw, frame.normal);
            return [at.col, at.row, value === null ? 0 : value, raw, col, frame.firstRow + at.row];
        }
        function selected(x, y, value) {
            return !!cell && cell.col === x && cell.row === y ||
                !!range && value !== null && value >= range[0] && value <= range[1];
        }
        function rect(at) {
            return { x: frame.x[at.col] - (frame.bandWidth + .5) / 2,
                y: frame.y[at.row] - (frame.bandHeight + .5) / 2,
                width: frame.bandWidth + .5, height: frame.bandHeight + .5 };
        }
        function paint(area, hoverOnly) {
            if (!frame || !frame.x.length || !frame.y.length) return;
            var ctx = (hoverOnly ? highlight : canvas).getContext('2d');
            var x0 = 0, x1 = frame.x.length, y0 = 0, y1 = frame.y.length;
            ctx.save();
            if (area) {
                ctx.beginPath(); ctx.rect(area.x, area.y, area.width, area.height); ctx.clip();
                // Include neighboring overlapping bands and strokes when repairing a hover patch.
                while (x0 < x1 && frame.x[x0] + frame.bandWidth / 2 + 2 < area.x) ++x0;
                while (x1 > x0 && frame.x[x1 - 1] - frame.bandWidth / 2 - 2 > area.x + area.width) --x1;
                while (y0 < y1 && frame.y[y0] + frame.bandHeight / 2 + 2 < area.y) ++y0;
                while (y1 > y0 && frame.y[y1 - 1] - frame.bandHeight / 2 - 2 > area.y + area.height) --y1;
                ctx.clearRect(area.x, area.y, area.width, area.height);
            } else ctx.clearRect(originX, originY, canvas.width / frame.dpr, canvas.height / frame.dpr);
            var border = frame.columnWidth >= 4 ? 1 : 0;
            var passes = hoverOnly || !frame.hoverLayer && (cell || range) ? 3 : 2;
            var lastValue, lastColor;
            for (var pass = hoverOnly ? 2 : 0; pass < passes; ++pass) {
                for (var y = y0; y < y1; ++y) {
                    var row = frame.rows[frame.firstRow + y];
                    for (var x = x0; x < x1; ++x) {
                        var raw = row.values[frame.firstCol + x];
                        if (pass < 2 && (raw === null) !== (pass === 1)) continue;
                        var value = options.colorValue(row, raw, frame.normal), emphasis = selected(x, y, value);
                        if (pass === 2 ? !emphasis : emphasis && !frame.hoverLayer) continue;
                        if (lastColor === undefined || value !== lastValue) { lastColor = fill(value, frame.scale); lastValue = value; }
                        ctx.fillStyle = emphasis ? ec.color.liftColor(lastColor) : lastColor;
                        ctx.strokeStyle = emphasis && raw !== null ? '#111' : '#e2e8ee';
                        ctx.lineWidth = emphasis && raw !== null ? border * 2 : border;
                        ctx.beginPath();
                        ctx.rect(frame.x[x] - (frame.bandWidth + .5) / 2, frame.y[y] - (frame.bandHeight + .5) / 2,
                            frame.bandWidth + .5, frame.bandHeight + .5);
                        ctx.fill(); if (ctx.lineWidth && border) ctx.stroke();
                    }
                }
            }
            ctx.restore();
        }
        function patch(at) {
            var r = rect(at), dpr = frame.dpr;
            var x = Math.floor((r.x - 2) * dpr) / dpr, y = Math.floor((r.y - 2) * dpr) / dpr;
            return { x: x, y: y, width: Math.ceil((r.x + r.width + 2) * dpr) / dpr - x,
                height: Math.ceil((r.y + r.height + 2) * dpr) / dpr - y };
        }
        function restoreCell() {
            if (frame.hoverLayer) { clearHighlight(); return; }
            if (!savedArea) return;
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(savedArea.x, savedArea.y, saved.width, saved.height);
            ctx.drawImage(saved, savedArea.x, savedArea.y); ctx.restore(); savedArea = null;
        }
        function paintCell() {
            if (!cell) return;
            var area = patch(cell), dpr = frame.dpr;
            if (frame.hoverLayer) { paintHighlight(area); return; }
            // Preserve original pixels in a tiny bitmap. Repainting a clipped
            // antialiased path on mouseout can round differently at fractional DPR.
            savedArea = { x: Math.round((area.x - originX) * dpr), y: Math.round((area.y - originY) * dpr) };
            saved.width = Math.round(area.width * dpr); saved.height = Math.round(area.height * dpr);
            saved.getContext('2d').drawImage(canvas, -savedArea.x, -savedArea.y);
            paint(area);
        }
        function clearHighlight() { highlight.width = highlight.height = 0; }
        function paintHighlight(area) {
            var dpr = frame.dpr;
            highlight.width = Math.round(area.width * dpr); highlight.height = Math.round(area.height * dpr);
            highlight.style.left = area.x + 'px'; highlight.style.top = area.y + 'px';
            highlight.style.width = highlight.width / dpr + 'px'; highlight.style.height = highlight.height / dpr + 'px';
            highlight.getContext('2d').setTransform(dpr, 0, 0, dpr, -area.x * dpr, -area.y * dpr);
            paint(area, true);
        }
        function cancel() { if (raf !== null) cancelAnimationFrame(raf); raf = null; }
        function updateHover() {
            raf = null;
            if (!frame || disposed) return;
            var at = pointer && hitTest(frame, pointer.x, pointer.y), old = cell;
            var changed = !sameCell(old, at), changedRange = !sameRange(range, nextRange);
            if (changedRange) {
                savedArea = null; clearHighlight(); cell = null; range = nextRange;
                if (!frame.hoverLayer) paint();
                cell = at;
                if (frame.hoverLayer && range) paintHighlight({x: originX, y: originY,
                    width: canvas.width / frame.dpr, height: canvas.height / frame.dpr});
                else paintCell();
            } else if (changed) {
                restoreCell(); cell = at; paintCell();
            }
            if (!cell) {
                tip.style.display = 'none';
                if (old) options.hideIndicator(true);
                if (!pointer) options.cursor('default');
                return;
            }
            options.cursor('pointer');
            var value = point(cell);
            if (changed || tip.style.display !== 'block') {
                tip.innerHTML = options.format(value);
                tip.style.borderColor = fill(options.colorValue(frame.rows[value[5]], value[3], frame.normal), frame.scale);
                tip.style.display = 'block';
                if (value[3] !== null) options.showIndicator(options.colorValue(frame.rows[value[5]], value[3], frame.normal));
                else options.hideIndicator();
            }
            var x = pointer.x + 20, y = pointer.y + 20;
            if (x + tip.offsetWidth > frame.width) x = pointer.x - tip.offsetWidth - 20;
            if (y + tip.offsetHeight > frame.height) y = pointer.y - tip.offsetHeight - 20;
            x = Math.max(0, Math.min(x, frame.width - tip.offsetWidth));
            y = Math.max(0, Math.min(y, frame.height - tip.offsetHeight));
            tip.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
        }
        function scheduleHover() { if (!disposed && raf === null) raf = requestAnimationFrame(updateHover); }
        function move(event) {
            if (!frame) return;
            var bounds = host.getBoundingClientRect(); pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
            if (hitTest(frame, pointer.x, pointer.y)) nextRange = null;
            scheduleHover();
        }
        function leave() { pointer = null; nextRange = null; scheduleHover(); }
        function click(event) {
            if (!frame) return;
            var bounds = host.getBoundingClientRect(), at = hitTest(frame, event.clientX - bounds.left, event.clientY - bounds.top);
            if (at) options.select(point(at));
        }
        function resetInteraction() {
            cancel(); pointer = null; cell = null; range = null; nextRange = null;
            savedArea = null; saved.width = 0; saved.height = 0;
            clearHighlight();
            tip.style.display = 'none'; tip.innerHTML = ''; options.hideIndicator(); options.cursor('default');
        }
        host.addEventListener('mousemove', move); host.addEventListener('mouseleave', leave); host.addEventListener('click', click);
        return {
            render: function (next) {
                if (disposed) return;
                resetInteraction(); frame = next;
                if (!frame.x.length || !frame.y.length) { canvas.width = 0; canvas.height = 0; return; }
                var dpr = frame.dpr;
                // Device-aligned cropping keeps the same transform as ECharts and includes edge strokes.
                originX = Math.floor((frame.left - 2) * dpr) / dpr;
                originY = Math.floor((frame.top - 2) * dpr) / dpr;
                var width = Math.ceil((frame.left + frame.gridWidth + 2) * dpr) - Math.round(originX * dpr);
                var height = Math.ceil((frame.top + frame.gridHeight + 2) * dpr) - Math.round(originY * dpr);
                if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
                canvas.style.left = originX + 'px'; canvas.style.top = originY + 'px';
                canvas.style.width = width / dpr + 'px'; canvas.style.height = height / dpr + 'px';
                ctx.setTransform(dpr, 0, 0, dpr, -originX * dpr, -originY * dpr); paint();
            },
            highlightRange: function (value) { nextRange = value ? value.slice() : null; scheduleHover(); },
            hide: function () { var dirty = cell || range; resetInteraction(); if (dirty) paint(); },
            suspend: function () { resetInteraction(); frame = null; canvas.width = 0; canvas.height = 0; },
            dispose: function () {
                if (disposed) return;
                disposed = true; resetInteraction(); frame = null; canvas.width = 0; canvas.height = 0;
                host.removeEventListener('mousemove', move); host.removeEventListener('mouseleave', leave); host.removeEventListener('click', click);
                canvas.remove(); highlight.remove(); tip.remove();
            }
        };
    }
    return { create: create, hitTest: hitTest, colorMap: colorMap };
}));
