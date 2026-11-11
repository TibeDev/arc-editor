# Arc Editor — Optimization Work Handoff

Date: 2026-11-11
Repository: `/home/tibevdb/Documents/Apps/vdb-ide`
Branch: `ram-usage-optimizing`
Base commit: `5be7a17` ("Fixed project structure in editor")
Status: optimization groups implemented in the working tree; **not committed**.

This document is the continuation handoff for the memory/performance optimization work. It records what was done, why, what remains, and how to continue safely.

Evidence labels:

- **Confirmed** — directly verified by reading code, running the build, or running tests.
- **User-reported** — supplied by the project owner; not independently measured here.
- **Hypothesis** — plausible and code-adjacent, but requires profiling before claiming an effect.

No runtime RAM or CPU measurement was performed during this work. No before/after performance numbers are claimed.

---

## 1. Project purpose and objectives

Arc Editor is a desktop workspace for web development:

- File browser and file tree.
- CodeMirror 6 editor with tabs and nested splits.
- xterm.js terminal backed by Rust PTYs.
- GitHub panel using `git` and `gh` CLI.
- JavaScript plugin system with a broad API.
- Themes, settings, Markdown preview, Prettier formatting, live server.

Stack: Tauri 2 (Rust backend) + React 19 + TypeScript strict + Vite 6; CodeMirror 6; xterm + portable-pty; Prettier 3.

The optimization objective, as stated by the user:

- The application was reported to use approximately **500 MB RAM**.
- Reduce memory usage without sacrificing functionality, stability, editing capability, or responsiveness.
- Secondary priorities: CPU usage, rendering performance, startup time, file open/save performance, general responsiveness, background resource consumption.
- Implement only optimizations with sufficient evidence.
- Preserve unsaved changes, undo history, terminal sessions, plugins, themes, settings, keyboard shortcuts, splits, and filesystem watching.
- Work in small, independent, testable groups and report after each group.
- Do not overwrite or modify the user's previous working build; use it as a baseline.
- Do not invent measurements or claim improvements without evidence.

Required input documents:

- `OPTIMIZATION_AUDIT.md` — the original audit brief.
- `OPTIMIZATION_RESEARCH.md` — the research catalogue that identified concrete optimizations.
- Note: the user wrote `OPTMIZATION_AUDIT.md` once; the actual file is `OPTIMIZATION_AUDIT.md`.

The research document is the authoritative optimization catalogue. Its IDs are used throughout this handoff (`CM-01`, `PL-05`, `FS-01`, etc.).

---

## 2. Current state and completed work

### 2.1 Repository state

Confirmed by `git status`:

- Modified:
  - `src/App.tsx`
  - `src/assets.d.ts`
  - `src/pluginRuntime.ts`
  - `src/terminalOutput.ts`
  - `src-tauri/src/lib.rs`
- Untracked (created by the prior research phase, not by this implementation):
  - `OPTIMIZATION_AUDIT.md`
  - `OPTIMIZATION_RESEARCH.md`
  - `OPTIMIZATION_HANDOFF.md` (this file)
- Pre-existing deletions in the working tree, **not caused by this work**:
  - `LANGUAGE_PLUGIN_SUPPORT.md`
  - `PLUGIN_API_IMPLEMENTATION.md`
  - `PLUGIN_API_IMPLEMENTATION_TODO.md`
  - `PLUGIN_API_PROPOSALS.md`

Do not restore or commit those deleted files without checking with the user.

### 2.2 Verification performed

Confirmed:

- `npm run build` → exit 0 (this is the frontend typecheck gate: `tsc -b && vite build`). Re-verified after Groups 4–6.
- `cargo test` in `src-tauri/` → 4 tests passed, 0 failed. The local-server test now also asserts non-HTML asset streaming.
  - `tests::local_server_encodes_file_urls`
  - `tests::parses_git_status_and_github_remote_urls`
  - `tests::watcher_maps_events_and_filters_ignore_paths`
  - `tests::local_server_serves_files_blocks_traversal_and_reloads`
- `cargo fmt` was run; formatting is clean.
- One pre-existing Rust test warning remains: unused test import `DataChange` at `src-tauri/src/lib.rs` around line 3037. It is unrelated to this work.

Not performed:

- No runtime profiling.
- No heap snapshot.
- No RSS/CPU comparison against the old build.
- No manual UI test session.
- No commit.

### 2.3 Implemented optimization groups

#### Group 1 — Low-risk confirmed wins

1. **`CM-06`: plugin provider guard before full-document context**
   - Added `PluginLanguageBase` and `activeLanguageBase` in `src/pluginRuntime.ts`.
   - `pluginProviders(kind, context)` now accepts the lightweight `{ path, language }` shape.
   - Code lens, inlay hints, semantic tokens, completion, hover, and folding now check matching providers before calling `activeLanguageContext()`.
   - If `pluginLanguageProviders` is empty, these paths return immediately without even building the base context.
   - Effect: scrolling/selecting no longer calls `editor.state.doc.toString()` when no plugin provider can consume it.

