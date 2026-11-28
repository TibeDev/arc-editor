# AI Workspace Implementation Plan — Phase 1

Status: proposal only. No source code has been changed.

Date: 2026-11-28.

Scope: implement the Agents workspace in Arc with a Rust-owned `AgentManager`, OpenCode as the first provider, and an overlay UI. This plan covers Phase 1 only, divided into three milestones:

1. 1A — Foundation
2. 1B — OpenCode integration
3. 1C — Safety and reliability

Related research: `research/ai-workspace-research.md`.

## 0. Verification performed before planning

The following files were inspected:

- `src/App.tsx` — app shell, overlays, workspace switching, key handling, file watcher.
- `src/lib/settings.ts` — settings version 6, agent CLI settings, migration.
- `src-tauri/src/lib.rs` — Tauri commands, state management, terminal and process patterns.
- `src-tauri/src/process.rs` — process groups on Unix, job objects on Windows.
- `src-tauri/capabilities/default.json` — fs and URL scopes.
- `src-tauri/tauri.conf.json` — CSP and window configuration.
- `src/lib/agent/kit.ts` — existing one-shot Build-tab agent commands.
- `src/lib/pluginRuntime.ts` — plugin MCP client and server behavior.
- `src/styles/styles.css`, `src/components/ThemeMaker.tsx` — overlay pattern.
- `src/components/SettingsPanel.tsx` — settings UI conventions.

OpenCode verification:

- Installed version: `1.19.5`.
- Binary path: `/home/tibevdb/.local/share/mise/installs/opencode/latest/opencode`.
- `opencode serve --port 0 --hostname 127.0.0.1` prints the listening URL to stdout.
- `OPENCODE_SERVER_PASSWORD` enables Basic auth. The username is `opencode`. Requests without auth return `401`; correct auth returns `200`.
- One server serves multiple project directories through the `?directory=<absolute path>` query. Sessions created in two different temporary directories remained correctly scoped when listed.
- The legacy v1 session surface exists in 1.19.5: `/session`, `/session/{id}/prompt_async`, `/session/{id}/message`, `/session/{id}/abort`, `/session/{id}/permissions/{permissionID}`, `/permission`, `/question`, `/event`, `/session/status`, `/config/providers`, `/agent`, `/command`, and `/skill`.
- The v2 surface also exists: `/api/session`, `/api/session/{id}/prompt`, `/api/session/{id}/event?after=`, `/api/event`, `/api/model`, `/api/provider`, `/api/session/{id}/permission/...`, and `/api/question/...`.
- `POST /session` accepts the native permission ruleset `{permission, pattern, action}` and echoes it back.
- `/event` is an SSE stream. The v2 `/api/session/{id}/event` stream supports an `after` cursor.
- `/experimental/capabilities` only reports `backgroundSubagents`, so it is not useful for feature gating.

Decision: Phase 1 pins to the OpenCode `1.19.5` legacy v1 session surface behind an adapter. Reasons:

- The native permission ruleset is available at session creation.
- One `/event` stream carries session, message, permission, and question events.
- Transcript mapping is simpler than v2 projected events.
- The v2 surface remains available for a later adapter change without changing the UI or Rust contracts.

Corrections to assumptions in the research document:

- OpenCode is now `1.19.5`; the adapter must pin and probe a version.
- Server auth is Basic auth with `OPENCODE_SERVER_PASSWORD`. Arc must not run an unauthenticated server.
- A single server supports multiple project directories through the `directory` query.
- OpenCode's default permission policy allows most actions. A “supervised” label in Arc is not sufficient; the adapter must pass native OpenCode permission rules.

## 1. Locked architecture

```text
React overlay
  AgentsWorkspace -> agentsStore -> invoke/listen
        |
Rust AgentManager (owns state and provider lifecycle)
        |
ProcessManager (process groups / job objects)
        |
opencode serve (loopback, Basic auth, one server per provider instance)
```

Rules:

- AI project state is independent from the editor's workspace state.
- Rust owns projects, threads, runs, items, approvals, persistence, and provider processes.
- `App.tsx` owns only the `agentsOpen` UI boolean and the existing editor state.
- No chat state is stored in `App.tsx`.
- No projects, threads, runs, or messages are stored in `localStorage` or settings.
- Provider sessions are bound to threads. Switching provider requires a new thread.
- Conversations are never migrated between providers.
- No custom agent loop, scheduler, model client, or harness is built.
- Skills and MCP configuration remain OpenCode-native.

## 2. Milestone 1A — Foundation

Goal: persistent project registry, thread index, provider registry, overlay shell, and trust state. No OpenCode process calls yet.

### 2.1 Files

Create:

