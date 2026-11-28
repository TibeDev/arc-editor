# AGENTS.md

Guide for AI coding agents working on Arc. Read this before exploring the codebase; it maps the project so you don't have to.

## What this project is

**Arc** is a desktop workspace for web development: file browser, code editor (CodeMirror 6), terminal (rioterm + PTY), web preview, GitHub panel (git/gh integration), a JavaScript plugin system, and a plugin/theme Build wizard, in one Tauri window.

- Package name: `arc-ide`, version `0.1.2`, identifier `dev.arc.ide`
- Stack: **Tauri 2** (Rust backend) + **React 19** + **TypeScript** (strict) + **Vite 6** frontend
- Editor: **CodeMirror 6**. Terminal: **rioterm** (WASM) + **portable-pty**. Formatting: **Prettier 3** embedded in the app
- Other frontend libraries: **JSZip** (plugin ZIP import), **react-markdown** + **remark-gfm** (plugin API docs), **lucide-react** icons
- Primary dev/target platform: **Linux (Omarchy/Arch)**. Release builds also target Windows and macOS via CI
- No router, no state library, no frontend test framework. Backend tests live in `src-tauri/src/lib.rs`

## Repository layout

```
index.html               Vite entry
src/                     Frontend (React + TS)
  App.tsx                App shell and most UI
  components/            React components with colocated CSS
  lib/                   Plugin runtime, settings, agent kit, agents workspace, terminal and updater logic
  lib/agents/            Agent store, typed IPC wrappers, event listeners, sanitization
  components/agents/     Agents overlay UI (sidebar, transcript, composer, approvals, questions)
  styles/                Global and shared CSS
src-tauri/               Rust backend (Tauri 2)
  src/lib.rs             ALL Tauri commands + tests (~4100 lines)
  src/process.rs         Managed child-process registry (process groups / Windows job objects)
  src/agent/             Rust AgentManager, OpenCode adapter, persistence, recovery, permissions
  src/main.rs            Entry: NVIDIA/Wayland workaround + app-data migration
  capabilities/          Tauri permission scopes
plugins/                 Built-in plugins (live-server, xampp; api-tester is dev-only)
research/                Design research notes (currently webview-panel.md)
graphify-out/            Knowledge graph output
install-appimage.sh      Linux AppImage installer + launcher entry
.github/workflows/       release.yml — tag-driven release pipeline
dist/                    Build output (gitignored)
```

### Frontend files (`src/`)

| File | Role |
| --- | --- |
| `App.tsx` | **Monolith (~6100 lines).** App shell, file tree, tabs, nested editor splits (`SplitContainer`, `EditorPane`), image viewer, command palette, context menus, search, workspace/watcher state, keybindings. Most UI work happens here |
| `lib/pluginRuntime.ts` | Plugin loader + full plugin API (`api.files`, `api.editor`, `api.terminal`, `api.ui`, `api.events`, `api.storage`, `api.process`, `api.mcp`, ...). Plugin ZIP import, built-in plugin inlining via `import.meta.glob`, language/editor contributions |
| `lib/settings.ts` | `AppSettings` type, `DEFAULT_SETTINGS`, `ThemeColors`/`ThemeDefinition`, `BUILTIN_THEMES`, app themes, theme CSS generation, settings persistence/migration |
| `lib/terminalOutput.ts` | Global `terminal-output` event buffer (2 MB cap/session) so terminals survive tab switches |
| `lib/updater.ts` | Shared updater types used by the Rust updater commands |
| `lib/dialog.ts` | Native-looking Arc dialog wrapper around plugin-dialog |
| `lib/agent/kit.ts`, `lib/agent/builders.ts` | Build tab prompts, agent CLI commands, plugin/theme brief generation |
| `components/SettingsPanel.tsx` | Settings UI for editor, terminal, appearance, AI agent, updates, notifications, plugins |
| `components/GithubPanel.tsx` | GitHub panel UI (calls `github_*` Tauri commands) |
| `components/PluginPanel.tsx` | Plugin manager UI (ZIP import, enable/disable, uninstall, API docs) |
| `components/BuildWizard.tsx` | Plugin/theme brief wizard and AI launch/copy-prompt flow |
| `components/WebPreview.tsx` | Iframe preview for dev servers and workspace files (calls `preview_*` commands) |
| `components/ThemeMaker.tsx`, `components/ThemeColorPicker.tsx` | Custom theme editor |
| `components/TerminalView.tsx` | rioterm terminal component (lazy loaded) |
| `components/TitleBar.tsx`, `components/Select.tsx` | Custom title bar and shared select control |
| `main.tsx` | React root |
| `styles/` | Global styles, shared controls, theme CSS variables |
| `components/*.css` | Colocated styles per component (e.g. `GithubPanel.auth.css`) |

