# Arc Performance Research

Research date: 2026-11-13. Target: Tauri 2 + React 19 + CodeMirror 6 + xterm frontend, Rust backend.

This document records the audit findings, the root causes, what was implemented, and what remains. No runtime profiler trace was captured. Every "expected" impact below is an inference from the code paths, not a benchmark result. The verification gates that were run are listed at the end.

## 1. Architecture paths that matter

- `src/App.tsx` owns almost all UI state and renders the shell, file tree, tabs, editor panes, terminal hosts, context menus, command palette, and search.
- `src/lib/pluginRuntime.ts` owns plugin activation, the plugin event bus, the plugin file/editor/terminal APIs, plugin decorations, and language providers.
- `src-tauri/src/lib.rs` owns PTY sessions, git/gh calls, the project watcher, the embedded local HTTP server, plugin processes/sockets/HTTP, keyring access, and window blur.
- Files are read and written directly through `@tauri-apps/plugin-fs`. CodeMirror holds the authoritative document while a tab is open. `fileContents` is a React-side mirror used for saving, conflict detection, and plugin access.
- The watcher sends `fs-changed` batches. The frontend queues those batches and flushes them once per animation frame.

The highest-cost paths were:

1. Document mirroring on every edit.
2. Remounting editors/terminals on tab switches.
3. Root-level React state updated during pointer and scroll movement.
4. Repeated Tauri commands that block the main thread or shell out synchronously.
5. Full-project scans triggered per item instead of per batch.
6. Plugin work executed on every transaction even when no provider needs it.

## 2. Findings by severity

### Critical

| Location | Finding | Root cause | Status |
| --- | --- | --- | --- |
| `src/App.tsx` editor update listener | Every CodeMirror transaction converted the entire document with `doc.toString()`, wrote `fileContents`, and emitted `editor:changed` with the full text. Cost was O(file size) per keystroke. | CodeMirror and React both held a full document copy; the sync was synchronous with the transaction. | Fixed: edits are coalesced into one animation frame per path. Cleanup/save flush the exact editor document. |
| `src/App.tsx` Theme Maker branch | Opening Theme Maker returned before the main shell, unmounting editors and terminals. Returning remounted everything and respawned terminals. | Theme Maker was rendered as an early-return page instead of an overlay. | Fixed: Theme Maker is a fixed overlay; the workspace stays mounted. |
| `src/App.tsx` terminal host | Only the active terminal had a `TerminalView`. Switching away disposed xterm; switching back recreated it, replayed up to 2 MB, and called `terminal_spawn` again. | Conditional render tied xterm lifetime to tab activation. | Fixed: one `TerminalView` per session stays mounted; activation only controls visibility, focus, and fit. |

### High

| Location | Finding | Root cause | Status |
| --- | --- | --- | --- |
| `src/App.tsx` sidebar drag | `setSettings` ran on every `pointermove`, re-rendering the whole App (tree, tabs, panes). | Pointer state was stored in React state. | Fixed: drag writes width/flex-basis directly in a `requestAnimationFrame`; React state is committed on pointer up. |
| `src/App.tsx` settings persistence | `JSON.stringify` and synchronous `localStorage.setItem` ran on every settings object change, including each drag frame and slider tick. | Effect persisted immediately. | Fixed: 250 ms trailing debounce, writes the latest settings ref. |
| `src/App.tsx` theme CSS | `themeCss()` and the injected `<style>` changed whenever the whole settings object changed, even if no color/geometry field changed. | Memo dependency was the entire `settings` object. | Fixed: memo depends only on fields `themeCss` reads. |
| `src/App.tsx` tree scroll | `setTreeScrollTop` ran on every scroll event and re-rendered the App tree. | No throttle. | Fixed: one `requestAnimationFrame` per scroll burst, bucketed row offset. |
| `src/App.tsx` bulk copy/move | Copy, paste, duplicate, and move each called `refreshWorkspace` per item, so a multi-item operation ran N full recursive scans. | Refresh was embedded in the per-entry helper. | Fixed: bulk operations refresh once after the batch. |
| `src/App.tsx` watcher modified path | Every modified event for an open file read the whole file and fingerprinted it, including the app's own save. | Self-write detection depended on content comparison. | Fixed: saves record a short-lived self-write marker; the first matching watcher event is skipped before the read. |
| `src/App.tsx` selection/context events | Selection changes emitted two plugin events per cursor movement and keystroke, each rebuilding editor context. | No throttle and duplicated event paths. | Fixed: selection/context events are throttled to 80 ms. |
| `src/lib/pluginRuntime.ts` `activeLanguageContext` | Serialized the whole document on every completion, hover, folding, and view-plugin refresh. | Context construction always produced full text. | Fixed: text is cached by CodeMirror `Text` identity; word extraction uses the current line, not a document prefix. |
| `src/lib/pluginRuntime.ts` language view plugins | CodeLens, inlay hints, and semantic tokens refreshed on every doc, viewport, and selection change. | Update handler had no debounce. | Fixed: refresh is debounced to 80 ms and no longer reacts to viewport-only changes. |
| `src/lib/pluginRuntime.ts` plugin file writes | Each write/create/delete/copy/move/trash call ran a full workspace refresh. | Refresh was awaited inside every file API method. | Fixed: plugin file mutations share a 40 ms coalescing refresh; awaited callers resolve after it. |
| `src/App.tsx` / plugin editor events | `editor:changed` still carries full document text, but now at most once per animation frame per path instead of per keystroke. | Event contract carries full content. | Partially fixed. A version/delta contract remains a future API change. |