- `src-tauri/src/agent/mod.rs` — module exports.
- `src-tauri/src/agent/types.rs` — Rust structs and enums.
- `src-tauri/src/agent/store.rs` — JSON and JSONL persistence, atomic writes.
- `src-tauri/src/agent/manager.rs` — `AgentManager` state and commands.
- `src-tauri/src/agent/events.rs` — Tauri event names and payloads.
- `src/lib/agents/types.ts` — TypeScript mirrors of Rust types.
- `src/lib/agents/api.ts` — typed `invoke` wrappers and event subscriptions.
- `src/lib/agents/store.ts` — module-level store, no state library.
- `src/lib/agents/useAgentsStore.ts` — `useSyncExternalStore` hook.
- `src/components/agents/AgentsWorkspace.tsx` — overlay shell.
- `src/components/agents/AgentSidebar.tsx` — project rail and thread list.
- `src/components/agents/AgentConversation.tsx` — empty conversation state.
- `src/components/agents/AgentsWorkspace.css` — overlay layout.

Modify:

- `src-tauri/src/lib.rs` — declare `mod agent;`, manage `AgentManager`, register commands.
- `src/App.tsx` — lazy overlay, mode toggle, restore last mode, explicit open-project callback.
- `src/lib/settings.ts` — version 7, agent preferences, migration.
- `src/styles/styles.css` — `.agents-mode-active` hide rules matching the ThemeMaker overlay.
- `README.md` — mention Agents mode and `Ctrl+Shift+A`.
- `AGENTS.md` — update repository map and conventions after implementation.

No Tauri capability changes. No fs scope widening.

### 2.2 Backend changes

State:

```rust
pub struct AgentManager {
    store: AgentStore,
    providers: Mutex<Vec<AgentProviderInstance>>,
    server: Mutex<Option<ProviderServer>>, // unused in 1A
}
```

Commands:

```text
agent_project_list() -> AgentProject[]
agent_project_pick() -> Option<String>
agent_project_add(path) -> AgentProject
agent_project_remove(projectId)
agent_project_set_trust(projectId, trusted)
agent_provider_list() -> AgentProviderInstance[]
agent_thread_list(projectId?) -> AgentThreadSummary[]
agent_thread_create(projectId, providerInstanceId, model?) -> AgentThread
agent_thread_open(threadId) -> AgentThreadDetail
agent_thread_rename(threadId, title)
agent_thread_archive(threadId)
agent_thread_delete(threadId)
```

Rules:

- `agent_project_add` canonicalizes the path. It rejects files, missing paths, and empty paths.
- Adding an existing canonical path returns the existing project.
- Project identity is an ID plus canonical path; the path alone is not the key.
- `agent_project_remove` rejects removal while any thread has a running run. Otherwise it removes the project, its threads, and their JSONL files after confirmation.
- Thread creation requires `project.trusted == true`.
- `agent_thread_create` stores `providerInstanceId` permanently on the thread.
- No provider session ID is created in 1A.
- `agent_thread_delete` removes Arc data only in 1A. Provider session deletion is added in 1B/1C.

Provider seed:

```rust
AgentProviderInstance {
    id: "opencode-default",
    driver: "opencode",
    label: "OpenCode",
    binary_path: None,
    config_dir: None,
    created_at,
}
```

One provider instance exists on first run. No secrets are stored.

### 2.3 Data structures

Rust and TypeScript mirror each other and use camelCase over IPC:

```ts
type AgentProject = {
  id: string;
  path: string;
  name: string;
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
};

type AgentProviderInstance = {
  id: string;
  driver: "opencode";
  label: string;
  binaryPath?: string;
  configDir?: string;
  createdAt: string;
};

type AgentThread = {
  id: string;
  projectId: string;
  providerInstanceId: string;
  title: string;
  model?: { providerID: string; modelID: string };
  permissionMode: "supervised";
  nativeSessionId?: string;
  uiStatus: "idle" | "working" | "needs-input" | "done" | "error";
  createdAt: string;
  updatedAt: string;
  lastVisitedAt?: string;
  archivedAt?: string;
  pinnedAt?: string;
};

type AgentThreadSummary = Pick<
  AgentThread,
  | "id"
  | "projectId"
  | "providerInstanceId"
  | "title"
  | "model"
  | "uiStatus"
  | "updatedAt"
  | "archivedAt"
  | "pinnedAt"
>;

type AgentThreadDetail = {
  thread: AgentThread;
  runs: AgentRun[];
  items: AgentItem[];
  approvals: AgentApproval[];
};
```

### 2.4 Persistence

Path: Tauri app data directory + `agent/`.

```text
$APPDATA/dev.arc.ide/agent/
  projects.json
  providers.json
  threads.json
  threads/<threadId>.jsonl
```

