# Web View Panel Research

Status: research only, no code changed
Date: 2026-11-26
Target: Arc 0.1.2, Tauri 2.12.5, Linux/Wayland first
Goal: open a website in an editor tab, next to code and terminal

## TL;DR

Do **not** build the whole feature on Tauri child webviews. On Linux they are still broken for normal tab layouts.

Recommended path:

1. **Phase 1:** add a preview tab that renders local dev servers and workspace HTML in an `<iframe>`. This works today on all platforms because Arc's own local server sends no `X-Frame-Options` or `Content-Security-Policy`.
2. **Phase 2:** for arbitrary external sites, try an iframe and detect frame-blocking headers. If blocked, offer "Open in browser". Optionally use a native child webview only on Windows/macOS, behind a feature flag.
3. **Do not** promise "any website inline on Linux" until Tauri fixes Linux child-webview positioning. That is the main technical blocker.

If the product requirement is truly "a browser inside the editor for any site", the honest options are a separate native browser window, or bundling a browser engine. Tauri's system webview cannot be reliably embedded in a Linux tab today.

## Product decision: core feature, not a plugin

This should be a first-class Arc feature, not a plugin or extension:

- It lives in `src/App.tsx` with the other built-in panels (`GitHub`, `Plugins`, `Build`).
- It uses a built-in tab key, a built-in React component, and built-in Rust commands.
- It is available without installing or enabling anything.
- It does not depend on the plugin API, plugin permissions, or plugin lifecycle.
- The existing local server is reused as infrastructure, not exposed as a plugin feature.

The plugin system already proves the tab/panel pattern, but the preview should not be implemented through `pluginRuntime` or `plugins/*/main.js`.

## Current Arc architecture

The editor already has the right extension points:

- Internal tabs are plain string keys in `src/App.tsx:197-200`:
  - `internal:github`
  - `internal:plugins`
  - `internal:builder`
  - `internal:plugin-view:<id>`
- Tab entries are built in `tabItems` at `src/App.tsx:1175-1194`.
- Tab rendering and per-panel branches are at `src/App.tsx:1253-1338`.
- Panel open functions follow the same pattern at `src/App.tsx:2493-2550`.
- Dropped internal tabs are allow-listed at `src/App.tsx:3493-3495`.
- Panels are lazy-loaded components with colocated CSS, for example `GithubPanel` at `src/App.tsx:145-150`.

Arc also already has a local HTTP server:

- `plugin_local_server_start` at `src-tauri/src/lib.rs:2359`.
- Server creation at `src-tauri/src/lib.rs:2431`.
- Live-reload injection at `src-tauri/src/lib.rs:2740`.
- Response headers at `src-tauri/src/lib.rs:2726-2756`: no `X-Frame-Options`, no `Content-Security-Policy`. That is exactly what makes the iframe approach work.

Tauri production origin is `tauri://localhost` on macOS/Linux and `http://tauri.localhost` on Windows by default. Tauri docs note that the default custom-scheme setup allows HTTP endpoints; only `useHttpsScheme: true` would introduce mixed-content blocking. Arc does not set `useHttpsScheme`, so loading `http://127.0.0.1:...` in an iframe should not be blocked by mixed content.

## Requirements

Minimum useful feature:

