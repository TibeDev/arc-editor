import { useMemo, useState } from "react";
import { Send, Square } from "lucide-react";
import type { ProviderCommand, ProviderSkill } from "../../lib/agents/types";

export default function AgentComposer({
  onSend,
  onStop,
  busy,
  disabled,
  commands,
  skills,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  commands: ProviderCommand[];
  skills: ProviderSkill[];
}) {
  const [value, setValue] = useState("");

  const hints = useMemo(() => {
    const trimmed = value.trimStart();
    if (trimmed.startsWith("/")) {
      const query = trimmed.slice(1).toLowerCase();
      return commands
        .filter((command) => command.name.toLowerCase().includes(query))
        .slice(0, 8)
        .map((command) => ({
          key: `command-${command.name}`,
          label: `/${command.name}`,
          hint: command.description ?? "command",
        }));
    }
    if (trimmed.startsWith("$")) {
      const query = trimmed.slice(1).toLowerCase();
      return skills
        .filter((skill) => skill.name.toLowerCase().includes(query))
        .slice(0, 8)
        .map((skill) => ({
          key: `skill-${skill.name}`,
          label: `$${skill.name}`,
          hint: skill.description ?? "skill",
        }));
    }
    return [];
  }, [commands, skills, value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onSend(text);
  };

  return (
    <div className="agents-composer">
      {hints.length ? (
        <div className="agents-composer-hints" role="listbox">
          {hints.map((hint) => (
            <button
              type="button"
              role="option"
              aria-selected={false}
              key={hint.key}
              onMouseDown={(event) => {
                event.preventDefault();
                setValue(`${hint.label} `);
              }}
            >
              <strong>{hint.label}</strong>
              <small>{hint.hint}</small>
            </button>
          ))}
        </div>
      ) : null}
      <div className="agents-composer-row">
        <textarea
          value={value}
          rows={3}
          placeholder={
            disabled
              ? "Grant trust to this project to start chatting."
              : "Send a message. Enter sends, Shift+Enter adds a line."
          }
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
        />
        {busy ? (
          <button
            type="button"
            className="action-button action-button--secondary action-button--compact agents-stop"
            onClick={onStop}
            title="Stop the running request"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="action-button action-button--primary action-button--compact"
            onClick={submit}
            disabled={disabled || !value.trim()}
            title="Send"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
