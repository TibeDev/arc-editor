import type { AgentUiStatus } from "../../lib/agents/types";

const LABELS: Record<AgentUiStatus, string> = {
  idle: "Idle",
  working: "Working",
  "needs-input": "Needs input",
  done: "Done",
  error: "Error",
};

export default function AgentStatusDot({ status }: { status: AgentUiStatus }) {
  const label = LABELS[status] ?? status;
  return (
    <span
      className={`agents-status-dot agents-status-${status}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