2. **`CM-02`: single selection context build**
   - `onSelectionChange` in `src/App.tsx` now builds `getPluginEditorContext(path)` once and emits the same object to `editor:selection-changed` and `editor:context-changed`.

3. **`PL-05`: plugin process sink cleanup and bounded pending output**
   - `src/pluginRuntime.ts`.
   - Pending stdout/stderr chunk lists capped at 256 KiB total per stream.
   - `pendingExit` and `pendingError` are single-slot arrays.
   - On natural process exit, `schedulePluginProcessSinkCleanup(id)` removes the sink after a 30 s grace period when no listeners remain.
   - Explicit `stop()` still deletes the sink immediately.

4. **`PL-06`: bounded plugin output channels**
   - `src/pluginRuntime.ts`.
   - Buffer capped at 100,000 characters, keeping the newest output.
   - Adds a visible `… earlier output truncated …` marker when truncation occurred.
   - Panel updates batched on a 16 ms timer; timer cancelled by `clear()` and `dispose()`.

5. **`PL-07`: automatic plugin PTY/socket listener cleanup**
   - `src/pluginRuntime.ts`.
   - `spawnPluginPty` and `connectPluginSocket` now use a `closed` flag, idempotent `cleanup()`, and a `track()` helper.
   - Natural `terminal-exit` or `plugin-socket-close` delivers final events, then unlistens all Tauri listeners.
   - Listeners that resolve after cleanup are immediately unlistened.
   - Explicit `stop()`/`close()` calls `cleanup()`.

6. **`PL-03`: stop rewriting built-in plugin files on every startup**
   - `src/pluginRuntime.ts`.
   - Built-in is written only when:
     - first seed flag is unset, or
     - installed `plugin.json` version differs from the bundled manifest version, or
     - installed `main.js` is missing, or
     - reading/parsing the installed manifest fails.
   - Preserves built-in update/repair behavior while removing unconditional startup writes.

7. **`FS-01`: remove duplicate workspace scan**
   - `src/App.tsx`.
   - Added `scannedTree` ref keyed by `${rootPath}\u0000${settings.showHiddenFiles}`.
   - `refreshWorkspace` records the key after a successful scan.
   - The `workspace` effect skips its scan when the key already matches; hidden-file setting changes still trigger a rescan.
   - `openWorkspace`, startup restore, watcher fallback, and explicit plugin refreshes still call `refreshWorkspace` as before.

#### Group 2 — Responsiveness and IPC

8. **`TE-02`: batch terminal history replay**
   - `src/terminalOutput.ts`.
   - Replay joins chunks and calls the subscriber callback in batches of at least 256 KiB, instead of one callback/write per historical chunk.
   - Live terminal output path is unchanged.
   - Subscriber membership is rechecked during replay; `active` is set only after replay completes.

9. **`RS-04`: batch filesystem watcher IPC**
   - `src-tauri/src/lib.rs`.
   - Mapped events for one debounce window are emitted as one `Vec<FsEvent>` payload under the same `fs-changed` event name.
   - Catch-up events for a newly registered subtree are emitted as one array payload.
   - `src/App.tsx` listens for `FsEvent[]` and queues each element in order.
   - Plugin `api.files.watch` in `src/pluginRuntime.ts` now iterates the array payload; its per-change `{ kind, path }` handler contract is unchanged.
   - **Compatibility note:** the `fs-changed` payload shape is now an array. Rust and frontend must be built/released together. There is no backward-compatible single-object fallback.

#### Group 3 — Rust plugin process output

10. **`RS-05` (output batching part only): batch plugin process stdout/stderr**
    - `src-tauri/src/lib.rs`, `stream_process_output`.
    - Reader thread sends 16 KiB reads over a bounded `sync_channel(4)`.
    - Forwarder accumulates up to 32 KiB or 8 ms, then emits one `plugin-process-output` event.
    - Flushes pending output on timeout and channel disconnect.
    - Event shape is unchanged.
    - The 50 ms `try_wait` exit polling was **not** changed; see limitations.

---

#### Group 4 — Lazy plugin source loading

11. **`PL-01`: lazy built-in plugin source loading**
    - `src/pluginRuntime.ts`.
    - `../plugins/*/main.js` is now a lazy `import.meta.glob` loader map instead of an eager raw string map.
    - `builtinPackages` keeps manifests and source paths only; the source string is loaded on demand through `loadBuiltinSource()`.
    - Built-in sources are read only when seeding/repairing files or installing a built-in plugin.
    - `src/assets.d.ts` gained the non-eager `ImportMeta.glob` overload used by this call.

