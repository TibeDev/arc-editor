import {
  AlertTriangle,
  Check,
  CircleHelp,
  LoaderCircle,
  Minus,
} from "lucide-react";
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
  const size = 12;
  const icon =
    status === "working" ? (
      <LoaderCircle size={size} className="agents-status-spin" />
    ) : status === "needs-input" ? (
      <CircleHelp size={size} />
    ) : status === "done" ? (
      <Check size={size} />
    ) : status === "error" ? (
      <AlertTriangle size={size} />
    ) : (
      <Minus size={size} />
    );
  return (
    <span
      className={`agents-status-icon agents-status-${status}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {icon}
    </span>
  );
}
