import { useEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import type { AgentApproval } from "../../lib/agents/types";

export default function AgentApprovalCard({
  approval,
  onRespond,
}: {
  approval: AgentApproval;
  onRespond: (decision: "once" | "always" | "reject") => void;
}) {
  const resolved = Boolean(approval.decision);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!resolved) actionsRef.current?.querySelector("button")?.focus();
  }, [resolved]);
  return (
    <article className="agents-card agents-approval" aria-label="Approval request">
      <header>
        <ShieldAlert size={15} />
        <strong>{approval.title}</strong>
      </header>
      <p className="agents-approval-detail">{approval.detail}</p>
      {approval.resources?.length ? (
        <ul className="agents-resource-list">
          {approval.resources.map((resource) => (
            <li key={resource}>{resource}</li>
          ))}
        </ul>
      ) : null}
      {resolved ? (
        <p className="agents-card-status">
          {approval.decision === "expired"
            ? "Expired. The provider restarted."
            : `Resolved: ${approval.decision}`}
        </p>
      ) : (
        <div
          ref={actionsRef}
          className="agents-card-actions"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            const buttons = [
              ...(actionsRef.current?.querySelectorAll("button") ?? []),
            ];
            if (!buttons.length) return;
            event.preventDefault();
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const offset = event.key === "ArrowRight" ? 1 : -1;
            buttons[(current + offset + buttons.length) % buttons.length].focus();
          }}
        >
          <button
            type="button"
            className="action-button action-button--primary"
            onClick={() => onRespond("once")}
          >
            Allow once
          </button>
          <button
            type="button"
            className="action-button action-button--secondary"
            onClick={() => onRespond("always")}
          >
            Allow always
          </button>
          <button
            type="button"
            className="action-button action-button--secondary agents-danger"
            onClick={() => onRespond("reject")}
          >
            Deny
          </button>
        </div>
      )}
    </article>
  );
}
