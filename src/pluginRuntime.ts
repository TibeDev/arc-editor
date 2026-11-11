import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { readText as readClipboardText, writeHtml as writeClipboardHtml, writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { copyFile, exists, mkdir, open as openFsFile, readDir, readFile, readTextFile, remove, rename as renameFile, stat as statFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView as CodeMirrorView, ViewPlugin, WidgetType, keymap, type EditorView, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { foldService } from "@codemirror/language";
import { hoverTooltip } from "@codemirror/view";
import * as codeMirrorLanguage from "@codemirror/language";
import * as codeMirrorView from "@codemirror/view";
import * as codeMirrorState from "@codemirror/state";
import * as codeMirrorAutocomplete from "@codemirror/autocomplete";
import * as codeMirrorHighlight from "@lezer/highlight";
import type { AppSettings, ThemeDefinition } from "./settings";

const builtinManifestSources = import.meta.glob<string>("../plugins/*/plugin.json", { eager: true, query: "?raw", import: "default" });
const builtinPluginSourceLoaders = import.meta.glob<string>("../plugins/*/main.js", { query: "?raw", import: "default" });

const disabledStorageKey = "arc.plugins.disabled";
const builtinsSeededKey = "arc.plugins.builtinsSeeded";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  main: "main.js";
};

export type InstalledPlugin = PluginManifest & { enabled: boolean; source?: string; builtin: boolean };

export type PluginActionDefinition = {
  id: string;
  label: string;
  title?: string;
  icon?: string;
  onClick: () => void | Promise<void>;
};

export type PluginToolbarAction = PluginActionDefinition & {
  pluginId: string;
  pluginName: string;
};

export type PluginContext = {
  workspace: string;
  target?: { name: string; path: string; kind: "file" | "directory" };
};

export type PluginContextMenuDefinition = {
  id: string;
  label: string;
  onClick: (context: PluginContext) => void | Promise<void>;
};

export type PluginContextMenuItem = PluginContextMenuDefinition & {
  pluginId: string;
  pluginName: string;
};

export type PluginCommandDefinition = {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  run: () => void | Promise<void>;
};

export type PluginCommand = PluginCommandDefinition & { pluginId: string; pluginName: string };

export type PluginStatusItemDefinition = {
  id: string;
  text: string;
  tooltip?: string;
  position?: "left" | "right";
  onClick?: () => void | Promise<void>;
};

export type PluginStatusItem = PluginStatusItemDefinition & { pluginId: string; pluginName: string };

export type PluginPanelDefinition = {
  id: string;
  title: string;
  mount: (container: HTMLElement) => void | (() => void);
};

export type PluginPanelContribution = PluginPanelDefinition & { pluginId: string; pluginName: string };

export type PluginKeybinding = {
  commandId: string;
  shortcut: string;
  condition?: string;
  pluginId: string;
  pluginName: string;
};

export type PluginLanguageProviderKind =
  | "completion"
  | "hover"
  | "definition"
  | "reference"
  | "rename"
  | "formatting"
  | "codeAction"
  | "codeLens"
  | "inlayHints"
  | "signatureHelp"
  | "documentSymbol"
  | "workspaceSymbol"
  | "semanticTokens"
  | "folding"
  | "selectionRange";

export type PluginLanguageProviderEntry = {
  kind: PluginLanguageProviderKind;
  selector: PluginLanguageSelector;
  provider: unknown;
  pluginId: string;
};

export type PluginEventName = "workspace:changed" | "editor:active" | "editor:changed" | "file:saved" | "settings:changed" | "terminal:opened" | "terminal:closed";

export type PluginEditorSnapshot = {
  path: string;
  name: string;
  text: string;
  dirty: boolean;
  selection: { from: number; to: number };
};

export type PluginAppSnapshot = {
  workspace: string;
  activeFile: string;
  openFiles: { path: string; name: string; dirty: boolean }[];
  terminals: { id: string; title: string; cwd: string }[];
  settings: AppSettings;
  theme: ThemeDefinition;
};

export type PluginDisposable = { dispose: () => void };
export type PluginRange = { from: number; to: number };
export type PluginPosition = { line: number; column: number; offset: number };
export type PluginEditorContext = {
  path: string;
  uri: string;
  name: string;
  language: string;
  version: number;
  cursor: PluginPosition;
  selection: PluginRange;
  selections: PluginRange[];
  dirty: boolean;
  focused: boolean;
  visibleRanges: PluginRange[];
};
export type PluginEdit = { range: PluginRange; text: string };
export type PluginWorkspaceEdit = {
  changes?: Record<string, PluginEdit[]>;
  documentChanges?: { uri: string; edits: PluginEdit[]; version?: number }[];
};
export type PluginLanguageSelector = string | { language?: string; scheme?: string; pattern?: string } | (string | { language?: string; scheme?: string; pattern?: string })[];
export type PluginConfigurationProperty = {
  type: string;
  default?: unknown;
  description?: string;
  scope?: "global" | "workspace";
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
};
export type PluginConfigurationSchema = {
  id: string;
  title?: string;
  properties: Record<string, PluginConfigurationProperty>;
};
export type PluginConfigurationContribution = {
  id: string;
  schemaId: string;
  title: string;
  properties: Record<string, PluginConfigurationProperty>;
  pluginId: string;
  pluginName: string;
};
export type PluginLanguageDefinition = {
  id: string;
  name: string;
  extensions?: string[];
  filenames?: string[];
  aliases?: string[];
  configuration?: Record<string, unknown>;
  load: () => Extension | Promise<Extension>;
};
export type PluginLanguageContribution = PluginLanguageDefinition & { pluginId: string; pluginName: string };
export type PluginCompletionProvider = {
  provideCompletionItems: (context: { path: string; language: string; text: string; offset: number; line: string; from: number; to: number }) => Completion[] | Promise<Completion[]>;
  resolveCompletionItem?: (item: Completion) => Completion | Promise<Completion>;
};
export type PluginHoverProvider = {
  provideHover: (context: { path: string; language: string; text: string; offset: number; line: string }) => unknown;
};
export type PluginLocationProvider = {
  provideLocations: (context: { path: string; language: string; text: string; offset: number; word: string; newName?: string }) => unknown;
  provideRename?: (context: { path: string; language: string; text: string; offset: number; word: string; newName: string }) => unknown;
};
export type PluginRangeProvider = {
  provideRanges: (context: { path: string; language: string; text: string; offset: number }) => unknown;
};
export type PluginFormattingProvider = {
  provideFormatting: (document: { path: string; language: string; text: string; range?: PluginRange }) => string | Promise<string>;
};
export type PluginFoldingProvider = {
  provideFoldingRange: (context: { path: string; language: string; text: string; line: number }) => PluginRange | null;
};
export type PluginGrammar = { load: () => Extension | Promise<Extension> };
export type PluginDiagnosticsCollection = {
  set: (uri: string, items: unknown[]) => void;
  delete: (uri: string) => void;
  clear: () => void;
  dispose: () => void;
};
export type PluginOutputChannel = {
  append: (text: string) => void;
  appendLine: (text: string) => void;
  show: () => void;
  clear: () => void;
  dispose: () => void;
  readonly id: string;
};
const pluginOutputBufferLimit = 100_000;
export type PluginProcessHandle = {
  id: string;
  write: (data: string | Uint8Array) => Promise<void>;
  closeStdin: () => Promise<void>;
  onStdout: (handler: (chunk: string) => void) => () => void;
  onStderr: (handler: (chunk: string) => void) => () => void;
  onExit: (handler: (event: { code: number | null; signal: string | null }) => void) => () => void;
  onError: (handler: (error: string) => void) => () => void;
  stop: (options?: { timeoutMs?: number }) => Promise<void>;
};
export type PluginLanguageServerHandle = PluginProcessHandle & {
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;
  notify: (method: string, params?: unknown) => Promise<void>;
  onNotification: (handler: (method: string, params: unknown) => void) => () => void;
  onRequest: (handler: (method: string, params: unknown) => unknown) => () => void;
  shutdown: () => Promise<void>;
};
export type PluginSocketHandle = {
  write: (bytes: Uint8Array) => Promise<void>;
  onData: (handler: (bytes: Uint8Array) => void) => () => void;
  onError: (handler: (error: string) => void) => () => void;
  onClose: (handler: () => void) => () => void;
  close: () => Promise<void>;
};
export type PluginWebSocketHandle = {
  send: (data: string | Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
  onMessage: (handler: (data: string | Uint8Array) => void) => () => void;
  onError: (handler: (error: string) => void) => () => void;
  onClose: (handler: (event: { code: number; reason: string }) => void) => () => void;
};
export type PluginMcpServerDefinition = {
  type?: "stdio" | "http";
  command?: string;
  executable?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  env?: Record<string, string>;
};
export type PluginMcpServerHandle = PluginDisposable & {
  id: string;
  serverInfo: unknown;
  capabilities: Record<string, unknown>;
  call: (method: string, params?: unknown) => Promise<unknown>;
};

export type PluginApi = {
  plugin: { id: string; name: string; version: string };
  workspace: string;
  platform: "windows" | "linux" | "macos";
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  openUrl: (url: string) => Promise<void>;
  openTerminal: (command?: string) => void;
  notify: (message: string) => void;
  supports: (capability: string) => boolean;
  disposables: { add: <T>(resource: T) => () => void };
  lifecycle: {
    onDeactivate: (handler: () => void | Promise<void>) => () => void;
    onShutdown: (handler: () => void | Promise<void>) => () => void;
  };
  timers: {
    setTimeout: (handler: () => void, delay: number) => number;
    setInterval: (handler: () => void, interval: number) => number;
    clearTimeout: (id: number) => void;
    clearInterval: (id: number) => void;
  };
  workers: { create: (scriptPath: string) => Worker };
  codemirror: {
    language: typeof codeMirrorLanguage;
    view: typeof codeMirrorView;
    state: typeof codeMirrorState;
    autocomplete: typeof codeMirrorAutocomplete;
    highlight: typeof codeMirrorHighlight;
  };
  app: {
    getState: () => PluginAppSnapshot;
    openWorkspace: () => Promise<void>;
    openSettings: () => void;
    openGithub: () => void;
    openPlugins: () => void;
    openPanel: (id: string) => void;
    setTitle: (title: string) => void;
  };
  files: {
    list: (path?: string) => Promise<{ path: string; name: string; kind: "file" | "directory" }[]>;
    listRecursive: (path?: string, options?: { exclude?: string[]; maxDepth?: number; maxResults?: number }) => Promise<{ path: string; name: string; kind: "file" | "directory" }[]>;
    watch: (pattern: string, handler: (event: { kind: string; path: string }) => void, options?: { ignore?: string[] }) => () => void;
    find: (pattern: string, options?: { exclude?: string[]; maxResults?: number }) => Promise<string[]>;
    searchText: (query: string | RegExp, options?: { exclude?: string[]; maxResults?: number; include?: string }) => Promise<{ path: string; line: number; column: number; preview: string }[]>;
    read: (path: string) => Promise<string>;
    readBytes: (path: string) => Promise<Uint8Array>;
    write: (path: string, content: string) => Promise<void>;
    writeBytes: (path: string, bytes: Uint8Array) => Promise<void>;
    writeAtomic: (path: string, content: string) => Promise<void>;
    openReadStream: (path: string) => Promise<{ read: (size?: number) => Promise<Uint8Array | null>; close: () => Promise<void> }>;
    openWriteStream: (path: string) => Promise<{ write: (bytes: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
    stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; isSymlink: boolean; size: number; mtime: number | null; atime: number | null; birthtime: number | null }>;
    exists: (path: string) => Promise<boolean>;
    create: (path: string, content?: string) => Promise<void>;
    createDirectory: (path: string) => Promise<void>;
    delete: (path: string) => Promise<void>;
    rename: (path: string, nextPath: string) => Promise<void>;
    copy: (path: string, destination: string) => Promise<void>;
    move: (source: string, destination: string, options?: { overwrite?: boolean }) => Promise<void>;
    trash: (path: string) => Promise<void>;
    open: (path: string) => Promise<void>;
    refresh: () => Promise<void>;
    registerProvider: (scheme: string, provider: { read: (path: string) => Promise<Uint8Array>; write?: (path: string, bytes: Uint8Array) => Promise<void>; list?: (path: string) => Promise<{ name: string; kind: "file" | "directory" }[]> }) => () => void;
  };
  paths: {
    join: (...parts: string[]) => string;
    resolve: (...parts: string[]) => string;
    relative: (from: string, to: string) => string;
    toUri: (path: string) => string;
    fromUri: (uri: string) => string;
    basename: (path: string) => string;
    dirname: (path: string) => string;
    extname: (path: string) => string;
    normalize: (path: string) => string;
  };
  editor: {
    getActive: () => PluginEditorSnapshot | null;
    getContext: () => PluginEditorContext | null;
    getLastActive: () => PluginEditorContext | null;
    getLanguage: (path?: string) => string | null;
    getCursor: (path?: string) => PluginPosition | null;
    getSelections: (path?: string) => PluginRange[];
    getVisibleRanges: (path?: string) => PluginRange[];
    getText: (path?: string) => string | null;
    setText: (text: string, path?: string) => void;
    insertText: (text: string, path?: string) => void;
    getSelection: (path?: string) => { from: number; to: number } | null;
    setSelection: (from: number, to?: number, path?: string) => void;
    replaceRange: (range: PluginRange, text: string, path?: string) => void;
    applyEdits: (edits: PluginEdit[], path?: string, expectedVersion?: number) => void;
    applyWorkspaceEdit: (edit: PluginWorkspaceEdit) => Promise<void>;
    insertSnippet: (snippet: string, range?: PluginRange, path?: string) => void;
    revealRange: (range: PluginRange, path?: string) => void;
    openAt: (path: string, line: number, column?: number) => Promise<void>;
    setLanguage: (languageId: string, path?: string) => void;
    registerDecorationType: (options: { className?: string; style?: string; gutter?: boolean }) => string;
    setDecorations: (type: string, ranges: PluginRange[], path?: string) => void;
    openDiff: (leftUri: string, rightUri: string, title?: string) => Promise<void>;
    registerContentProvider: (scheme: string, provider: { read: (uri: string) => string | Promise<string>; write?: (uri: string, content: string) => void | Promise<void> }) => () => void;
    registerCustomEditor: (filePattern: string, provider: { mount: (container: HTMLElement, context: { path: string; read: () => Promise<string> }) => void | (() => void) }) => () => void;
    onWillSave: (handler: (event: { path: string; content: string }) => string | void | Promise<string | void>) => () => void;
    onActiveChanged: (handler: (context: PluginEditorContext | null) => void) => () => void;
    onContextChanged: (handler: (context: PluginEditorContext | null) => void) => () => void;
    onSelectionChanged: (handler: (context: PluginEditorContext | null) => void) => () => void;
    onDocumentOpened: (handler: (event: { path: string; name: string }) => void) => () => void;
    onDocumentClosed: (handler: (event: { path: string }) => void) => () => void;
    onDocumentChanged: (handler: (event: { path: string; content: string; version: number }) => void) => () => void;
    onDocumentSaved: (handler: (event: { path: string; content: string }) => void) => () => void;
    focus: (path?: string) => void;
    open: (path: string) => Promise<void>;
    save: (path?: string) => Promise<boolean>;
    format: (path?: string) => Promise<void>;
  };
  languages: {
    register: (definition: PluginLanguageDefinition) => () => void;
    registerCompletionProvider: (selector: PluginLanguageSelector, provider: PluginCompletionProvider) => () => void;
    registerHoverProvider: (selector: PluginLanguageSelector, provider: PluginHoverProvider) => () => void;
    registerDefinitionProvider: (selector: PluginLanguageSelector, provider: PluginLocationProvider) => () => void;
    registerReferenceProvider: (selector: PluginLanguageSelector, provider: PluginLocationProvider) => () => void;
    registerRenameProvider: (selector: PluginLanguageSelector, provider: PluginLocationProvider) => () => void;
    registerFormattingProvider: (selector: PluginLanguageSelector, provider: PluginFormattingProvider) => () => void;
    registerCodeActionProvider: (selector: PluginLanguageSelector, provider: PluginRangeProvider) => () => void;
    registerCodeLensProvider: (selector: PluginLanguageSelector, provider: PluginRangeProvider) => () => void;
    registerInlayHintsProvider: (selector: PluginLanguageSelector, provider: PluginRangeProvider) => () => void;
    registerSignatureHelpProvider: (selector: PluginLanguageSelector, provider: PluginRangeProvider) => () => void;
    registerDocumentSymbolProvider: (selector: PluginLanguageSelector, provider: PluginRangeProvider) => () => void;
    registerWorkspaceSymbolProvider: (provider: PluginLocationProvider) => () => void;
    registerSemanticTokensProvider: (selector: PluginLanguageSelector, provider: PluginRangeProvider) => () => void;
    registerFoldingProvider: (selector: PluginLanguageSelector, provider: PluginFoldingProvider) => () => void;
    registerSelectionRangeProvider: (selector: PluginLanguageSelector, provider: PluginRangeProvider) => () => void;
    registerGrammar: (languageId: string, grammar: PluginGrammar) => () => void;
    startServer: (options: { command: string; args?: string[]; cwd?: string; env?: Record<string, string>; language?: string; initializationOptions?: unknown }) => Promise<PluginLanguageServerHandle>;
  };
  diagnostics: { createCollection: (name: string) => PluginDiagnosticsCollection };
  terminal: {
    open: (command?: string) => string | null;
    list: () => { id: string; title: string; cwd: string }[];
    write: (id: string, data: string) => Promise<void>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    close: (id: string) => Promise<void>;
  };
  settings: { get: () => AppSettings; update: (patch: Partial<AppSettings>) => void };
  themes: {
    list: () => { id: string; name: string }[];
    set: (id: string) => boolean;
    getColors: () => Record<string, string>;
    onChanged: (handler: (theme: ThemeDefinition) => void) => () => void;
  };
  dialogs: {
    openFile: (options?: { multiple?: boolean; filters?: { name: string; extensions: string[] }[] }) => Promise<string | string[] | null>;
    openFolder: () => Promise<string | null>;
    saveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
  };
  clipboard: { readText: () => Promise<string>; writeText: (text: string) => Promise<void>; writeHtml: (html: string, fallbackText?: string) => Promise<void> };
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    setSize: (width: number, height: number) => Promise<void>;
    setFullscreen: (fullscreen: boolean) => Promise<void>;
    setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
    center: () => Promise<void>;
    isFocused: () => Promise<boolean>;
    onFocusChanged: (handler: (focused: boolean) => void) => () => void;
    getVisibility: () => { visible: boolean; minimized: boolean; hidden: boolean };
    onVisibilityChanged: (handler: (visibility: { visible: boolean; minimized: boolean; hidden: boolean }) => void) => () => void;
    getIdleTime: () => number;
  };
  ui: {
    notify: (message: string) => void;
    confirm: (message: string) => boolean;
    prompt: (message: string, defaultValue?: string) => string | null;
    registerAction: (action: PluginActionDefinition) => void;
    updateAction: (id: string, changes: Partial<Omit<PluginActionDefinition, "id">>) => void;
    registerContextMenuItem: (item: PluginContextMenuDefinition) => void;
    registerMenuItem: (menu: string, item: PluginContextMenuDefinition & { when?: string; group?: string }) => () => void;
    registerStatusItem: (item: PluginStatusItemDefinition) => void;
    updateStatusItem: (id: string, changes: Partial<Omit<PluginStatusItemDefinition, "id">>) => void;
    registerCommand: (command: PluginCommandDefinition) => void;
    registerPanel: (panel: PluginPanelDefinition) => void;
    registerSidebarView: (options: PluginPanelDefinition & { icon?: string; order?: number }) => () => void;
    registerBottomView: (options: PluginPanelDefinition & { icon?: string; order?: number }) => () => void;
    registerTreeView: (options: { id: string; title: string; getChildren: (element?: unknown) => unknown[] | Promise<unknown[]>; onSelect?: (element: unknown) => void; icon?: string }) => () => void;
    registerCustomTab: (options: PluginPanelDefinition & { icon?: string }) => () => void;
    setViewBadge: (viewId: string, badge?: string | number | null) => void;
    showQuickPick: (items: { label: string; description?: string; detail?: string; value?: unknown }[], options?: { placeHolder?: string; canPickMany?: boolean }) => Promise<unknown | unknown[] | null>;
    showInputBox: (options?: { prompt?: string; value?: string; password?: boolean; placeHolder?: string; validate?: (value: string) => string | null | undefined }) => Promise<string | null>;
    showProgress: <T>(options: { title: string; cancellable?: boolean }, task: (report: (message: string, increment?: number) => void) => T | Promise<T>) => Promise<T>;
    showNotification: (message: string, options?: { severity?: "info" | "warning" | "error"; actions?: { label: string; run: () => void }[]; progress?: boolean }) => string;
    createOutputChannel: (name: string) => PluginOutputChannel;
    setContext: (key: string, value: unknown) => void;
    focusView: (id: string) => void;
    closeView: (id: string) => void;
    addStyles: (css: string) => () => void;
  };
  commands: {
    list: () => { id: string; title: string; description?: string; pluginName: string }[];
    execute: (id: string) => Promise<void>;
    onExecuted: (handler: (event: { id: string; pluginId: string; success: boolean }) => void) => () => void;
  };
  keybindings: {
    register: (commandId: string, shortcut: string, condition?: string) => () => void;
    unregister: (commandId: string, shortcut: string) => void;
  };
  events: {
    on: (event: string, listener: (payload: unknown) => void) => () => void;
    emit: (event: string, payload?: unknown) => void;
  };
  storage: {
    get: <T = unknown>(key: string, fallback?: T) => T;
    set: (key: string, value: unknown) => void;
    remove: (key: string) => void;
    clear: () => void;
    workspace: {
      get: <T = unknown>(key: string, fallback?: T) => T;
      set: (key: string, value: unknown) => void;
      remove: (key: string) => void;
      clear: () => void;
    };
  };
  configuration: {
    register: (schema: PluginConfigurationSchema) => () => void;
    get: <T = unknown>(key: string, fallback?: T) => T;
    update: (key: string, value: unknown, scope?: "global" | "workspace") => void;
    onChanged: (handler: (event: { key: string; value: unknown }) => void) => () => void;
  };
  secrets: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  workspaceFolders: {
    get: () => Promise<{ path: string; name: string; index: number }[]>;
    onChanged: (handler: (folders: { path: string; name: string; index: number }[]) => void) => () => void;
  };
  workspaceTrust: {
    isTrusted: () => boolean;
    onChanged: (handler: (trusted: boolean) => void) => () => void;
  };
  icons: {
    register: (name: string, svg: string) => () => void;
    unregister: (name: string) => void;
    get: (name: string) => string | null;
  };
  assets: {
    url: (relativePath: string) => Promise<string>;
    readText: (relativePath: string) => Promise<string>;
    readBytes: (relativePath: string) => Promise<Uint8Array>;
    resolvePath: (relativePath: string) => Promise<string>;
  };
  plugins: {
    list: () => { id: string; name: string; version: string; description: string; enabled: boolean; builtin: boolean }[];
    get: (id: string) => { id: string; name: string; version: string; description: string; enabled: boolean; builtin: boolean } | null;
    whenAvailable: (id: string) => Promise<void>;
    onChanged: (handler: () => void) => () => void;
  };
  services: {
    register: (name: string, implementation: unknown) => () => void;
    get: (name: string) => unknown;
    whenAvailable: (name: string) => Promise<unknown>;
  };
  process: {
    isRunning: (names: string[]) => Promise<boolean>;
    spawn: (executable: string, args?: string[], options?: { cwd?: string; env?: Record<string, string> }) => Promise<PluginProcessHandle>;
    which: (executable: string) => Promise<string | null>;
    exec: (executable: string, args?: string[], options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }) => Promise<{ stdout: string; stderr: string; code: number | null; signal: string | null }>;
  };
  pty: {
    spawn: (executable: string, args?: string[], options?: { cwd?: string; env?: Record<string, string> }) => Promise<PluginProcessHandle>;
  };
  ipc: {
    connectUnix: (path: string, options?: { timeoutMs?: number }) => Promise<PluginSocketHandle>;
    connectPipe: (name: string, options?: { timeoutMs?: number }) => Promise<PluginSocketHandle>;
  };
  net: {
    fetch: (url: string, options?: RequestInit & { timeoutMs?: number }) => Promise<Response>;
    connectTcp: (host: string, port: number, options?: { timeoutMs?: number }) => Promise<PluginSocketHandle>;
    listenHttp: (handler: (request: { method: string; url: string; headers: Record<string, string>; body: Uint8Array }) => Promise<{ status?: number; headers?: Record<string, string>; body?: string | Uint8Array }>, options?: { port?: number; host?: string }) => Promise<{ url: string; close: () => Promise<void> }>;
    connectWebSocket: (url: string, options?: { protocols?: string | string[] }) => Promise<PluginWebSocketHandle>;
    connectEventSource: (url: string, options?: { reconnect?: boolean }) => { onMessage: (handler: (event: { data: string; event: string; id: string }) => void) => () => void; onError: (handler: (error: string) => void) => () => void; close: () => void };
    download: (url: string, destination: string, options?: { onProgress?: (received: number, total: number | null) => void; signal?: AbortSignal }) => Promise<{ path: string; bytes: number }>;
    isOnline: () => boolean;
    onOnlineChanged: (handler: (online: boolean) => void) => () => void;
  };
  git: {
    getRepositories: () => Promise<string[]>;
    getStatus: (repository?: string) => Promise<unknown>;
    getBranch: (repository?: string) => Promise<unknown>;
    getDiff: (repository?: string, path?: string, options?: { staged?: boolean }) => Promise<string>;
    onChanged: (repository: string, handler: () => void) => () => void;
  };
  tasks: {
    registerProvider: (type: string, provider: { provideTasks: () => unknown[] | Promise<unknown[]>; resolveTask?: (task: unknown) => unknown }) => () => void;
    run: (task: unknown) => Promise<{ id: string; stop: () => Promise<void>; onExit: (handler: (event: { code: number | null }) => void) => () => void }>;
    onStarted: (handler: (event: { id: string; task: unknown }) => void) => () => void;
    onFinished: (handler: (event: { id: string; code: number | null }) => void) => () => void;
  };
  tests: { createController: (id: string, label: string) => { id: string; label: string; setItems: (items: unknown[]) => void; reportResult: (item: unknown) => void; dispose: () => void } };
  debug: {
    registerAdapter: (type: string, factory: unknown) => () => void;
    start: (configuration: unknown) => Promise<{ id: string; stop: () => Promise<void> }>;
    stop: (sessionId: string) => Promise<void>;
    getActiveSession: () => unknown;
    onSessionChanged: (handler: (session: unknown) => void) => () => void;
  };
  auth: {
    registerProvider: (id: string, provider: { getSessions?: (scopes: string[]) => unknown; createSession?: (scopes: string[]) => unknown; removeSession?: (sessionId: string) => unknown }) => () => void;
    getSession: (providerId: string, scopes: string[], options?: { createIfNone?: boolean }) => Promise<unknown>;
  };
  links: {
    registerUriHandler: (handler: (uri: string) => void) => () => void;
    createCallbackUrl: (path: string) => string;
  };
  mcp: {
    registerServer: (id: string, definition: PluginMcpServerDefinition) => () => void;
    unregisterServer: (id: string) => void;
    listServers: () => unknown[];
    getServer: (id: string) => unknown;
    connect: (id: string, options?: { timeoutMs?: number }) => Promise<PluginMcpServerHandle>;
    disconnect: (id: string) => Promise<void>;
    restart: (id: string) => Promise<PluginMcpServerHandle>;
    getCapabilities: (id: string) => Record<string, unknown> | null;
    onServerChanged: (handler: (event: { id: string; state: string; error?: string }) => void) => () => void;
    onLog: (handler: (event: { serverId: string; level: string; message: string }) => void) => () => void;
    setLogLevel: (serverId: string, level: string) => Promise<void>;
    ping: (serverId: string, options?: { timeoutMs?: number }) => Promise<boolean>;
    listTools: (serverId: string, options?: { cursor?: string }) => Promise<unknown>;
    callTool: (serverId: string, name: string, args?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>;
    onToolsChanged: (serverId: string, handler: () => void) => () => void;
    listResources: (serverId: string, options?: { cursor?: string }) => Promise<unknown>;
    listResourceTemplates: (serverId: string, options?: { cursor?: string }) => Promise<unknown>;
    readResource: (serverId: string, uri: string) => Promise<unknown>;
    subscribeResource: (serverId: string, uri: string, handler: () => void) => () => void;
    onResourcesChanged: (serverId: string, handler: () => void) => () => void;
    listPrompts: (serverId: string, options?: { cursor?: string }) => Promise<unknown>;
    getPrompt: (serverId: string, name: string, args?: Record<string, string>) => Promise<unknown>;
    onPromptsChanged: (serverId: string, handler: () => void) => () => void;
    complete: (serverId: string, reference: unknown, argument: unknown) => Promise<unknown>;
    setRoots: (serverId: string, roots: { uri: string; name?: string }[]) => Promise<void>;
    onSamplingRequest: (handler: (request: unknown) => unknown) => () => void;
    onElicitationRequest: (handler: (request: unknown) => unknown) => () => void;
    onAuthorizationRequired: (handler: (request: unknown) => unknown) => () => void;
    exposeTool: (definition: unknown, handler: unknown) => () => void;
    exposeResource: (definition: unknown, handler: unknown) => () => void;
    exposeResourceTemplate: (definition: unknown, handler: unknown) => () => void;
    exposePrompt: (definition: unknown, handler: unknown) => () => void;
    notifyResourceChanged: (uri: string) => void;
    getExposure: () => unknown;
    onExposureChanged: (handler: () => void) => () => void;
  };
  localServer: {
    start: (root: string, entry?: string) => Promise<{ root: string; url: string }>;
    stop: () => Promise<boolean>;
  };
  registerAction: (action: PluginActionDefinition) => void;
  registerContextMenuItem: (item: PluginContextMenuDefinition) => void;
};

type PluginHostActions = {
  getAppState: () => PluginAppSnapshot;
  getThemes: () => { id: string; name: string }[];
  openWorkspace: () => Promise<void>;
  openSettings: () => void;
  openGithub: () => void;
  openPlugins: () => void;
  openPluginPanel: (id: string) => void;
  setTitle: (title: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setTheme: (id: string) => boolean;
  refreshWorkspace: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  renameFile: (path: string, name: string) => Promise<void>;
  saveFile: (path: string) => Promise<boolean>;
  formatFile: (path: string) => Promise<void>;
  getEditor: (path?: string) => EditorView | null;
  getEditorSnapshot: (path?: string) => PluginEditorSnapshot | null;
  getEditorContext: (path?: string) => PluginEditorContext | null;
  getLastActiveContext: () => PluginEditorContext | null;
  setEditorLanguage: (path: string, languageId: string) => void;
  setEditorText: (path: string, text: string) => void;
  closePluginPanel: (id: string) => void;
  getWorkspaceFolders: () => { path: string; name: string; index: number }[];
  isWorkspaceTrusted: () => boolean;
  getGitStatus: () => Promise<unknown>;
  getGitBranch: () => Promise<unknown>;
  getGitDiff: (path?: string, staged?: boolean) => Promise<string>;
  getTerminals: () => { id: string; title: string; cwd: string }[];
  openTerminal: (command?: string) => string | null;
  writeTerminal: (id: string, data: string) => Promise<void>;
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
};

type ActivePlugin = {
  source: string;
  url: string;
  active: boolean;
  cleanup?: () => void;
  disposables: (() => void)[];
  deactivateHandlers: (() => void | Promise<void>)[];
  shutdownHandlers: (() => void | Promise<void>)[];
  timers: Set<number>;
  workers: Set<Worker>;
  contexts: Map<string, unknown>;
};

type PluginModule = {
  activate: (api: PluginApi) => void | (() => void) | Promise<void | (() => void)>;
};

function readDisabledIds(): Set<string> {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(disabledStorageKey) ?? "[]");
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function parseManifest(value: unknown, allowBuiltin = false): PluginManifest {
  if (!value || typeof value !== "object") throw new Error("plugin.json must contain a JSON object.");
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(manifest.id)) {
    throw new Error("Plugin ID must use 2–64 lowercase letters, numbers, dots, underscores, or hyphens.");
  }
  if (!allowBuiltin && builtinPackages.some((builtin) => builtin.manifest.id === manifest.id)) {
    throw new Error("Plugin ID is reserved by a built-in plugin.");
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error("Plugin name is required.");
  if (typeof manifest.version !== "string" || !manifest.version.trim()) throw new Error("Plugin version is required.");
  if (typeof manifest.description !== "string") throw new Error("Plugin description is required.");
  if (manifest.main !== "main.js") throw new Error('Plugin entry file must be "main.js".');
  return {
    id: manifest.id,
    name: manifest.name.trim(),
    version: manifest.version.trim(),
    description: manifest.description.trim(),
    main: "main.js",
  };
}

const builtinPackages = Object.entries(builtinManifestSources).map(([manifestPath, manifestJson]) => {
  const sourcePath = manifestPath.replace(/plugin\.json$/, "main.js");
  if (typeof builtinPluginSourceLoaders[sourcePath] !== "function") {
    throw new Error(`Built-in plugin is missing main.js: ${manifestPath}`);
  }
  return { manifest: parseManifest(JSON.parse(manifestJson), true), sourcePath };
});

async function loadBuiltinSource(sourcePath: string): Promise<string> {
  const loader = builtinPluginSourceLoaders[sourcePath];
  if (!loader) throw new Error(`Built-in plugin is missing main.js: ${sourcePath}`);
  return loader();
}

export function usePluginRuntime(
  workspace: string,
  notify: (message: string) => void,
  hostActions: PluginHostActions,
) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [actions, setActions] = useState<PluginToolbarAction[]>([]);
  const [contextMenuItems, setContextMenuItems] = useState<PluginContextMenuItem[]>([]);
  const [commands, setCommands] = useState<PluginCommand[]>([]);
  const [statusItems, setStatusItems] = useState<PluginStatusItem[]>([]);
  const [panels, setPanels] = useState<PluginPanelContribution[]>([]);
  const [languages, setLanguages] = useState<PluginLanguageContribution[]>([]);
  const [configurations, setConfigurations] = useState<PluginConfigurationContribution[]>([]);
  const [grammarVersion, setGrammarVersion] = useState(0);
  const [keybindings, setKeybindings] = useState<PluginKeybinding[]>([]);
  const [iconRegistry, setIconRegistry] = useState<Record<string, string>>({});
  const [pluginDirectory, setPluginDirectory] = useState("");
  const pluginDirectoryRef = useRef("");
  const hostActionsRef = useRef(hostActions);
  hostActionsRef.current = hostActions;
  pluginHostActions = hostActions;
  pluginNotifier = notify;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  activeWorkspace = workspace;
  const pluginsRef = useRef<InstalledPlugin[]>([]);
  pluginsRef.current = plugins;
  const languagesRef = useRef<PluginLanguageContribution[]>([]);
  languagesRef.current = languages;
  const grammars = useRef(new Map<string, Extension | Promise<Extension>>());
  const activeModules = useRef(new Map<string, ActivePlugin>());
  const listeners = useRef(new Map<string, Set<(payload: unknown) => void>>());
  const commandRef = useRef(new Map<string, PluginCommand>());
  commandRef.current = new Map(commands.map((command) => [command.id, command]));
  const pluginsChangedListeners = useRef(new Set<() => void>());
  const toggleTokens = useRef(new Map<string, number>());
  const configurationListeners = useRef(new Map<string, Set<(event: { key: string; value: unknown }) => void>>());

  const emitEvent = useCallback((event: string, payload?: unknown) => {
    listeners.current.get(event)?.forEach((listener) => {
      try { listener(payload); } catch (error) { notify(`Plugin event listener failed: ${String(error)}`); }
    });
    pluginEventListeners.get(event)?.forEach((listener) => {
      try { listener(payload); } catch (error) { notify(`Plugin event listener failed: ${String(error)}`); }
    });
    window.dispatchEvent(new CustomEvent(`arc:${event}`, { detail: payload }));
  }, [notify]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const root = await join(await appDataDir(), "plugins");
        await mkdir(root, { recursive: true });
        pluginDirectoryRef.current = root;
        if (!cancelled) setPluginDirectory(root);
        const seedBuiltins = localStorage.getItem(builtinsSeededKey) !== "true";
        for (const builtin of builtinPackages) {
          const folder = await join(root, builtin.manifest.id);
          let needsWrite = seedBuiltins;
          if (!needsWrite) {
            try {
              const installed = JSON.parse(
                await readTextFile(await join(folder, "plugin.json")),
              ) as { version?: unknown };
              needsWrite =
                installed?.version !== builtin.manifest.version ||
                !(await exists(await join(folder, "main.js")));
            } catch {
              needsWrite = true;
            }
          }
          if (needsWrite) {
            await writePluginFiles(folder, builtin.manifest, await loadBuiltinSource(builtin.sourcePath));
          }
        }
        if (seedBuiltins) localStorage.setItem(builtinsSeededKey, "true");
        const disabled = readDisabledIds();
        const entries = await readDir(root);
        const loaded: InstalledPlugin[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory) continue;
          try {
            const folder = await join(root, entry.name);
            const manifestPath = await join(folder, "plugin.json");
            const sourcePath = await join(folder, "main.js");
            const parsed = JSON.parse(await readTextFile(manifestPath));
            const id = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).id : undefined;
            const isBuiltin = builtinPackages.some((builtin) => builtin.manifest.id === id);
            const manifest = parseManifest(parsed, isBuiltin);
            const enabled = !disabled.has(manifest.id);
            const source = enabled ? await readTextFile(sourcePath) : undefined;
            loaded.push({ ...manifest, enabled, builtin: isBuiltin, ...(source === undefined ? {} : { source }) });
          } catch (error) {
            notify(`Could not load plugin in ${entry.name}: ${String(error)}`);
          }
        }
        if (!cancelled) setPlugins(loaded);
      } catch (error) {
        if (!cancelled) notify(`Could not load plugins: ${String(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [notify]);

  const availableBuiltins = builtinPackages
    .filter((builtin) => !plugins.some((plugin) => plugin.id === builtin.manifest.id))
    .map((builtin) => builtin.manifest);

  useEffect(() => {
    const desired = new Map(plugins.filter((plugin) => plugin.enabled).map((plugin) => [plugin.id, plugin]));
    for (const [id, active] of activeModules.current) {
      const plugin = desired.get(id);
      if (plugin && plugin.source === active.source) continue;
      active.active = false;
      active.timers.forEach((timer) => { window.clearTimeout(timer); window.clearInterval(timer); });
      active.timers.clear();
      active.workers.forEach((worker) => worker.terminate());
      active.workers.clear();
      for (const handler of active.deactivateHandlers) {
        try { void handler(); } catch { /* Plugin cleanup must not interrupt other plugins. */ }
      }
      active.disposables.forEach((dispose) => { try { dispose(); } catch { /* Plugin cleanup must not interrupt other plugins. */ } });
      try { active.cleanup?.(); } catch { /* Plugin cleanup must not interrupt other plugins. */ }
      URL.revokeObjectURL(active.url);
      activeModules.current.delete(id);
      setActions((current) => current.filter((action) => action.pluginId !== id));
      setContextMenuItems((current) => current.filter((item) => item.pluginId !== id));
      setCommands((current) => current.filter((command) => command.pluginId !== id));
      setStatusItems((current) => current.filter((item) => item.pluginId !== id));
      setPanels((current) => current.filter((panel) => panel.pluginId !== id));
      setLanguages((current) => current.filter((language) => language.pluginId !== id));
      setConfigurations((current) => current.filter((configuration) => configuration.pluginId !== id));
      pluginContextValues.delete(id);
      setKeybindings((current) => current.filter((binding) => binding.pluginId !== id));
      pluginLanguageProviders.splice(0, pluginLanguageProviders.length, ...pluginLanguageProviders.filter((provider) => provider.pluginId !== id));
    }

    for (const plugin of desired.values()) {
      if (activeModules.current.has(plugin.id)) continue;
      const source = plugin.source;
      if (source === undefined) {
        notify(`Could not activate ${plugin.name}: plugin source is not loaded.`);
        continue;
      }
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      const active: ActivePlugin = {
        source,
        url,
        active: true,
        disposables: [],
        deactivateHandlers: [],
        shutdownHandlers: [],
        timers: new Set(),
        workers: new Set(),
        contexts: new Map(),
      };
      activeModules.current.set(plugin.id, active);
      void (async () => {
        try {
          const pluginModule = await import(/* @vite-ignore */ url) as PluginModule;
          if (!active.active || activeModules.current.get(plugin.id) !== active) return;
          if (typeof pluginModule.activate !== "function") throw new Error("main.js must export activate(api).");
          const validateId = (id: string) => {
            if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new Error(`Plugin ${plugin.name} registered an invalid contribution ID.`);
          };
          const registerAction = (definition: PluginActionDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.label.trim() || typeof definition.onClick !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid toolbar action.`);
            const action = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            setActions((current) => [...current.filter((entry) => entry.id !== action.id), action]);
          };
          const registerContextMenuItem = (definition: PluginContextMenuDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.label.trim() || typeof definition.onClick !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid context menu item.`);
            const item = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            setContextMenuItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
          };
          const registerCommand = (definition: PluginCommandDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.title.trim() || typeof definition.run !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid command.`);
            const command = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            commandRef.current.set(command.id, command);
            setCommands((current) => [...current.filter((entry) => entry.id !== command.id), command]);
          };
          const registerStatusItem = (definition: PluginStatusItemDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.text.trim()) throw new Error(`Plugin ${plugin.name} registered an invalid status item.`);
            const item = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            setStatusItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
          };
          const registerPanel = (definition: PluginPanelDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return;
            validateId(definition.id);
            if (!definition.title.trim() || typeof definition.mount !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid panel.`);
            const panel = { ...definition, id: `${plugin.id}:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name };
            setPanels((current) => [...current.filter((entry) => entry.id !== panel.id), panel]);
          };
          const registerView = (method: "sidebar" | "bottom" | "customTab") => (definition: PluginPanelDefinition & { icon?: string; order?: number }) => {
            const fullId = `${plugin.id}:${definition.id}`;
            const panelDefinition: PluginPanelDefinition = { id: definition.id, title: definition.title, mount: definition.mount };
            registerPanel(panelDefinition);
            active.contexts.set(`view:${method}:${fullId}`, definition);
            const dispose = () => setPanels((current) => current.filter((entry) => entry.id !== fullId));
            active.disposables.push(dispose);
            return dispose;
          };
          const registerLanguage = (definition: PluginLanguageDefinition) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return () => undefined;
            validateId(definition.id);
            if (!definition.name.trim() || typeof definition.load !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid language.`);
            const contribution: PluginLanguageContribution = {
              ...definition,
              id: `${plugin.id}:${definition.id}`,
              pluginId: plugin.id,
              pluginName: plugin.name,
            };
            setLanguages((current) => [...current.filter((entry) => entry.id !== contribution.id), contribution]);
            const dispose = () => setLanguages((current) => current.filter((entry) => entry.id !== contribution.id));
            active.disposables.push(dispose);
            return dispose;
          };
          const registerProvider = (kind: PluginLanguageProviderKind) => (selector: PluginLanguageSelector, provider: unknown) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return () => undefined;
            const entry: PluginLanguageProviderEntry = { kind, selector, provider, pluginId: plugin.id };
            pluginLanguageProviders.push(entry);
            const dispose = () => {
              const index = pluginLanguageProviders.indexOf(entry);
              if (index >= 0) pluginLanguageProviders.splice(index, 1);
            };
            active.disposables.push(dispose);
            return dispose;
          };
          const registerGrammar = (languageId: string, grammar: PluginGrammar) => {
            if (!active.active || activeModules.current.get(plugin.id) !== active) return () => undefined;
            if (!languageId.trim() || typeof grammar.load !== "function") throw new Error(`Plugin ${plugin.name} registered an invalid grammar.`);
            const loaded = grammar.load();
            grammars.current.set(languageId, loaded);
            setGrammarVersion((version) => version + 1);
            const dispose = () => {
              if (grammars.current.get(languageId) !== loaded) return;
              grammars.current.delete(languageId);
              setGrammarVersion((version) => version + 1);
            };
            active.disposables.push(dispose);
            return dispose;
          };
          const createCollection = (name: string): PluginDiagnosticsCollection => {
            const diagnostics = new Map<string, unknown[]>();
            const dispose = () => {
              diagnostics.clear();
              emitEvent("diagnostics:changed", { name, uri: null, items: [] });
            };
            active.disposables.push(dispose);
            return {
              set: (uri, items) => {
                diagnostics.set(uri, items);
                emitEvent("diagnostics:changed", { name, uri, items });
              },
              delete: (uri) => {
                diagnostics.delete(uri);
                emitEvent("diagnostics:changed", { name, uri, items: null });
              },
              clear: () => {
                diagnostics.clear();
                emitEvent("diagnostics:changed", { name, uri: null, items: null });
              },
              dispose,
            };
          };
          const emitCommandExecuted = (command: PluginCommand, success: boolean) => {
            emitEvent("command:executed", { id: command.id, pluginId: command.pluginId, success });
          };
          const resolveFilePath = (path: string, allowRoot = false) => pluginWorkspacePath(workspaceRef.current, path, allowRoot);
          const providerFor = (path: string) => {
            const match = /^([a-z][a-z0-9+.-]*):/i.exec(path);
            return match ? fileProviders.get(match[1]) ?? null : null;
          };
          const resolvePluginAsset = async (relativePath: string) => {
            const root = await join(await appDataDir(), "plugins", plugin.id);
            const resolved = pluginAssetPath(root, relativePath);
            return resolved;
          };
          const scopedStorageKey = (key: string) => `arc.plugin.${plugin.id}.${key}`;
          const workspaceStorageKey = (key: string) => `${scopedStorageKey("workspace")}.${encodeURIComponent(workspaceRef.current)}.${key}`;
          const getEditor = (path?: string) => hostActionsRef.current.getEditor(path);
          const runCommand = async (id: string) => {
            const command = commandRef.current.get(id.includes(":") ? id : `${plugin.id}:${id}`);
            if (!command) throw new Error(`Unknown plugin command: ${id}`);
            try {
              await command.run();
              emitCommandExecuted(command, true);
            } catch (error) {
              emitCommandExecuted(command, false);
              throw error;
            }
          };
          pluginCommandRunner = runCommand;
          activeLanguageBase = () => {
            const context = hostActionsRef.current.getEditorContext();
            return context
              ? { path: context.path, language: context.language }
              : null;
          };
          activeLanguageContext = () => {
            const context = hostActionsRef.current.getEditorContext();
            if (!context) return null;
            const editor = hostActionsRef.current.getEditor(context.path);
            if (!editor) return null;
            const offset = editor.state.selection.main.head;
            const line = editor.state.doc.lineAt(offset);
            const text = editor.state.doc.toString();
            const word = /[A-Za-z0-9_$-]*$/.exec(text.slice(0, offset))?.[0] ?? "";
            return { path: context.path, language: context.language, text, offset, line: line.text, lineFrom: line.from, lineTo: line.to, word };
          };
          const outputChannels = new Map<string, PluginOutputChannel>();
          const makeOutputChannel = (name: string): PluginOutputChannel => {
            let buffer = "";
            let truncated = false;
            let publishTimer: number | null = null;
            const panelId = `${plugin.id}:output-${slugify(name)}`;
            const displayBuffer = () =>
              truncated ? `… earlier output truncated …\n${buffer}` : buffer;
            const publish = () => setPanels((current) => [
              ...current.filter((entry) => entry.id !== panelId),
              {
                id: panelId,
                title: name,
                pluginId: plugin.id,
                pluginName: plugin.name,
                mount: (container: HTMLElement) => {
                  const pre = document.createElement("pre");
                  pre.className = "arc-plugin-output";
                  pre.textContent = displayBuffer();
                  container.replaceChildren(pre);
                  return () => container.replaceChildren();
                },
              },
            ]);
            const appendOutput = (text: string) => {
              buffer = `${buffer}${text}`;
              if (buffer.length > pluginOutputBufferLimit) {
                buffer = buffer.slice(-pluginOutputBufferLimit);
                truncated = true;
              }
              if (publishTimer !== null) return;
              publishTimer = window.setTimeout(() => {
                publishTimer = null;
                publish();
              }, 16);
            };
            const channel: PluginOutputChannel = {
              id: panelId,
              append: appendOutput,
              appendLine: (text) => appendOutput(`${text}\n`),
              show: () => hostActionsRef.current.openPluginPanel(panelId),
              clear: () => {
                buffer = "";
                truncated = false;
                if (publishTimer !== null) {
                  window.clearTimeout(publishTimer);
                  publishTimer = null;
                }
                publish();
              },
              dispose: () => {
                outputChannels.delete(name);
                if (publishTimer !== null) {
                  window.clearTimeout(publishTimer);
                  publishTimer = null;
                }
                setPanels((current) => current.filter((entry) => entry.id !== panelId));
              },
            };
            outputChannels.set(name, channel);
            publish();
            const dispose = () => channel.dispose();
            active.disposables.push(dispose);
            return channel;
          };
          const api: PluginApi = {
            plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
            get workspace() { return workspaceRef.current; },
            platform: /win/i.test(navigator.platform) ? "windows" : /mac/i.test(navigator.platform) ? "macos" : "linux",
            invoke: (command, args) => invoke(command, args),
            openUrl: (externalUrl) => openUrl(externalUrl),
            openTerminal: (command) => hostActionsRef.current.openTerminal(command),
            notify,
            supports: (capability) => SUPPORTED_CAPABILITIES.has(capability),
            disposables: {
              add: <T,>(resource: T) => {
                const dispose = toDisposer(resource);
                if (dispose) active.disposables.push(dispose);
                return dispose ?? (() => undefined);
              },
            },
            lifecycle: {
              onDeactivate: (handler) => {
                active.deactivateHandlers.push(handler);
                const dispose = () => {
                  const index = active.deactivateHandlers.indexOf(handler);
                  if (index >= 0) active.deactivateHandlers.splice(index, 1);
                };
                active.disposables.push(dispose);
                return dispose;
              },
              onShutdown: (handler) => {
                active.shutdownHandlers.push(handler);
                const dispose = () => {
                  const index = active.shutdownHandlers.indexOf(handler);
                  if (index >= 0) active.shutdownHandlers.splice(index, 1);
                };
                active.disposables.push(dispose);
                return dispose;
              },
            },
            timers: {
              setTimeout: (handler, delay) => {
                const timer = window.setTimeout(() => {
                  active.timers.delete(timer);
                  handler();
                }, delay);
                active.timers.add(timer);
                return timer;
              },
              setInterval: (handler, interval) => {
                const timer = window.setInterval(handler, interval);
                active.timers.add(timer);
                return timer;
              },
              clearTimeout: (id) => {
                active.timers.delete(id);
                window.clearTimeout(id);
              },
              clearInterval: (id) => {
                active.timers.delete(id);
                window.clearInterval(id);
              },
            },
            workers: {
              create: (scriptPath) => {
                if (typeof Worker === "undefined") throw new Error("Web Workers are not available.");
                const url = new URL(scriptPath, window.location.href);
                const worker = new Worker(url, { type: "module" });
                active.workers.add(worker);
                const originalTerminate = worker.terminate.bind(worker);
                worker.terminate = () => {
                  active.workers.delete(worker);
                  originalTerminate();
                };
                return worker;
              },
            },
            codemirror: {
              language: codeMirrorLanguage,
              view: codeMirrorView,
              state: codeMirrorState,
              autocomplete: codeMirrorAutocomplete,
              highlight: codeMirrorHighlight,
            },
            app: {
              getState: () => hostActionsRef.current.getAppState(),
              openWorkspace: () => hostActionsRef.current.openWorkspace(),
              openSettings: () => hostActionsRef.current.openSettings(),
              openGithub: () => hostActionsRef.current.openGithub(),
              openPlugins: () => hostActionsRef.current.openPlugins(),
              openPanel: (id) => hostActionsRef.current.openPluginPanel(id.includes(":") ? id : `${plugin.id}:${id}`),
              setTitle: (title) => hostActionsRef.current.setTitle(title),
            },
            files: {
              list: async (path = "") => {
                const provider = providerFor(path);
                if (provider?.list) {
                  const entries = await provider.list(path);
                  return entries.map((entry) => ({ name: entry.name, path: `${path.replace(/\/$/, "")}/${entry.name}`, kind: entry.kind }));
                }
                const directory = await resolveFilePath(path, true);
                const entries = await readDir(directory);
                return entries.map((entry) => ({
                  name: entry.name,
                  path: path ? `${path.replace(/\\/g, "/").replace(/\/$/, "")}/${entry.name}` : entry.name,
                  kind: entry.isDirectory ? "directory" as const : "file" as const,
                }));
              },
              listRecursive: (path = "", options) => listWorkspaceFiles(hostActionsRef.current.getAppState().workspace, path, options),
              watch: (pattern, handler, options) => {
                let disposed = false;
                let unlisten: (() => void) | null = null;
                void listen<{ root: string; kind: string; paths: string[] }[]>("fs-changed", (event) => {
                  if (disposed) return;
                  const root = hostActionsRef.current.getAppState().workspace;
                  for (const change of event.payload) {
                    for (const absolute of change.paths) {
                      const relative = absolute.startsWith(root) ? absolute.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/") : absolute.replace(/\\/g, "/");
                      if (!matchGlob(relative, pattern) || (options?.ignore ?? []).some((ignore) => matchGlob(relative, ignore))) continue;
                      handler({ kind: change.kind, path: relative });
                    }
                  }
                }).then((stop) => {
                  unlisten = stop;
                  if (disposed) stop();
                }).catch(() => undefined);
                const dispose = () => {
                  disposed = true;
                  unlisten?.();
                };
                active.disposables.push(dispose);
                return dispose;
              },
              find: async (pattern, options) => {
                const files = await listWorkspaceFiles(hostActionsRef.current.getAppState().workspace, "", { exclude: options?.exclude, maxResults: options?.maxResults ?? 5000 });
                return files.filter((entry) => entry.kind === "file" && matchGlob(entry.path, pattern)).map((entry) => entry.path);
              },
              searchText: (query, options) => searchWorkspaceText(hostActionsRef.current.getAppState().workspace, query, options),
              read: async (path) => {
                const provider = providerFor(path);
                return provider ? new TextDecoder().decode(await provider.read(path)) : readTextFile(resolveFilePath(path));
              },
              readBytes: async (path) => {
                const provider = providerFor(path);
                return provider ? provider.read(path) : readFile(resolveFilePath(path));
              },
              write: async (path, content) => {
                const provider = providerFor(path);
                if (provider?.write) { await provider.write(path, new TextEncoder().encode(content)); return; }
                const destination = await resolveFilePath(path);
                await mkdir(await parentDirectoryPath(destination), { recursive: true });
                if (hostActionsRef.current.getEditorSnapshot(path)) {
                  hostActionsRef.current.setEditorText(path, content);
                  if (!await hostActionsRef.current.saveFile(path)) throw new Error(`Could not save ${path}.`);
                } else {
                  await writeTextFile(destination, content);
                  emitEvent("file:saved", { path });
                }
                await hostActionsRef.current.refreshWorkspace();
              },
              writeBytes: async (path, bytes) => {
                const provider = providerFor(path);
                if (provider?.write) { await provider.write(path, bytes); return; }
                const destination = await resolveFilePath(path);
                await mkdir(await parentDirectoryPath(destination), { recursive: true });
                await writeFile(destination, bytes);
                await hostActionsRef.current.refreshWorkspace();
              },
              writeAtomic: async (path, content) => {
                const destination = await resolveFilePath(path);
                await mkdir(await parentDirectoryPath(destination), { recursive: true });
                const temporary = `${destination}.${Date.now()}.arc-tmp`;
                await writeTextFile(temporary, content);
                try {
                  await renameFile(temporary, destination);
                } catch (error) {
                  await remove(temporary).catch(() => undefined);
                  throw error;
                }
                await hostActionsRef.current.refreshWorkspace();
              },
              openReadStream: async (path) => {
                const bytes = await readFile(resolveFilePath(path));
                let offset = 0;
                return {
                  read: async (size = 64 * 1024) => {
                    if (offset >= bytes.length) return null;
                    const chunk = bytes.slice(offset, offset + Math.max(1, size));
                    offset += chunk.length;
                    return chunk;
                  },
                  close: async () => undefined,
                };
              },
              openWriteStream: async (path) => {
                const destination = await resolveFilePath(path);
                await mkdir(await parentDirectoryPath(destination), { recursive: true });
                const file = await openFsFile(destination, { write: true, create: true, truncate: true });
                let closed = false;
                return {
                  write: async (bytes) => {
                    if (closed) throw new Error("Write stream is closed.");
                    await file.write(bytes);
                  },
                  close: async () => {
                    if (closed) return;
                    closed = true;
                    await file.close();
                    await hostActionsRef.current.refreshWorkspace();
                  },
                };
              },
              stat: async (path) => {
                const info = await statFile(resolveFilePath(path));
                const timestamps = info as FileInfoWithTimes;
                return {
                  isFile: info.isFile,
                  isDirectory: info.isDirectory,
                  isSymlink: info.isSymlink,
                  size: info.size,
                  mtime: timestamps.mtime ? new Date(timestamps.mtime).getTime() : null,
                  atime: timestamps.atime ? new Date(timestamps.atime).getTime() : null,
                  birthtime: timestamps.birthtime ? new Date(timestamps.birthtime).getTime() : null,
                };
              },
              exists: async (path) => {
                if (providerFor(path)) return true;
                return exists(await resolveFilePath(path));
              },
              create: async (path, content = "") => {
                const destination = await resolveFilePath(path);
                if (await exists(destination)) throw new Error(`File already exists: ${path}`);
                await mkdir(await parentDirectoryPath(destination), { recursive: true });
                await writeTextFile(destination, content);
                await hostActionsRef.current.refreshWorkspace();
              },
              createDirectory: async (path) => {
                await mkdir(await resolveFilePath(path), { recursive: true });
                await hostActionsRef.current.refreshWorkspace();
              },
              delete: async (path) => {
                await resolveFilePath(path);
                await hostActionsRef.current.deleteFile(path);
              },
              rename: async (path, nextPath) => {
                await resolveFilePath(path);
                await resolveFilePath(nextPath);
                const oldParts = path.replace(/\\/g, "/").split("/");
                const nextParts = nextPath.replace(/\\/g, "/").split("/");
                if (oldParts.slice(0, -1).join("/") !== nextParts.slice(0, -1).join("/")) throw new Error("Rename cannot move files to another directory. Use move().");
                await hostActionsRef.current.renameFile(path, nextParts.at(-1) ?? "");
              },
              copy: async (path, destination) => {
                const source = await resolveFilePath(path);
                const target = await resolveFilePath(destination);
                await mkdir(await parentDirectoryPath(target), { recursive: true });
                await copyFile(source, target);
                await hostActionsRef.current.refreshWorkspace();
              },
              move: async (sourcePath, destinationPath, options) => {
                const source = await resolveFilePath(sourcePath);
                const destination = await resolveFilePath(destinationPath);
                if (!options?.overwrite && await exists(destination)) throw new Error(`Destination already exists: ${destinationPath}`);
                if (options?.overwrite && await exists(destination)) await remove(destination, { recursive: true });
                await mkdir(await parentDirectoryPath(destination), { recursive: true });
                await renameFile(source, destination);
                await hostActionsRef.current.refreshWorkspace();
              },
              trash: async (path) => {
                const absolute = await resolveFilePath(path);
                await invoke("plugin_trash_path", { path: absolute });
                await hostActionsRef.current.refreshWorkspace();
              },
              open: async (path) => {
                await resolveFilePath(path);
                await hostActionsRef.current.openFile(path);
              },
              refresh: () => hostActionsRef.current.refreshWorkspace(),
              registerProvider: (scheme, provider) => {
                fileProviders.set(scheme, provider);
                const dispose = () => fileProviders.delete(scheme);
                active.disposables.push(dispose);
                return dispose;
              },
            },
            paths: {
              join: (...parts) => joinNativePath(...parts),
              resolve: (...parts) => resolveNativePath(...parts),
              relative: (from, to) => relativeNativePath(from, to),
              toUri: (path) => pathToUri(path),
              fromUri: (uri) => uriToPath(uri),
              basename: (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "",
              dirname: (path) => parentDirectoryPath(path),
              extname: (path) => {
                const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "";
                const index = name.lastIndexOf(".");
                return index <= 0 ? "" : name.slice(index);
              },
              normalize: (path) => path.replace(/\\/g, "/").replace(/\/+/g, "/"),
            },
            editor: {
              getActive: () => hostActionsRef.current.getEditorSnapshot(),
              getContext: () => hostActionsRef.current.getEditorContext(),
              getLastActive: () => hostActionsRef.current.getLastActiveContext(),
              getLanguage: (path) => hostActionsRef.current.getEditorContext(path)?.language ?? null,
              getCursor: (path) => hostActionsRef.current.getEditorContext(path)?.cursor ?? null,
              getSelections: (path) => hostActionsRef.current.getEditorContext(path)?.selections ?? [],
              getVisibleRanges: (path) => hostActionsRef.current.getEditorContext(path)?.visibleRanges ?? [],
              getText: (path) => getEditor(path)?.state.doc.toString() ?? hostActionsRef.current.getEditorSnapshot(path)?.text ?? null,
              setText: (text, path) => {
                const snapshot = hostActionsRef.current.getEditorSnapshot(path);
                if (!snapshot) throw new Error("No open editor matches that path.");
                hostActionsRef.current.setEditorText(snapshot.path, text);
              },
              insertText: (text, path) => {
                const editor = getEditor(path);
                if (editor) {
                  const range = editor.state.selection.main;
                  editor.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor: range.from + text.length } });
                  editor.focus();
                  return;
                }
                const snapshot = hostActionsRef.current.getEditorSnapshot(path);
                if (!snapshot) throw new Error("No open editor matches that path.");
                const updatedText = snapshot.text.slice(0, snapshot.selection.from) + text + snapshot.text.slice(snapshot.selection.to);
                hostActionsRef.current.setEditorText(snapshot.path, updatedText);
              },
              getSelection: (path) => {
                const editor = getEditor(path);
                if (!editor) return null;
                const range = editor.state.selection.main;
                return { from: range.from, to: range.to };
              },
              setSelection: (from, to = from, path) => {
                const editor = getEditor(path);
                if (!editor) throw new Error("No open editor matches that path.");
                editor.dispatch({ selection: { anchor: from, head: to } });
                editor.focus();
              },
              replaceRange: (range, text, path) => {
                const editor = getEditor(path);
                if (!editor) throw new Error("No open editor matches that path.");
                editor.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor: range.from + text.length } });
              },
              applyEdits: (edits, path, expectedVersion) => {
                const editor = getEditor(path);
                if (!editor) throw new Error("No open editor matches that path.");
                if (expectedVersion !== undefined && editor.state.doc.length !== expectedVersion && expectedVersion !== hostActionsRef.current.getEditorContext(path)?.version) {
                  throw new Error("Editor document version does not match expectedVersion.");
                }
                const changes = [...edits]
                  .sort((a, b) => b.range.from - a.range.from)
                  .map((edit) => ({ from: edit.range.from, to: edit.range.to, insert: edit.text }));
                editor.dispatch({ changes });
              },
              applyWorkspaceEdit: async (edit) => {
                const entries: { path: string; edits: PluginEdit[]; version?: number }[] = [];
                if (edit.changes) for (const [path, edits] of Object.entries(edit.changes)) entries.push({ path, edits });
                if (edit.documentChanges) for (const change of edit.documentChanges) entries.push({ path: uriToPath(change.uri), edits: change.edits, version: change.version });
                for (const entry of entries) {
                  const editor = getEditor(entry.path);
                  if (!editor) throw new Error(`No open editor matches ${entry.path}.`);
                  if (entry.version !== undefined && entry.version !== hostActionsRef.current.getEditorContext(entry.path)?.version) throw new Error(`Document version mismatch for ${entry.path}.`);
                }
                for (const entry of entries) {
                  const editor = getEditor(entry.path);
                  if (!editor) throw new Error(`No open editor matches ${entry.path}.`);
                  const changes = [...entry.edits]
                    .sort((a, b) => b.range.from - a.range.from)
                    .map((item) => ({ from: item.range.from, to: item.range.to, insert: item.text }));
                  editor.dispatch({ changes });
                }
              },
              insertSnippet: (snippet, range, path) => {
                const editor = getEditor(path);
                if (!editor) throw new Error("No open editor matches that path.");
                const target = range ?? editor.state.selection.main;
                const parsed = parseSnippet(snippet);
                editor.dispatch({ changes: { from: target.from, to: target.to, insert: parsed.text }, selection: { anchor: target.from + parsed.cursor } });
                editor.focus();
              },
              revealRange: (range, path) => {
                const editor = getEditor(path);
                if (!editor) throw new Error("No open editor matches that path.");
                editor.dispatch({ effects: CodeMirrorView.scrollIntoView(range.from, { y: "center" }) });
                editor.focus();
              },
              openAt: async (path, line, column = 1) => {
                await resolveFilePath(path);
                await hostActionsRef.current.openFile(path);
                await new Promise((resolve) => window.setTimeout(resolve, 40));
                const editor = getEditor(path) ?? getEditor(hostActionsRef.current.getEditorContext(path)?.path);
                if (!editor) return;
                const lineInfo = editor.state.doc.line(Math.max(1, Math.min(line, editor.state.doc.lines)));
                const offset = Math.min(lineInfo.to, lineInfo.from + Math.max(0, column - 1));
                editor.dispatch({ selection: { anchor: offset }, effects: CodeMirrorView.scrollIntoView(offset, { y: "center" }) });
                editor.focus();
              },
              setLanguage: (languageId, path) => {
                const snapshot = hostActionsRef.current.getEditorSnapshot(path);
                if (!snapshot) throw new Error("No open editor matches that path.");
                hostActionsRef.current.setEditorLanguage(snapshot.path, languageId);
              },
              registerDecorationType: (options) => {
                const typeId = `${plugin.id}:decoration-${++decorationCounter}`;
                decorationTypes.set(typeId, options);
                const dispose = () => decorationTypes.delete(typeId);
                active.disposables.push(dispose);
                return typeId;
              },
              setDecorations: (type, ranges, path) => {
                if (!decorationTypes.has(type)) throw new Error(`Unknown decoration type: ${type}`);
                const context = hostActionsRef.current.getEditorContext(path);
                if (!context) throw new Error("No open editor matches that path.");
                const editor = getEditor(context.path);
                if (!editor) throw new Error("No open editor matches that path.");
                editor.dispatch({ effects: setPluginDecorations.of({ path: context.path, type, ranges }) });
              },
              openDiff: (leftUri, rightUri, title) => showDiffOverlay(leftUri, rightUri, title),
              registerContentProvider: (scheme, provider) => {
                contentProviders.set(scheme, provider);
                const dispose = () => contentProviders.delete(scheme);
                active.disposables.push(dispose);
                return dispose;
              },
              registerCustomEditor: (filePattern, provider) => {
                customEditors.set(filePattern, provider);
                const dispose = () => customEditors.delete(filePattern);
                active.disposables.push(dispose);
                return dispose;
              },
              onWillSave: (handler) => {
                willSaveHandlers.set(`${plugin.id}:${++willSaveCounter}`, { pluginId: plugin.id, handler });
                const key = `${plugin.id}:${willSaveCounter}`;
                const dispose = () => willSaveHandlers.delete(key);
                active.disposables.push(dispose);
                return dispose;
              },
              onActiveChanged: (handler) => subscribeContextEvent("editor:active-changed", handler, active),
              onContextChanged: (handler) => subscribeContextEvent("editor:context-changed", handler, active),
              onSelectionChanged: (handler) => subscribeContextEvent("editor:selection-changed", handler, active),
              onDocumentOpened: (handler) => subscribeRawEvent("document:opened", handler as (payload: unknown) => void, active),
              onDocumentClosed: (handler) => subscribeRawEvent("document:closed", handler as (payload: unknown) => void, active),
              onDocumentChanged: (handler) => subscribeRawEvent("editor:changed", (payload) => { const event = payload as { path: string; content: string }; handler({ path: event.path, content: event.content, version: 0 }); }, active),
              onDocumentSaved: (handler) => subscribeRawEvent("file:saved", handler as (payload: unknown) => void, active),
              focus: (path) => getEditor(path)?.focus(),
              open: async (path) => {
                await resolveFilePath(path);
                await hostActionsRef.current.openFile(path);
              },
              save: async (path) => {
                const active = hostActionsRef.current.getEditorSnapshot(path);
                return active ? hostActionsRef.current.saveFile(active.path) : false;
              },
              format: async (path) => {
                const active = hostActionsRef.current.getEditorSnapshot(path);
                if (active) await hostActionsRef.current.formatFile(active.path);
              },
            },
            languages: {
              register: registerLanguage,
              registerCompletionProvider: registerProvider("completion"),
              registerHoverProvider: registerProvider("hover"),
              registerDefinitionProvider: registerProvider("definition"),
              registerReferenceProvider: registerProvider("reference"),
              registerRenameProvider: registerProvider("rename"),
              registerFormattingProvider: registerProvider("formatting"),
              registerCodeActionProvider: registerProvider("codeAction"),
              registerCodeLensProvider: registerProvider("codeLens"),
              registerInlayHintsProvider: registerProvider("inlayHints"),
              registerSignatureHelpProvider: registerProvider("signatureHelp"),
              registerDocumentSymbolProvider: registerProvider("documentSymbol"),
              registerWorkspaceSymbolProvider: (provider) => registerProvider("workspaceSymbol")("*", provider),
              registerSemanticTokensProvider: registerProvider("semanticTokens"),
              registerFoldingProvider: registerProvider("folding"),
              registerSelectionRangeProvider: registerProvider("selectionRange"),
              registerGrammar,
              startServer: async (options) => {
                const server = await startPluginLanguageServer(invoke, plugin.id, options);
                active.disposables.push(() => { void server.shutdown().catch(() => undefined); });
                return server;
              },
            },
            diagnostics: { createCollection },
            terminal: {
              open: (command) => hostActionsRef.current.openTerminal(command),
              list: () => hostActionsRef.current.getTerminals(),
              write: (id, data) => hostActionsRef.current.writeTerminal(id, data),
              resize: (id, cols, rows) => hostActionsRef.current.resizeTerminal(id, cols, rows),
              close: (id) => hostActionsRef.current.closeTerminal(id),
            },
            settings: {
              get: () => hostActionsRef.current.getAppState().settings,
              update: (patch) => hostActionsRef.current.updateSettings(patch),
            },
            themes: {
              list: () => hostActionsRef.current.getThemes(),
              set: (id) => hostActionsRef.current.setTheme(id),
              getColors: () => ({ ...hostActionsRef.current.getAppState().theme.colors }),
              onChanged: (handler) => subscribeRawEvent("settings:changed", (payload) => {
                const event = payload as { theme?: ThemeDefinition } | null;
                if (event?.theme) handler(event.theme);
              }, active),
            },
            dialogs: {
              openFile: async (options) => {
                const selected = await open({ directory: false, multiple: options?.multiple ?? false, filters: options?.filters });
                return typeof selected === "string" || Array.isArray(selected) ? selected : null;
              },
              openFolder: async () => {
                const selected = await open({ directory: true, multiple: false });
                return typeof selected === "string" ? selected : null;
              },
              saveFile: (options) => save(options),
            },
            clipboard: {
              readText: () => readClipboardText(),
              writeText: (text) => writeClipboardText(text),
              writeHtml: (html, fallbackText) => writeClipboardHtml(html, fallbackText),
            },
            window: {
              minimize: () => getCurrentWindow().minimize(),
              toggleMaximize: () => getCurrentWindow().toggleMaximize(),
              close: () => getCurrentWindow().close(),
              setSize: (width, height) => getCurrentWindow().setSize(new LogicalSize(width, height)),
              setFullscreen: (fullscreen) => getCurrentWindow().setFullscreen(fullscreen),
              setAlwaysOnTop: (alwaysOnTop) => getCurrentWindow().setAlwaysOnTop(alwaysOnTop),
              center: () => getCurrentWindow().center(),
              isFocused: () => getCurrentWindow().isFocused(),
              onFocusChanged: (handler) => {
                const stop = subscribeWindowFocus(handler);
                active.disposables.push(stop);
                return stop;
              },
              getVisibility: () => currentVisibility(),
              onVisibilityChanged: (handler) => {
                const stop = subscribeVisibility(handler);
                active.disposables.push(stop);
                return stop;
              },
              getIdleTime: () => pluginIdleTime(),
            },
            ui: {
              notify,
              confirm: (message) => window.confirm(message),
              prompt: (message, defaultValue) => window.prompt(message, defaultValue),
              registerAction,
              updateAction: (id, changes) => {
                const fullId = id.includes(":") ? id : `${plugin.id}:${id}`;
                setActions((current) => current.map((action) => action.id === fullId ? { ...action, ...changes, id: fullId, pluginId: plugin.id, pluginName: plugin.name } : action));
              },
              registerContextMenuItem,
              registerMenuItem: (menu, item) => {
                const id = `${slugify(menu)}-${item.id}`;
                registerContextMenuItem({ ...item, id });
                const fullId = `${plugin.id}:${id}`;
                const dispose = () => setContextMenuItems((current) => current.filter((entry) => entry.id !== fullId));
                active.disposables.push(dispose);
                return dispose;
              },
              registerStatusItem,
              updateStatusItem: (id, changes) => {
                const fullId = id.includes(":") ? id : `${plugin.id}:${id}`;
                setStatusItems((current) => current.map((item) => item.id === fullId ? { ...item, ...changes, id: fullId, pluginId: plugin.id, pluginName: plugin.name } : item));
              },
              registerCommand,
              registerPanel,
              registerSidebarView: registerView("sidebar"),
              registerBottomView: registerView("bottom"),
              registerTreeView: (options) => {
                const id = `${plugin.id}:${options.id}`;
                registerPanel({
                  id: options.id,
                  title: options.title,
                  mount: (container) => {
                    const list = document.createElement("div");
                    list.className = "arc-plugin-tree";
                    container.replaceChildren(list);
                    const renderChildren = async (parent: HTMLElement, element: unknown, depth: number) => {
                      const children = await options.getChildren(element);
                      for (const child of children) {
                        const node = child as { label?: string; name?: string; description?: string; children?: boolean; collapsible?: boolean; expanded?: boolean; element?: unknown; icon?: string; actions?: { label: string; run: () => unknown }[] };
                        const row = document.createElement("div");
                        row.className = "arc-plugin-tree-row";
                        row.style.paddingLeft = `${depth * 12}px`;
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = "arc-plugin-tree-item";
                        const expandable = Boolean(node.children || node.collapsible);
                        const marker = document.createElement("span");
                        marker.className = "arc-plugin-tree-marker";
                        marker.textContent = expandable ? "▸" : "";
                        const icon = document.createElement("span");
                        icon.className = "arc-plugin-tree-icon";
                        icon.textContent = node.icon ?? "";
                        const label = document.createElement("span");
                        label.textContent = node.label ?? node.name ?? String(node);
                        const description = document.createElement("small");
                        description.textContent = node.description ?? "";
                        button.append(marker, icon, label, description);
                        const childHost = document.createElement("div");
                        childHost.className = "arc-plugin-tree-children";
                        let expanded = false;
                        const toggle = async () => {
                          expanded = !expanded;
                          marker.textContent = expanded ? "▾" : "▸";
                          if (expanded) await renderChildren(childHost, node.element ?? child, depth + 1);
                          else childHost.replaceChildren();
                        };
                        button.addEventListener("click", () => {
                          options.onSelect?.(node.element ?? child);
                          if (expandable) void toggle();
                        });
                        row.append(button);
                        for (const action of node.actions ?? []) {
                          const actionButton = document.createElement("button");
                          actionButton.type = "button";
                          actionButton.className = "arc-plugin-tree-action";
                          actionButton.textContent = action.label;
                          actionButton.addEventListener("click", (event) => { event.stopPropagation(); void action.run(); });
                          row.append(actionButton);
                        }
                        parent.append(row, childHost);
                        if (node.expanded && expandable) void toggle();
                      }
                    };
                    void renderChildren(list, undefined, 0);
                    return () => container.replaceChildren();
                  },
                });
                active.contexts.set(`tree:${id}`, options);
                const dispose = () => setPanels((current) => current.filter((panel) => panel.id !== id));
                active.disposables.push(dispose);
                return dispose;
              },
              registerCustomTab: (options) => registerView("customTab")(options),
              setViewBadge: (viewId, badge) => {
                const id = viewId.includes(":") ? viewId : `${plugin.id}:${viewId}`;
                setStatusItems((current) => {
                  const existing = current.find((item) => item.id === id);
                  if (!badge && existing) return current.filter((item) => item.id !== id);
                  const next = { id, text: String(badge ?? ""), pluginId: plugin.id, pluginName: plugin.name };
                  return existing ? current.map((item) => item.id === id ? { ...item, ...next } : item) : [...current, next];
                });
              },
              showQuickPick: (items, options) => showQuickPickModal(items, options),
              showInputBox: (options) => showInputBoxModal(options),
              showProgress: async (options, task) => {
                notify(`${options.title}…`);
                try {
                  const result = await task((message) => notify(`${options.title}: ${message}`));
                  notify(`${options.title}: done`);
                  return result;
                } catch (error) {
                  notify(`${options.title}: ${String(error)}`);
                  throw error;
                }
              },
              showNotification: (message, options) => showNotificationToast(message, options),
              createOutputChannel: makeOutputChannel,
              setContext: (key, value) => {
                active.contexts.set(key, value);
                setPluginContextValue(plugin.id, key, value);
                emitEvent("context:changed", { key, value });
              },
              focusView: (id) => hostActionsRef.current.openPluginPanel(id.includes(":") ? id : `${plugin.id}:${id}`),
              closeView: (id) => hostActionsRef.current.closePluginPanel(id.includes(":") ? id : `${plugin.id}:${id}`),
              addStyles: (css) => {
                if (css.length > 100_000) throw new Error("Plugin stylesheet exceeds 100 KB.");
                const style = document.createElement("style");
                style.dataset.arcPlugin = plugin.id;
                style.textContent = css;
                document.head.append(style);
                const dispose = () => style.remove();
                active.disposables.push(dispose);
                return dispose;
              },
            },
            commands: {
              list: () => [...commandRef.current.values()].map(({ id, title, description, pluginName }) => ({ id, title, description, pluginName })),
              execute: runCommand,
              onExecuted: (handler) => subscribeRawEvent("command:executed", handler as (payload: unknown) => void, active),
            },
            keybindings: {
              register: (commandId, shortcut, condition) => {
                const binding: PluginKeybinding = {
                  commandId: commandId.includes(":") ? commandId : `${plugin.id}:${commandId}`,
                  shortcut,
                  condition,
                  pluginId: plugin.id,
                  pluginName: plugin.name,
                };
                setKeybindings((current) => [...current.filter((entry) => !(entry.commandId === binding.commandId && entry.shortcut === binding.shortcut)), binding]);
                const dispose = () => setKeybindings((current) => current.filter((entry) => entry !== binding));
                active.disposables.push(dispose);
                return dispose;
              },
              unregister: (commandId, shortcut) => {
                const fullId = commandId.includes(":") ? commandId : `${plugin.id}:${commandId}`;
                setKeybindings((current) => current.filter((entry) => !(entry.pluginId === plugin.id && entry.commandId === fullId && entry.shortcut === shortcut)));
              },
            },
            events: {
              on: (event, listener) => {
                const callbacks = listeners.current.get(event) ?? new Set<(payload: unknown) => void>();
                callbacks.add(listener);
                listeners.current.set(event, callbacks);
                const dispose = () => {
                  callbacks.delete(listener);
                  if (!callbacks.size) listeners.current.delete(event);
                };
                active.disposables.push(dispose);
                return dispose;
              },
              emit: (event, payload) => emitEvent(`plugin:${plugin.id}:${event}`, payload),
            },
            storage: {
              get: <T,>(key: string, fallback?: T) => readJsonStorage(scopedStorageKey(key), fallback),
              set: (key, value) => localStorage.setItem(scopedStorageKey(key), JSON.stringify(value)),
              remove: (key) => localStorage.removeItem(scopedStorageKey(key)),
              clear: () => Object.keys(localStorage).filter((key) => key.startsWith(scopedStorageKey("")) && !key.startsWith(scopedStorageKey("secret."))).forEach((key) => localStorage.removeItem(key)),
              workspace: {
                get: <T,>(key: string, fallback?: T) => readJsonStorage(workspaceStorageKey(key), fallback),
                set: (key, value) => localStorage.setItem(workspaceStorageKey(key), JSON.stringify(value)),
                remove: (key) => localStorage.removeItem(workspaceStorageKey(key)),
                clear: () => Object.keys(localStorage).filter((key) => key.startsWith(workspaceStorageKey(""))).forEach((key) => localStorage.removeItem(key)),
              },
            },
            configuration: {
              register: (schema) => {
                if (!active.active || activeModules.current.get(plugin.id) !== active) return () => undefined;
                validateId(schema.id);
                if (!schema.properties || typeof schema.properties !== "object") throw new Error(`Plugin ${plugin.name} registered an invalid configuration schema.`);
                const contribution: PluginConfigurationContribution = {
                  id: `${plugin.id}:${schema.id}`,
                  schemaId: schema.id,
                  title: schema.title?.trim() || schema.id,
                  properties: schema.properties,
                  pluginId: plugin.id,
                  pluginName: plugin.name,
                };
                configurationStore.set(contribution.id, { schema: schema as unknown as Record<string, unknown>, properties: schema.properties });
                setConfigurations((current) => [...current.filter((entry) => entry.id !== contribution.id), contribution]);
                const dispose = () => {
                  configurationStore.delete(contribution.id);
                  setConfigurations((current) => current.filter((entry) => entry.id !== contribution.id));
                };
                active.disposables.push(dispose);
                return dispose;
              },
              get: <T,>(key: string, fallback?: T) => {
                const value = getConfigurationValue(plugin.id, key);
                return (value === undefined ? fallback : value) as T;
              },
              update: (key, value, scope) => {
                const storageKey = configurationStorageKey(plugin.id, key, scope);
                localStorage.setItem(storageKey, JSON.stringify(value));
                configurationListeners.current.get(plugin.id)?.forEach((listener) => listener({ key, value }));
              },
              onChanged: (handler) => {
                const pluginListeners = configurationListeners.current.get(plugin.id) ?? new Set();
                pluginListeners.add(handler);
                configurationListeners.current.set(plugin.id, pluginListeners);
                const dispose = () => {
                  pluginListeners.delete(handler);
                  if (!pluginListeners.size) configurationListeners.current.delete(plugin.id);
                };
                active.disposables.push(dispose);
                return dispose;
              },
            },
            secrets: {
              get: async (key) => {
                const legacyKey = scopedStorageKey(`secret.${key}`);
                const legacy = (() => {
                  try {
                    const value = localStorage.getItem(legacyKey);
                    return value === null ? null : atob(value);
                  } catch {
                    return null;
                  }
                })();
                let stored: string | null;
                try {
                  stored = await invoke<string | null>("plugin_secret_get", { pluginId: plugin.id, key });
                } catch (error) {
                  if (legacy !== null) return legacy;
                  throw error;
                }
                if (stored !== null) {
                  if (legacy !== null) localStorage.removeItem(legacyKey);
                  return stored;
                }
                if (legacy === null) return null;
                try {
                  await invoke("plugin_secret_set", { pluginId: plugin.id, key, value: legacy });
                  localStorage.removeItem(legacyKey);
                } catch { /* Keep the legacy value readable if the OS store is unavailable. */ }
                return legacy;
              },
              set: async (key, value) => {
                await invoke("plugin_secret_set", { pluginId: plugin.id, key, value });
                localStorage.removeItem(scopedStorageKey(`secret.${key}`));
              },
              delete: async (key) => {
                await invoke("plugin_secret_delete", { pluginId: plugin.id, key });
                localStorage.removeItem(scopedStorageKey(`secret.${key}`));
              },
            },
            workspaceFolders: {
              get: async () => hostActionsRef.current.getWorkspaceFolders(),
              onChanged: (handler) => subscribeRawEvent("workspace:changed", () => handler(hostActionsRef.current.getWorkspaceFolders()), active),
            },
            workspaceTrust: {
              isTrusted: () => hostActionsRef.current.isWorkspaceTrusted(),
              onChanged: (handler) => subscribeRawEvent("workspace:trust-changed", (payload) => handler(Boolean(payload)), active),
            },
            icons: {
              register: (name, svg) => {
                const key = `${plugin.id}:${name}`;
                const sanitized = sanitizeSvg(svg);
                icons.set(key, sanitized);
                setIconRegistry((current) => ({ ...current, [key]: sanitized }));
                const dispose = () => {
                  icons.delete(key);
                  setIconRegistry((current) => {
                    const next = { ...current };
                    delete next[key];
                    return next;
                  });
                };
                active.disposables.push(dispose);
                return dispose;
              },
              unregister: (name) => {
                const key = `${plugin.id}:${name}`;
                icons.delete(key);
                setIconRegistry((current) => {
                  const next = { ...current };
                  delete next[key];
                  return next;
                });
              },
              get: (name) => icons.get(`${plugin.id}:${name}`) ?? null,
            },
            assets: {
              url: async (relativePath) => {
                const resolved = await resolvePluginAsset(relativePath);
                const bytes = await readFile(resolved);
                const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeForPath(resolved) }));
                active.disposables.push(() => URL.revokeObjectURL(url));
                return url;
              },
              readText: async (relativePath) => readTextFile(await resolvePluginAsset(relativePath)),
              readBytes: async (relativePath) => readFile(await resolvePluginAsset(relativePath)),
              resolvePath: resolvePluginAsset,
            },
            plugins: {
              list: () => pluginsRef.current.map(({ id, name, version, description, enabled, builtin }) => ({ id, name, version, description, enabled, builtin })),
              get: (id) => {
                const entry = pluginsRef.current.find((candidate) => candidate.id === id);
                return entry ? (({ name, version, description, enabled, builtin }) => ({ id, name, version, description, enabled, builtin }))(entry) : null;
              },
              whenAvailable: (id) => waitFor(() => Boolean(pluginsRef.current.find((candidate) => candidate.id === id && candidate.enabled)), pluginsChangedListeners.current),
              onChanged: (handler) => {
                pluginsChangedListeners.current.add(handler);
                const dispose = () => pluginsChangedListeners.current.delete(handler);
                active.disposables.push(dispose);
                return dispose;
              },
            },
            services: {
              register: (name, implementation) => {
                pluginServices.set(name, { pluginId: plugin.id, implementation });
                serviceListeners.forEach((listener) => listener());
                const dispose = () => {
                  pluginServices.delete(name);
                  serviceListeners.forEach((listener) => listener());
                };
                active.disposables.push(dispose);
                return dispose;
              },
              get: (name) => pluginServices.get(name)?.implementation ?? null,
              whenAvailable: async (name) => {
                await waitFor(() => pluginServices.has(name), serviceListeners);
                return pluginServices.get(name)?.implementation ?? null;
              },
            },
            process: {
              isRunning: (names) => invoke<boolean>("plugin_process_is_running", { names }),
              spawn: async (executable, args = [], options) => {
                const handle = await spawnPluginProcess(invoke, plugin.id, executable, args, options);
                active.disposables.push(() => { void handle.stop().catch(() => undefined); });
                return handle;
              },
              which: (executable) => invoke<string | null>("plugin_process_which", { executable }),
              exec: (executable, args = [], options) => invoke<{ stdout: string; stderr: string; code: number | null; signal: string | null }>("plugin_process_exec", { executable, args, cwd: options?.cwd ?? null, env: options?.env ?? null, timeoutMs: options?.timeoutMs ?? 30_000 }),
            },
            pty: {
              spawn: async (executable, args = [], options) => {
                const handle = await spawnPluginPty(invoke, plugin.id, executable, args, options);
                active.disposables.push(() => { void handle.stop().catch(() => undefined); });
                return handle;
              },
            },
            ipc: {
              connectUnix: (path, options) => connectPluginSocket(invoke, plugin.id, "unix", path, options?.timeoutMs),
              connectPipe: (name, options) => connectPluginSocket(invoke, plugin.id, "pipe", name, options?.timeoutMs),
            },
            net: {
              fetch: async (url, options) => {
                const { timeoutMs, signal, ...init } = options ?? {};
                if (!timeoutMs) return fetch(url, { ...init, signal });
                const controller = new AbortController();
                const timer = window.setTimeout(() => controller.abort(), timeoutMs);
                const abort = () => controller.abort();
                signal?.addEventListener("abort", abort);
                try {
                  return await fetch(url, { ...init, signal: controller.signal });
                } finally {
                  window.clearTimeout(timer);
                  signal?.removeEventListener("abort", abort);
                }
              },
              connectTcp: (host, port, options) => connectPluginSocket(invoke, plugin.id, "tcp", `${host}:${port}`, options?.timeoutMs),
              listenHttp: (handler, options) => listenPluginHttp(invoke, plugin.id, handler, options),
              connectWebSocket: async (url, options) => {
                const socket = new WebSocket(url, options?.protocols);
                await new Promise<void>((resolve, reject) => {
                  socket.addEventListener("open", () => resolve(), { once: true });
                  socket.addEventListener("error", () => reject(new Error(`WebSocket connection failed: ${url}`)), { once: true });
                });
                const dataListeners = new Set<(data: string | Uint8Array) => void>();
                const errorListeners = new Set<(error: string) => void>();
                const closeListeners = new Set<(event: { code: number; reason: string }) => void>();
                socket.binaryType = "arraybuffer";
                socket.addEventListener("message", (event) => {
                  const data = typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer);
                  dataListeners.forEach((listener) => listener(data));
                });
                socket.addEventListener("error", () => errorListeners.forEach((listener) => listener("WebSocket error")));
                socket.addEventListener("close", (event) => closeListeners.forEach((listener) => listener({ code: event.code, reason: event.reason })));
                const handle: PluginWebSocketHandle = {
                  send: (data) => socket.send(data),
                  close: (code, reason) => socket.close(code, reason),
                  onMessage: (listener) => { dataListeners.add(listener); return () => dataListeners.delete(listener); },
                  onError: (listener) => { errorListeners.add(listener); return () => errorListeners.delete(listener); },
                  onClose: (listener) => { closeListeners.add(listener); return () => closeListeners.delete(listener); },
                };
                active.disposables.push(() => socket.close());
                return handle;
              },
              connectEventSource: (url, options) => {
                let source = new EventSource(url);
                const messageListeners = new Set<(event: { data: string; event: string; id: string }) => void>();
                const errorListeners = new Set<(error: string) => void>();
                const attach = (instance: EventSource) => {
                  instance.addEventListener("message", (event) => messageListeners.forEach((listener) => listener({ data: event.data, event: event.type, id: event.lastEventId })));
                  instance.addEventListener("error", () => {
                    if (options?.reconnect === false) {
                      errorListeners.forEach((listener) => listener("EventSource error"));
                    } else {
                      instance.close();
                      window.setTimeout(() => { source = new EventSource(url); attach(source); }, 1500);
                    }
                  });
                };
                attach(source);
                const close = () => source.close();
                active.disposables.push(close);
                return {
                  onMessage: (listener) => { messageListeners.add(listener); return () => messageListeners.delete(listener); },
                  onError: (listener) => { errorListeners.add(listener); return () => errorListeners.delete(listener); },
                  close,
                };
              },
              download: async (url, destination, options) => {
                const response = await fetch(url, { signal: options?.signal });
                if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
                const total = Number(response.headers.get("content-length") ?? 0) || null;
                const reader = response.body?.getReader();
                const chunks: Uint8Array[] = [];
                let received = 0;
                if (reader) {
                  for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                      chunks.push(value);
                      received += value.length;
                      options?.onProgress?.(received, total);
                    }
                  }
                }
                const merged = new Uint8Array(received);
                let offset = 0;
                for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
                const path = await resolveFilePath(destination);
                await mkdir(await parentDirectoryPath(path), { recursive: true });
                await writeFile(path, merged);
                await hostActionsRef.current.refreshWorkspace();
                return { path: destination, bytes: received };
              },
              isOnline: () => navigator.onLine,
              onOnlineChanged: (handler) => {
                const online = () => handler(true);
                const offline = () => handler(false);
                window.addEventListener("online", online);
                window.addEventListener("offline", offline);
                const dispose = () => {
                  window.removeEventListener("online", online);
                  window.removeEventListener("offline", offline);
                };
                active.disposables.push(dispose);
                return dispose;
              },
            },
            git: {
              getRepositories: async () => {
                try {
                  const status = await hostActionsRef.current.getGitStatus() as { isRepo?: boolean } | null;
                  return status?.isRepo ? [workspaceRef.current] : [];
                } catch {
                  return [];
                }
              },
              getStatus: async () => hostActionsRef.current.getGitStatus(),
              getBranch: async () => hostActionsRef.current.getGitBranch(),
              getDiff: (_repoPath, path, options) => hostActionsRef.current.getGitDiff(path, options?.staged),
              onChanged: (_repository, handler) => {
                const timer = window.setInterval(() => handler(), 2500);
                const dispose = () => window.clearInterval(timer);
                active.disposables.push(dispose);
                return dispose;
              },
            },
            tasks: {
              registerProvider: (type, provider) => {
                taskProviders.set(`${plugin.id}:${type}`, { pluginId: plugin.id, provider });
                const dispose = () => taskProviders.delete(`${plugin.id}:${type}`);
                active.disposables.push(dispose);
                return dispose;
              },
              run: async (task) => {
                const definition = task as { command?: string; executable?: string; args?: string[]; cwd?: string; env?: Record<string, string> };
                const id = `task-${Date.now()}-${++taskCounter}`;
                const process = await spawnPluginProcess(invoke, plugin.id, definition.executable ?? definition.command ?? "", definition.args ?? [], { cwd: definition.cwd ?? workspaceRef.current, env: definition.env });
                active.disposables.push(() => { void process.stop().catch(() => undefined); });
                emitEvent("task:started", { id, task });
                const exitListeners = new Set<(event: { code: number | null }) => void>();
                process.onExit((event) => {
                  exitListeners.forEach((listener) => listener({ code: event.code }));
                  emitEvent("task:finished", { id, code: event.code });
                });
                return {
                  id,
                  stop: () => process.stop(),
                  onExit: (handler) => { exitListeners.add(handler); return () => exitListeners.delete(handler); },
                };
              },
              onStarted: (handler) => subscribeRawEvent("task:started", handler as (payload: unknown) => void, active),
              onFinished: (handler) => subscribeRawEvent("task:finished", handler as (payload: unknown) => void, active),
            },
            tests: {
              createController: (id, label) => {
                const fullId = `${plugin.id}:${id}`;
                let items: unknown[] = [];
                const dispose = () => emitEvent("tests:changed", { id: fullId, items: [], label });
                active.disposables.push(dispose);
                return {
                  id: fullId,
                  label,
                  setItems: (next) => { items = next; emitEvent("tests:changed", { id: fullId, label, items }); },
                  reportResult: (item) => emitEvent("test:result", { id: fullId, item }),
                  dispose,
                };
              },
            },
            debug: {
              registerAdapter: (type, factory) => {
                if (!type.trim()) throw new Error("A debug adapter type is required.");
                debugAdapters.set(`${plugin.id}:${type}`, factory);
                const dispose = () => debugAdapters.delete(`${plugin.id}:${type}`);
                active.disposables.push(dispose);
                return dispose;
              },
              start: async (configuration) => {
                const config = (configuration ?? {}) as { type?: string };
                if (!config.type) throw new Error("Debug configuration requires a type.");
                const factory = debugAdapters.get(`${plugin.id}:${config.type}`);
                if (!factory) throw new Error(`No debug adapter registered for type: ${config.type}`);
                const id = `debug-${Date.now()}-${++debugCounter}`;
                const adapter = typeof factory === "function" ? await factory(configuration) : factory;
                const candidate = (adapter ?? {}) as { start?: (configuration: unknown) => unknown; stop?: () => unknown; command?: string; executable?: string; args?: string[]; cwd?: string; env?: Record<string, string> };
                let stop: () => Promise<void> = async () => undefined;
                if (typeof candidate.start === "function") {
                  await candidate.start(configuration);
                  if (typeof candidate.stop === "function") stop = async () => { await candidate.stop?.(); };
                } else if (candidate.command || candidate.executable) {
                  const process = await spawnPluginProcess(invoke, plugin.id, candidate.executable ?? candidate.command ?? "", candidate.args ?? [], { cwd: candidate.cwd ?? workspaceRef.current, env: candidate.env });
                  const sendDap = async (message: unknown) => {
                    const body = JSON.stringify(message);
                    await process.write(`Content-Length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`);
                  };
                  await sendDap({ seq: 1, type: "request", command: "initialize", arguments: { adapterID: config.type, clientID: "arc", linesStartAt1: true, columnsStartAt1: true, pathFormat: "path" } });
                  await sendDap({ seq: 2, type: "request", command: (configuration as { request?: string }).request === "attach" ? "attach" : "launch", arguments: configuration });
                  process.onExit(() => {
                    if (activeDebugSession?.id === id) {
                      activeDebugSession = null;
                      emitEvent("debug:session-changed", null);
                    }
                  });
                  process.onStderr((chunk) => emitEvent("debug:output", { id, output: chunk, category: "stderr" }));
                  stop = () => process.stop();
                }
                activeDebugSession = { id, configuration, pluginId: plugin.id, stop };
                emitEvent("debug:session-changed", { id, configuration, pluginId: plugin.id });
                return {
                  id,
                  stop: async () => {
                    await stop();
                    if (activeDebugSession?.id === id) {
                      activeDebugSession = null;
                      emitEvent("debug:session-changed", null);
                    }
                  },
                };
              },
              stop: async (sessionId) => {
                const session = activeDebugSession?.id === sessionId ? activeDebugSession : null;
                await session?.stop?.();
                if (activeDebugSession?.id === sessionId) {
                  activeDebugSession = null;
                  emitEvent("debug:session-changed", null);
                }
              },
              getActiveSession: () => activeDebugSession ? { id: activeDebugSession.id, configuration: activeDebugSession.configuration, pluginId: activeDebugSession.pluginId } : null,
              onSessionChanged: (handler) => subscribeRawEvent("debug:session-changed", handler as (payload: unknown) => void, active),
            },
            auth: {
              registerProvider: (id, provider) => {
                authProviders.set(`${plugin.id}:${id}`, provider);
                const dispose = () => authProviders.delete(`${plugin.id}:${id}`);
                active.disposables.push(dispose);
                return dispose;
              },
              getSession: async (providerId, scopes, options) => {
                const provider = authProviders.get(providerId.includes(":") ? providerId : `${plugin.id}:${providerId}`);
                if (!provider) throw new Error(`Unknown authentication provider: ${providerId}`);
                const existing = await provider.getSessions?.(scopes);
                if (existing) return existing;
                if (!options?.createIfNone) return null;
                return provider.createSession?.(scopes) ?? null;
              },
            },
            links: {
              registerUriHandler: (handler) => {
                linkHandlers.set(`${plugin.id}:${++linkCounter}`, { pluginId: plugin.id, handler });
                const key = `${plugin.id}:${linkCounter}`;
                const dispose = () => linkHandlers.delete(key);
                active.disposables.push(dispose);
                return dispose;
              },
              createCallbackUrl: (path) => `arc://plugin/${plugin.id}/${path.replace(/^\/+/, "")}`,
            },
            mcp: {
              registerServer: (id, definition) => {
                const key = id.includes(":") ? id : `${plugin.id}:${id}`;
                mcpServers.set(key, { pluginId: plugin.id, definition, state: "registered" });
                const dispose = () => {
                  void disconnectMcp(key);
                  mcpServers.delete(key);
                };
                active.disposables.push(dispose);
                return dispose;
              },
              unregisterServer: (id) => {
                const key = resolveKey(plugin.id, id);
                void disconnectMcp(key);
                mcpServers.delete(key);
              },
              listServers: () => [...mcpServers.entries()].filter(([, entry]) => entry.pluginId === plugin.id).map(([id, entry]) => ({ id, state: entry.state, definition: { ...entry.definition, env: undefined } })),
              getServer: (id) => {
                const entry = mcpServers.get(resolveKey(plugin.id, id));
                return entry ? { id: resolveKey(plugin.id, id), state: entry.state, definition: { ...entry.definition, env: undefined } } : null;
              },
              connect: async (id, options) => {
                const key = resolveKey(plugin.id, id);
                const handle = await connectMcp(key, options?.timeoutMs);
                active.disposables.push(() => { void disconnectMcp(key).catch(() => undefined); });
                return handle;
              },
              disconnect: (id) => disconnectMcp(resolveKey(plugin.id, id)),
              restart: async (id) => {
                const key = resolveKey(plugin.id, id);
                await disconnectMcp(key);
                return connectMcp(key);
              },
              getCapabilities: (id) => mcpServers.get(resolveKey(plugin.id, id))?.capabilities ?? null,
              onServerChanged: (handler) => subscribeMcp("server", handler as (payload: unknown) => void, active),
              onLog: (handler) => subscribeMcp("log", handler as (payload: unknown) => void, active),
              setLogLevel: async (serverId, level) => { await mcpRequest(resolveKey(plugin.id, serverId), "logging/setLevel", { level }); },
              ping: async (serverId, options) => {
                try {
                  await withTimeout(mcpRequest(resolveKey(plugin.id, serverId), "ping", {}), options?.timeoutMs ?? 5000);
                  return true;
                } catch {
                  return false;
                }
              },
              listTools: (serverId, options) => mcpRequest(resolveKey(plugin.id, serverId), "tools/list", options ?? {}),
              callTool: (serverId, name, args, options) => withTimeout(mcpRequest(resolveKey(plugin.id, serverId), "tools/call", { name, arguments: args ?? {} }), options?.timeoutMs ?? 60_000),
              onToolsChanged: (serverId, handler) => {
                const key = resolveKey(plugin.id, serverId);
                return subscribeMcp("tools", (payload) => { if ((payload as { id?: string })?.id === key) handler(); }, active);
              },
              listResources: (serverId, options) => mcpRequest(resolveKey(plugin.id, serverId), "resources/list", options ?? {}),
              listResourceTemplates: (serverId, options) => mcpRequest(resolveKey(plugin.id, serverId), "resources/templates/list", options ?? {}),
              readResource: (serverId, uri) => mcpRequest(resolveKey(plugin.id, serverId), "resources/read", { uri }),
              subscribeResource: (serverId, uri, handler) => {
                const key = resolveKey(plugin.id, serverId);
                const listener = () => handler();
                const set = mcpResourceSubscriptions.get(key) ?? new Map<string, () => void>();
                set.set(uri, listener);
                mcpResourceSubscriptions.set(key, set);
                void mcpRequest(key, "resources/subscribe", { uri }).catch(() => undefined);
                const dispose = () => {
                  set.delete(uri);
                  void mcpRequest(key, "resources/unsubscribe", { uri }).catch(() => undefined);
                };
                active.disposables.push(dispose);
                return dispose;
              },
              onResourcesChanged: (serverId, handler) => {
                const key = resolveKey(plugin.id, serverId);
                return subscribeMcp("resources", (payload) => { if ((payload as { id?: string })?.id === key) handler(); }, active);
              },
              listPrompts: (serverId, options) => mcpRequest(resolveKey(plugin.id, serverId), "prompts/list", options ?? {}),
              getPrompt: (serverId, name, args) => mcpRequest(resolveKey(plugin.id, serverId), "prompts/get", { name, arguments: args ?? {} }),
              onPromptsChanged: (serverId, handler) => {
                const key = resolveKey(plugin.id, serverId);
                return subscribeMcp("prompts", (payload) => { if ((payload as { id?: string })?.id === key) handler(); }, active);
              },
              complete: (serverId, reference, argument) => mcpRequest(resolveKey(plugin.id, serverId), "completion/complete", { ref: reference, argument }),
              setRoots: async (serverId, roots) => {
                const key = resolveKey(plugin.id, serverId);
                const entry = mcpServers.get(key);
                if (!entry?.client) throw new Error("MCP server is not connected.");
                mcpRoots.set(key, roots);
                await entry.client.notify("notifications/roots/list_changed");
              },
              onSamplingRequest: (handler) => {
                const listener = handler as (payload: unknown) => unknown;
                mcpHostHandlers.sampling.add(listener);
                const dispose = () => { mcpHostHandlers.sampling.delete(listener); };
                active.disposables.push(dispose);
                return dispose;
              },
              onElicitationRequest: (handler) => {
                const listener = handler as (payload: unknown) => unknown;
                mcpHostHandlers.elicitation.add(listener);
                const dispose = () => { mcpHostHandlers.elicitation.delete(listener); };
                active.disposables.push(dispose);
                return dispose;
              },
              onAuthorizationRequired: (handler) => {
                const listener = handler as (payload: unknown) => unknown;
                mcpHostHandlers.authorization.add(listener);
                const dispose = () => { mcpHostHandlers.authorization.delete(listener); };
                active.disposables.push(dispose);
                return dispose;
              },
              exposeTool: (definition, handler) => exposeMcp("tool", definition, handler, plugin.id, active),
              exposeResource: (definition, handler) => exposeMcp("resource", definition, handler, plugin.id, active),
              exposeResourceTemplate: (definition, handler) => exposeMcp("resourceTemplate", definition, handler, plugin.id, active),
              exposePrompt: (definition, handler) => exposeMcp("prompt", definition, handler, plugin.id, active),
              notifyResourceChanged: (uri) => {
                emitEvent("mcp:resource-changed", { uri });
                emitMcpEvent("exposure-changed", { pluginId: plugin.id, uri });
              },
              getExposure: () => {
                void ensureArcMcpServer();
                const own = [...mcpExposures.values()].filter((entry) => entry.pluginId === plugin.id);
                return {
                  tools: own.filter((entry) => entry.kind === "tool").map(({ definition }) => definition),
                  resources: own.filter((entry) => entry.kind === "resource").map(({ definition }) => definition),
                  resourceTemplates: own.filter((entry) => entry.kind === "resourceTemplate").map(({ definition }) => definition),
                  prompts: own.filter((entry) => entry.kind === "prompt").map(({ definition }) => definition),
                  serverUrl: arcMcpServerUrl,
                  authorization: arcMcpServerUrl ? `Bearer ${arcMcpToken}` : null,
                };
              },
              onExposureChanged: (handler) => subscribeMcp("exposure-changed", (payload) => {
                if (!payload || (payload as { pluginId?: string }).pluginId === plugin.id) handler();
              }, active),
            },
            localServer: {
              start: (root, entry = "") => invoke<{ root: string; url: string }>("plugin_local_server_start", { pluginId: plugin.id, root, entry }),
              stop: () => invoke<boolean>("plugin_local_server_stop", { pluginId: plugin.id }),
            },
            registerAction,
            registerContextMenuItem,
          };
          const cleanup = await pluginModule.activate(api);
          if (typeof cleanup === "function") {
            if (active.active) active.cleanup = cleanup;
            else cleanup();
          }
        } catch (error) {
          if (active.active) notify(`Could not activate plugin ${plugin.name}: ${String(error)}`);
          active.active = false;
          active.timers.forEach((timer) => { window.clearTimeout(timer); window.clearInterval(timer); });
          active.workers.forEach((worker) => worker.terminate());
          active.disposables.forEach((dispose) => { try { dispose(); } catch { /* Plugin failure cleanup must not throw. */ } });
          if (activeModules.current.get(plugin.id) === active) activeModules.current.delete(plugin.id);
          URL.revokeObjectURL(url);
        }
      })();
    }
  }, [notify, plugins]);

  useEffect(() => () => {
    for (const active of activeModules.current.values()) {
      active.active = false;
      active.timers.forEach((timer) => { window.clearTimeout(timer); window.clearInterval(timer); });
      active.timers.clear();
      active.workers.forEach((worker) => worker.terminate());
      active.workers.clear();
      for (const handler of [...active.shutdownHandlers, ...active.deactivateHandlers]) {
        try { void handler(); } catch { /* Plugin cleanup must not interrupt app shutdown. */ }
      }
      active.disposables.forEach((dispose) => { try { dispose(); } catch { /* Plugin cleanup must not interrupt app shutdown. */ } });
      try { active.cleanup?.(); } catch { /* Plugin cleanup must not interrupt app shutdown. */ }
      URL.revokeObjectURL(active.url);
    }
    activeModules.current.clear();
  }, []);

  useEffect(() => {
    pluginsChangedListeners.current.forEach((listener) => {
      try { listener(); } catch { /* Plugin listeners must not interrupt plugin state updates. */ }
    });
  }, [plugins]);

  const formatWithPlugins = useCallback(async (path: string, name: string, content: string): Promise<string | null> => {
    const extension = extensionOf(name);
    const languageContribution = languagesRef.current.find((entry) =>
      (entry.extensions ?? []).map((value) => value.toLowerCase()).includes(extension) ||
      (entry.filenames ?? []).some((value) => value.toLowerCase() === name.toLowerCase()),
    );
    const language = languageContribution?.id ?? extension;
    const providers = pluginLanguageProviders.filter((entry) => entry.kind === "formatting" && selectorMatches(entry.selector, language, "file", path));
    for (const entry of providers) {
      const provider = entry.provider as PluginFormattingProvider;
      try {
        const formatted = await provider.provideFormatting({ path, language, text: content });
        if (typeof formatted === "string") return formatted;
      } catch (error) {
        notify(`Plugin formatter failed: ${String(error)}`);
      }
    }
    return null;
  }, [notify]);

  const applyWillSave = useCallback(async (path: string, content: string): Promise<string> => {
    let next = content;
    for (const { handler } of willSaveHandlers.values()) {
      try {
        const result = await handler({ path, content: next });
        if (typeof result === "string") next = result;
      } catch (error) {
        notify(`Plugin will-save handler failed: ${String(error)}`);
      }
    }
    return next;
  }, [notify]);

  const installFromFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, recursive: true, title: "Install plugin folder" });
    if (typeof selected !== "string") return;
    const manifest = parseManifest(JSON.parse(await readTextFile(await join(selected, "plugin.json"))));
    const source = await readTextFile(await join(selected, manifest.main));
    if (!window.confirm(`Install “${manifest.name}”? Plugin JavaScript runs inside Arc and can call its plugin API.`)) return;

    const root = await join(await appDataDir(), "plugins");
    await mkdir(root, { recursive: true });
    const destination = await join(root, manifest.id);
    if (await exists(destination)) {
      if (!window.confirm(`Replace installed plugin “${manifest.name}”?`)) return;
      await remove(destination, { recursive: true });
    }
    await mkdir(destination, { recursive: true });
    await writeTextFile(await join(destination, "plugin.json"), JSON.stringify(manifest, null, 2));
    await writeTextFile(await join(destination, manifest.main), source);
    const disabled = readDisabledIds();
    disabled.delete(manifest.id);
    localStorage.setItem(disabledStorageKey, JSON.stringify([...disabled]));
    setPlugins((current) => [...current.filter((plugin) => plugin.id !== manifest.id), { ...manifest, source, enabled: true, builtin: false }]);
  }, []);

  const installBuiltin = useCallback(async (id: string) => {
    const builtin = builtinPackages.find((plugin) => plugin.manifest.id === id);
    if (!builtin) throw new Error("Unknown built-in plugin.");
    const root = await join(await appDataDir(), "plugins");
    const folder = await join(root, id);
    if (await exists(folder)) return;
    const source = await loadBuiltinSource(builtin.sourcePath);
    await writePluginFiles(folder, builtin.manifest, source);
    const disabled = readDisabledIds();
    disabled.delete(id);
    localStorage.setItem(disabledStorageKey, JSON.stringify([...disabled]));
    setPlugins((current) => [...current, { ...builtin.manifest, source, enabled: true, builtin: true }]);
  }, []);

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    const token = (toggleTokens.current.get(id) ?? 0) + 1;
    toggleTokens.current.set(id, token);
    const plugin = pluginsRef.current.find((entry) => entry.id === id);
    if (!plugin) return;
    let source = plugin.source;
    if (enabled && source === undefined) {
      try {
        source = await readTextFile(await join(pluginDirectoryRef.current, plugin.id, plugin.main));
      } catch (error) {
        notify(`Could not load plugin ${plugin.name}: ${String(error)}`);
        return;
      }
      if (toggleTokens.current.get(id) !== token) return;
    }
    const disabled = readDisabledIds();
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    localStorage.setItem(disabledStorageKey, JSON.stringify([...disabled]));
    setPlugins((current) => current.map((entry) => entry.id === id
      ? { ...entry, enabled, source: enabled ? source : undefined }
      : entry));
  }, [notify]);

  const uninstall = useCallback(async (id: string) => {
    const folder = await join(await appDataDir(), "plugins", id);
    await remove(folder, { recursive: true });
    setPlugins((current) => current.filter((plugin) => plugin.id !== id));
    const disabled = readDisabledIds();
    disabled.delete(id);
    localStorage.setItem(disabledStorageKey, JSON.stringify([...disabled]));
  }, []);

  const getGrammar = useCallback((languageId: string) => grammars.current.get(languageId), []);

  const getConfiguration = useCallback((pluginId: string, key: string, fallback?: unknown): unknown => {
    const value = getConfigurationValue(pluginId, key);
    return value === undefined ? fallback : value;
  }, []);

  const updateConfiguration = useCallback((pluginId: string, key: string, value: unknown, scope?: "global" | "workspace") => {
    localStorage.setItem(configurationStorageKey(pluginId, key, scope), JSON.stringify(value));
    configurationListeners.current.get(pluginId)?.forEach((listener) => listener({ key, value }));
  }, []);

  return {
    plugins,
    actions,
    contextMenuItems,
    commands,
    statusItems,
    panels,
    languages,
    configurations,
    getConfiguration,
    updateConfiguration,
    grammarVersion,
    getGrammar,
    conditionMatches: pluginConditionMatches,
    languageCommands: {
      goToDefinition: pluginGoToDefinition,
      findReferences: pluginFindReferences,
      renameSymbol: pluginRenameSymbol,
      documentSymbols: pluginDocumentSymbols,
      workspaceSymbols: pluginWorkspaceSymbols,
      codeActions: pluginCodeActions,
      signatureHelp: pluginSignatureHelp,
    },
    keybindings,
    icons: iconRegistry,
    editorExtensions: pluginEditorExtensions,
    emitEvent,
    pluginDirectory,
    availableBuiltins,
    installFromFolder,
    installBuiltin,
    setEnabled,
    uninstall,
    formatWithPlugins,
    applyWillSave,
  };
}

