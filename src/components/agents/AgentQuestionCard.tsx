import { useState } from "react";
import { HelpCircle } from "lucide-react";
import type { AgentQuestion } from "../../lib/agents/types";

export default function AgentQuestionCard({
  question,
  onRespond,
  onReject,
}: {
  question: AgentQuestion;
  onRespond: (answers: unknown) => void;
  onReject: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const pending = question.status === "pending";

  const setAnswer = (id: string, value: string, multiple: boolean) => {
    setAnswers((current) => {
      if (!multiple) return { ...current, [id]: value };
      const existing = current[id];
      const list = Array.isArray(existing) ? existing : [];
      return {
        ...current,
        [id]: list.includes(value)
          ? list.filter((entry) => entry !== value)
          : [...list, value],
      };
    });
  };

  return (
    <article className="agents-card agents-question" aria-label="Question from agent">
      <header>
        <HelpCircle size={15} />
        <strong>{question.questions[0]?.header ?? "Question"}</strong>
      </header>
      {question.questions.map((prompt) => (
        <section key={prompt.id} className="agents-question-prompt">
          <p>{prompt.question}</p>
          {prompt.options?.length ? (
            <div className="agents-question-options">
              {prompt.options.map((option) => {
                const selected = Array.isArray(answers[prompt.id])
                  ? answers[prompt.id].includes(option.label)
                  : answers[prompt.id] === option.label;
                return (
                  <button
                    type="button"
                    key={option.label}
                    className={`agents-question-option${selected ? " selected" : ""}`}
                    onClick={() =>
                      setAnswer(prompt.id, option.label, prompt.multiple === true)
                    }
                  >
                    <span>{option.label}</span>
                    {option.description ? <small>{option.description}</small> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea
              className="agents-question-input"
              value={(answers[prompt.id] as string) ?? ""}
              onChange={(event) => setAnswer(prompt.id, event.target.value, false)}
              rows={2}
            />
          )}
        </section>
      ))}
      {pending ? (
        <div className="agents-card-actions">
          <button
            type="button"
            className="action-button action-button--primary"
            onClick={() => onRespond(answers)}
          >
            Answer
          </button>
          <button
            type="button"
            className="action-button action-button--secondary agents-danger"
            onClick={onReject}
          >
            Reject
          </button>
        </div>
      ) : (
        <p className="agents-card-status">Question {question.status}</p>
      )}
    </article>
  );
}
