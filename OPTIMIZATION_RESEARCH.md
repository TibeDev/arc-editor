# Arc Editor — Memory and Performance Optimization Research

Research target: Arc Editor (`/home/tibevdb/Documents/Apps/vdb-ide`)

Input audit: `OPTIMIZATION_AUDIT.md`

Research date: 2026-11-11

Implementation status: **research only**. No application source file was changed.

---

## Evidence rules used in this document

| Label | Meaning |
| --- | --- |
| **Confirmed** | The code path was read directly and the described behavior follows from it. |
| **Hypothesis** | The behavior is plausible and code-adjacent, but runtime profiling or a heap snapshot is still required before claiming an effect. |
| **Already optimized** | The area has an existing bound, cleanup path, lazy load, virtualization, or other mitigation that makes the suggested change unnecessary or low-value. |
| **Not applicable** | The audit suggestion does not fit Arc's architecture or would remove required behavior. |

No memory measurement was invented. Arc was not running while this research was produced, so the reported ~500 MB figure is treated as the audit's observation, not as a measured attribution. No before/after benchmark exists yet.

---

## 1. Executive summary

Arc's reported ~500 MB RAM use cannot be assigned to one subsystem without runtime profiling. The source review does, however, expose several real allocation, retention, and repeated-work paths. The largest confirmed opportunities are not "CodeMirror is slow" or "React is slow" in general; they are specific data flows that repeatedly materialize whole documents or retain resources longer than needed.

Highest-confidence findings:

| Rank | Finding | Why it matters | Evidence class |
| --- | --- | --- | --- |
| 1 | Every CodeMirror edit calls `update.state.doc.toString()` and stores the result in `fileContents`. The same event path emits the full document to plugin listeners. | Creates a full string allocation on every keystroke and gives plugin listeners a fresh full copy. Cost scales with document size. | Confirmed |
| 2 | Selection, focus, and cursor movement call `getPluginEditorContext()` twice. That context contains the full document text. | Scrolling and cursor movement can allocate a full document string even when no plugin needs it. | Confirmed |
| 3 | Three plugin ViewPlugins call `activeLanguageContext()` on every viewport change, document change, and selection change. That helper calls `editor.state.doc.toString()`. | Scrolling a file with plugin language extensions installed can repeatedly copy the whole document. | Confirmed |
| 4 | CodeMirror `EditorView` instances are destroyed when switching tabs. Only selection and scroll are snapshotted; undo history and per-path state are lost. | Tab switching is CPU-heavy and loses editor state, although retained memory stays low. | Confirmed |
| 5 | Built-in plugin `main.js` files use eager `import.meta.glob`. Built-in sources are held in module-level constants and then read again from disk into `plugins` state. | Duplicate source strings, including the 69,792-byte `api-tester` source, are retained even when the plugin is disabled. | Confirmed |
| 6 | Built-in plugin files are rewritten on startup whenever their folder exists, not only on first seed or version change. | Unnecessary startup file I/O and transient string allocation. | Confirmed |
| 7 | `pluginProcessSinks` entries are removed only by explicit `stop()`. Natural process exit does not remove the sink. Pending stdout/stderr arrays are unbounded. | Retained objects and potentially unbounded output accumulation for plugin processes that are not explicitly stopped. | Confirmed |
| 8 | Plugin output channels append without a cap (`buffer += text`) and republish the whole buffer. | A chatty plugin can grow memory and DOM text without a bound. | Confirmed |
| 9 | Workspace open performs a full recursive scan and then the `workspace` effect performs another full scan. | Duplicate directory I/O at startup, workspace restore, and folder switch. | Confirmed |
| 10 | The local live server polls `local_file_signature()` over the tree every 700 ms while a browser has polled it recently. | Full directory walk and metadata hashing while a live-server page is open. | Confirmed |

What is already good:

- Editor settings, theme, and language use CodeMirror `Compartment.reconfigure()` rather than recreating the editor.
- Editor effect dependencies are mostly stable. The audit's concern that `onActivate`, `onChange`, or `pluginEditorExtensions` cause repeated editor recreation is **not supported** by the current code.
- Language packages, Prettier, panels, GitHub, settings, theme maker, and xterm are dynamically loaded.
- The file tree and search results are virtualized.
- Terminal output history is globally bounded at 2 MiB / 8,000 chunks, and closed-session markers are bounded at 128.
- Rust PTY output uses a bounded channel, bounded batching, and idempotent spawn.
- The Rust watcher has directory, entry, failure, and debounce bounds, and ignores tooling directories.
- GitHub workspace caches are bounded to six workspaces.
- Most React effects clean up listeners, observers, timers, and Tauri subscriptions.

Recommended first work, in order:

1. Stop full-document work when no plugin provider or listener can consume it.
2. Coalesce or make incremental the `editor:changed` plugin event.
3. Fix plugin process sink and output-channel retention.
4. Remove duplicate workspace scanning and unnecessary built-in plugin rewrites.
5. Then measure before attempting editor-state caching, React memoization, or file-cache eviction.

---

## 2. Current architecture

### 2.1 Runtime and ownership

| Layer | Responsibility | Main files |
| --- | --- | --- |
| React shell | Window layout, tree, tabs, splits, command palette, settings, plugin UI | `src/App.tsx` (5,023 lines) |
| CodeMirror | Active document editing, syntax, decorations, plugin editor integration | `src/App.tsx` (`EditorPane`), `src/pluginRuntime.ts` |
| Plugin runtime | Discovery, activation, API surface, language providers, processes, sockets, HTTP, panels | `src/pluginRuntime.ts` (4,384 lines) |
| Terminal frontend | Active xterm instance and replay buffer | `src/TerminalView.tsx`, `src/terminalOutput.ts` |
| Tauri/Rust | PTY, filesystem watch, gh/git shell-out, plugin processes, sockets, local HTTP server | `src-tauri/src/lib.rs` (3,135 lines) |

### 2.2 File and document state

- `openFiles` is metadata: `{ path, name, revision, dirty }` (`src/App.tsx:146-151`, `1391`).
- `fileContents` is a `Map<string, string>` holding the full text of each open file (`src/App.tsx:1392`).
- `lastDiskWrite` holds a content fingerprint, not a second full copy (`src/App.tsx:1403`, `566-575`).
- The active CodeMirror document holds its own `Text` tree inside `EditorState` (`src/App.tsx:821-822`).
- Closing the last tab for a file deletes `fileContents` and removes the open-file metadata (`src/App.tsx:2893-2904`). Disk removal does the same (`src/App.tsx:1923-1929`). There is no evidence that closed files remain in these maps.
- There is no total-byte budget, LRU policy, or eviction for open files. Every open file remains in `fileContents` until closed.

### 2.3 Editor lifecycle

- `EditorPane` creates one `EditorView` for its active file (`src/App.tsx:811-878`).
- Creation effect dependencies are `editorViews`, `file?.path`, `group.id`, `onActivate`, `onChange`, and `pluginEditorExtensions`.
- `editorViews` is a stable ref, `group.id` is stable, `onActivate` is React's stable `setActiveGroupId`, `onChange` is `updateFile` with empty `useCallback` dependencies, and `pluginEditorExtensions` is a module-level constant. Therefore the audit's unstable-callback hypothesis is not the current cause of recreation.
- The actual recreation trigger is a change in `file?.path`: switching tabs destroys the old view and creates a new one.
- The cleanup stores only the last path's selection and scroll in one per-pane `snapshot` ref (`src/App.tsx:798-803`, `866-877`). It does not store undo history, and it does not keep one snapshot per path.
- Settings, theme, and language are reconfigured through compartments (`src/App.tsx:804-808`, `880-1045`). They do not recreate the editor.
- `editorViews` is a single-valued map keyed by path (`src/App.tsx:856`, `1412`). The current open path logic generally removes a path from other groups, but the map itself cannot represent two live views of the same path.

### 2.4 Plugin lifecycle

- Built-in manifests and sources are eagerly collected at module load (`src/pluginRuntime.ts:23-24`).
- `builtinPackages` retains manifest objects and raw source strings (`src/pluginRuntime.ts:724-729`).
- Startup joins the app-data plugin directory, creates it, seeds or rewrites built-ins, reads every plugin folder, parses every manifest, and reads every `main.js` into `plugins` state (`src/pluginRuntime.ts:777-815`).
- Enabled plugins are activated by effect (`src/pluginRuntime.ts:821-870`). Disabled plugins are not activated, but their source is still loaded and retained.
- Plugin activation creates a Blob URL and dynamically imports it (`src/pluginRuntime.ts:852-869`).
- Deactivation clears timers, workers, handlers, disposables, cleanup, and the Blob URL, and removes actions, menus, providers, and other registrations.
- Plugin panels are mounted only when their view is active (`src/App.tsx:1240-1242`, `PluginViewHost` at `189-208`).
- Plugin process output is routed through module-level Tauri listeners and per-process sinks (`src/pluginRuntime.ts:3762-3806`).
- Plugin output channels keep an unbounded string buffer (`src/pluginRuntime.ts:1020-1055`).
- Plugin PTY and socket adapters create Tauri listeners per resource and remove them only on explicit `stop()`/`close()` (`src/pluginRuntime.ts:3883-3905`, `3920-3941`).

### 2.5 Terminal lifecycle

- Only the active terminal in an editor pane is rendered (`src/App.tsx:1253-1273`).
- Mounting `TerminalView` creates a new xterm instance, loads FitAddon, opens the DOM host, subscribes to buffered output, and calls `terminal_spawn` (`src/TerminalView.tsx:28-75`).
- Unmounting disposes xterm and unsubscribes (`src/TerminalView.tsx:65-74`).
- `terminal_spawn` is idempotent for an existing session (`src-tauri/src/lib.rs:255-261`), so remounting the view does not recreate the shell. It does recreate the xterm frontend and replay buffered output.
- `terminalOutput.ts` keeps a global 2 MiB / 8,000-chunk history across sessions (`src/terminalOutput.ts:8-40`).
- `subscribeTerminalOutput` replays history one chunk at a time before marking the subscriber active (`src/terminalOutput.ts:68-83`).
- Rust uses one reader thread plus one batching/forwarding thread per PTY, a four-chunk channel, 16 KiB reads, and 32 KiB event batching (`src-tauri/src/lib.rs:320-355`).
- Closed terminal IDs are bounded to 128 (`src-tauri/src/lib.rs:162-165`, `440-458`).

