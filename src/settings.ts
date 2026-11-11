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
  appTheme: "classic" | "macos";
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
};

export const APP_SETTINGS_VERSION = 1;

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
  terminalFontFamily: "'JetBrains Mono', monospace",
  terminalFontSize: 12,
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  terminalScrollback: 1000,
  terminalPadding: 8,
  terminalScrollbar: true,
  terminalSelectionColor: "",
  terminalShowTitle: true,
  interfaceFontFamily: "",
  fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
  fontSize: 13,
  lineHeight: 1.7,
  tabSize: 2,
  zoomLevel: 1,
  selectedTheme: "midnight",
  appTheme: "classic",
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
};

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
  },
};

export const BUILTIN_THEMES: ThemeDefinition[] = [
  DEFAULT_THEME,
  {
    id: "paper",
    name: "Paper",
    colors: {
      background: "#f5f3ee", sidebar: "#ebe8e0", editor: "#f8f6f0", raised: "#e5e1d8",
      border: "#d5d0c5", text: "#34342f", secondaryText: "#5e5d56", muted: "#88867d",
      selected: "#dcd8ce", hover: "#e5e1d8", lineNumber: "#99958a", activeLine: "#00000008",
      cursor: "#292923", selection: "#a9c6e880", indentGuide: "#d2cec3", keyword: "#8b3fa3",
      control: "#b13d47", string: "#477c39", number: "#a45b1d", function: "#276c9c",
      type: "#936c16", property: "#a45b1d", tag: "#b13d47", attribute: "#477c39",
      comment: "#89867d", operator: "#55544e", meta: "#287e82", invalid: "#ffffff",
      invalidBackground: "#b13d47",
    },
  },
  {
    id: "ocean",
    name: "Deep Ocean",
    colors: {
      background: "#101a24", sidebar: "#14212d", editor: "#101a24", raised: "#1a2b39",
      border: "#263b4a", text: "#d4e2ec", secondaryText: "#a0b8c9", muted: "#6f899b",
      selected: "#243746", hover: "#1b2c39", lineNumber: "#7890a0", activeLine: "#8bc8ed0c",
      cursor: "#c5efff", selection: "#3078a480", indentGuide: "#294255", keyword: "#d38cff",
      control: "#ff7d8c", string: "#a8d783", number: "#ffb86c", function: "#65c6ff",
      type: "#ffd479", property: "#83d4c3", tag: "#ff7d8c", attribute: "#a8d783",
      comment: "#6c8495", operator: "#abc2d1", meta: "#51d1d7", invalid: "#ffffff",
      invalidBackground: "#d64b62",
    },
  },
];

