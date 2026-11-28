import { useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Code2,
  GitBranch,
  PanelLeftClose,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  AgentProject,
  AgentThreadSummary,
} from "../../lib/agents/types";
import AgentStatusDot from "./AgentStatusDot";

export default function AgentSidebar({
  projects,
  threads,
  activeProjectId,
  activeThreadId,
  onAddProject,
  onSelectProject,
  onRemoveProject,
  onOpenProjectInEditor,
  onNewThread,
  onOpenThread,
  onDeleteThread,
  onRenameThread,
  onArchiveThread,
  onHide,
}: {
  projects: AgentProject[];
  threads: AgentThreadSummary[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  onAddProject: () => void;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onOpenProjectInEditor: (path: string) => void;
  onNewThread: () => void;
  onOpenThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onArchiveThread: (threadId: string, archived: boolean) => void;
  onHide: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const chats = threads.filter((thread) => !thread.archivedAt);
  const archived = threads.filter((thread) => thread.archivedAt);
  const hasEmptyChat = chats.some((thread) => !thread.hasMessages);

  const startRename = (thread: AgentThreadSummary) => {
    setRenamingId(thread.id);
    setRenameValue(thread.title);
  };

  const commitRename = (thread: AgentThreadSummary) => {
    const title = renameValue.trim();
    setRenamingId("");
    setRenameValue("");
    if (title && title !== thread.title) onRenameThread(thread.id, title);
  };

  const renderThread = (thread: AgentThreadSummary) => {
    if (renamingId === thread.id) {
      return (
        <li key={thread.id} className="active">
          <input
            className="agents-thread-rename-input"
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => {
              setRenamingId("");
              setRenameValue("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename(thread);
              } else if (event.key === "Escape") {
                setRenamingId("");
                setRenameValue("");
              }
            }}
          />
        </li>
      );
    }
    return (
    <li
      key={thread.id}
      className={thread.id === activeThreadId ? "active" : ""}
    >
      <button
        type="button"
        className="agents-thread-button"
        onClick={() => onOpenThread(thread.id)}
        title={thread.worktreePath}
      >
        <AgentStatusDot status={thread.uiStatus} />
        <span>{thread.title}</span>
      </button>
      {thread.worktreePath ? (
        <button
          type="button"
          className="agents-icon-button"
          title={`Open worktree\n${thread.worktreePath}`}
          aria-label="Open worktree in editor"
          onClick={() => onOpenProjectInEditor(thread.worktreePath!)}
        >
          <GitBranch size={13} />
        </button>
      ) : null}
      <button
        type="button"
        className="agents-icon-button"
        title="Rename chat"
        aria-label="Rename chat"
        onClick={() => startRename(thread)}
      >
        <Pencil size={13} />
      </button>
      <button
        type="button"
        className="agents-icon-button"
        title={thread.archivedAt ? "Unarchive" : "Archive"}
        aria-label={thread.archivedAt ? "Unarchive chat" : "Archive chat"}
        onClick={() => onArchiveThread(thread.id, !thread.archivedAt)}
      >
        <Archive size={13} />
      </button>
      <button
        type="button"
        className="agents-icon-button"
        title="Delete chat"
        aria-label="Delete chat"
        onClick={() => {
          if (
            window.confirm(
              thread.worktreePath
                ? `Delete "${thread.title}"? Its worktree changes will be discarded.`
                : `Delete "${thread.title}"?`,
            )
          )
            onDeleteThread(thread.id);
        }}
      >
        <Trash2 size={13} />
      </button>
    </li>
    );
  };

  return (
    <aside className="agents-sidebar" aria-label="Agent projects and chats">
      <div className="agents-sidebar-heading">
        <button
          type="button"
          className="agents-icon-button"
          title="Hide projects and chats"
          aria-label="Hide projects and chats"
          onClick={onHide}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>
      <section className="agents-sidebar-section">
        <header>
          <h2>Projects</h2>
          <button
            type="button"
            className="agents-icon-button"
            title="Add project"
            aria-label="Add project"
            onClick={onAddProject}
          >
            <Plus size={15} />
          </button>
        </header>
        <ul className="agents-project-list">
          {projects.map((project) => (
            <li
              key={project.id}
              className={project.id === activeProjectId ? "active" : ""}
            >
              <button
                type="button"
                className="agents-project-button"
                onClick={() => onSelectProject(project.id)}
                title={project.path}
              >
                <span>{project.name}</span>
              </button>
              <button
                type="button"
                className="agents-icon-button"
                title="Open in editor"
                aria-label={`Open ${project.name} in editor`}
                onClick={() => onOpenProjectInEditor(project.path)}
              >
                <Code2 size={13} />
              </button>
              <button
                type="button"
                className="agents-icon-button"
                title="Remove project"
                aria-label={`Remove ${project.name}`}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${project.name} from Arc? Its chats, transcripts, and worktree changes will be deleted.`,
                    )
                  )
                    onRemoveProject(project.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {projects.length === 0 ? (
            <li className="agents-empty-hint">Add a project to begin.</li>
          ) : null}
        </ul>
      </section>

      {activeProject ? (
        <section className="agents-sidebar-section agents-thread-section">
          <header>
            <h2>Chats</h2>
            <button
              type="button"
              className="agents-icon-button"
              aria-label="New chat"
              onClick={onNewThread}
              disabled={hasEmptyChat}
              title={
                hasEmptyChat
                  ? "Send a message in your empty chat first."
                  : "New chat"
              }
            >
              <Plus size={15} />
            </button>
          </header>
          <ul className="agents-thread-list">
            {chats.length ? (
              chats.map(renderThread)
            ) : (
              <li className="agents-empty-hint">
                {threads.length === 0 ? "No chats yet." : "No chats here."}
              </li>
            )}
          </ul>

          <header className="agents-archived-header">
            <button
              type="button"
              className="agents-archived-toggle"
              onClick={() => setShowArchived((value) => !value)}
              aria-expanded={showArchived}
            >
              {showArchived ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
              Archived ({archived.length})
            </button>
          </header>
          {showArchived ? (
            <ul className="agents-thread-list">
              {archived.length ? (
                archived.map(renderThread)
              ) : (
                <li className="agents-empty-hint">No archived chats.</li>
              )}
            </ul>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}
