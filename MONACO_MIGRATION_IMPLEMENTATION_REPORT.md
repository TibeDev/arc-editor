# Monaco Migration Implementation Report

**Project:** Arc (`arc-ide` 0.1.2)  
**Date:** 2026-11-16  
**Status:** migration implemented; frontend build and Rust tests pass.

---

## 1. Summary

Arc has been migrated from CodeMirror 6 to Monaco Editor 0.57.0.

The migration is application-wide:

- all editor panes now use Monaco;
- all CodeMirror dependencies and imports were removed;
- the plugin editor, language, diagnostics, decorations, and LSP APIs now use Monaco;
- CodeMirror-specific CSS was replaced with Monaco selectors;
- documentation and the built-in API-tester plugin were updated.

There is no dual editor engine left in the application.

---

## 2. Dependencies

### Added

- `monaco-editor` `^0.57.0`
- `vscode-jsonrpc` `^10.0.0`
- `vscode-languageserver-protocol` `^3.18.5`

### Removed

- `@codemirror/autocomplete`
- `@codemirror/commands`
- `@codemirror/lang-css`
- `@codemirror/lang-html`
- `@codemirror/lang-javascript`
- `@codemirror/lang-json`
- `@codemirror/lang-markdown`
- `@codemirror/lang-php`
- `@codemirror/language`
- `@codemirror/search`
- `@codemirror/state`
- `@codemirror/view`
- `@lezer/highlight`

`package.json`, `package-lock.json`, and `vite.config.ts` contain no CodeMirror or Lezer references.

---

## 3. New editor modules

### `src/lib/editor/monaco.ts`

Central Monaco integration:

- imports Monaco and Vite worker chunks for editor, JSON, CSS, HTML, and TypeScript;
- configures `MonacoEnvironment.getWorker`;
- exports the shared `monaco` instance and `EditorViewHandle`;
- provides file URI helpers:
  - `fileUri(path)`
  - `pathFromUri(uri)`
- provides model lifecycle helpers:
  - `acquireModel(path, content, languageId)`
  - `releaseModel(path)`
  - `modelForPath(path)`
- maps file extensions to Monaco language IDs;
- registers PHP completion;
- generates and applies Arc themes through `monaco.editor.defineTheme` / `setTheme`;
- provides offset/position helpers and word-range lookup;
- implements HTML/PHP `!` template expansion as a Monaco editor command;
- provides decoration helpers backed by `createDecorationsCollection`.

The model store keys Monaco models by file path. Multiple editor groups share one model per open file. Models are released when the last view closes, a file is deleted, or the workspace changes.

### `src/lib/languages/registry.ts`

Editor-facing language registry:

- `ArcLanguageManifest` and `ArcLanguageContribution` types;
- Monarch syntax registration;
- language configuration registration;
- extension and filename lookup;
- `registerLanguageManifest`;
- `registerArcMonarchLanguage`;
- `languageForFileName`.

The manifest types include extension points for snippets, completion, diagnostics, formatter, and LSP descriptors. This is the foundation for custom and AI-generated language extensions. The registry currently implements built-in language IDs and Monarch grammars; it does not yet ship a manifest generator UI.

### `src/lib/languages/lsp.ts`

Custom Monaco LSP bridge:

- accepts a `PluginLanguageServerHandle` created through Arc's existing Tauri process bridge;
- synchronizes Monaco models with `textDocument/didOpen`, `didChange`, `didSave`, and `didClose`;
- tracks document versions;
- registers Monaco providers for:
  - completion;
  - hover;
  - definition;
  - references;
  - rename;
  - formatting;
  - diagnostics.
- converts LSP ranges, completion kinds, diagnostic severities, hover content, and workspace edits;
- publishes diagnostics with `monaco.editor.setModelMarkers`.

The bridge is plugin-driven. Arc does not bundle a language server.

---

## 4. Editor integration

`src/App.tsx` `EditorPane` now:

- creates a Monaco `IStandaloneCodeEditor` for each editor group;
- acquires a shared model for the file;
- restores `ICodeEditorViewState` for selection and scroll;
- maps content changes to `onChange`;
- maps cursor/selection changes to `onSelectionChange`;
- activates the group on editor focus;
- applies settings through `editor.updateOptions`;
- applies themes through `applyArcTheme`;
- changes model language through `monaco.editor.setModelLanguage`;
- synchronizes external file content through `model.setValue`;
- registers a `Tab` command that first attempts template expansion and otherwise inserts spaces.

Editor settings preserved:

- font family, font size, and line height;
- tab size and spaces;
- line numbers;
- word wrap;
- active-line highlighting;
- indentation guides;
- auto-closing brackets;
- auto indent;
- suggestions/autocomplete;
- bracket matching through Monaco defaults.

Multiple editor instances, split views, tab switching, view-state restoration, and shared models are supported.

---

## 5. Plugin API changes

### Removed

- `api.codemirror` and all raw CodeMirror/Lezer module exposure.

### Changed

- `PluginLanguageDefinition.load` now returns `void | Promise<void>` after registering Monaco language contributions.
- `PluginGrammar` now supports:
  - `language?: monaco.languages.IMonarchLanguage`
  - `configuration?: monaco.languages.LanguageConfiguration`
  - `load?: () => void | Promise<void>`
