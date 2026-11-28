# AI Workspace Research: Multi-Agent Project Management for Arc Editor

Status: research only. No product code changed.
Date: 2026-11-28.
Scope: add an AI workspace to Arc that lists local projects, manages multiple agent conversations per project, switches providers, and stays independent of the editor's currently open workspace.

Evidence key used throughout:

- **[V] Verified**: read from Arc or T3 Code source, or from official provider documentation.
- **[R] Recommendation**: design or engineering proposal, not implemented.
- **[?] Unresolved**: needs a product decision, a provider test, or a spike.

---

## 1. Executive summary

Arc today is a single-workspace desktop IDE. It has a file tree, CodeMirror editor with splits, a PTY terminal, a GitHub panel, a web preview, a plugin system, and a settings/theme builder. It has no project registry, no conversation store, and no agent session manager. Its only agent integration is the Build tab, which launches a one-shot CLI command in a terminal. **[V]**

T3 Code is the closest reference implementation. It separates execution from clients: a server owns provider processes, terminals, Git, checkpoints, and durable state; web, desktop, and mobile clients talk to it over authenticated RPC; providers sit behind an adapter that declares capabilities. The orchestration pipeline is command → orchestrator decision → event commit → effect worker → provider adapter. **[V]**

The provider landscape is uneven:

- **OpenCode** exposes a rich local HTTP API for sessions, permissions, events, PTYs, worktrees, forks, and compaction. It is the easiest backend for a Rust/Tauri app, but the API is marked experimental. **[V]**
- **Codex** exposes an app-server JSON-RPC protocol and ships as a Rust binary. T3 Code generates a client for it. No Node runtime is required. **[V]**
- **Claude Code** can stream structured output headlessly, but persistent chat, approvals, and resume are easiest through the Agent SDK or the ACP wrapper, both of which are Node-based. **[V]**
- **Cursor** ships a Node SDK; ACP is an alternative. **[V]**
- **ACP** covers Claude, Codex, Cursor, OpenCode, Gemini, Copilot, Goose, and many others, but adapters have mixed runtimes and uneven capability coverage. **[V]**

**Recommended approach [R]:** build a first-class **Agents workspace** in Arc, backed by a Rust-owned `AgentManager`, with **OpenCode as the first provider**. Keep the editor mounted under an overlay (or use a separate Tauri window later). Model data as project → thread → run/turn → item, persist it outside settings, default to supervised permissions, and treat approvals and diffs as v1 features. Do not build an agent loop, do not put orchestration in React, and do not make ACP the first integration.

**Why:** it respects Arc's actual constraints (Rust backend, no Node dependency, monolith UI, existing PTY/process primitives), it gives real functionality with one provider, and it leaves a clean path to Codex, Claude, and ACP.

**Biggest risks [R]:** OpenCode's experimental API, provider process ownership and cleanup, editor/agent file races, the Node dependency for Claude/Cursor/ACP, and the temptation to store conversations in settings/localStorage.

---

## 2. Existing Arc Editor architecture

### 2.1 Stack and repository shape

| Item | Value | Evidence |
|---|---|---|
| Package | `arc-ide` 0.1.4-beta.4 | `package.json` |
| Desktop shell | Tauri 2 | `src-tauri/tauri.conf.json` |
| Frontend | React 19, TypeScript strict, Vite 6 | `package.json` |
| Editor | CodeMirror 6 | `src/App.tsx` |
| Terminal | rioterm (WASM) + portable-pty | `src/components/TerminalView.tsx`, `src-tauri/src/lib.rs` |
| Backend | Rust, all commands in `src-tauri/src/lib.rs` | `src-tauri/src/lib.rs` |
| Process registry | `src-tauri/src/process.rs` | process groups / Windows job objects |
| Settings | `localStorage`, versioned shape | `src/lib/settings.ts:94` |
| Plugins | JS runtime, built-in and ZIP-imported | `src/lib/pluginRuntime.ts` |
| Tests | Rust unit tests in `lib.rs`; no frontend runner | `AGENTS.md` |

### 2.2 Current render tree

```text
main.tsx
└─ App.tsx
   └─ <main class="app-shell ...">
      ├─ TitleBar (custom window controls, resize handles)
      ├─ app-body
      │  ├─ file explorer sidebar (resizable, persisted width)
      │  ├─ editor-root
      │  │  ├─ editor-content
      │  │  │  └─ SplitContainer / EditorPane (tabs, CodeMirror, terminals,
      │  │  │     GitHub panel, plugin views, previews, Build panel)
      │  │  ├─ plugin status bar
      │  │  ├─ editor-footer (toolbar buttons)
      │  │  └─ toast message
      │  ├─ context menu
      │  └─ command palette overlay
      ├─ SettingsPanel overlay
      └─ ThemeMaker overlay
```

Key facts:

- `App()` starts at `src/App.tsx:1740`. It owns workspace, open files, tabs, groups, layout, and terminals. **[V]**
- The editor root is rendered at `src/App.tsx:5813`. **[V]**
- `EditorPane` (`:1015`) and `SplitContainer` (`:1636`) implement tabs and nested splits. **[V]**
- Tabs are string keys. Internal panels are editor tabs, not separate surfaces: `internal:github`, `internal:plugins`, `internal:builder`, `internal:preview:*`, plugin view keys. **[V]** (`src/App.tsx:1395-1421`, `:1564-1575`)
- Workspace state is a single path. The last workspace is restored from `localStorage` (`arc.lastWorkspace`, `src/App.tsx:3307-3337`). There is no project list. **[V]**
- File contents live in `fileContents` ref; tab/dirty state lives in React state (`src/App.tsx:1763-1764`). **[V]**
- External disk changes are detected through `fs-changed` and surfaced as a conflict banner (`src/App.tsx:2696`, `:1551`). **[V]**

### 2.3 Backend commands relevant to agents

| Command | Role | Evidence |
|---|---|---|
| `terminal_spawn` | PTY shell, optional cwd, optional command written after spawn | `src-tauri/src/lib.rs:275` |
| `terminal_write`, `terminal_resize`, `terminal_close` | PTY lifecycle | `src-tauri/src/lib.rs:450`, `:466`, `:492` |
| `workspace_pick`, `workspace_access_allowed`, `workspace_grant_access` | Folder picker and runtime fs scope grant | `src-tauri/src/lib.rs:520`, `:577`, `:585` |
| `watch_project`, `unwatch_project` | Debounced file watcher, `fs-changed` events | `src-tauri/src/lib.rs:3374` |
| `plugin_process_spawn`, `plugin_process_exec` | Arbitrary child process with stdout/stderr streams or bounded exec | `src-tauri/src/lib.rs:764`, `:978` |
| `plugin_secret_set/get/delete` | OS keyring | `src-tauri/src/lib.rs:1543-1572` |
| `open_external_url` | Opens http(s) URLs; Tauri capability restricts allowed hosts | `src-tauri/src/lib.rs:2404` |

Process ownership:

- Unix: child is placed in its own process group (`process_group(0)`), and stop signals the negative PID, so grandchildren in the group die. **[V]** (`src-tauri/src/process.rs:28`, `:187`)
- Windows: job object, terminated as a unit. **[V]** (`src-tauri/src/process.rs:244-299`)
- This is a strong base for agent process trees, but agents that call `setsid` or escape the job can still evade it. **[R]**

### 2.4 Security posture

| Control | Current state | Evidence |
|---|---|---|
| CSP | `null` | `src-tauri/tauri.conf.json:26` |
| FS scope | `$HOME`, `$DOCUMENT`, `$DOWNLOAD`, `$APPDATA` | `src-tauri/capabilities/default.json` |
| Runtime workspace grant | Canonicalize and add directory to fs scope | `src-tauri/src/lib.rs:585` |
| URL opening | Tauri opener allowlist: loopback, github.com, cli.github.com, git-scm.com | `src-tauri/capabilities/default.json` |
| Secrets | OS keyring for plugin secrets | `src-tauri/src/lib.rs:1543` |
| Process kill | Process group / job object | `src-tauri/src/process.rs` |
| Local HTTP server | Loopback, path traversal checks, no framing headers | `src-tauri/src/lib.rs` |

Consequences for agents:

