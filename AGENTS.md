# AGENTS.md

Guide for AI coding agents working on Arc. Read this before exploring the codebase; it maps the project so you don't have to.

## What this project is

**Arc** is a desktop workspace for web development: file browser, code editor (CodeMirror 6), terminal (xterm + PTY), GitHub panel (git/gh integration), and a JavaScript plugin system, in one Tauri window.

- Package name: `arc-ide`, version `0.1.2`, identifier `dev.arc.ide`
- Stack: **Tauri 2** (Rust backend) + **React 19** + **TypeScript** (strict) + **Vite 6** frontend
- Editor: **CodeMirror 6**. Terminal: **xterm** + **portable-pty**. Formatting: **Prettier 3** embedded in the app
- Primary dev/target platform: **Linux (Omarchy/Arch)**. Release builds also target Windows and macOS via CI
- No router, no state library, no test framework on the frontend. Backend has Rust unit tests inside `src-tauri/src/lib.rs`

## Repository layout

```
index.html               Vite entry
src/                     Frontend (React + TS)
  App.tsx                App shell and most UI
  components/            React components with colocated CSS
  lib/                   Plugin runtime, settings, terminal and workspace logic
  styles/                Global and shared CSS
src-tauri/               Rust backend (Tauri 2)
  src/lib.rs             ALL Tauri commands + tests (~1600 lines)
  src/main.rs            Entry: NVIDIA/Wayland workaround + app-data migration
  capabilities/          Tauri permission scopes
plugins/                 Built-in plugins (live-server, xampp)
dist/                    Build output (gitignored)
.github/workflows/       release.yml — tag-driven release pipeline
```

### Frontend files (`src/`)

| File | Role |
| --- | --- |
| `App.tsx` | **Monolith (~4300 lines).** App shell, file tree, tabs, nested editor splits (`SplitContainer`, `EditorPane`), command palette, context menus, search, workspace state. Most UI work happens here |
| `lib/pluginRuntime.ts` | Plugin loader + full plugin API (`api.files`, `api.editor`, `api.terminal`, `api.ui`, `api.events`, `api.storage`, ...). Built-in plugins are inlined at build time via `import.meta.glob` of `../../plugins/*` |
| `lib/settings.ts` | `AppSettings` type, `DEFAULT_SETTINGS`, `ThemeColors`/`ThemeDefinition`, `BUILTIN_THEMES`, theme CSS generation, settings persistence |
| `components/SettingsPanel.tsx` | Settings UI |
| `components/GithubPanel.tsx` | GitHub panel UI (calls `github_*` Tauri commands) |
| `components/PluginPanel.tsx` | Plugin manager UI (install/enable/disable/remove) |
| `components/ThemeMaker.tsx`, `components/ThemeColorPicker.tsx` | Custom theme editor |
| `components/TerminalView.tsx` | xterm terminal component (lazy loaded) |
| `lib/terminalOutput.ts` | Global `terminal-output` event buffer (2 MB cap/session) so terminals survive tab switches |
| `main.tsx` | React root |
| `styles/` | Global styles and shared controls |
| `components/*.css` | Colocated styles per component (e.g. `GithubPanel.auth.css`) |

### Backend (`src-tauri/src/lib.rs`)

All Tauri commands, registered in `run()` via `generate_handler!`:

- **Terminal**: `terminal_spawn`, `terminal_write`, `terminal_resize`, `terminal_close` — portable-pty sessions, output streamed via `terminal-output` event
- **Workspace access gating**: `workspace_pick`, `workspace_access_allowed`, `workspace_grant_access`, `workspace_allow_hidden_paths`
- **GitHub**: `github_status`, `github_configure_identity`, `github_stage`, `github_commit`, `github_fetch`, `github_pull`, `github_push`, `github_switch_branch`, `github_create_branch`, `github_create_repo` — shell out to `git` and `gh` CLIs (external dependencies; panel shows setup instructions when missing)
- **Plugin support**: `plugin_local_server_start`/`stop` (embedded HTTP server with live-reload injection, path-traversal protection), `plugin_process_is_running` (Linux-only)
- **Window**: `set_native_background_blur` (window-vibrancy; Linux build pins a git rev, see `Cargo.toml`)

