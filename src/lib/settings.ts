import type { AgentCli } from "./agent/kit";

export type UpdateChannel = "stable" | "beta";

export type AppTheme = "classic" | "modern";

export type AppThemeDefinition = {
  id: AppTheme;
  name: string;
  interfaceFont: string;
  editorFont: string;
  terminalFont: string;
  defaultColorTheme: string;
};

export const APP_THEMES: AppThemeDefinition[] = [
  {
    id: "classic",
    name: "Classic",
    interfaceFont: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
    editorFont: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
    terminalFont: "'JetBrains Mono', monospace",
    defaultColorTheme: "midnight",
  },
  {
    id: "modern",
    name: "Modern",
    interfaceFont:
      '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    editorFont:
      '"Berkeley Mono", "JetBrains Mono", ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    terminalFont:
      '"Berkeley Mono", "JetBrains Mono", ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    defaultColorTheme: "modern",
  },
];

export const APP_THEME_OPTIONS = APP_THEMES.map(({ id, name }) => ({
  value: id,
  label: name,
}));

export type AppSettings = {
  prettierOnSave: boolean;
  lineNumbers: boolean;
  indentGuides: boolean;
  activeLine: boolean;
  wordWrap: boolean;
  autoCloseBrackets: boolean;
  bracketMatching: boolean;
  autocomplete: boolean;
  autoIndent: boolean;
  showHiddenFiles: boolean;
  restoreTerminals: boolean;
  sidebarWidth: number;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalCursorStyle: "block" | "underline" | "bar";
  terminalCursorBlink: boolean;
  terminalScrollback: number;
  terminalPadding: number;
  terminalScrollbar: boolean;
  terminalSelectionColor: string;
  terminalShowTitle: boolean;
  interfaceFontFamily: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  zoomLevel: number;
  selectedTheme: string;
  appTheme: AppTheme;
  titleBarEnabled: boolean;
  editorGlassEnabled: boolean;
  nativeBackgroundBlurEnabled: boolean;
  editorGlassTransparency: number;
  glassAppTransparency: number;
  glassSidebarTransparency: number;
  glassTabsTransparency: number;
  glassTerminalTransparency: number;
  glassFloatingTransparency: number;
  glassSettingsTransparency: number;
  glassControlsTransparency: number;
  updateChannel: UpdateChannel;
  autoCheckUpdates: boolean;
  autoInstallUpdates: boolean;
  agentCli: AgentCli;
  agentCommand: string;
};

export const APP_SETTINGS_VERSION = 3;

export const GLASS_BLUR = 18;

export type ThemeColors = {
  background: string;
  sidebar: string;
  editor: string;
  raised: string;
  border: string;
  text: string;
  secondaryText: string;
  muted: string;
  selected: string;
  hover: string;
  lineNumber: string;
  activeLine: string;
  cursor: string;
  selection: string;
  indentGuide: string;
  keyword: string;
  control: string;
  string: string;
  number: string;
  function: string;
  type: string;
  property: string;
  tag: string;
  attribute: string;
  comment: string;
  operator: string;
  meta: string;
  invalid: string;
  invalidBackground: string;
  accent: string;
  accentText: string;
  input: string;
  warning: string;
  error: string;
};

export type ThemeDefinition = { id: string; name: string; colors: ThemeColors };