- New tab type: Web Preview.
- URL bar with back, forward, reload, open-external.
- Local dev server support with HMR and live reload.
- Workspace HTML file support (serve through Arc's local server).
- Multiple preview tabs, one per URL.
- Tab close, split, drag, and keyboard shortcut integration.
- Clear fallback when a site refuses to be framed.

Nice-to-have:

- Auto-detect `http://localhost:PORT` from terminal output.
- Persist last preview URL.
- DevTools for preview content.
- External-site preview on Windows/macOS.

## Option A: iframe tab (recommended Phase 1)

### How it works

Render a normal `<iframe>` inside a tab. The iframe is a real browsing context, so HMR WebSockets, cookies, service workers, and normal page JavaScript work as they do in a browser, subject to cross-origin rules.

For local dev servers this is the best fit:

- Vite/Next/Astro dev servers do not send `X-Frame-Options` by default.
- Arc's own static server sends no framing headers.
- Live reload injection already exists in Arc's server.

### What works

- Local dev servers (`http://localhost:5173`, `http://127.0.0.1:3000`, etc.).
- Workspace HTML served by Arc's local server.
- HMR and WebSocket connections.
- Multiple preview tabs.
- Split editor layout, because the iframe is a normal DOM child.

### What does not work

- Sites that send `X-Frame-Options: DENY` or `SAMEORIGIN`.
- Sites whose CSP contains `frame-ancestors` that excludes Arc.
- Sites that check `document.referrer`, `window.top`, or frame origin.
- Some OAuth/login flows that refuse to run in a frame.
- Cross-origin DOM access from Arc into the iframe. `contentDocument` is unavailable. `postMessage` only works if the site listens.

This is a browser security rule, not a Tauri bug. It cannot be disabled from inside the iframe.

### Implementation sketch

Add a key prefix and a preview model:

```ts
const PREVIEW_PREFIX = 'internal:preview:';

type PreviewTab = {
  key: string;
  url: string;
  title: string;
};
```

Keep a `previews` array in `App.tsx`, derive `previewsByKey` like `pluginViewsByKey`, and extend `tabItems`:

```ts
const tabItems = useMemo(
  () =>
    group.tabs
      .map((key) => ({
        key,
        file: filesByPath.get(key),
        terminal: terminalsByKey.get(key),
        github: key === GITHUB_TAB_KEY,
        plugins: key === PLUGIN_TAB_KEY,
        builder: key === BUILDER_TAB_KEY,
        pluginView: pluginViewsByKey.get(key),
        preview: previewsByKey.get(key),
      }))
      .filter(
        (entry) =>
          entry.file ||
          entry.terminal ||
          entry.github ||
          entry.plugins ||
          entry.builder ||
          entry.pluginView ||
          entry.preview,
      ),
    [filesByPath, group.tabs, pluginViewsByKey, previewsByKey, terminalsByKey],
  );
```

Render it next to the other internal panels:

```tsx
{group.activePath.startsWith(PREVIEW_PREFIX) && (
  <Suspense fallback={<div className="editor-empty" />}>
    <WebPreview
      tab={previewsByKey.get(group.activePath)!}
      onChange={(patch) => updatePreview(group.activePath, patch)}
    />
  </Suspense>
)}
```

Component shape:

```tsx
export function WebPreview({ tab, onChange }: Props) {
  return (
    <div className="web-preview">
      <form
        className="web-preview-bar"
        onSubmit={(event) => {
          event.preventDefault();
          onChange({ url: normalizeUrl(tab.url) });
        }}
      >
        <input
          value={tab.url}
          onChange={(event) => onChange({ url: event.target.value })}
          spellCheck={false}
          aria-label="Preview URL"
        />
        <button type="submit">Go</button>
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
      </form>
      <iframe
        key={tab.url}
        className="web-preview-frame"
        src={tab.url}
        title={tab.title || 'Web preview'}
        allow="clipboard-read; clipboard-write; fullscreen"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
```

Do not add `sandbox` for local trusted previews unless the sandbox flags are fully understood. A sandbox that combines `allow-scripts` and `allow-same-origin` on same-origin content can let the framed page remove its own sandbox. For external content, sandboxing is safer but will break many sites.

CSS: add `.web-preview` beside `.editor-pane` and `.editor-host` in `src/styles/styles.css:346` and `src/styles/styles.css:423`. The frame must fill the pane and must not sit under the tab strip.

### URL handling

- Accept only `http:` and `https:`. Reject `file:`, `javascript:`, `data:`, `blob:`.
- Normalize bare hosts (`example.com` -> `https://example.com`).
- Keep the iframe keyed by URL so changing the URL creates a fresh document.
- Use `referrerPolicy="no-referrer"` to avoid leaking `tauri://localhost`.
- For workspace files, do not use `file://`. Start Arc's local server and use its `http://127.0.0.1:PORT/...` URL. `file://` inside a Tauri webview has different origin and CSP behavior, and Arc's capability scopes are not built around it.

### Local server reuse

`plugin_local_server_start` is already the right server, but it is tied to a plugin id. Do not fake a plugin id. Extract the shared start/stop logic and expose:

```rust
#[tauri::command(async)]
fn preview_server_start(
    app: tauri::AppHandle,
    state: State<'_, LocalHttpServerState>,
    root: String,
    entry: String,
) -> Result<LocalServerInfo, String> {
    start_local_server(&app, &state, "arc-preview", root, entry)
}

#[tauri::command(async)]
fn preview_server_stop(state: State<'_, LocalHttpServerState>) -> Result<bool, String> {
    stop_local_server(&state, "arc-preview")
}
```

Keep the existing checks:

- Canonicalize the root.
- Require a directory.
- Require `app.fs_scope().is_allowed(&root)`.
- Reject path traversal in `entry`.

If a dev server is already running (Vite, Next), just use its URL. Do not start a second server.

### Frame-block detection

An iframe does not expose a reliable load failure for `X-Frame-Options`. Add a small Rust command that checks headers before loading:

```rust
#[tauri::command]
async fn preview_frame_check(url: String) -> Result<bool, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) URLs can be checked".into());
    }
    // HEAD or GET with redirects disabled, short timeout.
    // Blocked if X-Frame-Options is DENY/SAMEORIGIN,
    // or CSP frame-ancestors excludes the app.
}
```

Use a small HTTP client. `ureq` is enough; adding `reqwest` pulls in a larger tree. Treat network errors as "unknown, let the iframe try". The header check is advisory, not a guarantee.

When blocked, show an overlay:

> This site does not allow embedding. [Open in browser]

### Security notes

- Do not add a Tauri `remote` capability for preview URLs. The iframe runs at `http://localhost:...`, not at the app origin, and does not need IPC.
- On Linux and Android, Tauri cannot distinguish an iframe request from the window itself when matching remote capabilities. Never grant a remote capability that could match preview content.
- Arc's CSP is currently `null` in `src-tauri/tauri.conf.json`. If CSP is hardened later, add `frame-src http: https:`.
- The preview iframe can reach local network services, just like a browser. That is expected for a dev preview. Do not turn this into a backend proxy with filesystem access.
- Opening arbitrary URLs in the system browser needs the opener scope widened. Current scope in `src-tauri/capabilities/default.json` only allows `127.0.0.1`, GitHub, and Git docs. Prefer a dedicated Rust command that validates `http:`/`https:` over widening the global opener scope.

### Effort

About 1-2 days for a solid Phase 1:

- Tab model and wiring: half day.
- Component and CSS: half day.
- Server command extraction: half day.
- Frame check and fallback: half day.
- Manual testing and edge cases: half day.

## Option B: native child webview (`Window::add_child`)

Tauri 2 has a real embedded browser API, but it is behind the `unstable` Cargo feature.

### API

```toml
# src-tauri/Cargo.toml
tauri = { version = "2", features = ["unstable"] }
```

```rust
let window = app.get_window("main").unwrap();
let webview = window.add_child(
    tauri::webview::WebviewBuilder::new(
        "preview-1",
        tauri::WebviewUrl::External("https://example.com".parse().unwrap()),
    ),
    tauri::LogicalPosition::new(x, y),
    tauri::LogicalSize::new(width, height),
)?;
```

The child webview is a native layer, not a DOM node. It must be positioned, shown, hidden, resized, and closed manually from Rust or JS. It is composited over the window and is not clipped by the DOM.

### Platform status

| Platform | Status |
| --- | --- |
| Windows | Works, but do not create from a synchronous command or event handler. Use async commands or a separate thread. |
| macOS | Works. Creation can block the main thread for roughly 50-200 ms. Use an async command. |
| Linux/X11 | Historically broken. Child webviews are packed into the window's vertical `gtk::Box` and stack vertically; `set_bounds` is ignored. |
| Linux/Wayland | Still broken. Issue #15656 reports incorrect bounds on Ubuntu 26.04 + WebKitGTK 2.52.3. |

As of Tauri 2.12.x, the Linux fix is not merged upstream. Issue #10420 remains open; community patches use `gtk::Fixed` and a wry change, but they are forks, not released behavior. Arc targets Linux/Wayland first, so this is a blocker.

### Security

- Remote URLs in a child webview get no IPC access unless a `remote` capability matches them. Do not add one.
- Give each preview webview its own label, for example `preview-<uuid>`.
- Do not inject scripts with secrets into remote content.
- Handle navigation: use `on_navigation` to allow only `http`/`https`, or to open external links in the system browser.

### Effort

- Windows/macOS only: 3-5 days, plus ongoing risk from the unstable feature.
- Linux: not feasible until upstream fixes positioning. A fork of `tao`/`tauri`/`wry` is not worth it for one feature.

## Option C: overlay `WebviewWindow`

Use a stable, separate `WebviewWindow` with no decorations, positioned over the editor area.

```rust
tauri::WebviewWindowBuilder::new(
    &app,
    "preview",
    tauri::WebviewUrl::External("https://example.com".parse().unwrap()),
)
.decorations(false)
.shadow(false)
.skip_taskbar(true)
.resizable(false)
.position(x, y)
.inner_size(width, height)
.build()?;
```

Pros:

- Stable API, no `unstable` feature.
- Full browser behavior for external sites.
- Cookies and storage behave like a normal browser.

Cons:

- It is a separate OS window, not a DOM child. It is not clipped by the tab strip or editor pane.
- Must sync position on window move, resize, tab switch, split changes, sidebar changes, and zoom.
- Z-order and focus are awkward. Clicking the editor may leave the preview on top.
- On Linux/Wayland, clients cannot position top-level windows. `set_position` will not reliably work. This makes it a poor fit for Arc's primary target.
- On X11 it can work, but still needs careful lifecycle management.

Effort: 2-3 days on Windows/macOS/X11, plus a platform fallback for Wayland. Not recommended as the main path.

## Option D: Rust proxy that strips framing headers

A Rust HTTP proxy could fetch the target page, remove `X-Frame-Options` and CSP `frame-ancestors`, rewrite URLs, and serve it to an iframe.

Why this is not recommended:

- Relative URLs, redirects, cookies, authentication, CORS, WebSockets, service workers, and JavaScript-generated URLs all need rewriting.
- Many sites detect proxies or require their real origin.
- It becomes a general-purpose web proxy with SSRF and security implications.
- It will break in subtle ways and is a large maintenance burden.

This is weeks of work for a worse result than a real browser window.

## Option E: external browser fallback

Use the existing opener plugin or a dedicated command to open the URL in the system browser.

This is the correct fallback for sites that refuse framing. It is not a replacement for an in-editor preview, but it should be present from Phase 1.

Current opener scope is narrow. Prefer:

```rust
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    // Validate http/https, then call the opener plugin.
}
```

over adding `http://**` and `https://**` to the global opener capability.

## Comparison

| Approach | Local dev server | External sites | Linux/Wayland | Effort | Risk |
| --- | --- | --- | --- | --- | --- |
| iframe tab | Yes | Mostly no (framing headers) | Yes | 1-2 days | Low |
| Native child webview | Yes | Yes | Broken today | 3-5 days + unstable | High |
| Overlay WebviewWindow | Yes | Yes | Positioning broken | 2-3 days | Medium |
| Rust proxy | Yes | Partial, fragile | Yes | Weeks | Very high |
| External browser | N/A | Yes | Yes | Hours | Low |

## Recommended plan

### Phase 1: iframe preview tab

Ship this first:

- `WebPreview` component with URL bar, reload, open-external.
- Preview tab type and multiple tabs.
- Local server command for workspace HTML.
- Frame-block check and fallback overlay.
- Keyboard shortcut and command palette entry.
- CSS consistent with `apple-design.md` layered surfaces.
- Tests: local server still sends no framing headers; frame-check parser unit tests; manual `npm run tauri dev`.

This gives the main workflow: run Vite/Next in the terminal, open the preview tab, see the app update live next to the code.

### Phase 2: external-site strategy

Decide based on product priority:

- If external sites are required inline: implement a native child webview on Windows/macOS only, and keep iframe + external browser on Linux. Document the platform difference.
- If external sites are occasional: keep iframe attempt + "Open in browser". This is honest and stable.
- Do not ship a Linux child-webview implementation until Tauri fixes `add_child` positioning on GTK/Wayland.

### Optional: terminal URL detection

Arc already buffers terminal output in `src/lib/terminalOutput.ts`. Scan for `http://(localhost|127.0.0.1):\d+` and show an "Open in preview" pill. This is a small, high-value addition after Phase 1.

## Files and changes

Frontend:

- `src/App.tsx`: add `PREVIEW_PREFIX`, preview state, `tabItems` entry, render branch, open/close/update functions, command palette entry, keybinding.
- `src/components/WebPreview.tsx`: new component.
- `src/components/WebPreview.css`: new styles, or add to `src/styles/styles.css`.
- `src/App.tsx:3493`: allow preview keys in `openDroppedFile`.
- `src/App.tsx:3362`: ensure `closeTab` cleans up preview state and stops the preview server if it owns it.
- `src/App.tsx:3877`: `setActiveTab` needs no special handling if the key is in `group.tabs`.

Backend:

- `src-tauri/src/lib.rs`: extract local server start/stop helper; add `preview_server_start`, `preview_server_stop`, `preview_frame_check`, `open_external_url`.
- `src-tauri/src/lib.rs` `generate_handler!`: register new commands.
- `src-tauri/Cargo.toml`: add `ureq` if frame check is implemented in Rust.
- `src-tauri/capabilities/default.json`: only if JS creates windows or opens URLs. Prefer Rust commands to avoid widening scopes.

Docs:

- `README.md`: mention the preview tab and its framing limitation.
- `AGENTS.md`: only if a new command or feature boundary is worth documenting.

Tests:

- Rust: frame-check parser (XFO and CSP cases), local server headers, path traversal still blocked.
- Frontend: `npm run build` for typecheck; manual verification because there is no frontend test runner.

## Risks and open questions

1. **External sites are the hard part.** The iframe will not work for many real websites. The UI must make this clear and not look broken.
2. **Linux child webviews are not ready.** Do not design the product around them.
3. **Wayland cannot position overlay windows.** A separate-window preview is not a reliable Linux solution.
4. **Unstable Tauri API.** Enabling `unstable` can introduce breaking changes in minor releases. Avoid unless there is a concrete platform-specific win.
5. **Security boundary.** Never grant remote IPC to preview content. Keep preview URLs at `http://localhost` or external origins with no Tauri capabilities.
6. **Port conflicts.** Arc's local server tries 5500 and falls back to a random port. The preview should use the returned URL, not assume 5500.
7. **Multiple preview servers.** Decide whether each preview tab owns a server or whether one server serves the workspace root. One server per workspace is simpler and avoids port churn.
8. **Persisted URLs.** If preview tabs are restored later, validate the URL again and do not auto-start servers for stale paths.

## References

- Tauri multiwebview example: https://github.com/tauri-apps/tauri/blob/dev/examples/multiwebview/main.rs
- `Window::add_child` docs: https://docs.rs/tauri/latest/tauri/window/struct.Window.html
- Tauri `unstable` feature: https://docs.rs/tauri/latest/tauri/
- Linux multiwebview positioning issue: https://github.com/tauri-apps/tauri/issues/10420
- Linux/Wayland child bounds issue: https://github.com/tauri-apps/tauri/issues/15656
- Tauri capabilities and remote access: https://tauri.app/security/capabilities/
- Tauri iframe origin advisory: https://github.com/tauri-apps/tauri/security/advisories/GHSA-57fm-592m-34r7
- Tauri `WebviewWindow` API: https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow
- X-Frame-Options: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options
- CSP `frame-ancestors`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors
- Mixed content: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content
- Example frame check implementation: https://github.com/MaxMoffa/flowcode/blob/master/src-tauri/src/preview.rs
- Terax preview notes (iframe for local, native child webview for external): https://terax.app/docs/features/preview
