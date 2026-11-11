/* Per-group actions shared by Line and Heat. Samples stay in their owners. */
(function (global) {
    'use strict';
    var active = null, nextId = 0;
    function close(restoreFocus) {
        if (!active) return;
        var previous = active; active = null;
        previous.popup.remove(); previous.button.setAttribute('aria-expanded', 'false');
        if (restoreFocus && previous.button.isConnected) previous.button.focus({preventScroll:true});
    }
    document.addEventListener('click', function (event) {
        if (active && !active.popup.contains(event.target) && !active.button.contains(event.target)) close(false);
    });
    document.addEventListener('keydown', function (event) {
        if (active && event.key === 'Escape') { event.preventDefault(); close(true); }
    });
    document.addEventListener('scroll', function (event) {
        if (active && !active.popup.contains(event.target)) close(false);
    }, true);
    global.addEventListener('resize', function () { close(false); });

    function install(host, options) {
        var element = document.createElement('div'); element.className = 'metric-group-actions';
        element.dataset.group = options.group;
        var button = document.createElement('button'); button.type = 'button';
        button.className = 'metric-group-actions-toggle'; button.textContent = '⋯';
        button.setAttribute('aria-label', 'Actions for ' + options.group);
        button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-haspopup', 'dialog');
        button.title = options.group + ' · Delete: metric · Shift+Delete: group';
        var hint = document.createElement('span'); hint.className = 'metric-group-action-status';
        hint.setAttribute('role', 'status'); hint.hidden = true;
        element.append(button, hint); host.appendChild(element);
        ['pointerdown', 'mousedown', 'dblclick', 'click'].forEach(function (type) {
            element.addEventListener(type, function (event) { event.stopPropagation(); });
        });
        function showHint(text) { hint.textContent = text; hint.hidden = !text; }
        button.addEventListener('click', function () {
            if (active && active.button === button) { close(false); return; }
            close(false); options.select(); showHint('');
            var popup = document.createElement('div'); popup.className = 'metric-group-menu';
            popup.dataset.group = options.group; popup.id = 'metric-group-menu-' + (++nextId);
            popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', options.group + ': remove metrics or group');
            button.setAttribute('aria-controls', popup.id); button.setAttribute('aria-expanded', 'true');
            var title = document.createElement('strong'); title.textContent = options.group;
            popup.appendChild(title);
            function action(text, callback) {
                var item = document.createElement('button'); item.type = 'button'; item.textContent = text;
                item.addEventListener('click', callback); popup.appendChild(item); return item;
            }
            var metricsButton = action('Remove metric…', function () {
                if (popup.querySelector('.metric-group-metrics')) return;
                var names = options.metrics(), list = document.createElement('div');
                list.className = 'metric-group-metrics'; list.setAttribute('aria-label', 'Metrics in ' + options.group);
                var spacer = document.createElement('div'); spacer.style.height = names.length * 28 + 'px';
                list.appendChild(spacer); popup.appendChild(list);
                // Only mount the visible window; a group may contain thousands of metrics.
                function render() {
                    var start = Math.max(0, Math.floor(list.scrollTop / 28) - 2);
                    var end = Math.min(names.length, start + Math.ceil(list.clientHeight / 28) + 4);
                    var focused = document.activeElement, focusIndex = Number(focused.dataset.metricIndex);
                    var indices = new Set();
                    for (var i = start; i < end; ++i) indices.add(i);
                    if (spacer.contains(focused)) indices.add(focusIndex);
                    Array.from(spacer.children).forEach(function (node) {
                        if (!indices.has(Number(node.dataset.metricIndex))) node.remove();
                    });
                    Array.from(indices).sort(function (a,b) { return a-b; }).forEach(function (index) {
                        if (spacer.querySelector('[data-metric-index="' + index + '"]')) return;
                        var item = document.createElement('button'); item.type = 'button';
                        item.className = 'metric-group-metric-remove'; item.dataset.metric = names[index];
                        item.dataset.metricIndex = index; item.textContent = names[index]; item.title = 'Remove ' + names[index];
                        item.style.top = index * 28 + 'px';
                        item.addEventListener('click', function () { close(true); options.removeMetric(names[index]); });
                        item.addEventListener('keydown', function (event) {
                            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                            event.preventDefault();
                            var next = Math.max(0, Math.min(names.length-1, index + (event.key === 'ArrowDown' ? 1 : -1)));
                            list.scrollTop = next * 28; render();
                            spacer.querySelector('[data-metric-index="' + next + '"]').focus({preventScroll:true});
                        });
                        var after = Array.from(spacer.children).find(function (node) { return Number(node.dataset.metricIndex) > index; });
                        spacer.insertBefore(item, after || null);
                    });
                }
                list.addEventListener('scroll', render); render();
                if (spacer.firstChild) spacer.firstChild.focus({preventScroll:true});
                place();
            });
            metricsButton.disabled = !options.metrics().length;
            action('Remove group', function () { close(false); options.removeGroup(); });
            ['pointerdown', 'mousedown', 'click', 'dblclick'].forEach(function (type) {
                popup.addEventListener(type, function (event) { event.stopPropagation(); });
            });
            function place() {
                var rect = button.getBoundingClientRect();
                popup.style.left = Math.max(4, Math.min(innerWidth-popup.offsetWidth-4, rect.right-popup.offsetWidth)) + 'px';
                popup.style.top = Math.max(4, Math.min(innerHeight-popup.offsetHeight-4, rect.bottom+2)) + 'px';
            }
            document.body.appendChild(popup); active = {button:button, popup:popup}; place();
            metricsButton.focus({preventScroll:true});
        });
        return {element:element, hint:showHint, destroy:function () {
            if (active && active.button === button) close(false);
            element.remove();
        }};
    }
    global.MetricGroupActions = {install:install, close:function () { close(false); }};
})(window);
