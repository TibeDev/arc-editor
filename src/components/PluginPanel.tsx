import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { ArrowLeft, BookOpen, Download, FolderOpen, LayoutGrid, List, Plug, Puzzle, Trash2 } from "lucide-react";
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
  const [view, setView] = useState<"list" | "grid">(() => localStorage.getItem("arc.plugins-view") === "grid" ? "grid" : "list");
  const changeView = (next: "list" | "grid") => {
    setView(next);
    localStorage.setItem("arc.plugins-view", next);
  };
  const listRef = useRef<HTMLDivElement>(null);
  const [listFade, setListFade] = useState(false);
  const updateListFade = () => {
    const list = listRef.current;
    if (!list) return;
    const overflowing = list.scrollHeight > list.clientHeight + 1;
    setListFade(overflowing && list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  };
  useEffect(() => {
    const list = listRef.current;
    updateListFade();
    if (!list) return;
    const observer = new ResizeObserver(updateListFade);
    observer.observe(list);
    window.addEventListener("resize", updateListFade);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateListFade);
    };
  }, [view, plugins.length]);

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
        <h2>Installed plugins</h2><span>{plugins.length}</span>
        <button className="plugin-view-switch" title={view === "list" ? "Switch to grid view" : "Switch to list view"} aria-label={view === "list" ? "Switch to grid view" : "Switch to list view"} aria-pressed={view === "grid"} onClick={() => changeView(view === "list" ? "grid" : "list")}>
          <span className={view === "list" ? "active" : ""}><List size={14} /></span>
          <span className={view === "grid" ? "active" : ""}><LayoutGrid size={14} /></span>
        </button>
      </div>
      <div className={`plugin-list-wrap${listFade ? " has-fade" : ""}`}>
      <div ref={listRef} className="plugin-card-list plugin-installed-list" onScroll={updateListFade}>
      {plugins.length ? plugins.map((plugin) => <article className="plugin-card" key={plugin.id}>
        <div className="plugin-card-icon"><Puzzle size={16} /></div>
        <div className="plugin-card-details"><strong>{plugin.name}<small>{plugin.builtin ? "Built-in" : plugin.version}</small></strong><span>{plugin.description || plugin.id}</span><code>{plugin.id}</code></div>
        <div className="plugin-card-actions">
          <button className={`plugin-toggle-button${plugin.enabled ? " enabled" : ""}`} title={plugin.enabled ? "Disable plugin" : "Enable plugin"} disabled={busy} onClick={() => onTogglePlugin(plugin.id, !plugin.enabled)}>{plugin.enabled ? "Enabled" : "Disabled"}</button>
          <button className="icon-button" title={`Open ${plugin.name} files`} aria-label={`Open ${plugin.name} files`} disabled={!pluginDirectory || busy} onClick={() => void openPluginFiles(plugin.id)}><FolderOpen size={14} /></button>
          <button className="icon-button plugin-uninstall" title={`Uninstall ${plugin.name}`} disabled={busy} onClick={() => void uninstall(plugin)}><Trash2 size={14} /></button>
        </div>
      </article>) : <div className="plugin-empty">No local plugins installed yet.</div>}
      </div>
      </div>

      {availableBuiltins.length > 0 && <>
        <div className="plugin-section-heading"><h2>Included plugins</h2><span>{availableBuiltins.length}</span></div>
        <div className="plugin-card-list">
          {availableBuiltins.map((plugin) => <article className="plugin-card" key={plugin.id}>
            <div className="plugin-card-icon"><Plug size={16} /></div>
            <div className="plugin-card-details"><strong>{plugin.name}<small>Included</small></strong><span>{plugin.description}</span></div>
            <div className="plugin-card-actions"><button className="action-button action-button--secondary" disabled={busy} onClick={() => void installBuiltin(plugin.id)}>Install</button></div>
          </article>)}
        </div>
      </>}

      {panels.length > 0 && <>
        <div className="plugin-section-heading"><h2>Plugin panels</h2><span>{panels.length}</span></div>
        <div className="plugin-card-list">
          {panels.map((panel) => <article className="plugin-card" key={panel.id}>
            <div className="plugin-card-icon"><Puzzle size={16} /></div>
            <div className="plugin-card-details"><strong>{panel.title}</strong><span>Provided by {panel.pluginName}</span></div>
            <div className="plugin-card-actions"><button className="action-button action-button--secondary" onClick={() => onOpenPanel(panel.id)}>Open panel</button></div>
          </article>)}
        </div>
      </>}

    </section>}
  </div>;
}