File shape:

```json
{ "version": 1, "projects": [] }
{ "version": 1, "providers": [] }
{ "version": 1, "threads": [] }
```

Rules:

- Index writes are atomic: write a temp file, then rename.
- On Unix, the directory is mode `0700` and files are `0600`.
- JSONL is append-only per event, flushed after each append.
- A corrupt JSONL line is skipped with a warning; the file is preserved.
- A corrupt index is not overwritten. It is renamed to `.corrupt-<timestamp>` and an error is surfaced. No silent data loss.
- Schema versions migrate on load. Unknown future versions fail closed.
- No secrets are stored in any JSON file.

### 2.5 Frontend changes

`App.tsx`:

- Lazy import `AgentsWorkspace`.
- Add `agentsOpen` state only.
- Add `Ctrl+Shift+A` toggle.
- Restore `agentLastMode` after mount.
- Apply `agents-mode-active` to the app shell.
- Render the overlay after the ThemeMaker overlay.
- Pass editor context read-only:
  - `editorWorkspace`
  - `editorDirtyPaths`
- Pass explicit callbacks:
  - `onOpenProjectInEditor(path)`
  - `onCloseAgents()`

Explicit editor switch:

- Refactor the existing `openWorkspace` into `openWorkspaceAtPath(path?: string)`.
- The existing dialog path calls it with no argument.
- The Agents “Open in editor” action calls it with the AI project path.
- It still runs `requestWorkspaceAccess`, the dirty-save check, refresh, and reset.
- The editor workspace never changes automatically when the AI project changes.

Store:

- Module singleton.
- Loads projects, providers, and threads when the overlay first opens.
- Event listeners are registered once and are idempotent.
- No React context.
- No Zustand or other state library.

UI:

- The overlay includes its own `TitleBar`, matching `ThemeMaker`.
- Left rail: projects, add project, trust status, provider status.
- Middle: thread list for the active project, new chat.
- Right: empty conversation state until 1B.
- Trust dialog copy: “OpenCode will run commands with your OS user permissions. Project trust is consent, not a sandbox.”
- No fake permission chips yet.

Settings version 7 additions:

```ts
agentLastMode: "editor" | "agents";
agentDefaultProviderInstanceId: string;
agentDefaultPermissionMode: "supervised";
agentConfirmDirtyFiles: boolean;
agentNotifications: boolean;
```

Defaults: `editor`, `opencode-default`, `supervised`, `true`, `true`.

Migration validates values and fills defaults. No project or thread data is stored in settings.

### 2.6 Reused Arc functionality

- `workspace_pick` pattern for `agent_project_pick`.
- Existing `requestWorkspaceAccess` and workspace reset flow through `openWorkspaceAtPath`.
- ThemeMaker overlay pattern and CSS.
- Existing dialog and `TitleBar` components.
- Existing settings persistence and migration.
- `process.rs` is not used yet.

### 2.7 Dependencies

None new. No npm changes.

### 2.8 Tests

Rust unit tests:

- Canonicalize project path; reject file, missing, and empty paths.
- Duplicate project path returns the same project.
- Trust is required for thread creation.
- Thread is bound to the provider instance at creation.
- Atomic index write and reload.
- JSONL append and read round trip.
- Corrupt index is quarantined, not overwritten.
- Settings file never contains thread, project, or message data.
- Store path is under the app data directory.

Frontend:

- `npm run build` typecheck.
- Manual: toggle overlay; editor tabs, splits, and unsaved buffers remain intact; terminals keep running; settings persist; adding a project does not change the editor workspace.

### 2.9 Acceptance criteria

- Add, list, remove, and trust projects; state survives restart.
- Create multiple threads per project; the thread list shows the provider.
- Changing the AI project never switches the editor workspace.
- “Open in editor” is the only switch and is explicit.
- No agent conversations are stored in `localStorage` or settings.
- `App.tsx` contains no project, thread, or message state.
- `npm run build` and `cargo test` pass.

### 2.10 Regressions and risks

- Risk: workspace refactor changes existing open-folder behavior.
  - Mitigation: keep one shared function; manually test open folder, restore last workspace, and dirty-save cancel.
- Risk: settings version bump resets values.
  - Mitigation: explicit migration defaults and validation.
- Risk: overlay hides the editor and breaks window controls.
  - Mitigation: own `TitleBar`; manually test Linux, Windows, and macOS.
- Risk: lazy CSS causes a flash on first open.
  - Mitigation: add global hide rules in `styles.css`.

## 3. Milestone 1B — OpenCode integration

Goal: real conversation with OpenCode 1.19.5. Spawn the server, bind sessions, stream events, persist the Arc transcript, and resume history.

