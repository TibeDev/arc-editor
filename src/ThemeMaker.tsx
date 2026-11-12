import { useState, type CSSProperties } from "react";
import { ArrowLeft, FolderOpen, Plus, Save } from "lucide-react";
import TitleBar from "./TitleBar";
import { GLASS_BLUR, themeColorWithOpacity, THEME_COLOR_GROUPS, type AppSettings, type ThemeColors, type ThemeDefinition } from "./settings";
import ThemeColorPicker from "./ThemeColorPicker";
import Select from "./Select";
import "./GithubPanel.css";
import "./PluginPanel.css";
import "./SettingsPanel.css";

const sample = [
  { number: "1", parts: [{ text: "const", color: "keyword" }, { text: " greeting", color: "text" }, { text: " = ", color: "operator" }, { text: "'Hello, Arc!'", color: "string" }, { text: ";", color: "operator" }] },
  { number: "2", parts: [{ text: "", color: "text" }] },
  { number: "3", parts: [{ text: "function", color: "keyword" }, { text: " render", color: "function" }, { text: "(", color: "operator" }, { text: "theme", color: "property" }, { text: ") {", color: "operator" }] },
  { number: "4", parts: [{ text: "  return", color: "keyword" }, { text: " <", color: "operator" }, { text: "Panel", color: "tag" }, { text: " tone", color: "attribute" }, { text: "=", color: "operator" }, { text: "\"calm\"", color: "string" }, { text: " />", color: "operator" }] },
  { number: "5", parts: [{ text: "}", color: "operator" }] },
  { number: "6", parts: [{ text: "", color: "text" }] },
  { number: "7", parts: [{ text: "// Theme preview", color: "comment" }] },
];