- The fs scope constrains Arc's plugin-fs calls, **not** child processes. A CLI agent runs with the user's OS permissions and can read `.env`, SSH keys, and anything else. Workspace gating is consent, not a sandbox. **[V/R]**
- CSP `null` means any raw HTML injected into the app can run with app privileges. Agent output must not be rendered as raw HTML. **[V/R]**
- `open_external_url` accepts any http(s) in Rust, but the capability allowlist blocks most external hosts. Chat links to provider docs or pull requests will fail unless the allowlist is expanded deliberately. **[V]**

### 2.5 Existing agent support

- Settings already has `agentCli` (`opencode | claude | codex | custom`) and `agentCommand` (`src/lib/settings.ts:90-91`, default OpenCode). **[V]**
- The Build tab builds one-shot commands: `opencode --prompt "..."`, `claude "..."`, `codex "..."`, or a custom template (`src/lib/agent/kit.ts:5-64`). **[V]**
- This is not a conversation manager. It has no session, streaming events, approvals, resume, or per-project history. **[V]**

### 2.6 Extension points and limits

| Extension point | Suitable for agents? | Reason |
|---|---|---|
| Internal editor tab | No | Tied to the workspace tab strip; conflicts with file tabs. **[V]** |
| Editor split pane | No | Still inside the workspace; cannot show an independent project list. **[V]** |
| Plugin custom tab | No | Renders as an editor tab; plugin views are not independent windows. **[V]** |
| Plugin sidebar/bottom view | No (currently) | Registration funnels into `panels`; App renders panels as custom tabs. No distinct sidebar/bottom renderer was found. **[V]** |
| Settings/ThemeMaker overlay | Yes, pattern reuse | Fixed overlay, hides app body with `visibility:hidden` (`src/styles/styles.css:1134`). **[V]** |
| Separate Tauri window | Possible, not built | Needs new window config, capability scope, shared Rust state. **[?]** |

---

## 3. T3 Code architecture analysis

T3 Code is MIT licensed (`LICENSE`). It is the best available reference for the orchestration and session model, but it is a Node/Electron product and must not be copied wholesale into Arc. **[V]**

### 3.1 Ownership boundaries

```text
┌──────────────────────────── clients ────────────────────────────┐
│ web / desktop (Electron) / mobile                               │
│ UI + client-runtime state + connection supervisor               │
└───────────────────────────────┬─────────────────────────────────┘
                                │ authenticated typed RPC
┌───────────────────────────────▼─────────────────────────────────┐
│ server                                                          │
│ projects, threads, provider sessions, terminals, Git,           │
│ checkpoints, durable projections, MCP endpoint                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ adapter boundary
┌───────────────────────────────▼─────────────────────────────────┐
│ providers: Codex app-server, Claude, Cursor SDK, OpenCode,      │
│ ACP registry/local ACP commands, Pi, Grok, Kiro, Muse, fx       │
└─────────────────────────────────────────────────────────────────┘
```

Verified points:

- The server owns provider processes, terminals, Git, checkpoints, durable state, and project files. Clients must not substitute their own filesystem or credentials. **[V]** (`docs/internals/01_architecture.md:5-11`)
- Desktop bundles a server, but the renderer follows the same boundary. **[V]** (same doc)
- Contracts are the typed wire boundary. **[V]** (same doc)
- Provider-specific protocols stay behind an adapter; orchestration reads capabilities, never provider names. **[V]** (`docs/internals/03_providers.md:1-8`)

### 3.2 Orchestration pipeline

```text
client command
   │
   ▼
Orchestrator (serializes commands, decides events, no I/O)
   │
   ▼
EventSink (commit events + projections + receipts + outbox in one transaction)
   │
   ▼
EffectWorker (runs side effects after commit, feeds results back as commands)
   │
   ▼
Provider adapter (open/resume session, start turn, stream events, approvals)
```

Verified points:

- Orchestration state is decided as events; persisted projections are the source of truth once applied. **[V]** (`docs/internals/01_architecture.md:24-40`)
- External I/O never runs in command decisions or the DB transaction. **[V]** (same doc)
- Effects tied to a lost provider process are retired on recovery, not replayed. **[V]** (same doc)
- The event log has a bounded replay window; projections cannot be rebuilt from scratch from the log. **[V]** (`01_architecture.md:44-48`)
- A provider turn ending and follow-up work settling (checkpoints, diffs, PR sync) are separate milestones. **[V]** (`01_architecture.md:52-62`)
- Checkpoints use hidden Git refs; reverting coordinates workspace state with provider conversation state. **[V]** (`01_architecture.md:64-70`)
- Thread settlement is server-owned. **[V]** (`01_architecture.md:72`)

This is **not** classic whole-app event sourcing. It is durable intent plus persisted projections with a bounded log. Use that nuance; do not copy "event-source everything" into Arc. **[R]**

### 3.3 Provider adapter model

- `ProviderAdapterV2` is the adapter boundary. **[V]** (`packages/provider-core/src/server/ProviderAdapter.ts`)
- Session statuses are exactly `starting`, `ready`, `running`, `waiting`, `stopped`, `error`. **[V]** (`ProviderAdapter.ts:91-99`)
- Turn messages carry message ID, text, attachments, creator, creation source, scheduled task, sender thread. **[V]** (`ProviderAdapter.ts:80-89`)
- Adapter errors are typed: capabilities, open/close session, resume, thread-in-use, ensure thread, snapshot, rollback, fork, turn start, steer, interrupt, runtime request, event stream, protocol, session stopped. **[V]** (`ProviderAdapter.ts:400-565`)
- Capabilities are declared; unsupported fork/rollback/steer/subagent features must be disabled so orchestration degrades cleanly. **[V]** (`docs/internals/03_providers.md:42-50`)
- Do not emulate missing permission modes; pass native approval and question IDs through; every request can be declined. **[V]** (same doc)
- Startup phases come from real signals, not timers. **[V]** (same doc)
- Health checks must be passive; they must not start MCP servers, hooks, or login flows. **[V]** (`03_providers.md:64-70`)
- Attachments stay outside the project workspace. **[V]** (same doc)
- Provider instances, not driver kinds, own session state, catalogs, and credentials. Ambient credentials the instance did not configure are stripped. **[V]** (`03_providers.md:10-13`)

### 3.4 ACP policy

- Generic ACP registry agents and local ACP commands follow the ACP spec strictly. **[V]** (`03_providers.md:14-21`)
- No agent-ID checks, vendor extensions, or driver-specific workarounds in the shared ACP adapter. **[V]** (same doc)
- Dedicated ACP flavors are reserved for first-party drivers that need behavior outside ACP; native `ProviderAdapterV2` adapters are only for non-ACP protocols. **[V]** (same doc)
- ACP v2 preview is negotiated when supported; otherwise v1. **[V]** (`docs/user/providers-acp.md:3`)
- Registry installs run on the server, with SHA-256 verification when provided. **[V]** (`providers-acp.md:17-19`)

### 3.5 Sessions, idle release, process ownership

- `ProviderSessionManagerV2` owns session runtimes. **[V]** (`apps/server/src/orchestration-v2/ProviderSessionManager.ts:323`)
- It supports idle timeouts and release/resume. A released session without native resume returns as a summary of the thread, so it stays longer. **[V]** (`ProviderSessionManager.ts:82`, `:582`, `:1733`, `:1803`)
- ACP runtime uses Linux cgroup v2 leases when available; otherwise process-tree handling. **[V]** (`packages/provider-acp/src/server/AcpSessionRuntime.ts:266-551`)
- Codex uses a shared app-server keyed by `CODEX_HOME`; a conflict is reported if another process owns it. **[V]** (`apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts:468`, `:631`)
- Claude adapter notes that it captures output inline rather than a shared app-server. **[V]** (`ClaudeAdapterV2.ts:1113`)

### 3.6 T3 UI model

```text
┌──────────────────────────── T3 web/desktop ────────────────────────────┐
│ sidebar (resizable, collapsible)        │ main surface                │
│  search                                 │  thread view                │
│  Pinned                                 │   header: project/branch    │
│  Active / Working                       │   message stream            │
│  project folders (collapsible)          │   approvals / questions     │
│    thread cards                         │   composer + model picker   │
│  Snoozed / Settled                      │  right panel: diff, preview,│
│  settings / account                     │  terminal, subagents        │
└─────────────────────────────────────────┴─────────────────────────────┘
```

Verified points:

