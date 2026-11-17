/* Visible Heat samples with device-pixel geometry and viewport bitmap reuse.
 * The caller owns data, statistics, axes and scroll state. Cache release keeps
 * the displayed frame and interaction intact. No pixel readback is performed.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MetricHeatCanvas = api;
}(typeof window === 'undefined' ? this : window, function () {
    'use strict';

    // All geometry is global device-pixel geometry. The optional diagnostic
    // arrays have the same shape as the actual arrays and are never frame data.
    function axisGeometry(start, extent, count, dpr, border, diagnostics) {
        var axis = { count: count, stepCss: count ? extent / count : 0,
            nominal: [], fill: { start: [], end: [] },
            normal: { outerStart: [], innerStart: [], innerEnd: [], outerEnd: [] },
            emphasis: { outerStart: [], innerStart: [], innerEnd: [], outerEnd: [] } };
        if (diagnostics) {
            axis.ideal = { nominal: [], fill: { start: [], end: [] },
                normal: { outerStart: [], innerStart: [], innerEnd: [], outerEnd: [] },
                emphasis: { outerStart: [], innerStart: [], innerEnd: [], outerEnd: [] } };
            axis.error = { nominal: [], fill: { start: [], end: [] },
                normal: { outerStart: [], innerStart: [], innerEnd: [], outerEnd: [] },
                emphasis: { outerStart: [], innerStart: [], innerEnd: [], outerEnd: [] } };
            axis.maxError = 0;
        }
        function add(group, edge, ideal) {
            var actual = Math.round(ideal), values = edge === null ? axis[group] : axis[group][edge];
            values.push(actual);
            if (diagnostics) {
                (edge === null ? axis.ideal[group] : axis.ideal[group][edge]).push(ideal);
                (edge === null ? axis.error[group] : axis.error[group][edge]).push(actual - ideal);
                axis.maxError = Math.max(axis.maxError, Math.abs(actual - ideal));
            }
        }
        for (var i = 0; i <= count; ++i) add('nominal', null, (start + i * axis.stepCss) * dpr);
        for (var cell = 0; cell < count; ++cell) {
            // Preserve the original +0.5 CSS fill extension and stroke widths.
            // Each ideal edge is rounded independently, never from a rounded edge.
            var left = start + cell * axis.stepCss - .25;
            var right = start + (cell + 1) * axis.stepCss + .25;
            add('fill', 'start', left * dpr); add('fill', 'end', right * dpr);
            var groups = ['normal', 'emphasis'];
            for (var g = 0; g < groups.length; ++g) {
                var halfStroke = border * (g + 1) / 2, name = groups[g];
                add(name, 'outerStart', (left - halfStroke) * dpr);
                add(name, 'innerStart', (left + halfStroke) * dpr);
                add(name, 'innerEnd', (right - halfStroke) * dpr);
                add(name, 'outerEnd', (right + halfStroke) * dpr);
            }
        }
        return axis;
    }
    function frameGeometry(frame, diagnostics) {
        var dpr = frame.dpr, border = frame.columnWidth >= 4 ? 1 : 0;
        var x = axisGeometry(frame.left, frame.gridWidth, frame.x.length, dpr, border, diagnostics);
        var y = axisGeometry(frame.top, frame.gridHeight, frame.y.length, dpr, border, diagnostics);
        var origin = { x: Math.floor((frame.left - 2) * dpr), y: Math.floor((frame.top - 2) * dpr) };
        var result = { unit: 'global-device-pixels', dpr: dpr, borderCss: border,
            origin: origin, width: Math.ceil((frame.left + frame.gridWidth + 2) * dpr) - origin.x,
            height: Math.ceil((frame.top + frame.gridHeight + 2) * dpr) - origin.y, x: x, y: y };
        if (diagnostics) result.maxError = Math.max(x.maxError, y.maxError);
        return result;
    }
    function indexAt(bounds, coordinate, dpr) {
        // Comparing in CSS space makes the exact CSS boundary b / DPR belong to
        // the next cell even when (b / DPR) * DPR would round below b.
        if (bounds.length < 2 || !Number.isFinite(coordinate) || coordinate < bounds[0] / dpr ||
            coordinate >= bounds[bounds.length - 1] / dpr) return -1;
        var lo = 0, hi = bounds.length - 1;
        while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (coordinate < bounds[mid + 1] / dpr) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }
    function hitGeometry(geometry, x, y) {
        if (!geometry) return null;
        var col = indexAt(geometry.x.nominal, x, geometry.dpr);
        var row = indexAt(geometry.y.nominal, y, geometry.dpr);
        return col < 0 || row < 0 ? null : { col: col, row: row };
    }
    function nominalAxis(start, extent, count, dpr) {
        var result = [], step = count ? extent / count : 0;
        for (var i = 0; i <= count; ++i) result.push(Math.round((start + i * step) * dpr));
        return result;
    }
    function hitTest(frame, x, y) {
        if (!frame) return null;
        var col = indexAt(nominalAxis(frame.left, frame.gridWidth, frame.x.length, frame.dpr), x, frame.dpr);
        var row = indexAt(nominalAxis(frame.top, frame.gridHeight, frame.y.length, frame.dpr), y, frame.dpr);
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
        var ctx = canvas.getContext('2d'), frame = null, geometry = null, cell = null, range = null;
        var pointer = null, clickPointer = null, nextRange = null, raf = null, disposed = false;
        var saved = document.createElement('canvas'), savedArea = null;
        // Disabled mode is the full-paint oracle; it allocates no cache canvas.
        var reuseEnabled = options.bitmapReuse !== false;
        var bitmap = null, bitmapContext = null, cached = null, cacheUnavailable = false;
        var stats = { renders: 0, full: 0, reuse: 0, cacheBytes: 0,
            paintCandidates: 0, collectPaintCounts: false, cacheFailures: 0, lastCacheError: null, last: null };
        function recoverableCacheError(error) {
            return !!error && ['InvalidStateError', 'IndexSizeError', 'QuotaExceededError',
                'UnknownError', 'OperationError', 'NotSupportedError', 'RangeError'].indexOf(error.name) >= 0;
        }
        function releaseBitmap() {
            var previous = bitmap;
            cached = null; bitmap = null; bitmapContext = null; stats.cacheBytes = 0;
            if (previous) {
                try { previous.width = previous.height = 0; }
                catch (error) { if (!recoverableCacheError(error)) throw error; }
            }
        }
        function releaseCache() {
            releaseBitmap(); cacheUnavailable = false;
        }
        function cacheFailure(error) {
            releaseBitmap(); cacheUnavailable = true; ++stats.cacheFailures;
            stats.lastCacheError = { name: error.name, message: String(error.message || '') };
        }
        function edgeArrays(axis) {
            return [axis.fill.start, axis.fill.end,
                axis.normal.outerStart, axis.normal.innerStart, axis.normal.innerEnd, axis.normal.outerEnd,
                axis.emphasis.outerStart, axis.emphasis.innerStart, axis.emphasis.innerEnd, axis.emphasis.outerEnd];
        }
        function axisReuse(oldAxis, axis, oldFirst, first, origin, extent) {
            var begin = Math.max(oldFirst, first), end = Math.min(oldFirst + oldAxis.count, first + axis.count);
            if (end <= begin) return { reason: 'no-overlap' };
            var shift = axis.nominal[begin - first] - oldAxis.nominal[begin - oldFirst];
            if (!Number.isInteger(shift)) return { reason: 'invalid-device-shift' };
            var oldEdges = edgeArrays(oldAxis), edges = edgeArrays(axis);
            for (var index = begin; index < end; ++index) {
                var a = index - first, b = index - oldFirst;
                // Every nominal, fill and stroke edge must translate exactly.
                // A fractional step can produce incompatible rounded patterns;
                // there is no tolerance or approximate translation in this guard.
                if (axis.nominal[a] !== oldAxis.nominal[b] + shift ||
                    axis.nominal[a + 1] !== oldAxis.nominal[b + 1] + shift) return { reason: 'nominal-edge-shift' };
                for (var edge = 0; edge < edges.length; ++edge) {
                    if (edges[edge][a] !== oldEdges[edge][b] + shift) return { reason: 'fill-stroke-edge-shift' };
                }
            }
            var low = Math.max(0, shift), high = Math.min(extent, extent + shift);
            if (shift !== 0 || begin !== first || begin !== oldFirst ||
                end !== first + axis.count || end !== oldFirst + oldAxis.count) {
                // Discard the first/last common cells plus their widest stroke.
                // This excludes any contributions from cells absent in either
                // frame, including later null/emphasis passes, from the copy.
                low = Math.max(low, axis.emphasis.outerEnd[begin - first] - origin + 1);
                high = Math.min(high, axis.emphasis.outerStart[end - first - 1] - origin - 1);
            }
            return high > low ? { low: low, high: high, shift: shift, begin: begin, end: end } :
                { reason: 'no-safe-interior' };
        }
        function reusePlan() {
            if (!reuseEnabled) return { reason: 'reuse-disabled' };
            if (cacheUnavailable) return { reason: 'cache-unavailable' };
            if (!cached) return { reason: 'empty-cache' };
            if (cached.rows !== frame.rows || cached.times !== frame.times) return { reason: 'data-identity' };
            if (cached.normal !== frame.normal || !sameRange(cached.scale, frame.scale)) return { reason: 'color-scale' };
            var keys = ['dpr', 'columnWidth', 'bandWidth', 'bandHeight', 'left', 'top',
                'width', 'height', 'gridWidth', 'gridHeight', 'hoverLayer'];
            for (var i = 0; i < keys.length; ++i) {
                if (cached[keys[i]] !== frame[keys[i]]) return { reason: 'geometry-' + keys[i] };
            }
            if (cached.geometry.origin.x !== geometry.origin.x || cached.geometry.origin.y !== geometry.origin.y ||
                bitmap.width !== canvas.width || bitmap.height !== canvas.height) return { reason: 'canvas-geometry' };
            var horizontal = axisReuse(cached.geometry.x, geometry.x, cached.firstCol, frame.firstCol,
                geometry.origin.x, canvas.width);
            if (horizontal.reason) return { reason: 'x-' + horizontal.reason };
            var vertical = axisReuse(cached.geometry.y, geometry.y, cached.firstRow, frame.firstRow,
                geometry.origin.y, canvas.height);
            if (vertical.reason) return { reason: 'y-' + vertical.reason };
            return { dx: horizontal.shift, dy: vertical.shift,
                x: horizontal.low, y: vertical.low,
                width: horizontal.high - horizontal.low, height: vertical.high - vertical.low };
        }
        function rememberBitmap() {
            if (!reuseEnabled || cacheUnavailable) return;
            // Data/geometry errors are not optional-cache failures. Construct the
            // snapshot outside the guarded Canvas allocation/copy operations.
            var snapshot = { rows: frame.rows, times: frame.times, normal: frame.normal, scale: frame.scale.slice(),
                firstCol: frame.firstCol, firstRow: frame.firstRow, geometry: geometry,
                dpr: frame.dpr, columnWidth: frame.columnWidth, bandWidth: frame.bandWidth,
                bandHeight: frame.bandHeight, left: frame.left, top: frame.top, width: frame.width,
                height: frame.height, gridWidth: frame.gridWidth, gridHeight: frame.gridHeight,
                hoverLayer: frame.hoverLayer };
            try {
                if (!bitmap) bitmap = document.createElement('canvas');
                if (bitmap.width !== canvas.width || bitmap.height !== canvas.height) {
                    bitmap.width = canvas.width; bitmap.height = canvas.height;
                }
                var clean = bitmap.getContext('2d'); bitmapContext = clean;
                if (!clean || typeof clean.isContextLost === 'function' && clean.isContextLost()) {
                    cacheFailure({ name: 'ContextUnavailable', message: 'Heat bitmap cache has no usable 2D context' }); return;
                }
                clean.setTransform(1, 0, 0, 1, 0, 0); clean.imageSmoothingEnabled = false;
                clean.clearRect(0, 0, bitmap.width, bitmap.height); clean.drawImage(canvas, 0, 0);
                if (typeof clean.isContextLost === 'function' && clean.isContextLost()) {
                    cacheFailure({ name: 'ContextUnavailable', message: 'Heat bitmap cache context was lost during copy' }); return;
                }
            } catch (error) {
                if (!recoverableCacheError(error)) throw error;
                cacheFailure(error); return;
            }
            cached = snapshot;
            stats.cacheBytes = bitmap.width * bitmap.height * 4;
        }
        function copyBitmap(plan) {
            if (bitmapContext && typeof bitmapContext.isContextLost === 'function' && bitmapContext.isContextLost()) {
                cacheFailure({ name: 'ContextUnavailable', message: 'Heat bitmap cache context was lost before reuse' }); return false;
            }
            ctx.save();
            try {
                ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                // Only the optional bitmap copy is recoverable. Ordinary visible
                // canvas setup, full paint, color mapping and repairs still throw.
                try {
                    ctx.drawImage(bitmap, plan.x - plan.dx, plan.y - plan.dy, plan.width, plan.height,
                        plan.x, plan.y, plan.width, plan.height);
                } catch (error) {
                    if (!recoverableCacheError(error)) throw error;
                    cacheFailure(error); return false;
                }
                return true;
            } finally { ctx.restore(); }
        }
        function renderBase() {
            var plan = reusePlan(), before = stats.paintCandidates;
            ++stats.renders;
            if (!plan.reason && !copyBitmap(plan)) plan = { reason: 'cache-copy-failed' };
            if (plan.reason) {
                ++stats.full; paint(); stats.last = { kind: 'full', reason: plan.reason, dx: 0, dy: 0 };
            } else {
                ++stats.reuse;
                var right = plan.x + plan.width, bottom = plan.y + plan.height;
                var repairs = [
                    { x: 0, y: 0, width: canvas.width, height: plan.y },
                    { x: 0, y: bottom, width: canvas.width, height: canvas.height - bottom },
                    { x: 0, y: plan.y, width: plan.x, height: plan.height },
                    { x: right, y: plan.y, width: canvas.width - right, height: plan.height }
                ].filter(function (area) { return area.width > 0 && area.height > 0; });
                repairs.forEach(function (area) {
                    paint({ x: geometry.origin.x + area.x, y: geometry.origin.y + area.y,
                        width: area.width, height: area.height });
                });
                stats.last = { kind: 'reuse', reason: 'identical-device-edges', dx: plan.dx, dy: plan.dy,
                    devicePixels: true, copy: { x: plan.x, y: plan.y, width: plan.width, height: plan.height },
                    repaint: repairs };
            }
            stats.last.paintCandidates = stats.collectPaintCounts ? stats.paintCandidates - before : null;
            // Cache creation/copy, including the first full frame, is render cost.
            rememberBitmap();
        }
        function point(at) {
            var row = frame.rows[frame.firstRow + at.row], col = frame.firstCol + at.col;
            var raw = row.values[col], value = options.colorValue(row, raw, frame.normal);
            return [at.col, at.row, value === null ? 0 : value, raw, col, frame.firstRow + at.row];
        }
        function selected(x, y, value) {
            return !!cell && cell.col === x && cell.row === y ||
                !!range && value !== null && value >= range[0] && value <= range[1];
        }
        function stroke(ctx, x, y, col, row, offsetX, offsetY) {
            var left = x.outerStart[col] - offsetX, right = x.outerEnd[col] - offsetX;
            var top = y.outerStart[row] - offsetY, bottom = y.outerEnd[row] - offsetY;
            var innerLeft = x.innerStart[col] - offsetX, innerRight = x.innerEnd[col] - offsetX;
            var innerTop = y.innerStart[row] - offsetY, innerBottom = y.innerEnd[row] - offsetY;
            if (innerRight <= innerLeft || innerBottom <= innerTop) {
                ctx.fillRect(left, top, right - left, bottom - top); return;
            }
            // The four strips never overlap, including at corners. This keeps
            // alpha compositing equivalent to one hard-edged rectangular ring.
            ctx.fillRect(left, top, right - left, innerTop - top);
            ctx.fillRect(left, innerBottom, right - left, bottom - innerBottom);
            ctx.fillRect(left, innerTop, innerLeft - left, innerBottom - innerTop);
            ctx.fillRect(innerRight, innerTop, right - innerRight, innerBottom - innerTop);
        }
        function paint(area, hoverOnly) {
            if (!frame || !geometry.x.count || !geometry.y.count) return;
            var target = hoverOnly ? highlight : canvas, context = target.getContext('2d');
            var offsetX = hoverOnly ? area.x : geometry.origin.x;
            var offsetY = hoverOnly ? area.y : geometry.origin.y;
            var xAxis = geometry.x, yAxis = geometry.y;
            var x0 = 0, x1 = xAxis.count, y0 = 0, y1 = yAxis.count;
            context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
            if (area) {
                context.beginPath(); context.rect(area.x - offsetX, area.y - offsetY, area.width, area.height); context.clip();
                while (x0 < x1 && xAxis.emphasis.outerEnd[x0] <= area.x) ++x0;
                while (x1 > x0 && xAxis.emphasis.outerStart[x1 - 1] >= area.x + area.width) --x1;
                while (y0 < y1 && yAxis.emphasis.outerEnd[y0] <= area.y) ++y0;
                while (y1 > y0 && yAxis.emphasis.outerStart[y1 - 1] >= area.y + area.height) --y1;
                context.clearRect(area.x - offsetX, area.y - offsetY, area.width, area.height);
            } else context.clearRect(0, 0, target.width, target.height);
            var passes = hoverOnly || !frame.hoverLayer && (cell || range) ? 3 : 2;
            if (stats.collectPaintCounts) stats.paintCandidates += (x1 - x0) * (y1 - y0) * (passes - (hoverOnly ? 2 : 0));
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
                        context.fillStyle = emphasis ? ec.color.liftColor(lastColor) : lastColor;
                        context.fillRect(xAxis.fill.start[x] - offsetX, yAxis.fill.start[y] - offsetY,
                            xAxis.fill.end[x] - xAxis.fill.start[x], yAxis.fill.end[y] - yAxis.fill.start[y]);
                        if (geometry.borderCss) {
                            var strong = emphasis && raw !== null;
                            context.fillStyle = strong ? '#111' : '#e2e8ee';
                            stroke(context, strong ? xAxis.emphasis : xAxis.normal,
                                strong ? yAxis.emphasis : yAxis.normal, x, y, offsetX, offsetY);
                        }
                    }
                }
            }
            context.restore();
        }
        function patch(at) {
            var x = geometry.x.emphasis, y = geometry.y.emphasis;
            // Integer halo also repairs neighboring fills/strokes in the original
            // valid/null/emphasis pass order; no device-to-CSS round trip occurs.
            var left = x.outerStart[at.col] - 1, top = y.outerStart[at.row] - 1;
            return { x: left, y: top, width: x.outerEnd[at.col] + 1 - left,
                height: y.outerEnd[at.row] + 1 - top };
        }
        function restoreCell() {
            if (frame.hoverLayer) { clearHighlight(); return; }
            if (!savedArea) return;
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
            ctx.clearRect(savedArea.x, savedArea.y, saved.width, saved.height);
            ctx.drawImage(saved, savedArea.x, savedArea.y); ctx.restore(); savedArea = null;
        }
        function paintCell() {
            if (!cell) return;
            var area = patch(cell);
            if (frame.hoverLayer) { paintHighlight(area); return; }
            savedArea = { x: area.x - geometry.origin.x, y: area.y - geometry.origin.y };
            saved.width = area.width; saved.height = area.height;
            var backup = saved.getContext('2d'); backup.imageSmoothingEnabled = false;
            backup.drawImage(canvas, -savedArea.x, -savedArea.y); paint(area);
        }
        function clearHighlight() { highlight.width = highlight.height = 0; }
        function paintHighlight(area) {
            var dpr = frame.dpr;
            highlight.width = area.width; highlight.height = area.height;
            highlight.style.left = area.x / dpr + 'px'; highlight.style.top = area.y / dpr + 'px';
            highlight.style.width = area.width / dpr + 'px'; highlight.style.height = area.height / dpr + 'px';
            paint(area, true);
        }
        function cancel() { if (raf !== null) cancelAnimationFrame(raf); raf = null; }
        function updateHover() {
            raf = null;
            if (!frame || disposed) return;
            var at = pointer && hitGeometry(geometry, pointer.x, pointer.y), old = cell;
            var changed = !sameCell(old, at), changedRange = !sameRange(range, nextRange);
            if (changedRange) {
                savedArea = null; clearHighlight(); cell = null; range = nextRange;
                if (!frame.hoverLayer) paint();
                cell = at;
                if (frame.hoverLayer && range) paintHighlight({ x: geometry.origin.x, y: geometry.origin.y,
                    width: canvas.width, height: canvas.height });
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
            if (hitGeometry(geometry, pointer.x, pointer.y)) nextRange = null;
            scheduleHover();
        }
        function leave() { pointer = null; clickPointer = null; nextRange = null; scheduleHover(); }
        function clearClickPointer() { clickPointer = null; }
        function pointerUp(event) {
            clickPointer = event.isTrusted && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
        }
        function click(event) {
            var released = clickPointer; clickPointer = null;
            if (!frame) return;
            var x = event.clientX, y = event.clientY;
            // Chromium also rounds native click coordinates. Retain click
            // semantics, but use its matching pointerup's precise coordinates.
            // Synthetic/keyboard clicks do not consume a previous pointer hit.
            if (released && event.isTrusted && event.detail > 0 && event.pointerId === released.id &&
                Math.trunc(released.x) === x && Math.trunc(released.y) === y) {
                x = released.x; y = released.y;
            }
            var bounds = host.getBoundingClientRect(), at = hitGeometry(geometry, x - bounds.left, y - bounds.top);
            if (at) options.select(point(at));
        }
        function resetInteraction() {
            cancel(); pointer = null; clickPointer = null; cell = null; range = null; nextRange = null;
            savedArea = null; saved.width = 0; saved.height = 0;
            clearHighlight();
            tip.style.display = 'none'; tip.innerHTML = ''; options.hideIndicator(); options.cursor('default');
        }
        // Compatibility mouse events round CSS client coordinates in Chromium.
        // Pointer events preserve subpixels needed by device-aligned dense cells.
        var precisePointer = typeof window !== 'undefined' && typeof window.PointerEvent === 'function';
        var moveEvent = precisePointer ? 'pointermove' : 'mousemove';
        var leaveEvent = precisePointer ? 'pointerleave' : 'mouseleave';
        if (precisePointer) {
            host.addEventListener('pointerdown', clearClickPointer);
            host.addEventListener('pointercancel', clearClickPointer);
            host.addEventListener('pointerup', pointerUp);
        }
        host.addEventListener(moveEvent, move); host.addEventListener(leaveEvent, leave); host.addEventListener('click', click);
        return {
            render: function (next) {
                if (disposed) return;
                resetInteraction(); frame = next; geometry = frameGeometry(frame, false);
                if (!geometry.x.count || !geometry.y.count) {
                    canvas.width = 0; canvas.height = 0; releaseCache();
                    ++stats.renders; stats.last = { kind: 'empty', reason: 'empty-frame', dx: 0, dy: 0 }; return;
                }
                var dpr = frame.dpr, width = geometry.width, height = geometry.height;
                if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
                canvas.style.left = geometry.origin.x / dpr + 'px'; canvas.style.top = geometry.origin.y / dpr + 'px';
                canvas.style.width = width / dpr + 'px'; canvas.style.height = height / dpr + 'px';
                ctx.setTransform(1, 0, 0, 1, 0, 0); renderBase();
            },
            highlightRange: function (value) { nextRange = value ? value.slice() : null; scheduleHover(); },
            hide: function () { var dirty = cell || range; resetInteraction(); if (dirty) paint(); },
            releaseCache: releaseCache,
            bitmapStats: function (collectPaintCounts) {
                if (typeof collectPaintCounts === 'boolean') stats.collectPaintCounts = collectPaintCounts;
                return JSON.parse(JSON.stringify(stats));
            },
            suspend: function () { resetInteraction(); frame = null; geometry = null; canvas.width = 0; canvas.height = 0; releaseCache(); },
            dispose: function () {
                if (disposed) return;
                disposed = true; resetInteraction(); frame = null; geometry = null; canvas.width = 0; canvas.height = 0; releaseCache();
                if (precisePointer) {
                    host.removeEventListener('pointerdown', clearClickPointer);
                    host.removeEventListener('pointercancel', clearClickPointer);
                    host.removeEventListener('pointerup', pointerUp);
                }
                host.removeEventListener(moveEvent, move); host.removeEventListener(leaveEvent, leave); host.removeEventListener('click', click);
                canvas.remove(); highlight.remove(); tip.remove();
            }
        };
    }
    return { create: create, hitTest: hitTest, colorMap: colorMap,
        geometry: function (frame) { return frameGeometry(frame, true); } };
}));
