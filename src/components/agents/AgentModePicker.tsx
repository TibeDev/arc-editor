import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Flame,
  Shield,
  Sparkles,
} from "lucide-react";
import type { AgentPermissionMode } from "../../lib/agents/types";

const MODES: Array<{
  value: AgentPermissionMode;
  label: string;
  hint: string;
  icon: typeof Shield;
}> = [
  { value: "supervised", label: "Supervised", hint: "Ask every time", icon: Shield },
  {
    value: "smart",
    label: "Smart Auto",
    hint: "Auto routine, ask sensitive",
    icon: Sparkles,
  },
  { value: "yolo", label: "YOLO", hint: "Never ask", icon: Flame },
];

export default function AgentModePicker({
  mode,
  onChange,
}: {
  mode: AgentPermissionMode;
  onChange: (mode: AgentPermissionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = MODES.find((entry) => entry.value === mode) ?? MODES[0];
  const SelectedIcon = selected.icon;

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

  return (
    <div className="agents-mode-picker" ref={rootRef}>
      <button
        type="button"
        className="agents-model-trigger agents-mode-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={selected.hint}
        onClick={() => setOpen((value) => !value)}
      >
        <SelectedIcon size={13} />
        <span>{selected.label}</span>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="agents-mode-popover" role="menu" aria-label="Permission mode">
          {MODES.map((entry) => {
            const Icon = entry.icon;
            return (
            <button
              type="button"
              key={entry.value}
              role="menuitemradio"
              aria-checked={entry.value === mode}
              className={entry.value === mode ? "selected" : ""}
              onClick={() => {
                onChange(entry.value);
                setOpen(false);
              }}
            >
              <span className="agents-mode-option">
                <Icon size={13} />
                <span>
                  {entry.label}
                  <small>{entry.hint}</small>
                </span>
              </span>
              {entry.value === mode ? <Check size={13} /> : null}
            </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
