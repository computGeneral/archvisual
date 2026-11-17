#!/usr/bin/env node
'use strict';
// Manual and automated callers use exactly this entry and result contract:
// node scripts/test_heat_reentry_offline.cjs --output /absolute/__output__/new-run
// Three isolated, identical left/right Handler sequences. No DOM, production
// imports, browser, network, child process, cache repair, or formal gate PASS.
// Requires only PATH Node.js built-ins and the checked-in, hash-bound bundle.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');

const BUNDLE_SHA = '42f8329d989b6f6539dd2b15bbdf0d82025762ac112fbb60dc57b27d7bcf3946';
// Optional host-provided DNS lookup adapter, already present before this entry.
// Do not remove it or change the environment. This reviewed source only wraps
// dns.lookup; the fixture/VM never calls DNS/network. Other preloads refuse.
// NODE_OPTIONS preloads run before this script: this is post-start identity
// verification. A caller must inspect options/path/hash in its shell first.
const DNS_ADAPTER_PATH = '/home/liyijun04/computgeneral.com/cgi.computgeneral.com/__install__/bin/lan-dns-override.cjs';
const DNS_ADAPTER_SHA = '662f64f8f68689e3ada2e8f62caaa1c7668d9765891e03a8c7ea85e97e4bd759';
const MAX_BYTES = 8 * 1024 * 1024;
const RESULT_RESERVE = 256 * 1024;
const STDIO_RESERVE = 4096;
const started = performance.now();
const deadline = started + 30000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const errorInfo = e => ({name: String(e.name), message: String(e.message), stack: String(e.stack)});
let stdioBytes = 0;
function emit(stream, value) {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    if (stdioBytes + bytes.length > STDIO_RESERVE) throw Error('STDIO_BUDGET_EXCEEDED');
    stdioBytes += bytes.length; stream.write(bytes);
}
function nodeOptionsIdentity() {
    const options = process.env.NODE_OPTIONS || '';
    if (!options) return {options, preload: null};
    if (options !== '--require="' + DNS_ADAPTER_PATH + '"') throw Error('UNKNOWN_NODE_OPTIONS');
    const file = fs.realpathSync(DNS_ADAPTER_PATH);
    if (file !== DNS_ADAPTER_PATH) throw Error('PRELOAD_REALPATH_MISMATCH');
    const digest = sha(fs.readFileSync(file));
    const loaded = require.cache[file];
    if (digest !== DNS_ADAPTER_SHA || loaded?.loaded !== true || loaded.children.length !== 0)
        throw Error('UNREVIEWED_NODE_PRELOAD');
    return {options, preload: {path: file, sha256: digest, loaded: true,
        scope: 'Existing host DNS adapter retained; no fixture DNS/network operations'}};
}