### Backend (`src-tauri/src/lib.rs`)

All Tauri commands, registered in `run()` via `generate_handler!`:

- **Terminal**: `terminal_spawn`, `terminal_write`, `terminal_resize`, `terminal_close` — portable-pty sessions, output streamed via `terminal-output` event
- **Workspace access gating**: `workspace_pick`, `workspace_access_allowed`, `workspace_grant_access`, `workspace_allow_hidden_paths`, `save_builder_prompt` — persisted workspace permissions and Build-tab prompt files
- **File watching**: `watch_project`, `unwatch_project` — notify-debouncer-full watcher, emits `fs-changed` delta events
- **GitHub**: `github_status`, `github_diff`, `github_configure_identity`, `github_auth_status`, `github_stage`, `github_stage_all`, `github_unstage_all`, `github_commit`, `github_fetch`, `github_pull`, `github_push`, `github_switch_branch`, `github_create_branch`, `github_create_repo` — shell out to `git` and `gh` CLIs (external dependencies; panel shows setup instructions when missing)
- **Plugin processes**: `plugin_process_is_running`, `plugin_process_spawn`, `plugin_process_write`, `plugin_process_close_stdin`, `plugin_process_stop`, `plugin_process_exec`, `plugin_process_which` — managed by `process.rs`
- **Plugin network/secrets**: `plugin_socket_connect`, `plugin_socket_write`, `plugin_socket_close`, `plugin_http_server_start`, `plugin_http_respond`, `plugin_http_server_stop`, `plugin_secret_set`, `plugin_secret_get`, `plugin_secret_delete` (keyring)
- **Plugin files**: `plugin_trash_path`
- **Local servers and preview**: `plugin_local_server_start`/`stop` (live-reload injection, path-traversal protection), `preview_server_start`/`stop`, `preview_frame_check`, `open_external_url`
- **Updates**: `updater_check`, `updater_install` — signed GitHub release endpoints, Stable/Beta channels
- **Window**: `set_native_background_blur` (window-vibrancy; Linux build pins a git rev, see `Cargo.toml`)

Unit tests live in `#[cfg(test)] mod tests` at the bottom of `lib.rs` (git status parsing, GitHub remote URLs, local server serving/traversal/reload, URL encoding, frame headers, connection limits, watcher event mapping/ignore rules, updater channels/events, AppImage env handling).

`main.rs` sets `__NV_DISABLE_EXPLICIT_SYNC=1` on NVIDIA/Wayland and migrates app data dir `dev.glasswing.ide` → `dev.arc.ide`.

## Commands

Run from repo root:

```sh
npm install                 # frontend deps
npm run tauri dev           # dev app (Vite on :1420, hot reload)
npm run build               # typecheck (tsc -b) + production frontend build
npm run tauri build         # full release build (installers)
(cd src-tauri && cargo test)             # Rust unit tests
(cd src-tauri && cargo fmt && cargo clippy) # Rust lint/format
```

There is **no frontend test runner**; `npm run build` doubles as the typecheck gate. Verify frontend changes with `npm run build` plus manual testing via `npm run tauri dev`. Verify Rust changes with `cargo test` in `src-tauri/`.

## Conventions and gotchas

