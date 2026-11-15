# Graph Report - vdb-ide  (2026-11-16)

## Corpus Check
- 49 files · ~90,330 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: .css 15, (none) 1, .icns 1)

## Summary
- 1020 nodes · 1960 edges · 59 communities (42 shown, 17 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 59 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5c4d866e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Plugin Runtime Core
- Rust Backend Commands
- App Shell and Editor
- Managed Process Registry
- Release Workflow
- Plugin Hook Surface
- Agent Kit Build Wizard
- GitHub Panel and Terminal Output
- Rust Test Suite
- Runtime State and Mutexes
- Git and GitHub Commands
- Theme and Font Settings
- Settings UI and Updater
- Tauri App Configuration
- AtomicU64
- Frontend Dependencies
- Plugin Editor Providers
- PluginPanel.tsx
- File Watcher Runtime
- Arc IDE — Repository Audit
- App TS Config
- Arc Desktop IDE
- Terminal Spawning and Output
- Dev Dependencies
- Node TS Config
- Editor Language Support
- handle_local_request
- external_command
- TerminalView.tsx
- Plugin Socket and HTTP Bridge
- ThemeMaker.tsx
- plugin_local_server_start
- @codemirror/state
- react-icons
- MCP Bridge Client
- @codemirror/language
- @lezer/highlight
- react-dom
- Plugin Language Providers
- Plugin Process and Language Server
- Vite Build Configuration
- Plugin Inline Widgets
- Tauri Capability Scope
- NPM Scripts
- Arc MCP Request Handling
- Arc App Icons
- Import Glob Types
- Rust Entry and Migration
- AppImage Installer Script
- Workspace Edit Diff Overlay
- Root TS References
- CodeMirror Commands Dep
- react-markdown
- Arc Binary Target
- @tauri-apps/plugin-clipboard-manager

## God Nodes (most connected - your core abstractions)
1. `usePluginRuntime()` - 66 edges
2. `App()` - 31 edges
3. `activate()` - 30 edges
4. `compilerOptions` - 17 edges
5. `git_command()` - 16 edges
6. `ProcessManager` - 14 edges
7. `require_success()` - 14 edges
8. `compilerOptions` - 14 edges
9. `Arc Desktop IDE` - 14 edges
10. `Arc Plugin API Reference` - 14 edges

## Surprising Connections (you probably didn't know these)
- `14. No frontend tests cover the data-loss paths — repo-wide` --references--> `removeNestedEntries()`  [INFERRED]
  ARC_AUDIT.md → src/App.tsx
- `App()` --indirect_call--> `loadSettings()`  [INFERRED]
  src/App.tsx → src/lib/settings.ts
- `plugin_process_exec()` --references--> `ProcessManager`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/process.rs
- `plugin_process_spawn()` --references--> `ProcessManager`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/process.rs
- `plugin_process_stop()` --references--> `ProcessManager`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/process.rs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Arc Desktop App Icon Family (5 sizes, same artwork)** — src_tauri_icons_128x128_arc_app_icon_128, src_tauri_icons_128x128_2x_arc_app_icon_256, src_tauri_icons_32x32_arc_app_icon_32, src_tauri_icons_64x64_arc_app_icon_64, src_tauri_icons_icon_arc_app_icon_master [EXTRACTED 1.00]
- **ThemeDefinition Format Convergence** — agents_theme_definition, arc_agent_kit_theme_anatomy, t3code_theme_theme_system, plugin_api_namespaces [INFERRED 0.75]
- **Arc Plugin Extension Pipeline** — arc_agent_kit_plugin_anatomy, arc_agent_kit_validation, plugin_api_namespaces, plugin_api_ui_contributions, agents_plugin_runtime [INFERRED 0.85]

## Communities (59 total, 17 thin omitted)

### Community 0 - "Plugin Runtime Core"
Cohesion: 0.02
Nodes (86): ActivePlugin, arcMcpToken, authProviders, builtinPackages, configurationStore, contentProviders, customEditors, debugAdapters (+78 more)

### Community 1 - "Rust Backend Commands"
Cohesion: 0.03
Nodes (34): APPIMAGE_ENV_REMOVE, APPIMAGE_PATH_LISTS, find_executable(), LOCAL_SERVER_IGNORED_NAMES, local_server_serves_files_blocks_traversal_and_reloads(), MAX_SERVER_CONNECTIONS, PendingUpdate, plugin_process_which() (+26 more)

### Community 2 - "App Shell and Editor"
Cohesion: 0.04
Nodes (58): 14. No frontend tests cover the data-loss paths — repo-wide, prettier@^3.9.10, prettier, App(), askDirtyChoice(), buildCodeHighlighting(), BuildWizard, confirmDialog() (+50 more)

### Community 3 - "Managed Process Registry"
Cohesion: 0.07
Nodes (11): create(), JobHandle, log(), ManagedProcess, prepare_command(), ProcessManager, Registry, STOP_GRACE (+3 more)

### Community 4 - "Release Workflow"
Cohesion: 0.05
Nodes (44): runs-on, steps, strategy, if, needs, runs-on, steps, GH_TOKEN (+36 more)

### Community 5 - "Plugin Hook Surface"
Cohesion: 0.06
Nodes (41): addPluginLanguageProvider(), configurationEntries(), configurationStorageKey(), connectPluginSocket(), currentVisibility(), extensionOf(), getConfigurationValue(), joinNativePath() (+33 more)

### Community 6 - "Agent Kit Build Wizard"
Cohesion: 0.11
Nodes (31): BuilderLaunch, BuildWizard(), COLOR_LABELS, META, MODES, QuestionId, artifactPath(), BuilderTarget (+23 more)

### Community 7 - "GitHub Panel and Terminal Output"
Cohesion: 0.08
Nodes (30): @tauri-apps/api@^2.8.0, @tauri-apps/api, GithubChange, githubFailedWorkspaces, githubLoadedWorkspaces, GithubPanel(), githubPendingLoads, GithubStatus (+22 more)

### Community 8 - "Rust Test Suite"
Cohesion: 0.21
Nodes (29): activate(), cleanupTests(), closeDiffOverlay(), dataTests(), detailText(), editorTests(), ensureTemp(), expect() (+21 more)

### Community 9 - "Runtime State and Mutexes"
Cohesion: 0.09
Nodes (19): LocalHttpServerState, plugin_http_respond(), plugin_http_server_stop(), plugin_local_server_stop(), plugin_process_close_stdin(), plugin_process_spawn(), plugin_process_stop(), plugin_process_write() (+11 more)

### Community 10 - "Git and GitHub Commands"
Cohesion: 0.17
Nodes (28): describe_change(), git_command(), git_config_value(), git_output(), github_commit(), github_configure_identity(), github_create_branch(), github_create_repo() (+20 more)

### Community 11 - "Theme and Font Settings"
Cohesion: 0.12
Nodes (14): APP_SETTINGS_VERSION, APP_THEME_OPTIONS, APP_THEMES, AppTheme, AppThemeDefinition, DEFAULT_SETTINGS, GLASS_BLUR, loadSettings() (+6 more)

### Community 12 - "Settings UI and Updater"
Cohesion: 0.11
Nodes (24): SettingsPanel, readVar(), Select(), SelectOption, editorFonts, fontAvailability, FontFamilySetting(), fontNameFromStack() (+16 more)

### Community 13 - "Tauri App Configuration"
Cohesion: 0.08
Nodes (23): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+15 more)