function pluginWorkspacePath(root: string, path: string, allowRoot = false): string {
  if (!root) throw new Error("Open a workspace first.");
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!allowRoot && !parts.length) throw new Error("Workspace path is required.");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Plugin file paths must stay inside the workspace.");
  }
  const separator = root.includes("\\") ? "\\" : "/";
  return parts.length ? `${root.replace(/[\\/]$/, "")}${separator}${parts.join(separator)}` : root;
}

function parentDirectoryPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? path : path.slice(0, index);
}

async function writePluginFiles(folder: string, manifest: PluginManifest, source: string) {
  await mkdir(folder, { recursive: true });
  await writeTextFile(await join(folder, "plugin.json"), JSON.stringify(manifest, null, 2));
  await writeTextFile(await join(folder, manifest.main), source);
}

const SUPPORTED_CAPABILITIES = new Set([
  "lifecycle", "timers", "workers", "editor.context", "editor.edits", "editor.decorations",
  "editor.diff", "editor.contentProvider", "editor.customEditor", "editor.willSave",
  "languages", "languages.providers", "languages.server", "diagnostics", "workspaceFolders",
  "workspaceTrust", "files", "files.streams", "files.watch", "files.search", "files.trash",
  "files.providers", "paths", "process", "process.spawn", "pty", "ipc", "net", "net.sockets",
  "net.http", "net.websocket", "net.eventsource", "net.download", "icons", "assets", "ui",
  "ui.quickpick", "ui.input", "ui.progress", "ui.notifications", "ui.output", "ui.menus",
  "ui.views", "configuration", "secrets", "storage.workspace", "commands", "keybindings",
  "plugins", "services", "themes", "window", "git", "tasks", "tests", "debug", "auth",
  "links", "mcp", "mcp.client", "mcp.exposure",
]);