export const DEFAULT_SETTINGS: AppSettings = {
  prettierOnSave: true,
  lineNumbers: true,
  indentGuides: true,
  activeLine: true,
  wordWrap: false,
  autoCloseBrackets: true,
  bracketMatching: true,
  autocomplete: true,
  autoIndent: true,
  showHiddenFiles: false,
  restoreTerminals: true,
  sidebarWidth: 244,
  terminalFontFamily: "",
  terminalFontSize: 12,
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  terminalScrollback: 1000,
  terminalPadding: 8,
  terminalScrollbar: true,
  terminalSelectionColor: "",
  terminalShowTitle: true,
  interfaceFontFamily: "",
  fontFamily: "",
  fontSize: 13,
  lineHeight: 1.7,
  tabSize: 2,
  zoomLevel: 1,
  selectedTheme: "modern",
  appTheme: "modern",
  titleBarEnabled: true,
  editorGlassEnabled: true,
  nativeBackgroundBlurEnabled: true,
  editorGlassTransparency: 28,
  glassAppTransparency: 20,
  glassSidebarTransparency: 20,
  glassTabsTransparency: 14,
  glassTerminalTransparency: 28,
  glassFloatingTransparency: 18,
  glassSettingsTransparency: 12,
  glassControlsTransparency: 12,
  updateChannel: "stable",
  autoCheckUpdates: true,
  autoInstallUpdates: false,
  agentCli: "opencode",
  agentCommand: "",
};

export function appThemeDefinition(id: AppTheme): AppThemeDefinition {
  return APP_THEMES.find((theme) => theme.id === id) ?? APP_THEMES[0];
}

export function resolveInterfaceFont(settings: Pick<AppSettings, "interfaceFontFamily" | "appTheme">): string {
  return settings.interfaceFontFamily.trim() || appThemeDefinition(settings.appTheme).interfaceFont;
}

export function resolveEditorFont(settings: Pick<AppSettings, "fontFamily" | "appTheme">): string {
  return settings.fontFamily.trim() || appThemeDefinition(settings.appTheme).editorFont;
}

export function resolveTerminalFont(settings: Pick<AppSettings, "terminalFontFamily" | "appTheme">): string {
  return settings.terminalFontFamily.trim() || appThemeDefinition(settings.appTheme).terminalFont;
}

export const DEFAULT_THEME: ThemeDefinition = {
  id: "midnight",
  name: "Midnight",
  colors: {
    background: "#111315",
    sidebar: "#151719",
    editor: "#111315",
    raised: "#1b1e21",
    border: "#2a2d31",
    text: "#d5d9e0",
    secondaryText: "#a6abb2",
    muted: "#747980",
    selected: "#292d32",
    hover: "#202326",
    lineNumber: "#858e9b",
    activeLine: "#ffffff06",
    cursor: "#ffffff",
    selection: "#3e445180",
    indentGuide: "#343a43",
    keyword: "#c678dd",
    control: "#e06c75",
    string: "#98c379",
    number: "#d19a66",
    function: "#61afef",
    type: "#e5c07b",
    property: "#d19a66",
    tag: "#e06c75",
    attribute: "#98c379",
    comment: "#5c6370",
    operator: "#abb2bf",
    meta: "#56b6c2",
    invalid: "#ffffff",
    invalidBackground: "#e06c75",
    accent: "#61afef",
    accentText: "#ffffff",
    input: "#1b1e21",
    warning: "#d19a66",
    error: "#e06c75",
  },
};

export const MODERN_THEME: ThemeDefinition = {
  id: "modern",
  name: "Modern",
  colors: {
    background: "#08090a",
    sidebar: "#08090a",
    editor: "#08090a",
    raised: "#0f1011",
    border: "#23252a",
    text: "#f7f8f8",
    secondaryText: "#d0d6e0",
    muted: "#8a8f98",
    selected: "#232326",
    hover: "#141516",
    lineNumber: "#62666d",
    activeLine: "#ffffff06",
    cursor: "#f7f8f8",
    selection: "#5e6ad240",
    indentGuide: "#2b2c30",
    keyword: "#a78bfa",
    control: "#eb5757",
    string: "#68cc58",
    number: "#d4b144",
    function: "#828fff",
    type: "#7a7fad",
    property: "#d0d6e0",
    tag: "#eb5757",
    attribute: "#68cc58",
    comment: "#62666d",
    operator: "#8a8f98",
    meta: "#00b8cc",
    invalid: "#ffffff",
    invalidBackground: "#eb5757",
    accent: "#5e6ad2",
    accentText: "#ffffff",
    input: "#1c1c1f",
    warning: "#f0bf00",
    error: "#eb5757",
  },
};

