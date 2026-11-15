import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  Palette,
  Puzzle,
  Settings2,
  Sparkles,
  Terminal,
  WandSparkles,
} from "lucide-react";
import Select from "./Select";
import ThemeColorPicker from "./ThemeColorPicker";
import {
  AGENT_LABELS,
  agentCommand,
  launchPrompt,
} from "../lib/agent/kit";
import {
  PLUGIN_NEEDS,
  PLUGIN_SURFACES,
  THEME_BASES,
  THEME_SEED_KEYS,
  artifactPath,
  emptyPluginAnswers,
  emptyThemeAnswers,
  pluginBrief,
  slug,
  themeBrief,
  themeSeed,
  type BuilderTarget,
  type PluginAnswers,
  type ThemeAnswers,
} from "../lib/agent/builders";
import type { AppSettings, ThemeColors } from "../lib/settings";
import "../styles/controls.css";
import "./SettingsPanel.css";
import "./BuildWizard.css";

export type BuilderLaunch = {
  target: BuilderTarget;
  id: string;
  brief: string;
  output: string;
};

const COLOR_LABELS: Partial<Record<keyof ThemeColors, string>> = {
  background: "Window background",
  editor: "Editor background",
  text: "Body text",
  function: "Accent",
  keyword: "Keywords",
  string: "Strings",
};

