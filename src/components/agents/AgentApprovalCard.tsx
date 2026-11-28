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
        <div className="agents-card-actions">
          <button
            type="button"
            className="action-button action-button--primary action-button--compact"
            onClick={() => onRespond("once")}
          >
            Allow once
          </button>
          <button
            type="button"
            className="action-button action-button--secondary action-button--compact"
            onClick={() => onRespond("always")}
          >
            Allow always
          </button>
          <button
            type="button"
            className="action-button action-button--secondary action-button--compact agents-danger"
            onClick={() => onRespond("reject")}
          >
            Deny
          </button>
        </div>
      )}
    </article>
  );
}