### Community 14 - "AtomicU64"
Cohesion: 0.13
Nodes (15): acquire_connection_slot(), bounds_concurrent_server_connections(), build_local_server_filter(), ConnectionSlot, create_local_http_server(), local_file_signature(), LocalHttpServer, PLUGIN_HTTP_COUNTER (+7 more)

### Community 15 - "Frontend Dependencies"
Cohesion: 0.12
Nodes (17): dependencies, @codemirror/autocomplete@^6.18.6, @codemirror/search@^6.5.11, @codemirror/view@^6.38.6, remark-gfm@^4.0.1, rioterm@^0.1.8, @tauri-apps/plugin-dialog@^2.4.0, @tauri-apps/plugin-fs@^2.4.0 (+9 more)

### Community 16 - "Plugin Editor Providers"
Cohesion: 0.26
Nodes (21): applyPluginWorkspaceEdit(), locationLabel(), normalizeLocation(), normalizeLocationList(), openPluginLocation(), pluginCodeActions(), pluginDocumentSymbols(), pluginExpandSelection() (+13 more)

### Community 17 - "PluginPanel.tsx"
Cohesion: 0.22
Nodes (5): PluginPanel, PluginDocs, PluginPanel(), InstalledPlugin, PluginPanelContribution

### Community 18 - "File Watcher Runtime"
Cohesion: 0.21
Nodes (12): build_watch_filter(), FsEvent, is_watch_ignored(), list_catch_up_events(), map_fs_event(), relative_watch_path(), run_local_server_watcher(), watch_directory_tree() (+4 more)