- **TypeScript is strict** with `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` (use `import type` for types).
- **`App.tsx` is deliberately a monolith.** Follow the existing pattern; don't split it or introduce a state library unless asked.
- **Frontend reads/writes files directly via `@tauri-apps/plugin-fs`**, not custom commands. Custom Rust commands exist only for what plugin-fs can't do (PTY, git/gh, HTTP servers, watcher, child processes, secrets, blur, gating).
- **Tauri capability scopes are security-relevant.** `src-tauri/capabilities/default.json` restricts fs access to `$HOME`, `$DOCUMENT`, `$DOWNLOAD`, `$APPDATA` and allows opening URLs only for `http://127.0.0.1:*`, `github.com`, `cli.github.com`, `git-scm.com`. Update scopes deliberately; don't widen them casually. CSP is `null` (plugin system needs broad JS).
- **Built-in plugins are bundled raw**: files under `plugins/*/main.js` are self-contained ES modules (no bare package imports), read as strings at build time and executed in the plugin runtime. Keep them dependency-free. The production glob excludes `plugins/api-tester`.
- **Plugin ZIP import lives in `lib/pluginRuntime.ts`.** It uses JSZip, accepts `plugin.json`/`main.js` at the ZIP root or inside one folder, and must reject imports missing either file. Startup loading also rejects installed plugins with no `main.js`. Preserve both checks.
- **Agents state lives in Rust, not React.** `AgentManager` owns projects, threads, runs, transcripts, approvals, and the OpenCode provider process. App data lives under `$APPDATA/dev.arc.ide/agent/` as JSON indexes plus per-thread JSONL. Do not put agent projects, threads, or messages in settings or `localStorage`. `App.tsx` keeps only the `agentsOpen` flag. Provider switching requires a new thread.
- **Agents support OpenCode, Codex, and Claude behind one manager.** `src/agent/opencode.rs` pins the OpenCode 1.x legacy `/session` surface (`>=1.19.5, <2.0.0`, loopback, Basic auth). `src/agent/codex.rs` speaks the Codex `app-server` JSON-RPC protocol over stdio. `src/agent/acp.rs` speaks ACP v1 JSON-RPC over stdio to `@agentclientprotocol/claude-agent-acp` (or `claude-agent-acp` on PATH); the ACP wrapper needs Node and the Claude CLI login. One provider process runs at a time. Supervised mode maps to native provider approvals; it is not a sandbox. Keep prompts, passwords, and environment values out of logs and JSON files.
- **Chat worktrees:** after the first chat in a Git project, new chats get a detached `git worktree` under `$APPDATA/dev.arc.ide/agent/worktrees/<thread-id>`. Provider `cwd` uses that worktree when it exists. Deleting the chat or removing the project force-removes the worktree, so the UI confirms that worktree changes are discarded. Keep the main project path for the first chat so the workspace opens normally.
- **Settings shape is versioned** (`APP_SETTINGS_VERSION` in `lib/settings.ts`, currently `9`). When adding a setting, add it to `AppSettings`, `DEFAULT_SETTINGS`, and the settings merge/migration logic, then wire UI in `components/SettingsPanel.tsx`. `agentEnabledProviderIds` controls which providers appear in Agents and which starts automatically.
- **Themes** are `ThemeDefinition` objects (35 color slots). `appTheme` controls interface style, `selectedTheme` controls editor colors. Themes apply by generating CSS (`themeCss`). New UI colors should map to theme slots, not hardcoded hex.
- **Versions must stay in sync** across `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` — the release workflow enforces this on tags.
- **The updater** uses signed GitHub releases. Stable tags point at `releases/latest`; hyphenated pre-release tags publish to a `beta` release pointer. Do not change endpoints without updating `tauri.conf.json` and the release workflow.
- `dist/`, `src-tauri/target/`, `src-tauri/gen/` are build artifacts (gitignored). Don't edit.
- Linux-only features (XAMPP plugin, `plugin_process_is_running`, native background blur) are gated at runtime; don't assume cross-platform.

## Docs in the repo

| File | Purpose |
| --- | --- |
| `README.md` | User-facing overview, shortcuts, install, plugin import |
| `PLUGIN_API.md` | Full plugin API reference (keep in sync when changing the plugin API) |
| `ARC_AGENT_KIT.md` | Agent-facing contract for the Build tab wizard (plugin + theme generation, install handshake). Keep in sync with plugin and theme formats |
| `research/webview-panel.md` | Research notes for the web preview feature, including Linux child-webview limits |
| `graphify-out/GRAPH_REPORT.md` | Generated knowledge graph report; see the graphify section below |

## Release process

1. Bump version in all three files (`package.json`, `tauri.conf.json`, `Cargo.toml`) to match.
2. Stable release: tag on `main` as `vX.Y.Z`. Pre-release: use a hyphenated tag such as `vX.Y.Z-beta.1`; the workflow requires it on the `pre-release` branch.
3. `.github/workflows/release.yml` builds Linux (deb/rpm/AppImage), Windows (msi/nsis), macOS (universal dmg) and publishes a GitHub Release with generated notes.
4. Hyphenated releases also update the `beta` release pointer used by the Beta update channel.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