### 3.1 Files

Create:

- `src-tauri/src/agent/opencode.rs` — adapter, HTTP client, SSE reader, event mapping.
- `src-tauri/src/agent/provider_process.rs` — spawn, stop, health, and restart for one provider server.
- `src-tauri/src/agent/ids.rs` — random ID and password generation.
- `src/components/agents/AgentComposer.tsx`.
- `src/components/agents/AgentTranscript.tsx`.
- `src/components/agents/AgentMarkdown.tsx`.
- `src/components/agents/AgentStatusDot.tsx`.

Modify:

- `src-tauri/src/agent/types.rs` — add `AgentRun`, `AgentItem`, and provider status.
- `src-tauri/src/agent/manager.rs` — send, interrupt, models, commands, skills, history.
- `src-tauri/src/agent/store.rs` — run and item JSONL folding.
- `src-tauri/src/agent/events.rs` — run, item, and status events.
- `src-tauri/src/lib.rs` — register new commands.
- `src-tauri/Cargo.toml` — add direct `getrandom = "0.3"` for server password and IDs.
- `src/lib/agents/types.ts`, `api.ts`, `store.ts` — send, stream, history.
- `src/components/agents/AgentsWorkspace.tsx` — transcript and composer.
- `src/components/agents/AgentConversation.tsx` — thread header, model, stop.
- `README.md` — Agents mode usage and OpenCode requirement.

No Tauri capability change. All HTTP is Rust-side loopback.

### 3.2 Backend changes

Binary resolution:

1. Provider `binaryPath` if set.
2. Existing `find_executable("opencode")` (`src-tauri/src/lib.rs:1082`).
3. Bounded login-shell fallback: `$SHELL -lc 'command -v opencode'` with a 3-second timeout.
4. Fail with an actionable error: install OpenCode or set the binary path.

Version check:

- Run `opencode --version`.
- Require `>= 1.19.5` and `< 2.0.0` for Phase 1.
- Store the version in the provider runtime status.
- Do not auto-upgrade.

Server spawn:

```text
opencode serve --hostname 127.0.0.1 --port 0
```

Environment:

- `OPENCODE_SERVER_PASSWORD=<random 32 bytes hex>`
- No `--mdns`, no `0.0.0.0`.
- Inherit the system environment in 1B. Secret stripping lands in 1C.
- Reuse AppImage environment cleanup if needed.

Process ownership:

- Use `external_command` (`src-tauri/src/lib.rs:1755`) and `process::prepare_command`.
- Register the PID with `ProcessManager`.
- Stop: HTTP `/instance/dispose` best effort, then `ProcessManager.stop`.
- One provider server per provider instance. One server serves all project directories through `directory`.

Server startup:

- Parse the stdout line `opencode server listening on http://127.0.0.1:<port>`.
- Timeout after 15 seconds.
- Health check: `GET /global/health` with Basic auth.
- Keep port, password, and version in memory only.

Adapter endpoints, pinned to the 1.19.5 legacy surface:

```text
GET    /global/health
GET    /config/providers
GET    /provider
GET    /agent
GET    /command
GET    /skill
POST   /session?directory=<path>              body {title, model?, permission?}
PATCH  /session/{id}?directory=<path>         body {title?, time:{archived}}
GET    /session?directory=<path>&limit=...
GET    /session/{id}/message?limit=...
POST   /session/{id}/prompt_async?directory=<path>
POST   /session/{id}/abort?directory=<path>
DELETE /session/{id}?directory=<path>
GET    /event?directory=<path>                SSE
GET    /permission?directory=<path>
POST   /session/{id}/permissions/{permissionID}
POST   /question/{requestID}/reply
POST   /question/{requestID}/reject
```

Request mapping:

- Session create model: `{ providerID, id }`.
- Prompt model: `{ providerID, modelID }`.
- Prompt parts: `[{ type: "text", text }]`.
- Prompt uses `prompt_async`; the response includes the message ID.
- Store `nativeSessionId` on the first send. Do not create the provider session when the thread is created.

Event reader:

- One dedicated Rust thread per provider server.
- Use the global `/event` stream and filter by known session IDs. If directory-scoped streams are required per project, open one stream per active project. Verify during 1B.
- Parse SSE `data:` lines with `serde_json`.
- Reconnect with exponential backoff.
- Unknown event types are ignored and counted; they must not crash the reader.
- Events for unknown sessions are ignored.

Event mapping:

