# Arc IDE — Repository Audit

Read-only audit. No application code was changed.

## What this repo does

Arc is a local desktop IDE (Tauri 2 + React 19 + TypeScript, CodeMirror 6, rioterm terminal, git/gh CLI, sandboxed-ish JS plugins) for one developer on one machine.

Assumed load: one app instance, one workspace at a time, trees of a few thousand files, local plugins trusted, GitHub/live-server calls local and occasional.

## Must fix

### 1. Unsaved edits die on window close and automatic update — `src/App.tsx:1624-1631`, `src/App.tsx:1724-1735`, `src-tauri/src/lib.rs:3444`

- **What this is:** No `onCloseRequested`/`beforeunload` dirty guard exists anywhere. The automatic update path calls `installUpdate(true)` without the dirty check used by the manual path.
- **Problem:** Closing the window or letting an automatic update install discards edited buffers. `updater_install` calls `app.restart()` at line 3444 after download.
- **Fix:** Add one guard helper that finds dirty buffers, confirms or saves, then allows close/restart. Wire it to window close and both update paths.
- **If we skip it:** Silent loss of all unsaved work, including on a background update.

### 2. Opening another folder discards dirty buffers — `src/App.tsx:2934-2984`

- **What this is:** `openWorkspace` clears `openFiles`, `fileContents`, `lastDiskWrite`, undo batches, groups and layout after refreshing the new folder.
- **Problem:** Edit a file in project A, open project B, and the edits are gone with no prompt. Undo history for A is deleted too.
- **Fix:** Collect dirty entries from `openFilesRef`; prompt or save before clearing. Reuse the same helper as the quit guard.
- **If we skip it:** Normal workspace switching loses work.

### 3. Delete removes dirty buffers and cannot undo unsaved edits — `src/App.tsx:3576-3662`

- **What this is:** `deleteEntries` copies files to `appDataDir/undo-trash`, removes the originals, then drops `fileContents`, `lastDiskWrite` and open tabs for those paths.
- **Problem:** A dirty open file plus Delete loses the buffer. Undo restores the old disk copy from trash, not unsaved text. Recursive directory delete has no confirmation, and trash is wiped on the next launch.
- **Fix:** Detect dirty files in the selection and confirm or save first. Confirm recursive directory deletes. Keep undo, but stop deleting dirty state first.
- **If we skip it:** One keypress can destroy work permanently after a crash or restart.

### 4. Save truncates the real file instead of writing atomically — `src/App.tsx:3062-3133`

- **What this is:** `saveFile` calls `writeTextFile(`${workspace}/${file.path}`, content)` at line 3090.
- **Problem:** This is truncate + write. A crash, power loss or full disk mid-save leaves a truncated or empty file.
- **Fix:** Write a temp file in the same directory, fsync if available, then rename over the target. `pluginRuntime` already has a `writeAtomic` pattern to reuse.
- **If we skip it:** Saves are not crash-safe.

### 5. `plugin_process_exec` ignores its timeout and buffers output without limit — `src-tauri/src/lib.rs:977-1028`

- **What this is:** `let _ = timeout_ms;` at line 988, then blocking `child.wait_with_output()` at line 1010 inside an async command.
- **Problem:** A plugin runs a command waiting on stdin/network with `timeoutMs: 30000`; the promise never settles and the child leaks. A command like `yes` grows the output buffer until memory pressure. This path also skips `prepare_command` process-group setup.
- **Fix:** Implement a deadline wait, kill via `ProcessManager.stop`, run in `spawn_blocking` or reuse the streaming spawn path, and cap buffered output.
- **If we skip it:** A plugin command can hang or exhaust memory with no recovery.

## Should fix

### 6. Staging all changes spawns one git process per file — `src/components/GithubPanel.tsx:318-326`, `src-tauri/src/lib.rs:2013-2030`

- **What this is:** The frontend loops `await invoke('github_stage')`; each call runs `git add -- <path>` or `git reset -- <path>`.
- **Problem:** 1,000 changed files means 1,000 subprocesses; the UI is busy for seconds or minutes.
- **Fix:** Add one backend stage-all command using `git add -A` (and one unstage-all using `git reset`). Keep per-file commands for single selections.
- **If we skip it:** Large repos make the GitHub panel feel frozen.

### 7. `github_status` spawns many git processes on every poll — `src-tauri/src/lib.rs:1843-1988`, `src/components/GithubPanel.tsx:174-187`

- **What this is:** Every status call runs version, config, branch, branches, status, remotes and rev-list sequentially. Only install/auth checks are cached.
- **Problem:** The auth modal polls every 1.5s, so login can launch repeated subprocess storms. All calls are synchronous inside an async command.
- **Fix:** Cache the full status briefly, poll only `gh auth status` during login, and move subprocess work to `spawn_blocking`.
- **If we skip it:** Login and repo refresh burn CPU and disk with no visible benefit.