### 2.6 Rust and filesystem background work

- `watch_project` replaces the previous watcher, registers non-recursive watches directory by directory, and caps directories at 3,000, catch-up entries at 5,000, failures at 32, and debounce at 200 ms (`src-tauri/src/lib.rs:2423-2445`, `2606-2693`, `2701-2868`).
- The watcher emits one `fs-changed` Tauri event per mapped event, and one more per catch-up entry (`src-tauri/src/lib.rs:2793-2795`, `2839-2843`).
- The frontend queues watcher events and flushes them on `requestAnimationFrame` (`src/App.tsx:2072-2103`).
- `local_file_signature` walks the tree and hashes names, lengths, and mtimes, with a 20,000-entry cap (`src-tauri/src/lib.rs:2372-2419`). The live-server watcher thread calls it every 700 ms while a browser has polled within 30 seconds (`src-tauri/src/lib.rs:2021-2042`).
- The local HTTP server accepts connections on a nonblocking listener and spawns one thread per accepted connection (`src-tauri/src/lib.rs:1997-2019`). Each request reads the entire file into memory (`src-tauri/src/lib.rs:2204-2218`).
- Plugin process output is emitted per 16 KiB read with no batching (`src-tauri/src/lib.rs:601-623`). The process exit monitor polls `try_wait` every 50 ms (`src-tauri/src/lib.rs:686-723`).

### 2.7 Startup and bundle

Existing production output under `dist/assets` shows the build is already split:

- `index-Bl60P10L.js`: 303,949 bytes
- `editor-core-BScFtqUm.js`: 253,422 bytes
- `editor-language-s91JcuAq.js`: 344,788 bytes
- `editor-tools-BGhUUYsq.js`: 81,756 bytes
- `react-vendor-LulYhd5F.js`: 223,231 bytes
- `TerminalView-BreJ5liC.js`: 336,931 bytes
- `typescript-CpwMS6-X.js`: 464,725 bytes
- `html-Cdlyoy-I.js`: 163,624 bytes
- `yaml-CwaMJBxz.js`: 144,191 bytes
- `markdown-Da4luf4E.js`: 271,581 bytes

This is static evidence only. Chunk size does not prove runtime heap size. It does show that large language parsers, xterm, markdown, and Prettier are not all forced into the initial chunk.

### 2.8 Constraints that limit safe optimization

- Unsaved buffers must never be discarded.
- Plugin API compatibility matters; event contract changes can break existing plugins.
- A hidden terminal must keep its shell and output.
- Undo history, cursor, selection, and scroll are user-visible state.
- Accessibility, keyboard behavior, split layout, and drag/drop must not regress.
- No runtime profiling has been performed, so large architectural changes are not justified yet.

---

## 3. Complete optimization catalogue

### 3.1 Actionable catalogue

#### CM-01 — Full document string on every edit

- **Area:** CodeMirror update path, file-content cache, plugin events.
- **Current implementation:** `EditorPane`'s update listener runs `onChange(file.path, update.state.doc.toString())` on every non-external document change (`src/App.tsx:830-840`). `updateFile` stores that string in `fileContents` and emits `editor:changed` with the full content (`src/App.tsx:2770-2789`).
- **Problem/opportunity:** Each keystroke creates a full string from the CodeMirror text tree. The string is retained as the canonical buffer and, when listeners exist, becomes event payload. Cost is O(document size) per edit.
- **Proposed approach:** Separate the canonical document from the notification. Keep CodeMirror's `Text` as the active canonical representation. Update a dirty revision or change counter cheaply. Materialize a string only for save, formatter, plugin requests, or inactive-cache updates. For plugin events, emit a coalesced notification with path, revision, and change ranges; provide full text only on explicit request or to listeners that require it. Preserve a final full text event where the API contract requires it.
- **Expected benefit:** Removes repeated full-document allocation from typing and reduces event-payload retention. Likely largest CPU/allocation win for large files.
- **Memory impact:** Reduces transient heap churn and garbage-collection pressure. Retained heap falls only where listeners or caches currently retain the emitted string.
- **Performance impact:** Improves typing latency and plugin event dispatch on large documents.
- **Complexity:** Medium. The plugin API needs a compatibility path.
- **Risk/regressions:** Plugins that synchronously inspect full content on every change may need an explicit `getDocumentText()` or a full-text fallback. Save and dirty tracking must remain exact.
- **Relevant files:** `src/App.tsx:830-840`, `2702-2789`; `src/pluginRuntime.ts:767-775`.
- **Evidence:** Confirmed.
- **Validation:** Heap allocation timeline while typing 10k-line and 100k-line files; count `doc.toString()` calls; verify plugin change events still fire and saves remain correct.

#### CM-02 — Selection/context changes allocate full document text twice

- **Area:** CodeMirror selection events, plugin context.
- **Current implementation:** `EditorPane` calls `onSelectionChange` on selection, document, or focus changes (`src/App.tsx:839-840`). The parent handler calls `getPluginEditorContext(path)` twice and emits `editor:selection-changed` plus `editor:context-changed` (`src/App.tsx:4322-4331`). `getPluginEditorContext` calls `getPluginEditorSnapshot`, which includes `text: fileContents.current.get(activePath) ?? ''` (`src/App.tsx:3913-3977`).
- **Problem/opportunity:** Scrolling, selecting, and focus changes can duplicate a full-document reference into context objects and event payloads. The two calls build two separate context objects.
- **Proposed approach:** Build the context once and reuse it for both events. Remove full `text` from the default selection/context payload; expose `getDocumentText()` or a ranged slice. If a compatibility field must remain, populate it lazily or only for listeners that declare a need.
- **Expected benefit:** Stops full-document object creation and duplicate event payloads on cursor movement and selection.
- **Memory impact:** Lower transient allocation; less retained data if plugin listeners store context objects.
- **Performance impact:** Smoother selection and scrolling, especially in large files.
- **Complexity:** Low for the duplicate call; medium for changing the plugin context contract.
- **Risk/regressions:** Plugins that expect `context.text` need a fallback period or a documented accessor.
- **Relevant files:** `src/App.tsx:3913-3977`, `4322-4331`; `src/pluginRuntime.ts:1009-1018`.
- **Evidence:** Confirmed.
- **Validation:** Count context allocations during 100 selections; plugin tests for selection callbacks; heap snapshot after repeated selection.

#### CM-03 — EditorView destroyed on every tab switch

- **Area:** CodeMirror lifecycle.
- **Current implementation:** The creation effect depends on `file?.path` and destroys the previous view on cleanup (`src/App.tsx:811-878`). Only the last selection/scroll is saved in one `snapshot` ref.
- **Problem/opportunity:** Tab switching recreates the DOM-backed editor, reparses the document, loses undo history, and restores only one previously visited path. This is a responsiveness problem, not a leak.
- **Proposed approach:** Investigate caching `EditorState` per path while keeping only the active `EditorView` mounted. Recreate a view from cached state when returning to a tab. Preserve history, selection, and scroll per path. Start with a bounded state cache and measure memory before making it unbounded.
- **Expected benefit:** Faster tab switching, retained undo history, correct per-file selection/scroll.
- **Memory impact:** Increases retained memory by cached `EditorState` and history per path. Must be bounded and measured.
- **Performance impact:** Removes repeated EditorView creation and document reparse on tab switches; may reduce typing interruption.
- **Complexity:** Medium-high.
- **Risk/regressions:** Cached states can retain large documents and histories. Eviction policy must never lose unsaved edits. Compartments must be reapplied when restoring a state.
- **Relevant files:** `src/App.tsx:798-878`, `1412`.
- **Evidence:** Confirmed lifecycle; memory tradeoff is a hypothesis.
- **Validation:** Tab-switch benchmark on 10/30 tabs; heap snapshot before and after; verify undo, selection, and scroll across repeated switches.

#### CM-04 — Single-valued `editorViews` map cannot track duplicate paths

- **Area:** Editor instance management, split panes.
- **Current implementation:** `editorViews.current.set(file.path, editor)` and cleanup delete by path (`src/App.tsx:856`, `874-875`). The map is declared as `Map<string, EditorView>` (`src/App.tsx:1412`).
- **Problem/opportunity:** The architecture assumes one live view per path. If two groups ever hold the same path, one view overwrites the other entry, and destroying the tracked view can leave the other untracked. Plugin `getEditor()` then resolves the wrong or no view.
- **Proposed approach:** Decide and enforce the invariant. Either prohibit the same path in two groups, or store `Map<string, Set<EditorView>>` and resolve plugin lookups by active group. Do not change the map shape without fixing all callers.
- **Expected benefit:** Correct plugin editor lookup and no untracked views in split scenarios.
- **Memory impact:** Small. Prevents accidental retained/untracked views.
- **Performance impact:** Neutral.
- **Complexity:** Low-medium.
- **Risk/regressions:** Split drag/drop and plugin APIs that assume one editor per path.
- **Relevant files:** `src/App.tsx:856`, `874-875`, `1412`, `3910-3918`.
- **Evidence:** Confirmed map shape; duplicate-path reachability is a hypothesis.
- **Validation:** Open the same file in two groups through every UI path; assert `editorViews` entries and plugin `getEditor()` results.

#### CM-05 — Indentation guides rebuild decorations on every document/viewport change

- **Area:** CodeMirror ViewPlugin.
- **Current implementation:** `buildIndentGuides` creates a mark and ranges for every visible line with indentation (`src/App.tsx:343-358`). `indentationGuides` rebuilds on any document or viewport change (`src/App.tsx:360-380`). The extension is enabled per settings and disabled for CSS/SCSS (`src/App.tsx:945-947`).
- **Problem/opportunity:** Typing and scrolling rebuild the full viewport's decorations and rerun a regular expression for every visible line. The mark object is recreated per rebuild.
- **Proposed approach:** First measure. If meaningful, reuse a module-level mark, build ranges with `RangeSetBuilder`, and update only changed line ranges where possible. Keep exact appearance and behavior.
- **Expected benefit:** Lower per-keystroke allocation and decoration churn while scrolling.
- **Memory impact:** Small reduction in transient decorations.
- **Performance impact:** Likely small unless profiling shows otherwise.
- **Complexity:** Low-medium.
- **Risk/regressions:** Decoration ordering, tabs vs spaces, and viewport edge cases.
- **Relevant files:** `src/App.tsx:343-380`, `945-947`.
- **Evidence:** Confirmed behavior; benefit magnitude is a hypothesis.
- **Validation:** Performance profile while typing and scrolling a deep indentation file; visual regression check.