### Medium

| Location | Finding | Root cause | Status |
| --- | --- | --- | --- |
| `src/App.tsx` `makeTree` | Sort comparator split paths repeatedly. | Depth was recomputed inside O(n log n) comparisons. | Fixed: depth map precomputed once. |
| `src/App.tsx` `createAnchorVisible` | Scanned all visible tree nodes on every render. | Derived value was not memoized. | Fixed: memoized on selection and visible nodes. |
| `src/App.tsx` theme loading | Theme directories were read and parsed sequentially. | Sequential `await` inside loop. | Fixed: parallel reads with `Promise.all`. |
| `src/App.tsx` keyboard handling | Plugin shortcut strings were split and normalized on every key event. | No parsed-shortcut cache. | Fixed: parsed shortcut cache. |
| `src/App.tsx` HTML template expansion | Serialized the whole document before checking that the cursor was at EOF. | Check order. | Fixed: selection/length checks run first. |
| `src/App.tsx` command palette | Normalized the query once per command. | Query normalization inside filter. | Fixed: normalized once per render. |
| `src/lib/pluginRuntime.ts` recursive listing | Used `Array.shift()` in a BFS, making large trees O(n²). | Queue implementation. | Fixed: head index, no shifting. |
| `src/lib/pluginRuntime.ts` `matchGlob` | Compiled a new `RegExp` for every path/pattern check. | No cache. | Fixed: bounded regex cache. |
| `src/lib/pluginRuntime.ts` plugin decorations | Decoration sets were not remapped through document changes. | State field ignored `transaction.changes`. | Fixed: sets map through changes before effects apply. |
| `src/lib/pluginRuntime.ts` output channel | Appended to one string with `buffer = buffer + text`, O(n²) over long output. | String accumulation. | Fixed: chunk array plus bounded trimming. |
| `src/lib/pluginRuntime.ts` read streams | `openReadStream` read the whole file before returning a stream. | Wrapper over `readFile`. | Fixed: incremental reads through the Tauri file handle. |
| `src/components/TerminalView.tsx` input | One `terminal_write` IPC per `onData` event. | No input coalescing. | Fixed: 8 ms input batching. |
| `src/components/TerminalView.tsx` output | One `xterm.write` per output event. | No output coalescing. | Fixed: output is batched once per animation frame. |
| `src/components/TerminalView.tsx` resize | `ResizeObserver` called `fit()` and `terminal_resize` on every observation. | No frame coalescing or size check. | Fixed: rAF coalescing and skip when cols/rows do not change. |
| `src/lib/terminalOutput.ts` subscriber fanout | One throwing subscriber stopped fanout to later subscribers. | No per-subscriber error isolation. | Fixed: each callback is isolated. |
| `src/components/GithubPanel.tsx` auth polling | Poll interval could overlap an in-flight `github_status`. | No in-flight guard. | Fixed: in-flight guard. |
| `src-tauri/src/lib.rs` `watch_project` | Sync command on the main thread; tree walk and watcher registration ran while holding the watcher lock. | Command body was synchronous and lock scope was too wide. | Fixed: async command; watcher build/walk runs outside the lock; old watcher is dropped outside the lock. |
| `src-tauri/src/lib.rs` `unwatch_project` | Dropped the debouncer while holding the watcher lock. | Lock scope. | Fixed: async command; watcher taken under the lock and dropped outside it. |
| `src-tauri/src/lib.rs` local server start/stop | Creating the HTTP server and joining watcher/accept threads happened on the main thread or while holding the server lock. | Sync commands and wide lock. | Fixed: async commands; server creation and old-server drop happen outside the lock. |
| `src-tauri/src/lib.rs` local server watcher | Re-hashed the entire tree on every debounced batch. | `local_file_signature` per batch. | Fixed: batch events bump the generation in O(1). The full signature remains for startup and the polling fallback. |
| `src-tauri/src/lib.rs` plugin process/socket commands | Process exec/stop, socket connect/write, terminal close, secret access, and trash were synchronous commands, so blocking work ran on the main thread. | Missing async command annotation. | Fixed: async command annotations. The bodies still use blocking syscalls, but they no longer run on the UI thread. |
| `src-tauri/src/lib.rs` `github_status` | Redundant `git config` calls before repository detection; repeated `git --version`/`gh --version`/`gh auth status` per poll. | Status was rebuilt from scratch each call. | Fixed: version and auth checks cached for 15 s / 3 s; duplicate config calls removed. |
| `src-tauri/Cargo.toml` release profile | `opt-level = "z"` favors size over hot-path speed. | Size-first release build. | Changed to `opt-level = 3`; LTO and `codegen-units = 1` stay. Binary size will grow. |
| `src/styles/styles.css` glass blur | Settings panel/header were blurred although their background is opaque. | Unconditional `backdrop-filter`. | Fixed: removed blur from opaque settings surfaces. Blur remains on translucent surfaces. |

