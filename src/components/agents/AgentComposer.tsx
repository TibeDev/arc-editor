import { useMemo, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import type {
  AgentModel,
  AgentProviderInstance,
  ProviderCommand,
  ProviderSkill,
} from "../../lib/agents/types";
import AgentModelPicker from "./AgentModelPicker";

export default function AgentComposer({
  onSend,
  onStop,
  busy,
  commands,
  skills,
  providers,
  providerId,
  onProviderChange,
  models,
  modelKey,
  onModelChange,
  providerRunning,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  commands: ProviderCommand[];
  skills: ProviderSkill[];
  providers: AgentProviderInstance[];
  providerId: string;
  onProviderChange: (providerId: string) => void;
  models: AgentModel[];
  modelKey: string;
  onModelChange: (key: string) => void;
  providerRunning: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const insertMention = () => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const next = `${value.slice(0, start)}@ ${value.slice(start)}`;
    setValue(next);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + 1, start + 1);
    });
  };

  const submit = () => {
    const text = value.trim();
    if (!text) return;
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
      <div className="agents-composer-box">
        <textarea
          ref={textareaRef}
          value={value}
          rows={3}
          placeholder="Ask anything. @ files, $ skills, / commands"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="agents-composer-toolbar">
          <button
            type="button"
            className="agents-icon-button"
            title="Mention files"
            aria-label="Mention files"
            onClick={insertMention}
          >
            <Paperclip size={15} />
          </button>
          <div className="agents-composer-controls">
            <AgentModelPicker
              providers={providers}
              providerId={providerId}
              onProviderChange={onProviderChange}
              models={models}
              modelKey={modelKey}
              onModelChange={onModelChange}
              providerRunning={providerRunning}
            />
            {busy ? (
              <button
                type="button"
                className="agents-composer-send agents-composer-stop"
                onClick={onStop}
                title="Stop the running request"
                aria-label="Stop"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="agents-composer-send"
                onClick={submit}
                disabled={!value.trim()}
                title="Send"
                aria-label="Send"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
