# Perfetto Embedding Plan (Offline / Self-Hosted)

## Goal

Add Google Perfetto trace viewer as a new subpage in ArchVisual, following the
same self-hosted pattern as the existing Catapult TraceViewer. The environment
has **no internet access**, so all Perfetto assets must be served locally.

## Design Principle: Light as Possible, Self-Hosted

Like Catapult (`catapult_trace_viewer.html` + `catapult_trace_viewer.js`), we
self-host Perfetto UI as static files under `dataviewer/static/perfetto_ui/`.
The wrapper page is a thin Django template (~120 lines) that iframes the local
Perfetto entry point and communicates via `postMessage`.

## Prerequisite: Download Perfetto UI Bundle (one-time manual step)

1. Go to https://github.com/google/perfetto/releases (do this on a machine with
   internet access, then transfer the files)
2. Download the latest `perfetto-ui-*.tar.gz` or extract the `ui/` folder from a
   release asset
3. The bundle contains:
   ```
   index.html          # Main entry point (or frontend.html)
   frontend_bundle.js  # ~2-4 MB main JS
   engine_bundle.js    # Trace processor WASM (~3-8 MB)
   perfetto.css        # Styles
   assets/             # WASM + web workers
   ```
4. Place all files into: `dataviewer/static/perfetto_ui/`
5. The main entry HTML is usually `index.html` or `frontend.html` — note which
   one exists (we'll iframe it)
6. **Verify**: Start Django dev server, open `/static/perfetto_ui/index.html`
   in browser — Perfetto UI should load

> **Note**: If the exact filenames differ by release version, adjust the iframe
> `src` in step 2 below accordingly.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  perfettoviewer.html (Django template, ~120 lines)   │
│  ┌───────────────────────────────────────────────┐  │
│  │  Nav bar (ArchVisual style)                    │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  iframe: /static/perfetto_ui/index.html │  │  │
│  │  │  (self-hosted, no internet needed)      │  │  │
│  │  │                                         │  │  │
│  │  │  Receives traces via postMessage:       │  │  │
│  │  │  { method: "openTrace",                 │  │  │
│  │  │    args: [ArrayBuffer] }                │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │  Server file browser overlay (same pattern    │  │
│  │  as metricviewer.html)                        │  │
│  └───────────────────────────────────────────────┘  │
│                ▲                                     │
│                │ postMessage (trace buffer)          │
│                │                                     │
│  /api/show/server_list  ─► browse trace files       │
│  /api/show/server_file  ─► read trace JSON content  │
└─────────────────────────────────────────────────────┘
```

## Files to Create/Modify

### 1. NEW: `dataviewer/static/perfetto_ui/` (manual, one-time)

Drop the downloaded Perfetto UI release files here. Served directly by Django's
static file handler. No code changes needed — just file placement.

### 2. NEW: `dataviewer/templates/perfettoviewer.html`

Thin wrapper template. Key sections:

```
├── <style> — Reuses .nav-bar / .content / .footer / .hidden / .embedded
│            CSS from traceviewer.html (copy-paste, ~40 lines)
├── <div class="nav-bar"> — Links to other ArchVisual pages
├── <div class="content">
│   └── <iframe id="perfettoFrame"
│        src="/static/perfetto_ui/index.html?v=1">
│       </iframe>
├── <div class="footer"> — Copyright
└── <script>
    ├── isEmbedded check (hide nav/footer if ?embedded=true)
    ├── Server file browser (postMessage to parent, as in traceviewer.html)
    ├── loadTraceIntoPerfetto(traceJsonString)
    │   └── TextEncoder → ArrayBuffer → postMessage to iframe
    └── (Phase 2) BroadcastChannel sync listener
    </script>
```

**Core JavaScript — loading a trace:**

```javascript
const perfettoFrame = document.getElementById('perfettoFrame');

function loadTraceIntoPerfetto(traceJsonString) {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(traceJsonString).buffer;
    perfettoFrame.contentWindow.postMessage(
        { method: 'openTrace', args: [buffer] },
        '*'  // same-origin, safe to use '*'
    );
}
```

**Key Perfetto postMessage API (works identically in self-hosted):**

| Method       | Args             | Description                        |
|-------------|------------------|------------------------------------|
| `openTrace`  | `[ArrayBuffer]`  | Load trace from binary/text buffer |
| `PING`       | `[]`             | Returns `PONG` — readiness check   |

### 3. MODIFY: `archvisual/urls.py`

```python
path('perfettoviewer', dataviewer.views.page_perfettoviewer),
```

### 4. MODIFY: `dataviewer/views.py`

```python
def page_perfettoviewer(request):
    return render(request, 'perfettoviewer.html')
```

### 5. MODIFY (Phase 2): Navigation bars

Add `PerfettoViewer` link to nav bars in:
- `traceviewer.html`
- `metricviewer.html`
- `crossviewer.html`
- `perfettoviewer.html` (self-link)

### 6. MODIFY (Phase 2): CrossViewer integration

Add PerfettoViewer as a third panel option in `crossviewer.html`.

### 7. MODIFY (Phase 2): BroadcastChannel sync

In `perfettoviewer.html`, listen on `BroadcastChannel('klxarch')` for
`SYNC_METRIC_TO_TRACE` messages and zoom Perfetto via postMessage
(e.g., `{method: 'setViewport', ...}`).

## Implementation Steps

### Phase 1 — Core standalone viewer ✅ DONE

1. **Download Perfetto UI bundle** ✅ — Mirrored from `ui.perfetto.dev/v56.1-c794fceab/`
   (stable channel, v56.1). Placed in `dataviewer/static/perfetto_ui/`.
   Modified `index.html` to use relative paths (`version = '.'`) for offline.
2. **Create `perfettoviewer.html`** ✅ — Wrapper template with nav bar,
   embedded mode support, server API message forwarding, BroadcastChannel stub.
3. **Add URL route** ✅ — `path('perfettoviewer', ...)` in `urls.py`
4. **Add view** ✅ — `page_perfettoviewer()` in `views.py`

### Phase 2 — Integration with existing viewers (TODO)

5. **Add nav links** across all viewer pages
6. **CrossViewer support** — Add Perfetto as a selectable panel
7. **BroadcastChannel sync** — Metric ↔ Perfetto zoom correlation

## Catapult vs Perfetto (Self-Hosted)

| Aspect         | Catapult (current)                      | Perfetto (new)                         |
|---------------|----------------------------------------|----------------------------------------|
| Static assets  | `catapult_trace_viewer.html` + `.js`   | `perfetto_ui/` (downloaded ~5-10 MB)  |
| Dep size (LOC) | ~17,000 lines of JS/HTML               | 0 lines (just file drop)              |
| Wrapper template | `traceviewer.html` (~310 lines)      | `perfettoviewer.html` (~120 lines)     |
| Entry point    | `/traceviewer`                         | `/perfettoviewer`                      |
| Load trace     | `_tview.setActiveTrace(name, data)`    | `postMessage({method:'openTrace',...})`|
| Offline        | ✅ Fully offline                       | ✅ Fully offline (after bundle download)|

## Estimated Effort

| Phase | Files                    | Lines |
|-------|--------------------------|-------|
| 1     | `perfettoviewer.html`    | ~120  |
| 1     | `urls.py`                | +1    |
| 1     | `views.py`               | +4    |
| 2     | Nav bars (4 templates)   | +20   |
| 2     | `crossviewer.html`       | +30   |
| **Total** |                      | **~175** |
