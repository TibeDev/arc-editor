import { BUILTIN_THEMES, DEFAULT_THEME, type ThemeColors } from "../settings";

export type BuilderTarget = "plugin" | "theme";

export const PLUGIN_SURFACES = [
  { id: "toolbar", label: "Toolbar action" },
  { id: "panel", label: "Editor panel" },
  { id: "status", label: "Status bar item" },
  { id: "command", label: "Command palette" },
  { id: "context-menu", label: "File context menu" },
  { id: "background", label: "Background only" },
] as const;

export const PLUGIN_NEEDS = [
  { id: "files", label: "Read or edit workspace files" },
  { id: "editor", label: "Read or change the active editor" },
  { id: "terminal", label: "Run commands in a terminal" },
  { id: "process", label: "Start and stop processes" },
  { id: "network", label: "Call a network service" },
  { id: "server", label: "Run a local HTTP server" },
  { id: "storage", label: "Persist plugin data" },
] as const;

export const THEME_BASES = [
  { id: "midnight", label: "Midnight" },
  { id: "paper", label: "Paper" },
  { id: "ocean", label: "Deep Ocean" },
] as const;

export type PluginAnswers = {
  name: string;
  purpose: string;
  behavior: string;
  surfaces: string[];
  needs: string[];
  needsAuto: boolean;
  networkUrl: string;
  commands: string;
  panelDetails: string;
  files: string;
  acceptance: string;
};

export type ThemeAnswers = {
  name: string;
  mood: string;
  mode: "dark" | "light";
  base: string;
  colors: ThemeColors;
  autoColors: boolean;
  notes: string;
};

export const THEME_SEED_KEYS: (keyof ThemeColors)[] = [
  "background",
  "editor",
  "text",
  "function",
  "keyword",
  "string",
];

export function emptyPluginAnswers(): PluginAnswers {
  return {
    name: "",
    purpose: "",
    behavior: "",
    surfaces: [],
    needs: [],
    needsAuto: false,
    networkUrl: "",
    commands: "",
    panelDetails: "",
    files: "",
    acceptance: "",
  };
}

export function themeSeed(base: string): ThemeColors {
  const theme = BUILTIN_THEMES.find((entry) => entry.id === base) ?? DEFAULT_THEME;
  return { ...theme.colors };
}

export function emptyThemeAnswers(): ThemeAnswers {
  const colors = themeSeed("midnight");
  return {
    name: "",
    mood: "",
    mode: "dark",
    base: "midnight",
    colors,
    autoColors: false,
    notes: "",
  };
}

export function slug(value: string): string {
  const base = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  const safe = base || "item";
  return safe.length >= 2 ? safe : `${safe}x`;
}

export function artifactPath(target: BuilderTarget, id: string): string {
  return target === "plugin" ? `arc-plugin-${id}/` : `arc-theme-${id}.json`;
}

function list(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None";
}

function section(title: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? `## ${title}\n\n${trimmed}\n` : "";
}

export function pluginBrief(answers: PluginAnswers, id: string): string {
  const surfaces = answers.surfaces.map(
    (surface) => PLUGIN_SURFACES.find((entry) => entry.id === surface)?.label ?? surface,
  );
  const needs = answers.needs.map(
    (need) => PLUGIN_NEEDS.find((entry) => entry.id === need)?.label ?? need,
  );
  const needsSection = answers.needsAuto
    ? "Agent chooses the capabilities from the required behavior."
    : list(needs);
  const details = [
    answers.needs.includes("network") && answers.networkUrl.trim()
      ? `Network endpoint or service: ${answers.networkUrl.trim()}`
      : "",
    (answers.needs.includes("terminal") || answers.needs.includes("process")) && answers.commands.trim()
      ? `Commands to run: ${answers.commands.trim()}`
      : "",
    answers.surfaces.includes("panel") && answers.panelDetails.trim()
      ? `Panel details: ${answers.panelDetails.trim()}`
      : "",
    answers.needs.includes("files") && answers.files.trim()
      ? `Files touched: ${answers.files.trim()}`
      : "",
  ].filter(Boolean);

  return `# Arc Plugin Brief

Target: plugin
Name: ${answers.name.trim()}
Plugin ID: ${id}
Output folder: ${artifactPath("plugin", id)}
Version: 1.0.0

${section("Purpose", answers.purpose)}
${section("Required behavior", answers.behavior)}
## UI surfaces

${list(surfaces)}
## Capabilities needed

${needsSection}
${details.length ? `## Capability details\n\n${list(details)}\n` : ""}${section("Acceptance criteria", answers.acceptance)}
## Build instructions

1. Read \`kit.md\` and \`plugin-api.md\` before writing code.
2. Create only \`${artifactPath("plugin", id)}\` with \`plugin.json\` and \`main.js\`.
3. Keep \`main.js\` a dependency-free ES module. Export \`activate(api)\` and return a cleanup function when the plugin holds resources.
4. Use the public plugin API. Do not use bare imports or \`api.invoke\` when a public method exists.
5. Validate the manifest and source against \`kit.md\`.
6. Ask the user before installing. Never overwrite an existing plugin without explicit confirmation.
`;
}

export function themeBrief(answers: ThemeAnswers, id: string): string {
  const seeds = THEME_SEED_KEYS.map(
    (key) => `- ${key}: ${answers.colors[key]}`,
  ).join("\n");
  const colorSection = answers.autoColors
    ? `## Colors

The user did not choose colors. Choose the full palette yourself. Derive it from the mood, mode, and base inspiration. Keep every required contrast rule in kit.md.`
    : `## Seed colors

${seeds}`;
  return `# Arc Theme Brief

Target: theme
Name: ${answers.name.trim()}
Theme ID: ${id}
Output file: ${artifactPath("theme", id)}

## Feel

Mode: ${answers.mode}
Base inspiration: ${answers.base}
${section("Mood", answers.mood)}
${colorSection}

## Build instructions

1. Read \`kit.md\` before writing the theme.
2. Create only \`${artifactPath("theme", id)}\`.
3. ${answers.autoColors ? "Choose every color from the mood, mode, and base inspiration." : "Start from the seed colors. Derive the remaining `ThemeColors` slots into one coherent palette."}
4. Keep every required color key. Use \`#rrggbb\` or \`#rrggbbaa\` only.
5. Check text contrast and syntax readability. Adjust the palette if a color fails.
6. Validate the JSON against \`kit.md\`.
7. Ask the user before installing. Never overwrite an existing theme without explicit confirmation.
${section("Notes", answers.notes)}`;
}