#### CM-06 — Plugin view providers copy the full document before checking for providers

- **Area:** Plugin language providers, CodeMirror ViewPlugins.
- **Current implementation:** `pluginViewPlugin` runs `refresh` on doc, viewport, or selection changes (`src/pluginRuntime.ts:3042-3069`). `refresh` calls `activeLanguageContext()` first; that calls `hostActions.getEditorContext()` and then `editor.state.doc.toString()` (`src/pluginRuntime.ts:1009-1018`). It checks `providers.length` only after the context is built. Three view plugins are installed: code lens, inlay hints, and semantic tokens (`src/pluginRuntime.ts:3182-3185`).
- **Problem/opportunity:** Even with zero providers, scrolling or selecting copies the entire document three times. With providers, each provider receives a full text copy on every viewport change.
- **Proposed approach:** Resolve matching providers before building full context. Cache the last context/text per editor revision/selection and reuse it. Pass a document reference or a range accessor instead of a full string. At minimum, avoid work entirely when no provider of that kind is registered.
- **Expected benefit:** Removes a major hidden cost from ordinary scrolling, especially in large files.
- **Memory impact:** Significant reduction in transient full-document strings; retained reduction if providers currently store text.
- **Performance impact:** Likely one of the largest CPU wins in the plugin layer.
- **Complexity:** Low for provider guard; medium for context API change.
- **Risk/regressions:** Provider results must stay correct when the document changes; stale cache invalidation must be exact.
- **Relevant files:** `src/pluginRuntime.ts:1009-1018`, `2687-2691`, `3042-3069`, `3182-3185`.
- **Evidence:** Confirmed.
- **Validation:** Scroll a large file with zero plugin providers; count `doc.toString()` calls; then repeat with one provider and verify results.

#### CM-07 — No large-file mode or feature budget

- **Area:** CodeMirror features, large documents.
- **Current implementation:** File open warns above 5 MiB (`src/App.tsx:2694-2700`) but still reads the whole file. All editor features are configured through settings without size thresholds (`src/App.tsx:918-987`). Syntax highlighting, `highlightSelectionMatches`, plugin ViewPlugins, autocomplete, bracket matching, and indentation guides can all be active.
- **Problem/opportunity:** Large files and minified/long-line files can trigger expensive parser, decoration, and plugin work without a fallback.
- **Proposed approach:** Define measured thresholds for line count/byte size/longest line. Above them, offer a reduced mode: disable expensive decorations and plugin view providers, keep basic editing and syntax highlighting if viable, and show a clear status. Do not silently remove features.
- **Expected benefit:** Prevents pathological CPU/memory spikes on large files.
- **Memory impact:** Reduces parser/decorations/history pressure for large documents.
- **Performance impact:** Improves open, scroll, and typing responsiveness in large-file cases.
- **Complexity:** Medium.
- **Risk/regressions:** Users may lose expected syntax or plugin features; needs visible UX.
- **Relevant files:** `src/App.tsx:2691-2700`, `701-727`, `918-987`; `src/pluginRuntime.ts:3042-3069`.
- **Evidence:** Confirmed no thresholds; thresholds must be chosen by measurement.
- **Validation:** Open 10k/50k/100k-line, minified JS, large JSON/HTML, and long-line files; record open/scroll/type latency and heap.

#### FD-01 — Active document has two full representations

- **Area:** File content management.
- **Current implementation:** `fileContents` holds a string for every open file (`src/App.tsx:1392`). The active CodeMirror state holds its own `Text` tree (`src/App.tsx:821-822`). The `file` prop adds a string reference from the map, not a copy (`src/App.tsx:4290-4297`).
- **Problem/opportunity:** For the active file, one full string plus one CodeMirror text tree can coexist. Inactive files have only the string. This is bounded by open-file size and may be acceptable, but it is a real duplicate representation.
- **Proposed approach:** Measure. If the active duplicate matters, treat `EditorState.doc` as canonical while the view is alive, and use `fileContents` only for inactive or dirty buffers. Add a single document-accessor layer so plugin APIs and save paths do not each choose a different source.
- **Expected benefit:** Removes one full document copy for the active file; behavior-preserving only with careful source-of-truth rules.
- **Memory impact:** Up to one active document string or tree, minus necessary dirty cache. Magnitude unknown without heap data.
- **Performance impact:** Neutral to positive; avoids duplicate conversion if accessors cache.
- **Complexity:** Medium-high.
- **Risk/regressions:** Dirty tracking, external reload, formatter, save, and plugin APIs can diverge.
- **Relevant files:** `src/App.tsx:1392`, `2701-2706`, `3913-3977`, `4290-4297`.
- **Evidence:** Confirmed duplicate representation; value is a hypothesis.
- **Validation:** Heap snapshot with one 10 MB file; compare string and CodeMirror tree retention; verify save/reload/format.
- **Decision:** Do not implement before profiling. The active duplicate alone is unlikely to explain ~500 MB.

#### FD-02 — No total open-document memory budget or eviction

- **Area:** File content cache.
- **Current implementation:** Every open file stays in `fileContents` until closed (`src/App.tsx:1392`, `2893-2904`). Dirty files must be preserved.
- **Problem/opportunity:** Opening many large files can grow retained heap without a budget. There is no LRU or clean-buffer eviction.
- **Proposed approach:** First measure. If needed, add a total-byte budget with clean inactive eviction only. Re-read clean files from disk on reactivation. Never evict dirty buffers. Preserve cursor and scroll separately.
- **Expected benefit:** Bounds memory for many large files.
- **Memory impact:** Potentially large for large workspaces; zero until measured.
- **Performance impact:** Eviction adds reopen latency and disk I/O.
- **Complexity:** Medium.
- **Risk/regressions:** Data loss if dirty logic is wrong; tab-switch latency if eviction is too aggressive.
- **Relevant files:** `src/App.tsx:1392`, `2656-2712`, `2862-2908`.
- **Evidence:** Confirmed no budget; necessity is a hypothesis.
- **Validation:** Open 30 files of known sizes; heap snapshot; repeat with large files; verify dirty buffers survive.

#### FD-03 — Save path formats on the main thread and creates full temporary copies

- **Area:** Save, Prettier, plugins.
- **Current implementation:** Save reads `fileContents`, runs plugin `willSave`, optionally runs Prettier, writes the result, and emits `file:saved` with full content (`src/App.tsx:2714-2767`). Prettier is dynamically imported but parsing/formatting runs on the main thread (`src/App.tsx:577-625`).
- **Problem/opportunity:** Saving a large file creates temporary full strings and blocks the UI during formatting.
- **Proposed approach:** Measure save latency. If significant, move formatting to a Web Worker or Rust worker boundary while preserving plugin formatters and error behavior. Avoid duplicate serialization for `file:saved` if no listener needs content.
- **Expected benefit:** Less main-thread blocking on large saves; lower transient memory.
- **Memory impact:** Lower peak during formatting; worker adds its own baseline.
- **Performance impact:** Faster perceived save for large files.
- **Complexity:** Medium-high.
- **Risk/regressions:** Worker lifecycle, plugin formatters that are not transferable, error propagation.
- **Relevant files:** `src/App.tsx:577-625`, `2714-2767`.
- **Evidence:** Confirmed main-thread formatting; benefit is a hypothesis.
- **Validation:** Save a large TS/CSS file; measure main-thread blocking and heap peak.

#### PL-01 — Eager built-in plugin source loading

- **Area:** Plugin discovery/startup.
- **Current implementation:** `import.meta.glob(..., { eager: true })` loads all built-in manifests and `main.js` sources into the initial module graph (`src/pluginRuntime.ts:23-24`). `builtinPackages` retains them (`724-729`).
- **Problem/opportunity:** All built-in source strings are parsed/evaluated with the initial chunk, including disabled plugins. The largest built-in source is `plugins/api-tester/main.js` at 69,792 bytes.
- **Proposed approach:** Keep manifests available for discovery, but load built-in source only when seeding is required or when an enabled plugin is activated. Use a lazy glob or explicit dynamic imports keyed by plugin id. Preserve one-time seeding and plugin installation behavior.
- **Expected benefit:** Smaller startup parse/eval and lower initial retained source memory.
- **Memory impact:** Removes raw source retention for unused built-ins; may shift allocation to activation rather than remove it.
- **Performance impact:** Faster startup, especially with more/larger built-ins.
- **Complexity:** Low-medium.
- **Risk/regressions:** Built-in seeding, update detection, and `availableBuiltins` must still work.
- **Relevant files:** `src/pluginRuntime.ts:23-24`, `724-729`, `777-815`, `2455-2463`.
- **Evidence:** Confirmed.
- **Validation:** Startup heap/CPU comparison; first-run seeding; disable/enable/remove/reinstall built-ins.

#### PL-02 — Built-in source duplicated in module constants and `plugins` state

- **Area:** Plugin source retention.
- **Current implementation:** `builtinPackages` references raw source strings from `builtinPluginSources`. Startup also reads each `main.js` from disk and stores the result in `plugins` (`src/pluginRuntime.ts:724-729`, `791-809`).
- **Problem/opportunity:** For each built-in, two source string copies can coexist: module-level raw glob data and loaded plugin state. Disabled built-ins still hold the loaded copy.
- **Proposed approach:** Keep only one authoritative source. If seeding is complete, release or avoid retaining the module raw string. Load source on activation or re-read from disk when needed.
- **Expected benefit:** Removes duplicate source strings and lowers retained memory for disabled built-ins.
- **Memory impact:** Proportional to total built-in/installed source size; likely small but confirmed.
- **Performance impact:** Avoids unnecessary disk reads at startup if seeding is complete.
- **Complexity:** Low-medium.
- **Risk/regressions:** Reinstall/update paths need source availability.
- **Relevant files:** `src/pluginRuntime.ts:724-729`, `777-809`.
- **Evidence:** Confirmed.
- **Validation:** Heap snapshot before/after startup with only built-ins; inspect `plugins` entries; test remove/reinstall.

#### PL-03 — Built-in files rewritten on every startup when the folder exists

