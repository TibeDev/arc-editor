import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  FolderOpen,
  Layers,
  LayoutPanelTop,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Moon,
  Network,
  Palette,
  PanelRight,
  PlugZap,
  Puzzle,
  Rocket,
  Settings2,
  Sparkles,
  StickyNote,
  Sun,
  SwatchBook,
  Terminal,
  Type,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import ThemeColorPicker from "./ThemeColorPicker";
import {
  AGENT_LABELS,
  freeAiPrompt,
  freeAiPromptFile,
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
  background: "Window",
  editor: "Editor",
  text: "Body text",
  function: "Accent",
  keyword: "Keywords",
  string: "Strings",
};

type QuestionId =
  | "target"
  | "name"
  | "purpose"
  | "behavior"
  | "surfaces"
  | "needs"
  | "panelDetails"
  | "commands"
  | "networkUrl"
  | "files"
  | "acceptance"
  | "mode"
  | "mood"
  | "base"
  | "colors"
  | "notes"
  | "review";

const META: Record<QuestionId, { icon: LucideIcon; title: string }> = {
  target: { icon: Sparkles, title: "What do you want to make?" },
  name: { icon: Type, title: "Name it" },
  purpose: { icon: MessageSquareText, title: "What does it do in one line?" },
  behavior: { icon: AlignLeft, title: "Describe the behavior" },
  surfaces: { icon: LayoutPanelTop, title: "Where should it appear?" },
  needs: { icon: PlugZap, title: "What does it need?" },
  panelDetails: { icon: PanelRight, title: "Describe the panel" },
  commands: { icon: Terminal, title: "Which commands should it run?" },
  networkUrl: { icon: Network, title: "Which network service?" },
  files: { icon: FolderOpen, title: "Which files does it touch?" },
  acceptance: { icon: ListChecks, title: "How do we know it works?" },
  mode: { icon: Moon, title: "Dark or light?" },
  mood: { icon: Palette, title: "How should it feel?" },
  base: { icon: Layers, title: "Start from a base" },
  colors: { icon: SwatchBook, title: "Pick seed colors" },
  notes: { icon: StickyNote, title: "Anything else?" },
  review: { icon: Rocket, title: "Review and launch" },
};

