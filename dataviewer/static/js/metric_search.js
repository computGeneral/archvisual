/* Virtual results for Metric Name. Selection belongs to the entire result set. */
(function (global) {
    'use strict';

    function install(viewport) {
        var names = [], selection = [], selected = new Set(), matches = [];
        var rows = new Map(), rowHeight = 20, width = 0, frame = null;
        var allRow = document.createElement('div'), all = document.createElement('input');
        var space = document.createElement('div');
        all.type = 'checkbox'; all.name = 'MetricSelectAllBox'; all.value = 'SelectAll';
        allRow.style.whiteSpace = 'nowrap'; allRow.style.display = 'none';
        allRow.append(all, document.createTextNode('SelectAll'));
        space.style.position = 'relative';
        viewport.replaceChildren(allRow, space);

        function syncSelection() { selected = new Set(selection); }
        function clearSelection() { selection.length = 0; selected.clear(); }
        function selectAll(checked) {
            clearSelection();
            if (checked) matches.forEach(function (name) { selection.push(name); selected.add(name); });
            all.checked = checked;
            rows.forEach(function (row) { row.firstChild.checked = selected.has(row.firstChild.value); });
        }
        function check(name, checked) {
            if (checked && !selected.has(name)) { selection.push(name); selected.add(name); }
            else if (!checked) {
                for (var i = selection.length - 1; i >= 0; --i) {
                    if (selection[i] === name) selection.splice(i, 1);
                }
                selected.delete(name);
            }
        }
        function discardRows() {
            rows.clear(); space.replaceChildren(); width = 0;
            space.style.minWidth = ''; viewport.scrollTop = 0; viewport.scrollLeft = 0;
        }
        function refresh() {
            if (frame !== null) return;
            frame = requestAnimationFrame(function () { frame = null; render(); });
        }
        function focusIndex(index) {
            var top = allRow.offsetHeight + index * rowHeight;
            if (top < viewport.scrollTop) viewport.scrollTop = top;
            else if (top + rowHeight > viewport.scrollTop + viewport.clientHeight) {
                viewport.scrollTop = top + rowHeight - viewport.clientHeight;
            }
            render(index);
            rows.get(index).firstChild.focus({preventScroll:true});
        }
        function createRow(index) {
            var row = document.createElement('div'), input = document.createElement('input');
            row.style.cssText = 'position:absolute;left:0;white-space:nowrap;width:max-content;';
            input.type = 'checkbox'; input.name = 'MetricCheckBox'; input.value = matches[index];
            input.dataset.metricIndex = index;
            input.addEventListener('change', function () { check(input.value, input.checked); });
            input.addEventListener('keydown', function (event) {
                if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
                var next = index + (event.shiftKey ? -1 : 1);
                if (next >= 0 && next < matches.length) { event.preventDefault(); focusIndex(next); }
                else if (next < 0) { event.preventDefault(); all.focus(); }
            });
            row.append(input, document.createTextNode(matches[index]));
            return row;
        }
        function render(focus) {
            if (!viewport.clientHeight) return;
            var header = allRow.offsetHeight;
            if (header) rowHeight = header;
            space.style.height = matches.length * rowHeight + 'px';
            var start = Math.max(0, Math.floor((viewport.scrollTop - header) / rowHeight) - 6);
            var end = Math.min(matches.length, start + Math.ceil(viewport.clientHeight / rowHeight) + 13);
            var wanted = new Set(), focused = document.activeElement;
            for (var i = start; i < end; ++i) wanted.add(i);
            // Keep an offscreen focused checkbox mounted, as a full list does.
            if (space.contains(focused) && focused.dataset.metricIndex !== undefined) {
                wanted.add(Number(focused.dataset.metricIndex));
            }
            if (focus !== undefined) wanted.add(focus);
            rows.forEach(function (row, index) {
                if (!wanted.has(index)) { row.remove(); rows.delete(index); }
            });
            var ordered = Array.from(wanted).sort(function (a, b) { return a - b; });
            var cursor = space.firstChild;
            ordered.forEach(function (index) {
                var row = rows.get(index);
                if (!row) { row = createRow(index); rows.set(index, row); }
                row.style.top = index * rowHeight + 'px'; row.style.height = rowHeight + 'px';
                row.firstChild.checked = selected.has(matches[index]);
                if (row !== cursor) space.insertBefore(row, cursor);
                cursor = row.nextSibling;
            });
            // Retain the widest encountered row until the next search. Horizontal
            // scrolling must not collapse when a long name leaves the window.
            rows.forEach(function (row) { width = Math.max(width, row.scrollWidth); });
            space.style.minWidth = width ? width + 'px' : '';
            if (space.contains(focused) && document.activeElement !== focused) focused.focus({preventScroll:true});
        }
        all.addEventListener('change', function () { selectAll(all.checked); });
        all.addEventListener('keydown', function (event) {
            if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && matches.length) {
                event.preventDefault(); focusIndex(0);
            }
        });
        viewport.addEventListener('scroll', refresh, {passive:true});
        new ResizeObserver(refresh).observe(viewport);

        return {
            reset: function (currentNames, currentSelection) {
                names = currentNames; selection = currentSelection; syncSelection();
                matches = []; all.checked = false; allRow.style.display = 'none';
                discardRows(); space.style.height = '0px';
            },
            search: function (expression) {
                clearSelection(); discardRows(); matches = [];
                if (expression.length) {
                    all.checked = true; allRow.style.display = 'block';
                    var pattern = new RegExp(expression.replace(/ +/g, '.*'), 'i');
                    names.forEach(function (name) { if (name.search(pattern) >= 0) matches.push(name); });
                    selectAll(true);
                }
                space.style.height = matches.length * rowHeight + 'px';
                render();
            },
            hideRows: function () { matches = []; syncSelection(); discardRows(); space.style.height = '0px'; },
            check: check, selectAll: selectAll, refresh: refresh
        };
    }
    global.MetricSearch = { install: install };
})(window);
