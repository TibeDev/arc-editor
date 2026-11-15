# Ponytail Audit — Arc IDE

Read-only audit. No application files were changed. This report is the only file added.

## What this repo does

Arc is a single-window desktop IDE built with Tauri 2, React 19, TypeScript, CodeMirror 6, a PTY terminal, a local preview server, git/gh integration, and a JavaScript plugin runtime. It is a local desktop tool for one developer working in one project at a time.

Assumed load: one user, one workspace, up to about 5,000 visible files, a few terminals, and at most 64 concurrent local HTTP connections. This is not a multi-user or network service, so availability findings are judged against a desktop app, not a server.

## Executive summary

The codebase is functional but carries avoidable risk in three places:

1. **Unsaved work can be lost without a prompt.** Deleting a selected file and switching folders both discard dirty editor buffers.
2. **Two backend promises are broken.** The updater compares versions as strings, so some updates are never offered. `plugin_process_exec` ignores its timeout and can hang forever.
3. **The plugin boundary is weaker than documented.** Any plugin can read another plugin's keyring secret through the raw `api.invoke`, and plugin installation drops asset files that the plugin API documents as bundled.

The Rust side is better tested than the frontend. Local-server path traversal, watcher filtering, AppImage environment cleanup, and update event serialization all have tests. The frontend has no test runner at all, and the riskiest logic (save, delete, undo, plugin path checks) is untested.

## Overall repository health

| Area | Assessment |
| --- | --- |
| Build | `npm run build` passes. |
| Rust tests | `cargo test` passes, 9 tests. |
| Rust lint | `cargo clippy` reports 3 non-blocking warnings: too many arguments, complex type, `sort_by_key`. |
| Frontend tests | None. `package.json` has no test script and `src/` has no test files. |
| Size | About 19,600 lines across TS, TSX, Rust, and plugin JS. Three files hold most of it: `src/App.tsx` (5,582), `src/lib/pluginRuntime.ts` (4,630), `src-tauri/src/lib.rs` (3,810). |
| Security posture | Capabilities are scoped to HOME/DOCUMENTS/DOWNLOADS/APPDATA, CSP is `null` by design for plugins, and plugins are explicitly trusted. That is a valid model, but the plugin API promises more isolation than it currently gives. |
| Strong points | Local server canonicalizes and checks paths, watcher registration is capped, child processes use process groups, secrets use the OS keyring, updater artifacts are signed, and Rust tests cover the dangerous local-server path. |

Main residual risks not counted as separate findings: `csp: null`, broad `$HOME/**` filesystem scope, and plugins that can spawn arbitrary executables. These are architectural choices for a trusted-plugin IDE, not accidental bugs, but they mean the plugin trust prompt is load-bearing.

## Must fix — critical and high priority

1. **Deleting a selected open file discards its unsaved buffer** (`src/App.tsx:3576-3627`, triggered from `src/App.tsx:3796` and `src/App.tsx:5440`)
   - **What this is:** `deleteEntries` copies the file or folder from disk into the undo trash, removes it, then removes any matching open file from `openFiles` and `fileContents`.
   - **Problem:** If the file has unsaved edits, the disk copy goes to trash and the in-memory buffer is deleted. Pressing `Delete` on a dirty file loses the edits with no prompt. Undo restores the on-disk version, not the edited one.
   - **Fix:** Before deleting, collect open files covered by the selection with `dirty === true`. Save them with `saveFile`, or show one confirm that names them and warns the edits will be lost. Do this in `deleteEntries` so every caller is covered.
   - **If we skip it:** One accidental Delete key press loses work, and the undo feature makes it look recoverable when it is not.

2. **Switching folders wipes every unsaved buffer** (`src/App.tsx:2934-2983`)
   - **What this is:** `openWorkspace` calls `setOpenFiles([])`, clears `fileContents`, and resets tabs after a new folder is chosen.
   - **Problem:** There is no dirty-file check. A user with edits in one workspace who opens another folder loses all of them immediately. The update installer does warn about unsaved files, so the missing check here is inconsistent.
   - **Fix:** Before `setWorkspace(selected)`, if `openFilesRef.current.some(file => file.dirty)`, show a confirm that lists the dirty files. Abort on cancel, or save all on accept. Reuse the same helper as finding 1.
   - **If we skip it:** Opening a second project is a silent data-loss action.