### Low / deliberately noted

- GitHub status still executes several git subprocesses per call. Combining `remote -v`, `config --list`, and status output would reduce process count further, but changes parsing and error semantics.
- GitHub staging still runs one `git add` per file. A batch command would require a new Tauri command and caller changes.
- Terminal PTY output still allocates an extra chunk buffer and copies into a pending buffer. The existing 8 ms / 32 KiB batching is already effective.
- Plugin socket and HTTP bodies still travel as JSON number arrays. A base64 or raw-binary IPC contract would improve large payloads but changes the plugin API wire shape.
- Large-file mode still relies on the 5 MB confirmation only. Adaptive highlighting/autocomplete thresholds were not introduced because they change editor behavior.
- Prettier formatting still runs on the main thread. Moving it to a worker requires bundling/serialization work and was left as a follow-up.
- `App.tsx` still has no `React.memo` boundaries. Making memoization effective requires stable pane props and replacing the per-render `file` object; doing that without redesigning ownership would add complexity for uncertain gain.
- Settings and theme compartments are still reconfigured on tab switches. Fixing that cleanly requires initializing compartments with settings/theme extensions at editor creation. It is a safe follow-up, not a one-line dependency change.
- The CodeMirror indent-guide plugin still rebuilds visible decorations on document changes. Mapping through changes would fix cursor-adjacent edits, but recomputation is still needed when indentation changes, so the gain is smaller than the plugin language plugins.

## 3. Implemented changes by file

### `src/App.tsx`

- Coalesced editor-to-React content synchronization into one animation frame per changed path.
- Flushed editor documents on save and on editor cleanup so coalescing cannot lose content.
- Skipped the full-file read for the watcher event caused by the app's own save.
- Kept Theme Maker mounted as an overlay instead of unmounting the workspace.
- Kept one xterm instance per terminal session.
- Moved sidebar drag updates out of React state and into rAF-driven DOM writes.
- Debounced settings persistence.
- Narrowed theme CSS memo dependencies.
- Throttled tree scroll state and selection/context plugin events.
- Batched workspace refresh after bulk copy/move/duplicate/paste.
- Precomputed tree depth, memoized create-anchor visibility, parallelized theme loading.
- Cached parsed plugin shortcuts, normalized command query once, reordered template expansion checks.

### `src/components/TerminalView.tsx`

