/* Shared two-panel layout. Ratios belong to this page, separately per direction. */
(function (global) {
    'use strict';

    function install(container, first, second, initialMode) {
        var mode = 'single', ratios = { horizontal: 0.5, vertical: 0.5 };
        var frame = null, drag = null;
        var separator = document.createElement('div');
        separator.className = 'split-resizer';
        separator.tabIndex = 0;
        separator.setAttribute('role', 'separator');
        separator.setAttribute('aria-label', 'Resize split views');
        separator.setAttribute('aria-controls', first.id + ' ' + second.id);
        separator.title = 'Drag to resize · Double-click to split equally';
        container.classList.add('resizable-split');
        container.insertBefore(separator, second);

        function dimensions() {
            var total = mode === 'horizontal' ? container.clientWidth : container.clientHeight;
            var available = Math.max(0, total - 2);
            return { available: available, minimum: Math.min(120, available / 2) };
        }

        function layout() {
            frame = null;
            if (mode === 'single') return;
            var d = dimensions();
            var size = Math.max(d.minimum, Math.min(d.available - d.minimum, d.available * ratios[mode]));
            // CSS resolves the ratio during the browser's layout pass. Fixed
            // pixel bases would briefly retain the previous window dimensions
            // until ResizeObserver/rAF, causing a second Heat layout/redraw.
            var minimum = 'min(120px, calc((100% - 2px) / 2))';
            first.style.flex = '0 0 clamp(' + minimum + ', calc((100% - 2px) * ' + ratios[mode] +
                '), calc(100% - 2px - ' + minimum + '))';
            second.style.flex = '1 1 0px';
            separator.setAttribute('aria-valuemin', d.available ? Math.round(100 * d.minimum / d.available) : 50);
            separator.setAttribute('aria-valuemax', d.available ? Math.round(100 * (1 - d.minimum / d.available)) : 50);
            separator.setAttribute('aria-valuenow', d.available ? Math.round(100 * size / d.available) : 50);
        }

        function schedule() {
            if (frame === null) frame = requestAnimationFrame(layout);
        }

        function position(coordinate) {
            var rect = container.getBoundingClientRect(), d = dimensions();
            var start = mode === 'horizontal' ? rect.left : rect.top;
            var size = Math.max(d.minimum, Math.min(d.available - d.minimum, coordinate - start - 1));
            if (d.available) ratios[mode] = size / d.available;
            schedule();
        }

        function finish() {
            if (!drag) return;
            var pointerId = drag.pointerId, shield = drag.shield;
            drag = null;
            if (separator.hasPointerCapture(pointerId)) separator.releasePointerCapture(pointerId);
            shield.remove();
            document.documentElement.classList.remove('split-dragging');
            document.documentElement.style.removeProperty('--split-drag-cursor');
        }

        separator.addEventListener('pointerdown', function (event) {
            if (event.button !== 0 || mode === 'single' || drag) return;
            event.preventDefault();
            event.stopPropagation();
            var rect = separator.getBoundingClientRect();
            var coordinate = mode === 'horizontal' ? event.clientX : event.clientY;
            var center = mode === 'horizontal' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
            var shield = document.createElement('div');
            shield.className = 'split-drag-shield';
            document.body.appendChild(shield);
            document.documentElement.style.setProperty('--split-drag-cursor', mode === 'horizontal' ? 'col-resize' : 'row-resize');
            document.documentElement.classList.add('split-dragging');
            drag = { pointerId: event.pointerId, offset: coordinate - center, shield: shield };
            separator.setPointerCapture(event.pointerId);
        });
        separator.addEventListener('pointermove', function (event) {
            if (!drag || event.pointerId !== drag.pointerId) return;
            if (!(event.buttons & 1)) { finish(); return; }
            position((mode === 'horizontal' ? event.clientX : event.clientY) - drag.offset);
        });
        separator.addEventListener('pointerup', finish);
        separator.addEventListener('pointercancel', finish);
        separator.addEventListener('lostpointercapture', finish);
        separator.addEventListener('click', function (event) { event.stopPropagation(); });
        separator.addEventListener('dblclick', function (event) {
            event.preventDefault();
            ratios[mode] = 0.5;
            schedule();
        });
        separator.addEventListener('keydown', function (event) {
            var delta = mode === 'horizontal' ? { ArrowLeft: -10, ArrowRight: 10 } : { ArrowUp: -10, ArrowDown: 10 };
            if (!(event.key in delta)) return;
            event.preventDefault(); event.stopPropagation();
            var rect = separator.getBoundingClientRect();
            position((mode === 'horizontal' ? rect.left + rect.width / 2 : rect.top + rect.height / 2) + delta[event.key]);
        });
        window.addEventListener('keydown', function (event) { if (event.key === 'Escape') finish(); });
        window.addEventListener('blur', finish);
        window.addEventListener('pagehide', finish);
        new ResizeObserver(schedule).observe(container);

        function setMode(next) {
            finish();
            mode = next;
            separator.hidden = mode === 'single';
            separator.setAttribute('aria-orientation', mode === 'horizontal' ? 'vertical' : 'horizontal');
            if (mode === 'single') {
                first.style.removeProperty('flex');
                second.style.removeProperty('flex');
            }
            if (frame !== null) cancelAnimationFrame(frame);
            layout();
        }
        setMode(initialMode || 'single');
        return { setMode: setMode };
    }

    // Observe the chart element, including its panel's CSS minimum height.
    // Never resize a hidden chart or write layout from ResizeObserver itself.
    function observeChart(element, getChart) {
        var frame = null;
        new ResizeObserver(function () {
            if (frame !== null) return;
            frame = requestAnimationFrame(function () {
                frame = null;
                var chart = getChart(), width = element.clientWidth, height = element.clientHeight;
                if (chart && !chart.isDisposed() && width && height &&
                    (chart.getWidth() !== width || chart.getHeight() !== height)) chart.resize();
            });
        }).observe(element);
    }

    global.SplitView = { install: install, observeChart: observeChart };
})(window);
