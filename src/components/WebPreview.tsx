import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FolderOpen,
  RotateCw,
} from "lucide-react";
import "./WebPreview.css";

export type PreviewTab = { key: string; url: string; title: string };

type Props = {
  tab: PreviewTab;
  workspace: string;
  onChange: (patch: Partial<Pick<PreviewTab, "url" | "title">>) => void;
};

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed))
    return `http://${trimmed}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  return `https://${trimmed}`;
}

export default function WebPreview({ tab, workspace, onChange }: Props) {
  const [draft, setDraft] = useState(tab.url);
  const [history, setHistory] = useState<{ entries: string[]; index: number }>(
    () => ({ entries: tab.url ? [tab.url] : [], index: tab.url ? 0 : -1 }),
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [serving, setServing] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(tab.url), [tab.url]);

  useEffect(() => {
    const start = () => document.body.classList.add("arc-dragging");
    const end = () => document.body.classList.remove("arc-dragging");
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", end);
    document.addEventListener("drop", end);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", end);
      document.removeEventListener("drop", end);
      document.body.classList.remove("arc-dragging");
    };
  }, []);

  useEffect(() => {
    if (!tab.url || !isTauri()) {
      setBlocked(false);
      return;
    }
    let cancelled = false;
    void invoke<boolean>("preview_frame_check", { url: tab.url })
      .then((allowed) => {
        if (!cancelled) setBlocked(!allowed);
      })
      .catch(() => {
        if (!cancelled) setBlocked(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab.url]);

  const commit = (url: string, push: boolean) => {
    setDraft(url);
    setBlocked(false);
    setError("");
    if (push) {
      setHistory((current) => {
        const entries =
          current.index >= 0
            ? current.entries.slice(0, current.index + 1)
            : [];
        if (entries.at(-1) === url) return current;
        const next = [...entries, url];
        return { entries: next, index: next.length - 1 };
      });
    }
    onChange({ url });
  };

  const navigate = (value: string) => {
    const url = normalizeUrl(value);
    if (url === null) {
      setError("Enter a valid http:// or https:// URL.");
      return;
    }
    commit(url, true);
  };

  const pasteClipboard = async () => {
    try {
      const text = await readText();
      const input = urlInput.current;
      const start = input?.selectionStart ?? draft.length;
      const end = input?.selectionEnd ?? draft.length;
      setDraft(draft.slice(0, start) + text + draft.slice(end));
      requestAnimationFrame(() => {
        input?.focus();
        const caret = start + text.length;
        input?.setSelectionRange(caret, caret);
      });
    } catch {
      // Leave the field unchanged when the clipboard cannot be read.
    }
  };

  const move = (offset: number) => {
    const index = history.index + offset;
    if (index < 0 || index >= history.entries.length) return;
    setHistory({ ...history, index });
    commit(history.entries[index], false);
  };

  const serveWorkspace = async () => {
    if (!isTauri()) {
      setError("Preview server is available in Arc desktop.");
      return;
    }
    setServing(true);
    setError("");
    try {
      const info = await invoke<{ root: string; url: string }>(
        "preview_server_start",
        { root: workspace, entry: "" },
      );
      commit(info.url, true);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setServing(false);
    }
  };

  const openExternal = () => {
    if (!tab.url) return;
    if (!isTauri()) {
      window.open(tab.url, "_blank", "noopener");
      return;
    }
    void invoke("open_external_url", { url: tab.url }).catch((cause) =>
      setError(String(cause)),
    );
  };

  const handleLoad = () => {
    try {
      const title = frame.current?.contentDocument?.title.trim();
      if (title && title !== tab.title) onChange({ title: title.slice(0, 80) });
    } catch {
      // Cross-origin frames do not expose the document title.
    }
  };

  return (
    <div className="web-preview">
      <form
        className="web-preview-bar"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(draft);
        }}
      >
        <button
          type="button"
          title="Back"
          disabled={history.index <= 0}
          onClick={() => move(-1)}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          title="Forward"
          disabled={history.index >= history.entries.length - 1}
          onClick={() => move(1)}
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          title="Reload"
          disabled={!tab.url}
          onClick={() => {
            setBlocked(false);
            setReloadKey((value) => value + 1);
          }}
        >
          <RotateCw size={13} />
        </button>
        <input
          ref={urlInput}
          value={draft}
          spellCheck={false}
          placeholder="http://localhost:5173"
          aria-label="Preview URL"
          onKeyDown={(event) => {
            if (
              isTauri() &&
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "v"
            ) {
              event.preventDefault();
              void pasteClipboard();
            }
          }}
          onPaste={(event) => {
            if (isTauri()) {
              event.preventDefault();
              void pasteClipboard();
            }
          }}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          title="Open in browser"
          disabled={!tab.url}
          onClick={openExternal}
        >
          <ExternalLink size={13} />
        </button>
      </form>
      {error && <div className="web-preview-error">{error}</div>}
      <div className="web-preview-stage">
        <div className="web-preview-shield" />
        {!tab.url ? (
          <div className="web-preview-empty">
            <span>Enter a dev server URL above.</span>
            <button
              type="button"
              disabled={!workspace || serving}
              onClick={() => void serveWorkspace()}
            >
              <FolderOpen size={14} />
              {serving ? "Starting server..." : "Serve workspace files"}
            </button>
            <span>Local URLs and workspace HTML work in the preview.</span>
          </div>
        ) : blocked ? (
          <div className="web-preview-blocked">
            <span>This site does not allow embedding.</span>
            <button type="button" onClick={openExternal}>
              <ExternalLink size={14} />
              Open in browser
            </button>
            <button type="button" onClick={() => setBlocked(false)}>
              Try anyway
            </button>
          </div>
        ) : (
          <iframe
            ref={frame}
            key={`${tab.url}:${reloadKey}`}
            className="web-preview-frame"
            src={tab.url}
            title={tab.title || "Web preview"}
            allow="clipboard-read; clipboard-write; fullscreen"
            referrerPolicy="no-referrer"
            onLoad={handleLoad}
          />
        )}
      </div>
    </div>
  );
}