12. **`PL-04`: load source only for enabled plugins**
    - `src/pluginRuntime.ts`.
    - `InstalledPlugin.source` is now optional.
    - Startup reads `main.js` only for enabled plugins; disabled plugins retain metadata only.
    - `setEnabled` reads the source before enabling and drops it when disabling.
    - Concurrent enable/disable toggles are guarded by a per-plugin token so a slow read cannot override the newer state.
    - Activation skips an enabled plugin with no loaded source instead of creating a Blob from `undefined`.

13. **`PL-02`: single built-in source representation**
    - Module-level raw source strings are no longer retained after startup; only lazy loaders and the active plugin's source remain.

---

#### Group 5 — Low-risk allocation and I/O wins

14. **`CM-05`: reuse indent guide decorations**
    - `src/App.tsx`.
    - The `cm-indent-guide` mark and the leading-whitespace regex are now module-level constants.
    - Ranges are built with `RangeSetBuilder` instead of an array plus `Decoration.set()` sort.
    - Appearance and rebuild triggers are unchanged.

15. **`RS-03`: stream non-HTML local-server assets**
    - `src-tauri/src/lib.rs`.
    - HTML is still read and live-reload-injected in memory.
    - Other files are opened and copied to the socket with `std::io::copy`, using the file metadata length for `Content-Length`.
    - Shared header writing is factored into `write_live_response_header`.
    - Added a CSS streaming assertion to the local-server test.

16. **`PL-10`: lazily start the plugin process bus**
    - `src/pluginRuntime.ts`.
    - The three global `plugin-process-*` Tauri listeners are registered on the first `spawnPluginProcess` call, not at module import.
    - Sink replay and cleanup behavior are unchanged.

---

#### Group 6 — Duplicate-path editor tracking

17. **`CM-04`: track one editor view per path and group**
    - `src/App.tsx`.
    - `editorViews` is now `Map<string, Map<GroupId, EditorView>>`.
    - Each `EditorPane` registers and removes its own view by group ID; an empty group map is deleted.
    - Added `editorViewForPath()`, which prefers the active group's view and falls back to any live view for the path.
    - Plugin `getEditor`, editor snapshots/context, and `setEditorText` use the helper.
    - Opening and closing the same path in different split groups no longer leaves a live view untracked.

---

## 3. Technical architecture and implementation details

### 3.1 Repository layout

```
index.html               Vite entry
src/                     React + TypeScript frontend
src-tauri/               Rust/Tauri backend
  src/lib.rs             All Tauri commands, watcher, PTY, server, plugin processes, tests
  src/main.rs            Entry; NVIDIA/Wayland env workaround; app-data migration
  capabilities/         Tauri permission scopes
plugins/                 Built-in plugins (self-contained ES modules)
dist/                    Build output (gitignored)
.github/workflows/       Tag-driven release pipeline
```

Frontend line counts after this work:

- `src/App.tsx` — 5,039 lines. Deliberate monolith: app shell, tree, tabs, editor panes, splits, command palette, context menus, search, workspace state.
- `src/pluginRuntime.ts` — 4,537 lines. Plugin discovery, activation, API surface, providers, processes, sockets, HTTP, panels.
- `src/terminalOutput.ts` — 116 lines.
- `src-tauri/src/lib.rs` — 3,196 lines.

### 3.2 File/document model

Confirmed from research and code:

- `openFiles` is metadata: `{ path, name, revision, dirty }`.
- `fileContents` is `Map<string, string>` with full text of each open file.
- Active CodeMirror `EditorState` has its own immutable `Text` tree.
- The active file can therefore have two full representations: the string in `fileContents` and the CodeMirror `Text` tree.
- Inactive files have only the string.
- Closing the last tab deletes the path from `fileContents` and `lastDiskWrite`, and removes open-file metadata.
- Workspace switch clears `fileContents` and `lastDiskWrite`.
- There is no LRU or total-byte budget.

### 3.3 Editor lifecycle

- `EditorPane` in `App.tsx` creates one `EditorView` for the active file.
- The creation effect depends on `file?.path`, so switching tabs destroys the old view and creates a new one.
- `onActivate`, `onChange`, `pluginEditorExtensions`, and `editorViews` are stable; the audit's unstable-callback hypothesis was not supported.
- Settings, theme, and language are updated through `Compartment.reconfigure()`; they do not recreate the editor.
- Only the most recently unmounted file's selection/scroll is stored in one per-pane `snapshot` ref.
- Undo history is lost on tab switch because it lives in the destroyed `EditorState`.
- `editorViews` groups live views by path and group ID, so duplicate paths in splits are tracked correctly.

### 3.4 Plugin lifecycle

