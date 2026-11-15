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