const MODES = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
] as const;

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
  const [step, setStep] = useState(0);
  const [plugin, setPlugin] = useState<PluginAnswers>(emptyPluginAnswers);
  const [theme, setTheme] = useState<ThemeAnswers>(emptyThemeAnswers);
  const [briefDraft, setBriefDraft] = useState("");
  const [error, setError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const savingPromptRef = useRef(false);

  const name = target === "plugin" ? plugin.name : theme.name;
  const id = useMemo(() => slug(name || target || "item"), [name, target]);
  const output = target ? artifactPath(target, id) : "";

  const agentReady = settings.agentCli !== "custom" || Boolean(settings.agentCommand.trim());

  const questions = useMemo<QuestionId[]>(() => {
    const list: QuestionId[] = ["target"];
    if (!target) return list;
    if (target === "theme") {
      return [...list, "name", "mode", "mood", "base", "colors", "notes", "review"];
    }
    list.push("name", "purpose", "behavior", "surfaces", "needs");
    if (plugin.surfaces.includes("panel")) list.push("panelDetails");
    if (plugin.needs.includes("terminal") || plugin.needs.includes("process")) list.push("commands");
    if (plugin.needs.includes("network")) list.push("networkUrl");
    if (plugin.needs.includes("files")) list.push("files");
    list.push("acceptance", "review");
    return list;
  }, [target, plugin.surfaces, plugin.needs]);

  const index = Math.min(step, questions.length - 1);
  const current = questions[index];

  useEffect(() => {
    setStep((value) => Math.min(value, questions.length - 1));
  }, [questions.length]);

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
      needsAuto: key === "needs" ? false : current.needsAuto,
      [key]: current[key].includes(value)
        ? current[key].filter((entry) => entry !== value)
        : [...current[key], value],
    }));
    setLaunched(false);
  };

  const chooseTarget = (next: BuilderTarget) => {
    setTarget(next);
    setError("");
    setLaunched(false);
    setStep(1);
  };

  const validate = (question: QuestionId): string => {
    if (question === "name" && !name.trim()) return "Name is required.";
    if (question === "purpose" && !plugin.purpose.trim()) return "Purpose is required.";
    if (question === "mood" && !theme.mood.trim()) return "Mood is required.";
    return "";
  };

  const goNext = () => {
    if (index >= questions.length - 1) return;
    const failure = validate(current);
    if (failure) {
      setError(failure);
      return;
    }
    setError("");
    const nextIndex = index + 1;
    if (questions[nextIndex] === "review" && target) {
      setBriefDraft(
        target === "plugin" ? pluginBrief(plugin, id) : themeBrief(theme, id),
      );
    }
    setStep(nextIndex);
  };

  const goBack = () => {
    if (index === 1) {
      setTarget(null);
      setPlugin(emptyPluginAnswers());
      setTheme(emptyThemeAnswers());
      setBriefDraft("");
      setLaunched(false);
      setError("");
      setStep(0);
      return;
    }
    setError("");
    setStep(Math.max(0, index - 1));
  };

  const copyFreePrompt = async () => {
    if (!target) return;
    const prompt = freeAiPrompt(target, briefDraft);
    try {
      await writeText(prompt);
    } catch {
      try {
        await navigator.clipboard.writeText(prompt);
      } catch (cause) {
        setError(String(cause));
        return;
      }
    }
    setCopiedPrompt(true);
    window.setTimeout(() => setCopiedPrompt(false), 1800);
  };

  const saveFreePrompt = async () => {
    if (!target || savingPromptRef.current) return;
    savingPromptRef.current = true;
    setSavingPrompt(true);
    const content = freeAiPrompt(target, briefDraft);
    const fileName = freeAiPromptFile(target, id);
    try {
      const path = await invoke<string | null>("save_builder_prompt", {
        fileName,
        content,
      });
      if (path) {
        setSavedPrompt(true);
        window.setTimeout(() => setSavedPrompt(false), 1800);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      savingPromptRef.current = false;
      setSavingPrompt(false);
    }
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

  const renderQuestion = (question: QuestionId) => {
    switch (question) {
      case "target":
        return (
          <div className="bw-options bw-options-target">
            <button className="bw-option bw-target" onClick={() => chooseTarget("plugin")}>
              <Puzzle size={20} />
              <strong>Plugin</strong>
            </button>
            <button className="bw-option bw-target" onClick={() => chooseTarget("theme")}>
              <Palette size={20} />
              <strong>Theme</strong>
            </button>
          </div>
        );
      case "name":
        return (
          <input
            className="bw-input bw-input-large"
            value={name}
            onChange={(event) =>
              target === "plugin"
                ? updatePlugin({ name: event.target.value })
                : updateTheme({ name: event.target.value })
            }
            placeholder={target === "plugin" ? "Live CSS Preview" : "Copper Dusk"}
            autoFocus
          />
        );
      case "purpose":
        return (
          <input
            className="bw-input bw-input-large"
            value={plugin.purpose}
            onChange={(event) => updatePlugin({ purpose: event.target.value })}
            placeholder="Preview the current file in a local browser."
          />
        );
      case "behavior":
        return (
          <textarea
            className="bw-input"
            value={plugin.behavior}
            onChange={(event) => updatePlugin({ behavior: event.target.value })}
            rows={7}
            placeholder="Behavior, inputs, outputs, and what happens on errors."
          />
        );
      case "surfaces":
        return (
          <div className="bw-list">
            <div className="bw-options">
              {PLUGIN_SURFACES.map((surface) => {
                const active = plugin.surfaces.includes(surface.id);
                return (
                  <button
                    type="button"
                    key={surface.id}
                    className={`bw-option${active ? " active" : ""}`}
                    aria-pressed={active}
                    onClick={() => toggleList("surfaces", surface.id)}
                  >
                    <span>{surface.label}</span>
                    {active && <Check size={15} />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case "needs":
        return (
          <div className="bw-stack">
            <div className="bw-list">
              <div className={`bw-options${plugin.needsAuto ? " bw-disabled" : ""}`}>
                {PLUGIN_NEEDS.map((need) => {
                  const active = plugin.needs.includes(need.id);
                  return (
                    <button
                      type="button"
                      key={need.id}
                      className={`bw-option${active ? " active" : ""}`}
                      aria-pressed={active}
                      disabled={plugin.needsAuto}
                      onClick={() => toggleList("needs", need.id)}
                    >
                      <span>{need.label}</span>
                      {active && <Check size={15} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              className={`bw-btn bw-btn-ghost${plugin.needsAuto ? " active" : ""}`}
              onClick={() => {
                setPlugin((current) =>
                  current.needsAuto
                    ? { ...current, needsAuto: false }
                    : { ...current, needs: [], needsAuto: true },
                );
                setLaunched(false);
              }}
            >
              <WandSparkles size={14} />
              I don't know, choose for me
              {plugin.needsAuto && <Check size={14} />}
            </button>
          </div>
        );
      case "panelDetails":
        return (
          <textarea
            className="bw-input"
            value={plugin.panelDetails}
            onChange={(event) => updatePlugin({ panelDetails: event.target.value })}
            rows={5}
            placeholder="Buttons, lists, inputs."
          />
        );
      case "commands":
        return (
          <input
            className="bw-input bw-input-large"
            value={plugin.commands}
            onChange={(event) => updatePlugin({ commands: event.target.value })}
            placeholder="npm run dev"
          />
        );
      case "networkUrl":
        return (
          <input
            className="bw-input bw-input-large"
            value={plugin.networkUrl}
            onChange={(event) => updatePlugin({ networkUrl: event.target.value })}
            placeholder="https://api.example.com"
          />
        );
      case "files":
        return (
          <input
            className="bw-input bw-input-large"
            value={plugin.files}
            onChange={(event) => updatePlugin({ files: event.target.value })}
            placeholder="src/, package.json, the active file"
          />
        );
      case "acceptance":
        return (
          <textarea
            className="bw-input"
            value={plugin.acceptance}
            onChange={(event) => updatePlugin({ acceptance: event.target.value })}
            rows={5}
            placeholder="How do we know it works?"
          />
        );
      case "mode":
        return (
          <div className="bw-options bw-options-target">
            {MODES.map(({ value, label, icon: Icon }) => {
              const active = theme.mode === value;
              return (
                <button
                  type="button"
                  key={value}
                  className={`bw-option bw-target${active ? " active" : ""}`}
                  aria-pressed={active}
                  onClick={() => updateTheme({ mode: value })}
                >
                  <Icon size={20} />
                  <strong>{label}</strong>
                  {active && <Check size={15} />}
                </button>
              );
            })}
          </div>
        );
      case "mood":
        return (
          <textarea
            className="bw-input"
            value={theme.mood}
            onChange={(event) => updateTheme({ mood: event.target.value })}
            rows={5}
            placeholder="Warm, low-contrast, calm. Copper accents at night."
          />
        );
      case "base":
        return (
          <div className="bw-list">
            <div className="bw-options">
              {THEME_BASES.map((base) => {
                const active = theme.base === base.id;
                const seed = themeSeed(base.id);
                return (
                  <button
                    type="button"
                    key={base.id}
                    className={`bw-option${active ? " active" : ""}`}
                    aria-pressed={active}
                    onClick={() => {
                      setTheme((current) => ({
                        ...current,
                        base: base.id,
                        colors: themeSeed(base.id),
                      }));
                      setLaunched(false);
                    }}
                  >
                    <span className="bw-swatches">
                      <i style={{ background: seed.background }} />
                      <i style={{ background: seed.function }} />
                    </span>
                    <span>{base.label}</span>
                    {active && <Check size={15} />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case "colors":
        return (
          <div className="bw-stack">
            <div className={`bw-colors${theme.autoColors ? " bw-disabled" : ""}`}>
              {THEME_SEED_KEYS.map((key) => (
                <div className="bw-color" key={key}>
                  <span>{COLOR_LABELS[key] ?? key}</span>
                  <code>{theme.colors[key]}</code>
                  <ThemeColorPicker
                    label={COLOR_LABELS[key] ?? key}
                    value={theme.colors[key]}
                    disabled={theme.autoColors}
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
            <button
              type="button"
              className={`bw-btn bw-btn-ghost${theme.autoColors ? " active" : ""}`}
              onClick={() => {
                setTheme((current) => ({ ...current, autoColors: !current.autoColors }));
                setLaunched(false);
              }}
            >
              <WandSparkles size={14} />
              Choose for me
              {theme.autoColors && <Check size={14} />}
            </button>
          </div>
        );
      case "notes":
        return (
          <textarea
            className="bw-input"
            value={theme.notes}
            onChange={(event) => updateTheme({ notes: event.target.value })}
            rows={5}
            placeholder="Avoid pure white text. Accent should work for selection."
          />
        );
      case "review":
        return (
          <div className="bw-review">
            <div className="bw-review-grid">
              <div>
                {target === "plugin" ? <Puzzle size={15} /> : <Palette size={15} />}
                <span>{target === "plugin" ? "Plugin" : "Theme"}</span>
              </div>
              <div>
                <Type size={15} />
                <span>{name.trim()}</span>
              </div>
              <div>
                <FolderOpen size={15} />
                <code>{output}</code>
              </div>
              <div>
                <Terminal size={15} />
                <span>{AGENT_LABELS[settings.agentCli]}</span>
              </div>
            </div>
            <textarea
              className="bw-input bw-brief"
              value={briefDraft}
              onChange={(event) => setBriefDraft(event.target.value)}
              rows={14}
              spellCheck={false}
            />
            <div className="bw-free-actions">
              <button
                type="button"
                className="bw-btn bw-btn-secondary"
                title="Copy the brief and Arc docs for any free chat AI"
                onClick={() => void copyFreePrompt()}
              >
                <Copy size={14} />
                {copiedPrompt ? "Copied" : "Copy for any AI"}
              </button>
              <button
                type="button"
                className="bw-btn bw-btn-secondary"
                title="Save a self-contained prompt file"
                disabled={savingPrompt}
                onClick={() => void saveFreePrompt()}
              >
                <Download size={14} />
                {savedPrompt ? "Saved" : "Save prompt"}
              </button>
            </div>
            {!agentReady && (
              <div className="bw-error">Set a custom agent command in Settings first.</div>
            )}
            {launched && (
              <div className="bw-success">
                <Check size={15} />
                <span>Agent launched.</span>
              </div>
            )}
          </div>
        );
    }
  };

  const MetaIcon = META[current].icon;

  return (
    <div className="bw-root">
      <header className="bw-header">
        <Sparkles size={14} />
        <span>Build</span>
        <span className="bw-dot">·</span>
        <Terminal size={13} />
        <span>{AGENT_LABELS[settings.agentCli]}</span>
        <button
          className="bw-icon"
          onClick={onOpenSettings}
          title="Change default terminal agent"
          aria-label="Change default terminal agent"
        >
          <Settings2 size={14} />
        </button>
      </header>

      <div className="bw-scroll">
        <div
          key={current}
          className={`bw-question${current === "review" ? " review" : ""}`}
        >
          <div className="bw-qhead">
            <MetaIcon size={18} />
            <h1>{META[current].title}</h1>
          </div>
          {renderQuestion(current)}
          {error && <div className="bw-error" role="alert">{error}</div>}
        </div>
      </div>

      <footer className="bw-footer">
        <div className="bw-progress">
          <i style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
        </div>
        <div className="bw-nav-slot">
          {index > 0 && (
            <button className="bw-btn bw-btn-secondary" onClick={goBack}>
              <ArrowLeft size={14} />
              Back
            </button>
          )}
        </div>
        <span className="bw-count">{index + 1} / {questions.length}</span>
        <div className="bw-nav-slot end">
          {current === "review" ? (
            <button
              className="bw-btn bw-btn-primary"
              disabled={!agentReady || launching}
              onClick={() => void launch()}
            >
              {launching ? <LoaderCircle size={14} className="bw-spin" /> : <Rocket size={14} />}
              {launched ? "Launch again" : "Launch"}
            </button>
          ) : current !== "target" ? (
            <button className="bw-btn bw-btn-primary" onClick={goNext}>
              Next
              <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