type FileInfoWithTimes = {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime?: string | number | Date | null;
  atime?: string | number | Date | null;
  birthtime?: string | number | Date | null;
};

type PluginFileProvider = {
  read: (path: string) => Promise<Uint8Array>;
  write?: (path: string, bytes: Uint8Array) => Promise<void>;
  list?: (path: string) => Promise<{ name: string; kind: "file" | "directory" }[]>;
};

const fileProviders = new Map<string, PluginFileProvider>();
const icons = new Map<string, string>();
const pluginServices = new Map<string, { pluginId: string; implementation: unknown }>();
const serviceListeners = new Set<() => void>();
const willSaveHandlers = new Map<string, { pluginId: string; handler: (event: { path: string; content: string }) => string | void | Promise<string | void> }>();
const contentProviders = new Map<string, { read: (uri: string) => string | Promise<string>; write?: (uri: string, content: string) => void | Promise<void> }>();
const customEditors = new Map<string, { mount: (container: HTMLElement, context: { path: string; read: () => Promise<string> }) => void | (() => void) }>();
const decorationTypes = new Map<string, { className?: string; style?: string; gutter?: boolean }>();
const pluginLanguageProviders: PluginLanguageProviderEntry[] = [];
const pluginContextValues = new Map<string, Map<string, unknown>>();