- Plugin editor handles are Monaco `IStandaloneCodeEditor` instances internally, but plugin-facing operations remain path/offset based.
- Decoration types now support `style` by generating scoped CSS classes.
- `api.languages.attachServer({ handle, language, documentSelector? })` connects a plugin-owned LSP process to Monaco providers and diagnostics.
- Plugin completion items use a neutral shape rather than CodeMirror `Completion[]`.

### Preserved

- editor text/selection/range operations;
- workspace edits;
- reveal/open-at;
- snippets;
- decoration registration and application;
- language provider registration;
- diagnostics collections;
- command palette language commands;
- keybindings and plugin commands;
- hover, definition, references, rename, formatting, and folding providers.

### Limited

- `codeLens`, `inlayHints`, and `semanticTokens` registrations remain accepted, but their rendering is limited compared with the old custom CodeMirror view plugins.
- No bundled language server or automatic LSP detection exists. A plugin must start a server and attach it.

---

## 6. Themes and styling

- `src/lib/settings.ts` no longer emits `.cm-*` CSS.
- Monaco theme colors are generated from Arc's existing `ThemeDefinition` color slots.
- `src/styles/styles.css` and `src/styles/app-themes.css` now target Monaco surfaces:
  - `.editor-host > .monaco-editor`
  - `.monaco-editor .monaco-scrollable-element`
  - `.monaco-editor .suggest-widget`
  - `.monaco-editor .inputarea`
- Arc's shell, glass, and transparency styles remain outside Monaco.

---

## 7. Documentation and built-in plugin

Updated:

- `PLUGIN_API.md` — removed `api.codemirror`; documented `attachServer` and Monaco language shape.
- `ARC_AGENT_KIT.md` — stack and language API now reference Monaco.
- `AGENTS.md` — editor stack now Monaco.
- `README.md` — language support now describes Monaco syntax support and the plugin LSP bridge.
- `ARC_AUDIT.md` — stack line now Monaco.

`plugins/api-tester/main.js`:

- no longer uses `api.codemirror`;
- tests `api.languages`;
- registers a Monaco language configuration and Monarch tokenizer;
- uses the new `registerGrammar` shape.

---

## 8. Verification

### Frontend build

```sh
npm run build
```

Result: passed.

- `tsc -b` passed.
- Vite production build passed.
- 3147 modules transformed.
- Monaco workers emitted:
  - `editor.worker`
  - `json.worker`
  - `html.worker`
  - `css.worker`
  - `ts.worker`
- Main bundle: approximately 4.38 MB (1.15 MB gzip).
- Only the expected large-chunk warning remains.

### Rust tests

```sh
cargo test
```

Run in `src-tauri`.

Result: passed.

- 11 tests passed.
- 0 failed.
- Backend behavior was not changed by the migration.

### CodeMirror removal check

```sh
rg "@codemirror|@lezer|CodeMirror|\.cm-" src plugins package.json vite.config.ts
```

Result: no matches.

### Model lifecycle check

`releaseModel(path)` is called when:

- the last editor group closes a file;
- a file or folder is deleted;
- the workspace changes.

---

## 9. Remaining limitations

1. **External file sync resets undo history.**  
   External content synchronization uses `model.setValue(file.content)`. This is correct for disk reloads but does not preserve Monaco's undo stack across an external change.

2. **No bundled language servers.**  
   The LSP client is implemented, but Arc ships no PHP, TypeScript, or other server. Language intelligence requires a plugin to start and attach a server.

3. **Plugin advanced rendering is limited.**  
   `codeLens`, `inlayHints`, and `semanticTokens` provider registration survives, but Monaco-native rendering is not fully implemented for all three.

4. **Runtime GUI verification is incomplete.**  
   The production frontend build and Rust tests pass. The app was not exercised interactively through `npm run tauri dev` during this migration.

5. **Tauri production worker loading is not GUI-tested.**  
   Workers are emitted by Vite, but Tauri platform behavior on Linux, Windows, and macOS still needs manual verification.

6. **Global plugin provider selector needs runtime confirmation.**  
   Plugin providers register with Monaco selector `"*"`. TypeScript accepts it and the build passes; GUI behavior should be confirmed with real plugins.

7. **TextMate and Tree-sitter are not implemented.**  
   The language registry is designed for modular syntax providers, but only built-in Monaco languages and Monarch grammars are implemented. TextMate and Tree-sitter remain optional future providers.

8. **No AI extension generator UI.**  
   The manifest schema and Monarch registration path are in place, but there is no UI that generates language manifests or extensions yet.

9. **Bundle size increased.**  
   Monaco and its workers are significantly larger than the previous CodeMirror bundle.

---

## 10. Recommended next steps

1. Run `npm run tauri dev` and manually verify:
   - open/save/reload;
   - split editors;
   - tab switching and view-state restore;
   - themes and custom themes;
   - PHP and HTML completion;
   - plugin completion, hover, diagnostics, and commands;
   - file watcher updates;
   - close/delete model cleanup.
2. Test a production Tauri build on Linux, Windows, and macOS to confirm worker loading.
3. Add a bundled or plugin-provided LSP server example using `api.languages.attachServer`.
4. Complete Monaco-native rendering for code lens, inlay hints, and semantic tokens.
5. Add a language-extension manifest authoring/generation flow.
6. Consider switching external-content sync to `pushEditOperations` if undo preservation across disk reloads becomes important.
