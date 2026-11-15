# Graph Report - vdb-ide  (2026-11-15)

## Corpus Check
- 55 files · ~91,467 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 18 file(s) not represented in the graph (top: .css 15, (none) 1, .icns 1)

## Summary
- 1018 nodes · 1966 edges · 58 communities (47 shown, 11 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 60 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

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
- Local HTTP Server Runtime
- Frontend Dependencies
- Plugin Editor Providers
- Plugin Manager UI
- File Watcher Runtime
- Workspace State Persistence
- App TS Config
- T3 Theme Design System
- Terminal Spawning and Output
- Dev Dependencies
- Node TS Config
- Editor Language Support
- Terminal View and Theme
- Project Overview and Audit Docs
- Auto-Updater Runtime
- Plugin Socket and HTTP Bridge
- React Entry and Color Picker
- Local Server URL Handling
- Plugin HTTP Server Protocol
- Updater Design Docs
- MCP Bridge Client
- Tauri Command and Security Docs
- Agent Kit Contract Docs
- Plugin API Reference Docs
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
- React Icons Dep
- Arc Binary Target

## God Nodes (most connected - your core abstractions)
1. `usePluginRuntime()` - 66 edges
2. `activate()` - 30 edges
3. `App()` - 29 edges
4. `compilerOptions` - 17 edges
5. `git_command()` - 14 edges
6. `ProcessManager` - 14 edges
7. `compilerOptions` - 14 edges
8. `Arc Desktop IDE` - 14 edges
9. `Arc Plugin API Reference` - 14 edges
10. `react` - 13 edges

## Surprising Connections (you probably didn't know these)
- `terminal_spawn()` --references--> `ProcessManager`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/process.rs
- `terminal_close()` --references--> `ProcessManager`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/process.rs
- `plugin_process_spawn()` --references--> `ProcessManager`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/process.rs
- `plugin_process_stop()` --references--> `ProcessManager`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/process.rs
- `plugin_process_exec()` --references--> `ProcessManager`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/process.rs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Arc Plugin Extension Pipeline** — arc_agent_kit_plugin_anatomy, arc_agent_kit_validation, plugin_api_namespaces, plugin_api_ui_contributions, agents_plugin_runtime [INFERRED 0.85]
- **Signed Auto-Update Release Flow** — auto_updater_signing_keys, auto_updater_latest_json, auto_updater_channels, auto_updater_tauri_action, auto_updater_beta_pointer, auto_updater_updater_install [EXTRACTED 1.00]
- **ThemeDefinition Format Convergence** — agents_theme_definition, arc_agent_kit_theme_anatomy, t3code_theme_theme_system, plugin_api_namespaces [INFERRED 0.75]
- **Arc Desktop App Icon Family (5 sizes, same artwork)** — src_tauri_icons_128x128_arc_app_icon_128, src_tauri_icons_128x128_2x_arc_app_icon_256, src_tauri_icons_32x32_arc_app_icon_32, src_tauri_icons_64x64_arc_app_icon_64, src_tauri_icons_icon_arc_app_icon_master [EXTRACTED 1.00]

## Communities (58 total, 11 thin omitted)

### Community 0 - "Plugin Runtime Core"
Cohesion: 0.02
Nodes (88): ActivePlugin, arcMcpToken, authProviders, builtinManifestSources, builtinPackages, builtinPluginSourceLoaders, configurationStore, contentProviders (+80 more)

### Community 1 - "Rust Backend Commands"
Cohesion: 0.03
Nodes (28): APPIMAGE_ENV_REMOVE, APPIMAGE_PATH_LISTS, find_executable(), LOCAL_SERVER_IGNORED_NAMES, local_server_serves_files_blocks_traversal_and_reloads(), MAX_SERVER_CONNECTIONS, plugin_process_which(), plugin_secret_delete() (+20 more)

### Community 2 - "App Shell and Editor"
Cohesion: 0.04
Nodes (52): prettier@^3.9.10, prettier, App(), buildCodeHighlighting(), BuildWizard, contentFingerprint(), ContextMenuState, DeletedEntry (+44 more)

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
Cohesion: 0.12
Nodes (29): BuilderLaunch, BuildWizard(), COLOR_LABELS, META, MODES, QuestionId, artifactPath(), BuilderTarget (+21 more)

### Community 7 - "GitHub Panel and Terminal Output"
Cohesion: 0.08
Nodes (27): GithubChange, githubFailedWorkspaces, githubLoadedWorkspaces, GithubPanel(), githubPendingLoads, GithubStatus, githubStatusCache, githubWorkspaceOrder (+19 more)

### Community 8 - "Rust Test Suite"
Cohesion: 0.21
Nodes (29): activate(), cleanupTests(), closeDiffOverlay(), dataTests(), detailText(), editorTests(), ensureTemp(), expect() (+21 more)

### Community 9 - "Runtime State and Mutexes"
Cohesion: 0.10
Nodes (20): plugin_http_respond(), plugin_http_server_stop(), plugin_process_close_stdin(), plugin_process_exec(), plugin_process_spawn(), plugin_process_stop(), plugin_process_write(), PluginHttpServerState (+12 more)

### Community 10 - "Git and GitHub Commands"
Cohesion: 0.16
Nodes (28): describe_change(), external_command(), gh_command(), git_command(), git_config_value(), git_output(), github_commit(), github_configure_identity() (+20 more)

### Community 11 - "Theme and Font Settings"
Cohesion: 0.11
Nodes (25): ThemeMaker, sample, ThemeMaker(), ResizeDirection, resizeHandles, TitleBar(), withWindow(), APP_SETTINGS_VERSION (+17 more)

### Community 12 - "Settings UI and Updater"
Cohesion: 0.11
Nodes (23): SettingsPanel, readVar(), Select(), SelectOption, editorFonts, fontAvailability, FontFamilySetting(), fontNameFromStack() (+15 more)

### Community 13 - "Tauri App Configuration"
Cohesion: 0.08
Nodes (23): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+15 more)