export const BUILTIN_THEMES: ThemeDefinition[] = [
  DEFAULT_THEME,
  MODERN_THEME,
];

export const THEME_COLOR_GROUPS: { name: string; keys: (keyof ThemeColors)[] }[] = [
  { name: "Interface", keys: ["background", "sidebar", "editor", "raised", "border", "text", "secondaryText", "muted", "selected", "hover"] },
  { name: "Editor", keys: ["lineNumber", "activeLine", "cursor", "selection", "indentGuide"] },
  { name: "Semantic", keys: ["accent", "accentText", "input", "warning", "error"] },
  { name: "Syntax", keys: ["keyword", "control", "string", "number", "function", "type", "property", "tag", "attribute", "comment", "operator", "meta", "invalid", "invalidBackground"] },
];

export function migrateStorageNamespace(): void {
  const marker = "arc.migratedGlasswingStorage";
  try {
    if (localStorage.getItem(marker) === "true") return;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("glasswing.")) continue;
      const arcKey = `arc.${key.slice("glasswing.".length)}`;
      if (localStorage.getItem(arcKey) === null) {
        const value = localStorage.getItem(key);
        if (value !== null) localStorage.setItem(arcKey, value);
      }
    }
    localStorage.setItem(marker, "true");
  } catch {
    // Keep legacy data intact if browser storage is unavailable or full.
  }
}

