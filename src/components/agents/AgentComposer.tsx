import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { appDataDir, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowUp, FileText, Paperclip, Square, X } from "lucide-react";
import type {
  AgentModel,
  AgentPermissionMode,
  AgentProviderInstance,
  ProviderCommand,
  ProviderSkill,
} from "../../lib/agents/types";
import AgentBranchPicker from "./AgentBranchPicker";
import AgentModePicker from "./AgentModePicker";
import AgentModelPicker from "./AgentModelPicker";

const ARC_FILE_MIME = "application/x-arc-file";

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function pathsFromUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((line) => {
      if (!line.startsWith("file:")) return line.startsWith("/") ? [line] : [];
      try {
        const url = new URL(line);
        const path = decodeURIComponent(url.pathname);
        return [/^\/[A-Za-z]:/.test(path) ? path.slice(1) : path];
      } catch {
        return [];
      }
    });
}

function pathsFromTransfer(data: DataTransfer): string[] {
  const paths = new Set<string>();
  const arcPath = data.getData(ARC_FILE_MIME);
  if (arcPath) paths.add(arcPath);
  for (const path of pathsFromUriList(data.getData("text/uri-list"))) {
    paths.add(path);
  }
  for (const file of Array.from(data.files)) {
    const path = (file as File & { path?: string }).path;
    if (path) paths.add(path);
  }
  return [...paths];
}

type PendingAttachment = {
  key: string;
  name: string;
  path?: string;
  thumbnail?: string;
};

type Attachment = PendingAttachment & { id: string };

function imageKey(file: File): string {
  const path = (file as File & { path?: string }).path;
  return path
    ? `path:${path}`
    : `image:${file.name}:${file.size}:${file.type}`;
}

const FILE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

function newAttachmentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

async function savePastedImage(file: File): Promise<PendingAttachment> {
  const thumbnail = URL.createObjectURL(file);
  const existingPath = (file as File & { path?: string }).path;
  const extension = file.type.split("/")[1] || "png";
  const name = file.name || `pasted-image-${Date.now()}.${extension}`;
  if (existingPath) {
    return { key: `path:${existingPath}`, name, path: existingPath, thumbnail };
  }
  try {
    const directory = await join(await appDataDir(), "agent", "attachments");
    await mkdir(directory, { recursive: true });
    const safeName = name.replace(/[^\w.-]+/g, "-");
    const suffix = Math.random().toString(36).slice(2, 8);
    const path = await join(directory, `${Date.now()}-${suffix}-${safeName}`);
    await writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return { key: imageKey(file), name, path, thumbnail };
  } catch {
    return { key: imageKey(file), name, thumbnail };
  }
}

function tokenLeftOfText(range: Range): { node: Text; token: HTMLElement } | null {
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const node = range.startContainer as Text;
  let previous = node.previousSibling;
  while (previous?.nodeType === Node.TEXT_NODE && !previous.textContent) {
    previous = previous.previousSibling;
  }
  if (previous instanceof HTMLElement && previous.dataset.fileId) {
    return { node, token: previous };
  }
  return null;
}

function tokenBeforeCaret(range: Range): HTMLElement | null {
  const inside =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  const directlyInside = inside?.closest<HTMLElement>("[data-file-id]");
  if (directlyInside) return directlyInside;
  let node: Node | null = null;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    if (range.startOffset === 0) node = range.startContainer.previousSibling;
  } else {
    node = range.startContainer.childNodes[range.startOffset - 1] ?? null;
  }
  while (node) {
    if (node instanceof HTMLElement && node.dataset.fileId) return node;
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      node = node.previousSibling;
      continue;
    }
    break;
  }
  return null;
}