Unit tests live in `#[cfg(test)] mod tests` at the bottom of `lib.rs` (git status parsing, local server serving/traversal/reload, URL encoding).

`main.rs` sets `__NV_DISABLE_EXPLICIT_SYNC=1` on NVIDIA/Wayland and migrates app data dir `dev.glasswing.ide` → `dev.arc.ide`.

## Commands

Run from repo root:

```sh
npm install                 # frontend deps
npm run tauri dev           # dev app (Vite on :1420, hot reload)
npm run build               # typecheck (tsc -b) + production frontend build
npm run tauri build         # full release build (installers)
cargo test                  # Rust unit tests (run in src-tauri/)
cargo fmt && cargo clippy   # Rust lint/format
```

There is **no frontend test runner**; `npm run build` doubles as the typecheck gate. Verify frontend changes with `npm run build` plus manual testing via `npm run tauri dev`. Verify Rust changes with `cargo test` in `src-tauri/`.

## Conventions and gotchas

- **TypeScript is strict** with `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` (use `import type` for types).
- **`App.tsx` is deliberately a monolith.** Follow the existing pattern; don't split it or introduce a state library unless asked.
- **Frontend reads/writes files directly via `@tauri-apps/plugin-fs`**, not custom commands. Custom Rust commands exist only for what plugin-fs can't do (PTY, git/gh, HTTP server, blur, gating).
- **Tauri capability scopes are security-relevant.** `src-tauri/capabilities/default.json` restricts fs access to `$HOME`, `$DOCUMENT`, `$DOWNLOAD`, `$APPDATA` and allows opening URLs only for `http://127.0.0.1:*`, `github.com`, `cli.github.com`, `git-scm.com`. Update scopes deliberately; don't widen them casually. CSP is `null` (plugin system needs broad JS).
- **Built-in plugins are bundled raw**: files under `plugins/*/main.js` are self-contained ES modules (no bare package imports), read as strings at build time and executed in the plugin runtime. Keep them dependency-free.
- **Settings shape is versioned** (`APP_SETTINGS_VERSION` in `lib/settings.ts`). When adding a setting, add it to `AppSettings`, `DEFAULT_SETTINGS`, and the settings merge/migration logic, then wire UI in `components/SettingsPanel.tsx`.
- **Themes** are `ThemeDefinition` objects (~30 color slots); themes apply by generating CSS (`themeCss`). New UI colors should map to theme slots, not hardcoded hex.
- **Versions must stay in sync** across `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` — the release workflow enforces this on tags.
- `dist/`, `src-tauri/target/`, `src-tauri/gen/` are build artifacts (gitignored). Don't edit.
- Linux-only features (XAMPP plugin, `plugin_process_is_running`) are gated at runtime; don't assume cross-platform.

## Docs in the repo

| File | Purpose |
| --- | --- |
| `README.md` | User-facing overview, shortcuts, install |
| `PLUGIN_API.md` | Full plugin API reference (keep in sync when changing the plugin API) |
| `FILE_WATCHER.md` | Spec + notes for live file watching (notify-debouncer-full → `fs-changed` events → tree reducer). **Implemented**: `watch_project`/`unwatch_project` in `src-tauri/src/lib.rs`, listener + delta reducer in `src/App.tsx` |
| `apple-design.md` | Design direction: Apple/Xcode-inspired, layered translucent surfaces, content-first, minimal borders. Follow for UI work |

## Release process

1. Bump version in all three files (`package.json`, `tauri.conf.json`, `Cargo.toml`) to match.
2. Merge to `main`; tag must be on `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/release.yml` builds Linux (deb/rpm/AppImage), Windows (msi/nsis), macOS (universal dmg) and publishes a GitHub Release with generated notes.
