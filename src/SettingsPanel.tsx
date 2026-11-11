import { RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SETTINGS, DEFAULT_THEME, type AppSettings, type ThemeDefinition } from "./settings";
import type { PluginConfigurationContribution, PluginConfigurationProperty } from "./pluginRuntime";
import ThemeColorPicker from "./ThemeColorPicker";
import "./SettingsPanel.css";

const settingsCategories = [
  { id: "editor", label: "Editor", description: "Formatting and editing behavior." },
  { id: "typography", label: "Fonts & Typography", description: "Choose typefaces and tune reading density." },
  { id: "appearance", label: "Appearance", description: "Transparency, interface style, and color themes." },
  { id: "terminal", label: "Terminal", description: "Cursor and scrollback behavior." },
  { id: "files", label: "Files", description: "Workspace browsing preferences." },
  { id: "plugins", label: "Plugins", description: "Settings contributed by installed plugins." },
] as const;

type SettingsCategory = typeof settingsCategories[number]["id"];
type FontOption = { label: string; value: string };

const interfaceFonts: FontOption[] = [
  { label: "Theme default", value: "" },
  { label: "System UI", value: "system-ui, sans-serif" },
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Roboto", value: "Roboto, sans-serif" },
  { label: "Noto Sans", value: "'Noto Sans', sans-serif" },
  { label: "Open Sans", value: "'Open Sans', sans-serif" },
  { label: "Lato", value: "Lato, sans-serif" },
  { label: "Ubuntu", value: "Ubuntu, sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI', sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
];

const editorFonts: FontOption[] = [
  { label: "JetBrains Mono", value: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace" },
  { label: "Fira Code", value: "'Fira Code', monospace" },
  { label: "Cascadia Code", value: "'Cascadia Code', monospace" },
  { label: "IBM Plex Mono", value: "'IBM Plex Mono', monospace" },
  { label: "Source Code Pro", value: "'Source Code Pro', monospace" },
  { label: "Iosevka", value: "Iosevka, monospace" },
  { label: "Inconsolata", value: "Inconsolata, monospace" },
  { label: "Hack", value: "Hack, monospace" },
  { label: "Ubuntu Mono", value: "'Ubuntu Mono', monospace" },
  { label: "SF Mono", value: "'SFMono-Regular', Consolas, monospace" },
  { label: "Menlo", value: "Menlo, monospace" },
  { label: "Consolas", value: "Consolas, monospace" },
  { label: "System monospace", value: "ui-monospace, monospace" },
];

const terminalFonts: FontOption[] = [
  { label: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  ...editorFonts.slice(1),
];

function fontNameFromStack(stack: string) {
  const value = stack.trim();
  const quote = value[0];
  if (quote !== "'" && quote !== '"') return value.split(",")[0].trim();
  let name = "";
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === "\\" && index + 1 < value.length) {
      name += value[index + 1];
      index += 1;
    } else if (value[index] === quote) {
      return name;
    } else {
      name += value[index];
    }
  }
  return name;
}

function fontStackFromName(name: string, fallback: string) {
  const safeName = name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80);
  if (!safeName.trim()) return "";
  return `"${safeName.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}", ${fallback}`;
}

const genericFonts = new Set(["system-ui", "ui-monospace", "sans-serif", "serif", "monospace"]);
const fontAvailability = new Map<string, boolean>();

function isFontAvailable(stack: string) {
  const family = fontNameFromStack(stack);
  if (genericFonts.has(family.toLowerCase())) return true;
  const cached = fontAvailability.get(family);
  if (cached !== undefined) return cached;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;
  const samples = ["mmmmmmmmmmlliWW", "0123456789", "Arc Editor"];
  const fallbackWidths = samples.map((sample) => ["monospace", "serif", "sans-serif"].map((fallback) => {
    context.font = `72px ${fallback}`;
    return context.measureText(sample).width;
  }));
  const available = samples.some((sample, index) => {
    context.font = `72px ${JSON.stringify(family)}, monospace`;
    const width = context.measureText(sample).width;
    return !fallbackWidths[index].includes(width);
  });
  fontAvailability.set(family, available);
  return available;
}