export default function BuildWizard({
  settings,
  onLaunch,
  onOpenSettings,
}: {
  settings: AppSettings;
  onLaunch: (launch: BuilderLaunch) => Promise<void> | void;
  onOpenSettings: () => void;
}) {
  const [target, setTarget] = useState<BuilderTarget | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [plugin, setPlugin] = useState<PluginAnswers>(emptyPluginAnswers);
  const [theme, setTheme] = useState<ThemeAnswers>(emptyThemeAnswers);
  const [briefDraft, setBriefDraft] = useState("");
  const [error, setError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  const name = target === "plugin" ? plugin.name : theme.name;
  const id = useMemo(() => slug(name || target || "item"), [name, target]);
  const output = target ? artifactPath(target, id) : "";

  const commandPreview = useMemo(() => {
    if (!target) return "";
    try {
      return agentCommand(settings.agentCli, settings.agentCommand, launchPrompt(target));
    } catch {
      return "";
    }
  }, [settings.agentCli, settings.agentCommand, target]);
  const agentReady = settings.agentCli !== "custom" || Boolean(settings.agentCommand.trim());

  const updatePlugin = (patch: Partial<PluginAnswers>) => {
    setPlugin((current) => ({ ...current, ...patch }));
    setLaunched(false);
  };
  const updateTheme = (patch: Partial<ThemeAnswers>) => {
    setTheme((current) => ({ ...current, ...patch }));
    setLaunched(false);
  };
  const toggleList = (key: "surfaces" | "needs", value: string) => {
    setPlugin((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((entry) => entry !== value)
        : [...current[key], value],
    }));
    setLaunched(false);
  };

  const chooseTarget = (next: BuilderTarget) => {
    setTarget(next);
    setStep(2);
    setError("");
    setLaunched(false);
  };

  const goReview = () => {
    if (!target) return;
    if (!name.trim()) {
      setError("Give it a name first.");
      return;
    }
    if (target === "plugin" && !plugin.purpose.trim()) {
      setError("Describe what the plugin should do.");
      return;
    }
    if (target === "theme" && !theme.mood.trim()) {
      setError("Describe how the theme should feel.");
      return;
    }
    setError("");
    setBriefDraft(
      target === "plugin" ? pluginBrief(plugin, id) : themeBrief(theme, id),
    );
    setLaunched(false);
    setStep(3);
  };

  const launch = async () => {
    if (!target) return;
    setLaunching(true);
    setError("");
    try {
      await onLaunch({
        target,
        id,
        brief: briefDraft,
        output: artifactPath(target, id),
      });
      setLaunched(true);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="bw-root">
      <header className="bw-header">
        <div className="bw-title">
          <Sparkles size={15} />
          <span>Build for Arc</span>
        </div>
        <div className="bw-agent">
          <Terminal size={13} />
          <span>{AGENT_LABELS[settings.agentCli]}</span>
          <button className="bw-link" onClick={onOpenSettings} title="Change default terminal agent">
            <Settings2 size={13} />
            Change
          </button>
        </div>
      </header>

      <div className="bw-scroll settings-scroll">
        <div className="bw-inner">
          {step === 1 && (
            <>
              <div className="bw-intro">
                <h1>What do you want to make?</h1>
                <p>Answer a few questions. Arc writes a build brief, gives your agent the Arc documentation, and opens it in a terminal.</p>
              </div>
              <div className="bw-targets">
                <button className="bw-target" onClick={() => chooseTarget("plugin")}>
                  <Puzzle size={22} />
                  <strong>Plugin</strong>
                  <span>Add a command, panel, toolbar action, or background integration.</span>
                </button>
                <button className="bw-target" onClick={() => chooseTarget("theme")}>
                  <Palette size={22} />
                  <strong>Theme</strong>
                  <span>Build an editor color theme from a mood and a few seed colors.</span>
                </button>
              </div>
            </>
          )}

          {step === 2 && target === "plugin" && (
            <>
              <div className="bw-step-head">
                <div>
                  <span className="bw-eyebrow">Plugin</span>
                  <h1>What should it do?</h1>
                </div>
                <button className="bw-secondary" onClick={() => setStep(1)}>Change target</button>
              </div>

              <div className="bw-grid-2">
                <label className="bw-field">
                  <span>Name</span>
                  <input
                    value={plugin.name}
                    onChange={(event) => updatePlugin({ name: event.target.value })}
                    placeholder="Live CSS Preview"
                    autoFocus
                  />
                  <small>ID: {id}</small>
                </label>
                <label className="bw-field">
                  <span>One-line purpose</span>
                  <input
                    value={plugin.purpose}
                    onChange={(event) => updatePlugin({ purpose: event.target.value })}
                    placeholder="Preview the current file in a local browser."
                  />
                </label>
              </div>

              <label className="bw-field">
                <span>What should it do?</span>
                <textarea
                  value={plugin.behavior}
                  onChange={(event) => updatePlugin({ behavior: event.target.value })}
                  rows={4}
                  placeholder="Describe the behavior, inputs, outputs, and what happens on errors."
                />
              </label>

              <fieldset className="bw-choice-group">
                <legend>Where should it appear?</legend>
                <div className="bw-chips">
                  {PLUGIN_SURFACES.map((surface) => (
                    <button
                      type="button"
                      key={surface.id}
                      className={`bw-chip ${plugin.surfaces.includes(surface.id) ? "active" : ""}`}
                      aria-pressed={plugin.surfaces.includes(surface.id)}
                      onClick={() => toggleList("surfaces", surface.id)}
                    >
                      {surface.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="bw-choice-group">
                <legend>What does it need access to?</legend>
                <div className="bw-chips">
                  {PLUGIN_NEEDS.map((need) => (
                    <button
                      type="button"
                      key={need.id}
                      className={`bw-chip ${plugin.needs.includes(need.id) ? "active" : ""}`}
                      aria-pressed={plugin.needs.includes(need.id)}
                      onClick={() => toggleList("needs", need.id)}
                    >
                      {need.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {plugin.surfaces.includes("panel") && (
                <label className="bw-field">
                  <span>Panel layout</span>
                  <textarea
                    value={plugin.panelDetails}
                    onChange={(event) => updatePlugin({ panelDetails: event.target.value })}
                    rows={2}
                    placeholder="What appears in the editor panel? Buttons, lists, inputs?"
                  />
                </label>
              )}

              {(plugin.needs.includes("terminal") || plugin.needs.includes("process")) && (
                <label className="bw-field">
                  <span>Commands to run</span>
                  <input
                    value={plugin.commands}
                    onChange={(event) => updatePlugin({ commands: event.target.value })}
                    placeholder="npm run dev"
                  />
                </label>
              )}

              {plugin.needs.includes("network") && (
                <label className="bw-field">
                  <span>Network service</span>
                  <input
                    value={plugin.networkUrl}
                    onChange={(event) => updatePlugin({ networkUrl: event.target.value })}
                    placeholder="https://api.example.com or localhost:3000"
                  />
                </label>
              )}

              {plugin.needs.includes("files") && (
                <label className="bw-field">
                  <span>Files or paths</span>
                  <input
                    value={plugin.files}
                    onChange={(event) => updatePlugin({ files: event.target.value })}
                    placeholder="src/, package.json, the active file"
                  />
                </label>
              )}

              <div className="bw-grid-2">
                <label className="bw-field">
                  <span>Acceptance criteria</span>
                  <textarea
                    value={plugin.acceptance}
                    onChange={(event) => updatePlugin({ acceptance: event.target.value })}
                    rows={3}
                    placeholder="How do we know it works?"
                  />
                </label>
                <label className="bw-field">
                  <span>Example workflow (optional)</span>
                  <textarea
                    value={plugin.example}
                    onChange={(event) => updatePlugin({ example: event.target.value })}
                    rows={3}
                    placeholder="User opens a file, clicks the action, then..."
                  />
                </label>
              </div>
            </>
          )}

          {step === 2 && target === "theme" && (
            <>
              <div className="bw-step-head">
                <div>
                  <span className="bw-eyebrow">Theme</span>
                  <h1>How should it feel?</h1>
                </div>
                <button className="bw-secondary" onClick={() => setStep(1)}>Change target</button>
              </div>

              <div className="bw-grid-2">
                <label className="bw-field">
                  <span>Name</span>
                  <input
                    value={theme.name}
                    onChange={(event) => updateTheme({ name: event.target.value })}
                    placeholder="Copper Dusk"
                    autoFocus
                  />
                  <small>ID: {id}</small>
                </label>
                <label className="bw-field">
                  <span>Mode</span>
                  <Select
                    ariaLabel="Theme mode"
                    value={theme.mode}
                    onChange={(next) => updateTheme({ mode: next as ThemeAnswers["mode"] })}
                    options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
                  />
                </label>
              </div>

              <label className="bw-field">
                <span>Mood and feel</span>
                <textarea
                  value={theme.mood}
                  onChange={(event) => updateTheme({ mood: event.target.value })}
                  rows={3}
                  placeholder="Warm, low-contrast, calm. Copper accents instead of blue. Easy on the eyes at night."
                />
              </label>

              <div className="bw-grid-2">
                <label className="bw-field">
                  <span>Start from</span>
                  <Select
                    ariaLabel="Base theme"
                    value={theme.base}
                    onChange={(next) => {
                      setTheme((current) => ({ ...current, base: next, colors: themeSeed(next) }));
                      setLaunched(false);
                    }}
                    options={THEME_BASES.map((base) => ({ value: base.id, label: base.label }))}
                  />
                </label>
                <div className="bw-note">
                  Seed colors prefill from the base. The agent derives the remaining slots.
                </div>
              </div>

              <fieldset className="bw-choice-group">
                <legend>Seed colors</legend>
                <button type="button" className="bw-secondary bw-auto-colors" onClick={() => {
                  setTheme((current) => ({ ...current, autoColors: true }));
                  setLaunched(false);
                }}>
                  <WandSparkles size={13} />
                  Choose for me
                </button>
                {theme.autoColors && (
                  <div className="bw-note bw-auto-note">
                    The agent will choose the palette from the mood, mode, and base inspiration. Pick any color to override.
                  </div>
                )}
                <div className="bw-color-grid">
                  {THEME_SEED_KEYS.map((key) => (
                    <div className="bw-color-row" key={key}>
                      <span>{COLOR_LABELS[key] ?? key}</span>
                      <code>{theme.colors[key]}</code>
                      <ThemeColorPicker
                        label={COLOR_LABELS[key] ?? key}
                        value={theme.colors[key]}
                        onChange={(value) => {
                          setTheme((current) => ({
                            ...current,
                            autoColors: false,
                            colors: { ...current.colors, [key]: value },
                          }));
                          setLaunched(false);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>

              <label className="bw-field">
                <span>Extra notes (optional)</span>
                <textarea
                  value={theme.notes}
                  onChange={(event) => updateTheme({ notes: event.target.value })}
                  rows={2}
                  placeholder="Keep comments muted. Avoid pure white text. Accent should work for selection."
                />
              </label>
            </>
          )}

          {step === 3 && target && (
            <>
              <div className="bw-step-head">
                <div>
                  <span className="bw-eyebrow">Review</span>
                  <h1>Build brief</h1>
                </div>
                <button className="bw-secondary" onClick={() => setStep(2)}>Edit answers</button>
              </div>

              <div className="bw-summary">
                <div><span>Target</span><strong>{target === "plugin" ? "Plugin" : "Theme"}</strong></div>
                <div><span>Name</span><strong>{name.trim()}</strong></div>
                <div><span>Output</span><code>Arc Builds/{target}-{id}/{output}</code></div>
                <div><span>Agent</span><strong>{AGENT_LABELS[settings.agentCli]}</strong></div>
              </div>

              <label className="bw-field">
                <span>Brief sent to the agent</span>
                <textarea
                  className="bw-brief"
                  value={briefDraft}
                  onChange={(event) => setBriefDraft(event.target.value)}
                  rows={18}
                  spellCheck={false}
                />
              </label>

              <div className="bw-launch-note">
                <Terminal size={14} />
                <div>
                  <strong>Launch opens a terminal in a separate build folder.</strong>
                  <span>The agent works in Arc Builds inside your home directory, not this workspace. It validates the artifact, then asks before installing.</span>
                </div>
              </div>

              {commandPreview && <code className="bw-command">{commandPreview}</code>}
              {!agentReady && <div className="bw-error">Set a custom agent command in Settings first.</div>}
              {launched && (
                <div className="bw-success">
                  <Check size={14} />
                  <span>Agent launched. Answer its install question in the terminal tab. Switch back here to launch again.</span>
                </div>
              )}
            </>
          )}

          {error && <div className="bw-error" role="alert">{error}</div>}

          <div className="bw-actions">
            {step === 2 && (
              <>
                <button className="bw-secondary" onClick={() => setStep(1)}>
                  <ArrowLeft size={14} /> Back
                </button>
                <button className="bw-primary" onClick={goReview}>
                  Review brief <ArrowRight size={14} />
                </button>
              </>
            )}
            {step === 3 && (
              <>
                <button className="bw-secondary" onClick={() => setStep(2)}>
                  <ArrowLeft size={14} /> Back
                </button>
                <button className="bw-primary" disabled={!agentReady || launching} onClick={() => void launch()}>
                  {launching ? <LoaderCircle size={14} className="bw-spin" /> : <Terminal size={14} />}
                  {launched ? "Launch again" : "Launch agent"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