3. **Updater compares versions as strings** (`src-tauri/src/lib.rs:3390-3392`)
   - **What this is:** `updater_check` replaces the updater's version comparator with `update.version > current`, where both values are `String`.
   - **Problem:** String ordering is not semantic. For example, `"0.10.0" > "0.9.0"` is false, and `"0.1.10" > "0.1.9"` is false. Users on those versions are never offered the newer release. The `allow_downgrade` branch has the same string-only logic.
   - **Fix:** Parse both sides with `semver::Version` (add the small `semver` crate) and compare parsed values. When `allow_downgrade` is true, accept any parsed version that differs from the current one, as the current code intends.
   - **If we skip it:** The first time the project reaches a two-digit minor or patch number, auto-update silently stops for earlier builds.

4. **`plugin_process_exec` accepts a timeout but ignores it** (`src-tauri/src/lib.rs:988`, caller default at `src/lib/pluginRuntime.ts:2051`)
   - **What this is:** The JS API always sends a timeout (default 30,000 ms), but the Rust command executes `let _ = timeout_ms;` and then calls blocking `wait_with_output()`.
   - **Problem:** A plugin that runs a command which waits for input, a lock, or a network response blocks one Tauri async worker forever. The promise never settles and the plugin cannot recover. Several such calls can exhaust the async runtime.
   - **Fix:** Spawn the child, register it with `ProcessManager`, then wait with a deadline loop and call `processes.stop(managed, remaining)` on expiry. Return an error such as `Command timed out after {timeout} ms`. Do the wait in `spawn_blocking`.
   - **If we skip it:** A single badly behaved plugin command can freeze plugin execution and leak a child process.

5. **Any plugin can read another plugin's secret through raw `api.invoke`** (`src/lib/pluginRuntime.ts:1158`, `src-tauri/src/lib.rs:1464-1486`)
   - **What this is:** `api.invoke(command, args)` exposes every registered Tauri command. `plugin_secret_get(plugin_id, key)` trusts the caller-supplied `plugin_id`.
   - **Problem:** A plugin can call `api.invoke("plugin_secret_get", { pluginId: "other-plugin", key: "token" })` and read the other plugin's OS-keyring credential. The scoped `api.secrets` wrapper passes the caller's own ID, but the raw command does not enforce it. This defeats the main reason to use the keyring.
   - **Fix:** Do not expose `plugin_secret_*` through generic `invoke`. Either remove `api.invoke` from the public plugin API, or add a token/context argument that the backend maps to the calling plugin ID and reject mismatched IDs. The smallest safe change is an allowlist in the plugin `invoke` wrapper that rejects `plugin_secret_*` and requires plugins to use `api.secrets`.
   - **If we skip it:** The plugin API's credential isolation is documentation only.

6. **No frontend tests cover the destructive and security-sensitive paths** (`package.json:6-10`, `src/App.tsx:3062-3730`, `src/lib/pluginRuntime.ts:2652-2663`)
   - **What this is:** There is no frontend test runner. The save, delete, undo, rename, workspace-switch, and plugin path-containment logic are only manually verified.
   - **Problem:** The two data-loss bugs above would have been caught by one test that marks a file dirty, calls delete or workspace switch, and asserts a prompt or save occurred. `pluginWorkspacePath` is a trust boundary and has no test for `..`, absolute paths, drive letters, or backslash traversal.
   - **Fix:** Add Vitest and one small test file per risky module. Test `pluginWorkspacePath`, `removeNestedEntries`, the delete/undo reducer, and the dirty-buffer guard once it exists. This does not need a DOM test suite.
   - **If we skip it:** Regressions in file deletion and path containment stay invisible until a user reports lost work.

## Should fix — medium priority

7. **The file watcher stops silently after 3,000 directories** (`src-tauri/src/lib.rs:3053-3055`, `src-tauri/src/lib.rs:3163-3175`, `src-tauri/src/lib.rs:3185-3190`)
   - **What this is:** `watch_directory_tree` returns `stalled` when `WATCH_MAX_DIRS` is reached, but `watch_project` discards that return value. It only emits `fs-watcher-error` when `failures >= WATCH_MAX_FAILURES`.
   - **Problem:** A workspace with more than 3,000 non-ignored directories installs a partial watcher and reports success. New or changed files below the limit never appear in the tree until a manual refresh.
   - **Fix:** Capture the `stalled` result in `watch_project` and use the existing `fs-watcher-error` message when it is true, not only when registration failures reach the cap.
   - **If we skip it:** Large monorepos look live but silently show stale state.