- **Area:** Plugin startup I/O.
- **Current implementation:** For each built-in, the seed condition is `seedBuiltins || await exists(folder)` (`src/pluginRuntime.ts:785-788`). After the first seed, the folder exists, so `writePluginFiles` is called on every startup.
- **Problem/opportunity:** Re-writes all built-in manifests and `main.js` files every launch, creating disk I/O and transient strings even when nothing changed.
- **Proposed approach:** Write only when the folder is missing or the installed version/checksum differs from the bundled manifest. Keep an explicit update path for built-in changes.
- **Expected benefit:** Less startup I/O and transient allocation.
- **Memory impact:** Small transient reduction.
- **Performance impact:** Faster startup, especially on slow disks.
- **Complexity:** Low.
- **Risk/regressions:** Built-in updates must not be silently skipped.
- **Relevant files:** `src/pluginRuntime.ts:784-789`.
- **Evidence:** Confirmed.
- **Validation:** Cold start with existing plugin folder; trace writes; change built-in version and verify update.

#### PL-04 — Disabled plugins still load and retain source

- **Area:** Plugin lifecycle.
- **Current implementation:** Startup reads every plugin's `main.js` regardless of enabled state (`src/pluginRuntime.ts:791-809`). `InstalledPlugin` includes `source` (`37`), and disabled plugins remain in `plugins` state.
- **Problem/opportunity:** Disabled plugins consume retained string memory even though they are not activated.
- **Proposed approach:** Store metadata for disabled plugins and read source only on enable/activation. If the plugin manager needs a preview, read on demand.
- **Expected benefit:** Lower retained memory for disabled plugins, especially large third-party plugins.
- **Memory impact:** Source-size reduction per disabled plugin.
- **Performance impact:** Faster startup with many disabled plugins.
- **Complexity:** Low-medium.
- **Risk/regressions:** Enable/disable and update flows must read source reliably.
- **Relevant files:** `src/pluginRuntime.ts:37`, `777-809`, `2465`.
- **Evidence:** Confirmed.
- **Validation:** Install a large disabled plugin; heap snapshot; enable it and verify activation.

#### PL-05 — Plugin process sinks leak after natural exit; pending output is unbounded

- **Area:** Plugin process management.
- **Current implementation:** `ensurePluginProcessBus` creates a sink for any process event (`src/pluginRuntime.ts:3786-3803`). A sink is deleted in `stop()` (`3857-3864`) but not when a `plugin-process-exit` event arrives. `pendingStdout`, `pendingStderr`, `pendingExit`, and `pendingError` are plain arrays with no cap (`3752-3760`).
- **Problem/opportunity:** A plugin process that exits naturally leaves its sink, listener sets, and pending output in the module-level map. If no handler attaches, output accumulates without bound.
- **Proposed approach:** On exit, deliver pending data, clear pending arrays, and remove the sink after a short grace period or when all listeners detach. Cap pending output by bytes and chunks. Avoid creating a sink for unknown IDs unless a spawn is awaiting it.
- **Expected benefit:** Prevents retained process state and unbounded output growth.
- **Memory impact:** Can be unbounded today; fixed bound after change.
- **Performance impact:** Small CPU reduction from fewer retained arrays.
- **Complexity:** Low-medium.
- **Risk/regressions:** Late listeners may miss output; define a bounded replay contract.
- **Relevant files:** `src/pluginRuntime.ts:3752-3806`, `3824-3866`.
- **Evidence:** Confirmed.
- **Validation:** Spawn a plugin process that exits without `stop()`; repeat 100 times; heap snapshot; verify listener cleanup and replay semantics.

#### PL-06 — Plugin output channels have no buffer limit

- **Area:** Plugin output panels.
- **Current implementation:** `makeOutputChannel` appends `buffer += text` and republishes the whole buffer to the panel (`src/pluginRuntime.ts:1020-1055`).
- **Problem/opportunity:** A chatty plugin can grow a string and DOM text indefinitely. Republishing also repeatedly replaces panel content.
- **Proposed approach:** Apply a bounded ring buffer or line cap, truncate from the front, and batch panel updates on a frame/timer. Keep the latest output and a clear truncation indicator.
- **Expected benefit:** Bounds memory and DOM cost for noisy plugin output.
- **Memory impact:** Unbounded today; capped after change.
- **Performance impact:** Fewer full-buffer DOM replacements.
- **Complexity:** Low.
- **Risk/regressions:** Users may lose older output; indicate truncation.
- **Relevant files:** `src/pluginRuntime.ts:1020-1055`.
- **Evidence:** Confirmed.
- **Validation:** Write 100 MB of plugin output; observe heap and panel responsiveness.

#### PL-07 — Plugin PTY/socket listeners are cleaned only by explicit stop/close

- **Area:** Plugin resource lifecycle.
- **Current implementation:** `spawnPluginPty` registers `terminal-output` and `terminal-exit` listeners and removes them only in `stop()` (`src/pluginRuntime.ts:3883-3905`). `connectPluginSocket` registers data/error/close listeners and removes them only in `close()` (`3920-3941`). A natural remote close or terminal exit does not automatically unlisten.
- **Problem/opportunity:** Plugin code that forgets to call `stop()`/`close()` leaves Tauri listeners and closures retained. Repeated spawn/exit cycles can accumulate listeners.
- **Proposed approach:** On `terminal-exit` or `plugin-socket-close`, invoke cleanup after delivering the final event. Make the handle idempotently unlisten. Also remove listeners if the plugin is deactivated.
- **Expected benefit:** Prevents listener leaks in long-running sessions.
- **Memory impact:** Retained listener and closure memory proportional to unclosed resources.
- **Performance impact:** Fewer event dispatch targets.
- **Complexity:** Low.
- **Risk/regressions:** Plugins may expect to read output after exit; deliver final data before cleanup.
- **Relevant files:** `src/pluginRuntime.ts:3883-3905`, `3920-3941`; `src-tauri/src/lib.rs:953-960`.
- **Evidence:** Confirmed cleanup gap by code path.
- **Validation:** Spawn/exit PTY 100 times without `stop()`; connect/remote-close socket 100 times; count Tauri listeners and heap.

#### PL-08 — Provider lookup filters a flat array on every call

- **Area:** Plugin language providers.
- **Current implementation:** `pluginLanguageProviders` is a flat array; `pluginProviders` filters by kind and selector on every request (`src/pluginRuntime.ts:2687-2691`).
- **Problem/opportunity:** For every viewport/selection refresh, completion, hover, and command, the runtime scans all providers. The cost grows with plugin count.
- **Proposed approach:** Index providers by kind and selector/language at registration, with invalidation on deactivate. Keep the flat array only as a fallback or remove it.
- **Expected benefit:** Lower per-event CPU with many plugins.
- **Memory impact:** Small index overhead.
- **Performance impact:** Small to moderate, depending on plugin count and event frequency.
- **Complexity:** Low-medium.
- **Risk/regressions:** Selector matching semantics must remain identical.
- **Relevant files:** `src/pluginRuntime.ts:2591`, `2687-2691`, `3042-3069`.
- **Evidence:** Confirmed.
- **Validation:** Benchmark provider lookup with 0/10/100 providers; verify selector precedence.

#### PL-09 — All enabled plugins activate at startup

- **Area:** Plugin activation.
- **Current implementation:** The activation effect activates every enabled plugin after discovery (`src/pluginRuntime.ts:821-870`).
- **Problem/opportunity:** Plugins that contribute only occasional commands or panels still run activation code, timers, workers, and listeners at startup.
- **Proposed approach:** Investigate splitting manifest/UI registration from activation, or lazy activation on first command/panel use. This is an API/behavior change and should only follow measurement.
- **Expected benefit:** Faster startup and lower idle resource use with many plugins.
- **Memory impact:** Depends on plugin activation cost.
- **Performance impact:** Startup and idle CPU.
- **Complexity:** High; plugin API semantics may change.
- **Risk/regressions:** Plugins that register global listeners or expect activation order.
- **Relevant files:** `src/pluginRuntime.ts:821-870`.
- **Evidence:** Confirmed all enabled plugins activate; benefit is a hypothesis.
- **Validation:** Startup CPU/heap with 0/5/20 plugins; verify plugin commands and panels still work.

#### PL-10 — Plugin output bus is always started at module import

- **Area:** Plugin process listeners.
- **Current implementation:** `void ensurePluginProcessBus()` runs at module load (`src/pluginRuntime.ts:3806`), registering three global Tauri listeners.
- **Problem/opportunity:** Three listeners exist even when no plugin uses processes. The cost is small but avoidable.
- **Proposed approach:** Start the bus on first process spawn; remove listeners when no sinks remain. This is low priority.
- **Expected benefit:** Small baseline listener reduction.
- **Memory impact:** Small.
- **Performance impact:** Small.
- **Complexity:** Low.
- **Risk/regressions:** Race between spawn and first output; ensure bus is ready before spawn returns.
- **Relevant files:** `src/pluginRuntime.ts:3782-3806`.
- **Evidence:** Confirmed.
- **Validation:** Startup listener count with no plugin processes.

#### RE-01 — `App` rerenders all editor panes on unrelated state changes

- **Area:** React rendering.
- **Current implementation:** `App` owns most state and renders `EditorPane` directly through `renderLayout` (`src/App.tsx:4272-4339`). `EditorPane` is not wrapped in `React.memo`.
- **Problem/opportunity:** Any state update that rerenders `App` also reconciles all panes, tabs, tree rows, and inline props. This is CPU work, not necessarily retained memory.
- **Proposed approach:** Profile first. If significant, memoize `EditorPane` and `SplitContainer`, stabilize callbacks (`closeTab`, `openDroppedFile`, `onSelectionChange`), and avoid inline object creation for the `file` prop. Alternatively isolate high-frequency state from the shell. Do not split the monolith solely for style.
- **Expected benefit:** Lower render cost during unrelated UI updates.
- **Memory impact:** Minimal.
- **Performance impact:** Potentially moderate during settings/message/terminal title changes.
- **Complexity:** Medium.
- **Risk/regressions:** Stale props if memo comparison is wrong; split behavior.
- **Relevant files:** `src/App.tsx:4272-4339`, `2862-2908`, `4159-4237`.
- **Evidence:** Confirmed no memoization; benefit is a hypothesis.
- **Validation:** React Profiler for typing, tab switching, terminal title updates, and settings changes.

#### RE-02 — Command list is rebuilt and filtered on every render