function setPluginContextValue(pluginId: string, key: string, value: unknown) {
  const values = pluginContextValues.get(pluginId) ?? new Map<string, unknown>();
  values.set(key, value);
  pluginContextValues.set(pluginId, values);
}

function pluginConditionMatches(pluginId: string, condition?: string): boolean {
  if (!condition) return true;
  const values = pluginContextValues.get(pluginId);
  const evaluate = (expression: string): boolean => {
    const trimmed = expression.trim();
    if (!trimmed) return true;
    if (trimmed.includes("||")) return trimmed.split("||").some(evaluate);
    if (trimmed.includes("&&")) return trimmed.split("&&").every(evaluate);
    const negated = trimmed.startsWith("!");
    const body = negated ? trimmed.slice(1).trim() : trimmed;
    let result: boolean;
    const comparison = /^([\w.\-]+)\s*(==|!=)\s*(.+)$/.exec(body);
    if (comparison) {
      const actual = values?.get(comparison[1]);
      const expected = comparison[3].replace(/^['"]|['"]$/g, "");
      result = comparison[2] === "==" ? String(actual ?? "") === expected : String(actual ?? "") !== expected;
    } else {
      result = Boolean(values?.get(body));
    }
    return negated ? !result : result;
  };
  try { return evaluate(condition); } catch { return false; }
}
let decorationCounter = 0;
let willSaveCounter = 0;
let taskCounter = 0;
let debugCounter = 0;
let linkCounter = 0;
let activeDebugSession: { id: string; configuration: unknown; pluginId: string; stop?: () => Promise<void> } | null = null;
const taskProviders = new Map<string, { pluginId: string; provider: { provideTasks: () => unknown[] | Promise<unknown[]>; resolveTask?: (task: unknown) => unknown } }>();
const debugAdapters = new Map<string, unknown>();
const authProviders = new Map<string, { getSessions?: (scopes: string[]) => unknown; createSession?: (scopes: string[]) => unknown; removeSession?: (sessionId: string) => unknown }>();
const linkHandlers = new Map<string, { pluginId: string; handler: (uri: string) => void }>();

const setPluginDecorations = codeMirrorState.StateEffect.define<{ path: string; type: string; ranges: PluginRange[] }>();

const pluginDecorationField = codeMirrorState.StateField.define<Map<string, DecorationSet>>({
  create: () => new Map(),
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (!effect.is(setPluginDecorations)) continue;
      const { path, type, ranges } = effect.value;
      next = new Map(next);
      const existing = next.get(`${path}:${type}`);
      const options = decorationTypes.get(type);
      if (!options) continue;
      const marks = ranges.map((range) => Decoration.mark({
        class: options.className ?? "arc-plugin-decoration",
        attributes: options.style ? { style: options.style } : undefined,
      }).range(range.from, range.to));
      if (existing) next.set(`${path}:${type}`, existing.update({ filter: () => false, add: marks, sort: true }));
      else next.set(`${path}:${type}`, Decoration.set(marks, true));
    }
    return next;
  },
  provide: (field) => CodeMirrorView.decorations.from(field, (value) => {
    if (!value.size) return Decoration.none;
    const all: ReturnType<Decoration["range"]>[] = [];
    value.forEach((set) => {
      const cursor = set.iter();
      let node = cursor.value;
      while (node) {
        all.push(node.range(cursor.from, cursor.to));
        cursor.next();
        node = cursor.value;
      }
    });
    return Decoration.set(all, true);
  }),
});