### Community 14 - "Local HTTP Server Runtime"
Cohesion: 0.14
Nodes (14): acquire_connection_slot(), bounds_concurrent_server_connections(), ConnectionSlot, create_local_http_server(), local_file_signature(), LocalHttpServer, PLUGIN_HTTP_COUNTER, PLUGIN_PROCESS_COUNTER (+6 more)

### Community 15 - "Frontend Dependencies"
Cohesion: 0.10
Nodes (21): dependencies, @codemirror/autocomplete@^6.18.6, @codemirror/language@^6.11.2, @codemirror/search@^6.5.11, @codemirror/state@^6.5.2, @codemirror/view@^6.38.6, react-dom@^19.0.0, rioterm@^0.1.8 (+13 more)

### Community 16 - "Plugin Editor Providers"
Cohesion: 0.26
Nodes (21): applyPluginWorkspaceEdit(), locationLabel(), normalizeLocation(), normalizeLocationList(), openPluginLocation(), pluginCodeActions(), pluginDocumentSymbols(), pluginExpandSelection() (+13 more)

### Community 17 - "Plugin Manager UI"
Cohesion: 0.11
Nodes (15): lucide-react@^0.468.0, react-markdown@^10.1.0, remark-gfm@^4.0.1, @tauri-apps/api@^2.8.0, @tauri-apps/plugin-opener@^2.7.2, lucide-react, react-markdown, remark-gfm (+7 more)

### Community 18 - "File Watcher Runtime"
Cohesion: 0.20
Nodes (12): build_local_server_filter(), build_watch_filter(), FsEvent, is_watch_ignored(), list_catch_up_events(), map_fs_event(), relative_watch_path(), run_local_server_watcher() (+4 more)

### Community 19 - "Workspace State Persistence"
Cohesion: 0.16
Nodes (17): deserializeLayoutNode(), isPlainStringArray(), isStoredGroup(), loadWorkspaceState(), normalizeWorkspacePath(), RestoredLayoutNode, saveWorkspaceState(), serializeLayoutNode() (+9 more)

### Community 20 - "App TS Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleDetection, moduleResolution, noEmit (+10 more)

### Community 21 - "T3 Theme Design System"
Cohesion: 0.17
Nodes (13): ThemeDefinition Theme System, Theme Anatomy (ThemeDefinition JSON), Modern Dark SaaS App Theme, Component Design System, 4px Spacing Scale, Theme Typography Scale, T3 Code Design System Specification, Component Hierarchy Architecture (+5 more)

### Community 22 - "Terminal Spawning and Output"
Cohesion: 0.15
Nodes (13): appimage_env(), appimage_env_edits(), emit_terminal_output(), HiddenPathGrant, read_terminal_output(), save_builder_prompt(), stream_process_output(), strips_appimage_environment_for_child_processes() (+5 more)

### Community 23 - "Dev Dependencies"
Cohesion: 0.16
Nodes (15): @lezer/highlight@^1.2.5, devDependencies, @tauri-apps/cli@^2.8.4, @types/react@^19.0.10, @types/react-dom@^19.0.4, typescript@~5.7.2, name, private (+7 more)

### Community 24 - "Node TS Config"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, lib, module, moduleDetection, moduleResolution, noEmit, noUnusedLocals (+7 more)

### Community 25 - "Editor Language Support"
Cohesion: 0.14
Nodes (14): @codemirror/lang-css@^6.3.1, @codemirror/lang-html@^6.4.9, @codemirror/lang-javascript@^6.2.3, @codemirror/lang-json@^6.0.2, @codemirror/lang-markdown@^6.3.2, @codemirror/lang-php@^6.0.2, @codemirror/lang-css, @codemirror/lang-html (+6 more)

