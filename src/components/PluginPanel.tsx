import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, BookOpen, Check, Download, ExternalLink, FolderOpen, LayoutGrid, List, Plug, Puzzle, RefreshCw, Search, SquareArrowOutUpRight, Trash2, Upload } from "lucide-react";
import { join } from "@tauri-apps/api/path";
import pluginApiMarkdown from "../../PLUGIN_API.md?raw";
import type { InstalledPlugin, PluginPanelContribution } from "../lib/pluginRuntime";
import { compareVersions, fetchPluginIcon, fetchRegistryIndex, type MarketplaceEntry, type MarketplaceIndex } from "../lib/marketplace";
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
  onInstallMarketplace,
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
  onInstallMarketplace: (entry: MarketplaceEntry) => Promise<unknown>;
  onTogglePlugin: (id: string, enabled: boolean) => void;
  onUninstallPlugin: (id: string) => Promise<void>;
  onOpenPanel: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showDocs, setShowDocs] = useState(false);
  const [tab, setTab] = useState<"installed" | "marketplace">("installed");
  const [search, setSearch] = useState("");
  const [marketplace, setMarketplace] = useState<MarketplaceIndex | null>(null);
  const [marketplaceStale, setMarketplaceStale] = useState(false);
  const [marketplaceSavedAt, setMarketplaceSavedAt] = useState<number>();
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState("");
  const [marketplaceBusy, setMarketplaceBusy] = useState<string[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const query = search.trim().toLowerCase();
  const matchesSearch = (fields: string[]) => !query || fields.some((field) => field.toLowerCase().includes(query));
  const visiblePlugins = plugins.filter((plugin) => matchesSearch([plugin.name, plugin.description, plugin.id]));
  const visibleBuiltins = availableBuiltins.filter((plugin) => matchesSearch([plugin.name, plugin.description, plugin.id]));
  const builtinIds = new Set([...plugins.filter((plugin) => plugin.builtin).map((plugin) => plugin.id), ...availableBuiltins.map((plugin) => plugin.id)]);
  const visibleMarketplace = (marketplace?.plugins ?? [])
    .filter((entry) => !builtinIds.has(entry.id))
    .filter((entry) => matchesSearch([entry.name, entry.description, entry.id, entry.author ?? "", ...(entry.tags ?? [])]));
  const updatedLabel = marketplace?.generatedAt
    ? new Date(marketplace.generatedAt).toLocaleString()
    : marketplaceSavedAt
      ? new Date(marketplaceSavedAt).toLocaleString()
      : "";
  const [view, setView] = useState<"list" | "grid">(() => localStorage.getItem("arc.plugins-view") === "grid" ? "grid" : "list");
  const changeView = (next: "list" | "grid") => {
    setView(next);
    localStorage.setItem("arc.plugins-view", next);
  };

  const loadMarketplace = useCallback(async () => {
    setMarketplaceLoading(true);
    setMarketplaceError("");
    try {
      const result = await fetchRegistryIndex();
      setMarketplace(result.index);
      setMarketplaceStale(result.stale);
      setMarketplaceSavedAt(result.savedAt);
    } catch (cause) {
      setMarketplaceError(String(cause));
    } finally {
      setMarketplaceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "marketplace") void loadMarketplace();
  }, [tab, loadMarketplace]);

  useEffect(() => {
    if (!marketplace) return;
    let cancelled = false;
    for (const entry of marketplace.plugins) {
      if (!entry.icon || icons[entry.id]) continue;
      void fetchPluginIcon(entry).then((dataUrl) => {
        if (!cancelled && dataUrl) setIcons((current) => ({ ...current, [entry.id]: dataUrl }));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [marketplace]);

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

  const installMarketplace = async (entry: MarketplaceEntry) => {
    setMarketplaceBusy((current) => [...current, entry.id]);
    setError("");
    try {
      await onInstallMarketplace(entry);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setMarketplaceBusy((current) => current.filter((id) => id !== entry.id));
    }
  };

  const openRepository = async (url: string) => {
    try {
      await openUrl(url);
    } catch (cause) {
      setError(`Could not open repository: ${String(cause)}`);
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

  const viewSwitch = <button className="plugin-view-switch" title={view === "list" ? "Switch to grid view" : "Switch to list view"} aria-label={view === "list" ? "Switch to grid view" : "Switch to list view"} aria-pressed={view === "grid"} onClick={() => changeView(view === "list" ? "grid" : "list")}>
    <span className={view === "list" ? "active" : ""}><List size={14} /></span>
    <span className={view === "grid" ? "active" : ""}><LayoutGrid size={14} /></span>
  </button>;

  const searchField = (placeholder: string) => <label className="plugin-search"><Search size={13} /><input value={search} placeholder={placeholder} aria-label={placeholder} onChange={(event) => setSearch(event.target.value)} /></label>;

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
          <button className="action-button action-button--primary action-button--compact" title="Import plugin ZIP" aria-label="Import plugin ZIP" disabled={busy} onClick={() => void install()}><Upload size={15} /></button>
        </div>
      </>}
    </header>

    {error && <div className="plugin-feedback error">{error}</div>}

    {showDocs ? <main className="plugin-docs-content">
      <article className="plugin-docs-markdown"><Suspense fallback={null}><PluginDocs /></Suspense></article>
    </main> : <section className={`plugin-content plugin-view-${view}`}>
      <div className="plugin-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "installed"} className={`plugin-tab${tab === "installed" ? " active" : ""}`} onClick={() => setTab("installed")}>Installed</button>
        <button role="tab" aria-selected={tab === "marketplace"} className={`plugin-tab${tab === "marketplace" ? " active" : ""}`} onClick={() => setTab("marketplace")}>Marketplace</button>
      </div>

      {tab === "installed" ? <>
        <div className="plugin-section-heading">
          <h2>Plugins</h2><span>{visiblePlugins.length + visibleBuiltins.length}</span>
          <div className="plugin-section-tools">
            {searchField("Search plugins")}
            {viewSwitch}
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
      </> : <>
        <div className="plugin-section-heading">
          <h2>Marketplace</h2><span>{visibleMarketplace.length}</span>
          <div className="plugin-section-tools">
            {updatedLabel && <small className="plugin-marketplace-updated">{marketplaceStale ? "Cached" : "Updated"} {updatedLabel}</small>}
            <button className="action-button action-button--secondary action-button--compact" title="Refresh marketplace" aria-label="Refresh marketplace" disabled={marketplaceLoading} onClick={() => void loadMarketplace()}><RefreshCw size={14} className={marketplaceLoading ? "spin" : ""} /></button>
            {searchField("Search marketplace")}
            {viewSwitch}
          </div>
        </div>
        {marketplaceError && <div className="plugin-feedback error">{marketplaceError}</div>}
        {marketplaceStale && <div className="plugin-feedback plugin-marketplace-stale">Offline — showing the last cached marketplace index.</div>}
        {marketplaceLoading && !marketplace ? <div className="plugin-empty">Loading marketplace…</div> : <div className="plugin-card-list">
          {visibleMarketplace.length ? visibleMarketplace.map((entry) => {
            const installed = plugins.find((plugin) => plugin.id === entry.id);
            const state = !installed ? "install" : compareVersions(installed.version, entry.version) < 0 ? "update" : "installed";
            const entryBusy = marketplaceBusy.includes(entry.id);
            return <article className="plugin-card" key={entry.id}>
              <div className="plugin-card-icon">{icons[entry.id] ? <img src={icons[entry.id]} alt="" /> : <Puzzle size={16} />}</div>
              <div className="plugin-card-details">
                <strong>{entry.name}<small>v{entry.version}</small></strong>
                <span>{entry.description}</span>
                <div className="plugin-marketplace-meta">
                  {entry.author && <small>by {entry.author}</small>}
                  <code>{entry.id}</code>
                  {(entry.tags ?? []).map((tag) => <span className="plugin-tag" key={tag}>{tag}</span>)}
                </div>
              </div>
              <div className="plugin-card-actions">
                {entry.repository?.startsWith("https://github.com/") && <button className="icon-button" title="Open repository" aria-label={`Open ${entry.name} repository`} onClick={() => void openRepository(entry.repository!)}><ExternalLink size={14} /></button>}
                <button className="icon-button" title={entryBusy ? `Installing ${entry.name}` : state === "update" ? `Update ${entry.name}` : state === "installed" ? `${entry.name} is installed` : `Install ${entry.name}`} aria-label={entryBusy ? `Installing ${entry.name}` : state === "update" ? `Update ${entry.name}` : state === "installed" ? `${entry.name} is installed` : `Install ${entry.name}`} disabled={state === "installed" || entryBusy} onClick={() => void installMarketplace(entry)}>
                  {entryBusy ? <RefreshCw size={14} className="spin" /> : state === "update" ? <RefreshCw size={14} /> : state === "installed" ? <Check size={14} /> : <Download size={14} />}
                </button>
              </div>
            </article>;
          }) : <div className="plugin-empty">{query ? `No plugins match "${search.trim()}".` : marketplace ? "No marketplace plugins available." : ""}</div>}
        </div>}
      </>}
    </section>}
  </div>;
}