// Executed inside the same VM as the real bundle, under a single remaining
// budget. All library calls, including initialization/observation/disposal, are
// inside that VM deadline; invoking an exported function in the host would not be.
function runCases(ec) {
    const report = globalThis.fixtureReport = {cases: [], assertions: [], errors: [], disposed: []};
    globalThis.ownedCharts = [];
    function guard(ok, code) { if (!ok) throw Error(code); }
    function check(name, actual, expected) {
        const ok = JSON.stringify(actual) === JSON.stringify(expected);
        report.assertions.push({name, ok, actual, expected});
        return ok;
    }
    guard(ec.version === '5.5.0' && ec.zrender.version === '5.5.0', 'VERSION_MISMATCH');
    report.versions = {echarts: ec.version, zrender: ec.zrender.version};
    const points = {min: [1256, 61], max: [1288, 61], outside: [8, -29]};
    const definitions = [
        {name: 'same_max_reentry_and_click', destination: 'max', actions: [
            ['mousemove', 'max'], ['mouseout', 'outside'], ['mousemove', 'max'],
            ['mousedown', 'max'], ['mouseup', 'max'], ['click', 'max']]},
        {name: 'leave_max_reenter_min_and_click', destination: 'min', actions: [
            ['mousemove', 'max'], ['mouseout', 'outside'], ['mousemove', 'min'],
            ['mousedown', 'min'], ['mouseup', 'min'], ['click', 'min']]},
        {name: 'different_down_up_target_rejects_statistical_click', destination: null, actions: [
            ['mousemove', 'max'], ['mousedown', 'max'], ['mousemove', 'min'],
            ['mouseup', 'min'], ['click', 'min']]}
    ];
    function option() {
        return {animation: false, tooltip: {show: false},
            grid: [{left: 140, top: 53, width: 1000, height: 16},
                {left: 1248, top: 53, width: 48, height: 16}],
            xAxis: [{type: 'category', data: [], show: false},
                {type: 'category', gridIndex: 1, data: ['min', 'avg', 'max'], show: false}],
            yAxis: [{type: 'category', data: ['ramp'], inverse: true, show: false},
                {type: 'category', gridIndex: 1, data: ['ramp'], inverse: true, show: false}],
            visualMap: {type: 'continuous', min: 0, max: 1, dimension: 2, seriesIndex: [0, 2],
                calculable: false, orient: 'horizontal', left: 140, top: 77, padding: 0,
                itemWidth: 12, itemHeight: 130, precision: 4,
                inRange: {color: ['#2166ac', '#f7f7f7', '#fdae61', '#b2182b']}},
            series: ['heat-values', 'heat-missing', 'heat-statistics', 'heat-statistics-missing'].map((id, i) => ({
                id, type: 'heatmap', xAxisIndex: i >= 2 ? 1 : 0, yAxisIndex: i >= 2 ? 1 : 0,
                data: i === 2 ? [[0, 0, 0, 0, -1, 0], [2, 0, 1, 100, -1, 0]] : [], progressive: 0,
                itemStyle: {borderColor: '#e2e8ee', borderWidth: 1},
                emphasis: {itemStyle: {borderColor: '#111', borderWidth: 2}}
            }))};
    }
    report.configuration = {renderer: 'svg', ssr: true, width: 1316, height: 848,
        rowHeight: 16, points, option: option(), input: 'SYNTHETIC_DIRECT_HANDLER_NOT_DOM',
        checkpoints: 'Synchronous before/callback/after only; no flush/frame/settling claim'};
    function makeSide(side, record) {
        const chart = ec.init(null, null, {renderer: 'svg', ssr: true, width: 1316, height: 848});
        ownedCharts.push(chart);
        chart.setOption(option());
        const zr = chart.getZr(), handler = zr.handler;
        guard(handler && typeof handler.dispatch === 'function' && typeof handler.findHover === 'function', 'HANDLER_INTERFACE');
        guard(chart.getWidth() === 1316 && chart.getHeight() === 848, 'CHART_SIZE');
        const data = () => chart.getModel().getSeriesByIndex(2).getData();
        const original = {min: data().getItemGraphicEl(0), max: data().getItemGraphicEl(1)};
        guard(original.min && original.max && original.min !== original.max, 'TARGETS_MISSING');
        const ids = new WeakMap(); let next = 1, actionIndex = -1;
        const oid = o => { if (!o) return null; if (!ids.has(o)) ids.set(o, next++); return ids.get(o); };
        const role = e => !e ? null : e === original.min ? 'min' : e === original.max ? 'max' : 'UNKNOWN';
        function element(e) {
            return !e ? null : {oid: oid(e), id: e.id, role: role(e), attachedOriginalZr: e.__zr === zr,
                equalsInitialMin: e === original.min, equalsInitialMax: e === original.max,
                equalsCurrentMin: e === data().getItemGraphicEl(0), equalsCurrentMax: e === data().getItemGraphicEl(1),
                hoverState: e.hoverState ?? null, inHover: !!e.__inHover,
                currentStates: Array.from(e.currentStates || [])};
        }
        function snapshot() {
            guard(data().getItemGraphicEl(0) === original.min && data().getItemGraphicEl(1) === original.max &&
                original.min.__zr === zr && original.max.__zr === zr, 'TARGET_IDENTITY_CHANGED');
            const sh = chart.getViewOfComponentModel(chart.getModel().getComponent('visualMap'))._shapes;
            guard(sh?.indicator && sh?.indicatorLabel, 'INDICATOR_INTERFACE');
            const h = handler._hovered;
            return {cache: {oid: oid(h), x: h?.x ?? null, y: h?.y ?? null,
                target: element(h?.target), topTarget: element(h?.topTarget)},
                downTarget: element(handler._downEl), upTarget: element(handler._upEl),
                downPoint: handler._downPoint ? Array.from(handler._downPoint) : null,
                min: element(original.min), max: element(original.max),
                indicator: {symbolInvisible: sh.indicator.invisible === true,
                    labelInvisible: sh.indicatorLabel.invisible === true,
                    symbolIgnore: !!sh.indicator.ignore, labelIgnore: !!sh.indicatorLabel.ignore,
                    text: sh.indicatorLabel.style?.text ?? null},
                staleTarget: !!h?.target,
                visiblePixels: 'NOT_OBSERVED', frameCompletion: 'NOT_ASSERTED'};
        }
        for (const [name, index] of [['min', 0], ['max', 2]]) {
            const p = chart.convertToPixel({seriesIndex: 2}, [index, 0]);
            guard(p[0] === points[name][0] && p[1] === points[name][1], 'FIXED_POINT_MISMATCH:' + name);
            const hit = handler.findHover(...p);
            guard(hit.target === original[name] && hit.topTarget === original[name], 'UNIQUE_HIT:' + name);
        }
        const rect = chart.getModel().getComponent('grid', 1).coordinateSystem.getRect();
        guard(rect.x === 1248 && rect.y === 53 && rect.width === 48 && rect.height === 16, 'GRID_GEOMETRY');
        const out = record[side] = {initial: snapshot(), events: [], steps: [], clicks: []};
        function event(channel, type, e) {
            guard(out.events.length < 512, 'EVENT_LIMIT');
            out.events.push({index: out.events.length, actionIndex, channel, type,
                eventTarget: element(channel === 'zrender' ? e.target : data().getItemGraphicEl(e.dataIndex)),
                eventObjectOid: oid(channel === 'zrender' ? e.event : e.event?.event),
                eventIsTrusted: (channel === 'zrender' ? e.event : e.event?.event)?.isTrusted ?? null,
                state: snapshot()});
        }
        for (const type of ['mousemove', 'mouseover', 'mouseout', 'globalout', 'mousedown', 'mouseup', 'click'])
            zr.on(type, e => event('zrender', type, e));
        chart.on('click', e => {
            event('echarts', 'click', e);
            out.clicks.push({seriesId: e.seriesId, seriesIndex: e.seriesIndex,
                dataIndex: e.dataIndex, value: Array.from(e.value), row: chart.getOption().yAxis[1].data[e.value[1]]});
        });
        return {chart, out, act(index, type, where) {
            actionIndex = index;
            const step = {index, type, point: points[where].slice(), before: snapshot()}; out.steps.push(step);
            const [zrX, zrY] = points[where];
            const e = {type, zrX, zrY, zrByTouch: false, button: 0, buttons: type === 'mousedown' ? 1 : 0,
                which: 1, preventDefault() {}, stopPropagation() {}};
            handler.dispatch(type, e); // Never add isTrusted, cache writes or compensating actions.
            step.after = snapshot();
        }};
    }
    function normalized(o) {
        if (Array.isArray(o)) return o.map(normalized);
        if (!o || typeof o !== 'object') return o;
        return Object.fromEntries(Object.entries(o).filter(([k]) => !['oid', 'id', 'eventObjectOid'].includes(k))
            .map(([k, v]) => [k, normalized(v)]));
    }
    for (const def of definitions) {
        const row = {name: def.name, actions: def.actions, errors: []}; report.cases.push(row);
        let left, right;
        try {
            left = makeSide('left', row); right = makeSide('right', row);
            for (let i = 0; i < def.actions.length; i++) {
                const [type, where] = def.actions[i];
                left.act(i, type, where); right.act(i, type, where);
            }
            check(def.name + ':symmetric_observations', normalized(row.left), normalized(row.right));
            for (const side of ['left', 'right']) {
                const s = row[side], prefix = def.name + ':' + side + ':';
                const zrTypes = i => s.events.filter(e => e.channel === 'zrender' && e.actionIndex === i).map(e => e.type);
                // Pair equality alone cannot prove either side targets the right
                // object. Assert each callback against this side's original cells.
                const expectedTypes = def.destination ? [
                    ['mousemove', 'mouseover'], ['mouseout', 'globalout'],
                    def.destination === 'max' ? ['mousemove'] : ['mouseout', 'mousemove', 'mouseover'],
                    ['mousedown'], ['mouseup'], ['click']
                ] : [['mousemove', 'mouseover'], ['mousedown'], ['mouseout', 'mousemove', 'mouseover'], ['mouseup'], []];
                for (let i = 0; i < def.actions.length; i++) {
                    const [type, where] = def.actions[i];
                    const cacheRole = type === 'mouseout' ? 'max' : where;
                    const expectedObject = s.initial[cacheRole];
                    check(prefix + 'step_' + i + '_event_order', zrTypes(i), expectedTypes[i]);
                    const after = s.steps[i].after;
                    check(prefix + 'step_' + i + '_cache_objects',
                        [after.cache.target?.oid, after.cache.topTarget?.oid], [expectedObject.oid, expectedObject.oid]);
                    if (type === 'mousemove') {
                        check(prefix + 'step_' + i + '_new_hit_record', after.cache.oid !== s.steps[i].before.cache.oid, true);
                        check(prefix + 'step_' + i + '_cache_coordinates', [after.cache.x, after.cache.y], points[where]);
                    }
                    const events = s.events.filter(e => e.channel === 'zrender' && e.actionIndex === i);
                    events.forEach((e, j) => {
                        const eventRole = e.type === 'globalout' ? null : e.type === 'mouseout' ? 'max' : cacheRole;
                        check(prefix + 'step_' + i + '_callback_' + j + '_identity',
                            [e.eventTarget?.oid ?? null, e.state.cache.target?.oid, e.state.cache.topTarget?.oid],
                            [eventRole ? s.initial[eventRole].oid : null, expectedObject.oid, expectedObject.oid]);
                    });
                }
                check(prefix + 'initial_entry_events', zrTypes(0), ['mousemove', 'mouseover']);
                check(prefix + 'initial_max_target', s.steps[0].after.cache.target?.role, 'max');
                if (def.destination) {
                    check(prefix + 'leave_events', zrTypes(1), ['mouseout', 'globalout']);
                    check(prefix + 'leave_same_cache_record', s.steps[1].after.cache.oid, s.steps[0].after.cache.oid);
                    check(prefix + 'leave_same_target', s.steps[1].after.cache.target?.oid, s.steps[0].after.cache.target?.oid);
                    check(prefix + 'formal_stale_target_still_rejects', s.steps[1].after.staleTarget, true);
                    check(prefix + 'reentry_events', zrTypes(2), def.destination === 'max' ?
                        ['mousemove'] : ['mouseout', 'mousemove', 'mouseover']);
                    check(prefix + 'reentry_target', s.steps[2].after.cache.target?.role, def.destination);
                    if (def.destination === 'min') {
                        const leave = s.events.find(e => e.channel === 'zrender' && e.actionIndex === 2 && e.type === 'mouseout');
                        check(prefix + 'old_target_new_cache', [leave?.eventTarget?.role, leave?.state.cache.target?.role], ['max', 'min']);
                    }
                    const isMax = def.destination === 'max';
                    check(prefix + 'exact_statistical_click', s.clicks, [{seriesId: 'heat-statistics', seriesIndex: 2,
                        dataIndex: isMax ? 1 : 0, value: isMax ? [2, 0, 1, 100, -1, 0] : [0, 0, 0, 0, -1, 0], row: 'ramp'}]);
                } else {
                    check(prefix + 'down_up_roles', [s.steps[3].after.downTarget?.role, s.steps[3].after.upTarget?.role], ['max', 'min']);
                    check(prefix + 'rejected_statistical_click', s.clicks, []);
                    check(prefix + 'rejected_zrender_click', zrTypes(4), []);
                    row.limitation = 'Target mismatch and distance32>4 apply together; not independent branch coverage';
                }
            }
        } catch (e) { row.errors.push({name: e.name, message: e.message, stack: e.stack}); }
        finally {
            for (const chart of [left?.chart, right?.chart].filter(Boolean)) {
                try { chart.dispose(); report.disposed.push(chart.isDisposed() === true); }
                catch (e) { row.errors.push({stage: 'dispose', message: e.message, stack: e.stack}); }
            }
        }
    }
    report.logicStatus = report.cases.length === 3 && report.cases.every(c => c.errors.length === 0) &&
        report.assertions.every(a => a.ok) ? 'LIBRARY_LOGIC_MATCH' : 'FAIL';
}