- **Area:** React derived state.
- **Current implementation:** `appCommands` is a new array each render (`src/App.tsx:4159-4237`). `commandItems` maps and filters it together with plugin commands and panels on every render (`4238-4260`).
- **Problem/opportunity:** Work is small when the palette is closed, but it repeats for every App render and creates new command objects.
- **Proposed approach:** Memoize app command definitions with stable callbacks where practical, and compute `commandItems` only when the palette is open or its inputs change. Keep last-known command list for keyboard handling.
- **Expected benefit:** Less render-time allocation and filtering.
- **Memory impact:** Small transient reduction.
- **Performance impact:** Small unless the palette is open with many plugins.
- **Complexity:** Low.
- **Risk/regressions:** Command closures must see current state; use refs or include correct dependencies.
- **Relevant files:** `src/App.tsx:4159-4260`.
- **Evidence:** Confirmed.
- **Validation:** Render counts and profile while opening the palette with 100 plugin commands.

#### RE-03 — Theme CSS depends on the whole settings object

- **Area:** React derived state.
- **Current implementation:** `dynamicThemeCss` is memoized on `[activeTheme, settings]` (`src/App.tsx:1484-1487`). It regenerates a large CSS string for any settings change, including unrelated settings.
- **Problem/opportunity:** Most setting changes do not affect generated CSS, but the whole string is recomputed and injected.
- **Proposed approach:** Select only the settings fields used by `themeCss`, or memoize per field group. Low priority unless profiling shows cost.
- **Expected benefit:** Small reduction in render work during settings edits.
- **Memory impact:** Small transient reduction.
- **Performance impact:** Small.
- **Complexity:** Low.
- **Risk/regressions:** Missing a field would produce stale CSS.
- **Relevant files:** `src/App.tsx:1484-1487`; `src/settings.ts:254-362`.
- **Evidence:** Confirmed dependency; benefit is a hypothesis.
- **Validation:** Profile settings slider changes; visual regression across all theme controls.

#### TE-01 — Inactive terminals are destroyed and replayed from scratch

- **Area:** Terminal frontend lifecycle.
- **Current implementation:** Only the active terminal is rendered (`src/App.tsx:1253-1273`). Switching away unmounts `TerminalView`, disposes xterm, and unsubscribes. Switching back creates a new xterm and replays up to 2 MiB of history (`src/TerminalView.tsx:28-75`; `src/terminalOutput.ts:68-83`).
- **Problem/opportunity:** Tab switching costs DOM creation, parser work, and chunk-by-chunk replay. The shell itself stays alive. Retained memory is intentionally low.
- **Proposed approach:** Measure tab-switch latency. If it is poor, batch replay into one or a few writes. Only consider keeping terminal instances mounted (hidden) if profiling proves the tradeoff is worth the extra memory.
- **Expected benefit:** Faster terminal tab switching without increasing idle memory.
- **Memory impact:** Current lifecycle is already the low-memory choice; batching does not materially change retained memory.
- **Performance impact:** Reduces replay overhead.
- **Complexity:** Low for batching; medium-high for keeping hidden instances.
- **Risk/regressions:** Replay must preserve output order and terminal state; hidden terminals increase memory.
- **Relevant files:** `src/App.tsx:1253-1273`; `src/TerminalView.tsx:28-75`; `src/terminalOutput.ts:68-83`.
- **Evidence:** Confirmed lifecycle and replay behavior.
- **Validation:** Switch between 10 terminals with large output; measure time and heap; compare batched replay.

#### TE-02 — Terminal history replay invokes one callback per chunk

- **Area:** Terminal output buffering.
- **Current implementation:** `subscribeTerminalOutput` iterates every historical chunk and calls the callback separately (`src/terminalOutput.ts:73-77`).
- **Problem/opportunity:** Up to 8,000 callbacks and xterm writes can occur on mount, causing jank.
- **Proposed approach:** Join contiguous chunks for the same session into a bounded string or batch in larger pieces, then call the callback once or a few times. Keep the live path unchanged.
- **Expected benefit:** Smoother terminal remounts.
- **Memory impact:** Transient concatenation may briefly duplicate history; avoid large intermediate copies by chunked joins.
- **Performance impact:** Fewer callback and xterm write calls.
- **Complexity:** Low.
- **Risk/regressions:** Ordering and truncation at the 2 MiB cap.
- **Relevant files:** `src/terminalOutput.ts:68-83`.
- **Evidence:** Confirmed.
- **Validation:** Mount a terminal with 2 MiB history; measure mount time and frame drops.

#### TE-03 — Global terminal history can evict unrelated sessions

- **Area:** Terminal output cache.
- **Current implementation:** One global 2 MiB / 8,000-chunk budget spans all sessions (`src/terminalOutput.ts:8-40`).
- **Problem/opportunity:** A noisy terminal can evict another terminal's scrollback. Memory is bounded, but per-session fairness is poor.
- **Proposed approach:** Consider per-session caps within the global cap, or a weighted share. This is a correctness/UX tradeoff, not a leak fix.
- **Expected benefit:** Better history retention fairness.
- **Memory impact:** Same total, different distribution.
- **Performance impact:** Neutral.
- **Complexity:** Low-medium.
- **Risk/regressions:** Lower per-session history for quiet terminals.
- **Relevant files:** `src/terminalOutput.ts:8-40`.
- **Evidence:** Confirmed global cap.
- **Validation:** Run one noisy and one quiet terminal; compare retained history after trim.

#### RS-01 — Live-server file signature walks the tree every 700 ms

- **Area:** Rust local HTTP server.
- **Current implementation:** The watcher thread sleeps 700 ms, skips if no browser poll in 30 seconds, then hashes the tree with up to 20,000 entries (`src-tauri/src/lib.rs:2021-2042`, `2372-2419`).
- **Problem/opportunity:** While a live-server page is open, Arc repeatedly traverses and stats the tree. CPU and disk cost scale with project size.
- **Proposed approach:** Use OS file notifications for the live server, or cache directory mtimes and only walk changed subtrees. Alternatively increase the interval or pause polling when the page is hidden, if the client can signal it.
- **Expected benefit:** Lower background CPU and I/O during live-server use.
- **Memory impact:** Small.
- **Performance impact:** Moderate for large projects.
- **Complexity:** Medium.
- **Risk/regressions:** Missed reloads; path traversal safety must remain.
- **Relevant files:** `src-tauri/src/lib.rs:2021-2042`, `2372-2419`.
- **Evidence:** Confirmed.
- **Validation:** Measure CPU on a large project with live server polling; verify reload on file change.

#### RS-02 — Local HTTP server spawns an unbounded thread per connection

- **Area:** Rust local HTTP server.
- **Current implementation:** Each accepted connection spawns a thread (`src-tauri/src/lib.rs:1997-2012`). Request threads are detached.
- **Problem/opportunity:** Many concurrent local connections can create many threads and stacks. This is a robustness/resource issue more than a normal-use memory issue.
- **Proposed approach:** Add a small worker pool or a concurrency cap, or handle requests on a bounded pool. Keep local-only binding and traversal checks.
- **Expected benefit:** Bounded resource use under load.
- **Memory impact:** Bounds thread-stack memory.
- **Performance impact:** May add queueing under load.
- **Complexity:** Medium.
- **Risk/regressions:** Request latency and shutdown behavior.
- **Relevant files:** `src-tauri/src/lib.rs:1997-2019`.
- **Evidence:** Confirmed unbounded acceptance path.
- **Validation:** Burst-connect 1,000 clients; measure thread count and RSS; verify server still serves.

#### RS-03 — Local HTTP server reads every file fully into memory

- **Area:** Rust local HTTP server.
- **Current implementation:** `fs::read(&path)` loads the whole file, then optionally injects live reload into HTML (`src-tauri/src/lib.rs:2204-2218`).
- **Problem/opportunity:** Large assets are duplicated in memory per request. This is transient but can spike RSS.
- **Proposed approach:** Stream non-HTML files with `io::copy` and known content length. Keep HTML injection in memory only for HTML, or stream with a bounded injection strategy.
- **Expected benefit:** Lower peak memory for large media/assets.
- **Memory impact:** Removes per-request full-file allocation for non-HTML.
- **Performance impact:** Similar or better; fewer copies.
- **Complexity:** Medium.
- **Risk/regressions:** Content-Length, HEAD, traversal, and injection correctness.
- **Relevant files:** `src-tauri/src/lib.rs:2204-2235`.
- **Evidence:** Confirmed.
- **Validation:** Serve a 500 MB file; measure RSS; verify HEAD and range-less GET behavior.

#### RS-04 — Watcher emits one Tauri event per event and per catch-up entry

- **Area:** Filesystem watcher IPC.
- **Current implementation:** Mapped events are emitted individually (`src-tauri/src/lib.rs:2793-2795`); catch-up entries are emitted individually, up to 5,000 (`2839-2843`). The frontend batches with rAF (`src/App.tsx:2075-2094`).
- **Problem/opportunity:** A large created subtree can cause thousands of IPC messages and frontend queue entries. Frontend batching helps, but transport and serialization still cost.
- **Proposed approach:** Batch mapped events per debounce window into one `fs-changed` payload with an array, or cap catch-up batches. Keep frontend delta reducer semantics.
- **Expected benefit:** Fewer IPC messages and lower main-thread overhead.
- **Memory impact:** Lower transient queue/payload overhead.
- **Performance impact:** Faster large-directory operations.
- **Complexity:** Medium.
- **Risk/regressions:** Event ordering and delta reducer assumptions.
- **Relevant files:** `src-tauri/src/lib.rs:2793-2843`; `src/App.tsx:2075-2094`.
- **Evidence:** Confirmed event-per-entry behavior.
- **Validation:** Copy a 5,000-file tree; count IPC events, measure UI responsiveness.

#### RS-05 — Plugin process exit polling and unbounded output emission