### Community 19 - "Arc IDE — Repository Audit"
Cohesion: 0.10
Nodes (19): 10. `plugin_trash_path` trusts any absolute path — `src-tauri/src/lib.rs:1488-1515`, 11. Dead state module and dead terminal settings — `src/lib/workspaceState.ts`, `src/lib/settings.ts:54,59,62`, `src/components/SettingsPanel.tsx:407-408,417`, 12. API Tester dev harness ships in every build — `plugins/api-tester/main.js`, `plugins/api-tester/plugin.json`, `src/lib/pluginRuntime.ts:23-24`, 13. Double-open can create duplicate tabs — `src/App.tsx:2986-3037`, 1. Unsaved edits die on window close and automatic update — `src/App.tsx:1624-1631`, `src/App.tsx:1724-1735`, `src-tauri/src/lib.rs:3444`, 2. Opening another folder discards dirty buffers — `src/App.tsx:2934-2984`, 3. Delete removes dirty buffers and cannot undo unsaved edits — `src/App.tsx:3576-3662`, 4. Save truncates the real file instead of writing atomically — `src/App.tsx:3062-3133` (+11 more)

### Community 20 - "App TS Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleDetection, moduleResolution, noEmit (+10 more)

### Community 21 - "Arc Desktop IDE"
Cohesion: 0.06
Nodes (51): App.tsx Monolith, Arc Desktop IDE, Live File Watcher, Graphify Knowledge Graph, Plugin Runtime (lib/pluginRuntime.ts), Tag-Driven Release Pipeline, Settings Module and AppSettings, Tauri Capability Scopes (+43 more)

### Community 22 - "Terminal Spawning and Output"
Cohesion: 0.13
Nodes (15): emit_terminal_output(), HiddenPathGrant, read_terminal_output(), save_builder_prompt(), stream_process_output(), terminal_spawn(), UpdateDownloadEvent, Finished (+7 more)

### Community 23 - "Dev Dependencies"
Cohesion: 0.19
Nodes (13): devDependencies, @tauri-apps/cli@^2.8.4, @types/react@^19.0.10, @types/react-dom@^19.0.4, typescript@~5.7.2, name, private, type (+5 more)

### Community 24 - "Node TS Config"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, lib, module, moduleDetection, moduleResolution, noEmit, noUnusedLocals (+7 more)

### Community 25 - "Editor Language Support"
Cohesion: 0.14
Nodes (14): @codemirror/lang-css@^6.3.1, @codemirror/lang-html@^6.4.9, @codemirror/lang-javascript@^6.2.3, @codemirror/lang-json@^6.0.2, @codemirror/lang-markdown@^6.3.2, @codemirror/lang-php@^6.0.2, @codemirror/lang-css, @codemirror/lang-html (+6 more)

### Community 26 - "handle_local_request"
Cohesion: 0.21
Nodes (14): handle_local_request(), handle_plugin_http_connection(), http_reason(), HttpReply, inject_live_reload(), maps_http_reason_phrases(), mime_type(), plugin_http_server_start() (+6 more)

### Community 27 - "external_command"
Cohesion: 0.22
Nodes (8): appimage_env(), appimage_env_edits(), external_command(), gh_command(), github_auth_status(), plugin_process_exec(), ProcessExecResult, strips_appimage_environment_for_child_processes()