async function main() {
    if (process.argv.length !== 4 || process.argv[2] !== '--output')
        throw Error('Usage: node scripts/test_heat_reentry_offline.cjs --output /absolute/__output__/new-run');
    const nodeOptions = nodeOptionsIdentity();
    const output = path.resolve(process.argv[3]);
    if (!path.isAbsolute(process.argv[3]) || !output.split(path.sep).includes('__output__')) throw Error('OUTPUT_PATH');
    if (fs.existsSync(output)) throw Error('FRESH_OUTPUT_REQUIRED');
    if (fs.realpathSync(path.dirname(output)) !== path.dirname(output)) throw Error('OUTPUT_PARENT_SYMLINK');
    fs.mkdirSync(output, {mode: 0o700});
    let written = 0;
    const write = (name, value, limit) => {
        if (performance.now() > deadline - 1000) throw Error('SERIALIZATION_DEADLINE');
        const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
        if (bytes.length > limit || written + bytes.length > MAX_BYTES - STDIO_RESERVE)
            throw Error('OUTPUT_BUDGET_EXCEEDED:' + name + ':' + bytes.length);
        if (performance.now() > deadline - 1000) throw Error('WRITE_ADMISSION_DEADLINE');
        fs.writeFileSync(path.join(output, name), bytes, {flag: 'wx', mode: 0o600}); written += bytes.length;
        if (performance.now() > deadline - 500) throw Error('WRITE_COMPLETION_DEADLINE');
        return {sha256: sha(bytes), bytes: bytes.length};
    };
    const result = {status: 'FAIL', startedUtc: new Date().toISOString(),
        pid: process.pid, node: process.version, executable: process.execPath, nodeOptions,
        limits: {totalSeconds: 30, evidenceBytes: MAX_BYTES, resultReserveBytes: RESULT_RESERVE,
            stdioReserveBytes: STDIO_RESERVE, processes: 1},
        completionContract: 'This result records logic only. Completion stdout after all writes and actual process raw exit are required; missing/late/nonzero refuses.',
        formalNeutralFailurePreserved: true, formalGate: 'NOT_RUN',
        notCovered: ['trusted DOM/proxy/capture', 'Canvas/neutral RGBA', 'production tooltip/selection UI',
            'async frame completion', 'DPR/touch/drag/lifecycle/performance'], errors: []};
    const timers = new Map(), timerLog = [], liveCharts = [], logs = [];
    let context, notifyDrain = null, timersCreated = 0;
    function remaining(reserve) {
        const ms = Math.floor(deadline - performance.now() - reserve);
        if (ms <= 0) throw Error('TOTAL_DEADLINE');
        return ms;
    }
    function execute(source, reserve) {
        return new vm.Script(source).runInContext(context, {timeout: remaining(reserve)});
    }
    function clearOwned(id) {
        if (!timers.has(id)) return;
        const info = timers.get(id); clearTimeout(id); timers.delete(id);
        timerLog.push({op: 'cleared', timer: info.id});
        if (!timers.size) notifyDrain?.();
    }
    function schedule(fn, delay, ...args) {
        if (typeof fn !== 'function' || timersCreated >= 128) throw Error('TIMER_INTERFACE_OR_BUDGET');
        const info = {id: ++timersCreated, delay};
        const handle = setTimeout(() => {
            timers.delete(handle); timerLog.push({op: 'fired', timer: info.id});
            try {
                context.timerCallback = fn; context.timerArgs = args;
                execute('timerCallback(...timerArgs)', 2000);
            } catch (e) {
                result.errors.push({stage: 'owned_timer', ...errorInfo(e)});
                for (const id of timers.keys()) clearOwned(id);
            } finally {
                context.timerCallback = null; context.timerArgs = null;
                if (!timers.size) notifyDrain?.();
            }
        }, delay);
        timers.set(handle, info); timerLog.push({op: 'created', ...info});
        return handle;
    }
    try {
        const bundle = path.resolve(__dirname, '../dataviewer/static/js/echarts.min.js');
        const bytes = fs.readFileSync(bundle);
        result.inputs = {script: {path: __filename, sha256: sha(fs.readFileSync(__filename))},
            bundle: {path: bundle, sha256: sha(bytes)}, node: {path: process.execPath, sha256: sha(fs.readFileSync(process.execPath))}};
        if (result.inputs.bundle.sha256 !== BUNDLE_SHA) throw Error('BUNDLE_HASH_MISMATCH');
        const exports = {};
        context = vm.createContext({exports, module: {exports}, setTimeout: schedule, clearTimeout: clearOwned,
            console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => {
                if (logs.length >= 64) throw Error('CONSOLE_LIMIT');
                const text = args.map(String).join(' ');
                if (Buffer.byteLength(text) > 2048) throw Error('CONSOLE_BYTES_LIMIT');
                logs.push({level, text});
            }]))});
        new vm.Script(bytes.toString('utf8'), {filename: bundle}).runInContext(context, {timeout: remaining(6000)});
        execute('(' + runCases.toString() + ')(module.exports)', 6000);
    } catch (e) { result.errors.push({stage: 'fixture', ...errorInfo(e)}); }
    finally {
        if (context?.ownedCharts) {
            // Also covers charts created before makeSide returned or VM timeout.
            liveCharts.push(...context.ownedCharts);
            try { execute('for (const c of ownedCharts) { if (!c.isDisposed()) c.dispose(); }', 4000); }
            catch (e) { result.errors.push({stage: 'final_dispose', ...errorInfo(e)}); }
        }
        if (timers.size) {
            // Draining already scheduled callbacks after disposal is cleanup only,
            // never a delayed assertion or a retry-until-success observation.
            let watchdog;
            try {
                await new Promise((resolve, reject) => {
                    notifyDrain = resolve;
                    watchdog = setTimeout(() => reject(Error('TIMER_DRAIN_DEADLINE')), remaining(2000));
                });
            } catch (e) { result.errors.push({stage: 'timer_drain', ...errorInfo(e)}); }
            finally { clearTimeout(watchdog); notifyDrain = null; }
        }
        const remainingTimers = [...timers.values()];
        if (remainingTimers.length) result.errors.push({stage: 'cleanup', message: 'OWNED_TIMERS_REMAIN', remainingTimers});
        for (const id of timers.keys()) clearOwned(id);
        let disposed = false;
        try { disposed = context ? execute('!globalThis.ownedCharts || ownedCharts.every(c => c.isDisposed())', 1000) : true; }
        catch (e) { result.errors.push({stage: 'dispose_check', ...errorInfo(e)}); }
        result.cleanup = {chartsCreated: liveCharts.length, allChartsDisposed: disposed,
            timersCreated, remainingBeforeForcedClear: remainingTimers, remainingAfter: timers.size};
        if (!disposed) result.errors.push({stage: 'cleanup', message: 'CHART_DISPOSAL_UNVERIFIED'});
    }
    const trace = context?.fixtureReport ?? {cases: [], assertions: [], errors: ['NOT_INITIALIZED']};
    try { result.evidence = write('TRACE.json', {trace, timerLog, logs}, MAX_BYTES - RESULT_RESERVE - STDIO_RESERVE); }
    catch (e) { result.errors.push({stage: 'trace_write', ...errorInfo(e)}); }
    result.assertions = {total: trace.assertions.length, failed: trace.assertions.filter(a => !a.ok).map(a => a.name)};
    result.cases = trace.cases.map(c => ({name: c.name, errors: c.errors}));
    result.elapsedBeforeResultWriteMs = performance.now() - started;
    if (result.elapsedBeforeResultWriteMs >= 30000) result.errors.push({stage: 'deadline', message: 'TOTAL_DEADLINE_EXCEEDED'});
    result.status = trace.logicStatus === 'LIBRARY_LOGIC_MATCH' && !result.errors.length ? 'LIBRARY_LOGIC_MATCH' : 'FAIL';
    result.evidenceBytesBeforeResult = written;
    write('RESULT.json', result, RESULT_RESERVE);
    const elapsedAfterAllFilesMs = performance.now() - started;
    const status = elapsedAfterAllFilesMs < 30000 ? result.status : 'FAIL';
    const rawExit = status === 'LIBRARY_LOGIC_MATCH' ? 0 : 1;
    emit(process.stdout, {status, requestedExit: rawExit, output, elapsedAfterAllFilesMs,
        assertions: {total: result.assertions.total, failedCount: result.assertions.failed.length},
        evidenceBytes: written, completion: 'ALL_FILES_WRITTEN_NOT_PROCESS_EXIT_RECEIPT'});
    process.exitCode = performance.now() < deadline ? rawExit : 1;
}

main().catch(e => {
    process.exitCode = 1;
    try { emit(process.stderr, {status: 'FAIL', error: errorInfo(e)}); }
    catch (_) {
        // No truncation disguised as complete evidence. If the error itself
        // exceeds the remaining stdio allowance, explicitly report incomplete
        // context when space permits; raw1 remains authoritative in all cases.
        try { emit(process.stderr, {status: 'FAIL', error: 'STDIO_BUDGET_EXCEEDED_CONTEXT_NOT_SAVED'}); }
        catch (_) { /* No further bytes or false success. */ }
    }
});