function FontFamilySetting({ label, value, options, fallback, onChange }: {
  label: string;
  value: string;
  options: FontOption[];
  fallback: string;
  onChange: (value: string) => void;
}) {
  const preset = options.find((option) => option.value === value);
  const customName = preset ? "" : fontNameFromStack(value);
  const [customDraft, setCustomDraft] = useState(customName);
  useEffect(() => setCustomDraft(customName), [value]);
  return <>
    <label className="setting-field"><span>{label} preset</span><select value={preset ? value : "__custom"} onChange={(event) => {
      const selected = options.find((option) => option.value === event.target.value);
      if (selected) onChange(selected.value);
    }}>
      {!preset && <option value="__custom" disabled>Custom font name below</option>}
      {options.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
    </select></label>
    <label className="setting-field"><span>Custom {label.toLowerCase()} family</span><input className="font-family-input" type="text" value={customDraft} placeholder="Enter installed font name" onChange={(event) => {
      setCustomDraft(event.target.value);
      if (event.target.value.trim()) onChange(fontStackFromName(event.target.value, fallback));
    }} onBlur={() => {
      if (!customDraft.trim() && !preset) onChange(options[0]?.value ?? fallback);
    }} /></label>
    <div className="font-preview" style={{ fontFamily: value || undefined }}>Aa Bb Cc 0123</div>
  </>;
}

function PluginConfigField({ id, label, property, value, onChange }: {
  id: string;
  label: string;
  property: PluginConfigurationProperty;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState(() => typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : String(value ?? ""));
  const [error, setError] = useState("");
  useEffect(() => {
    if (property.type !== "object" && property.type !== "array") return;
    setDraft(typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : String(value ?? ""));
  }, [property.type, value]);
  if (property.enum?.length) {
    const selected = property.enum.find((option) => option === value) ?? value;
    return <label className="setting-field"><span>{label}</span><select value={String(selected ?? "")} onChange={(event) => {
      const option = property.enum?.find((entry) => String(entry) === event.target.value);
      onChange(option);
    }}>
      {property.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
    </select>{property.description && <small>{property.description}</small>}</label>;
  }
  if (property.type === "boolean") {
    return <label className="setting-toggle"><span><strong>{label}</strong>{property.description && <small>{property.description}</small>}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /></label>;
  }
  if (property.type === "number" || property.type === "integer") {
    return <label className="setting-field"><span>{label}</span><input type="number" value={typeof value === "number" ? value : 0} min={property.minimum} max={property.maximum} onChange={(event) => {
      const parsed = Number(event.target.value);
      onChange(Number.isFinite(parsed) ? (property.type === "integer" ? Math.trunc(parsed) : parsed) : 0);
    }} />{property.description && <small>{property.description}</small>}</label>;
  }
  if (property.type === "object" || property.type === "array") {
    return <label className="setting-field"><span>{label}</span><textarea id={id} value={draft} spellCheck={false} onChange={(event) => {
      setDraft(event.target.value);
      try {
        onChange(JSON.parse(event.target.value));
        setError("");
      } catch {
        setError("Enter valid JSON.");
      }
    }} />{property.description && <small>{property.description}</small>}{error && <small className="setting-error">{error}</small>}</label>;
  }
  return <label className="setting-field"><span>{label}</span><input id={id} type="text" value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)} onChange={(event) => onChange(event.target.value)} />{property.description && <small>{property.description}</small>}</label>;
}

export default function SettingsPanel({
  settings,
  themes,
  onChange,
  onClose,
  onOpenThemeMaker,
  customThemeIds,
  onDeleteTheme,
  pluginConfigurations,
  getPluginConfigValue,
  onUpdatePluginConfig,
}: {
  settings: AppSettings;
  themes: ThemeDefinition[];
  onChange: (settings: Partial<AppSettings>) => void;
  onClose: () => void;
  onOpenThemeMaker: () => void;
  customThemeIds: Set<string>;
  onDeleteTheme: (id: string) => void;
  pluginConfigurations?: PluginConfigurationContribution[];
  getPluginConfigValue?: (pluginId: string, key: string, fallback?: unknown) => unknown;
  onUpdatePluginConfig?: (pluginId: string, key: string, value: unknown, scope?: "global" | "workspace") => void;
}) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("editor");
  const [themeSearch, setThemeSearch] = useState("");
  const availableFonts = useMemo(() => ({
    interface: interfaceFonts.filter((option) => !option.value || isFontAvailable(option.value)),
    editor: editorFonts.filter((option) => isFontAvailable(option.value)),
    terminal: terminalFonts.filter((option) => isFontAvailable(option.value)),
  }), []);
  const filteredThemes = useMemo(() => themes.filter((theme) => theme.name.toLowerCase().includes(themeSearch.toLowerCase())), [themeSearch, themes]);
  const selectedTheme = themes.find((theme) => theme.id === settings.selectedTheme) ?? DEFAULT_THEME;
  const terminalSelectionColor = settings.terminalSelectionColor || selectedTheme.colors.selection.slice(0, 7);
  const transparency = (key: "glassAppTransparency" | "glassSidebarTransparency" | "editorGlassTransparency" | "glassTabsTransparency" | "glassTerminalTransparency" | "glassFloatingTransparency" | "glassSettingsTransparency" | "glassControlsTransparency", label: string) => <label className="setting-field" key={key}>
    <span>{label} <b>{settings[key]}%</b></span>
    <input type="range" min="0" max="100" step="1" value={settings[key]} onChange={(event) => onChange({ [key]: Number(event.target.value) })} />
  </label>;
  const toggle = (key: keyof AppSettings, label: string, description: string) => <label className="setting-toggle" key={key}>
    <span><strong>{label}</strong><small>{description}</small></span>
    <input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => onChange({ [key]: event.target.checked })} />
  </label>;

  const selectedCategory = settingsCategories.find((category) => category.id === activeCategory)!;

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header"><div><h2 id="settings-title">Settings</h2><span>Arc preferences</span></div><button className="tool-button" aria-label="Close settings" onClick={onClose}><X size={15} /></button></header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings categories">
          <div className="settings-nav-list">
            {settingsCategories.map((category) => {
              return <button key={category.id} className="settings-nav-button" aria-current={activeCategory === category.id ? "page" : undefined} onClick={() => setActiveCategory(category.id)}>
                <span>{category.label}</span>
              </button>;
            })}
          </div>
          <button className="settings-reset" title="Reset all settings" onClick={() => onChange({ ...DEFAULT_SETTINGS })}><RotateCcw size={13} /> Reset all settings</button>
        </nav>
        <section className="settings-main" aria-labelledby="settings-category-title">
          <header className="settings-page-heading"><h3 id="settings-category-title">{selectedCategory.label}</h3><p>{selectedCategory.description}</p></header>
          <div className="settings-scroll" key={activeCategory}>
            {activeCategory === "editor" && <>
              <section className="settings-section"><h3>Formatting</h3>
                {toggle("prettierOnSave", "Format on save", "Run Prettier when saving supported files.")}
                <div className="setting-note">Format current file: <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd></div>
              </section>
              <section className="settings-section"><h3>Editing</h3>
                {toggle("lineNumbers", "Line numbers", "Show line numbers beside code.")}
                {toggle("indentGuides", "Indent guides", "Show vertical guides for indented code.")}
                {toggle("activeLine", "Highlight active line", "Highlight line under the caret.")}
                {toggle("wordWrap", "Word wrap", "Wrap long lines to editor width.")}
                {toggle("autoCloseBrackets", "Auto-close brackets", "Insert matching brackets and quotes.")}
                {toggle("bracketMatching", "Bracket matching", "Highlight matching brackets.")}
                {toggle("autocomplete", "Autocomplete", "Show code completion suggestions.")}
                {toggle("autoIndent", "Auto indent", "Indent new lines based on surrounding code.")}
                <label className="setting-field"><span>Tab size</span><select value={settings.tabSize} onChange={(event) => onChange({ tabSize: Number(event.target.value) })}><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option></select></label>
              </section>
            </>}
            {activeCategory === "typography" && <>
              <section className="settings-section"><h3>App interface</h3>
                <FontFamilySetting label="Interface font" value={settings.interfaceFontFamily} options={availableFonts.interface} fallback="sans-serif" onChange={(interfaceFontFamily) => onChange({ interfaceFontFamily })} />
                <div className="setting-note">Custom font names must be installed on your system. Theme default follows Classic or Modern app styling.</div>
              </section>
              <section className="settings-section"><h3>Code editor</h3>
                <FontFamilySetting label="Editor font" value={settings.fontFamily} options={availableFonts.editor} fallback="monospace" onChange={(fontFamily) => onChange({ fontFamily })} />
                <label className="setting-field"><span>Font size <b>{settings.fontSize}px</b></span><input type="range" min="10" max="24" step="1" value={settings.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })} /></label>
                <label className="setting-field"><span>Line height <b>{settings.lineHeight.toFixed(1)}</b></span><input type="range" min="1.2" max="2.2" step="0.1" value={settings.lineHeight} onChange={(event) => onChange({ lineHeight: Number(event.target.value) })} /></label>
              </section>
              <section className="settings-section"><h3>Terminal</h3>
                <FontFamilySetting label="Terminal font" value={settings.terminalFontFamily} options={availableFonts.terminal} fallback="monospace" onChange={(terminalFontFamily) => onChange({ terminalFontFamily })} />
                <label className="setting-field"><span>Font size <b>{settings.terminalFontSize}px</b></span><input type="range" min="10" max="24" step="1" value={settings.terminalFontSize} onChange={(event) => onChange({ terminalFontSize: Number(event.target.value) })} /></label>
              </section>
            </>}
            {activeCategory === "appearance" && <>
              <section className="settings-section"><h3>Interface</h3>
                <label className="setting-field"><span>App theme</span><select value={settings.appTheme} onChange={(event) => onChange({ appTheme: event.target.value as AppSettings["appTheme"] })}>
                  <option value="classic">Classic</option>
                  <option value="macos">Modern</option>
                </select></label>
                <div className="setting-note">App style and editor color theme are independent.</div>
                {toggle("titleBarEnabled", "Custom title bar", "Use Arc's title bar. Turn off to use the system window frame.")}
              </section>
              <section className="settings-section"><h3>Editor colors</h3>
                <label className="theme-search"><Search size={13} /><input value={themeSearch} onChange={(event) => setThemeSearch(event.target.value)} placeholder="Search color themes" /></label>
                <div className="theme-list" role="list" aria-label="Editor color themes">
                  {filteredThemes.map((theme) => <div className={`theme-choice ${settings.selectedTheme === theme.id ? "active" : ""}`} key={theme.id} role="listitem">
                    <button aria-pressed={settings.selectedTheme === theme.id} onClick={() => onChange({ selectedTheme: theme.id })}>
                      <span className="theme-choice-name">{theme.name}<small>{customThemeIds.has(theme.id) ? "Custom" : "Built-in"}</small></span>
                      <span className="theme-swatches" aria-hidden="true">{[theme.colors.background, theme.colors.keyword, theme.colors.string, theme.colors.function].map((color, index) => <i key={index} style={{ background: color }} />)}</span>
                    </button>
                    {customThemeIds.has(theme.id) && <button className="theme-remove" title={`Remove ${theme.name}`} aria-label={`Remove ${theme.name}`} onClick={() => onDeleteTheme(theme.id)}><Trash2 size={13} /></button>}
                  </div>)}
                  {!filteredThemes.length && <div className="theme-list-empty">No matching themes.</div>}
                </div>
                <button className="settings-action" onClick={onOpenThemeMaker}>Open Theme Maker</button>
              </section>
              <section className="settings-section"><h3>Transparency and blur</h3>
                {toggle("editorGlassEnabled", "Transparency", "Apply transparency across app surfaces.")}
                {settings.editorGlassEnabled && <>
                  {toggle("nativeBackgroundBlurEnabled", "Blur desktop background", "Use native OS blur when supported. Linux X11 is unsupported; system controls strength.")}
                  {transparency("glassAppTransparency", "Window background")}
                  {transparency("glassSidebarTransparency", "File viewer")}
                  {transparency("editorGlassTransparency", "Editor")}
                  {transparency("glassTabsTransparency", "Tabs and toolbars")}
                  {transparency("glassTerminalTransparency", "Terminal")}
                  {transparency("glassFloatingTransparency", "Menus and popovers")}
                  {transparency("glassSettingsTransparency", "Settings panel")}
                  {transparency("glassControlsTransparency", "Inputs and controls")}
                </>}
              </section>
            </>}
            {activeCategory === "terminal" && <section className="settings-section"><h3>Terminal</h3>
              <label className="setting-field"><span>Cursor shape</span><select value={settings.terminalCursorStyle} onChange={(event) => onChange({ terminalCursorStyle: event.target.value as AppSettings["terminalCursorStyle"] })}>
                <option value="block">Block</option><option value="underline">Underline</option><option value="bar">Bar</option>
              </select></label>
              {toggle("terminalCursorBlink", "Blinking cursor", "Blink the terminal cursor.")}
              {toggle("terminalScrollbar", "Show scrollbar", "Show the terminal's scrollback scrollbar.")}
              {toggle("terminalShowTitle", "Show shell title", "Use the title reported by the running shell in its tab.")}
              <label className="setting-field"><span>Scrollback lines <b>{settings.terminalScrollback}</b></span><input type="range" min="500" max="5000" step="500" value={settings.terminalScrollback} onChange={(event) => onChange({ terminalScrollback: Number(event.target.value) })} /></label>
              <label className="setting-field"><span>Padding <b>{settings.terminalPadding}px</b></span><input type="range" min="0" max="24" step="2" value={settings.terminalPadding} onChange={(event) => onChange({ terminalPadding: Number(event.target.value) })} /></label>
              <label className="setting-field"><span>Selection color</span><ThemeColorPicker label="Selection color" value={terminalSelectionColor} onChange={(value) => onChange({ terminalSelectionColor: value })} /></label>
              {settings.terminalSelectionColor && <button className="settings-action" onClick={() => onChange({ terminalSelectionColor: "" })}>Use theme selection color</button>}
            </section>}
            {activeCategory === "files" && <section className="settings-section"><h3>File viewer</h3>
              {toggle("showHiddenFiles", "Show hidden files", "Include dotfiles and hidden folders in workspace tree.")}
              {toggle("restoreTerminals", "Reopen terminals", "Recreate previous terminal tabs when reopening a folder (commands are re-run).")}
            </section>}
            {activeCategory === "plugins" && <>
              {(!pluginConfigurations || pluginConfigurations.length === 0) && <section className="settings-section"><h3>Plugin settings</h3><p>No installed plugin contributes settings.</p></section>}
              {pluginConfigurations?.map((contribution) => <section className="settings-section" key={contribution.id}>
                <h3>{contribution.title}</h3>
                <p>{contribution.pluginName}</p>
                {Object.entries(contribution.properties).map(([key, property]) => <PluginConfigField
                  key={key}
                  id={`${contribution.id}-${key}`}
                  label={key}
                  property={property}
                  value={getPluginConfigValue?.(contribution.pluginId, key, property.default) ?? property.default}
                  onChange={(value) => onUpdatePluginConfig?.(contribution.pluginId, key, value, property.scope)}
                />)}
              </section>)}
            </>}
          </div>
        </section>
      </div>
    </aside>
  </div>;
}