const pluginDecorationExtensions = pluginDecorationField.extension;

type PluginLanguageContext = {
  path: string;
  language: string;
  text: string;
  offset: number;
  line: string;
  lineFrom: number;
  lineTo: number;
  word: string;
};

type PluginLanguageBase = { path: string; language: string };

let activeLanguageBase: () => PluginLanguageBase | null = () => null;
let activeLanguageContext: () => PluginLanguageContext | null = () => null;

function pluginProviders(kind: PluginLanguageProviderKind, context: PluginLanguageBase): unknown[] {
  return pluginLanguageProviders
    .filter((entry) => entry.kind === kind && selectorMatches(entry.selector, context.language, "file", context.path))
    .map((entry) => entry.provider);
}


let pluginHostActions: PluginHostActions | null = null;
let pluginNotifier: ((message: string) => void) | null = null;
function pluginNotify(message: string) { pluginNotifier?.(message); }
let pluginCommandRunner: ((id: string) => Promise<void>) | null = null;

type PluginLocationLike = {
  path?: string;
  uri?: string;
  from?: number;
  to?: number;
  line?: number;
  column?: number;
  name?: string;
  label?: string;
  range?: { from?: number; to?: number; start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
  selectionRange?: { from?: number; to?: number; start?: { line?: number; character?: number } };
};

function pluginPathFromLocation(location: PluginLocationLike): string | null {
  if (typeof location.path === "string" && location.path) return location.path;
  if (typeof location.uri === "string" && location.uri) return uriToPath(location.uri);
  return null;
}

function normalizeLocation(value: PluginLocationLike): PluginLocationLike | null {
  if (!value || typeof value !== "object") return null;
  const path = pluginPathFromLocation(value);
  if (!path) return null;
  const range = value.range;
  const from = value.from ?? range?.from;
  const to = value.to ?? range?.to;
  const line = value.line ?? range?.start?.line;
  const column = value.column ?? range?.start?.character;
  return { ...value, path, from, to, line: line === undefined ? undefined : line + 1, column: column === undefined ? undefined : column + 1 };
}

function normalizeLocationList(value: unknown): PluginLocationLike[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((entry) => normalizeLocation(entry as PluginLocationLike)).filter((entry): entry is PluginLocationLike => Boolean(entry));
}

async function waitForPluginEditor(path: string, attempts = 30): Promise<EditorView | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const editor = pluginHostActions?.getEditor(path);
    if (editor) return editor;
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  return null;
}