```text
session.status          -> thread uiStatus / provider status
session.idle            -> run finished, uiStatus = done/idle
session.error           -> error item + run failed
message.updated         -> create/update user or assistant item metadata
message.part.updated    -> text, tool, or reasoning item state
message.part.delta      -> text delta buffer
permission.asked        -> approval item
permission.replied      -> approval resolved
question.asked          -> question item
question.replied        -> question resolved
question.rejected       -> question resolved
session.compacted       -> info item
file.edited             -> optional file-change marker; no automatic reload
```

Transcript rules:

- Arc-normalized items are the display source of truth.
- The user item ID uses the OpenCode message ID from the `prompt_async` response.
- Provider echo events are de-duplicated by message ID and part ID.
- Tool item IDs use the provider call ID. A tool item starts as running and updates to success or failure.
- Reasoning text is stored but collapsed by default.
- Deltas are batched in Rust every 32 ms or 8 KB before a Tauri emit.
- There is no Tauri event per token.

History:

- On `agent_thread_open`, read the Arc JSONL.
- If the thread has a `nativeSessionId`, optionally fetch recent provider messages after reconnect to reconcile missed events.
- If the Arc JSONL is empty but the provider session exists, hydrate from provider messages and persist normalized items.
- If the provider session is missing, mark the thread as error and keep the Arc history.

Models, commands, and skills:

- `GET /config/providers` builds the model list for the picker.
- `GET /agent` builds the agent list. Phase 1 shows primary agents only.
- `GET /command` and `GET /skill` return provider-native entries for composer hints.
- Arc stores no skill definitions and no MCP configuration.
- MCP servers are whatever OpenCode's configuration loads. Arc injects no MCP server in Phase 1.

Commands added in 1B:

```text
agent_provider_status() -> ProviderStatus
agent_provider_start()
agent_provider_stop()
agent_model_list(providerInstanceId) -> AgentModel[]
agent_agent_list(providerInstanceId) -> AgentOption[]
agent_command_list(providerInstanceId) -> ProviderCommand[]
agent_skill_list(providerInstanceId) -> ProviderSkill[]
agent_thread_send(threadId, text, model?) -> runId
agent_thread_interrupt(threadId)
```

### 3.3 Data structures

Add:

```ts
type AgentRun = {
  id: string;
  threadId: string;
  status: "starting" | "running" | "waiting" | "completed" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  error?: string;
};

type AgentModel = {
  providerID: string;
  modelID: string;
  name: string;
  providerName: string;
};

type AgentItem =
  | { id: string; runId: string; kind: "user"; text: string; createdAt: string }
  | { id: string; runId: string; kind: "assistant"; text: string; reasoning?: string; createdAt: string }
  | {
      id: string;
      runId: string;
      kind: "tool";
      name: string;
      input: unknown;
      output?: unknown;
      status: "running" | "success" | "failed";
      createdAt: string;
    }
  | { id: string; runId: string; kind: "info"; text: string; createdAt: string }
  | { id: string; runId: string; kind: "error"; message: string; createdAt: string };
```

JSONL record shapes:

```json
{"type":"run","run":{}}
{"type":"item","item":{}}
{"type":"itemPatch","id":"...","patch":{"text":"...","status":"success"}}
```

The reader folds records in order.

### 3.4 Frontend changes

- Thread creation: choose project, provider, and model, then create the Arc thread.
- First send creates the provider session lazily.
- Composer: multiline text, Enter sends, Shift+Enter inserts a newline, stop button.
- `/` and `$` hints come from provider commands and skills. Insert text; do not reimplement invocation.
- Model picker per thread. A model change uses the same provider session; no migration.
- Provider picker is available only for new threads. The existing thread header shows the provider read-only.
- “New chat with another provider” creates a new thread in the same project.
- Transcript is windowed after 500 items.
- Status dots use theme slots and have accessible text labels.
- “Open project in editor” remains explicit.

Provider switching rules enforced in the store and Rust:

- `agent_thread_send` rejects if the thread's provider instance is not running.
- No command accepts a new provider for an existing thread.
- No migration command exists.
- The UI never rewrites `nativeSessionId` across providers.

### 3.5 Reused Arc functionality

- `process.rs` process groups and job objects.
- `external_command`, `find_executable`, and AppImage environment handling.
- Existing `ureq` and `serde_json`.
- Existing Tauri event channel.
- Existing theme and controls CSS.
- Existing terminal and PTY behavior, unchanged.

### 3.6 Dependencies

- Add direct Rust dependency `getrandom = "0.3"` for server password and IDs. It is already present in `Cargo.lock` transitively; no new dependency tree.
- No npm dependencies.
- No state library.
- No HTTP framework.
- No agent SDK.

### 3.7 Tests

Rust:

