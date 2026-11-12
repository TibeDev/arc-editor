import { lazy, Suspense, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { ArrowLeft, BookOpen, Download, FolderOpen, LayoutGrid, List, Plug, Puzzle, Search, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { join } from "@tauri-apps/api/path";
import pluginApiMarkdown from "../../PLUGIN_API.md?raw";
import type { InstalledPlugin, PluginPanelContribution } from "../lib/pluginRuntime";
import "../styles/controls.css";
import "./PluginPanel.css";
import "./PluginPanel.docs.css";

const PluginDocs = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);
  return {
    default: () => (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{pluginApiMarkdown}</ReactMarkdown>
    ),
  };
});

export default function PluginPanel({
  plugins,
  pluginDirectory,
  availableBuiltins,
  panels,
  onInstallPlugin,
  onInstallBuiltin,
  onTogglePlugin,
  onUninstallPlugin,
  onOpenPanel,
}: {
  plugins: InstalledPlugin[];
  pluginDirectory: string;
  availableBuiltins: { id: string; name: string; version: string; description: string; main: "main.js" }[];
  panels: PluginPanelContribution[];
  onInstallPlugin: () => Promise<void>;
  onInstallBuiltin: (id: string) => Promise<void>;
  onTogglePlugin: (id: string, enabled: boolean) => void;
  onUninstallPlugin: (id: string) => Promise<void>;
  onOpenPanel: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showDocs, setShowDocs] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matchesSearch = (fields: string[]) => !query || fields.some((field) => field.toLowerCase().includes(query));
  const visiblePlugins = plugins.filter((plugin) => matchesSearch([plugin.name, plugin.description, plugin.id]));
  const visibleBuiltins = availableBuiltins.filter((plugin) => matchesSearch([plugin.name, plugin.description, plugin.id]));
  const [view, setView] = useState<"list" | "grid">(() => localStorage.getItem("arc.plugins-view") === "grid" ? "grid" : "list");
  const changeView = (next: "list" | "grid") => {
    setView(next);
    localStorage.setItem("arc.plugins-view", next);
  };

  const install = async () => {
    setBusy(true);
    setError("");
    try {
      await onInstallPlugin();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async (plugin: InstalledPlugin) => {
    if (!window.confirm(`Uninstall ${plugin.name}?`)) return;
    setBusy(true);
    setError("");
    try {
      await onUninstallPlugin(plugin.id);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const installBuiltin = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await onInstallBuiltin(id);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const openPluginFolder = async () => {
    try {
      if (pluginDirectory) await openPath(pluginDirectory);
    } catch (cause) {
      setError(`Could not open plugin folder: ${String(cause)}`);
    }
  };

  const openPluginFiles = async (pluginId: string) => {
    try {
      if (pluginDirectory) await openPath(await join(pluginDirectory, pluginId));
    } catch (cause) {
      setError(`Could not open plugin files: ${String(cause)}`);
    }
  };

  const downloadApiGuide = () => {
    const url = URL.createObjectURL(new Blob([pluginApiMarkdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "arc-plugin-api.md";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="plugin-panel">
    <header className="plugin-header">
      {showDocs ? <>
        <div className="plugin-heading"><BookOpen size={17} /><div><strong>Plugin API documentation</strong></div></div>
        <div className="plugin-header-actions"><button className="action-button action-button--secondary action-button--compact" title="Download API guide" aria-label="Download API guide" onClick={downloadApiGuide}><Download size={15} /></button><button className="action-button action-button--secondary action-button--compact" title="Back to plugins" aria-label="Back to plugins" onClick={() => setShowDocs(false)}><ArrowLeft size={15} /></button></div>
      </> : <>
        <div className="plugin-heading"><Puzzle size={19} /><div><strong>Plugins</strong></div></div>
        <div className="plugin-header-actions">
          <button className="action-button action-button--secondary action-button--compact" title="Plugin folder" aria-label="Open plugin folder" disabled={!pluginDirectory} onClick={() => void openPluginFolder()}><FolderOpen size={15} /></button>
          <button className="action-button action-button--secondary action-button--compact" title="API documentation" aria-label="Open API documentation" onClick={() => setShowDocs(true)}><BookOpen size={15} /></button>
          <button className="action-button action-button--primary action-button--compact" title="Install from folder" aria-label="Install plugin from folder" disabled={busy} onClick={() => void install()}><Download size={15} /></button>
        </div>
      </>}
    </header>

    {error && <div className="plugin-feedback error">{error}</div>}

    {showDocs ? <main className="plugin-docs-content">
      <article className="plugin-docs-markdown"><Suspense fallback={null}><PluginDocs /></Suspense></article>
    </main> : <section className={`plugin-content plugin-view-${view}`}>
      <div className="plugin-section-heading">
        <h2>Plugins</h2><span>{visiblePlugins.length + visibleBuiltins.length}</span>
        <div className="plugin-section-tools">
          <label className="plugin-search"><Search size={13} /><input value={search} placeholder="Search plugins" aria-label="Search plugins" onChange={(event) => setSearch(event.target.value)} /></label>
          <button className="plugin-view-switch" title={view === "list" ? "Switch to grid view" : "Switch to list view"} aria-label={view === "list" ? "Switch to grid view" : "Switch to list view"} aria-pressed={view === "grid"} onClick={() => changeView(view === "list" ? "grid" : "list")}>
            <span className={view === "list" ? "active" : ""}><List size={14} /></span>
            <span className={view === "grid" ? "active" : ""}><LayoutGrid size={14} /></span>
          </button>
        </div>
      </div>
      <div className="plugin-card-list">
      {visiblePlugins.length || visibleBuiltins.length ? <>
        {visiblePlugins.map((plugin) => {
          const panel = panels.find((candidate) => candidate.pluginId === plugin.id);
          return <article className="plugin-card" key={plugin.id}>
            <div className="plugin-card-icon"><Puzzle size={16} /></div>
            <div className="plugin-card-details"><strong>{plugin.name}<small>{plugin.builtin ? "Built-in" : plugin.version}</small></strong><span>{plugin.description || plugin.id}</span><code>{plugin.id}</code></div>
            <div className="plugin-card-actions">
              {panel && <button className="icon-button" title={`Open ${panel.title} panel`} aria-label={`Open ${panel.title} panel`} onClick={() => onOpenPanel(panel.id)}><SquareArrowOutUpRight size={14} /></button>}
              <button className={`plugin-toggle-button${plugin.enabled ? " enabled" : ""}`} title={plugin.enabled ? "Disable plugin" : "Enable plugin"} disabled={busy} onClick={() => onTogglePlugin(plugin.id, !plugin.enabled)}>{plugin.enabled ? "Enabled" : "Disabled"}</button>
              <button className="icon-button" title={`Open ${plugin.name} files`} aria-label={`Open ${plugin.name} files`} disabled={!pluginDirectory || busy} onClick={() => void openPluginFiles(plugin.id)}><FolderOpen size={14} /></button>
              <button className="icon-button plugin-uninstall" title={`Uninstall ${plugin.name}`} disabled={busy} onClick={() => void uninstall(plugin)}><Trash2 size={14} /></button>
            </div>
          </article>;
        })}
        {visibleBuiltins.map((plugin) => <article className="plugin-card" key={plugin.id}>
          <div className="plugin-card-icon"><Plug size={16} /></div>
          <div className="plugin-card-details"><strong>{plugin.name}<small>Included</small></strong><span>{plugin.description}</span></div>
          <div className="plugin-card-actions"><button className="action-button action-button--secondary" disabled={busy} onClick={() => void installBuiltin(plugin.id)}>Install</button></div>
        </article>)}
      </> : <div className="plugin-empty">{query ? `No plugins match "${search.trim()}".` : "No plugins installed yet."}</div>}
      </div>
    </section>}
  </div>;
}
