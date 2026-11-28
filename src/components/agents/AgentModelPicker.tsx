import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { AgentModel, AgentProviderInstance } from "../../lib/agents/types";
import ProviderIcon from "./ProviderIcon";

export default function AgentModelPicker({
  providers,
  providerId,
  onProviderChange,
  models,
  modelKey,
  onModelChange,
  providerRunning,
}: {
  providers: AgentProviderInstance[];
  providerId: string;
  onProviderChange: (providerId: string) => void;
  models: AgentModel[];
  modelKey: string;
  onModelChange: (key: string) => void;
  providerRunning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = models.find(
    (model) => `${model.providerID}/${model.modelID}` === modelKey,
  );
  const provider = providers.find((entry) => entry.id === providerId);
  const fallbackName = modelKey ? modelKey.split("/").pop() : "";
  const filtered = models.filter((model) =>
    `${model.name} ${model.providerName}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (key: string) => {
    onModelChange(key);
    setOpen(false);
  };

  return (
    <div className="agents-model-picker" ref={rootRef}>
      <button
        type="button"
        className="agents-model-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ProviderIcon driver={provider?.driver ?? "opencode"} />
        <span>{selected?.name || fallbackName || "Select model"}</span>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="agents-model-popover" role="dialog" aria-label="Model">
          <div className="agents-model-popover-main">
            <label className="agents-model-search">
              <Search size={14} />
              <input
                autoFocus
                type="text"
                value={query}
                placeholder="Search models..."
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="agents-model-popover-list">
              {filtered.map((model) => {
                const key = `${model.providerID}/${model.modelID}`;
                const active = key === modelKey;
                return (
                  <button
                    type="button"
                    key={key}
                    className={`agents-model-option${active ? " selected" : ""}`}
                    onClick={() => choose(key)}
                  >
                    <span>
                      {model.name}
                      <small>{model.providerName}</small>
                    </span>
                    {active ? <Check size={13} /> : null}
                  </button>
                );
              })}
              {filtered.length === 0 ? (
                <p className="agents-model-empty">
                  {providerRunning ? "No models found." : "Loading models..."}
                </p>
              ) : null}
            </div>
          </div>
          <div className="agents-model-popover-providers">
            <h4>Provider</h4>
            {providers.map((entry) => (
              <button
                type="button"
                key={entry.id}
                className={entry.id === providerId ? "selected" : ""}
                onClick={() => {
                  onProviderChange(entry.id);
                  setQuery("");
                }}
              >
                <span>
                  <ProviderIcon driver={entry.driver} size={13} />
                  {entry.label}
                </span>
                {entry.id === providerId ? <Check size={13} /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
