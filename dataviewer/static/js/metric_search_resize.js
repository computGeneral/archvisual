/* Page-local sizing for the shared Metric Name results popup. */
(function (global) {
    'use strict';

    function install(popup) {
        var preferred = { width: 800, height: 300 };
        var drag = null, frame = null, suppressClick = false;

        function visible() { return popup.getClientRects().length > 0; }

        function fit(width, height, remember) {
            if (!visible()) return;
            var rect = popup.getBoundingClientRect();
            var viewportWidth = document.documentElement.clientWidth;
            var viewportHeight = document.documentElement.clientHeight;
            // Keep the existing anchor unless it is outside the visible page.
            var left = Math.max(0, Math.min(rect.left, Math.max(0, viewportWidth - 1)));
            var top = Math.max(0, Math.min(rect.top, Math.max(0, viewportHeight - 1)));
            if (left !== rect.left) popup.style.left = popup.offsetLeft + left - rect.left + 'px';
            if (top !== rect.top) popup.style.top = popup.offsetTop + top - rect.top + 'px';
            var maxWidth = Math.max(1, viewportWidth - left);
            var maxHeight = Math.max(1, viewportHeight - top);
            width = Math.max(Math.min(240, maxWidth), Math.min(maxWidth, width));
            height = Math.max(Math.min(120, maxHeight), Math.min(maxHeight, height));
            popup.style.width = width + 'px';
            popup.style.height = height + 'px';
            if (remember) preferred = { width: width, height: height };
        }

        function refresh() { fit(preferred.width, preferred.height, false); }

        function finish() {
            if (!drag) return;
            var previous = drag;
            drag = null;
            suppressClick = true;
            if (previous.handle.hasPointerCapture(previous.pointerId)) {
                previous.handle.releasePointerCapture(previous.pointerId);
            }
            previous.shield.remove();
            document.documentElement.classList.remove('metric-search-resizing');
            document.documentElement.style.removeProperty('--metric-search-cursor');
        }

        popup.querySelectorAll('[data-metric-resize]').forEach(function (handle) {
            handle.addEventListener('pointerdown', function (event) {
                if (event.button !== 0 || !event.isPrimary || drag) return;
                event.preventDefault();
                event.stopPropagation();
                var axis = handle.dataset.metricResize;
                var rect = popup.getBoundingClientRect();
                var shield = document.createElement('div');
                shield.className = 'metric-search-drag-shield';
                document.body.appendChild(shield);
                drag = { handle: handle, pointerId: event.pointerId, axis: axis,
                    x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, shield: shield };
                document.documentElement.style.setProperty('--metric-search-cursor',
                    axis === 'x' ? 'col-resize' : axis === 'y' ? 'row-resize' : 'nwse-resize');
                document.documentElement.classList.add('metric-search-resizing');
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', function (event) {
                if (!drag || event.pointerId !== drag.pointerId) return;
                if (!(event.buttons & 1) || !visible()) { finish(); return; }
                fit(drag.width + (drag.axis === 'y' ? 0 : event.clientX - drag.x),
                    drag.height + (drag.axis === 'x' ? 0 : event.clientY - drag.y), true);
            });
            handle.addEventListener('pointerup', finish);
            handle.addEventListener('pointercancel', finish);
            handle.addEventListener('lostpointercapture', finish);
            handle.addEventListener('click', function (event) { event.stopPropagation(); });
        });

        // A released drag must not select a result or activate an outside button.
        // A fresh pointer press clears this even if a canceled drag emitted no click.
        document.addEventListener('pointerdown', function () { suppressClick = false; }, true);
        document.addEventListener('click', function (event) {
            if (!suppressClick || event.detail === 0) return;
            suppressClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        window.addEventListener('keydown', function (event) { if (event.key === 'Escape') finish(); });
        window.addEventListener('blur', finish);
        window.addEventListener('pagehide', finish);
        window.addEventListener('resize', function () {
            finish();
            if (frame !== null) return;
            frame = requestAnimationFrame(function () { frame = null; refresh(); });
        });
        new MutationObserver(function () { if (!visible()) finish(); })
            .observe(popup, { attributes: true, attributeFilter: ['style', 'class'] });

        return { refresh: refresh };
    }

    global.MetricSearchResize = { install: install };
})(window);