async function openPluginLocation(location: PluginLocationLike): Promise<boolean> {
  if (!pluginHostActions) return false;
  const path = pluginPathFromLocation(location);
  if (!path) return false;
  await pluginHostActions.openFile(path);
  const editor = await waitForPluginEditor(path);
  if (!editor) return false;
  let offset = location.from;
  if (offset === undefined && location.line !== undefined) {
    const line = editor.state.doc.line(Math.max(1, Math.min(location.line, editor.state.doc.lines)));
    offset = Math.min(line.to, line.from + Math.max(0, (location.column ?? 1) - 1));
  }
  if (offset !== undefined) {
    const anchor = Math.max(0, Math.min(offset, editor.state.doc.length));
    const head = location.to === undefined ? anchor : Math.max(anchor, Math.min(location.to, editor.state.doc.length));
    editor.dispatch({ selection: { anchor, head }, effects: CodeMirrorView.scrollIntoView(anchor, { y: "center" }) });
    editor.focus();
  }
  return true;
}

function pluginProviderContext(): PluginLanguageContext | null {
  return activeLanguageContext();
}

function locationLabel(location: PluginLocationLike): string {
  const name = location.name ?? location.label ?? pluginPathFromLocation(location) ?? "Location";
  if (location.line !== undefined) return `${name} — line ${location.line}${location.column ? `:${location.column}` : ""}`;
  if (location.from !== undefined) return `${name} — offset ${location.from}`;
  return name;
}

async function pluginLanguageLocations(kind: "definition" | "reference"): Promise<PluginLocationLike[]> {
  const context = pluginProviderContext();
  if (!context) return [];
  const locations: PluginLocationLike[] = [];
  for (const provider of pluginProviders(kind, context) as PluginLocationProvider[]) {
    try {
      const result = await provider.provideLocations({ path: context.path, language: context.language, text: context.text, offset: context.offset, word: context.word });
      locations.push(...normalizeLocationList(result));
    } catch (error) {
      pluginNotify(`Plugin ${kind} provider failed: ${String(error)}`);
    }
  }
  return locations;
}

export async function pluginGoToDefinition(): Promise<void> {
  const locations = await pluginLanguageLocations("definition");
  if (!locations.length) return;
  await openPluginLocation(locations[0]);
}

export async function pluginFindReferences(): Promise<void> {
  const locations = await pluginLanguageLocations("reference");
  if (!locations.length) return;
  const picked = await showQuickPickModal(
    locations.map((location) => ({ label: locationLabel(location), value: location })),
    { placeHolder: `${locations.length} reference${locations.length === 1 ? "" : "s"}` },
  );
  if (picked) await openPluginLocation(picked as PluginLocationLike);
}

function normalizeWorkspaceEdit(value: unknown): { path: string; edits: { from: number; to?: number; text: string }[] }[] {
  if (!value || typeof value !== "object") return [];
  const edit = value as { changes?: Record<string, unknown[]>; documentChanges?: { uri?: string; path?: string; textDocument?: { uri?: string }; edits?: unknown[] }[] };
  const entries: { path: string; edits: { from: number; to?: number; text: string }[] }[] = [];
  const parseEdits = (items: unknown[]) => items.map((item) => {
    const entry = item as { range?: { from?: number; to?: number }; from?: number; to?: number; text?: string; newText?: string; insert?: string };
    return { from: entry.range?.from ?? entry.from ?? 0, to: entry.range?.to ?? entry.to, text: entry.text ?? entry.newText ?? entry.insert ?? "" };
  }).filter((entry) => Number.isFinite(entry.from));
  if (edit.changes) for (const [path, edits] of Object.entries(edit.changes)) entries.push({ path, edits: parseEdits(edits) });
  if (edit.documentChanges) for (const change of edit.documentChanges) {
    const path = change.path ?? change.textDocument?.uri ?? change.uri;
    if (path) entries.push({ path: uriToPath(path), edits: parseEdits(change.edits ?? []) });
  }
  return entries;
}

async function applyPluginWorkspaceEdit(value: unknown): Promise<boolean> {
  const entries = normalizeWorkspaceEdit(value);
  if (!entries.length || !pluginHostActions) return false;
  for (const entry of entries) {
    let editor = pluginHostActions.getEditor(entry.path);
    if (!editor) {
      await pluginHostActions.openFile(entry.path);
      editor = await waitForPluginEditor(entry.path);
    }
    if (!editor) continue;
    const changes = [...entry.edits].sort((left, right) => right.from - left.from).map((edit) => ({ from: edit.from, to: edit.to ?? edit.from, insert: edit.text }));
    editor.dispatch({ changes });
  }
  return true;
}

export async function pluginRenameSymbol(): Promise<void> {
  const context = pluginProviderContext();
  if (!context) return;
  const providers = pluginProviders("rename", context) as PluginLocationProvider[];
  if (!providers.length) return;
  const nextName = await showInputBoxModal({ prompt: "New name", value: context.word, placeHolder: "Enter the new symbol name" });
  if (!nextName || nextName === context.word) return;
  for (const provider of providers) {
    try {
      const result = provider.provideRename
        ? await provider.provideRename({ path: context.path, language: context.language, text: context.text, offset: context.offset, word: context.word, newName: nextName })
        : await provider.provideLocations({ path: context.path, language: context.language, text: context.text, offset: context.offset, word: context.word, newName: nextName });
      if (await applyPluginWorkspaceEdit(result)) return;
      const locations = normalizeLocationList(result);
      if (locations.length && pluginHostActions) {
        for (const location of locations) {
          const path = pluginPathFromLocation(location);
          if (!path) continue;
          let editor = pluginHostActions.getEditor(path);
          if (!editor) {
            await pluginHostActions.openFile(path);
            editor = await waitForPluginEditor(path);
          }
          if (!editor) continue;
          let from = location.from;
          let to = location.to;
          if (from === undefined && location.line !== undefined) {
            const line = editor.state.doc.line(Math.max(1, Math.min(location.line, editor.state.doc.lines)));
            from = Math.min(line.to, line.from + Math.max(0, (location.column ?? 1) - 1));
            to = from + context.word.length;
          }
          if (from === undefined) continue;
          editor.dispatch({ changes: { from, to: to ?? from, insert: nextName } });
        }
        return;
      }
    } catch (error) {
      pluginNotify(`Plugin rename provider failed: ${String(error)}`);
    }
  }
}

export async function pluginDocumentSymbols(): Promise<void> {
  const context = pluginProviderContext();
  if (!context) return;
  const symbols: PluginLocationLike[] = [];
  for (const provider of pluginProviders("documentSymbol", context) as PluginRangeProvider[]) {
    try {
      const result = await provider.provideRanges({ path: context.path, language: context.language, text: context.text, offset: context.offset });
      const values = Array.isArray(result) ? result : result == null ? [] : [result];
      for (const value of values) {
        const entry = value as PluginLocationLike & { children?: unknown[] };
        const location = normalizeLocation({ ...entry, path: context.path });
        if (location) symbols.push(location);
        if (Array.isArray(entry.children)) for (const child of entry.children) {
          const childLocation = normalizeLocation({ ...(child as PluginLocationLike), path: context.path });
          if (childLocation) symbols.push(childLocation);
        }
      }
    } catch (error) {
      pluginNotify(`Plugin symbol provider failed: ${String(error)}`);
    }
  }
  if (!symbols.length) return;
  const picked = await showQuickPickModal(symbols.map((symbol) => ({ label: locationLabel(symbol), value: symbol })), { placeHolder: "Go to symbol" });
  if (picked) await openPluginLocation(picked as PluginLocationLike);
}

export async function pluginWorkspaceSymbols(): Promise<void> {
  const context = pluginProviderContext();
  if (!context) return;
  const locations: PluginLocationLike[] = [];
  for (const provider of pluginProviders("workspaceSymbol", context) as PluginLocationProvider[]) {
    try {
      const result = await provider.provideLocations({ path: context.path, language: context.language, text: context.text, offset: context.offset, word: context.word });
      locations.push(...normalizeLocationList(result));
    } catch (error) {
      pluginNotify(`Plugin workspace symbol provider failed: ${String(error)}`);
    }
  }
  if (!locations.length) return;
  const picked = await showQuickPickModal(locations.map((location) => ({ label: locationLabel(location), value: location })), { placeHolder: "Go to workspace symbol" });
  if (picked) await openPluginLocation(picked as PluginLocationLike);
}

export async function pluginCodeActions(): Promise<void> {
  const context = pluginProviderContext();
  if (!context) return;
  const actions: { label: string; action: unknown }[] = [];
  for (const provider of pluginProviders("codeAction", context) as PluginRangeProvider[]) {
    try {
      const result = await provider.provideRanges({ path: context.path, language: context.language, text: context.text, offset: context.offset });
      for (const value of Array.isArray(result) ? result : result == null ? [] : [result]) {
        const action = value as { title?: string; label?: string };
        actions.push({ label: action.title ?? action.label ?? String(value), action: value });
      }
    } catch (error) {
      pluginNotify(`Plugin code action provider failed: ${String(error)}`);
    }
  }
  if (!actions.length) return;
  const picked = await showQuickPickModal(actions.map((action) => ({ label: action.label, value: action.action })), { placeHolder: "Code actions" });
  if (!picked) return;
  const action = picked as { edit?: unknown; command?: { id?: string; arguments?: unknown[] }; run?: () => unknown };
  if (action.edit !== undefined) await applyPluginWorkspaceEdit(action.edit);
  else if (action.command?.id && pluginCommandRunner) await pluginCommandRunner(action.command.id);
  else if (typeof action.run === "function") await action.run();
}

export async function pluginSignatureHelp(): Promise<void> {
  const context = pluginProviderContext();
  if (!context) return;
  const labels: string[] = [];
  for (const provider of pluginProviders("signatureHelp", context) as PluginRangeProvider[]) {
    try {
      const result = await provider.provideRanges({ path: context.path, language: context.language, text: context.text, offset: context.offset });
      for (const value of Array.isArray(result) ? result : result == null ? [] : [result]) {
        const item = value as { label?: string; signature?: string; documentation?: string };
        labels.push(item.label ?? item.signature ?? item.documentation ?? String(value));
      }
    } catch (error) {
      pluginNotify(`Plugin signature provider failed: ${String(error)}`);
    }
  }
  if (labels.length) await showQuickPickModal(labels.map((label) => ({ label })), { placeHolder: "Signatures" });
}

export function pluginExpandSelection(view: EditorView): boolean {
  const context = pluginProviderContext();
  if (!context) return false;
  const providers = pluginProviders("selectionRange", context) as PluginRangeProvider[];
  if (!providers.length) return false;
  const selection = view.state.selection.main;
  let result: unknown;
  try {
    result = providers[0].provideRanges({ path: context.path, language: context.language, text: context.text, offset: selection.head });
  } catch {
    return false;
  }
  const apply = (value: unknown) => {
    const ranges = (Array.isArray(value) ? value : value == null ? [] : [value])
      .map((entry) => entry as { from?: number; to?: number; range?: { from?: number; to?: number } })
      .map((entry) => ({ from: entry.from ?? entry.range?.from ?? 0, to: entry.to ?? entry.range?.to ?? 0 }))
      .filter((range) => range.from <= selection.from && range.to >= selection.to && (range.from < selection.from || range.to > selection.to))
      .sort((left, right) => (left.to - left.from) - (right.to - right.from));
    if (!ranges.length) return false;
    view.dispatch({ selection: { anchor: ranges[0].from, head: ranges[0].to } });
    return true;
  };
  if (result && typeof (result as Promise<unknown>).then === "function") {
    void (result as Promise<unknown>).then((value) => apply(value), () => undefined);
    return true;
  }
  return apply(result);
}

class PluginInlineWidget extends WidgetType {
  constructor(private readonly text: string, private readonly className: string, private readonly onClick?: () => void) { super(); }
  eq(other: PluginInlineWidget) { return other.text === this.text && other.className === this.className; }
  toDOM() {
    const element = document.createElement(this.onClick ? "button" : "span");
    element.className = this.className;
    element.textContent = this.text;
    if (this.onClick) {
      (element as HTMLButtonElement).type = "button";
      element.addEventListener("click", (event) => { event.preventDefault(); this.onClick?.(); });
    }
    return element;
  }
  ignoreEvent() { return false; }
}

function pluginLensWidgets(value: unknown, type: "codeLens" | "inlayHints", docLength: number): DecorationSet {
  const wrapper = value as { tokens?: unknown[]; data?: unknown[]; items?: unknown[] } | null;
  const values = Array.isArray(value) ? value : Array.isArray(wrapper?.tokens) ? wrapper.tokens : Array.isArray(wrapper?.data) ? wrapper.data : Array.isArray(wrapper?.items) ? wrapper.items : value == null ? [] : [value];
  const decorations: Range<Decoration>[] = [];
  for (const entry of values) {
    const item = entry as { from?: number; position?: number | { line?: number; character?: number }; offset?: number; to?: number; range?: { from?: number }; label?: string; title?: string; text?: string; command?: { id?: string; title?: string; run?: () => unknown } };
    const from = item.from ?? item.range?.from ?? item.offset ?? (typeof item.position === "number" ? item.position : undefined);
    if (from === undefined) continue;
    const label = item.label ?? item.title ?? item.text ?? item.command?.title;
    if (!label) continue;
    const onClick = type === "codeLens" ? () => { if (item.command?.run) void item.command.run(); else if (item.command?.id) void pluginCommandRunner?.(item.command.id); } : undefined;
    decorations.push(Decoration.widget({ widget: new PluginInlineWidget(String(label), type === "codeLens" ? "arc-plugin-code-lens" : "arc-plugin-inlay-hint", onClick), side: type === "codeLens" ? -1 : 1 }).range(Math.max(0, Math.min(from, docLength))));
  }
  return Decoration.set(decorations, true);
}

function pluginSemanticDecorations(value: unknown, docLength: number): DecorationSet {
  const wrapper = value as { tokens?: unknown[]; data?: unknown[]; items?: unknown[] } | null;
  const values = Array.isArray(value) ? value : Array.isArray(wrapper?.tokens) ? wrapper.tokens : Array.isArray(wrapper?.data) ? wrapper.data : Array.isArray(wrapper?.items) ? wrapper.items : value == null ? [] : [value];
  const decorations: Range<Decoration>[] = [];
  for (const entry of values) {
    const item = entry as { from?: number; to?: number; length?: number; type?: string; tag?: string };
    const from = Math.max(0, item.from ?? 0);
    const to = Math.min(docLength, item.to ?? (from + (item.length ?? 0)));
    if (to <= from) continue;
    const kind = (item.type ?? item.tag ?? "token").replace(/[^a-zA-Z0-9_-]+/g, "-");
    decorations.push(Decoration.mark({ class: `arc-semantic-token arc-semantic-${kind}` }).range(from, to));
  }
  return Decoration.set(decorations, true);
}

function pluginViewPlugin(kind: "codeLens" | "inlayHints" | "semanticTokens") {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    private generation = 0;
    constructor(view: EditorView) { this.refresh(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) this.refresh(update.view);
    }
    destroy() { this.generation += 1; }
    private refresh(view: EditorView) {
      if (!pluginLanguageProviders.length) { this.decorations = Decoration.none; return; }
      const base = activeLanguageBase();
      if (!base) { this.decorations = Decoration.none; return; }
      const providers = pluginProviders(kind, base) as PluginRangeProvider[];
      if (!providers.length) { this.decorations = Decoration.none; return; }
      const context = activeLanguageContext();
      if (!context) { this.decorations = Decoration.none; return; }
      const generation = ++this.generation;
      const offset = view.state.selection.main.head;
      void Promise.all(providers.map(async (provider) => {
        try { return await provider.provideRanges({ path: context.path, language: context.language, text: context.text, offset }); }
        catch (error) { pluginNotify(`Plugin ${kind} provider failed: ${String(error)}`); return null; }
      })).then((values) => {
        if (generation !== this.generation) return;
        const merged = values.flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value]);
        this.decorations = kind === "semanticTokens" ? pluginSemanticDecorations(merged, view.state.doc.length) : pluginLensWidgets(merged, kind, view.state.doc.length);
        view.dispatch({});
      });
    }
  }, { decorations: (plugin) => plugin.decorations });
}

const pluginCompletionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
  if (!pluginLanguageProviders.length) return null;
  const base = activeLanguageBase();
  if (!base) return null;
  const providers = pluginProviders("completion", base) as PluginCompletionProvider[];
  if (!providers.length) return null;
  const languageContext = activeLanguageContext();
  if (!languageContext) return null;
  const word = context.matchBefore(/[\w$-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const options: Completion[] = [];
  for (const provider of providers) {
    try {
      const items = await provider.provideCompletionItems({
        path: languageContext.path,
        language: languageContext.language,
        text: languageContext.text,
        offset: context.pos,
        line: languageContext.line,
        from: word.from,
        to: word.to,
      });
      options.push(...items);
    } catch { /* A failing provider must not break other completions. */ }
  }
  return { from: word.from, options };
};

function renderPluginHover(dom: HTMLElement, value: unknown): boolean {
  if (typeof value === "string") {
    if (!value.trim()) return false;
    dom.textContent = value;
    return true;
  }
  if (!value || typeof value !== "object") return false;
  const entry = value as { text?: unknown; contents?: unknown; html?: unknown };
  const parts = Array.isArray(entry.contents) ? entry.contents : entry.contents === undefined ? [] : [entry.contents];
  const text = [entry.text, entry.html, ...parts.map((part) => typeof part === "string" ? part : (part as { value?: unknown })?.value)]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n");
  if (!text) return false;
  dom.textContent = text;
  return true;
}

const pluginHoverExtension = hoverTooltip((view, position) => {
  if (!pluginLanguageProviders.length) return null;
  const base = activeLanguageBase();
  if (!base) return null;
  const providers = pluginProviders("hover", base) as PluginHoverProvider[];
  if (!providers.length) return null;
  const languageContext = activeLanguageContext();
  if (!languageContext) return null;
  const end = view.state.doc.lineAt(position).to;
  const makeTooltip = (value: unknown) => {
    const dom = document.createElement("div");
    dom.className = "arc-plugin-hover";
    if (!renderPluginHover(dom, value)) return null;
    return { pos: position, end, create: () => ({ dom }) };
  };
  for (const provider of providers) {
    try {
      const value = provider.provideHover({
        path: languageContext.path,
        language: languageContext.language,
        text: languageContext.text,
        offset: position,
        line: languageContext.line,
      });
      if (value && typeof (value as Promise<unknown>).then === "function") {
        const dom = document.createElement("div");
        dom.className = "arc-plugin-hover";
        dom.textContent = "Loading…";
        void (value as Promise<unknown>).then((resolved) => { renderPluginHover(dom, resolved); }, () => undefined);
        return { pos: position, end, create: () => ({ dom }) };
      }
      const tooltip = makeTooltip(value);
      if (tooltip) return tooltip;
    } catch { /* Ignore failing hover providers. */ }
  }
  return null;
});

const pluginFoldingExtension = foldService.of((state, lineStart, lineEnd) => {
  if (!pluginLanguageProviders.length) return null;
  const base = activeLanguageBase();
  if (!base) return null;
  const providers = pluginProviders("folding", base) as PluginFoldingProvider[];
  if (!providers.length) return null;
  const languageContext = activeLanguageContext();
  if (!languageContext) return null;
  const line = state.doc.lineAt(lineStart);
  for (const provider of providers) {
    try {
      const range = provider.provideFoldingRange({
        path: languageContext.path,
        language: languageContext.language,
        text: languageContext.text,
        line: line.number,
      });
      if (range && range.to > range.from) return range;
    } catch { /* Ignore failing folding providers. */ }
  }
  void lineEnd;
  return null;
});

const pluginLanguageKeymap = keymap.of([
  { key: "F12", run: () => { void pluginGoToDefinition(); return true; } },
  { key: "Shift-F12", run: () => { void pluginFindReferences(); return true; } },
  { key: "F2", run: () => { void pluginRenameSymbol(); return true; } },
  { key: "Mod-.", run: () => { void pluginCodeActions(); return true; } },
  { key: "Shift-Alt-ArrowRight", run: (view) => pluginExpandSelection(view) },
  { key: "Ctrl-Shift-Space", run: () => { void pluginSignatureHelp(); return true; } },
]);

const pluginLanguageExtensions: Extension[] = [
  EditorState.languageData.of(() => [{ autocomplete: pluginCompletionSource }]),
  pluginHoverExtension,
  pluginFoldingExtension,
  pluginLanguageKeymap,
  pluginViewPlugin("codeLens"),
  pluginViewPlugin("inlayHints"),
  pluginViewPlugin("semanticTokens"),
];

const pluginEditorExtensions: Extension = [
  pluginDecorationExtensions,
  pluginLanguageExtensions,
];

function sanitizeSvg(svg: string): string {
  if (svg.length > 100_000) throw new Error("Plugin icon exceeds 100 KB.");
  const documentValue = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (documentValue.querySelector("parsererror")) throw new Error("Plugin icon is not valid SVG.");
  documentValue.querySelectorAll("script, foreignObject").forEach((node) => node.remove());
  documentValue.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || /javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    }
  });
  const root = documentValue.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") throw new Error("Plugin icon must have an <svg> root.");
  return new XMLSerializer().serializeToString(root);
}