8. **One vanished directory aborts the whole workspace scan** (`src/App.tsx:2564-2566`, `src/App.tsx:2618-2627`, cap at `src/App.tsx:2557-2561`)
   - **What this is:** `refreshWorkspace` uses `Promise.all` over `readDir` batches and awaits hidden-path grants for the whole batch.
   - **Problem:** If a directory is deleted during a scan, or a hidden file disappears before `workspace_allow_hidden_paths` canonicalizes it, the promise rejects and `setFiles` never runs. With watcher churn from a build, refreshes can fail repeatedly. Separately, the 5,000-entry cap truncates the tree with no user-visible notice.
   - **Fix:** Use `Promise.allSettled` per batch and skip failed directories. Wrap each hidden grant so one failure does not abort the scan. When `collected.length` reaches 5,000, set a message such as `File tree limited to 5,000 items`.
   - **If we skip it:** The tree can silently stop updating during normal file churn.

9. **`unwatch_project` returns early and leaves the watcher running** (`src-tauri/src/lib.rs:3314-3317`)
   - **What this is:** If `canonicalize` fails because the workspace root was deleted, the function returns `Ok(())` before clearing `inner.root` and dropping the watcher.
   - **Problem:** The comment says dropping is enough, but the code returns first. The old watcher thread keeps running until the app exits or another watch call replaces it.
   - **Fix:** On canonicalize failure, still lock the state and clear `root`, `watched`, `filter`, and `watcher` when the stored root string matches (or unconditionally if no other root can be active).
   - **If we skip it:** A deleted workspace leaves a background thread and inotify state behind.

10. **Plugin installation copies only `plugin.json` and `main.js`** (`src/lib/pluginRuntime.ts:2532-2553`, `src/lib/pluginRuntime.ts:2669-2673`, documented in `PLUGIN_API.md:343` and `PLUGIN_API.md:598-607`)
    - **What this is:** `installFromFolder` reads the manifest and one source file, then writes only those two files into the app-data plugin folder. `writePluginFiles` does the same for built-ins.
    - **Problem:** The API documents `api.assets.url("worker.js")`, `api.assets.readText("templates/page.html")`, and worker creation from a plugin asset. A user-installed plugin that ships those files cannot work; the files are never copied. Reinstalling also deletes any existing assets first.
    - **Fix:** Recursively copy the selected plugin folder, excluding nothing required by the manifest, or copy every file and reject symlinks. Keep the manifest validation before copying. Update `writePluginFiles` only for built-ins if they later need assets.
    - **If we skip it:** The documented asset and worker APIs are broken for real plugins.

11. **The embedded plugin HTTP server accepts arbitrary bind hosts and unbounded bodies** (`src-tauri/src/lib.rs:1252-1265`, `src-tauri/src/lib.rs:1335`)
    - **What this is:** `plugin_http_server_start` passes the plugin-supplied `host` directly to `TcpListener::bind`. `read_http_request` trusts `content-length` and grows `body` until that length is reached.
    - **Problem:** A plugin can bind `0.0.0.0` and expose an unauthenticated handler to the LAN. Any exposed client can send a large `content-length` and make the connection thread allocate arbitrary memory. Up to 64 such connections are allowed.
    - **Fix:** Default and document loopback-only binding; reject non-loopback hosts unless a future explicit capability permits them. Cap the body at a fixed size (for example 10 MB) and return `413` when exceeded. Also cap the header count and value sizes.
    - **If we skip it:** A plugin bug becomes a network-reachable memory-exhaustion vector.

12. **Dead workspace-restore module and three dead settings** (`src/lib/workspaceState.ts:1-345`, `src/lib/settings.ts:54`, `src/lib/settings.ts:58`, `src/lib/settings.ts:62`, `src/components/SettingsPanel.tsx:407-417`)
    - **What this is:** `workspaceState.ts` exports snapshot save/load, layout serialization, and garbage collection, but nothing imports it. The settings UI still exposes `restoreTerminals`, `terminalCursorBlink`, and `terminalScrollbar`, and none of the three are read anywhere.
    - **Problem:** The module and toggles promise features that do not exist. `restoreTerminals` says previous terminal tabs are recreated; no code does that. The toggles mislead users and add maintenance weight.
    - **Fix:** Either implement restore using the existing module and pass cursor blink/scrollbar options to rioterm, or delete `workspaceState.ts` and the three settings from `AppSettings`, `DEFAULT_SETTINGS`, and `SettingsPanel`. Deleting is the smaller change.
    - **If we skip it:** Users change settings that do nothing, and the dead snapshot code is read and maintained for no reason.