- Built-in manifests are eagerly collected with `import.meta.glob(..., { eager: true })`; built-in `main.js` sources are lazy loader entries.
- `builtinPackages` keeps manifest objects plus source paths; source strings are loaded on demand.
- Startup seeds/repairs built-ins when needed, then reads every plugin folder and parses manifests. `main.js` is read only for enabled plugins.
- `InstalledPlugin` has an optional `source`; it is absent for disabled plugins.
- Enabled plugins are activated by effect via Blob URL and dynamic import.
- Deactivation clears timers, workers, handlers, disposables, cleanup, and the Blob URL, and removes registrations.
- Plugin panels mount only when active.
- `pluginLanguageProviders` is a flat array filtered on each lookup.
- `activeLanguageContext` is assigned during plugin activation and is used by plugin language features.

### 3.5 Terminal lifecycle

- Only the active terminal in an editor pane is rendered.
- Unmounting disposes xterm and unsubscribes.
- `terminal_spawn` is idempotent; the shell stays alive across remounts.
- `terminalOutput.ts` keeps a global 2 MiB / 8,000-chunk history across sessions.
- Rust PTY uses one reader thread plus one batching thread per PTY, a four-chunk channel, 16 KiB reads, 32 KiB events, and 8 ms receive timeout.
- Closed terminal IDs are capped at 128.

### 3.6 Filesystem watcher

- `watch_project` replaces the previous watcher.
- Non-recursive watchers are registered directory by directory.
- Caps: 3,000 directories, 5,000 catch-up entries, 32 failures, 200 ms debounce.
- Tooling directories are ignored; `.arcwatchignore` is supported.
- After this work, events are emitted as arrays per debounce/catch-up batch.
- Frontend queues events and flushes on `requestAnimationFrame`.
- The watcher remains the authoritative live-update path; focus/visibility rescan is only a fallback when the watcher is unavailable.

### 3.7 Local live server

- `local_file_signature()` walks the tree and hashes names, lengths, and mtimes, capped at 20,000 entries.
- The watcher thread polls every 700 ms while a browser has polled within 30 seconds.
- The HTTP server spawns one thread per accepted connection.
- Non-injected files are read fully into memory per request.
- Not changed in this work.

### 3.8 Plugin processes and sockets

- Rust spawns stdout/stderr reader threads and a 50 ms `try_wait` exit monitor per process.
- `plugin_process_stop` must lock the same child mutex the monitor uses, which is why blocking `wait()` cannot be used without restructuring.
- Frontend `pluginProcessSinks` map holds listener sets and pending output.
- After this work: pending output is capped, natural exit schedules sink cleanup, and process output is batched in Rust.
- Plugin PTY/socket Tauri listeners now clean up on natural end as well as explicit stop/close.

---

## 4. Important decisions and reasoning

### 4.1 Implemented because evidence was confirmed

- Provider work (`CM-06`) was confirmed by code: three ViewPlugins called `activeLanguageContext()` on every document/viewport/selection change, and that helper called `doc.toString()` before checking provider count.
- Duplicate selection context (`CM-02`) was confirmed: `getPluginEditorContext()` was called twice per selection/focus change.
- Process sink retention, output channel growth, and listener cleanup gaps (`PL-05`, `PL-06`, `PL-07`) were confirmed by code paths.
- Duplicate workspace scan (`FS-01`) was confirmed by two `refreshWorkspace` calls on open/restore.
- Unnecessary built-in rewrite (`PL-03`) was confirmed by the `seedBuiltins || await exists(folder)` condition.
- Watcher IPC and plugin process output batching (`RS-04`, `RS-05` output part) were confirmed by event-per-read/per-entry emission.

### 4.2 Deliberately not implemented, and why

- **`CM-01` / `FD-01` (full-document string on every keystroke)**
  - `fileContents` is the canonical buffer used by save, format, conflict detection, and plugin APIs.
  - Removing per-keystroke `doc.toString()` requires making CodeMirror's `Text` canonical while the view is alive, plus a compatibility path for plugins expecting `event.content`.
  - Medium-high risk to dirty tracking, save, external reload, and plugin contract.
  - Requires profiling and a deliberate API plan.

- **`CM-03` (per-path `EditorState` cache)**
  - Would fix undo-history loss and tab-switch cost, but increases retained memory per cached document/history.
  - Research says profile first; no heap data exists.

- **`CM-07` (large-file mode)**
  - Needs measured thresholds and visible UX; silently disabling features is not acceptable.

- **`FD-02` (LRU/file budget)**
  - No evidence open-file strings dominate the ~500 MB.
  - Eviction adds disk latency and data-loss risk.

- **`FD-03` / `GE-01` (worker formatting)**
  - Confirmed main-thread Prettier, but no save long-task profile.

- **`PL-09` (lazy plugin activation)**
  - High risk to activation ordering and plugins that register global listeners/commands during activation.