- Terminal creation no longer depends on activation.
- Input batching (8 ms).
- Output batching (one frame).
- Resize batching and duplicate-size suppression.

### `src/lib/terminalOutput.ts`

- Isolated subscriber callbacks so one failure does not stop other terminals.

### `src/lib/pluginRuntime.ts`

- Cached language context text by CodeMirror `Text` identity.
- Debounced language view-plugin refreshes.
- Mapped plugin decorations through document changes.
- Replaced BFS `shift()` with a head index.
- Added a bounded glob regex cache.
- Coalesced plugin-triggered workspace refreshes.
- Made `openReadStream` incremental.
- Replaced output string concatenation with bounded chunks.

### `src/components/GithubPanel.tsx`

- Prevented overlapping auth-status polls.

### `src-tauri/src/lib.rs`

- Made blocking commands async (`watch_project`, `unwatch_project`, terminal commands, plugin process/socket commands, secret commands, trash, local server start/stop).
- Moved watcher and local-server construction/destruction outside global locks.
- Replaced per-batch tree hashing in the local server watcher with a generation bump.
- Cached git/gh availability and GitHub auth status.
- Removed duplicate `git config` work in `github_status`.

### `src-tauri/Cargo.toml`

- Release `opt-level = 3`.

### `src/styles/styles.css`

- Removed backdrop blur from opaque settings surfaces.

## 4. Expected user-visible effects

These are expected, not benchmarked:

- Typing in large files should no longer do a full document copy per keystroke; the mirror updates at most once per rendered frame.
- Switching tabs should no longer destroy and recreate editors/terminals, so terminal scrollback and editor undo history survive longer. Editor panes are still recreated by the existing `EditorPane` lifecycle; terminal state is the larger win.
- Dragging the sidebar should stop re-rendering the file tree and editor panes on every pointer move.
- Bulk file operations should show one tree refresh instead of one per file.
- Plugin-heavy sessions should do less per-keystroke work when no language provider is registered.
- Operations involving process spawn, git/gh, sockets, keyring, and local server startup should no longer freeze the UI thread.

## 5. Measurement plan

No before/after benchmark was recorded. To validate the changes:

1. Typing latency: open a 1–5 MB file, hold a key, and compare `Performance` traces. Look for `toString`, `updateFile`, and React commits in the flame chart.
2. Tab switching: switch between an editor and a terminal repeatedly. Check that `Terminal.spawn`/`terminal_spawn` does not repeat and that xterm DOM nodes are reused.
3. Sidebar drag: record a pointer-drag trace and confirm React commits occur on pointer up, not on every move.
4. Bulk copy: copy 50 files into a folder and count `refreshWorkspace` scans (or `readDir` calls) in a trace.
5. Plugin idle cost: open an editor with no language-provider plugin active and confirm the three language view plugins return without calling providers.
6. Rust main-thread blocking: trigger a slow `gh auth status`, unreachable socket connect, or local server stop while dragging a window; UI should remain responsive.
7. Release build: compare binary size and startup time after the `opt-level` change; if size is a priority, benchmark `"s"` as a middle ground.

## 6. Verification run

- `npm run build` (TypeScript project build + Vite production build): passed.
- `cargo test --quiet` in `src-tauri/`: 7 tests passed.
- `cargo fmt` applied to the backend.

One pre-existing warning remains: unused `DataChange` import in the backend test module. It was not introduced by these changes.

## 7. Remaining risks

- The editor content coalescer relies on editor cleanup calling `onChange` with the final document. This is synchronous and occurs before `editor.destroy()`, so unsaved content should not be lost. It should be exercised with: type, switch tab immediately, switch back, save.
- The self-write marker suppresses the first modified watcher event within 3 seconds of a save. A genuine external edit in that window could be skipped, but the subsequent watcher event or focus fallback will catch it.
- Terminal instances now start when their tab exists, not only when selected. This trades a small amount of startup work per terminal tab for instant switching.
- Async command annotations move blocking work off the UI thread, but blocking work still occupies Tokio worker threads. Large concurrent git/socket workloads can still contend; use `spawn_blocking` if that becomes measurable.
- Theme Maker is an overlay inside the app shell. It keeps the workspace mounted, which is the intended behavior, but the overlay must stay above title bar and panel z-indexes.