- **Area:** Rust plugin process management.
- **Current implementation:** The exit monitor polls `try_wait` every 50 ms (`src-tauri/src/lib.rs:686-723`). Output is emitted per read, with no batching (`601-623`).
- **Problem/opportunity:** Each process causes 20 wakeups per second while running, and chatty processes create many IPC events.
- **Proposed approach:** Use a blocking wait on a dedicated monitor where possible, or increase the poll interval with a bounded stop path. Batch output per small window or size threshold, similar to PTY batching.
- **Expected benefit:** Lower idle CPU per plugin process and fewer IPC events.
- **Memory impact:** Batching adds small bounded buffers.
- **Performance impact:** Lower wakeup and serialization overhead.
- **Complexity:** Medium.
- **Risk/regressions:** Stop latency and final output ordering.
- **Relevant files:** `src-tauri/src/lib.rs:601-623`, `686-723`.
- **Evidence:** Confirmed.
- **Validation:** Spawn a long-idle process; measure wakeups/CPU. Run a chatty process; count events.

#### FS-01 — Workspace open scans the tree twice

- **Area:** Startup/workspace I/O.
- **Current implementation:** `openWorkspace` awaits `refreshWorkspace(selected)` and then sets `workspace` (`src/App.tsx:2604-2621`). The `workspace` effect calls `refreshWorkspace` again (`src/App.tsx:2355-2357`). The restore path also refreshes before setting workspace (`2583-2602`).
- **Problem/opportunity:** Every open/restore performs a full recursive directory scan twice.
- **Proposed approach:** Make one scan authoritative. Have `watch_project` return the initial tree, or skip the effect scan when the path was just scanned. Track a scan generation to avoid stale results.
- **Expected benefit:** Roughly halves initial workspace traversal I/O and readDir IPC.
- **Memory impact:** Lower transient allocation from duplicate arrays.
- **Performance impact:** Faster workspace opening, especially on large trees.
- **Complexity:** Low.
- **Risk/regressions:** Stale tree if watcher setup fails; fallback refresh must remain.
- **Relevant files:** `src/App.tsx:2237-2321`, `2355-2357`, `2583-2621`.
- **Evidence:** Confirmed.
- **Validation:** Trace `readDir` calls while opening a workspace; compare time and counts before/after.

#### FS-02 — Hidden-path permission IPC during every scan

- **Area:** Workspace scan.
- **Current implementation:** For every hidden entry not already allowed, `refreshWorkspace` awaits `workspace_allow_hidden_path` and records it in `allowedHiddenPaths` (`src/App.tsx:2283-2293`).
- **Problem/opportunity:** First scan of a hidden-heavy tree performs one IPC round trip per hidden entry, serialized inside the scan.
- **Proposed approach:** Request permission once for the workspace or batch hidden paths in one command. Cache per workspace and clear on switch.
- **Expected benefit:** Faster scans and fewer IPC calls.
- **Memory impact:** Small.
- **Performance impact:** Moderate for hidden-heavy projects.
- **Complexity:** Low-medium.
- **Risk/regressions:** Security scope must remain per-path and user-approved.
- **Relevant files:** `src/App.tsx:2283-2293`; `src-tauri/src/lib.rs` workspace access commands.
- **Evidence:** Confirmed.
- **Validation:** Open a tree with 1,000 hidden entries; count IPC calls and time.

#### FS-03 — Search filters all entries without debounce

- **Area:** File tree search.
- **Current implementation:** `filteredFiles` lowercases and filters the full file list on every query/state change (`src/App.tsx:3631-3640`); results are virtualized (`3700-3746`, `4683-4689`).
- **Problem/opportunity:** Typing in search can repeatedly scan up to 5,000 entries on the main thread.
- **Proposed approach:** Debounce input or use a deferred value; precompute lowercase fields; keep virtualization. Do not add a search index unless measurement justifies it.
- **Expected benefit:** Smoother typing in large trees.
- **Memory impact:** Small.
- **Performance impact:** Small to moderate.
- **Complexity:** Low.
- **Risk/regressions:** Slight result latency.
- **Relevant files:** `src/App.tsx:3631-3640`, `3700-3746`.
- **Evidence:** Confirmed no debounce; virtualization already present.
- **Validation:** Type in a 5,000-entry workspace; measure frame time.

#### LA-01 — `workspaceState.ts` is unreferenced

- **Area:** Dead code / bundle.
- **Current implementation:** `src/workspaceState.ts` exports snapshot save/load, validation, layout serialization, and GC. No current source file imports it (`rg` found no consumers outside the file).
- **Problem/opportunity:** It is not a runtime leak because Vite can tree-shake it, but it signals an unwired workspace-restore feature. `restoreTerminals` is also present in settings but not used outside settings UI.
- **Proposed approach:** Either wire the feature intentionally or remove the dead module and setting. This is maintainability, not a memory fix.
- **Expected benefit:** Less dead code and less confusion about persistence.
- **Memory impact:** None at runtime if already tree-shaken.
- **Performance impact:** None.
- **Complexity:** Low.
- **Risk/regressions:** Removing a planned feature.
- **Relevant files:** `src/workspaceState.ts`; `src/settings.ts:12`; `src/SettingsPanel.tsx:321`.
- **Evidence:** Confirmed no import; feature gap confirmed by search.
- **Validation:** `rg` for imports; build output inspection.

#### GE-01 — Main-thread formatting and fingerprinting

- **Area:** General CPU.
- **Current implementation:** Prettier formatting runs on the main thread after dynamic import (`src/App.tsx:577-625`). `contentFingerprint` scans the full string on save (`566-575`, `2736`).
- **Problem/opportunity:** Large saves block the UI; fingerprinting is O(n) but only on save.
- **Proposed approach:** Measure. If save latency is material, move formatting to a worker. Fingerprinting can stay unless profiles show it matters.
- **Expected benefit:** Less main-thread blocking on large saves.
- **Memory impact:** Worker baseline vs lower peak.
- **Performance impact:** Better save responsiveness.
- **Complexity:** Medium-high.
- **Risk/regressions:** Worker lifecycle, formatter plugins, cancellation.
- **Relevant files:** `src/App.tsx:566-625`, `2714-2767`.
- **Evidence:** Confirmed main-thread work; benefit hypothesis.
- **Validation:** Save large formatted files; measure long tasks.

### 3.2 Already optimized register

These audit targets were checked and do **not** justify changes without measurements.

| Area | Current mitigation | Evidence | Decision |
| --- | --- | --- | --- |
| Editor recreation from unstable callbacks | `onActivate` is stable `setState`; `onChange` is `useCallback([])`; `pluginEditorExtensions` is a module constant; `editorViews` is a ref; `group.id` is stable; effect depends on `file?.path`. | `src/App.tsx:811-878`, `2770-2789`, `src/pluginRuntime.ts:3187-3190` | Audit hypothesis not supported. Do not change dependencies without a profile. |
| Settings/theme/language editor rebuild | Compartments are reconfigured in place. | `src/App.tsx:804-808`, `880-1045` | Already optimized. |
| Language package loading | Dynamic imports per extension; modules are cached by the runtime. | `src/App.tsx:701-727` | Already lazy. |
| Panel and formatter loading | `TerminalView`, `SettingsPanel`, `GithubPanel`, `PluginPanel`, `ThemeMaker`, Prettier plugins are dynamic. | `src/App.tsx:133-137`, `577-625` | Already lazy. |
| File tree rendering | Virtualized visible tree and search list. | `src/App.tsx:1461-1479`, `3700-3746` | Keep. |
| Closed file content release | `fileContents` and `lastDiskWrite` entries are deleted on close/removal. | `src/App.tsx:1923-1929`, `2893-2904` | Already correct. |
| Terminal output history | Global 2 MiB / 8,000-chunk cap; bounded closed-session set. | `src/terminalOutput.ts:8-40`, `90-106` | Already bounded. |
| Terminal backend buffering | Four-chunk channel, 16 KiB reads, 32 KiB batching; spawn is idempotent. | `src-tauri/src/lib.rs:255-261`, `320-355` | Already bounded/reasonable. |
| Terminal closed-session retention | `VecDeque` capped at 128. | `src-tauri/src/lib.rs:162-165`, `440-458` | Already bounded. |
| Watcher scale | Directory cap 3,000; catch-up cap 5,000; failure cap 32; 200 ms debounce; ignore list and `.arcwatchignore`. | `src-tauri/src/lib.rs:2423-2445`, `2471-2521`, `2606-2693` | Already bounded; only batching remains. |
| Watcher replacement | `watch_project` replaces the watcher and old receiver ends. | `src-tauri/src/lib.rs:2717-2752` | Already handled; verify with runtime test. |
| GitHub caches | Six-workspace cache with eviction; auth interval cleanup. | `src/GithubPanel.tsx:42-62`, `170-178` | Already bounded. |
| Global event listener cleanup | Keydown, wheel, ResizeObserver, watcher, and auth effects return cleanup functions. | `src/App.tsx:1646-1766`, `2072-2103`, `2323-2352`, `3566`; `src/GithubPanel.tsx:170-187` | Mostly correct; plugin-owned resources are the exception. |
| Plugin deactivation | Timers, workers, handlers, disposables, cleanup, and Blob URL are cleared. | `src/pluginRuntime.ts:821-850`, `2372-2387` | Correct for explicit deactivation. |
| Plugin panel mounting | Only the active plugin view is mounted. | `src/App.tsx:1240-1242`, `189-208` | Already optimized. |
| Dead workspace snapshot module | Not imported by application code. | `src/workspaceState.ts`; no consumers found | Tree-shaken; not a runtime memory issue. |

---

## 4. CodeMirror research

### 4.1 Does the editor get recreated unnecessarily?

Partially yes, but not for the reason the audit suspected.

- Not caused by `onActivate`: it is the stable React `setActiveGroupId`.
- Not caused by `onChange`: `updateFile` is `useCallback` with an empty dependency list (`src/App.tsx:2770-2789`).
- Not caused by `pluginEditorExtensions`: it is a module-level constant (`src/pluginRuntime.ts:3187-3190`).
- Not caused by `editorViews`: it is a stable ref.
- Caused by `file?.path`: changing the active tab destroys the current view and creates a new one (`src/App.tsx:811-878`).

The `file` object itself is recreated every App render (`src/App.tsx:4290-4297`), but it is not an effect dependency. That is why a keystroke that rerenders App does not destroy the editor.

### 4.2 Compartments

Settings, theme, and language are correctly compartmentalized. `Compartment.reconfigure()` dispatches a transaction; it does not rebuild the view. This is the right architecture. No change is justified there.

### 4.3 Editor state retention

Current state preservation is incomplete:

- Selection and scroll are stored only for the most recently unmounted file in that pane (`snapshot`).
- Switching A -> B -> A loses A's selection and scroll because B overwrites the single snapshot.
- Undo history is always lost on tab switch because it lives in the destroyed `EditorState`.
- The editor document is not cached separately from the view.