export const THEME_COLOR_GROUPS: { name: string; keys: (keyof ThemeColors)[] }[] = [
  { name: "Interface", keys: ["background", "sidebar", "editor", "raised", "border", "text", "secondaryText", "muted", "selected", "hover"] },
  { name: "Editor", keys: ["lineNumber", "activeLine", "cursor", "selection", "indentGuide"] },
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
    const stored = JSON.parse(localStorage.getItem("arc.settings") ?? "null") as (Partial<AppSettings> & { version?: number; editorGlassSaturation?: unknown }) | null;
    if (!stored) return DEFAULT_SETTINGS;
    const saved = { ...stored };
    delete saved.editorGlassSaturation;
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    // Previous default made the entire app background fully transparent.
    if (stored.version !== APP_SETTINGS_VERSION && stored.glassAppTransparency === 100) {
      settings.glassAppTransparency = DEFAULT_SETTINGS.glassAppTransparency;
    }
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function isThemeDefinition(value: unknown): value is ThemeDefinition {
  if (!value || typeof value !== "object") return false;
  const theme = value as Partial<ThemeDefinition>;
  return typeof theme.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(theme.id)
    && typeof theme.name === "string" && Boolean(theme.colors)
    && Object.keys(DEFAULT_THEME.colors).every((key) => {
      const color = (theme.colors as Record<string, unknown>)[key];
      return typeof color === "string" && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color);
    });
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
  const settingsBackground = glass(c.background, settings.glassSettingsTransparency);
  const controlsBackground = glass(c.raised, settings.glassControlsTransparency);
  const overlayAlpha = settings.editorGlassEnabled
    ? 0.5 * (1 - transparency(settings.glassFloatingTransparency) / 100)
    : 0.55;
  const macOverlayAlpha = settings.editorGlassEnabled
    ? 0.18 * (1 - transparency(settings.glassFloatingTransparency) / 100)
    : 0.18;
  return `
    .app-shell { --settings-muted:${c.muted}; --settings-text:${c.text}; --settings-raised:${c.raised}; --settings-border:${c.border}; --settings-accent:${c.function}; --settings-track:${c.hover}; --editor-glass-blur:${GLASS_BLUR}px; --glass-app-transparency:${transparency(settings.glassAppTransparency)}%; --glass-sidebar-transparency:${transparency(settings.glassSidebarTransparency)}%; --glass-tabs-transparency:${transparency(settings.glassTabsTransparency)}%; --glass-terminal-transparency:${transparency(settings.glassTerminalTransparency)}%; --glass-floating-transparency:${transparency(settings.glassFloatingTransparency)}%; --glass-settings-transparency:${transparency(settings.glassSettingsTransparency)}%; --glass-controls-transparency:${transparency(settings.glassControlsTransparency)}%; --glass-overlay-alpha:${overlayAlpha}; --glass-macos-overlay-alpha:${macOverlayAlpha}; background:${appBackground}; color:${c.text}; }
    .settings-backdrop,.modal-backdrop { background:rgba(0,0,0,${overlayAlpha}); }
    .file-viewer { background:${sidebarBackground}; border-color:${c.border}; }
    .terminal-stack,.terminal-host,.terminal-view { background:${terminalBackground}; }
    .viewer-heading,.breadcrumbs,.tab-strip,.editor-tab,.tree-create-row,.search-row,.confirm-dialog,.context-menu,.split-divider { border-color:${c.border}; }
    .viewer-heading,.breadcrumbs,.empty-hint,.tree-row,.workspace-header,.welcome-shortcuts>div { color:${c.secondaryText}; }
    .workspace-open,.search-row,.tab-close,.save-button,.show-viewer { color:${c.muted}; }
    .workspace-row,.tree-row:hover { background:${glass(c.hover, settings.glassSidebarTransparency)}; }
    .tool-button:hover,.tool-button.selected,.editor-tab:hover,.save-button:hover,.welcome-open:hover { background:${glass(c.hover, settings.glassControlsTransparency)}; }
    .context-menu button:hover { background:${glass(c.hover, settings.glassFloatingTransparency)}; }
    .editor-tab .tab-close:hover { background:${glass(c.hover, settings.glassTabsTransparency)}; }
    .split-divider:hover,.split-divider:active { background:${glass(c.selected, settings.glassTabsTransparency)}; }
    .tree-row.selected { background:${glass(c.selected, settings.glassSidebarTransparency)}; color:${c.text}; }
    .tool-button.selected { background:${glass(c.selected, settings.glassControlsTransparency)}; color:${c.text}; }
    .editor-pane { background:${editorBackground}; color:${c.text}; }
    .editor-tab.active { background:${tabsBackground}; color:${c.text}; }
    .welcome-screen { background:${appBackground}; color:${c.text}; }
    .tab-strip,.editor-tab { background:${tabsBackground}; }
    .context-menu,.confirm-dialog { background:${floatingBackground}; }
    .settings-panel,.settings-header { background:${settingsBackground}; }
    .split-divider { background:${tabsBackground}; }
    .editor-tab { color:${c.secondaryText}; }
    .editor-tab.active,.tab-name,.welcome-name,.confirm-dialog,.context-menu button,.settings-panel { color:${c.text}; }
    .settings-section,.settings-header,.tree-create-row,.search-row,.workspace-row { border-color:${c.border}; }
    .settings-section h3,.setting-toggle strong,.setting-field>span { color:${c.secondaryText}; }
    .settings-field select,.setting-field select,.theme-maker-select-label select,.settings-action,.settings-reset,.welcome-open,.confirm-actions button { background-color:${controlsBackground}; border-color:${c.border}; color:${c.text}; }
    .setting-field select option,.theme-maker-select-label select option { background:${c.raised}; color:${c.text}; }
    .setting-field input[type=color] { background:${controlsBackground}; border-color:${c.border}; }
    .setting-toggle input,.setting-field input[type=range],.theme-picker-channel input { accent-color:${c.function}; }
    .setting-toggle input { background:${glass(c.hover, settings.glassControlsTransparency)}; border-color:${c.border}; }
    .setting-toggle input:checked { background:${glass(c.function, settings.glassControlsTransparency)}; border-color:${c.function}; }
    .setting-field input[type=range] { background:${glass(c.border, settings.glassControlsTransparency)}; }
    .setting-field input[type=range]::-webkit-slider-thumb { background:${c.function}; border-color:${c.text}; }
    .setting-field input[type=range]::-moz-range-thumb { background:${c.function}; border-color:${c.text}; }
    .theme-search,.theme-choice,.theme-choice button,.theme-list-empty { border-color:${c.border}; color:${c.secondaryText}; }
    .theme-search { background:${controlsBackground}; }
    .theme-search input { color:${c.text}; }
    .theme-choice.active,.theme-choice.active>button { background:${glass(c.selected, settings.glassControlsTransparency)}; color:${c.text}; }
    .theme-choice:hover,.theme-choice button:hover,.theme-remove:hover { background:${glass(c.hover, settings.glassControlsTransparency)}; color:${c.text}; }
    .theme-remove { color:${c.muted}; }
    .context-menu,.confirm-dialog { border:1px solid ${c.border}; }
    .context-menu kbd,.context-menu button kbd,.setting-note,.setting-toggle small { color:${c.muted}; }
    .menu-divider { background:${c.border}; }
    .workspace-header svg,.tool-button,.save-button,.tab-close { color:${c.muted}; }
    .tree-row.selected,.editor-tab.active { color:${c.text}; }
    .editor-tab,.tab-strip { background:${tabsBackground}; }
    .welcome-open { border:1px solid ${c.border}; }
    .welcome-shortcuts kbd { background:${controlsBackground}; border-color:${c.border}; color:${c.secondaryText}; }
    .rename-row input,.tree-create-row input,.search-row input { color:${c.text}; }
    .rename-row input { background:${controlsBackground}; border-color:${c.border}; }
    .tree-create-row { background:${glass(c.raised, settings.glassSidebarTransparency)}; border-color:${c.border}; }
    .editor-pane.drop-target { outline-color:${c.secondaryText}; background:${editorBackground}; }
    .breadcrumbs { border-color:${c.border}; }
    .theme-choice-name small { color:${c.muted}; }
    .settings-launch { color:${c.muted}; }
    .settings-launch:hover { color:${c.text}; }
    .editor-root,.editor-layout,.editor-empty { background:${appBackground}; color:${c.secondaryText}; }
    .cm-editor { background:${editorBackground}!important; color:${c.text}!important; }
    .cm-scroller { font-family:${settings.fontFamily}; font-size:${settings.fontSize}px; line-height:${settings.lineHeight}; tab-size:${settings.tabSize}; }
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
    .cm-tooltip-autocomplete ul { font-family:${settings.fontFamily}; }
    .xterm,.xterm-viewport,.xterm-screen { background-color:${editorBackground}!important; }
    .settings-header,.settings-panel { border-color:${c.border}; }
    .settings-header span,.theme-maker-title span { color:${c.muted}; }
    .setting-field select,.theme-maker-select-label select,.settings-action,.settings-reset,.welcome-open,.confirm-actions button { border-color:${c.border}; }
  `;
}
