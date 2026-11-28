# Arc Code Cleanup Plan

## What this repo does

Arc is a desktop web-development workspace. It combines a file tree, CodeMirror editor, terminals, Git/GitHub actions, a web preview server, plugins, themes, and AI agent chats in one Tauri window.

Assumed load: one desktop user, a few terminal sessions, one running AI provider process, and short-lived local HTTP servers. No multi-user server exists.

Baseline checks:

- `npm run build` passes.
- `cargo test` passes: 36 tests, 0 failed.

## Must fix

### 1. External file changes are ignored for 3 seconds after Arc saves

**Location:** `src/App.tsx:2670-2673`

- **What this is:** After Arc saves a file, the file watcher skips modify events for that path for 3 seconds.
- **Problem:** If an external formatter or agent writes the file within 3 seconds, Arc never reads it. The editor keeps stale content, and the next save overwrites the external change. No frontend test covers this path.
- **Fix:** Always read the modified file. Skip only when its fingerprint equals `lastDiskWrite` for that path. Remove the 3-second shortcut.
- **If we skip it:** Users can silently lose work written by another tool.

### 2. `plugin_process_exec` can hang forever past its timeout

**Location:** `src-tauri/src/lib.rs:1033-1074`

- **What this is:** The command waits for stdout/stderr reader threads with `join()` after the child exits or times out.
- **Problem:** A child can start a grandchild that keeps the pipe open. Example: `sh -c 'sleep 600 &'` with `timeoutMs: 1000`. The shell exits, but `reader.join()` waits until the grandchild closes stdout. The plugin promise hangs for 600 seconds.
- **Fix:** Kill the process group on timeout and join readers with a deadline. Do not wait forever for pipe EOF.
- **If we skip it:** Any plugin using `exec` can freeze its command and leave threads behind.

## Should fix

### 3. Removed agent projects leave event-stream threads running

**Location:** `src-tauri/src/agent/manager.rs:615-660,2792-2806`

- **What this is:** Provider start creates one OpenCode event-stream thread per project.
- **Problem:** `agent_project_remove` removes project data but never stops that project's stream. Add and remove 50 projects while the provider runs, and 50 streams keep polling.
- **Fix:** Keep a per-project stop flag or thread handle, and stop it in `agent_project_remove`.
- **If we skip it:** Long sessions leak threads, sockets, and CPU work.

### 4. Live agent transcript items grow without a cap

**Location:** `src-tauri/src/agent/manager.rs:157-163,1660-1680`

- **What this is:** The 2000-item trim runs only when a thread is loaded from disk.
- **Problem:** During a long live run, every tool event is pushed into `state.items` and never trimmed. A chat with thousands of tool events grows memory until restart.
- **Fix:** Apply the same 2000-item trim after each live push or upsert.
- **If we skip it:** Long agent runs make Arc slow and can exhaust memory.

### 5. Project trust gate never blocks anything

**Location:** `src-tauri/src/agent/manager.rs:587`, `src/lib/agents/store.ts:318`

- **What this is:** New agent projects are stored with `trusted: true`. The store has `setTrust`, but no UI calls it.
- **Problem:** Trust checks exist in three send/start paths, but there is no path to an untrusted project. The README says users grant trust, which is false.
- **Fix:** Add projects as untrusted and show a trust action, or remove the trust checks and the docs that claim them.
- **If we skip it:** Users believe a safety boundary exists when it cannot trigger.

### 6. Terminal and plugin output can corrupt UTF-8 characters

**Location:** `src-tauri/src/lib.rs:434-444,711-745`

- **What this is:** Each raw byte chunk is decoded with `String::from_utf8_lossy`.
- **Problem:** A multibyte character split across two reads becomes `�`. Example: `é` or an emoji at the 16 KB read boundary.
- **Fix:** Keep an incomplete byte tail between chunks and decode only complete UTF-8 sequences.
- **If we skip it:** Terminal output and plugin logs show broken characters.

### 7. Live server exposes the whole workspace to any page that can reach localhost

**Location:** `src-tauri/src/lib.rs:2695-2800`

- **What this is:** The preview server serves every file under the workspace, including `.env` and `.git/config`, and does not validate the `Host` header.
- **Problem:** A malicious page can use DNS rebinding to read `http://127.0.0.1:5500/.env` while Live Server runs. The server has no Host check and no dotfile block.
- **Fix:** Reject `Host` values other than `127.0.0.1` and `localhost`. Deny dotfiles and `.git` by default.
- **If we skip it:** Running Live Server can leak secrets to a remote web page.

### 8. Branch and permission menus still clip on short panels

**Location:** `src/components/agents/AgentsWorkspace.css:813-860`

- **What this is:** The model menu measures available space in JavaScript, but branch and mode menus use fixed `max-height: 300px` or content height.
- **Problem:** In a short editor split with many branches, the menu opens upward past the panel top and is clipped by `overflow: hidden`.
- **Fix:** Reuse the model menu's available-height measurement for branch and mode menus.
- **If we skip it:** Some menu items become unreachable.

### 9. A missing agent worktree silently falls back to the main project

**Location:** `src-tauri/src/agent/manager.rs:392-399`