- **`RS-01` (live-server signature polling)**
  - Needs watcher-based invalidation or subtree signature caching, not a simple interval change.

- **`RS-02` (server thread pool)**
  - Confirmed unbounded per-connection threads.
  - Normalized load test should come first; current normal use is low risk.

- **`RE-01` / `RE-02` (React memoization / command memoization)**
  - No React Profiler data; the research explicitly warns against memoizing everything.

- **`TE-03` (terminal history fairness)**
  - Not a leak; bounded total. Changes history distribution, not memory.

- **`LA-01` / `workspaceState.ts`**
  - Unwired dead module; tree-shaken. Decision is product work, not memory.

### 4.3 Architecture decisions preserved

- `App.tsx` remains a monolith; no state library.
- CodeMirror remains the editor; no replacement.
- Tauri/Rust remain the backend.
- Only active editor instances and active xterm instances stay mounted.
- No aggressive global feature disabling.
- No lowering of user terminal scrollback.

---

## 5. Configurations, dependencies, and conventions

### 5.1 Commands

Run from repository root unless noted:

```sh
npm install
npm run tauri dev        # dev app, Vite on :1420, hot reload
npm run build            # tsc -b + production frontend build (typecheck gate)
npm run tauri build      # full release build / installers
cargo test               # run in src-tauri/
cargo fmt && cargo clippy # run in src-tauri/
```

There is **no frontend test runner**. `npm run build` is the frontend verification gate. Rust has unit tests in `src-tauri/src/lib.rs`.

### 5.2 TypeScript conventions