- Sidebar supports search, pinned/active/working/snoozed/settled sections, project folders, thread cards, drag-and-drop, context menus. **[V]** (`apps/web/src/components/Sidebar.tsx`, `components/sidebar/SidebarProjectFolderHeader.tsx`, `SidebarThreadRow.tsx`)
- Project folder header shows favicon, name, status dot, hidden count, chevron, and a new-thread button. **[V]** (`SidebarProjectFolderHeader.tsx:45-130`)
- Thread rows show title, status/meta, provider/model, branch, time. **[V]** (`SidebarThreadRow.tsx`)
- Main surface is a thread route (`ChatView`) with composer, approvals, diffs, terminal/preview panels. **[V]** (`apps/web/src/components/ChatView.tsx`, `ThreadRouteView.tsx`)
- Index route starts a draft in the most recent project or shows a no-projects hero. **[V]** (`apps/web/src/routes/_chat.index.tsx`)
- Command palette searches threads by title, branch, PR, project, and message contents. **[V]** (`docs/user/thread-sidebar.md:80-86`)
- Thread lifecycle includes settle, snooze, archive, pin, working section, auto-settlement, and worktree cleanup. **[V]** (`docs/user/thread-sidebar.md:22-70`)

### 3.7 T3 data model, simplified

| Entity | Key fields | Evidence |
|---|---|---|
| Project | ID, path, name, repositories, settings | `docs/user/project-settings.md`, `multi-repo-projects.md` |
| App thread | ID, project ID, title, provider instance, model selection, runtime/interaction mode, branch, worktree path, PR links, lineage/fork origin, archived/settled/snoozed/pinned timestamps, last visited | `packages/contracts/src/orchestrationV2.ts:501-590` |
| Provider thread | Provider-native thread binding | `orchestrationV2.ts:1264-1299` |
| Run | Turn execution record | `orchestrationV2.ts` event/run types |
| Projected turn item | Position, visibility, source thread, source item, item payload | `orchestrationV2.ts:2177-2184` |
| Thread transcript | Items array | `orchestrationV2.ts:2383-2389` |
| Thread shell | Sidebar summary | `orchestrationV2.ts:2418-2504` |

### 3.8 What to reuse in Arc

| Reuse | Why |
|---|---|
| Server/Rust owns execution | Webview reloads and UI crashes must not own agent processes. |
| Project → thread → run → item model | Needed for approvals, resume, diffs, checkpoints, search. |
| Capability-driven adapter boundary | Prevents UI from assuming features a provider lacks. |
| Provider instance model | Multiple accounts/config dirs must not share mutable state. |
| Session manager with idle release/resume | Agent processes are heavy; cap concurrency. |
| Typed normalized event stream | UI should not parse provider-specific protocols. |
| Process-tree ownership | Arc already has process groups/job objects; use them. |
| Supervised permissions + approvals | Safety and user trust. |
| Durable intent + projections (scoped) | Crash recovery and correct status without replaying everything. |

### 3.9 What not to copy

| Avoid | Why |
|---|---|
| Full Effect/TS service framework | Arc is Rust + React; do not add a second runtime model. |
| Whole-app event sourcing | T3 uses bounded replay + projections, not full rebuild. Arc needs a smaller version. |
| Electron server-first multi-surface split | Arc is a single Tauri app; do not build a remote server product first. |
| Oversized capability schema on day one | Start with the capabilities the first two providers actually need. |
| ACP Registry auto-install | Third-party code and supply-chain risk; require consent/checksums or skip. |
| Provider workarounds in a shared adapter | Let unsupported features degrade; do not fake them. |
| Per-thread worktree + auto PR as v1 | Worktrees are useful later; auto-PR is not verified as a T3 behavior. |
| Splitting `App.tsx` for this feature | Keep the monolith; isolate the new surface in its own component/store. |
| Provider process lifecycle in the webview | Wrong ownership boundary. |

---

## 4. Provider integration comparison

### 4.1 Integration shapes

```text
A. Native protocol (preferred for Arc where available)
   Arc Rust ──stdio/JSON-RPC/HTTP──> provider binary

B. ACP adapter
   Arc Rust ──stdio JSON-RPC (ACP)──> adapter process ──> provider

C. PTY / terminal wrapper
   Arc Rust ──PTY──> provider CLI ──ANSI/OSC──> UI

D. Embedded SDK
   Arc Rust ──sidecar──> Node/Python SDK ──> provider
```

### 4.2 Comparison

| Provider | Transport / runtime | Structured streaming | Approvals | Resume / fork | MCP | Skills | Node dependency | Arc fit |
|---|---|---|---|---|---|---|---|---|
| **OpenCode** | Local HTTP API; Go binary; sessions, events, permissions, PTY, worktree, fork, compact | Yes | Yes, permission API | Yes (sessions, fork) | Provider config | Provider-owned | No | **Best first provider** |
| **Codex** | App-server JSON-RPC; Rust binary; T3 generates a client | Yes | Yes (native approval modes) | Yes (native threads) | Provider config / OAuth | `.codex/skills` | No | **Strong second** |
| **Claude Code** | CLI `-p` + `stream-json`, Agent SDK, or ACP wrapper | Yes | Via SDK callback / permission prompt tool / ACP | Yes (`--resume`, session IDs) | OAuth flows | `.claude/skills` | Likely (SDK/ACP) | Later; hardest |
| **Cursor** | `@cursor/sdk` or ACP | Yes | SDK / ACP | SDK-dependent | `~/.cursor/mcp.json` | Cursor-owned | Yes (SDK) | Later |
| **Gemini CLI** | ACP | Yes | ACP | ACP-dependent | ACP/provider | Provider-owned | Yes (Node CLI) | Via ACP |
| **GitHub Copilot CLI** | ACP | Yes | ACP | ACP-dependent | Provider | Provider-owned | Yes | Via ACP |
| **Goose / others** | ACP | Varies | ACP | Varies | ACP | Provider-owned | Mixed | Via ACP |

Notes:

- The ACP registry officially lists Claude Agent, Codex, Cursor, OpenCode, Gemini CLI, GitHub Copilot, Goose, Amp, Cline, Qwen, Kiro, and many others. **[V]** (https://agentclientprotocol.com/get-started/registry)
- ACP v2 preview is negotiated; v1 fallback exists. Capability differences are real. **[V]** (T3 `providers-acp.md`)
- OpenCode's API is explicitly labeled an experimental HTTP API surface. Pin the binary version and tolerate breaking changes. **[V]** (https://opencode.ai/docs/server/)
- Claude Code headless supports `-p`, `--output-format stream-json`, `--include-partial-messages`, `--resume`, `--permission-mode`, and `--permission-prompt-tool`. **[V]** (https://code.claude.com/docs/en/headless)
- Codex app-server is verified in T3 source (`CodexAdapterV2.ts:97`, generated package `packages/effect-codex-app-server`); it is the upstream OpenAI Codex app-server protocol. **[V]**

### 4.3 Provider strategy recommendation

1. **OpenCode first.** It gives the most complete session API with no Node dependency, and Arc already defaults to OpenCode. **[R]**
2. **Codex second.** It proves the adapter boundary with a second protocol and a Rust binary. **[R]**
3. **Claude third, only after deciding the Node question.** Use the Agent SDK or ACP wrapper; do not hand-parse the CLI for v1. **[R]**
4. **ACP last, and optional.** Add registry/local ACP only when there is demand and a policy for install, checksums, and untrusted agents. **[R]**
5. **Never make PTY parsing the primary integration.** It is acceptable as a fallback or a terminal-only spike, not as the conversation protocol. **[R]**

### 4.4 Provider compatibility traps

- **Auth:** subscription login vs API key vs Bedrock/Vertex; remote/headless flows differ. Arc must not become a credential broker. **[V/R]**
- **Version drift:** CLIs change flags and protocols. Pin minimum versions, probe capabilities, and show actionable errors. **[R]**
- **PATH:** desktop-launched processes may not see shell-profile PATH. Resolve binaries through a login shell or a configured path. **[R]**
- **Windows/macOS:** agent support, sandboxing, and shell behavior differ. Test each provider per platform. **[?]**
- **Concurrency:** same account/session limits and rate limits; two chats may conflict on a shared provider session. **[V/R]**
- **Permissions:** providers enforce differently; do not emulate modes they cannot enforce. **[V]**
- **MCP:** each provider configures differently; avoid duplicate servers and double injection. **[V/R]**

---

## 5. Skills and MCP compatibility

### 5.1 Definitions

- **Skill:** a provider-native instruction bundle, usually a directory with `SKILL.md`, discovered from user and project folders. Invocation and discovery are provider-specific. **[V]**
- **MCP:** Model Context Protocol. Servers expose tools, resources, and prompts; clients connect over stdio or HTTP. **[V]**

### 5.2 T3 Code behavior

- Skills are provider-owned and surfaced in the composer: `$` for skills, `/` for commands. Examples: Claude `<CLAUDE_CONFIG_DIR>/skills` and `.claude/skills`; Codex `.codex/skills`; Antigravity `.gemini/skills`, `.agents/skills`, `.agent/skills`; Grok/fx skills in `$`. **[V]** (`docs/user/providers-claude.md:36-40`, `providers-antigravity.md:37-40`, `providers-grok.md:20`, `providers-fx.md:18-22`, `composer.md:132-140`)
- After adding skills, plugins, or MCP servers, T3 asks the user to restart the agent session. **[V]** (`composer.md:140`)
- T3 injects its authenticated MCP server so agents can reach T3 tools, and keeps turns working if the server is unreachable. **[V]** (`docs/internals/03_providers.md:72-76`)
- T3 exposes an MCP endpoint for outside agents (Claude Code, Codex, ChatGPT, OAuth MCP clients) to read projects/threads, launch and message threads, and monitor events. **[V]** (`docs/user/outside-agents.md:1-45`)
- MCP OAuth flows are provider-specific and shown in the UI. **[V]** (`providers-claude.md:38-39`, `providers-codex.md:45`)

### 5.3 Arc behavior

| Capability | Arc today | Evidence |
|---|---|---|
| Agent skills | None. Arc has plugins, not agent skills. | `src/lib/pluginRuntime.ts`; no skill API |
| Agent slash commands | None. Build tab sends a one-shot prompt. | `src/lib/agent/kit.ts` |
| MCP client for plugins | Yes: register/connect/list tools/resources/prompts, subscribe, sampling/elicitation/authorization handlers | `PLUGIN_API.md:755-783`, `pluginRuntime.ts:2330-2450` |
| MCP server exposure | Yes: plugins can expose tools/resources/prompts; Arc starts a loopback streamable-HTTP MCP endpoint with a bearer token | `PLUGIN_API.md:799-815`, `pluginRuntime.ts:2437-2462` |
| Agent MCP injection | Not implemented. No code configures provider MCP servers from Arc's endpoint. | No source evidence |
| MCP Apps / inline HTML | Not implemented. | No source evidence |

Important distinction: Arc's plugin MCP API is an **MCP client** for plugins, plus an **MCP server** that exposes plugin tools. It is not yet an agent-facing tool bridge. **[V]**

### 5.4 Compatibility matrix

| Need | OpenCode | Codex | Claude | ACP agents | Arc work |
|---|---|---|---|---|---|
| Discover provider skills | Provider-owned | Provider-owned | Provider-owned | Provider-owned | Surface `$` menu; do not reimplement |
| Invoke skill | Provider prompt syntax | Provider prompt syntax | Provider prompt syntax | ACP commands/skills | Pass through; show hint |
| Add MCP server | Provider config | Provider config | Provider config / OAuth | ACP MCP config | Write per-provider config or pass flags |
| Use Arc tools from agent | Configure OpenCode MCP to Arc endpoint | Configure Codex MCP | Configure Claude MCP | ACP MCP | Expose Arc MCP endpoint + token |
| OAuth MCP sign-in | Provider flow | Provider flow | Provider flow | ACP | Show notice; do not proxy credentials |
| MCP Apps / rich UI | Not universal | Some | Some | Varies | Do not promise in v1 |

### 5.5 Recommendations

- **Do not build a skill system.** Skills belong to the provider. Arc should discover what the provider reports and surface invocation hints. **[R]**
- **Expose Arc's MCP endpoint to agents only with explicit consent.** The endpoint already exists for plugins; reuse it, but scope tools tightly and rotate the bearer token. **[R]**
- **Do not auto-inject Arc's MCP server into every provider.** It can start MCP servers, run hooks, or trigger auth; make it opt-in per project. **[R]**
- **Avoid duplicate MCP servers.** If the provider already loads a server from its own config, do not add a second copy. **[R]**
- **Treat skill/MCP content as untrusted.** Project skills and MCP prompts can contain instructions; approvals and diff review remain the boundary. **[R]**

### 5.6 Unresolved questions

- [?] Should Arc expose its editor/file/Git tools to agents via MCP in v1, or only read-only project context?
- [?] How does Arc rotate the MCP bearer token, and where is it stored?
- [?] Which providers can consume Arc's loopback HTTP MCP endpoint without extra configuration?
- [?] Do we surface provider skills in a `$` menu, or only document them?
- [?] How do we handle MCP OAuth when Arc is the host but the provider owns the credential store?

---

## 6. Project and conversation management

### 6.1 Concepts

| Concept | Definition | Ownership |
|---|---|---|
| Project | A local folder the user trusts for agent work. Independent of the editor's open workspace. | Arc |
| Provider instance | A configured account/runtime for a provider (e.g. two Claude config dirs). | Arc |
| Thread | A conversation attached to a project and a provider instance. | Arc |
| Run | One execution of a turn, from send to completion/interrupt. | Arc + provider |
| Turn | A user message and the agent's response cycle. | Arc + provider |
| Item | A message, tool call, approval request, diff, error, or artifact inside a run. | Arc |
| Worktree | An isolated Git checkout for a thread. | Optional, Arc + Git |

### 6.2 T3 project and conversation management

- Projects can span multiple repositories; the project folder need not be a Git repo. Repos are discovered one level down, plus deeper inside non-repo folders. **[V]** (`docs/user/multi-repo-projects.md`)
- Worktree threads create per-repo worktrees on a thread branch; plain-folder files outside repos are linked, not copied. **[V]** (same doc)
- Threads can start without a project in a scratch folder. **[V]** (`thread-sidebar.md:10-18`)
- Sidebar groups by project in the "boring sidebar" beta; pinned threads stay above, snoozed/settled below. **[V]** (`thread-sidebar.md:40-44`)
- Threads support settle, snooze, archive, pin, working section, auto-settlement, PR linking, and worktree cleanup. **[V]** (`thread-sidebar.md:46-70`)
- Search covers titles, branches, PRs, projects, and message contents. **[V]** (`thread-sidebar.md:80-86`)
- Subagents and side chats open in the right panel by default. **[V]** (`thread-sidebar.md:88-110`)

### 6.3 Arc current state

- One workspace at a time; no project registry. **[V]** (`src/App.tsx:1761`, `:3307`)
- No conversation model, no provider session binding, no approvals, no diffs tied to runs. **[V]**
- File watcher and disk-conflict handling exist, but no policy for agent edits vs unsaved buffers. **[V]** (`src/App.tsx:2696`, `:1551`)

### 6.4 Recommended model

```text
Project (id, canonical path, name, trusted, created/updated)
  └─ Thread (id, projectId, providerInstanceId, model, permissionMode,
             branch?, worktreePath?, nativeSessionId?, uiStatus,
             archivedAt?, pinnedAt?, lastVisitedAt)
       └─ Run (id, threadId, status, startedAt, endedAt, error?)
            └─ Item (id, runId, kind, payload, createdAt)
```

Rules:

- Project identity is an ID plus canonical path; path alone is not a key (rename/move). **[R]**
- Threads are independent of the editor's workspace. Opening a project in the editor is an explicit action. **[R]**
- Multiple threads per project are allowed. If they edit the same checkout, serialize edits or use worktrees. **[R]**
- Provider instance is part of the thread identity, not just the provider name. **[R]**
- Native provider session IDs are stored for resume; Arc history is the display source of truth. **[R]**

### 6.5 Thread lifecycle

```text
created ──> starting ──> idle ──> working ──> needs-input ──> working
   │            │          │          │            │
   │            └─ error ──┘          └─ done ─────┘
   │
   └─ archived / deleted

UI status is derived from:
  provider session status + active run + pending approvals + last error
```

Do not reuse provider session status as the UI dot. Provider statuses are `starting/ready/running/waiting/stopped/error`; UI statuses should be `idle/working/needs-input/done/error`. **[R]**

### 6.6 Editor coordination

- Before starting a run, detect dirty files in the project. Options: save all, block with a prompt, or run in a worktree. **[R]**
- Agent edits trigger `fs-changed`; reuse the existing disk-conflict banner and avoid overwriting unsaved buffers. **[V/R]**
- If the user opens a project in the editor while a thread is running, show the agent's cwd and branch in both surfaces. **[R]**
- Do not silently switch the editor's workspace when the agent project changes. **[R]**

### 6.7 Comparison

| Behavior | T3 Code | Arc today | Recommended Arc |
|---|---|---|---|
| Multiple projects | Yes | No | Yes, explicit registry |
| Multiple chats per project | Yes | No | Yes |
| Chat independent of editor | Yes | N/A | Yes |
| Worktrees | Yes | No | Later, optional |
| Settle/snooze/archive | Yes | No | Archive + pin in v1; settle later |
| Search chats | Yes | No | v1.1 |
| Approvals | Yes | No | v1 |
| Diff/checkpoint | Yes | GitHub diff only | v1.1 |
| Provider instances | Yes | No | v1 (model it even with one provider) |

---

## 7. Recommended UI/UX

### 7.1 Decision

**Build a dedicated Agents workspace, not an editor tab, not a sidebar panel, not a plugin panel.** **[R]**

Surface options:

| Option | Verdict | Reason |
|---|---|---|
| Sidebar panel inside existing explorer | Reject | Too narrow for chat; conflicts with file tree; implies same workspace. |
| Dedicated editor tab | Reject | Tied to workspace tab strip; collides with file tabs; no independent project rail. |
| Plugin custom tab | Reject | Renders as editor tab; no independent surface. |
| Full-window overlay mode | **Recommended v1** | Preserves editor DOM/state; reuses ThemeMaker overlay pattern; least new window code. |
| Separate Tauri window | **Recommended later / if parallel visibility matters** | Matches Cursor's Agents Window; true independence; costs cross-window state sync and capability scope. |

Evidence correction: Cursor 3's Agents Window is a separate window and can be open alongside the IDE. My earlier dismissal of separate windows was too strong. Keep it as a serious option. **[V]** (https://cursor.com/docs/agent/agents-window)

Conductor correction: its official changelog shows sidebar sections, Group by, Filter by project, and Sort by. The "flat ungrouped sidebar" claim came from a competitor review and is not reliable. **[V]** (https://www.conductor.build/changelog/0.95.0-agents-that-manage-your-local-workspaces)

### 7.2 Main wireframe

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Arc              [ Editor | Agents ]                    ─  □  ✕      │
├──────────────────┬───────────────────────────────────────────────────┤
│ PROJECTS      +  │  my-app › Fix auth redirect          ⚙  ⋯        │
│ 🔍 Search chats  │  Provider: Claude ▾   Model: Sonnet ▾            │
│                  │  Permissions: Supervised ▾                       │
│ ▾ 🔵 my-app    ● │───────────────────────────────────────────────────│
│    ● Fix auth…   │  ┌ user ───────────────────────────────────────┐  │
│    ◐ Add tests   │  │ Fix the OAuth redirect loop                 │  │
│    ✓ Refactor…   │  └─────────────────────────────────────────────┘  │
│ ▸ 🟣 api      2  │  ┌ agent ──────────────────────────────────────┐  │
│ ▸ 🟢 site        │  │ Reading src/auth.ts…                        │  │
│                  │  │ …                                           │  │
│                  │  └─────────────────────────────────────────────┘  │
│                  │  ┌ approval ───────────────────────────────────┐  │
│                  │  │ Run: npm test?                              │  │
│                  │  │ [Allow once] [Allow session] [Deny]         │  │
│                  │  └─────────────────────────────────────────────┘  │
│ ⚙  Providers     │───────────────────────────────────────────────────│
│                  │  [ Message…                    ] Claude ▾ ↑       │
└──────────────────┴───────────────────────────────────────────────────┘
```

### 7.3 Empty states

```text
No projects:                       No chats in project:
┌──────────────────────────┐       ┌──────────────────────────────┐
│ Add your first project   │       │ Start a chat in my-app       │
│ [ Choose folder ]        │       │ [ Message…              ] ↑  │
└──────────────────────────┘       └──────────────────────────────┘
```

### 7.4 Project group and thread row anatomy

```text
▾ 🔵 my-app                 ●   +     ← collapse, status dot, new chat
    ● Fix auth redirect      2m   Claude · Sonnet   ← status, time, provider
    ◐ Add tests              1h   Codex · GPT-5
    ✓ Refactor store         1d   OpenCode · …
```

Status dots:

- Working: info/accent.
- Needs input: warning.
- Done/unread: success.
- Error: error.
- Idle: muted.

Use theme slots, not hardcoded hex. Status dots need text labels for accessibility. **[R]**

### 7.5 Chat header and actions

- Project name and chat title.
- Provider instance + model picker.
- Permission mode picker.
- Open project in editor.
- Diff, terminal, preview (later).
- Interrupt/stop while running.
- More: rename, archive, delete, copy path/ID.

### 7.6 Composer

- Multiline text, send with Enter, newline with Shift+Enter.
- Attachment button; file drop.
- `@` file/context mentions.
- `/` commands and `$` skills when the provider supports them.
- Model/permission chips.
- Queue/steer behavior when a run is active.
- Stop button.

### 7.7 Approvals

Approval card must show:

- What will run or change.
- Command or file diff.
- Risk hint (write/delete/network).
- Allow once, allow for session, deny with feedback.

Do not auto-approve by default. T3 defaults to Full access; Arc should default to Supervised. **[R]**

### 7.8 Navigation and keyboard

| Action | Shortcut |
|---|---|
| Toggle Agents mode | `Ctrl+Shift+A` |
| New chat in current project | `Ctrl+N` |
| Quick switch chat | `Ctrl+P` |
| Next/previous chat | `Alt+ArrowDown/Up` |
| Focus composer | `Ctrl+L` |
| Stop run | `Esc` twice or explicit button |

### 7.9 Notifications

- Needs input, done, error, and usage limit.
- Coalesce per thread; do not notify every token.
- Reuse existing notification settings.
- Clicking a notification opens the thread and clears unread.

### 7.10 Why this UI wins

- Project rail gives the independent project list the requirement asks for.
- Thread list gives multiple conversations per project.
- Conversation pane gives enough width for chat, diffs, and approvals.
- Overlay preserves editor state and is the smallest complete change.
- Separate window remains an option when parallel monitoring matters.

### 7.11 Unresolved UI questions

- [?] Overlay or separate window for v1?
- [?] Is one conversation visible at a time enough, or is a tiled layout required?
- [?] Should the project rail be collapsible to an icon rail?
- [?] Should the Agents mode remember the last thread per project?
- [?] How much of the editor toolbar should remain visible in Agents mode?

---

## 8. Recommended technical architecture

### 8.1 Layers

```text
┌──────────────────────────── React ─────────────────────────────┐
│ AgentsWorkspace (lazy)                                         │
│  project rail | thread list | conversation | composer          │
│  module store + useSyncExternalStore (no chat state in App)    │
└───────────────────────────────┬────────────────────────────────┘
                                │ Tauri invoke + events
┌───────────────────────────────▼────────────────────────────────┐
│ Rust AgentManager                                              │
│  project registry | thread store | run scheduler | approvals   │
│  provider registry | event fanout | persistence | recovery     │
└───────────────┬───────────────────────────────┬────────────────┘
                │                               │
┌───────────────▼──────────────┐  ┌─────────────▼────────────────┐
│ Provider adapter             │  │ ProcessManager               │
│  OpenCode HTTP client        │  │  process groups / job objects│
│  Codex app-server client     │  │  terminal sessions           │
│  Claude/ACP adapter (later)  │  │  orphan reaping              │
└───────────────┬──────────────┘  └─────────────┬────────────────┘
                │                               │
┌───────────────▼───────────────────────────────▼────────────────┐
│ OS: provider binaries, PTYs, filesystem, network                │
└────────────────────────────────────────────────────────────────┘
```

### 8.2 Responsibilities

**React**

- Render only.
- Optimistic send, pending states, streamed deltas.
- Virtualized transcript.
- No provider protocol parsing.
- No process lifecycle.

**Rust `AgentManager`**

- Own project registry and trust state.
- Own threads, runs, items, approvals, and checkpoints metadata.
- Spawn and supervise provider processes.
- Normalize provider events into Arc events.
- Persist append-only records.
- Reap orphan processes on startup.
- Enforce project cwd and env policy.

**Provider adapter**

- Translate Arc commands to provider protocol.
- Translate provider events to Arc items.
- Report capabilities.
- Handle auth status, model catalog, permissions, resume, interrupt.
- Never leak provider-specific fields into the UI contract.

**ProcessManager**

- Register child PIDs.
- Kill process trees.
- Track terminal sessions.
- Stop everything on app exit.

### 8.3 Command and event contract

Commands (frontend → Rust):

```text
agent_project_add(path) -> Project
agent_project_remove(projectId)
agent_project_set_trust(projectId, trusted)
agent_provider_list() -> ProviderInstance[]
agent_thread_create(projectId, providerInstanceId, model, permissionMode) -> Thread
agent_thread_list(projectId?) -> ThreadSummary[]
agent_thread_open(threadId) -> ThreadDetail
agent_thread_send(threadId, text, attachments) -> RunId
agent_thread_interrupt(threadId)
agent_approval_respond(approvalId, decision, feedback?)
agent_thread_archive(threadId)
agent_thread_delete(threadId)
agent_model_list(providerInstanceId) -> Model[]
agent_auth_status(providerInstanceId) -> AuthStatus
```

Events (Rust → frontend):

```text
agent://thread-updated
agent://run-started
agent://item-added
agent://item-delta
agent://approval-requested
agent://approval-resolved
agent://run-finished
agent://thread-status
agent://provider-status
agent://error
```

Rules:

- Batch deltas in Rust (16–50 ms) before emitting.
- Include sequence numbers; frontend reconciles by sequence.
- Send IDs and deltas, not full transcripts.
- Use a single event channel per thread; do not create one listener per token.

### 8.4 Sequence: send and approve

```text
UI                AgentManager             Adapter              Provider
 │ send(text)          │                      │                    │
 ├────────────────────>│                      │                    │
 │                     │ create run           │                    │
 │                     │ ensure session       │                    │
 │                     ├─────────────────────>│                    │
 │                     │                      ├───────────────────>│
 │                     │                      │<── stream events ──┤
 │                     │<── normalized items ─┤                    │
 │<── item deltas ─────┤                      │                    │
 │                     │                      │                    │
 │                     │<── approval request ─┤                    │
 │<── approval card ───┤                      │                    │
 │ allow once          │                      │                    │
 ├────────────────────>│ respond              │                    │
 │                     ├─────────────────────>│                    │
 │                     │                      ├───────────────────>│
 │                     │<── tool result ──────┤                    │
 │<── item added ──────┤                      │                    │
 │                     │<── run finished ─────┤                    │
 │<── status done ─────┤                      │                    │
```

### 8.5 Provider adapter boundary

Do **not** build a giant capability schema before the second provider. Start with the fields OpenCode actually needs:

```text
capabilities:
  streaming: boolean
  approvals: boolean
  resume: boolean
  fork: boolean
  rollback: boolean
  steer: boolean
  interrupt: boolean
  images: boolean
  mcp: boolean
  skills: boolean
  worktree: boolean
```

Extend only when Codex or Claude needs a field. **[R]**

### 8.6 Reuse of Arc primitives

| Primitive | Reuse |
|---|---|
| `process.rs` | Provider process registration and tree kill. |
| `terminal_spawn` | Optional terminal per thread; not the chat transport. |
| `workspace_grant_access` | Project folder consent, but do not confuse with process sandbox. |
| `watch_project` | Detect external edits and disk conflicts. |
| `plugin_secret_*` | Only for Arc-owned secrets, not provider credentials. |
| `open_external_url` | Links; expand allowlist deliberately or show copy fallback. |
| SettingsPanel | Add provider/project settings UI. |
| ThemeMaker overlay CSS | Agents overlay pattern. |
| Notification settings | Agent notifications. |

### 8.7 Explicit non-goals for v1

- No custom agent loop or model client.
- No cloud agents, remote execution, or multi-device sync.
- No sandbox implementation.
- No automatic agent installation.
- No worktree UI.
- No tiled layout.
- No plugin API exposure of agent internals.

---

## 9. Data models and state management

### 9.1 Core types

```ts
type Project = {
  id: string;
  path: string;            // canonical absolute path
  name: string;
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProviderInstance = {
  id: string;
  driver: "opencode" | "codex" | "claude" | "cursor" | "acp";
  label: string;
  binaryPath?: string;
  configDir?: string;
  env: Record<string, string>; // names only in UI; values in keyring if Arc-owned
  createdAt: string;
};

type Thread = {
  id: string;
  projectId: string;
  providerInstanceId: string;
  title: string;
  model: string;
  permissionMode: "supervised" | "auto-edits" | "auto" | "full";
  branch?: string;
  worktreePath?: string;
  nativeSessionId?: string;
  uiStatus: "idle" | "working" | "needs-input" | "done" | "error";
  createdAt: string;
  updatedAt: string;
  lastVisitedAt?: string;
  archivedAt?: string;
  pinnedAt?: string;
};

type Run = {
  id: string;
  threadId: string;
  status: "starting" | "running" | "waiting" | "completed" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  error?: string;
};

type Item =
  | { id: string; runId: string; kind: "user"; text: string; createdAt: string }
  | { id: string; runId: string; kind: "assistant"; text: string; createdAt: string }
  | { id: string; runId: string; kind: "tool"; name: string; input: unknown; output?: unknown; status: string; createdAt: string }
  | { id: string; runId: string; kind: "approval"; approvalId: string; title: string; detail: string; decision?: string; createdAt: string }
  | { id: string; runId: string; kind: "diff"; files: string[]; patch: string; createdAt: string }
  | { id: string; runId: string; kind: "error"; message: string; createdAt: string };
```

### 9.2 Persistence

Recommended v1, no new dependency:

```text
$APPDATA/dev.arc.ide/agent/
  projects.json              # project registry, atomic rewrite
  providers.json             # provider instances, no secrets
  threads.json               # thread index, atomic rewrite
  threads/<threadId>.jsonl   # append-only run/item records
  runs/<runId>.json          # optional run metadata, atomic rewrite
```

Rules:

- Append JSONL per item; do not rewrite the transcript per message.
- Debounce and atomically replace index files (`write temp + rename`).
- Store schema version; migrate on load.
- Keep secrets out of JSON; use OS keyring if Arc must own one.
- On startup, reconcile `running` runs to `interrupted` and reap orphan processes.

SQLite is a valid later upgrade if search, pagination, or many threads make JSON indexes slow. Arc currently has no SQLite or store dependency, so adding one is a product decision, not a default. **[V/R]**

### 9.3 Frontend state

Recommended:

```text
agentsStore (module-level)
  projects, threads, activeThread, runs, itemsByThread, approvals
  subscribe(listener)
  actions call Tauri commands, apply optimistic updates, reconcile events
```

- Use `useSyncExternalStore` for subscriptions.
- Keep chat state out of `App`.
- Virtualize the transcript.
- Keep per-thread item windows; drop old items from memory after persisting.
- Do not add a state library unless the store becomes unmanageable; Arc has no state library today. **[V/R]**

### 9.4 Settings additions

Settings should only hold preferences:

```ts
agentLastMode: "editor" | "agents";
agentDefaultProviderInstanceId: string;
agentDefaultPermissionMode: "supervised" | "auto-edits" | "auto" | "full";
agentNotifications: boolean;
agentConfirmDirtyFiles: boolean;
```

Bump `APP_SETTINGS_VERSION` from 6 to 7 and update `AppSettings`, `DEFAULT_SETTINGS`, and merge/migration logic. Do **not** put projects, threads, runs, or messages in settings. **[V/R]**

### 9.5 Data ownership

| Data | Owner | Persistence |
|---|---|---|
| Project registry | Arc Rust | `projects.json` |
| Trust state | Arc Rust | `projects.json` |
| Provider instances | Arc Rust | `providers.json` + keyring |
| Thread index | Arc Rust | `threads.json` |
| Transcript/items | Arc Rust | per-thread JSONL |
| UI status | Derived | not persisted |
| Active thread/mode | Frontend + settings | settings |
| Provider native session | Provider | referenced by ID |
| Approvals | Arc Rust | in JSONL until resolved |
| Diffs/checkpoints | Arc Rust / Git | JSONL + hidden refs (later) |

---

## 10. Security and performance considerations

### 10.1 Threat model

| Threat | Impact | Control |
|---|---|---|
| Agent runs arbitrary commands | File loss, data exfiltration | Explicit project trust; supervised default; approvals; show cwd. |
| Prompt injection from repo/tool output | Unintended actions | Approvals, diff review, least-privilege modes. |
| Env leakage | Tokens/keys exposed to agent | Strip provider-foreign env; per-instance env; never log. |
| FS scope bypass | Agent reads outside project | Document that child processes are not sandboxed; prefer worktree; optional OS sandbox later. |
| Raw HTML in chat | App-privileged script execution | Render markdown without raw HTML; sanitize links; no `dangerouslySetInnerHTML` for agent content. |
| External link handling | Phishing or blocked links | Allowlist expansion or confirmation; show copy-link fallback. |
| MCP server exposure | Local tool access | Loopback only; bearer token; opt-in; rotate; minimal tool set. |
| Supply chain | Malicious agent/adapter | No auto-install; checksums; user consent; pin versions. |
| Orphan processes | Resource leak / runaway agent | Process groups/job objects; startup reaping; explicit stop. |
| Log leakage | Secrets in diagnostics | Redact paths/tokens/env; user-initiated export only. |
| Local API exposure | Other local apps control agents | Loopback bind; token/pairing; do not expose unauthenticated. |

### 10.2 Security rules

- Default permission mode: **Supervised**.
- Project trust is explicit and revocable.
- Canonicalize project cwd; reject paths outside the trusted project.
- Resolve executables from a configured path or login shell; do not accept arbitrary command strings from agent output.
- Strip `ANTHROPIC_*`, `OPENAI_*`, `GITHUB_TOKEN`, and similar variables unless the provider instance configured them. **[R]**
- Never render provider markdown as raw HTML. Use a markdown renderer with raw HTML disabled.
- Block `javascript:`, `data:`, and `file:` links in chat; route http(s) through the allowlist or confirmation.
- Keep the MCP bearer token in memory/keyring; never put it in project files.
- Redact logs before writing diagnostics.
- Kill process trees on stop, mode close, and app exit.

### 10.3 Performance budget

| Area | Target | Technique |
|---|---|---|
| Streaming | Smooth at 60 fps | Batch 16–50 ms in Rust; coalesce deltas; virtualize. |
| Transcript | 10k items usable | Windowed rendering; drop old items from memory after persist. |
| Many chats | 20+ threads listed | Summary index; lazy-load detail; no full transcript in list. |
| Live sessions | Cap 3–5 concurrent by default | Idle release; show resource use; user override. |
| Persistence | No UI jank | Append JSONL; debounce index writes; atomic rename. |
| Startup | Agents mode does not slow editor | Lazy-load component; defer manager init until mode opened/restored. |
| IPC | No event flood | Sequence numbers; delta batches; no per-token invoke. |
| Watcher | No refresh storms | Debounce; ignore `.git`, `node_modules`, build dirs. |
| Memory | Bounded | Ring buffers; transcript windows; idle session release. |

### 10.4 Performance risks

- `App.tsx` re-render if chat state leaks into it. **[V/R]**
- Tauri event per token. **[R]**
- Full transcript JSON rewrite per message. **[R]**
- Many PTYs/agent processes. **[R]**
- File watcher reacting to agent edits. **[V/R]**
- Large attachments through IPC. **[R]**

---

## 11. Technical limitations and risks

### 11.1 Risk register

| Risk | Likelihood | Impact | Mitigation | Phase |
|---|---|---|---|---|
| OpenCode API changes | Medium | High | Pin version; adapter isolates; capability probe | 1 |
| Node dependency for Claude/Cursor/ACP | High | Medium | Defer; decide sidecar policy; OpenCode/Codex first | 3 |
| Provider process escapes tree kill | Low | High | Process groups/job objects; cgroup on Linux later; startup reaping | 1 |
| Editor/agent file race | High | Medium | Save-before-run; block on dirty files; worktree later | 1 |
| Prompt injection causes destructive action | Medium | High | Supervised default; approvals; diff review | 1 |
| CSP null + markdown XSS | Medium | High | No raw HTML; sanitize; link policy | 1 |
| External link allowlist too narrow | High | Low | Copy fallback; expand deliberately | 1 |
| Windows/macOS provider differences | High | Medium | Platform matrix; per-provider tests | 2–3 |
| Provider version drift | High | Medium | Version checks; clear errors; pin | 2 |
| MCP token leakage | Low | High | Keyring/in-memory; loopback; rotate | 2 |
| Separate window state sync | Medium | Medium | Shared Rust store; events; capability scope | 3 |
| No frontend test runner | High | Medium | Build gate + manual matrix; add minimal tests only if justified | 1 |

### 11.2 Claim corrections from earlier research

- **Conductor sidebar is flat/un-grouped:** wrong. Official changelog shows sections, Group by, Filter by project, Sort by. The claim came from a competitor review.
- **Cloudroom groups by project:** unverified competitor claim; drop as evidence.
- **T3 is whole-app event sourcing:** overstated. Bounded event log + persisted projections.
- **T3 has an oversized capability schema:** not verified; drop.
- **T3 does per-thread auto PR:** worktrees and PR tools/watch exist; automatic PR creation not verified.
- **T3 kills everything with cgroups:** cgroups are used by the ACP runtime on Linux; otherwise process groups/job objects.
- **Separate window doubles work:** too strong. Cursor uses a separate Agents Window and supports both open. Re-open as an option.
- **Plugin system can host an independent agents surface:** false with the current renderer; plugin views become editor tabs.
- **Store chats in settings/localStorage:** wrong layer; use Rust-owned files or a DB.
- **Spawn agents from the frontend:** wrong ownership; Rust must own lifecycle.

### 11.3 Limitations accepted for v1

- One provider (OpenCode).
- One conversation visible at a time.
- Overlay mode, not separate window.
- No worktrees, no tiled layout, no cloud.
- No Arc MCP injection into agents by default.
- No skill system; provider-owned skills only.

---

## 12. Implementation roadmap

### Phase 0 — optional spike (1–3 days)

Goal: validate demand and UI shape with the least code.

- Add an "Agent sessions" list that launches existing CLIs in PTYs.
- Project list, chat title, terminal per chat.
- No structured chat, no approvals.
- Reuse `terminal_spawn`, `process.rs`, terminal buffer.

Exit: user feedback on project/chat list and whether structured chat is required. **[R]**

### Phase 1 — OpenCode MVP (2–3 weeks)

Goal: real conversation management with one provider.

Deliverables:

- Rust `AgentManager` skeleton: projects, threads, runs, items, event fanout, persistence.
- OpenCode server adapter: spawn, session create, prompt, stream, interrupt, approvals, models.
- Overlay Agents UI: project rail, thread list, conversation, composer, approval cards.
- Project trust prompt; supervised default; dirty-file guard.
- JSONL persistence; startup reconciliation; orphan reaping.
- Notifications for needs-input/done/error.
- Settings: last mode, default provider, default permission, notifications.

Exit criteria:

- Add project, create multiple chats, send/stream/interrupt, approve/deny.
- Restart Arc and resume history.
- Process tree dies on stop and app exit.
- No chat state in `App.tsx`.
- `npm run build` passes; `cargo test` passes.

### Phase 2 — Codex + review workflow (2–3 weeks)

- Codex app-server adapter.
- Provider instance model and model picker.
- Diff review and checkpoint metadata.
- Resume, search, archive/pin.
- Per-thread terminal.
- Capability-gated UI.

Exit: two providers behind the same contract; no provider-specific UI branches beyond capabilities.

### Phase 3 — Claude/ACP + isolation (3–4 weeks)

- Decide Node sidecar vs SDK vs ACP.
- Claude adapter (SDK or ACP).
- Optional ACP registry/local command.
- Worktree per thread when multiple chats edit one project.
- Optional separate Tauri window.
- Arc MCP endpoint opt-in for agents.

Exit: three provider paths; worktree isolation; documented Node policy.

### Do not build in v1

- Agent loop, model client, sandbox, cloud sync, multi-device, auto-install, tiled layout, plugin API for agents, full event sourcing.

---

## 13. Testing strategy

### 13.1 Rust

- Unit: project path canonicalization, trust state, thread/run state machine, permission derivation, JSONL append/read, schema migration.
- Process: spawn a shell that forks a child; stop must kill the whole group (Unix) / job (Windows). Existing `process.rs` test is a start (`process.rs:313`).
- Persistence: crash during append; startup reconciles `running` runs; orphan process reaping.
- Adapter contract: mock OpenCode HTTP server; assert request/response mapping; stream parsing; error mapping.
- Security: path traversal in project add; cwd outside project; env stripping; MCP token auth; link sanitization.
- Concurrency: two sends to one thread; interrupt during approval; session release during run.

### 13.2 Frontend

- `npm run build` is the typecheck gate.
- Component tests only if a runner is added; otherwise manual matrix.
- Manual: overlay preserves editor tabs, splits, unsaved buffers, terminal scrollback; mode switch does not close PTYs.
- Accessibility: keyboard navigation, focus order, status labels, approval buttons.

### 13.3 Provider contract tests

- Record real provider transcripts as fixtures; replay through the adapter.
- Test OpenCode event stream, approval flow, interrupt, resume, model catalog.
- Test Codex app-server handshake, turn start, stream, approval, stop.
- Test Claude/ACP when added.
- Never hand-write protocol frames as the only test; use real fixtures. **[R]**

### 13.4 Security tests

- Agent output with `<script>` and `javascript:` links.
- Malicious repo file with prompt injection.
- Agent tries to write outside project.
- Agent tries to read `.env`; confirm warning/policy.
- MCP endpoint rejects missing/wrong bearer token.
- External link outside allowlist fails gracefully.
- Process escape attempt (`setsid`) behavior documented.

### 13.5 Performance tests

- 10k-item transcript scroll and search.
- 5 concurrent sessions; idle release.
- 100 threads in project list.
- 1 MB/s stream for 60 seconds; UI stays responsive.
- Restart with 100 threads; startup time.

### 13.6 Platform matrix

| Platform | Must test |
|---|---|
| Linux (primary) | PTY, process groups, OpenCode, Codex, paths, Wayland |
| Windows | Job objects, `cmd.exe`/PowerShell, provider binaries, path quoting |
| macOS | PTY, provider binaries, PATH, window behavior |

---

## 14. Sources and references

### Arc source

- `src/App.tsx` — shell, state, editor, tabs, terminals, overlays.
- `src/lib/settings.ts` — `AppSettings`, version 6, agent CLI settings.
- `src/lib/terminalOutput.ts` — 2 MB global terminal buffer.
- `src/lib/pluginRuntime.ts` — plugin API, MCP client/exposure, plugin views.
- `src/components/TerminalView.tsx` — PTY spawn and cleanup.
- `src-tauri/src/lib.rs` — commands, terminal, processes, workspace gating, MCP/plugin secrets, local server, updater.
- `src-tauri/src/process.rs` — process groups, Windows job objects, stop.
- `src-tauri/capabilities/default.json` — fs and opener scopes.
- `src-tauri/tauri.conf.json` — CSP null.
- `PLUGIN_API.md` — plugin API, MCP client/exposure.
- `AGENTS.md` — project conventions.
- `research/webview-panel.md` — Linux child-webview limits (background).

### T3 Code source and docs

- `docs/internals/01_architecture.md` — ownership, orchestration, checkpoints.
- `docs/internals/03_providers.md` — adapter, ACP policy, capabilities, security.
- `packages/provider-core/src/server/ProviderAdapter.ts` — adapter interface, statuses, errors.
- `apps/server/src/orchestration-v2/Orchestrator.ts`, `EventSink.ts`, `EffectWorker.ts`, `ProviderSessionManager.ts` — pipeline, sessions, idle release.
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`, `ClaudeAdapterV2.ts` — provider drivers.
- `packages/contracts/src/orchestrationV2.ts` — thread/run/item/transcript schemas.
- `packages/provider-cursor/package.json` — Cursor SDK.
- `packages/provider-acp/src/server/AcpSessionRuntime.ts` — ACP runtime and cgroup.
- `apps/web/src/components/Sidebar.tsx`, `components/sidebar/*`, `ChatView.tsx`, `AppSidebarLayout.tsx` — UI.
- `docs/user/thread-sidebar.md`, `multi-repo-projects.md`, `project-settings.md`, `providers-*.md`, `composer.md`, `outside-agents.md`, `permission-modes.md` — behavior.
- `LICENSE` — MIT.

### Official documentation

- Cursor Agents Window: https://cursor.com/docs/agent/agents-window
- Cursor 3 changelog: https://cursor.com/changelog/3-0
- Conductor changelog 0.95.0: https://www.conductor.build/changelog/0.95.0-agents-that-manage-your-local-workspaces
- Conductor parallel agents: https://www.conductor.build/docs/guides/parallel-agents/run-multiple-claude-code-sessions
- ACP Registry: https://agentclientprotocol.com/get-started/registry
- Claude Code headless: https://code.claude.com/docs/en/headless
- OpenCode server API: https://opencode.ai/docs/server/
- Tauri capabilities: https://tauri.app/security/capabilities/
- Tauri window customization: https://tauri.app/learn/window-customization/

### Evidence quality note

- T3 Code source and Arc source were read directly.
- Cursor, Conductor, ACP, Claude, and OpenCode claims were checked against official pages.
- The "Conductor flat sidebar" and "Cloudroom groups by project" claims from earlier research were competitor-sourced and are retracted.
- Codex app-server is verified in T3 source; the upstream protocol is OpenAI's Codex app-server. No separate OpenAI page was fetched for this document.

---

## 15. Final recommendation

**Build the Agents workspace as a first-class Arc mode, backed by a Rust-owned `AgentManager`, with OpenCode as the first provider and an overlay UI for v1.** **[R]**

### Why this is the best approach for Arc

1. **It matches Arc's ownership boundary.** Arc already owns processes, PTYs, file watching, and secrets in Rust. Agents must live there too, or a webview reload can orphan work. This is the main lesson from T3 Code.
2. **It avoids a Node dependency for the first release.** OpenCode exposes sessions, permissions, events, PTYs, forks, and worktrees over a local HTTP API. Arc already defaults to OpenCode. Codex adds a second protocol with a Rust binary. Claude and ACP can wait until the Node decision is explicit.
3. **It satisfies the product requirement.** A project rail plus per-project thread list is independent of the editor's workspace. Multiple chats per project are first-class. Provider and model switching are per thread.
4. **It is the smallest complete change.** An overlay reuses the ThemeMaker pattern and preserves editor state. A new Rust module reuses `process.rs`. No router, no state library, no `App.tsx` split.
5. **It is safer than a chat-only UI.** Supervised defaults, approvals, diff review, project trust, env stripping, and process-tree kill are part of v1, not afterthoughts.
6. **It leaves room to grow.** The project → thread → run → item model supports resume, search, diffs, checkpoints, worktrees, and a separate window without rewriting the UI.

### Why not the alternatives

- **Editor tab:** tied to the workspace tab strip; cannot show an independent project rail; collides with file tabs.
- **Sidebar panel:** too narrow; fights the file tree; implies the same workspace.
- **Plugin panel:** current plugin views render as editor tabs; no independent surface.
- **Separate window now:** viable and closer to Cursor, but adds cross-window state sync and capability scope before the core model is proven. Keep it as Phase 3.
- **ACP-first:** broad coverage, but Node adapters and uneven capabilities make it a heavy first step. Add after OpenCode/Codex.
- **Terminal-only:** fastest, but no approvals, diffs, or structured history; use only as a spike.
- **Integrate T3 server:** large Node sidecar and overlapping scope; not a built-in default.

### Decisions needed before implementation

1. **Overlay or separate window for v1?** Overlay is less code; separate window matches Cursor and supports parallel visibility.
2. **Is OpenCode-only acceptable for the first release?** If Claude/Codex must ship at launch, the Node dependency decision moves into Phase 1.
3. **Does Arc expose its MCP endpoint to agents in v1?** It is useful, but it adds tool-surface and token-management risk.

No implementation was performed. This document is research only.