A per-path `EditorState` cache is the architecturally correct way to preserve history without keeping DOM views alive. It must be bounded because each state retains a document and history. Do not implement until a heap/performance profile shows tab switching or history loss is material.

### 4.4 Indentation guides

The current implementation is simple and correct. It rebuilds all visible-line decorations on document or viewport changes and creates a mark per rebuild. This is unlikely to explain hundreds of megabytes, but it is per-keystroke allocation. Treat it as a low-priority optimization and measure first. A module-level mark and `RangeSetBuilder` are low-risk improvements if needed.

### 4.5 Plugin ViewPlugins

This is the largest CodeMirror-adjacent problem found. The three plugin ViewPlugins refresh on document, viewport, and selection changes. Each refresh builds a full language context, including `editor.state.doc.toString()`, before checking whether any provider exists. Scrolling a large file with the standard plugin extensions installed therefore does substantial hidden work even when no plugin uses those features.

The correct fix is not "remove plugins". It is:

1. Match providers by kind and language first.
2. Return immediately if none match.
3. Cache context per document revision/selection when needed.
4. Pass document/range accessors instead of full strings where the API allows.

### 4.6 Large files and expensive extensions

The editor has no large-file fallback. The highest-cost candidates on large documents are:

- Plugin view providers (full-document context).
- `highlightSelectionMatches` (selection-dependent scanning).
- Syntax parsing and highlighting.
- Indentation guide rebuilds.
- Autocomplete/hover provider calls.
- Full-document string materialization on edit and selection.

Any threshold behavior must be visible to the user and must preserve basic editing. Do not silently disable syntax highlighting or plugins.

### 4.7 What not to do

- Do not keep every tab's `EditorView` mounted. That trades CPU for a much larger DOM/editor-memory footprint.
- Do not remove history or state preservation to save memory.
- Do not switch away from CodeMirror.
- Do not disable all extensions globally to lower a number that has not been profiled.

---

## 5. File and document memory research

### 5.1 Representation inventory

| Representation | Owner | Lifetime | Copies |
| --- | --- | --- | --- |
| Full text string | `fileContents` map | Until file close / removal / workspace switch | One per open file |
| CodeMirror `Text` document | Active `EditorState` | Until view destroyed on tab switch | One for the active file per pane |
| `file` prop content | `fileContents.current.get(path)` result | Render-scoped | Reference, not copy |
| Disk fingerprint | `lastDiskWrite` | Until save/close | Small string |
| Formatted/save temporary | Local variables during save | Save duration | Transient full copies |
| Plugin event content | Event payload / listeners | Dispatch and any retention by listeners | Transient or plugin-retained |
| Terminal output | `terminalOutput` history | Global bounded history | Bounded 2 MiB total |

### 5.2 Is there a hidden duplicate of every open file?

No. Only the active file has a CodeMirror document. Inactive files have the string in `fileContents` and metadata in `openFiles`. The active file can have a string plus a CodeMirror tree. That is one duplicate for one file, not for every file.

This means file-content duplication is probably not the sole cause of ~500 MB unless the user has very large active files or many large open files. It can still matter, but it must be measured.

### 5.3 Are closed files released?

Yes, from the application maps:

- Closing the last tab deletes the path from `fileContents` and `lastDiskWrite` and removes it from `openFiles` (`src/App.tsx:2893-2904`).
- Disk removal removes open entries and cleans maps (`src/App.tsx:1923-1929`).
- Workspace switch clears `fileContents` and `lastDiskWrite` (`src/App.tsx:2622-2624`).

GC timing can make memory appear retained in a heap snapshot, but the references are removed.

### 5.4 Are files reread unnecessarily?

Yes in two places:

- Workspace open/restore scans the whole tree twice (`FS-01`).
- Every tab return may reparse from the string, but not reread from disk. The editor is recreated from `file.content`, so the disk is not hit. The cost is CPU, not file I/O.

### 5.5 Should an LRU cache be added?

Not yet. The current design already releases closed files, and inactive files are only one string each. An LRU would add complexity and disk latency. Add a total-byte budget only if a heap snapshot shows open-file strings dominate. If added, evict clean inactive buffers only; never dirty ones.

### 5.6 Large-file policy

The only existing safeguard is a 5 MiB confirmation prompt (`src/App.tsx:2694-2700`). It does not limit total open-file bytes, line count, or longest line. A large-file mode is more defensible than a blanket cache eviction because it addresses parsing/decoration cost rather than just string size.

---

## 6. Plugin research

### 6.1 Startup path

The plugin startup path does more work than necessary:

1. Eagerly bundles all built-in sources (`PL-01`).
2. Seeds or rewrites built-ins (`PL-03`).
3. Reads every plugin folder, including disabled ones (`PL-04`).
4. Keeps raw sources in both module state and plugin state (`PL-02`).
5. Activates every enabled plugin (`PL-09`).

The largest confirmed source is `plugins/api-tester/main.js` at 69,792 bytes. That alone is not 500 MB, but it demonstrates the pattern. The issue scales with installed third-party plugins.

### 6.2 Source retention

A plugin source string must exist at activation time. It does not need to exist for a disabled plugin, and it does not need to be duplicated in module constants and plugin state. The safest change is:

- Keep manifests for discovery.
- Store source only for enabled plugins or read it on activation.
- Do not rewrite built-ins when the installed version is current.
- Keep the plugin API and install/remove flows intact.

### 6.3 Process sinks and output

Two confirmed unbounded paths exist:

- `pluginProcessSinks` is not removed on natural exit; pending output arrays have no cap (`PL-05`).
- Output channels append without a cap (`PL-06`).

These are higher priority than eager loading because they can grow during normal operation, not just at startup. Fix them before touching plugin activation architecture.

### 6.4 Listener lifecycle

Plugin-owned resources are cleaned on explicit deactivation, but not always on natural resource end:

- PTY listeners are removed only by `stop()` (`PL-07`).
- Socket listeners are removed only by `close()` (`PL-07`).
- The process bus has global listeners from module load (`PL-10`).

These are small per-instance leaks but can accumulate in long sessions. Cleanup should be automatic and idempotent.

### 6.5 Provider architecture

The flat provider array and per-event filtering are simple and correct. An index by kind/language is only worth it with many providers. The more important issue is that the provider path materializes full text before checking for providers (`CM-06`).

### 6.6 Lazy activation

Lazy activation is a plausible startup optimization, but it is an API and behavior change. Plugins may register commands, panels, event listeners, or status items during activation. Moving activation later can break ordering and expectations. Do not do this before measuring startup cost with realistic plugin counts.

### 6.7 Plugin API compatibility

The current API supports raw events, editor context, language providers, processes, sockets, HTTP servers, storage, panels, and commands. Any change to full-text event payloads or activation timing must be additive or versioned. Do not silently remove fields that existing plugins may read.

---

## 7. React research

### 7.1 Is App rerendering on every keystroke?

Not exactly.

- `EditorPane` calls `onChange` on each edit.
- `updateFile` always writes `fileContents` and emits a plugin event.
- `setOpenFiles` returns the current array unchanged once the file is already dirty (`src/App.tsx:2775-2787`), so React should bail out after the first dirty transition in most cases.
- Plugin event listeners can still cause plugin-state updates.
- The window `CustomEvent` dispatch is synchronous and does not itself retain the payload after dispatch.

So the per-keystroke React render is not the main confirmed cost. The confirmed cost is the full string and plugin work before React state is even considered.

### 7.2 Monolith and pane rerenders

`App` is large and owns file tree, editor, terminal, settings, plugin, GitHub, and command-palette state. Any state update reconciles the whole tree. This can be CPU-expensive during unrelated updates, but it is not proven to be a memory problem. React Profiler should be used before memoizing.

If memoization is pursued:

- `EditorPane` needs stable callbacks: `closeTab`, `openDroppedFile`, and `onSelectionChange` are current sources of identity churn.
- The inline `file` object must be stabilized or handled by a custom comparator.
- `pluginViews` and `pluginLanguages` should remain stable when unchanged.
- Split rendering should not be rewritten just for memoization.

### 7.3 Derived state

Already memoized: tree, visible tree nodes/entries, filtered files, editor tab items, terminal/plugin maps, theme CSS.

Not memoized: app commands and command items. This is low impact unless the palette is open. The theme CSS memo depends on the whole settings object and recomputes for unrelated settings, but the string is small relative to editor work.

### 7.4 Virtualization and list size

The tree and search results are virtualized. This is a genuine already-optimized area. Do not replace it with a new list library.

### 7.5 What not to do

- Do not split `App.tsx` solely because it is large. That is maintainability work, not a measured memory fix.
- Do not add `React.memo` everywhere. It can add comparison cost and stale-prop risk.
- Do not move all state to a state library for this problem.
- Do not keep plugin panels mounted when hidden.

---

## 8. Terminal and Rust research

### 8.1 Frontend

The terminal design intentionally trades CPU for memory:

- Only the active xterm exists.
- Inactive xterm DOM and scrollback are disposed.
- The Rust shell stays alive.
- Returning to a terminal replays bounded history.

This is reasonable for a memory-focused pass. The main improvement is batching replay, not keeping every xterm alive. Keeping hidden xterms would increase retained memory roughly with terminal count and scrollback.

The global 2 MiB history is bounded. It can evict one terminal's history when another is noisy, but that is a fairness tradeoff, not a leak. The closed-session set is bounded at 128.

### 8.2 Backend

The PTY path is already well bounded:

- Four-chunk channel.
- 16 KiB read buffers.
- 32 KiB output batching.
- Eight-millisecond receive timeout.
- Spawn is idempotent.
- Closed IDs are bounded.

The plugin process path is less bounded:

- Exit polling every 50 ms per process.
- No output batching.
- Frontend process sinks and output channels can grow without bound.

Local HTTP server:

- One thread per connection.
- Whole-file reads.
- Tree signature polling for live reload.

These are the Rust/background targets worth investigating.

### 8.3 Terminal scrollback

`terminalScrollback` is user-configurable from 500 to 5,000 lines (`src/SettingsPanel.tsx:314`). Only the active xterm exists, so several terminals do not multiply scrollback memory at once. A 5,000-line maximum is already a reasonable bound. Do not lower it without user-visible rationale.