export default function AgentComposer({
  onSend,
  onStop,
  busy,
  commands,
  skills,
  providers,
  providerId,
  onProviderChange,
  projectPath,
  models,
  modelKey,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
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
  projectPath: string;
  models: AgentModel[];
  modelKey: string;
  onModelChange: (key: string) => void;
  permissionMode: AgentPermissionMode;
  onPermissionModeChange: (mode: AgentPermissionMode) => void;
  providerRunning: boolean;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  const pendingSelectionRef = useRef<Range | null>(null);
  const skipBeforeInputRef = useRef(false);
  const pickingFilesRef = useRef(false);
  const insertFilesRef = useRef<(paths: string[]) => void>(() => undefined);

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

  const syncValue = () => {
    setValue(editorRef.current?.innerText ?? "");
  };

  const currentRange = () => {
    const editor = editorRef.current;
    if (!editor) return null;
    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      editor.contains(selection.getRangeAt(0).commonAncestorContainer)
    ) {
      return selection.getRangeAt(0);
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  };

  const insertText = (text: string) => {
    const editor = editorRef.current;
    if (!editor || !text) return;
    editor.focus();
    const range = currentRange();
    if (!range) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    syncValue();
  };

  const applyAttachments = (next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const selectRange = (range: Range) => {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const placeCaretAfter = (token: HTMLElement) => {
    const range = document.createRange();
    range.setStartAfter(token);
    range.collapse(true);
    selectRange(range);
    return range;
  };

  useLayoutEffect(() => {
    const range = pendingSelectionRef.current;
    const editor = editorRef.current;
    if (!range || !editor) return;
    pendingSelectionRef.current = null;
    if (!editor.contains(range.startContainer)) return;
    editor.focus({ preventScroll: true });
    selectRange(range);
  }, [attachments, value]);

  const insertAttachments = (pending: PendingAttachment[]) => {
    const editor = editorRef.current;
    if (!editor || !pending.length) return;
    const existing = new Set([
      ...attachmentsRef.current.map((entry) => entry.key),
      ...[...editor.querySelectorAll<HTMLElement>("[data-file-key]")]
        .map((token) => token.dataset.fileKey)
        .filter((key): key is string => Boolean(key)),
    ]);
    const unique = pending.filter((entry) => {
      if (!entry.key || existing.has(entry.key)) return false;
      existing.add(entry.key);
      return true;
    });
    if (!unique.length) return;
    const added = unique.map((entry) => ({
      ...entry,
      id: newAttachmentId(),
    }));
    applyAttachments([...attachmentsRef.current, ...added]);
    editor.focus();
    const range = currentRange();
    if (!range) return;
    range.deleteContents();
    let lastToken: HTMLElement | null = null;
    for (const attachment of added) {
      const token = document.createElement("span");
      token.className = "agents-file-token agents-image-token";
      token.contentEditable = "false";
      token.dataset.fileId = attachment.id;
      token.dataset.fileKey = attachment.key;
      if (attachment.path) token.dataset.filePath = attachment.path;
      token.title = attachment.path ?? attachment.name;
      if (attachment.thumbnail) {
        const image = document.createElement("img");
        image.className = "agents-file-thumb";
        image.src = attachment.thumbnail;
        image.alt = "";
        token.append(image);
      } else {
        const icon = document.createElement("span");
        icon.className = "agents-file-thumb agents-file-kind-icon";
        icon.innerHTML = FILE_ICON_SVG;
        token.append(icon);
      }
      const label = document.createElement("span");
      label.className = "agents-file-name";
      label.textContent = attachment.name;
      const remove = document.createElement("span");
      remove.className = "agents-file-remove";
      remove.textContent = "×";
      remove.setAttribute("role", "button");
      remove.setAttribute("aria-label", `Remove ${attachment.name}`);
      token.append(label, remove);
      range.insertNode(token);
      range.setStartAfter(token);
      range.collapse(true);
      lastToken = token;
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    syncValue();
    if (lastToken) {
      const caret = placeCaretAfter(lastToken);
      pendingSelectionRef.current = caret.cloneRange();
    }
  };

  const removeAttachment = (id: string, focusEditor = false) => {
    const editor = editorRef.current;
    const token = editor
      ? [...editor.querySelectorAll<HTMLElement>("[data-file-id]")].find(
          (entry) => entry.dataset.fileId === id,
        )
      : null;
    let caret: Range | null = null;
    if (token) {
      caret = document.createRange();
      caret.setStartBefore(token);
      caret.collapse(true);
      token.remove();
    }
    applyAttachments(attachmentsRef.current.filter((entry) => entry.id !== id));
    if (focusEditor && editor && caret) {
      editor.focus({ preventScroll: true });
      selectRange(caret);
      pendingSelectionRef.current = caret.cloneRange();
    }
    syncValue();
  };

  const handledInKeyDown = () => {
    skipBeforeInputRef.current = true;
    window.setTimeout(() => {
      skipBeforeInputRef.current = false;
    }, 0);
  };

  const deleteTextBeforeCaret = (
    node: Text,
    offset: number,
    token: HTMLElement,
  ) => {
    const editor = editorRef.current;
    if (!editor || offset < 1) return;
    const text = node.textContent ?? "";
    const next = text.slice(0, offset - 1) + text.slice(offset);
    node.textContent = next;
    const range = document.createRange();
    if (next) {
      range.setStart(node, offset - 1);
    } else {
      node.remove();
      range.setStartAfter(token);
    }
    range.collapse(true);
    editor.focus({ preventScroll: true });
    selectRange(range);
    pendingSelectionRef.current = range.cloneRange();
    syncValue();
  };

  const insertFiles = (paths: string[]) => {
    insertAttachments(
      [...new Set(paths.filter(Boolean))].map((path) => ({
        key: `path:${path}`,
        name: fileName(path),
        path,
      })),
    );
  };

  insertFilesRef.current = insertFiles;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const observer = new MutationObserver(() => {
      const live = new Set(
        [...editor.querySelectorAll<HTMLElement>("[data-file-id]")].map(
          (token) => token.dataset.fileId,
        ),
      );
      const next = attachmentsRef.current.filter((entry) => live.has(entry.id));
      if (next.length !== attachmentsRef.current.length) {
        attachmentsRef.current = next;
        setAttachments(next);
      }
    });
    observer.observe(editor, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        const scale = window.devicePixelRatio || 1;
        const x = event.payload.position.x / scale;
        const y = event.payload.position.y / scale;
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
          return;
        }
        insertFilesRef.current(event.payload.paths);
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const replaceEditorText = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.textContent = text;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    syncValue();
  };

  const pickFiles = async () => {
    if (pickingFilesRef.current) return;
    pickingFilesRef.current = true;
    try {
      const selected = await open({
        title: "Attach files",
        multiple: true,
        directory: false,
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      insertFiles(paths.filter((path): path is string => typeof path === "string"));
    } catch {
      // User cancelled or the dialog is unavailable.
    } finally {
      pickingFilesRef.current = false;
    }
  };

  const submit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const clone = editor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll<HTMLElement>(".agents-file-token").forEach((token) => {
      const label = token.querySelector(".agents-file-name")?.textContent ?? "";
      token.replaceWith(document.createTextNode(`${label.trim()} `));
    });
    const text = clone.innerText.trim();
    if (!text) return;
    const paths = [
      ...new Set(
        [...editor.querySelectorAll<HTMLElement>("[data-file-path]")]
          .map((token) => token.dataset.filePath)
          .filter((path): path is string => Boolean(path)),
      ),
    ];
    editor.innerHTML = "";
    setValue("");
    applyAttachments([]);
    onSend(paths.length ? `${text}\n\nAttached files:\n${paths.join("\n")}` : text);
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
                replaceEditorText(`${hint.label} `);
              }}
            >
              <strong>{hint.label}</strong>
              <small>{hint.hint}</small>
            </button>
          ))}
        </div>
      ) : null}
      {attachments.length ? (
        <div className="agents-composer-files">
          {attachments.map((attachment) => (
            <div className="agents-file-chip" key={attachment.id}>
              {attachment.thumbnail ? (
                <img
                  className="agents-file-chip-thumb"
                  src={attachment.thumbnail}
                  alt=""
                />
              ) : (
                <span className="agents-file-chip-thumb agents-file-kind-icon">
                  <FileText size={13} />
                </span>
              )}
              <button
                type="button"
                className="agents-file-chip-name"
                title={attachment.path ?? attachment.name}
                onClick={() => {
                  if (attachment.path) {
                    void revealItemInDir(attachment.path).catch(() => undefined);
                  }
                }}
              >
                {attachment.name}
              </button>
              <button
                type="button"
                className="agents-file-chip-remove"
                title={`Remove ${attachment.name}`}
                aria-label={`Remove ${attachment.name}`}
                onClick={() => removeAttachment(attachment.id, true)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div
        ref={boxRef}
        className="agents-composer-box"
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes(ARC_FILE_MIME) ||
            event.dataTransfer.types.includes("Files")
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          const paths = pathsFromTransfer(event.dataTransfer);
          if (!paths.length) return;
          event.preventDefault();
          insertFiles(paths);
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          const token = target.closest<HTMLElement>("[data-file-id]");
          if (target.closest(".agents-file-remove") && token?.dataset.fileId) {
            event.preventDefault();
            event.stopPropagation();
            removeAttachment(token.dataset.fileId, true);
            return;
          }
          const file = target.closest<HTMLElement>("[data-file-path]");
          if (!file?.dataset.filePath) return;
          event.preventDefault();
          void revealItemInDir(file.dataset.filePath).catch(() => undefined);
        }}
      >
        <div
          ref={editorRef}
          className="agents-composer-input"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="Chat message"
          data-placeholder="Ask anything. @ files, $ skills, / commands"
          onInput={syncValue}
          onPaste={(event) => {
            const imageFiles = Array.from(event.clipboardData.files).filter(
              (file) => file.type.startsWith("image/"),
            );
            if (imageFiles.length) {
              event.preventDefault();
              const existingKeys = new Set([
                ...attachmentsRef.current.map((entry) => entry.key),
                ...[
                  ...(editorRef.current?.querySelectorAll<HTMLElement>(
                    "[data-file-key]",
                  ) ?? []),
                ]
                  .map((token) => token.dataset.fileKey)
                  .filter((key): key is string => Boolean(key)),
              ]);
              const images = imageFiles.filter((file) => {
                const key = imageKey(file);
                if (existingKeys.has(key)) return false;
                existingKeys.add(key);
                return true;
              });
              if (images.length) {
                void Promise.all(images.map(savePastedImage)).then(
                  insertAttachments,
                );
              }
              return;
            }
            const paths = pathsFromTransfer(event.clipboardData);
            if (paths.length) {
              event.preventDefault();
              insertFiles(paths);
              return;
            }
            const text = event.clipboardData.getData("text/plain");
            if (text) {
              event.preventDefault();
              insertText(text);
            }
          }}
          onBeforeInput={(event) => {
            if (skipBeforeInputRef.current) {
              skipBeforeInputRef.current = false;
              event.preventDefault();
              return;
            }
            const input = event.nativeEvent as InputEvent;
            if (input.inputType !== "deleteContentBackward") return;
            const selection = window.getSelection();
            if (!selection?.rangeCount || !selection.isCollapsed) return;
            const range = selection.getRangeAt(0);
            const token = tokenBeforeCaret(range);
            if (token?.dataset.fileId) {
              event.preventDefault();
              handledInKeyDown();
              removeAttachment(token.dataset.fileId, true);
              return;
            }
            const text = tokenLeftOfText(range);
            if (text && range.startOffset > 0) {
              event.preventDefault();
              handledInKeyDown();
              deleteTextBeforeCaret(text.node, range.startOffset, text.token);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key !== "Backspace") return;
            const selection = window.getSelection();
            if (!selection?.rangeCount || !selection.isCollapsed) return;
            const range = selection.getRangeAt(0);
            const token = tokenBeforeCaret(range);
            if (token?.dataset.fileId) {
              event.preventDefault();
              removeAttachment(token.dataset.fileId, true);
              return;
            }
            const text = tokenLeftOfText(range);
            if (text && range.startOffset > 0) {
              event.preventDefault();
              deleteTextBeforeCaret(text.node, range.startOffset, text.token);
            }
          }}
        />
        <div className="agents-composer-toolbar">
          <button
            type="button"
            className="agents-icon-button"
            title="Attach files"
            aria-label="Attach files"
            onClick={() => void pickFiles()}
          >
            <Paperclip size={15} />
          </button>
          <div className="agents-composer-controls">
            <AgentBranchPicker root={projectPath} />
            <AgentModePicker
              mode={permissionMode}
              onChange={onPermissionModeChange}
            />
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