export function loadSettings(): AppSettings {
  try {
    const stored = JSON.parse(localStorage.getItem("arc.settings") ?? "null") as (Partial<AppSettings> & { version?: number; editorGlassSaturation?: unknown; frameRateMode?: unknown; frameRateLimit?: unknown }) | null;
    if (!stored) return DEFAULT_SETTINGS;
    const saved = { ...stored };
    delete saved.editorGlassSaturation;
    delete saved.frameRateMode;
    delete saved.frameRateLimit;
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    if ((settings.appTheme as string) === "t3") {
      settings.appTheme = "modern";
    }
    if (settings.selectedTheme === "t3-code") {
      settings.selectedTheme = "modern";
    }
    if (!APP_THEME_OPTIONS.some((option) => option.value === settings.appTheme)) {
      settings.appTheme = DEFAULT_SETTINGS.appTheme;
    }
    // App theme was not user-selectable before version 3; adopt the new default.
    if ((stored.version ?? 0) < 3) {
      settings.appTheme = "modern";
    }
    // The pre-versioned default made the entire app background fully transparent.
    if ((stored.version ?? 0) < 1 && stored.glassAppTransparency === 100) {
      settings.glassAppTransparency = DEFAULT_SETTINGS.glassAppTransparency;
    }
    if (!["stable", "beta"].includes(settings.updateChannel)) {
      settings.updateChannel = DEFAULT_SETTINGS.updateChannel;
    }
    if (typeof settings.autoCheckUpdates !== "boolean") {
      settings.autoCheckUpdates = DEFAULT_SETTINGS.autoCheckUpdates;
    }
    if (typeof settings.autoInstallUpdates !== "boolean") {
      settings.autoInstallUpdates = DEFAULT_SETTINGS.autoInstallUpdates;
    }
    if (!["opencode", "claude", "codex", "custom"].includes(settings.agentCli)) {
      settings.agentCli = DEFAULT_SETTINGS.agentCli;
    }
    settings.agentCommand = typeof settings.agentCommand === "string"
      ? settings.agentCommand.slice(0, 500)
      : DEFAULT_SETTINGS.agentCommand;
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function normalizeThemeDefinition(value: unknown): ThemeDefinition | null {
  if (!value || typeof value !== "object") return null;
  const theme = value as Partial<ThemeDefinition>;
  const colors = theme.colors as Record<string, unknown> | undefined;
  if (
    typeof theme.id !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(theme.id) ||
    typeof theme.name !== "string" ||
    !colors ||
    typeof colors !== "object"
  ) {
    return null;
  }
  const core: (keyof ThemeColors)[] = [
    "background",
    "editor",
    "text",
    "border",
    "sidebar",
    "raised",
    "muted",
    "secondaryText",
    "selected",
    "hover",
  ];
  if (!core.every((key) => typeof colors[key] === "string")) return null;
  const merged = { ...DEFAULT_THEME.colors };
  const hex = (color: unknown): color is string =>
    typeof color === "string" && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color);
  const derived: Partial<Record<keyof ThemeColors, string>> = {
    accent: hex(colors.function) ? colors.function : undefined,
    accentText: hex(colors.background) ? colors.background : undefined,
    input: hex(colors.raised) ? colors.raised : undefined,
    warning: hex(colors.number) ? colors.number : undefined,
    error: hex(colors.control) ? colors.control : undefined,
  };
  for (const key of Object.keys(merged) as (keyof ThemeColors)[]) {
    const color = colors[key];
    if (hex(color)) {
      merged[key] = color;
    } else if (derived[key]) {
      merged[key] = derived[key];
    }
  }
  return { id: theme.id, name: theme.name, colors: merged };
}

export function themeColorWithOpacity(color: string, opacity: number): string {
  const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(color);
  if (!match) return color;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
  const baseOpacity = match[2] ? Number.parseInt(match[2], 16) / 255 : 1;
  const alpha = baseOpacity * Math.max(0, Math.min(1, opacity));
  return `rgba(${channels.join(",")},${alpha.toFixed(3)})`;
}

export function themeCss(theme: ThemeDefinition, settings: AppSettings): string {
  const c = theme.colors;
  const transparency = (value: number) => settings.editorGlassEnabled ? Math.max(0, Math.min(100, value)) : 0;
  const glass = (color: string, value: number) => themeColorWithOpacity(color, 1 - transparency(value) / 100);
  const appBackground = glass(c.background, settings.glassAppTransparency);
  const sidebarBackground = glass(c.sidebar, settings.glassSidebarTransparency);
  const editorBackground = glass(c.editor, settings.editorGlassTransparency);
  const terminalBackground = glass(c.editor, settings.glassTerminalTransparency);
  const tabsBackground = glass(c.raised, settings.glassTabsTransparency);
  const floatingBackground = glass(c.raised, settings.glassFloatingTransparency);
  const settingsBackground = c.background;
  const controlsBackground = glass(c.raised, settings.glassControlsTransparency);
  const editorFont = resolveEditorFont(settings);
  const overlayAlpha = settings.editorGlassEnabled
    ? 0.5 * (1 - transparency(settings.glassFloatingTransparency) / 100)
    : 0.55;
  return `
    .app-shell { --settings-bg:${c.background}; --settings-muted:${c.muted}; --settings-secondary-text:${c.secondaryText}; --settings-text:${c.text}; --settings-raised:${c.raised}; --settings-border:${c.border}; --settings-accent:${c.accent}; --settings-track:${c.hover}; --settings-selected:${c.selected}; --settings-hover:${c.hover}; --app-accent:${c.accent}; --app-accent-text:${c.accentText}; --app-input:${c.input}; --app-warning:${c.warning}; --app-error:${c.error}; --app-canvas:${c.background}; --app-surface:${c.sidebar}; --app-raised:${c.raised}; --app-border:${c.border}; --app-text:${c.text}; --app-secondary:${c.secondaryText}; --app-muted:${c.muted}; --app-hover:${c.hover}; --app-selected:${c.selected}; --app-highlight:${themeColorWithOpacity(c.text, 0.07)}; --editor-glass-blur:${GLASS_BLUR}px; --glass-app-transparency:${transparency(settings.glassAppTransparency)}%; --glass-sidebar-transparency:${transparency(settings.glassSidebarTransparency)}%; --glass-tabs-transparency:${transparency(settings.glassTabsTransparency)}%; --glass-terminal-transparency:${transparency(settings.glassTerminalTransparency)}%; --glass-floating-transparency:${transparency(settings.glassFloatingTransparency)}%; --glass-settings-transparency:${transparency(settings.glassSettingsTransparency)}%; --glass-controls-transparency:${transparency(settings.glassControlsTransparency)}%; --glass-overlay-alpha:${overlayAlpha}; background:${appBackground}; color:${c.text}; }
    .settings-backdrop { background:rgba(0,0,0,${overlayAlpha}); }
    .file-explorer { background:${sidebarBackground}; border-color:${c.border}; }
    .terminal-stack,.terminal-host,.terminal-view { background:${terminalBackground}; }
    .explorer-heading,.tab-strip,.editor-tab,.tree-create-row,.search-row,.context-menu,.split-divider { border-color:${c.border}; }
    .explorer-heading,.empty-hint,.tree-row,.welcome-shortcuts>div { color:${c.secondaryText}; }
    .search-row,.tab-close,.show-file-explorer { color:${c.muted}; }
    .tree-row:hover { background:${glass(c.hover, settings.glassSidebarTransparency)}; }
    .tool-button:hover,.tool-button.selected,.editor-tab:hover,.welcome-open:hover { background:${glass(c.hover, settings.glassControlsTransparency)}; }
    .context-menu button:hover { background:${glass(c.hover, settings.glassFloatingTransparency)}; }
    .editor-tab .tab-close:hover { background:${glass(c.hover, settings.glassTabsTransparency)}; }
    .split-divider:hover,.split-divider:active { background:${glass(c.selected, settings.glassTabsTransparency)}; }
    .tree-row.selected { background:${glass(c.selected, settings.glassSidebarTransparency)}; color:${c.text}; }
    .tool-button.selected { background:${glass(c.selected, settings.glassControlsTransparency)}; color:${c.text}; }
    .editor-pane { background:${editorBackground}; color:${c.text}; }
    .welcome-screen { background:${appBackground}; color:${c.text}; }
    .tab-strip,.editor-tab { background:${tabsBackground}; }
    .context-menu { background:${floatingBackground}; }
    .settings-panel,.settings-header { background:${settingsBackground}; border-color:${c.border}; }
    .split-divider { background:${tabsBackground}; }
    .editor-tab { color:${c.secondaryText}; }
    .editor-tab.active,.tab-name,.welcome-name,.context-menu button,.settings-panel { color:${c.text}; }
    .settings-section,.settings-header,.tree-create-row,.search-row { border-color:${c.border}; }
    .settings-section h3,.setting-toggle strong,.setting-field>span { color:${c.secondaryText}; }
    .settings-action,.settings-reset,.welcome-open { background-color:${controlsBackground}; border-color:${c.border}; color:${c.text}; }
    .setting-field input[type=range] { accent-color:${c.accent}; background:${glass(c.border, settings.glassControlsTransparency)}; }
    .setting-field input[type=range]::-webkit-slider-thumb { background:${c.accent}; border-color:${c.text}; }
    .setting-field input[type=range]::-moz-range-thumb { background:${c.accent}; border-color:${c.text}; }
    .theme-search,.theme-choice,.theme-choice button,.theme-list-empty { border-color:${c.border}; color:${c.secondaryText}; }
    .theme-search { background:${controlsBackground}; }
    .theme-search input { color:${c.text}; }
    .theme-choice.active,.theme-choice.active>button { background:${glass(c.selected, settings.glassControlsTransparency)}; color:${c.text}; }
    .theme-choice:hover,.theme-choice button:hover,.theme-remove:hover { background:${glass(c.hover, settings.glassControlsTransparency)}; color:${c.text}; }
    .theme-remove { color:${c.muted}; }
    .context-menu { border:1px solid ${c.border}; }
    .context-menu kbd,.context-menu button kbd,.setting-note,.setting-toggle small { color:${c.muted}; }
    .menu-divider { background:${c.border}; }
    .tool-button,.tab-close { color:${c.muted}; }
    .tree-row.selected,.editor-tab.active { color:${c.text}; }
    .welcome-open { border:1px solid ${c.border}; }
    .welcome-shortcuts kbd { background:${controlsBackground}; border-color:${c.border}; color:${c.secondaryText}; }
    .rename-row input,.tree-create-row input,.search-row input { color:${c.text}; }
    .rename-row input { background:${controlsBackground}; border-color:${c.border}; }
    .tree-create-row { background:${glass(c.raised, settings.glassSidebarTransparency)}; border-color:${c.border}; }
    .editor-pane.drop-target { outline-color:${c.secondaryText}; background:${editorBackground}; }
    .theme-choice-name small { color:${c.muted}; }
    .settings-launch { color:${c.muted}; }
    .settings-launch:hover { color:${c.text}; }
    .editor-root,.editor-empty { background:${appBackground}; color:${c.secondaryText}; }
    .cm-editor { background:${editorBackground}!important; color:${c.text}!important; }
    .cm-scroller { font-family:${editorFont}; font-size:${settings.fontSize}px; line-height:${settings.lineHeight}; tab-size:${settings.tabSize}; }
    .cm-gutters { color:${c.lineNumber}!important; }
    .cm-activeLine { background:${c.activeLine}!important; }
    .cm-activeLineGutter { color:${c.secondaryText}!important; background-color:${c.activeLine}!important; }
    .cm-cursor,.cm-cursor-primary { border-left-color:${c.cursor}!important; }
    .cm-content { caret-color:${c.cursor}!important; }
    .cm-selectionBackground,.cm-focused .cm-selectionBackground,::selection { background:${c.selection}!important; }
    .cm-indent-guide { background-image:linear-gradient(to right,transparent calc(${settings.tabSize}ch - 1px),${c.indentGuide} calc(${settings.tabSize}ch - 1px) ${settings.tabSize}ch)!important; background-size:${settings.tabSize}ch 100%!important; }
    .cm-keyword { color:${c.keyword}!important; }
    .cm-controlKeyword,.cm-definitionKeyword { color:${c.control}!important; }
    .cm-string { color:${c.string}!important; }
    .cm-number,.cm-bool,.cm-null { color:${c.number}!important; }
    .cm-function { color:${c.function}!important; }
    .cm-typeName,.cm-className,.cm-namespace { color:${c.type}!important; }
    .cm-propertyName,.cm-attributeName { color:${c.property}!important; }
    .cm-tagName { color:${c.tag}!important; }
    .cm-attributeValue { color:${c.attribute}!important; }
    .cm-comment { color:${c.comment}!important; font-style:italic; }
    .cm-operator,.cm-punctuation,.cm-separator { color:${c.operator}!important; }
    .cm-meta { color:${c.meta}!important; }
    .cm-invalid { color:${c.invalid}!important; background:${c.invalidBackground}!important; }
    .cm-tooltip-autocomplete { border-color:${c.border}!important; background:${floatingBackground}!important; color:${c.text}!important; }
    .cm-tooltip-autocomplete ul li[aria-selected] { background:${glass(c.selected, settings.glassFloatingTransparency)}!important; color:${c.text}!important; }
    .cm-tooltip-autocomplete .cm-completionLabel { color:${c.text}!important; }
    .cm-tooltip-autocomplete .cm-completionDetail { color:${c.muted}!important; }
    .cm-tooltip-autocomplete ul { font-family:${editorFont}; }
    .settings-header span { color:${c.muted}; }
    .settings-action,.settings-reset,.welcome-open { border-color:${c.border}; }
  `;
}