- Strict mode.
- `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- `verbatimModuleSyntax`: use `import type` for types.

### 5.3 Settings and themes

- `AppSettings` is versioned with `APP_SETTINGS_VERSION` in `src/settings.ts`.
- Adding a setting requires:
  - `AppSettings`
  - `DEFAULT_SETTINGS`
  - merge/migration logic
  - `SettingsPanel.tsx` wiring
- Themes are `ThemeDefinition` objects (~30 color slots), applied by generated CSS.
- New UI colors should map to theme slots, not hardcoded hex.

### 5.4 Plugins

- Built-in plugins live under `plugins/*/main.js` and are self-contained ES modules.
- No bare package imports in built-in plugins.
- Built-ins are bundled raw via `import.meta.glob`.
- Plugin API is documented in `PLUGIN_API.md`; keep it in sync when changing the API.
- `PLUGIN_API.md` currently documents `editor:changed` as `{ path, content }`.
- Plugin API compatibility matters; changes must be additive or versioned.

### 5.5 Tauri capabilities and security

- `src-tauri/capabilities/default.json` restricts filesystem access to `$HOME`, `$DOCUMENT`, `$DOWNLOAD`, `$APPDATA`.
- URL opening is restricted to `http://127.0.0.1:*`, `github.com`, `cli.github.com`, `git-scm.com`.
- CSP is `null` because the plugin system needs broad JS.
- Update scopes deliberately; do not widen casually.
- Plugin JavaScript is trusted once installed; install prompts warn the user.

### 5.6 Versions

Keep versions in sync across:

- `package.json` — currently `0.1.2`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Release workflow enforces this on tags.

### 5.7 Build artifacts

- `dist/`, `src-tauri/target/`, `src-tauri/gen/` are gitignored.
- `npm run build` regenerated `dist/`; this is not part of source changes.

---

## 6. Bugs, limitations, and issues already addressed

Confirmed by implementation:

- Full-document plugin context work during scroll/selection with zero providers.
- Duplicate full context construction per selection.
- Unbounded plugin process pending stdout/stderr retention.
- Plugin process sink retained after natural exit.
- Unbounded plugin output channel growth and full-buffer republish per append.
- Plugin PTY/socket Tauri listener leak on natural end.
- Built-in plugin files rewritten on every startup.
- Duplicate workspace scan on open/restore.
- Terminal replay invoking one callback per historical chunk.
- One Tauri event per watcher event/catch-up entry.
- One Tauri event per plugin process read chunk.

Not changed, but noted:

- ~500 MB total attribution is unknown; WebView/native/GPU/child processes were never profiled.
- Closed files are released from application maps; GC/native memory may make them appear retained.
- `workspaceState.ts` is unwired.
- `restoreTerminals` exists in settings but is not consumed at runtime.
- The 5 MiB open-file prompt is the only large-file guard.
- Language, Prettier, panels, GitHub, settings, theme maker, and xterm are already dynamically loaded.
- File tree and search results are already virtualized.
- Terminal output history is bounded at 2 MiB / 8,000 chunks.
- GitHub caches are bounded to six workspaces.

---

## 7. Outstanding issues and known risks

### 7.1 Measurement gap

- No runtime measurement exists for any optimization.
- The ~500 MB figure is user-reported and unattributed.
- Do not claim specific MB savings without measurement.

### 7.2 Behavior/regression risks introduced

- **Watcher payload shape changed** to arrays. Older frontend/backend combinations are incompatible.
- **Plugin process sink cleanup** removes sinks 30 s after natural exit if no listeners remain. A plugin attaching an exit listener more than 30 s after process exit would miss replay. This is an intentional bounded-retention tradeoff.
- **Plugin output cap** discards oldest output above 100,000 characters. The panel shows a truncation marker.
- **Plugin output publish batching** means panel DOM updates can lag up to 16 ms. Output text itself is preserved (subject to cap).
- **Terminal replay batching** changes callback granularity, not output order.
- **`FS-01` scan-key tracking** depends on `showHiddenFiles` being part of the key; other scan-affecting inputs do not currently exist.
- **`PL-03` version-based repair** will not detect a modified but same-version built-in `main.js`. Release process bumps versions.
- **Rust process output batching** uses `String::from_utf8_lossy` on accumulated bytes. A multi-byte UTF-8 character split at an emit boundary can be replaced with the lossy character. The old per-read code had the same class of issue at read boundaries; batching reduces but does not eliminate it. A future fix is a streaming UTF-8 decoder or byte payloads.

### 7.3 Known unbounded or inefficient paths still present

- Per-keystroke full document materialization (`doc.toString()` → `fileContents` → `editor:changed`).
- No total open-document memory budget.
- Editor undo history lost on tab switch; no per-path `EditorState` cache.
- Live-server full-tree signature polling every 700 ms while polled.
- Local HTTP server reads whole files and spawns a thread per connection.
- Plugin process exit monitor polls every 50 ms per process.
- `pluginProviders` still filters a flat array on each call.
- All enabled plugins activate at startup.

### 7.4 Correctness risks not addressed

- Potential split drag/drop edge cases with the same path in two groups.
- No heap snapshot means no evidence for cache eviction or state caching.

---

## 8. Requirements and constraints that must not be violated

From the audit and user instructions:

1. Do not remove features to save memory.
2. Do not replace CodeMirror, Tauri, Rust, React, or xterm.
3. Do not rewrite the application from scratch.
4. Do not introduce large new dependencies without justification.
5. Do not make speculative changes without identified benefit.
6. Do not introduce data loss.
7. Do not break unsaved document handling.
8. Do not break editor splits or tabs.
9. Do not break terminal persistence; hidden terminals must keep shell and output.
10. Do not break plugins or the plugin API without an additive/versioned plan.
11. Do not break filesystem watching.
12. Do not break themes, settings, or keyboard shortcuts.
13. Do not sacrifice editing responsiveness for lower memory.
14. Do not hide memory usage by changing measurement/reporting methods.
15. Do not implement optimizations solely because they are listed.
16. Do not introduce unnecessary architectural complexity.
17. Do not make unrelated refactors.
18. Do not claim improvements without measurements or a documented limitation.
19. Preserve user-visible state: undo history, cursor, selection, scroll.
20. Preserve accessibility, keyboard behavior, split layout, and drag/drop.
21. Do not overwrite or modify the user's previous build; use it as a baseline.
22. Keep changes maintainable and small where possible.

---

## 9. Relevant files and purposes

### Frontend

| File | Purpose | Touched |
| --- | --- | --- |
| `src/App.tsx` | App shell, tree, tabs, splits, `EditorPane`, command palette, context menus, search, workspace state, plugin host actions. | Yes |
| `src/pluginRuntime.ts` | Plugin discovery/activation/API, language providers, processes, sockets, output channels, panels, HTTP. | Yes |
| `src/terminalOutput.ts` | Global bounded terminal output history and replay subscriptions. | Yes |
| `src/TerminalView.tsx` | xterm instance lifecycle and PTY wiring. | No |
| `src/settings.ts` | `AppSettings`, defaults, migration, themes, theme CSS. | No |
| `src/SettingsPanel.tsx` | Settings UI. | No |
| `src/GithubPanel.tsx` | GitHub panel UI and git/gh calls. | No |
| `src/PluginPanel.tsx` | Plugin install/enable/disable/remove UI. | No |
| `src/ThemeMaker.tsx`, `src/ThemeColorPicker.tsx` | Custom theme editor. | No |
| `src/workspaceState.ts` | Unwired workspace snapshot module. | No |
| `src/main.tsx` | React root. | No |

### Backend

| File | Purpose | Touched |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | All Tauri commands, PTY, watcher, GitHub shell-outs, plugin processes/sockets, local HTTP server, Rust tests. | Yes |
| `src-tauri/src/main.rs` | Entry; NVIDIA/Wayland workaround; app-data migration `dev.glasswing.ide` → `dev.arc.ide`. | No |
| `src-tauri/capabilities/default.json` | Tauri permission scopes. | No |
| `src-tauri/Cargo.toml` | Rust dependencies and Linux window-vibrancy pin. | No |
| `src-tauri/tauri.conf.json` | Tauri config and version. | No |

### Docs and inputs

| File | Purpose |
| --- | --- |
| `OPTIMIZATION_AUDIT.md` | Original audit brief with phases, priorities, and constraints. |
| `OPTIMIZATION_RESEARCH.md` | Research catalogue; authoritative optimization IDs and evidence labels. |
| `OPTIMIZATION_HANDOFF.md` | This continuation document. |
| `AGENTS.md` | Agent guide: architecture, commands, conventions, gotchas. |
| `PLUGIN_API.md` | Full plugin API reference. |
| `FILE_WATCHER.md` | Watcher spec/notes. |
| `apple-design.md` | UI design direction. |
| `README.md` | User-facing overview. |

### Key modified code locations

Approximate current line numbers after formatting:

- `src/App.tsx:1456` — `scannedTree` ref.
- `src/App.tsx:2076` — `fs-changed` array listener.
- `src/App.tsx:2320`, `2361` — scan-key recording and effect skip.
- `src/App.tsx` around `4327` — single selection context build.
- `src/pluginRuntime.ts:236` — plugin output buffer limit.
- `src/pluginRuntime.ts:785` — built-in rewrite condition.
- `src/pluginRuntime.ts:1023` — `activeLanguageBase`.
- `src/pluginRuntime.ts:1050`-ish — output channel batching/truncation.
- `src/pluginRuntime.ts:1202`-ish — plugin `fs-changed` array handling.
- `src/pluginRuntime.ts:2737` — `PluginLanguageBase` and `activeLanguageBase`.
- `src/pluginRuntime.ts:3106`, `3129`, `3174`, `3212` — provider guards in ViewPlugins/completion/hover/folding.
- `src/pluginRuntime.ts:3829`-ish — process pending buffer cap.
- `src/pluginRuntime.ts:3862` — process sink cleanup.
- `src/pluginRuntime.ts:3980`, `4029` — PTY/socket cleanup helpers.
- `src/terminalOutput.ts:10`, `80` — replay batch limit and replay loop.
- `src-tauri/src/lib.rs:601` — `stream_process_output` batching.
- `src-tauri/src/lib.rs:2731` — `watch_project`; batched emits near line 2819 and catch-up near 2866.
- `src-tauri/src/lib.rs:795` — `plugin_process_stop` (unchanged; relevant to exit polling limitation).

---

## 10. Recommended next steps

### 10.1 First: verify and commit the current work

1. Re-run:
   ```sh
   npm run build
   cd src-tauri && cargo test && cargo fmt --check
   ```
2. Manually verify:
   - Open a workspace; tree appears once, no flicker.
   - Toggle hidden files; tree rescans.
   - Open/close tabs; save; external edits; formatting.
   - Scroll/select in a large file; no visual regressions.
   - Enable/disable plugins; plugin output panel; plugin language features.
   - Spawn/exit a plugin PTY and socket; no blocked cleanup.
   - Switch between terminals with large output; order preserved.
   - Copy a large folder tree; tree updates correctly.
3. If the user approves, commit as one optimization group or split into logical commits.
4. Do not commit the pre-existing deleted markdown files unless the user confirms.

### 10.2 Second: establish the baseline comparison

The user has an older working build. Do not overwrite it.

Fair comparison procedure:

1. Copy the old build artifact to a stable location, e.g.:
   ```sh
   mkdir -p /tmp/arc-baseline
   cp /path/to/old/Arc.AppImage /tmp/arc-baseline/
   ```
2. Build the new version with the same profile (`npm run tauri build`).
3. Run both on the same OS, same workspace, same files, same tabs, same splits, same terminals, same settings.
4. Measure native aggregate RSS for the main process plus WebKit and child processes:
   ```sh
   ps -eo pid,ppid,rss,comm,args | rg 'arc|WebKit|webkit'
   smem -P 'arc|WebKit'
   ```
5. Record at minimum:
   - Startup / idle.
   - Workspace opened.
   - 10 open files.
   - 30 open files.
   - One large file (10k, 50k, 100k lines; minified JS; large JSON/HTML).
   - Multiple splits.
   - Multiple terminals.
   - After closing files.
   - Return to idle.
6. Use the same measurement method and release build for both; do not compare dev and release.
7. For CPU:
   - Idle.
   - Large folder copy.
   - Live server open/closed.
   - Terminal switching.
   - Chatty plugin process.
   - Scrolling a large file with and without plugin providers.

Objective checks available without full profiling:

- Count `fs-changed` events before/after (batched arrays vs per-event).
- Profile scroll/selection in WebKit devtools; compare time in `activeLanguageContext` / `doc.toString`.
- Measure terminal remount time with 2 MiB history.
- Time workspace open/restore and count `readDir` calls.
- Time startup with built-ins and check file writes (strace or mtime).

### 10.3 Third: choose the next optimization group only after profiling

Recommended order based on research and current state:

1. **`CM-01` + `FD-01`** — the largest confirmed per-keystroke allocation.
   - Requires making the active CodeMirror `Text` canonical while the view is alive.
   - Keep `fileContents` for inactive/dirty buffers or materialize on save/format/plugin request.
   - Preserve `editor:changed` compatibility: either keep a full-content fallback for listeners, add `getDocumentText()`, or version the event.
   - Validate typing latency and heap on 10k/100k-line files.
   - Do not start without a profiling baseline.

2. **`CM-03`** — per-path `EditorState` cache.
   - Fixes undo/history/selection loss and tab-switch cost.
   - Must be bounded and measured; never lose unsaved edits.
   - Reapply compartments on restore.

3. **`RS-01`** — replace live-server tree polling with watcher-driven invalidation or subtree signature caching.

4. **`RS-02`** — bounded local-server connection handling if load testing shows thread/RSS spikes.

5. **`RE-01` / `RE-02`** — only after React Profiler shows pane reconciliation or command list work is material.

6. **`CM-07`** — measured large-file mode with visible UX.

### 10.4 Do not do without new evidence

- LRU eviction of open files.
- Keeping every `EditorView` or every xterm mounted.
- Global syntax-highlighting/feature disabling.
- Broad `React.memo` / `useMemo` application.
- Replacing CodeMirror/Tauri/React/xterm.
- Large `App.tsx` split solely for style.
- Claims of RAM/CPU savings without measurement.

### 10.5 Useful verification checklist for any future group

- Editor: open, close, switch, splits, move tabs, language change, theme change, settings change, large files, save, restore unsaved, undo/redo, external changes, formatting.
- Terminal: multiple terminals, switching, hide/show, background shell alive, output not lost, resize, settings.
- Plugins: enable, disable, open/close panels, cleanup, functionality, process/PTY/socket paths.
- Workspace: open, switch, large directories, external modify/rename/delete, create directories, watcher correctness.
- Other: GitHub panel, live server, theme management, settings, Markdown preview.
- Build: `npm run build`; Rust: `cargo test`, `cargo fmt --check`.

---

## 11. Confirmed facts vs assumptions

### Confirmed

- Code changes listed above exist in the working tree.
- `npm run build` passes.
- `cargo test` passes 4 tests.
- The watcher payload is now an array.
- Plugin output is capped at 100,000 characters with truncation marker.
- Plugin pending output is capped at 256 KiB per stream.
- Terminals replay in 256 KiB batches.
- Workspace scan is skipped when the scan key matches.
- Built-ins are no longer rewritten unconditionally.
- Built-in `main.js` sources are lazy-loaded; they are not retained at module scope.
- Disabled plugins retain metadata only; their source is read on enable and dropped on disable.
- `InstalledPlugin.source` is optional.
- Indent guides reuse one module-level mark and a `RangeSetBuilder`.
- Non-HTML local-server assets stream from disk; HTML is still injected in memory.
- The plugin process bus is registered on first process spawn, not at module import.
- Duplicate paths opened in different split groups are tracked per group; plugin lookups prefer the active group.
- No runtime profiling or measurement was performed.
- No commit was made.

### User-reported, not independently verified

- Arc uses approximately 500 MB RAM.
- The user has a previous working build for comparison.

### Hypotheses requiring profiling

- The provider guard materially reduces scroll/selection CPU in large files.
- Batching watcher IPC and plugin process output materially reduces CPU/IPC overhead.
- Terminal replay batching improves perceived responsiveness.
- The implemented changes reduce RAM measurably.
- File-content duplication contributes meaningfully to the ~500 MB.
- Caching `EditorState` is worth its retained memory.
- Memoizing React panes is worth the comparison cost.
- Cache eviction or large-file mode is necessary.

---

## 12. Quick-start context for a new conversation

If starting fresh, read in this order:

1. `AGENTS.md` — architecture, commands, conventions.
2. `OPTIMIZATION_RESEARCH.md` — full optimization catalogue and evidence.
3. `OPTIMIZATION_AUDIT.md` — original requirements and constraints.
4. This handoff.
5. `git diff` — exact current changes.
6. `src/App.tsx`, `src/pluginRuntime.ts`, `src/terminalOutput.ts`, `src-tauri/src/lib.rs` — implementation areas.

Immediate next action: verify the current working tree, establish the old-vs-new baseline, then select the next group based on measured evidence. Do not begin `CM-01`/`FD-01` without a performance baseline and an explicit plugin-event compatibility decision.