export default function ThemeMaker({
  initialTheme,
  themes,
  settings,
  onBack,
  onSave,
  onCreate,
  onOpenFolder,
  errorMessage,
}: {
  initialTheme: ThemeDefinition;
  themes: ThemeDefinition[];
  settings: AppSettings;
  onBack: () => void;
  onSave: (theme: ThemeDefinition) => void;
  onCreate: (theme: ThemeDefinition, name: string) => void;
  onOpenFolder: (theme: ThemeDefinition) => void;
  errorMessage: string;
}) {
  const [theme, setTheme] = useState<ThemeDefinition>(() => ({ ...initialTheme, colors: { ...initialTheme.colors } }));
  const [error, setError] = useState("");
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const glassFill = (color: string, transparency: number) => themeColorWithOpacity(
    color,
    1 - (settings.editorGlassEnabled ? Math.max(0, Math.min(100, transparency)) : 0) / 100,
  );
  const updateColor = (key: keyof ThemeColors, value: string) => setTheme((current) => ({ ...current, colors: { ...current.colors, [key]: value } }));
  const createTheme = () => {
    const name = window.prompt("Name for new theme:")?.trim();
    if (!name) return;
    if (themes.some((entry) => entry.name.trim().toLowerCase() === name.toLowerCase())) {
      setError(`A theme named “${name}” already exists.`);
      return;
    }
    setError("");
    onCreate(theme, name);
  };

  const chrome = initialTheme;
  return <main className={`theme-maker-page ${settings.appTheme === "macos" ? "app-theme-macos" : ""} ${settings.editorGlassEnabled ? "editor-glass-enabled" : ""} ${colorPickerOpen ? "color-picker-open" : ""} ${settings.titleBarEnabled ? "" : "titlebar-off"}`} style={{
    background: glassFill(chrome.colors.background, settings.glassAppTransparency),
    color: chrome.colors.text,
    fontFamily: settings.interfaceFontFamily || undefined,
    "--editor-glass-blur": `${GLASS_BLUR}px`,
    "--glass-app-transparency": `${settings.editorGlassEnabled ? settings.glassAppTransparency : 0}%`,
    "--glass-sidebar-transparency": `${settings.editorGlassEnabled ? settings.glassSidebarTransparency : 0}%`,
    "--glass-controls-transparency": `${settings.editorGlassEnabled ? settings.glassControlsTransparency : 0}%`,
    "--glass-floating-transparency": `${settings.editorGlassEnabled ? settings.glassFloatingTransparency : 0}%`,
    "--glass-controls-surface": glassFill(chrome.colors.raised, settings.glassControlsTransparency),
    "--glass-floating-surface": glassFill(chrome.colors.raised, settings.glassFloatingTransparency),
    "--theme-raised": chrome.colors.raised,
    "--theme-raised-opaque": chrome.colors.raised.slice(0, 7),
    "--theme-border": chrome.colors.border,
    "--theme-text": chrome.colors.text,
    "--theme-secondary": chrome.colors.secondaryText,
    "--theme-muted": chrome.colors.muted,
    "--theme-hover": chrome.colors.hover,
    "--theme-selected": chrome.colors.selected,
    "--settings-muted": chrome.colors.muted,
    "--settings-text": chrome.colors.text,
    "--settings-raised": chrome.colors.raised,
    "--settings-border": chrome.colors.border,
    "--settings-accent": chrome.colors.function,
  } as CSSProperties}>
    {settings.titleBarEnabled && <TitleBar />}
    <div className="theme-maker-body">
    <header className="theme-maker-header" style={{ background: glassFill(chrome.colors.sidebar, settings.glassSidebarTransparency), borderColor: chrome.colors.border }}>
      <button className="settings-close" title="Back to settings" aria-label="Back to settings" onClick={onBack}><ArrowLeft size={16} /></button>
      <div className="theme-maker-actions">
        <label className="theme-maker-select-label"><Select ariaLabel="Theme being edited" value={theme.id} options={themes.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(next) => {
          const selected = themes.find((entry) => entry.id === next);
          if (selected) {
            setTheme({ ...selected, colors: { ...selected.colors } });
            setError("");
          }
        }} /></label>
        <button className="github-secondary plugin-icon-button" title="Open theme folder" aria-label="Open theme folder" onClick={() => onOpenFolder(theme)}><FolderOpen size={15} /></button>
        <button className="github-secondary plugin-icon-button" title="Save theme" aria-label="Save theme" onClick={() => { setError(""); onSave(theme); }}><Save size={15} /></button>
        <button className="github-primary plugin-icon-button" title="Create new theme" aria-label="Create new theme" onClick={createTheme}><Plus size={15} /></button>
      </div>
    </header>
    {(error || errorMessage) && <div className="theme-maker-error" role="alert">{error || errorMessage}</div>}
    <div className="theme-maker-content">
      <aside className="theme-controls" style={{ background: glassFill(chrome.colors.sidebar, settings.glassSidebarTransparency), borderColor: chrome.colors.border }}>
        {THEME_COLOR_GROUPS.map((group) => <section className="theme-color-group" key={group.name}>
          <h2>{group.name}</h2>
          {group.keys.map((key) => <div className="theme-color-row" key={key}>
            <span>{key === "invalidBackground" ? "Invalid background" : key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span>
            <ThemeColorPicker label={key} value={theme.colors[key]} onChange={(value) => updateColor(key, value)} onOpenChange={setColorPickerOpen} />
          </div>)}
        </section>)}
      </aside>
      <section className="theme-preview-area">
        <div className="theme-preview-window" style={{ borderColor: theme.colors.border, background: theme.colors.editor, fontFamily: settings.fontFamily }}>
          <div className="theme-preview-sidebar" style={{ background: theme.colors.sidebar, borderColor: theme.colors.border }}>
            <div className="theme-preview-sidebar-heading" style={{ color: theme.colors.secondaryText }}>EXPLORER</div>
            <div className="theme-preview-tree"><span>⌄</span><span>src</span></div>
            <div className="theme-preview-tree child" style={{ color: theme.colors.secondaryText }}><span>◇</span><span>App.tsx</span></div>
            <div className="theme-preview-tree child selected" style={{ background: theme.colors.selected, color: theme.colors.text }}><span>◈</span><span>theme.ts</span></div>
            <div className="theme-preview-tree"><span>◇</span><span>styles.css</span></div>
          </div>
          <div className="theme-preview-editor">
            <div className="theme-preview-tab" style={{ background: theme.colors.editor, color: theme.colors.text, borderColor: theme.colors.border }}>theme.ts</div>
            <div className="theme-preview-code" style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}>
              {sample.map((line) => <div className="theme-preview-line" key={line.number} style={{ background: line.number === "4" ? theme.colors.activeLine : "transparent" }}>
                <span className="theme-preview-number" style={{ color: theme.colors.lineNumber }}>{line.number}</span>
                <code>{line.parts.map((part, index) => <span key={index} style={{ color: theme.colors[part.color as keyof ThemeColors] }}>{part.text}</span>)}</code>
              </div>)}
              <div className="theme-preview-cursor" style={{ background: theme.colors.cursor }} />
            </div>
            <div className="theme-preview-selection" style={{ background: theme.colors.selection }}>Selection preview</div>
          </div>
        </div>
      </section>
    </div>
    </div>
  </main>;
}