### Community 28 - "TerminalView.tsx"
Cohesion: 0.27
Nodes (10): backgroundAlpha(), colorChannels(), isDark(), TerminalSession, TerminalSettings, terminalTheme(), TerminalView(), withCellAlpha() (+2 more)

### Community 29 - "Plugin Socket and HTTP Bridge"
Cohesion: 0.19
Nodes (11): copy_directory(), now_millis(), plugin_socket_close(), plugin_socket_connect(), plugin_socket_write(), plugin_trash_path(), PluginSocketConnection, Pipe (+3 more)

### Community 30 - "ThemeMaker.tsx"
Cohesion: 0.16
Nodes (18): lucide-react@^0.468.0, react@^19.0.0, lucide-react, react, hexWithRgb(), hsvFromRgb(), rgbFromHex(), rgbFromHsv() (+10 more)

### Community 31 - "plugin_local_server_start"
Cohesion: 0.25
Nodes (9): decode_url_path(), directory_listing(), encode_url_path(), hex_value(), html_escape(), local_server_encodes_file_urls(), local_server_info(), LocalServerInfo (+1 more)

### Community 34 - "MCP Bridge Client"
Cohesion: 0.27
Nodes (11): connectMcp(), createMcpHttpClient(), createMcpStdioClient(), disconnectMcp(), emitMcpEvent(), ensureArcMcpServer(), exposeMcp(), handleMcpHostRequest() (+3 more)

### Community 38 - "Plugin Language Providers"
Cohesion: 0.48
Nodes (7): activeLanguageBase(), activeLanguageContext(), languageProvidersForKind(), pluginCompletionSource(), pluginFoldingExtension, pluginHoverExtension, renderPluginHover()

### Community 39 - "Plugin Process and Language Server"
Cohesion: 0.33
Nodes (7): ensurePluginProcessBus(), pathToUri(), pluginProcessSink(), pushPendingChunk(), schedulePluginProcessSinkCleanup(), spawnPluginProcess(), startPluginLanguageServer()

### Community 40 - "Vite Build Configuration"
Cohesion: 0.33
Nodes (4): @vitejs/plugin-react@^4.4.1, vite@^6.1.0, vite, @vitejs/plugin-react

### Community 42 - "Tauri Capability Scope"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 43 - "NPM Scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, preview, tauri

### Community 44 - "Arc MCP Request Handling"
Cohesion: 0.50
Nodes (5): handleArcMcpRequest(), mcpContentResult(), mcpExposureDefinition(), mcpExposureName(), mcpTemplateMatches()

### Community 45 - "Arc App Icons"
Cohesion: 0.40
Nodes (5): Arc App Icon 128x128@2x (256px), Arc App Icon 128x128, Arc App Icon 32x32, Arc App Icon 64x64, Arc App Icon Master (icon.png)

### Community 47 - "Rust Entry and Migration"
Cohesion: 0.83
Nodes (3): app_data_root(), main(), migrate_app_data()

### Community 49 - "Workspace Edit Diff Overlay"
Cohesion: 0.67
Nodes (3): normalizeWorkspaceEdit(), showDiffOverlay(), uriToPath()

## Knowledge Gaps
- **19 isolated node(s):** `Finished`, `Progress`, `Started`, `arc`, `Vite HTML Entry` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 393 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Arc Agent Kit` connect `Arc Desktop IDE` to `Agent Kit Build Wizard`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `usePluginRuntime()` (e.g. with `pluginCodeActions()` and `pluginConditionMatches()`) actually correct?**
  _`usePluginRuntime()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Finished`, `Progress`, `Started` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Plugin Runtime Core` be split into smaller, more focused modules?**
  _Cohesion score 0.02323799795709908 - nodes in this community are weakly interconnected._
- **Why does `Arc Plugin API Reference` connect `Arc Desktop IDE` to `PluginPanel.tsx`, `Agent Kit Build Wizard`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `activate()` (e.g. with `cleanupTests()` and `manualUiTests()`) actually correct?**
  _`activate()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Should `Rust Backend Commands` be split into smaller, more focused modules?**
  _Cohesion score 0.031582952815829526 - nodes in this community are weakly interconnected._