function toDisposer(resource: unknown): (() => void) | null {
  if (typeof resource === "function") return resource as () => void;
  if (!resource || typeof resource !== "object") return null;
  const candidate = resource as { dispose?: () => void; unsubscribe?: () => void; close?: () => void; stop?: () => void };
  const method = candidate.dispose ?? candidate.unsubscribe ?? candidate.close ?? candidate.stop;
  return method ? () => method.call(resource) : null;
}

function readJsonStorage<T>(key: string, fallback?: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback as T : JSON.parse(value) as T;
  } catch {
    return fallback as T;
  }
}

let activeWorkspace = "";

function configurationStorageKey(pluginId: string, key: string, scope?: "global" | "workspace"): string {
  return `arc.plugin.${pluginId}.config.${scope === "workspace" ? `workspace.${encodeURIComponent(activeWorkspace)}.` : ""}${key}`;
}

function getConfigurationValue(pluginId: string, key: string): unknown {
  const workspaceValue = readJsonStorage<unknown>(configurationStorageKey(pluginId, key, "workspace"), undefined);
  if (workspaceValue !== undefined) return workspaceValue;
  const stored = readJsonStorage<unknown>(configurationStorageKey(pluginId, key), undefined);
  if (stored !== undefined) return stored;
  for (const [id, configuration] of configurationEntries(pluginId)) {
    void id;
    const property = configuration.properties[key];
    if (property && "default" in property) return property.default;
  }
  return undefined;
}

function configurationEntries(pluginId: string): [string, { properties: Record<string, { default?: unknown }> }][] {
  return [...configurationStore.entries()].filter(([id]) => id.startsWith(`${pluginId}:`));
}

const configurationStore = new Map<string, { schema: Record<string, unknown>; properties: Record<string, { default?: unknown }> }>();

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "output";
}

function pluginAssetPath(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Plugin asset paths must stay inside the plugin folder.");
  }
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]$/, "")}${separator}${parts.join(separator)}`;
}

function mimeForPath(path: string): string {
  const extension = extensionOf(path);
  if (["html", "htm"].includes(extension)) return "text/html";
  if (extension === "css") return "text/css";
  if (["js", "mjs"].includes(extension)) return "text/javascript";
  if (extension === "json") return "application/json";
  if (extension === "svg") return "image/svg+xml";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) return `image/${extension === "jpg" ? "jpeg" : extension}`;
  return "application/octet-stream";
}

function parseSnippet(snippet: string): { text: string; cursor: number } {
  let cursor = -1;
  let stripped = snippet.replace(/\$\{(\d+)(?::([^}]*))?\}|\$(\d+)/g, (_match, first, placeholder, second) => {
    const index = Number(first ?? second);
    const text = placeholder ?? "";
    if (cursor < 0 && index !== 0) cursor = -1;
    return text;
  });
  const firstMatch = /\$\{(\d+)(?::([^}]*))?\}|\$(\d+)/.exec(snippet);
  cursor = 0;
  if (firstMatch) {
    const offset = firstMatch.index;
    const before = snippet.slice(0, offset).replace(/\$\{(\d+)(?::([^}]*))?\}|\$(\d+)/g, (_m, _a, b) => b ?? "").length;
    const index = Number(firstMatch[1] ?? firstMatch[3]);
    cursor = index === 0 ? stripped.length : before + (firstMatch[2] ?? "").length;
  }
  stripped = stripped.replace(/\$\{(\d+)(?::([^}]*))?\}|\$(\d+)/g, (_m, _a, b) => b ?? "");
  return { text: stripped, cursor: Math.max(0, Math.min(cursor, stripped.length)) };
}

function normalizePosix(path: string): string {
  const absolute = path.startsWith("/");
  const stack: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return `${absolute ? "/" : ""}${stack.join("/")}` || (absolute ? "/" : ".");
}

const isWindowsHost = /win/i.test(navigator.platform);
const hostSeparator = isWindowsHost ? "\\" : "/";

function joinNativePath(...parts: string[]): string {
  return parts.filter(Boolean).join(hostSeparator).replace(/[\\/]+/g, hostSeparator);
}

function resolveNativePath(...parts: string[]): string {
  const combined = parts.filter(Boolean).join(hostSeparator);
  if (isWindowsHost) {
    const match = /^([a-zA-Z]:)[\\/]?/.exec(combined);
    const drive = match?.[1] ?? "";
    const rest = drive ? combined.slice(match![0].length) : combined;
    const normalized = normalizePosix(rest);
    return drive ? `${drive}\\${normalized.replace(/\//g, "\\")}` : normalized.replace(/\//g, "\\");
  }
  return normalizePosix(combined);
}

function relativeNativePath(from: string, to: string): string {
  const normalizedFrom = from.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  const normalizedTo = to.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  let index = 0;
  while (index < normalizedFrom.length && index < normalizedTo.length && normalizedFrom[index] === normalizedTo[index]) index += 1;
  const up = new Array(normalizedFrom.length - index).fill("..");
  const down = normalizedTo.slice(index);
  return [...up, ...down].join("/") || ".";
}

function pathToUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${prefixed.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return decodeURIComponent(uri);
  const raw = decodeURIComponent(uri.slice("file://".length));
  return isWindowsHost ? raw.replace(/^\//, "").replace(/\//g, "\\") : raw;
}

function matchGlob(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  try {
    return new RegExp(`^${escaped}$`).test(path.replace(/\\/g, "/"));
  } catch {
    return path.includes(pattern);
  }
}

async function listWorkspaceFiles(
  root: string,
  path = "",
  options?: { exclude?: string[]; maxDepth?: number; maxResults?: number },
): Promise<{ path: string; name: string; kind: "file" | "directory" }[]> {
  if (!root) throw new Error("Open a workspace first.");
  const maxDepth = options?.maxDepth ?? 32;
  const maxResults = options?.maxResults ?? 10_000;
  const exclude = options?.exclude ?? ["node_modules", ".git", "dist", "build", "target", ".next", ".cache"];
  const results: { path: string; name: string; kind: "file" | "directory" }[] = [];
  const queue: { directory: string; prefix: string; depth: number }[] = [{ directory: joinNativePath(root, path), prefix: path, depth: 0 }];
  while (queue.length && results.length < maxResults) {
    const current = queue.shift()!;
    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await readDir(current.directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (exclude.some((name) => entry.name === name || matchGlob(entry.name, name))) continue;
      const relative = current.prefix ? `${current.prefix}/${entry.name}` : entry.name;
      results.push({ path: relative, name: entry.name, kind: entry.isDirectory ? "directory" : "file" });
      if (entry.isDirectory && current.depth + 1 < maxDepth) queue.push({ directory: joinNativePath(current.directory, entry.name), prefix: relative, depth: current.depth + 1 });
    }
  }
  return results;
}

async function searchWorkspaceText(
  root: string,
  query: string | RegExp,
  options?: { exclude?: string[]; maxResults?: number; include?: string },
): Promise<{ path: string; line: number; column: number; preview: string }[]> {
  const results: { path: string; line: number; column: number; preview: string }[] = [];
  const maxResults = options?.maxResults ?? 500;
  const files = await listWorkspaceFiles(root, "", { exclude: options?.exclude, maxResults: 5000 });
  const regex = typeof query === "string" ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : query;
  for (const file of files) {
    if (results.length >= maxResults) break;
    if (file.kind !== "file") continue;
    if (options?.include && !matchGlob(file.path, options.include)) continue;
    let text: string;
    try {
      text = await readTextFile(joinNativePath(root, file.path));
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
      const line = lines[index];
      const match = line.match(regex);
      if (!match) continue;
      results.push({ path: file.path, line: index + 1, column: (match.index ?? 0) + 1, preview: line.slice(0, 300) });
    }
  }
  return results;
}

function selectorMatches(selector: PluginLanguageSelector, language: string, scheme: string, path: string): boolean {
  const selectors = Array.isArray(selector) ? selector : [selector];
  return selectors.some((entry) => {
    if (entry === "*") return true;
    if (typeof entry === "string") return entry === language || entry === extensionOf(path);
    if (entry.language && entry.language !== language) return false;
    if (entry.scheme && entry.scheme !== scheme) return false;
    if (entry.pattern && !matchGlob(path, entry.pattern)) return false;
    return Boolean(entry.language || entry.scheme || entry.pattern);
  });
}

function subscribeRawEvent(event: string, handler: (payload: unknown) => void, active: ActivePlugin): () => void {
  const callbacks = pluginEventListeners.get(event) ?? new Set<(payload: unknown) => void>();
  callbacks.add(handler);
  pluginEventListeners.set(event, callbacks);
  const dispose = () => {
    callbacks.delete(handler);
    if (!callbacks.size) pluginEventListeners.delete(event);
  };
  active.disposables.push(dispose);
  return dispose;
}

const pluginEventListeners = new Map<string, Set<(payload: unknown) => void>>();

function subscribeContextEvent(event: string, handler: (context: PluginEditorContext | null) => void, active: ActivePlugin): () => void {
  return subscribeRawEvent(event, handler as (payload: unknown) => void, active);
}

let lastPluginActivity = Date.now();
let pluginActivityTracking = false;
function pluginIdleTime(): number {
  if (!pluginActivityTracking && typeof window !== "undefined") {
    pluginActivityTracking = true;
    const mark = () => { lastPluginActivity = Date.now(); };
    for (const eventName of ["pointerdown", "keydown", "mousemove", "wheel", "touchstart", "focus"]) window.addEventListener(eventName, mark, { passive: true });
  }
  return Math.max(0, Date.now() - lastPluginActivity);
}

function currentVisibility() {
  return { visible: document.visibilityState === "visible", minimized: document.visibilityState === "hidden", hidden: document.visibilityState === "hidden" };
}

function subscribeVisibility(handler: (visibility: { visible: boolean; minimized: boolean; hidden: boolean }) => void): () => void {
  const listener = () => handler(currentVisibility());
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

function subscribeWindowFocus(handler: (focused: boolean) => void): () => void {
  const focus = () => handler(true);
  const blur = () => handler(false);
  window.addEventListener("focus", focus);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("focus", focus);
    window.removeEventListener("blur", blur);
  };
}

function showQuickPickModal(
  items: { label: string; description?: string; detail?: string; value?: unknown }[],
  options?: { placeHolder?: string; canPickMany?: boolean },
): Promise<unknown | unknown[] | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "arc-plugin-overlay";
    const panel = document.createElement("div");
    panel.className = "arc-plugin-modal";
    const input = document.createElement("input");
    input.placeholder = options?.placeHolder ?? "Select an item";
    const list = document.createElement("div");
    list.className = "arc-plugin-pick-list";
    const close = (value: unknown | unknown[] | null) => { overlay.remove(); resolve(value); };
    const selected = new Set<unknown>();
    const render = (filter: string) => {
      list.replaceChildren();
      for (const item of items.filter((entry) => entry.label.toLowerCase().includes(filter.toLowerCase()))) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "arc-plugin-pick-item";
        button.innerHTML = `<strong></strong><span></span>`;
        button.querySelector("strong")!.textContent = item.label;
        button.querySelector("span")!.textContent = item.description ?? item.detail ?? "";
        button.addEventListener("click", () => {
          const value = item.value ?? item.label;
          if (options?.canPickMany) {
            if (selected.has(value)) selected.delete(value); else selected.add(value);
            button.classList.toggle("selected", selected.has(value));
          } else {
            close(value);
          }
        });
        list.append(button);
      }
    };
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close(null);
      if (event.key === "Enter" && options?.canPickMany) close([...selected]);
    });
    panel.append(input, list);
    overlay.append(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(null); });
    document.body.append(overlay);
    render("");
    input.focus();
  });
}

function showInputBoxModal(options?: { prompt?: string; value?: string; password?: boolean; placeHolder?: string; validate?: (value: string) => string | null | undefined }): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "arc-plugin-overlay";
    const panel = document.createElement("div");
    panel.className = "arc-plugin-modal";
    const label = document.createElement("label");
    label.textContent = options?.prompt ?? "Enter a value";
    const input = document.createElement("input");
    input.type = options?.password ? "password" : "text";
    input.value = options?.value ?? "";
    input.placeholder = options?.placeHolder ?? "";
    const error = document.createElement("div");
    error.className = "arc-plugin-error";
    const close = (value: string | null) => { overlay.remove(); resolve(value); };
    const submit = () => {
      const message = options?.validate?.(input.value);
      if (message) { error.textContent = message; return; }
      close(input.value);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
      if (event.key === "Escape") close(null);
    });
    const confirm = document.createElement("button");
    confirm.textContent = "OK";
    confirm.addEventListener("click", submit);
    panel.append(label, input, error, confirm);
    overlay.append(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(null); });
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}

function showNotificationToast(message: string, options?: { severity?: "info" | "warning" | "error"; actions?: { label: string; run: () => void }[]; progress?: boolean }): string {
  const id = `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const toast = document.createElement("div");
  toast.className = `arc-plugin-toast ${options?.severity ?? "info"}`;
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(text);
  for (const action of options?.actions ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => { action.run(); toast.remove(); });
    toast.append(button);
  }
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 6000);
  return id;
}

function showDiffOverlay(leftUri: string, rightUri: string, title?: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "arc-plugin-overlay";
    const panel = document.createElement("div");
    panel.className = "arc-plugin-diff";
    const heading = document.createElement("h3");
    heading.textContent = title ?? "Diff";
    const columns = document.createElement("div");
    columns.className = "arc-plugin-diff-columns";
    const make = (uri: string) => {
      const pre = document.createElement("pre");
      pre.textContent = uri;
      if (uri.startsWith("file://")) {
        void readTextFile(uriToPath(uri)).then((text) => { pre.textContent = text; }).catch(() => undefined);
      }
      return pre;
    };
    columns.append(make(leftUri), make(rightUri));
    const close = document.createElement("button");
    close.textContent = "Close";
    close.addEventListener("click", () => { overlay.remove(); resolve(); });
    panel.append(heading, columns, close);
    overlay.append(panel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) { overlay.remove(); resolve(); } });
    document.body.append(overlay);
  });
}

async function waitFor(condition: () => boolean, listeners: Set<() => void>): Promise<void> {
  if (condition()) return;
  await new Promise<void>((resolve) => {
    const listener = () => {
      if (!condition()) return;
      listeners.delete(listener);
      resolve();
    };
    listeners.add(listener);
  });
}

function resolveKey(pluginId: string, id: string): string {
  return id.includes(":") ? id : `${pluginId}:${id}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Operation timed out.")), timeoutMs);
    promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function startPluginLanguageServer(
  invokeCommand: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  pluginId: string,
  options: { command: string; args?: string[]; cwd?: string; env?: Record<string, string>; language?: string; initializationOptions?: unknown },
): Promise<PluginLanguageServerHandle> {
  const process = await spawnPluginProcess(invokeCommand, pluginId, options.command, options.args ?? [], { cwd: options.cwd, env: options.env });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
  const notificationListeners = new Set<(method: string, params: unknown) => void>();
  const requestListeners = new Set<(method: string, params: unknown) => unknown>();
  let nextId = 1;
  let buffer = "";
  const send = async (message: unknown) => {
    const body = JSON.stringify(message);
    await process.write(`Content-Length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`);
  };
  const respond = (id: number | string, result: unknown, error?: { code: number; message: string }) => {
    void send(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }).catch(() => undefined);
  };
  const handleMessage = (message: Record<string, unknown>) => {
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      window.clearTimeout(request.timer);
      if (message.error) request.reject(new Error(String((message.error as { message?: string }).message ?? "Language server request failed.")));
      else request.resolve(message.result);
      return;
    }
    const method = String(message.method ?? "");
    if (!method) return;
    if (message.id !== undefined) {
      void (async () => {
        try {
          let result: unknown = null;
          for (const listener of requestListeners) result = await listener(method, message.params) ?? result;
          respond(message.id as number | string, result);
        } catch (error) {
          respond(message.id as number | string, null, { code: -32603, message: String(error) });
        }
      })();
      return;
    }
    notificationListeners.forEach((listener) => listener(method, message.params));
  };
  const consume = (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd);
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) { buffer = buffer.slice(headerEnd + 4); continue; }
      const length = Number(lengthMatch[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.slice(start, start + length);
      buffer = buffer.slice(start + length);
      try { handleMessage(JSON.parse(body) as Record<string, unknown>); } catch { /* Ignore malformed LSP payloads. */ }
    }
  };
  process.onStdout(consume);
  const server: PluginLanguageServerHandle = {
    ...process,
    request: (method, params, timeoutMs = 20_000) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Language server request timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      void send({ jsonrpc: "2.0", id, method, params: params ?? {} }).catch((error) => {
        window.clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
    }),
    notify: (method, params) => send({ jsonrpc: "2.0", method, params: params ?? {} }),
    onNotification: (handler) => {
      notificationListeners.add(handler);
      return () => notificationListeners.delete(handler);
    },
    onRequest: (handler) => {
      requestListeners.add(handler);
      return () => requestListeners.delete(handler);
    },
    shutdown: async () => {
      try { await server.request("shutdown", null, 3000); } catch { /* Server may already be gone. */ }
      await server.notify("exit").catch(() => undefined);
      await process.stop();
    },
  };
  const initialized = await server.request("initialize", {
    processId: null,
    rootUri: options.cwd ? pathToUri(options.cwd) : null,
    workspaceFolders: options.cwd ? [{ uri: pathToUri(options.cwd), name: options.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace" }] : null,
    capabilities: { textDocument: { synchronization: { dynamicRegistration: true } }, workspace: { workspaceFolders: true } },
    initializationOptions: options.initializationOptions ?? null,
  }) as { capabilities?: unknown };
  void initialized;
  await server.notify("initialized", {});
  return server;
}

type PluginProcessExit = { code: number | null; signal: string | null };
type PluginProcessSink = {
  stdout: Set<(chunk: string) => void>;
  stderr: Set<(chunk: string) => void>;
  exit: Set<(event: PluginProcessExit) => void>;
  error: Set<(error: string) => void>;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingExit: PluginProcessExit[];
  pendingError: string[];
};
const pluginProcessSinks = new Map<string, PluginProcessSink>();
const pluginPendingOutputLimit = 256 * 1024;
const pluginProcessSinkGraceMs = 30_000;
let pluginProcessBusStarted = false;

function pushPendingChunk(list: string[], chunk: string) {
  list.push(chunk);
  let total = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    total += list[index].length;
    if (total > pluginPendingOutputLimit) {
      list.splice(0, index + 1);
      break;
    }
  }
}

function pluginProcessSink(id: string): PluginProcessSink {
  const existing = pluginProcessSinks.get(id);
  if (existing) return existing;
  const sink: PluginProcessSink = {
    stdout: new Set(),
    stderr: new Set(),
    exit: new Set(),
    error: new Set(),
    pendingStdout: [],
    pendingStderr: [],
    pendingExit: [],
    pendingError: [],
  };
  pluginProcessSinks.set(id, sink);
  return sink;
}

function schedulePluginProcessSinkCleanup(id: string) {
  window.setTimeout(() => {
    const sink = pluginProcessSinks.get(id);
    if (!sink) return;
    if (
      sink.stdout.size ||
      sink.stderr.size ||
      sink.exit.size ||
      sink.error.size
    )
      return;
    pluginProcessSinks.delete(id);
  }, pluginProcessSinkGraceMs);
}

function ensurePluginProcessBus() {
  if (pluginProcessBusStarted) return;
  pluginProcessBusStarted = true;
  const fail = () => { pluginProcessBusStarted = false; };
  void listen<{ id: string; stream: string; data: string }>("plugin-process-output", (event) => {
    const sink = pluginProcessSink(event.payload.id);
    const listeners = event.payload.stream === "stderr" ? sink.stderr : sink.stdout;
    if (listeners.size) listeners.forEach((listener) => listener(event.payload.data));
    else if (event.payload.stream === "stderr") pushPendingChunk(sink.pendingStderr, event.payload.data);
    else pushPendingChunk(sink.pendingStdout, event.payload.data);
  }).catch(fail);
  void listen<{ id: string; code: number | null; signal: string | null }>("plugin-process-exit", (event) => {
    const sink = pluginProcessSink(event.payload.id);
    const exit = { code: event.payload.code, signal: event.payload.signal };
    if (sink.exit.size) sink.exit.forEach((listener) => listener(exit));
    else sink.pendingExit = [exit];
    schedulePluginProcessSinkCleanup(event.payload.id);
  }).catch(fail);
  void listen<{ id: string; error: string }>("plugin-process-error", (event) => {
    const sink = pluginProcessSink(event.payload.id);
    if (sink.error.size) sink.error.forEach((listener) => listener(event.payload.error));
    else sink.pendingError = [event.payload.error];
  }).catch(fail);
}

