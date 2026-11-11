import { lazy, Suspense, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { BookOpen, Download, FolderOpen, Plug, Puzzle, Trash2, X } from "lucide-react";
import { join } from "@tauri-apps/api/path";
import pluginApiMarkdown from "../PLUGIN_API.md?raw";
import type { InstalledPlugin, PluginPanelContribution } from "./pluginRuntime";
import "./GithubPanel.css";
import "./PluginPanel.css";
import "./PluginPanel.folder.css";
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
        <div className="plugin-header-actions"><button className="github-secondary" onClick={downloadApiGuide}><Download size={13} /> Download .md</button><button className="github-secondary" onClick={() => setShowDocs(false)}><X size={14} /> Back to plugins</button></div>
      </> : <>
        <div className="plugin-heading"><Puzzle size={19} /><div><strong>Plugins</strong></div></div>
        <div className="plugin-header-actions"><button className="github-secondary" disabled={!pluginDirectory} onClick={() => void openPluginFolder()}><FolderOpen size={14} /> Plugin folder</button><button className="github-secondary" onClick={() => setShowDocs(true)}><BookOpen size={14} /> API documentation</button><button className="github-primary" disabled={busy} onClick={() => void install()}><Download size={14} /> Install from folder</button></div>
      </>}
    </header>

    {error && <div className="github-feedback error">{error}</div>}

    {showDocs ? <main className="plugin-docs-content">
      <article className="plugin-docs-markdown"><Suspense fallback={null}><PluginDocs /></Suspense></article>
    </main> : <section className="plugin-content">
      <div className="plugin-section-heading"><h2>Installed plugins</h2><span>{plugins.length}</span></div>
      <div className="plugin-installed-list">
      {plugins.length ? plugins.map((plugin) => <article className="plugin-card" key={plugin.id}>
        <div className="plugin-card-icon"><Puzzle size={16} /></div>
        <div className="plugin-card-details"><strong>{plugin.name}<small>{plugin.builtin ? "Built-in" : plugin.version}</small></strong><span>{plugin.description || plugin.id}</span><code>{plugin.id}</code></div>
        <label className="plugin-toggle" title={plugin.enabled ? "Disable plugin" : "Enable plugin"}><input type="checkbox" checked={plugin.enabled} disabled={busy} onChange={(event) => onTogglePlugin(plugin.id, event.target.checked)} /><span>{plugin.enabled ? "Enabled" : "Disabled"}</span></label>
        <button className="github-icon-button" title={`Open ${plugin.name} files`} aria-label={`Open ${plugin.name} files`} disabled={!pluginDirectory || busy} onClick={() => void openPluginFiles(plugin.id)}><FolderOpen size={14} /></button>
        <button className="github-icon-button plugin-uninstall" title={`Uninstall ${plugin.name}`} disabled={busy} onClick={() => void uninstall(plugin)}><Trash2 size={14} /></button>
      </article>) : <div className="plugin-empty">No local plugins installed yet.</div>}
      </div>

      {availableBuiltins.length > 0 && <>
        <div className="plugin-section-heading"><h2>Included plugins</h2><span>{availableBuiltins.length}</span></div>
        {availableBuiltins.map((plugin) => <article className="plugin-card" key={plugin.id}>
          <div className="plugin-card-icon"><Plug size={16} /></div>
          <div className="plugin-card-details"><strong>{plugin.name}<small>Included</small></strong><span>{plugin.description}</span></div>
          <button className="github-secondary" disabled={busy} onClick={() => void installBuiltin(plugin.id)}>Install</button>
        </article>)}
      </>}

      {panels.length > 0 && <>
        <div className="plugin-section-heading"><h2>Plugin panels</h2><span>{panels.length}</span></div>
        {panels.map((panel) => <article className="plugin-card" key={panel.id}>
          <div className="plugin-card-icon"><Puzzle size={16} /></div>
          <div className="plugin-card-details"><strong>{panel.title}</strong><span>Provided by {panel.pluginName}</span></div>
          <button className="github-secondary" onClick={() => onOpenPanel(panel.id)}>Open panel</button>
        </article>)}
      </>}

    </section>}
  </div>;
}