### 8.4 What not to do

- Do not keep all xterm instances mounted to avoid replay; it trades a bounded CPU cost for unbounded active-terminal memory.
- Do not remove the global output cap.
- Do not lower scrollback defaults without measuring and without preserving user choice.
- Do not rewrite the PTY layer; the current buffering is already sensible.

---

## 9. Filesystem and background research

### 9.1 Duplicate scans

The biggest avoidable file I/O is the double workspace scan (`FS-01`). The backend watcher also traverses directories to register watches, but that is necessary for watch correctness. The two scans to eliminate are the two frontend `refreshWorkspace` calls on open/restore.

### 9.2 Watcher event volume

The watcher is well bounded in directory count and catch-up entries, but it emits one IPC event per event and per catch-up entry. A large subtree creation can produce thousands of messages. Frontend rAF batching reduces render churn but not transport or serialization.

Batching mapped events into a single payload is a coherent improvement. It must preserve ordering and the frontend delta reducer's assumptions.

### 9.3 Watcher ignores and metadata

`is_watch_ignored` builds a `PathBuf` component by component and performs gitignore matching for each event (`src-tauri/src/lib.rs:2494-2521`). This is unlikely to be a major cost, but it is per-event allocation. Do not optimize it before profiling; the watcher caps and debounce are more important.

### 9.4 Background resource inventory

| Resource | Lifecycle | Cleanup status |
| --- | --- | --- |
| Workspace watcher thread | One per active workspace | Replaced on switch; receiver ends |
| PTY reader/forwarder threads | Per terminal | End on PTY close/exit |
| Plugin process threads | Up to three per spawned process (stdout, stderr, exit monitor) | End on exit; backend map removes |
| Plugin process Tauri listeners | Module-level bus | Never removed |
| Plugin PTY Tauri listeners | Per plugin PTY | Only on explicit `stop()` |
| Plugin socket Tauri listeners | Per socket | Only on explicit `close()` |
| Local HTTP server threads | Server + watcher + per request | Server drop joins server/watcher threads; request threads are detached |
| GitHub auth interval | Only during auth | Cleared on completion/unmount |
| Terminal output Tauri listener | Global singleton | Intentionally permanent |
| Watcher Tauri listeners | App lifetime | Removed on unmount |
| Resize observers | Tree/terminal | Disconnected on cleanup |

### 9.5 Live server

The live server's tree signature polling is a genuine background CPU/disk cost while a page is open. It is safer to improve that with notifications or subtree caching than to disable reload.

### 9.6 Search

Search is virtualized but not debounced. This is a low-risk UI improvement, not a memory fix.

### 9.7 What not to do

- Do not increase watcher caps to watch `node_modules` or `.git`.
- Do not remove `.arcwatchignore` support.
- Do not debounce watcher events so long that UI updates feel stale.
- Do not replace the watcher with a polling loop.

---

## 10. Additional discoveries

1. **`workspaceState.ts` is unwired.** The module is complete but not imported. `restoreTerminals` exists in settings and appears in the settings UI, but no runtime code consumes it. This looks like an unfinished workspace-restore feature.
2. **The 5 MiB open-file warning is the only large-file guard.** It does not prevent opening or limit total open bytes.
3. **Built-in source is duplicated.** The eager glob and the on-disk read both retain source strings.
4. **Built-in files are rewritten every launch after first seed.** This is not just first-run behavior.
5. **Plugin output channels are unbounded.** This is a confirmed runtime growth path.
6. **Plugin process sinks are not removed on natural exit.** This is a confirmed lifecycle gap.
7. **Plugin PTY/socket listeners are not automatically cleaned on natural end.** This is a confirmed cleanup gap.
8. **No React Profiler data exists.** React memoization changes should wait.
9. **No heap snapshots exist.** File-cache eviction and EditorState caching should wait.
10. **No frontend test runner exists.** Validation is `npm run build` typecheck plus manual profiling; Rust has `cargo test`.
11. **The production bundle is already split.** Large language chunks are lazy; startup still carries the main app and plugin runtime.
12. **The app reports ~500 MB, but WebView/native/GPU/child-process attribution is unknown.** Do not claim a JavaScript-only cause.

---

## 11. Prioritized roadmap

### Phase 0 — Low-risk, confirmed wins

| Order | Optimization | Reason | Risk |
| --- | --- | --- | --- |
| 1 | Guard plugin providers before building full context (`CM-06`) | Removes repeated full-document copies on scroll/selection when no provider exists | Low |
| 2 | Build selection context once; remove duplicate full-text payload (`CM-02`) | Confirmed duplicate work on every selection/focus | Low-medium due to plugin contract |
| 3 | Clean process sinks on exit; cap pending buffers (`PL-05`) | Confirmed retained/unbounded growth | Low-medium |
| 4 | Cap plugin output channels (`PL-06`) | Confirmed unbounded growth | Low |
| 5 | Auto-clean plugin PTY/socket listeners on natural end (`PL-07`) | Confirmed listener leak path | Low |
| 6 | Remove duplicate workspace scan (`FS-01`) | Confirmed duplicate I/O | Low |
| 7 | Skip unnecessary built-in rewrites (`PL-03`) | Confirmed startup I/O | Low |

### Phase 1 — Medium-risk, high-value

| Order | Optimization | Reason |
| --- | --- | --- |
| 8 | Coalesce/incrementalize `editor:changed` (`CM-01`) | Largest per-keystroke allocation; needs API compatibility plan |
| 9 | Batch terminal history replay (`TE-02`) | Low-risk responsiveness win |
| 10 | Batch watcher IPC (`RS-04`) | Reduces event storms |
| 11 | Improve live-server signature polling (`RS-01`) | Background CPU/disk on large projects |
| 12 | Add measured large-file mode (`CM-07`) | Prevents pathological editor behavior |
| 13 | Preserve per-path EditorState (`CM-03`) | Fixes history/selection loss and tab-switch cost; requires bounded cache |
| 14 | Resolve `editorViews` single-path invariant (`CM-04`) | Correctness in splits |

### Phase 2 — Measure first

| Order | Optimization | Required evidence |
| --- | --- | --- |
| 15 | Memoize `EditorPane` / isolate React state (`RE-01`) | React Profiler shows significant pane reconciliation |
| 16 | File-cache budget or LRU (`FD-02`) | Heap snapshot shows open-file strings dominate |
| 17 | Remove active-document duplicate representation (`FD-01`) | Heap snapshot shows two representations matter |
| 18 | Worker formatting (`FD-03`, `GE-01`) | Save long-task profile |
| 19 | Local server thread pool/streaming (`RS-02`, `RS-03`) | Load test shows thread/RSS spike |
| 20 | Lazy plugin activation (`PL-09`) | Startup profile with many plugins |
| 21 | Provider index (`PL-08`) | Many providers show lookup cost |
| 22 | Explore plugin module unload (`PL-11`) | Browser-level module cache behavior is confirmed by memory tooling |

### Phase 3 — Maintainability, not memory

- Decide whether to wire or remove `workspaceState.ts` and `restoreTerminals`.
- Remove dead code only when the feature decision is clear.
- Keep the monolith unless profiling shows a concrete render problem.
- Do not turn every hypothesis into code.

### Measurement plan

Before and after every phase, record the same scenarios:

1. Startup.
2. Empty workspace.
3. Workspace open.
4. 10 files.
5. 30 files.
6. One large file.
7. Multiple splits.
8. Multiple terminals.
9. Plugin panel open/close.
10. Return to idle.
11. Tab switching loop.
12. Terminal switching loop.
13. Plugin process spawn/exit loop.
14. Workspace switch loop.

Record JS heap, WebView process RSS, Rust process RSS, GPU/child processes, long tasks, and frame drops. Use the same build mode, OS, and workload. Do not compare a dev build with a release build.

---

## 12. Optimizations not recommended

| Optimization | Why not |
| --- | --- |
| Keep every `EditorView` alive for every tab | Increases DOM, parser, and history memory substantially; current lifecycle is memory-conscious. |
| Keep every xterm instance mounted | Saves replay CPU but multiplies terminal memory and DOM. Current active-only design is the better memory tradeoff. |
| Add LRU eviction immediately | There is no evidence open-file strings dominate; eviction adds disk latency and data-loss risk. |
| Remove undo history or selection state to save memory | User-visible state loss; not justified by any measurement. |
| Replace CodeMirror, xterm, React, or Tauri | Stack replacement is far riskier than targeted fixes and is outside the audit. |
| Remove plugin features to reduce memory | Violates feature-preservation constraint; fix lifecycle and bounds instead. |
| Disable syntax highlighting globally | Removes required editor behavior; use a measured large-file mode if needed. |
| Lower terminal scrollback below the user's setting | Removes functionality without evidence. |
| Increase watcher limits to include `node_modules`/`.git` | Risks inotify exhaustion and large event storms. |
| Debounce watcher events aggressively | Makes the tree feel stale and can break live update expectations. |
| Memoize everything with `React.memo`/`useMemo` | Adds comparison cost and stale-prop risk without a proven render bottleneck. |
| Convert `App.tsx` to a state library as part of this pass | Large rewrite with no measured memory benefit; addresses style, not the confirmed hotspots. |
| Move all formatting to Rust | Cross-language plugin formatter compatibility is complex; worker is the lower-risk option if needed. |
| Micro-optimize Rust `String`/`Vec` cloning everywhere | The confirmed Rust costs are watcher and server scale, not individual small allocations. |
| Rewrite the PTY layer | The current bounded channel and batching are already appropriate. |
| Lazy-load the core editor | The editor is the primary surface; delaying its core modules would harm startup interaction. |
| Treat bundle size as memory savings | Lazy chunks reduce startup parse/eval, not necessarily steady-state heap. |
| Claim a specific MB reduction without profiling | No measurements exist; fabricated numbers would mislead implementation. |

---

## Bottom line

The highest-value work is **not** a broad architectural rewrite. It is the removal of repeated whole-document work and a small number of confirmed lifecycle leaks:

1. Do not copy the full document for plugins that are not listening or providers that do not exist.
2. Bound and clean plugin process/output resources.
3. Stop scanning the workspace twice and rewriting built-ins on every launch.
4. Batch terminal replay and watcher IPC.
5. Only then profile and decide whether EditorState caching, React memoization, file-cache eviction, or large-file modes are worth their complexity.