- Binary resolution: configured path, PATH, and missing binary.
- Version parser accepts `1.19.5`; rejects `1.18.x` and `2.x`.
- Server spawn against a fake server: parse listening URL, auth header, health.
- Mock OpenCode HTTP server:
  - Session create body and directory query.
  - Prompt body mapping.
  - Message list mapping.
  - Permission reply body.
  - SSE parse: text delta, tool called/success, idle, error, permission asked.
- Event batching: 100 deltas produce one emit.
- De-duplication: provider echo does not duplicate the user item.
- History: JSONL fold, missing session, corrupt line.
- Process: server stop kills the process group; app exit stops the server.
- Path: directory query is correctly encoded.
- Multi-project: two sessions in different directories through one server.

Frontend:

- `npm run build`.
- Manual stream test with real OpenCode and a real model.
- Manual restart Arc and open thread history.
- Manual interrupt.
- Manual model change.
- Manual provider switch creates a new thread and leaves the old thread untouched.

### 3.8 Acceptance criteria

- Detect and start OpenCode 1.19.5.
- Add a project, create multiple threads, send a prompt, and stream text and tool events.
- Interrupt stops the active run.
- Restart Arc; history remains visible and the native session ID is reused.
- Change the AI project without changing the editor workspace.
- Provider switch happens only through a new thread; no conversation migration.
- Skills and commands are read from OpenCode and shown as hints.
- MCP remains OpenCode-native; Arc modifies no MCP configuration.
- Process tree dies on stop and app exit.
- `npm run build` and `cargo test` pass.

### 3.9 Regressions and risks

- Risk: OpenCode API changes.
  - Mitigation: adapter isolation, version gate, fixture tests.
- Risk: GUI-launched Arc cannot find `opencode` from mise.
  - Mitigation: configured path, PATH, and bounded login-shell fallback.
- Risk: server logs leak prompts or secrets.
  - Mitigation: capture logs, redact, never persist raw logs.
- Risk: event flood freezes the UI.
  - Mitigation: Rust delta batching, transcript windowing, no per-token Tauri calls.
- Risk: duplicate transcript items.
  - Mitigation: provider message and part IDs plus idempotent store updates.
- Risk: editor and agent file race.
  - Mitigation: dirty guard lands in 1C; the existing `fs-changed` conflict banner remains.
- Risk: no frontend test runner.
  - Mitigation: `npm run build` plus a documented manual matrix.

## 4. Milestone 1C — Safety and reliability

Goal: native approvals and questions, supervised default, trust enforcement, dirty-file guard, crash recovery, safe rendering, and process cleanup.

### 4.1 Files

Create:

- `src/components/agents/AgentApprovalCard.tsx`.
- `src/components/agents/AgentQuestionCard.tsx`.
- `src/lib/agents/sanitize.ts` — link and markdown policy helpers.
- `src-tauri/src/agent/permissions.rs` — native OpenCode ruleset mapping and validation.
- `src-tauri/src/agent/recovery.rs` — startup reconciliation and stale-state repair.

Modify:

- `src-tauri/src/agent/opencode.rs` — permission and question replies, interrupt, error mapping, reconnect.
- `src-tauri/src/agent/provider_process.rs` — restart policy, offline state, graceful shutdown.
- `src-tauri/src/agent/manager.rs` — approval and question commands, startup recovery.
- `src-tauri/src/agent/store.rs` — approval and question records, interrupted run repair.
- `src-tauri/src/agent/types.rs` — approval and question types.
- `src-tauri/src/lib.rs` — recovery during setup, new commands.
- `src-tauri/Cargo.toml` — no new dependency expected.
- `src/lib/agents/types.ts`, `api.ts`, `store.ts` — approvals, questions, dirty guard, notices.
- `src/components/agents/AgentConversation.tsx` — approval and question cards.
- `src/components/agents/AgentComposer.tsx` — queue/steer hint, stop.
- `src/components/agents/AgentMarkdown.tsx` — safe markdown and link handling.
- `src/App.tsx` — pass dirty paths; explicit editor-open callback remains.
- `src/lib/settings.ts` — no new fields unless defaults change.
- `README.md`, `AGENTS.md` — security copy and agent workflow.

No Tauri capability widening. External links outside the allowlist show a copy fallback.

### 4.2 Backend changes

Supervised permissions:

- Use the OpenCode native v1 ruleset at session creation.
- Start with a tested allowlist of native actions only:

```text
edit, write, patch, bash, webfetch, external_directory, task, skill, question
```

- Default to `action: "ask"` for mutating, network, and shell actions.
- Do not expose generic Arc modes that OpenCode cannot enforce.
- The Phase 1 UI offers only “Supervised”.
- “Allow always” maps to OpenCode `always`, which stores a provider/project rule. Arc does not create its own persistent permission model.
- If OpenCode configuration has a `deny`, Arc cannot override it.
- Do not claim that Arc provides sandboxing.

