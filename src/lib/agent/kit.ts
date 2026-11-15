import agentKit from "../../../ARC_AGENT_KIT.md?raw";
import pluginApi from "../../../PLUGIN_API.md?raw";
import type { BuilderTarget } from "./builders";

export type AgentCli = "opencode" | "claude" | "codex" | "custom";

export const AGENT_LABELS: Record<AgentCli, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  codex: "Codex",
  custom: "Custom command",
};

export const AGENT_KIT_FILES = {
  "kit.md": agentKit,
  "plugin-api.md": pluginApi,
};

export function launchPrompt(target: BuilderTarget): string {
  return `Read brief.md and kit.md, then build the requested Arc ${target}. Follow kit.md exactly, including its install confirmation step.`;
}

export function freeAiPrompt(target: BuilderTarget, brief: string): string {
  const api = target === "plugin"
    ? `\n---\n\n# plugin-api.md\n\n${pluginApi.trim()}\n`
    : "";
  return `# Arc build task for a free chat AI

You cannot access the user's computer. Do not run commands or try to install anything.
Return every required file as its own complete fenced code block, with the exact relative path on the line before it.

---

${brief.trim()}

---

# kit.md

${agentKit.trim()}
${api}
---

# Output format

1. Each artifact file, complete, in its own fenced code block.
2. A short numbered guide: where to save each file and how to install it in Arc (Plugin manager or Theme maker).
Do not ask to install it yourself. Do not omit the final guide.
`;
}

export function freeAiPromptFile(target: BuilderTarget, id: string): string {
  return `arc-${target}-${id}-prompt.md`;
}

export function agentCommand(agent: AgentCli, template: string, prompt: string): string {
  if (agent === "opencode") return `opencode --prompt "${prompt}"`;
  if (agent === "claude") return `claude "${prompt}"`;
  if (agent === "codex") return `codex "${prompt}"`;
  const custom = template.trim();
  if (!custom) throw new Error("Set a custom agent command in Settings.");
  return custom.includes("{prompt}")
    ? custom.split("{prompt}").join(prompt)
    : `${custom} "${prompt}"`;
}
