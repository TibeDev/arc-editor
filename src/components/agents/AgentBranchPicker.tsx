import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, GitBranch } from "lucide-react";
import usePopoverMaxHeight from "./usePopoverMaxHeight";

type BranchStatus = {
  isRepo: boolean;
  branch?: string | null;
  branches: string[];
};

export default function AgentBranchPicker({ root }: { root: string }) {
  const [status, setStatus] = useState<BranchStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const maxHeight = usePopoverMaxHeight(open, rootRef);

  const load = async () => {
    const request = ++requestRef.current;
    try {
      const next = await invoke<BranchStatus>("github_status", { root });
      if (request !== requestRef.current) return;
      setStatus(next);
      setError("");
    } catch (loadError) {
      if (request !== requestRef.current) return;
      setStatus(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    setStatus(null);
    setOpen(false);
    setError("");
    void load();
  }, [root]);

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

  if (!status?.isRepo) return null;

  const choose = async (branch: string) => {
    if (branch === status.branch) {
      setOpen(false);
      return;
    }
    try {
      await invoke("github_switch_branch", { root, branch });
      setOpen(false);
      await load();
    } catch (switchError) {
      setError(
        switchError instanceof Error ? switchError.message : String(switchError),
      );
    }
  };

  return (
    <div className="agents-branch-picker" ref={rootRef}>
      <button
        type="button"
        className="agents-model-trigger agents-branch-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Switch project branch${status.branch ? ` (${status.branch})` : ""}`}
        onClick={() => {
          if (!open) void load();
          setOpen((value) => !value);
        }}
      >
        <GitBranch size={13} />
        <span>{status.branch || "No branch"}</span>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div
          className="agents-branch-popover"
          role="menu"
          aria-label="Branches"
          style={maxHeight ? { maxHeight } : undefined}
        >
          {status.branches.map((branch) => (
            <button
              type="button"
              key={branch}
              role="menuitemradio"
              aria-checked={branch === status.branch}
              className={branch === status.branch ? "selected" : ""}
              onClick={() => void choose(branch)}
            >
              <span>{branch}</span>
              {branch === status.branch ? <Check size={13} /> : null}
            </button>
          ))}
          {status.branches.length === 0 ? (
            <p className="agents-model-empty">No branches found.</p>
          ) : null}
          {error ? <p className="agents-branch-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