Approvals:

- Provider `permission.asked` becomes an approval item and a Tauri `agent://approval-requested` event.
- Reply command:

```text
agent_approval_respond(approvalId, decision: "once" | "always" | "reject", feedback?)
```

- Map to `POST /session/{id}/permissions/{permissionID}` with body `{ response }`.
- Persist the approval until it is resolved.
- On restart, pending approvals are marked expired. The provider server restarts, so stale requests do not survive.
- The UI shows the command, path, or resource and a risk hint from provider metadata. No invented risk score.

Questions:

- Provider `question.asked` becomes a question item and `agent://question-requested`.
- Reply or reject through native OpenCode question endpoints.
- Never answer questions automatically.

Project trust:

- `agent_thread_create` and `agent_thread_send` reject untrusted projects.
- The trust prompt states that child processes use OS user permissions.
- Revoking trust blocks new runs. Running runs are not silently killed; show a warning instead.

Dirty-file guard:

- The frontend checks only when the AI project path equals `editorWorkspace`.
- If `editorDirtyPaths.length > 0` and `agentConfirmDirtyFiles` is true, show: Save all / Cancel / Send anyway.
- The default action is Save all, implemented through the existing save path.
- If the AI project differs from the editor workspace, no dirty guard is shown.
- No automatic editor project switch.

Environment and secrets:

- Arc-owned secrets are never stored in agent JSON.
- Provider credentials remain OpenCode-owned.
- Spawn environment strips known foreign credentials unless the provider instance explicitly allows them:
  - `ANTHROPIC_*`, `OPENAI_*`, `GEMINI_*`, `GOOGLE_*`, `GITHUB_TOKEN`, `GH_TOKEN`, `AWS_*`, `AZURE_*`, `*_API_KEY`.
- Never log environment values.
- Do not log prompts or full tool outputs at info level.

Safe rendering:

- `react-markdown` without `rehype-raw`. No `dangerouslySetInnerHTML`.
- Block `javascript:`, `data:`, and `file:` links.
- HTTP(S) links open through the existing `open_external_url`; if the host is outside the capability allowlist, show a copy-link fallback.
- Code blocks are rendered as text only.
- Agent output cannot execute scripts.

Crash recovery:

- On startup, scan `threads.json` and JSONL.
- Any run in `starting`, `running`, or `waiting` becomes `stopped` with the error “Arc restarted while the agent was running”.
- Any thread in `working` becomes `idle` or `error` based on the last run.
- Pending approvals become expired.
- Orphan provider servers are owned by `ProcessManager`; none survive app exit. Startup also checks port and process registry consistency and stops stale servers.
- Lost effects are not replayed.

Provider reliability:

- Health check before send.
- If the server dies during a run, mark the run failed, mark the thread error, and emit `agent://provider-status`.
- Restart on the next explicit send with backoff. No automatic restart during an active approval or run.
- Maximum 3 restart attempts per 60 seconds.
- Show an actionable error with the OpenCode version and path.

Performance limits:

- Phase 1 does not enforce a hard session cap; OpenCode queues sessions. Expose the active run count.
- Cap the transcript in memory per thread at 2,000 items; older items remain on disk.
- Cap JSONL line size. Oversized provider payloads produce an error item.
- Retry and reconnect SSE with backoff; no busy loop.

Commands added in 1C:

```text
agent_approval_respond(approvalId, decision, feedback?)
agent_question_respond(questionId, answers)
agent_question_reject(questionId)
agent_reconcile()
agent_provider_restart()
```

### 4.3 Data structures

Add:

```ts
type AgentApproval = {
  id: string;
  threadId: string;
  runId: string;
  providerRequestId: string;
  title: string;
  detail: string;
  action?: string;
  resources?: string[];
  decision?: "once" | "always" | "reject" | "expired";
  createdAt: string;
  resolvedAt?: string;
};

type AgentQuestion = {
  id: string;
  threadId: string;
  runId: string;
  providerRequestId: string;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
    multiple?: boolean;
  }>;
  answers?: unknown;
  status: "pending" | "answered" | "rejected" | "expired";
  createdAt: string;
};
```

JSONL additions:

```json
{"type":"approval","approval":{}}
{"type":"approvalResolved","approvalId":"...","decision":"once"}
{"type":"question","question":{}}
{"type":"questionResolved","questionId":"...","status":"answered"}
```

### 4.4 Reused Arc functionality

- Existing `ProcessManager` shutdown on `RunEvent::Exit` in `src-tauri/src/lib.rs`.
- Existing `fs-changed` watcher and disk-conflict banner for same-workspace edits.
- Existing notification preference and duration.
- Existing `open_external_url` command.
- Existing `react-markdown` and `remark-gfm`.
- Existing theme slots for warning, error, and success.