- **What this is:** `thread_working_path` uses the worktree if it exists, otherwise the main project path.
- **Problem:** If the worktree folder is deleted or moved, the chat silently runs in the main checkout. The agent can edit uncommitted files the user expected to be isolated.
- **Fix:** Return an error when a recorded worktree is missing, or recreate it. Do not fall back.
- **If we skip it:** Agent edits land in the wrong tree.

### 10. A failed thread save leaves an orphan worktree

**Location:** `src-tauri/src/agent/manager.rs:761-810`

- **What this is:** `agent_thread_create` creates the Git worktree before `save_threads`.
- **Problem:** If `save_threads` fails, the chat is not persisted, but the worktree stays on disk and in Git metadata. Example: disk full or read-only app-data folder.
- **Fix:** Persist the thread first, or remove the worktree when the save fails.
- **If we skip it:** Orphan worktrees accumulate and must be cleaned by hand.

### 11. Plugin import deletes the old plugin before writing the new one

**Location:** `src/lib/pluginRuntime.ts:2569-2576`

- **What this is:** Replacing a plugin runs `remove(destination, { recursive: true })` before writing the new files.
- **Problem:** If the write fails or Arc crashes after delete, the installed plugin is gone. A failed update should leave the old version intact.
- **Fix:** Write a temporary folder, then rename it over the old folder.
- **If we skip it:** A bad ZIP update can remove a working plugin.

### 12. Save temp file names can collide

**Location:** `src/App.tsx:3543`

- **What this is:** The temporary save path is `<file>.<Date.now()>.arc-tmp`.
- **Problem:** Two saves in the same millisecond use the same temp path. Example: Ctrl+S twice quickly, or save plus close. One save can fail or write stale content.
- **Fix:** Add a counter or random suffix to the temp name.
- **If we skip it:** Rare but real save errors or wrong file content.

### 13. Disabled AI providers still start

**Location:** `src/components/agents/AgentsWorkspace.tsx:133-137`

- **What this is:** When no enabled provider exists, `defaultProviderId` falls back to `state.providers[0]`.
- **Problem:** Disable every provider in Settings; Agents still starts the first one. The user disabled it, but a provider process runs.
- **Fix:** Require an enabled provider. Show an empty state instead of falling back.
- **If we skip it:** A process starts against user intent.

### 14. Live-reload fallback silently stops noticing files after 20,000 entries

**Location:** `src-tauri/src/lib.rs:3044-3090`

- **What this is:** `local_file_signature` returns early at 20,000 entries.
- **Problem:** On a large workspace, changes to files after the first 20,000 are invisible to the polling fallback. Live reload stops updating with no message.
- **Fix:** Document the limit as a `shortcut:` comment, or hash the whole tree in a stable order without the early return.
- **If we skip it:** Large projects get a silent, confusing live-reload failure.

## Nice to have

### 15. Dead settings remain in the settings schema

**Location:** `src/lib/settings.ts:92,96,193,197,372,389`

- **What this is:** `agentLastMode` and `agentDefaultPermissionMode` are defined, defaulted, and validated, but no UI or runtime code reads them.
- **Problem:** `agentDefaultPermissionMode` is typed as the literal `"supervised"`, so it cannot change. `agentLastMode` became dead after Agents moved to a tab.
- **Fix:** Remove both fields and their validation. Bump the settings version only if migration needs it.
- **If we skip it:** Future readers think these settings do something.

### 16. Two URL path encoders do the same job

**Location:** `src-tauri/src/lib.rs:2923`, `src-tauri/src/agent/ids.rs:92`

- **What this is:** `encode_url_path` and `percent_encode_path` use the same safe character set.
- **Problem:** Two implementations can drift. A path fix must be made twice.
- **Fix:** Keep one helper and call it from both places.
- **If we skip it:** Future URL bugs get fixed in one place only.

### 17. About 105 lines of dead CSS

**Location:** `src/components/agents/AgentsWorkspace.css:139-155,250-259,293-335,1195`, `src/components/PluginPanel.css:233-264`

- **What this is:** Classes such as `agents-conversation-header`, `agents-model-select`, `agents-thread-search`, `agents-stop`, and `plugin-view-grid` have no references in TSX or TS.
- **Problem:** They look active and make the stylesheet harder to read and change.
- **Fix:** Delete the unused blocks after one more whole-tree grep.
- **If we skip it:** Every CSS reader pays for code that cannot run.

## Recommended order

1. Fix finding 1: stop ignoring external file changes.
2. Fix finding 2: bound `plugin_process_exec` waits.
3. Fix findings 3 and 4: stop agent thread and memory leaks.
4. Fix finding 5: make trust real or remove it.
5. Fix security finding 7: block localhost Host rebinding and dotfiles.
6. Fix UI findings 8 and 13.
7. Fix data-safety findings 9, 10, 11, and 12.
8. Finish with findings 6, 14, and the lean cleanup.

## Verdict

Fix finding 1 first; it is a data-loss path. Fix finding 2 next; it can hang plugin commands. Then stop the agent thread and memory leaks.

## Lean

- About 110 lines can be removed.
- No unused dependencies found.

## Not checked

- All of `App.tsx` (6.2k lines), `pluginRuntime.ts` (4.7k lines), and `agent/manager.rs` (4.3k lines) were not read line by line.
- The desktop app was not run manually.
- Windows and macOS behavior was not tested.
- Provider flows were not exercised against real OpenCode, Codex, or Claude binaries.
