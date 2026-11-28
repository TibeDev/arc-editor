import { AlertTriangle, Info, Wrench } from "lucide-react";
import type {
  AgentApproval,
  AgentItem,
  AgentQuestion,
  AgentUiStatus,
} from "../../lib/agents/types";
import AgentApprovalCard from "./AgentApprovalCard";
import AgentMarkdown from "./AgentMarkdown";
import AgentQuestionCard from "./AgentQuestionCard";
import AgentStatusDot from "./AgentStatusDot";

function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolItem({ item }: { item: AgentItem }) {
  const status = item.status ?? "running";
  return (
    <article className={`agents-tool agents-tool-${status}`}>
      <header>
        <Wrench size={14} />
        <strong>{item.name ?? "tool"}</strong>
        <span>{status}</span>
      </header>
      {item.input !== undefined && item.input !== null ? (
        <details>
          <summary>Input</summary>
          <pre>{formatValue(item.input)}</pre>
        </details>
      ) : null}
      {item.output !== undefined && item.output !== null ? (
        <details>
          <summary>Output</summary>
          <pre>{formatValue(item.output)}</pre>
        </details>
      ) : null}
    </article>
  );
}

export default function AgentTranscript({
  items,
  approvals,
  questions,
  onApproval,
  onQuestion,
  onRejectQuestion,
  activity,
  workedFor,
}: {
  items: AgentItem[];
  approvals: AgentApproval[];
  questions: AgentQuestion[];
  onApproval: (approvalId: string, decision: "once" | "always" | "reject") => void;
  onQuestion: (questionId: string, answers: unknown) => void;
  onRejectQuestion: (questionId: string) => void;
  activity?: { status: AgentUiStatus; elapsed: number; label: string };
  workedFor?: string;
}) {
  const hidden = Math.max(0, items.length - 500);
  const visible = hidden ? items.slice(hidden) : items;
  const pendingApproval = approvals.find((approval) => !approval.decision);
  const pendingQuestion = questions.find((question) => question.status === "pending");
  return (
    <div className="agents-transcript" role="log" aria-live="polite">
      {hidden ? (
        <p className="agents-transcript-truncated">
          {hidden} earlier items are kept on disk.
        </p>
      ) : null}
      {visible.map((item) => {
        if (item.kind === "user") {
          return (
            <article key={item.id} className="agents-message agents-message-user">
              <div className="agents-message-bubble">{item.text}</div>
            </article>
          );
        }
        if (item.kind === "assistant") {
          return (
            <article key={item.id} className="agents-message agents-message-assistant">
              {item.reasoning ? (
                <details className="agents-reasoning">
                  <summary>Reasoning</summary>
                  <p>{item.reasoning}</p>
                </details>
              ) : null}
              {item.text ? <AgentMarkdown text={item.text} /> : null}
            </article>
          );
        }
        if (item.kind === "tool") {
          return <ToolItem key={item.id} item={item} />;
        }
        if (item.kind === "error") {
          return (
            <article key={item.id} className="agents-notice agents-notice-error">
              <AlertTriangle size={14} />
              <span>{item.message}</span>
            </article>
          );
        }
        return (
          <article key={item.id} className="agents-notice">
            <Info size={14} />
            <span>{item.text}</span>
          </article>
        );
      })}
      {pendingApproval ? (
        <AgentApprovalCard
          key={pendingApproval.id}
          approval={pendingApproval}
          onRespond={(decision) => onApproval(pendingApproval.id, decision)}
        />
      ) : pendingQuestion ? (
        <AgentQuestionCard
          key={pendingQuestion.id}
          question={pendingQuestion}
          onRespond={(answers) => onQuestion(pendingQuestion.id, answers)}
          onReject={() => onRejectQuestion(pendingQuestion.id)}
        />
      ) : null}
      {activity ? (
        <div className="agents-activity" role="status">
          <AgentStatusDot status={activity.status} />
          <span>
            Working for {activity.elapsed}s · {activity.label}
          </span>
        </div>
      ) : workedFor ? (
        <p className="agents-worked">{workedFor}</p>
      ) : null}
    </div>
  );
}