### 4.5 Dependencies

None expected.

### 4.6 Tests

Rust:

- Permission ruleset shape exactly matches the OpenCode 1.19.5 schema.
- Approval reply mapping for `once`, `always`, and `reject`.
- Question reply and reject mapping.
- Untrusted project rejects create and send.
- Startup repair: running becomes stopped, working becomes idle or error, approvals become expired.
- Server crash marks the run failed instead of hanging.
- Restart backoff and maximum attempts.
- Environment stripping: secret names are absent from the spawned environment.
- Logs contain no prompt text, password, or environment values.
- Oversized event or line is rejected safely.
- Process tree kill includes grandchildren; extend the existing test.
- Concurrent send on one thread is serialized; the second send queues or rejects with a clear message.
- Interrupt during approval does not corrupt state.

Frontend:

- `npm run build`.
- Markdown test payload with `<script>`, raw HTML, `javascript:`, `data:`, `file:`, and an external `https` link.
- Manual approval: allow once, allow always, deny.
- Manual question: answer and reject.
- Manual dirty-file guard: save all, cancel, send anyway.
- Manual editor integrity: tabs, splits, unsaved buffers, and terminal scrollback survive overlay toggling.
- Manual restart during a run; the UI shows interrupted state, not a stuck “working” state.
- Accessibility: approval buttons are keyboard reachable, status dots have labels, focus order is correct.

### 4.7 Acceptance criteria

- Approvals work with native OpenCode replies.
- Questions work or can be rejected.
- The default state is supervised through native OpenCode rules.
- Project trust is required and revocable.
- Trust UI says it is not a sandbox.
- Dirty-file guard prevents silent overwrite when the AI project equals the editor workspace.
- Agent markdown cannot execute HTML or unsafe links.
- Restart repairs interrupted runs and leaves no orphan provider processes.
- Provider crash shows an error and does not hang the thread.
- No secrets are present in agent data files.
- `npm run build` and `cargo test` pass.
- Existing editor behavior is unchanged.

### 4.8 Regressions and risks

- Risk: OpenCode permission ruleset names change.
  - Mitigation: `permissions.rs` maps only tested names; fixture test against 1.19.5; fail with a clear message.
- Risk: “Supervised” is interpreted as a sandbox.
  - Mitigation: UI and README copy state that these are provider-enforced approvals, not OS isolation.
- Risk: the dirty-save path changes editor behavior.
  - Mitigation: reuse the existing save function; manually test cancel.
- Risk: environment stripping breaks users who rely on provider environment auth.
  - Mitigation: provider instance explicit environment allowlist in a later milestone; document behavior. Phase 1 can warn about missing credentials.
- Risk: in-app notices are missed while the editor is open.
  - Mitigation: overlay badges plus the existing notifications preference; OS notifications are deferred.
- Risk: approval persistence across restart is unreliable because provider requests die with the server.
  - Mitigation: mark expired and never replay stale approvals.

## 5. Cross-cutting decisions and non-goals

### 5.1 Decisions fixed by this plan

- The Agents workspace is an overlay, not an editor tab, sidebar, or plugin view.
- The Rust `AgentManager` owns all agent state.
- OpenCode 1.19.5 is the first and only Phase 1 provider.
- The OpenCode legacy `/session` v1 surface is used behind the adapter.
- One provider server serves many project directories.
- Provider switching creates a new thread. No migration.
- Conversations are persisted in app data JSON and JSONL, never in localStorage or settings.
- Project trust is consent, not a sandbox.
- Skills and MCP stay OpenCode-native. There is no Arc skill system and no Arc MCP injection.
- There is no custom agent harness, scheduler, model client, or plugin API for agents.
- There is no separate Tauri window, no worktrees, no diff/checkpoint UI, and no chat search in Phase 1.

### 5.2 Explicit non-goals for Phase 1

- Auto-approve or full-access modes.
- Provider switching inside an existing thread.
- Multi-provider adapters.
- Worktree per thread.
- A separate Agents window.
- Arc MCP server injection.
- Cloud sync, remote execution, or multi-device support.
- Automatic OpenCode installation or upgrade.
- Tiled chat layout.

## 6. Approval required before implementation

1. Confirm the legacy OpenCode `/session` v1 surface for Phase 1. The v2 `/api` surface remains future work.
2. Confirm the direct Rust dependency `getrandom` for server password and IDs.
3. Confirm that Phase 1 exposes only native “Supervised” permissions, with no auto or full-access UI.
4. Confirm that provider switching requires a new thread.
5. Confirm that there is no Arc MCP injection in Phase 1.

No source code has been modified.