### 8. Plugin HTTP server accepts unbounded bodies and always says "OK" — `src-tauri/src/lib.rs:1216-1284`

- **What this is:** `read_http_request` trusts `Content-Length`; `write_http_response` emits `HTTP/1.1 {status} OK` for every status.
- **Problem:** A local client can declare 4 GB and slowly send it, growing memory. 404 and 500 responses have a wrong reason phrase. The 64-connection cap and 15s read timeout limit the blast radius, but do not cap the body.
- **Fix:** Cap request bodies (8-16 MB), reject oversize with 413, and map common status codes to reason phrases.
- **If we skip it:** A local process can exhaust app memory, and protocol responses are incorrect.

### 9. Live-server fallback stats the whole tree every 700 ms — `src-tauri/src/lib.rs:2436-2449`, `src-tauri/src/lib.rs:2807-2852`

- **What this is:** When the native watcher fails, `run_local_server_poll` calls `local_file_signature`, which walks up to 20,000 entries and hashes path, length and mtime.
- **Problem:** A large tree plus a failed watcher means continuous stat/CPU load.
- **Fix:** Poll every 2-5s, or keep an incremental signature. This only affects the fallback path.
- **If we skip it:** The app burns a core while serving a large project.

### 10. `plugin_trash_path` trusts any absolute path — `src-tauri/src/lib.rs:1488-1515`

- **What this is:** The backend moves or deletes whatever absolute path it receives. Unlike `plugin_local_server_start` at lines 2239-2247, it does not canonicalize or check the workspace/fs scope.
- **Problem:** A plugin can call the command directly and trash `~/.ssh`. Plugins are trusted and can already spawn processes, so this is defense-in-depth, not a sandbox escape. The cross-device fallback can also leave a partial trash copy if `remove` fails.
- **Fix:** Canonicalize, require `starts_with` an approved workspace or fs scope, and clean partial copies on fallback failure.
- **If we skip it:** A buggy or malicious plugin has an unnecessarily broad delete primitive.

## Nice to have

### 11. Dead state module and dead terminal settings — `src/lib/workspaceState.ts`, `src/lib/settings.ts:54,59,62`, `src/components/SettingsPanel.tsx:407-408,417`

- **What this is:** All 345 lines of `workspaceState.ts` have no importer. `restoreTerminals`, `terminalCursorBlink` and `terminalScrollbar` are defined, defaulted and shown in Settings, but never read.
- **Problem:** Dead code and settings that pretend to work. `restoreTerminals` is visible to users but not wired.
- **Fix:** Delete the module, the three settings, their defaults and UI. That is smaller than implementing terminal restore.
- **If we skip it:** Maintenance noise and a misleading setting.

### 12. API Tester dev harness ships in every build — `plugins/api-tester/main.js`, `plugins/api-tester/plugin.json`, `src/lib/pluginRuntime.ts:23-24`

- **What this is:** A 1,433-line plugin that exercises every plugin API is treated as a built-in.
- **Problem:** Every release bundles and offers a test harness to users.
- **Fix:** Exclude `api-tester` from the production glob, or move it outside `plugins/`.
- **If we skip it:** Release bloat and a confusing plugin entry.

### 13. Double-open can create duplicate tabs — `src/App.tsx:2986-3037`

- **What this is:** `openFile` checks `openFiles` state, then awaits `stat`/`readTextFile`, then appends. There is no in-flight guard.
- **Problem:** Two quick opens of the same unopened file both see no entry and both append, producing duplicate entries and duplicate reads.
- **Fix:** Keep an in-flight `Set<path>` or re-check `openFilesRef` after the await.
- **If we skip it:** Rare duplicate tabs and stale-buffer confusion.

### 14. No frontend tests cover the data-loss paths — repo-wide

- **What this is:** There is no frontend test runner. The nine Rust tests pass (`cargo test --quiet`), but workspace switching, delete, quit and atomic save have no automated coverage.
- **Problem:** Findings 1-4 are exactly the flows a test would pin down.
- **Fix:** The smallest useful step is a tiny Vitest setup testing pure helpers (`removeNestedEntries`, content fingerprint, path remap) plus one dirty-guard test. If that is too heavy, keep an explicit manual checklist and do not claim coverage.
- **If we skip it:** These regressions will recur silently.

## Verdict

The core architecture is sound and the workspace access checks are tighter than expected. The serious problems are all around unsaved work: four independent paths discard or truncate edits. Fix those first; the git/plugin performance issues are secondary.

Lean: -1,800 lines, -0 dependencies possible. Deleting `workspaceState.ts` and the API Tester plugin is the safe part; the three dead settings add a handful more.

Not checked: `App.tsx` render and remaining key handling 3796-5582, full `SettingsPanel.tsx`, full `BuildWizard.tsx`, full API Tester, remaining ~2,000 lines of `pluginRuntime.ts`, README/PLUGIN_API/AUTO_UPDATER docs, CSS, manual UI behavior. No code changed.