### Community 26 - "Terminal View and Theme"
Cohesion: 0.22
Nodes (12): backgroundAlpha(), colorChannels(), isDark(), TerminalSession, TerminalSettings, terminalTheme(), TerminalView(), withCellAlpha() (+4 more)

### Community 27 - "Project Overview and Audit Docs"
Cohesion: 0.23
Nodes (13): App.tsx Monolith, Arc Desktop IDE, Live File Watcher, Graphify Knowledge Graph, Tag-Driven Release Pipeline, Settings Module and AppSettings, Vite HTML Entry, Ponytail Audit Report (+5 more)

### Community 28 - "Auto-Updater Runtime"
Cohesion: 0.15
Nodes (11): PendingUpdate, run(), update_endpoint(), UpdateDownloadEvent, Finished, Progress, Started, UpdateInfo (+3 more)

### Community 29 - "Plugin Socket and HTTP Bridge"
Cohesion: 0.19
Nodes (11): copy_directory(), now_millis(), plugin_socket_close(), plugin_socket_connect(), plugin_socket_write(), plugin_trash_path(), PluginSocketConnection, Pipe (+3 more)

### Community 30 - "React Entry and Color Picker"
Cohesion: 0.23
Nodes (8): react@^19.0.0, react, hexWithRgb(), hsvFromRgb(), rgbFromHex(), rgbFromHsv(), ThemeColorPicker(), migrateStorageNamespace()

### Community 31 - "Local Server URL Handling"
Cohesion: 0.18
Nodes (11): decode_url_path(), directory_listing(), encode_url_path(), hex_value(), html_escape(), local_server_encodes_file_urls(), local_server_info(), LocalHttpServerState (+3 more)

### Community 32 - "Plugin HTTP Server Protocol"
Cohesion: 0.27
Nodes (11): handle_local_request(), handle_plugin_http_connection(), HttpReply, inject_live_reload(), mime_type(), plugin_http_server_start(), PluginHttpServerInfo, read_http_request() (+3 more)

### Community 33 - "Updater Design Docs"
Cohesion: 0.29
Nodes (11): Auto-Updater Design, Beta Channel Pointer Release, Stable and Beta Update Channels, latest.json Update Manifest, Updater Signing Keys, tauri-action Release Build, tauri-plugin-updater, updater_install Command (+3 more)

### Community 34 - "MCP Bridge Client"
Cohesion: 0.27
Nodes (11): connectMcp(), createMcpHttpClient(), createMcpStdioClient(), disconnectMcp(), emitMcpEvent(), ensureArcMcpServer(), exposeMcp(), handleMcpHostRequest() (+3 more)

### Community 35 - "Tauri Command and Security Docs"
Cohesion: 0.25
Nodes (8): Tauri Capability Scopes, Tauri Command Surface (lib.rs), updater_check Command, plugin api.localServer, Plugin Secrets (OS Keyring), Unbounded Plugin HTTP Server, Plugin Secret Leak via Raw api.invoke, Updater String Version Comparison Bug

### Community 36 - "Agent Kit Contract Docs"
Cohesion: 0.32
Nodes (7): Plugin Runtime (lib/pluginRuntime.ts), Arc Agent Kit, Arc appData Install Path, Install Handshake, Plugin Anatomy (plugin.json + main.js), Pre-Install Validation Gate, activate(api) Lifecycle Contract

### Community 37 - "Plugin API Reference Docs"
Cohesion: 0.32
Nodes (8): Arc Plugin API Reference, Shared CodeMirror Modules, Plugin App Events, Languages and Diagnostics Providers, MCP Bridge (api.mcp), Plugin API Namespaces, UI Contributions, plugin_process_exec Ignores Timeout

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
- **16 isolated node(s):** `arc`, `Started`, `Progress`, `Finished`, `Graphify Knowledge Graph` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 382 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Arc Plugin API Reference` connect `Plugin API Reference Docs` to `Updater Design Docs`, `Tauri Command and Security Docs`, `Agent Kit Contract Docs`, `Agent Kit Build Wizard`, `Plugin Manager UI`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `usePluginRuntime()` (e.g. with `pluginCodeActions()` and `pluginConditionMatches()`) actually correct?**
  _`usePluginRuntime()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `arc`, `Started`, `Progress` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Plugin Runtime Core` be split into smaller, more focused modules?**
  _Cohesion score 0.02271062271062271 - nodes in this community are weakly interconnected._
- **Why does `Arc Agent Kit` connect `Agent Kit Contract Docs` to `Plugin API Reference Docs`, `Project Overview and Audit Docs`, `T3 Theme Design System`, `Agent Kit Build Wizard`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `activate()` (e.g. with `cleanupTests()` and `manualUiTests()`) actually correct?**
  _`activate()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Should `Rust Backend Commands` be split into smaller, more focused modules?**
  _Cohesion score 0.03263403263403263 - nodes in this community are weakly interconnected._