13. **Global monkey-patch of `ColorResolver.prototype`** (`src/components/TerminalView.tsx:39-46`)
    - **What this is:** Importing `TerminalView` replaces `ColorResolver.prototype.resolve` process-wide so terminal colors can carry alpha.
    - **Problem:** The patch is global, unguarded, and never restored. A hot-reload or a second copy of the module wraps the previous wrapper, so alpha is applied repeatedly. Any other rioterm consumer in the same window is affected by an app-level transparency decision.
    - **Fix:** Prefer a per-instance resolver or a themed color value if rioterm exposes one. If the patch must stay, guard it with a module-level flag and restore the original on dispose, and document why the library cannot do this directly.
    - **If we skip it:** Transparency behavior becomes order-dependent and hard to debug in development.

14. **Long blocking work runs inside async Tauri commands** (`src-tauri/src/lib.rs:3137-3170`, `src-tauri/src/lib.rs:976-1028`, `src-tauri/src/lib.rs:936-973`)
    - **What this is:** `watch_project` walks up to 3,000 directories synchronously, `plugin_process_exec` waits synchronously for a child, and `plugin_process_stop` sleeps in a deadline loop.
    - **Problem:** These commands are marked async but block a runtime worker. On a large workspace or a slow process, other commands and events can stall.
    - **Fix:** Wrap the directory walk and the process waits in `tauri::async_runtime::spawn_blocking` (or `std::thread`) and await the handle. This is a small structural change, not a rewrite.
    - **If we skip it:** UI commands become intermittently slow on big projects or stubborn child processes.

15. **Terminal output pump and shutdown code are duplicated in Rust** (`src-tauri/src/lib.rs:366-430` vs `src-tauri/src/lib.rs:709-760`)
    - **What this is:** `read_terminal_output` and `stream_process_output` implement the same reader thread, 8 ms receive timeout, 32 KB batching, and lossy UTF-8 emission. `TerminalState::drop` and `PluginProcessState::drop` also repeat the try-wait/kill/wait sequence.
    - **Problem:** The two pumps must change together but are separate copies. Fixing ordering or backpressure in one leaves the other wrong.
    - **Fix:** Extract one `pump_stream(reader, emit)` helper and one `terminate_child` helper. Call them from both sites. This removes about 50 lines and one class of drift.
    - **If we skip it:** The next terminal or process fix will probably land in only one copy.

16. **GitHub “Stage all” starts one `git` process per changed file** (`src/components/GithubPanel.tsx:318-327`)
    - **What this is:** `stageAll` loops over `status.changes` and invokes `github_stage` once per file.
    - **Problem:** A change set with thousands of files starts thousands of Git processes and IPC round trips. This is the slow path in the panel and it is easy to hit after a generated-file change.
    - **Fix:** Add a backend `github_stage_all(root, stage)` that runs `git add -A` or `git reset`, and call it once. Keep per-file staging for the checkbox interaction.
    - **If we skip it:** “Stage all” is unusably slow on large diffs.

17. **The `api-tester` development plugin ships and auto-installs for every user** (`src/lib/pluginRuntime.ts:23-24`, `src/lib/pluginRuntime.ts:811-831`, `plugins/api-tester/main.js`)
    - **What this is:** The `import.meta.glob` includes every folder under `plugins/`, and the first-run seeding writes all built-ins, including the 1,433-line API Tester. The README lists only Live Server and XAMPP.
    - **Problem:** Every user gets a diagnostic plugin that registers UI, secrets calls, process tests, and a large panel. It adds bundle and startup weight and expands the surface of the default install for no user-facing purpose.
    - **Fix:** Move API Tester outside `plugins/`, or mark it dev-only and exclude it from `builtinManifestSources` in production builds. If it stays, list it in the README.
    - **If we skip it:** The default install contains an unrequested test harness.