async function spawnPluginProcess(
  invokeCommand: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  pluginId: string,
  executable: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<PluginProcessHandle> {
  if (!executable) throw new Error("An executable is required.");
  ensurePluginProcessBus();
  const id = await invokeCommand("plugin_process_spawn", {
    pluginId,
    executable,
    args,
    cwd: options?.cwd ?? null,
    env: options?.env ?? null,
  }) as string;
  const sink = pluginProcessSink(id);
  let stopped = false;
  const replayStdout = (handler: (chunk: string) => void) => {
    if (!sink.pendingStdout.length) return;
    const pending = sink.pendingStdout.splice(0);
    pending.forEach(handler);
  };
  const replayStderr = (handler: (chunk: string) => void) => {
    if (!sink.pendingStderr.length) return;
    const pending = sink.pendingStderr.splice(0);
    pending.forEach(handler);
  };
  const replayExit = (handler: (event: PluginProcessExit) => void) => {
    if (!sink.pendingExit.length) return;
    const pending = sink.pendingExit.splice(0);
    pending.forEach(handler);
  };
  const replayError = (handler: (error: string) => void) => {
    if (!sink.pendingError.length) return;
    const pending = sink.pendingError.splice(0);
    pending.forEach(handler);
  };
  return {
    id,
    write: async (data) => {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      await invokeCommand("plugin_process_write", { id, data: text });
    },
    closeStdin: async () => { await invokeCommand("plugin_process_close_stdin", { id }); },
    onStdout: (handler) => { sink.stdout.add(handler); replayStdout(handler); return () => sink.stdout.delete(handler); },
    onStderr: (handler) => { sink.stderr.add(handler); replayStderr(handler); return () => sink.stderr.delete(handler); },
    onExit: (handler) => { sink.exit.add(handler); replayExit(handler); return () => sink.exit.delete(handler); },
    onError: (handler) => { sink.error.add(handler); replayError(handler); return () => sink.error.delete(handler); },
    stop: async (stopOptions) => {
      if (stopped) return;
      stopped = true;
      try {
        await invokeCommand("plugin_process_stop", { id, timeoutMs: stopOptions?.timeoutMs ?? 2000 });
      } finally {
        pluginProcessSinks.delete(id);
      }
    },
  };
}

async function spawnPluginPty(
  invokeCommand: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  _pluginId: string,
  executable: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<PluginProcessHandle> {
  const id = `plugin-pty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const command = [executable, ...args].map(shellQuote).join(" ");
  const envPrefix = Object.entries(options?.env ?? {}).map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
  await invokeCommand("terminal_spawn", { id, cwd: options?.cwd ?? null, command: envPrefix ? `${envPrefix} ${command}` : command });
  const stdoutListeners = new Set<(chunk: string) => void>();
  const exitListeners = new Set<(event: { code: number | null; signal: string | null }) => void>();
  const unlisteners: (() => void)[] = [];
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unlisteners.forEach((stop) => stop());
    unlisteners.length = 0;
  };
  const track = (stop: () => void) => {
    if (closed) stop();
    else unlisteners.push(stop);
  };
  void listen<{ id: string; data: string }>("terminal-output", (event) => {
    if (closed || event.payload.id !== id) return;
    stdoutListeners.forEach((listener) => listener(event.payload.data));
  }).then(track);
  void listen<{ id: string; code: number | null }>("terminal-exit", (event) => {
    if (closed || event.payload.id !== id) return;
    exitListeners.forEach((listener) => listener({ code: event.payload.code, signal: null }));
    cleanup();
  }).then(track);
  return {
    id,
    write: async (data) => {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      await invokeCommand("terminal_write", { id, data: text });
    },
    closeStdin: async () => { await invokeCommand("terminal_write", { id, data: "\u0004" }); },
    onStdout: (handler) => { stdoutListeners.add(handler); return () => stdoutListeners.delete(handler); },
    onStderr: () => () => undefined,
    onExit: (handler) => { exitListeners.add(handler); return () => exitListeners.delete(handler); },
    onError: () => () => undefined,
    stop: async () => {
      try { await invokeCommand("terminal_close", { id }); } finally { cleanup(); }
    },
  };
}

async function connectPluginSocket(
  invokeCommand: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  pluginId: string,
  transport: "unix" | "pipe" | "tcp",
  target: string,
  timeoutMs = 10_000,
): Promise<PluginSocketHandle> {
  const id = await invokeCommand("plugin_socket_connect", { pluginId, transport, target, timeoutMs }) as string;
  const dataListeners = new Set<(bytes: Uint8Array) => void>();
  const errorListeners = new Set<(error: string) => void>();
  const closeListeners = new Set<() => void>();
  const unlisteners: (() => void)[] = [];
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unlisteners.forEach((stop) => stop());
    unlisteners.length = 0;
  };
  const track = (stop: () => void) => {
    if (closed) stop();
    else unlisteners.push(stop);
  };
  track(await listen<{ id: string; data: number[] }>("plugin-socket-data", (event) => {
    if (closed || event.payload.id !== id) return;
    const bytes = new Uint8Array(event.payload.data);
    dataListeners.forEach((listener) => listener(bytes));
  }));
  track(await listen<{ id: string; error: string }>("plugin-socket-error", (event) => {
    if (closed || event.payload.id !== id) return;
    errorListeners.forEach((listener) => listener(event.payload.error));
  }));
  track(await listen<{ id: string }>("plugin-socket-close", (event) => {
    if (closed || event.payload.id !== id) return;
    closeListeners.forEach((listener) => listener());
    cleanup();
  }));
  return {
    write: async (bytes) => { await invokeCommand("plugin_socket_write", { id, data: [...bytes] }); },
    onData: (handler) => { dataListeners.add(handler); return () => dataListeners.delete(handler); },
    onError: (handler) => { errorListeners.add(handler); return () => errorListeners.delete(handler); },
    onClose: (handler) => { closeListeners.add(handler); return () => closeListeners.delete(handler); },
    close: async () => {
      try { await invokeCommand("plugin_socket_close", { id }); } finally { cleanup(); }
    },
  };
}

async function listenPluginHttp(
  invokeCommand: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  pluginId: string,
  handler: (request: { method: string; url: string; headers: Record<string, string>; body: Uint8Array }) => Promise<{ status?: number; headers?: Record<string, string>; body?: string | Uint8Array }>,
  options?: { port?: number; host?: string },
): Promise<{ url: string; close: () => Promise<void> }> {
  const info = await invokeCommand("plugin_http_server_start", { pluginId, host: options?.host ?? "127.0.0.1", port: options?.port ?? 0 }) as { id: string; url: string };
  const stop = await listen<{ id: string; requestId: string; method: string; url: string; headers: Record<string, string>; body: number[] }>("plugin-http-request", (event) => {
    if (event.payload.id !== info.id) return;
    void (async () => {
      try {
        const response = await handler({
          method: event.payload.method,
          url: event.payload.url,
          headers: event.payload.headers,
          body: new Uint8Array(event.payload.body),
        });
        const body = typeof response.body === "string" ? [...new TextEncoder().encode(response.body)] : [...(response.body ?? [])];
        await invokeCommand("plugin_http_respond", {
          id: info.id,
          requestId: event.payload.requestId,
          status: response.status ?? 200,
          headers: response.headers ?? {},
          body,
        });
      } catch (error) {
        await invokeCommand("plugin_http_respond", {
          id: info.id,
          requestId: event.payload.requestId,
          status: 500,
          headers: { "content-type": "text/plain" },
          body: [...new TextEncoder().encode(String(error))],
        }).catch(() => undefined);
      }
    })();
  });
  return {
    url: info.url,
    close: async () => {
      stop();
      await invokeCommand("plugin_http_server_stop", { id: info.id });
    },
  };
}

type McpServerEntry = {
  pluginId: string;
  definition: PluginMcpServerDefinition;
  state: string;
  capabilities?: Record<string, unknown>;
  serverInfo?: unknown;
  client?: McpClient;
};

type McpClient = {
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;
  notify: (method: string, params?: unknown) => Promise<void>;
  close: () => Promise<void>;
};

const mcpServers = new Map<string, McpServerEntry>();
const mcpResourceSubscriptions = new Map<string, Map<string, () => void>>();
const mcpHostHandlers = {
  sampling: new Set<(request: unknown) => unknown>(),
  elicitation: new Set<(request: unknown) => unknown>(),
  authorization: new Set<(request: unknown) => unknown>(),
};
const mcpExposures = new Map<string, { pluginId: string; kind: string; definition: unknown; handler: unknown }>();
const mcpRoots = new Map<string, { uri: string; name?: string }[]>();

async function handleMcpHostRequest(key: string, method: string, params: unknown): Promise<unknown> {
  if (method === "roots/list") return { roots: mcpRoots.get(key) ?? [] };
  const handlers = method === "sampling/createMessage"
    ? mcpHostHandlers.sampling
    : method === "elicitation/create"
      ? mcpHostHandlers.elicitation
      : method === "notifications/authorization_required"
        ? mcpHostHandlers.authorization
        : null;
  if (!handlers) return null;
  for (const handler of handlers) {
    const result = await handler(params);
    if (result !== undefined) return result;
  }
  return null;
}

function emitMcpEvent(event: string, payload: unknown) {
  window.dispatchEvent(new CustomEvent(`arc:mcp:${event}`, { detail: payload }));
}

function subscribeMcp(channel: string, handler: (payload: unknown) => void, active: ActivePlugin): () => void {
  const listener = (event: Event) => handler((event as CustomEvent).detail);
  window.addEventListener(`arc:mcp:${channel}`, listener);
  const dispose = () => window.removeEventListener(`arc:mcp:${channel}`, listener);
  active.disposables.push(dispose);
  return dispose;
}

async function connectMcp(key: string, timeoutMs = 20_000): Promise<PluginMcpServerHandle> {
  const entry = mcpServers.get(key);
  if (!entry) throw new Error(`Unknown MCP server: ${key}`);
  if (entry.client) {
    return mcpHandle(key, entry);
  }
  entry.state = "connecting";
  emitMcpEvent("server", { id: key, state: entry.state });
  try {
    const definition = entry.definition;
    const isHttp = (definition.type ?? (definition.url ? "http" : "stdio")) === "http";
    const client = isHttp ? await createMcpHttpClient(definition, key, timeoutMs) : await createMcpStdioClient(definition, key, timeoutMs);
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { roots: { listChanged: true }, sampling: {}, elicitation: {} },
      clientInfo: { name: "Arc", version: "0.1.2" },
    }, timeoutMs) as { capabilities?: Record<string, unknown>; serverInfo?: unknown };
    entry.client = client;
    entry.capabilities = initialized.capabilities ?? {};
    entry.serverInfo = initialized.serverInfo;
    entry.state = "connected";
    await client.notify("notifications/initialized");
    emitMcpEvent("server", { id: key, state: entry.state, capabilities: entry.capabilities });
    return mcpHandle(key, entry);
  } catch (error) {
    entry.state = "error";
    emitMcpEvent("server", { id: key, state: entry.state, error: String(error) });
    throw error;
  }
}

function mcpHandle(key: string, entry: McpServerEntry): PluginMcpServerHandle {
  return {
    id: key,
    serverInfo: entry.serverInfo,
    capabilities: entry.capabilities ?? {},
    call: (method, params) => mcpRequest(key, method, params),
    dispose: () => { void disconnectMcp(key); },
  };
}

async function disconnectMcp(key: string): Promise<void> {
  const entry = mcpServers.get(key);
  if (!entry?.client) return;
  await entry.client.close().catch(() => undefined);
  entry.client = undefined;
  entry.state = "registered";
  emitMcpEvent("server", { id: key, state: entry.state });
}

async function mcpRequest(key: string, method: string, params?: unknown): Promise<unknown> {
  const entry = mcpServers.get(key);
  if (!entry?.client) throw new Error(`MCP server is not connected: ${key}`);
  return entry.client.request(method, params);
}

async function createMcpStdioClient(definition: PluginMcpServerDefinition, key: string, timeoutMs: number): Promise<McpClient> {
  const process = await spawnPluginProcess(invoke, "mcp", definition.executable ?? definition.command ?? "", definition.args ?? [], { cwd: definition.cwd, env: definition.env });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let buffer = "";
  const handleMessage = (message: Record<string, unknown>) => {
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(String((message.error as { message?: string }).message ?? "MCP request failed")));
      else request.resolve(message.result);
      return;
    }
    const method = String(message.method ?? "");
    if (!method) return;
    if (method === "notifications/tools/list_changed") emitMcpEvent("tools", { id: key });
    else if (method === "notifications/resources/list_changed") emitMcpEvent("resources", { id: key });
    else if (method === "notifications/resources/updated") {
      const uri = (message.params as { uri?: string })?.uri;
      emitMcpEvent("resources", { id: key, uri });
      if (uri) mcpResourceSubscriptions.get(key)?.get(uri)?.();
    }
    else if (method === "notifications/prompts/list_changed") emitMcpEvent("prompts", { id: key });
    else if (method === "notifications/message") emitMcpEvent("log", { serverId: key, ...(message.params as Record<string, unknown>) });
    else if (method === "roots/list" || method === "sampling/createMessage" || method === "elicitation/create" || method === "notifications/authorization_required") {
      if (message.id !== undefined) {
        void handleMcpHostRequest(key, method, message.params).then(
          (result) => send({ jsonrpc: "2.0", id: message.id, result }),
          (error) => send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: String(error) } }),
        );
      }
    }
  };
  const send = async (message: unknown) => {
    await process.write(`${JSON.stringify(message)}\n`);
  };
  process.onStdout((chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try { handleMessage(JSON.parse(line) as Record<string, unknown>); } catch { /* Ignore non-JSON protocol noise. */ }
    }
  });
  const client: McpClient = {
    request: (method, params, requestTimeout = timeoutMs) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = window.setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); }, requestTimeout);
      pending.set(id, {
        resolve: (value) => { window.clearTimeout(timer); resolve(value); },
        reject: (error) => { window.clearTimeout(timer); reject(error); },
      });
      void send({ jsonrpc: "2.0", id, method, params: params ?? {} }).catch((error) => { window.clearTimeout(timer); pending.delete(id); reject(error); });
    }),
    notify: (method, params) => send({ jsonrpc: "2.0", method, params: params ?? {} }),
    close: () => process.stop(),
  };
  return client;
}

async function createMcpHttpClient(definition: PluginMcpServerDefinition, key: string, timeoutMs: number): Promise<McpClient> {
  if (!definition.url) throw new Error("MCP HTTP server requires a url.");
  let nextId = 0;
  let sessionId: string | null = null;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const handleMessage = (message: Record<string, unknown>) => {
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(String((message.error as { message?: string }).message ?? "MCP request failed")));
      else request.resolve(message.result);
      return;
    }
    const method = String(message.method ?? "");
    if (method === "notifications/tools/list_changed") emitMcpEvent("tools", { id: key });
    else if (method === "notifications/resources/list_changed") emitMcpEvent("resources", { id: key });
    else if (method === "notifications/resources/updated") {
      const uri = (message.params as { uri?: string })?.uri;
      emitMcpEvent("resources", { id: key, uri });
      if (uri) mcpResourceSubscriptions.get(key)?.get(uri)?.();
    }
    else if (method === "notifications/prompts/list_changed") emitMcpEvent("prompts", { id: key });
    else if (method === "notifications/message") emitMcpEvent("log", { serverId: key, ...(message.params as Record<string, unknown>) });
    else if (method === "roots/list" || method === "sampling/createMessage" || method === "elicitation/create" || method === "notifications/authorization_required") {
      if (message.id !== undefined) {
        void handleMcpHostRequest(key, method, message.params).then((result) => {
          void post({ jsonrpc: "2.0", id: message.id, result });
        });
      }
    }
  };
  const post = async (message: unknown): Promise<Response> => fetch(definition.url!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(message),
  });
  const client: McpClient = {
    request: (method, params, requestTimeout = timeoutMs) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = window.setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); }, requestTimeout);
      pending.set(id, {
        resolve: (value) => { window.clearTimeout(timer); resolve(value); },
        reject: (error) => { window.clearTimeout(timer); reject(error); },
      });
      void (async () => {
        try {
          const response = await post({ jsonrpc: "2.0", id, method, params: params ?? {} });
          sessionId = response.headers.get("mcp-session-id") ?? sessionId;
          if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
          const text = await response.text();
          for (const line of text.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            try { handleMessage(JSON.parse(data) as Record<string, unknown>); } catch { /* Ignore malformed stream data. */ }
          }
          if (text.trim().startsWith("{")) {
            try { handleMessage(JSON.parse(text) as Record<string, unknown>); } catch { /* Ignore malformed body. */ }
          }
        } catch (error) {
          window.clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      })();
    }),
    notify: async (method, params) => {
      const response = await post({ jsonrpc: "2.0", method, params: params ?? {} });
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    },
    close: async () => { pending.clear(); },
  };
  return client;
}

let arcMcpServerUrl = "";
let arcMcpServerStarting: Promise<void> | null = null;
let arcMcpServerHandle: { url: string; close: () => Promise<void> } | null = null;
const arcMcpToken = (() => {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
})();

function mcpExposureDefinition(entry: { pluginId: string; kind: string; definition: unknown }) {
  return (entry.definition ?? {}) as Record<string, unknown>;
}

function mcpExposureName(entry: { pluginId: string; kind: string; definition: unknown }): string {
  const definition = mcpExposureDefinition(entry);
  const raw = String(definition.name ?? definition.title ?? entry.kind);
  return raw.includes(":") ? raw : `${entry.pluginId}:${raw}`;
}

function mcpTemplateMatches(template: string, uri: string): Record<string, string> | null {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}/g, "([^/]+)");
  const match = new RegExp(`^${escaped}$`).exec(uri);
  if (!match) return null;
  const names = [...template.matchAll(/\{([^}]+)\}/g)].map((item) => item[1]);
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? "")]));
}

function mcpContentResult(value: unknown): { content: { type: string; text: string }[]; isError: boolean; structuredContent?: unknown } {
  if (value && typeof value === "object" && Array.isArray((value as { content?: unknown }).content)) return value as never;
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return { content: [{ type: "text", text }], isError: Boolean((value as { isError?: boolean })?.isError), structuredContent: value };
}

async function handleArcMcpRequest(request: { method: string; url: string; headers: Record<string, string>; body: Uint8Array }): Promise<{ status?: number; headers?: Record<string, string>; body?: string | Uint8Array }> {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-session-id",
    "access-control-expose-headers": "mcp-session-id",
  };
  if (request.method === "OPTIONS") return { status: 204, headers: cors, body: "" };
  const authorization = request.headers.authorization ?? request.headers.Authorization ?? "";
  if (authorization !== `Bearer ${arcMcpToken}`) return { status: 401, headers: { ...cors, "content-type": "text/plain" }, body: "Unauthorized" };
  if (request.method !== "POST") return { status: 405, headers: { ...cors, "content-type": "text/plain", allow: "POST" }, body: "Method not allowed" };
  let message: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try { message = JSON.parse(new TextDecoder().decode(request.body)); }
  catch { return { status: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) }; }
  const respond = (result: unknown) => ({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: message.id ?? null, result }) });
  const fail = (code: number, text: string) => ({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: message.id ?? null, error: { code, message: text } }) });
  const entries = [...mcpExposures.values()];
  const method = message.method ?? "";
  if (!method) return fail(-32600, "Invalid request");
  if (method.startsWith("notifications/")) return { status: 202, headers: cors, body: "" };
  try {
    if (method === "initialize") return respond({
      protocolVersion: "2025-06-18",
      capabilities: {
        tools: entries.some((entry) => entry.kind === "tool") ? { listChanged: false } : undefined,
        resources: entries.some((entry) => entry.kind === "resource" || entry.kind === "resourceTemplate") ? { subscribe: false, listChanged: false } : undefined,
        prompts: entries.some((entry) => entry.kind === "prompt") ? { listChanged: false } : undefined,
      },
      serverInfo: { name: "Arc", version: "0.1.2" },
    });
    if (method === "ping") return respond({});
    if (method === "tools/list") return respond({ tools: entries.filter((entry) => entry.kind === "tool").map((entry) => {
      const definition = mcpExposureDefinition(entry);
      return { name: mcpExposureName(entry), title: definition.title, description: definition.description, inputSchema: definition.inputSchema ?? { type: "object" }, outputSchema: definition.outputSchema, annotations: definition.annotations };
    }) });
    if (method === "tools/call") {
      const name = String(message.params?.name ?? "");
      const entry = entries.find((candidate) => candidate.kind === "tool" && mcpExposureName(candidate) === name);
      if (!entry) return fail(-32602, `Unknown tool: ${name}`);
      const handler = entry.handler as (args: unknown) => unknown;
      return respond(mcpContentResult(await handler(message.params?.arguments ?? {})));
    }
    if (method === "resources/list") return respond({ resources: entries.filter((entry) => entry.kind === "resource").map((entry) => {
      const definition = mcpExposureDefinition(entry);
      return { uri: definition.uri, name: definition.name ?? definition.uri, description: definition.description, mimeType: definition.mimeType };
    }) });
    if (method === "resources/templates/list") return respond({ resourceTemplates: entries.filter((entry) => entry.kind === "resourceTemplate").map((entry) => {
      const definition = mcpExposureDefinition(entry);
      return { uriTemplate: definition.uriTemplate ?? definition.uri, name: definition.name ?? definition.uriTemplate, description: definition.description, mimeType: definition.mimeType };
    }) });
    if (method === "resources/read") {
      const uri = String(message.params?.uri ?? "");
      const resource = entries.find((entry) => entry.kind === "resource" && mcpExposureDefinition(entry).uri === uri);
      const template = entries.find((entry) => entry.kind === "resourceTemplate" && mcpTemplateMatches(String(mcpExposureDefinition(entry).uriTemplate ?? mcpExposureDefinition(entry).uri ?? ""), uri));
      if (!resource && !template) return fail(-32602, `Unknown resource: ${uri}`);
      const entry = resource ?? template!;
      const handler = entry.handler as (uri: string, variables?: Record<string, string>) => unknown;
      const value = await handler(uri, template ? mcpTemplateMatches(String(mcpExposureDefinition(template).uriTemplate ?? mcpExposureDefinition(template).uri ?? ""), uri) ?? undefined : undefined);
      const definition = mcpExposureDefinition(entry);
      const content = typeof value === "string" ? { uri, mimeType: definition.mimeType, text: value } : value && typeof value === "object" && "bytes" in (value as Record<string, unknown>) ? { uri, mimeType: definition.mimeType, blob: (value as { bytes: unknown }).bytes } : { uri, mimeType: definition.mimeType, text: JSON.stringify(value ?? null, null, 2) };
      return respond({ contents: [content] });
    }
    if (method === "prompts/list") return respond({ prompts: entries.filter((entry) => entry.kind === "prompt").map((entry) => {
      const definition = mcpExposureDefinition(entry);
      return { name: mcpExposureName(entry), description: definition.description, arguments: definition.arguments };
    }) });
    if (method === "prompts/get") {
      const name = String(message.params?.name ?? "");
      const entry = entries.find((candidate) => candidate.kind === "prompt" && mcpExposureName(candidate) === name);
      if (!entry) return fail(-32602, `Unknown prompt: ${name}`);
      const value = await (entry.handler as (args: unknown) => unknown)(message.params?.arguments ?? {});
      const definition = mcpExposureDefinition(entry);
      return respond(value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages)
        ? value
        : { description: definition.description, messages: [{ role: "user", content: { type: "text", text: typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2) } }] });
    }
    return fail(-32601, `Method not found: ${method}`);
  } catch (error) {
    return fail(-32603, String(error));
  }
}

async function ensureArcMcpServer(): Promise<void> {
  if (arcMcpServerHandle) return;
  if (arcMcpServerStarting) return arcMcpServerStarting;
  arcMcpServerStarting = (async () => {
    try {
      arcMcpServerHandle = await listenPluginHttp(invoke, "arc-mcp", handleArcMcpRequest, { host: "127.0.0.1", port: 0 });
      arcMcpServerUrl = `${arcMcpServerHandle.url.replace(/\/$/, "")}/mcp`;
      emitMcpEvent("server", { id: "arc", state: "connected", url: arcMcpServerUrl });
    } catch (error) {
      pluginNotify(`Could not start Arc MCP server: ${String(error)}`);
    } finally {
      arcMcpServerStarting = null;
    }
  })();
  return arcMcpServerStarting;
}

function exposeMcp(kind: string, definition: unknown, handler: unknown, pluginId: string, active: ActivePlugin): () => void {
  const id = `${pluginId}:${kind}:${Math.random().toString(36).slice(2)}`;
  mcpExposures.set(id, { pluginId, kind, definition, handler });
  emitMcpEvent("exposure-changed", { pluginId });
  void ensureArcMcpServer();
  const dispose = () => {
    mcpExposures.delete(id);
    emitMcpEvent("exposure-changed", { pluginId });
  };
  active.disposables.push(dispose);
  return dispose;
}