18. **Three monoliths make ownership hard** (`src/App.tsx:1437-5582`, `src/lib/pluginRuntime.ts:739-2650`, `src-tauri/src/lib.rs:1-3810`)
    - **What this is:** App shell state, file operations, editor panes, plugin host actions, and all Rust commands live in three very large files. `AGENTS.md` still describes `App.tsx` as about 4,300 lines and `lib.rs` as about 1,600, so the map is already stale.
    - **Problem:** Every change touches a file with thousands of lines and many unrelated concerns. Review, merge conflicts, and test isolation suffer.
    - **Fix:** Do not rewrite. Move pure helpers out first: `makeTree`, `removeNestedEntries`, layout insert/prune/resize, path helpers, and Prettier dispatch into `src/lib/`. In Rust, split `lib.rs` into `terminal.rs`, `github.rs`, `local_server.rs`, `watcher.rs`, `plugin_http.rs`, and `updater.rs` behind the existing command registrations. Keep React state where it is.
    - **If we skip it:** The stale map and the monoliths will keep slowing every change.

## Nice to have — low priority

19. **`plugin_http_server` responses always say `OK`** (`src-tauri/src/lib.rs:1273`)
    - **What this is:** `write_http_response` formats the status line as `HTTP/1.1 {status} OK`.
    - **Problem:** A 404 or 504 response is written as `404 OK` or `504 OK`. Clients that log or parse the reason phrase see a contradiction. The status code still works, so this is cosmetic protocol correctness.
    - **Fix:** Map common codes to reason phrases, or omit the reason phrase and send `HTTP/1.1 {status}\r\n`. One small match is enough.
    - **If we skip it:** Debugging proxy and plugin handlers is slightly more confusing.

20. **`api.files.writeAtomic` replaces nothing on Windows** (`src/lib/pluginRuntime.ts:1318-1329`)
    - **What this is:** The helper writes a temp file and calls the fs plugin `rename` onto the destination.
    - **Problem:** The Rust fs plugin uses `std::fs::rename`, which fails on Windows when the destination exists. `writeAtomic` therefore works the first time and fails when overwriting an existing file, which is the normal case for config or state files.
    - **Fix:** On Windows, remove the destination before the rename, or use a backend replace that is documented per platform. Accept that the remove-then-rename path is not perfectly atomic and document that limit.
    - **If we skip it:** Plugins that use the documented atomic write break on Windows after the first write.

## Recommended optimizations

- **Batch Git operations.** A single stage-all command and a single status call per refresh remove most of the process-spawn overhead in the GitHub panel.
- **One dirty-buffer guard, reused everywhere.** Save/confirm once, then call it from delete, workspace switch, and close. This removes three separate data-loss paths with one helper.
- **One stream pump in Rust.** The duplication is small but the two copies already differ in subtle ways; one helper keeps terminal and plugin output behavior identical.
- **Delete before abstracting.** Removing `workspaceState.ts`, the three dead settings, and the shipped API Tester removes about 1,800 lines without changing behavior.
- **Test the boundaries, not the UI.** Vitest for `pluginWorkspacePath`, `removeNestedEntries`, and the delete/undo reducer is enough to cover the highest-risk frontend logic.

## Prioritized implementation roadmap

1. **Day 1 — stop data loss and broken promises.** Add the dirty-buffer guard and use it in `deleteEntries` and `openWorkspace`; parse update versions with `semver`; implement the `plugin_process_exec` timeout. Add one test for each.
2. **Week 1 — close the plugin boundary.** Remove `plugin_secret_*` from generic `api.invoke`; cap HTTP request bodies and default to loopback; copy plugin assets on install.
3. **Week 2 — make large workspaces reliable.** Report the watcher directory cap, make workspace scans tolerate vanished directories, fix `unwatch_project`, and surface the 5,000-entry tree limit.
4. **Week 3 — remove dead weight.** Delete `workspaceState.ts` or implement restore; remove or wire `restoreTerminals`, `terminalCursorBlink`, and `terminalScrollbar`; exclude API Tester from production.
5. **Later — pay down structure.** Extract pure frontend helpers, split Rust commands into modules, guard the rioterm patch, batch Git stage-all, and move blocking work to `spawn_blocking`.

## Verdict

Healthy foundation with two real data-loss paths, one silent update bug, and a plugin isolation gap. Fix findings 1–6 first; they are small changes with high user impact.

## Lean

About 1,850 lines can leave the shipped bundle by deleting dead snapshot code, dead settings, and the default API Tester install. No unused npm dependency was found, so dependency reduction is 0.

## Not checked

The GUI was not run; this audit did not use `npm run tauri dev`. Windows and macOS runtime behavior was reasoned from code and library source, not executed. The updater was not exercised against a live release endpoint. CSS files, `BuildWizard`, `ThemeMaker`, the agent kit, and `AUTO_UPDATER.md` were skimmed, not fully reviewed. Smaller style and naming issues are intentionally omitted.
