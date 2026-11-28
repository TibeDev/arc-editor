import { useState } from "react";
import {
  Archive,
  Pin,
  Plus,
  RotateCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  AgentProject,
  AgentProviderInstance,
  AgentThreadSummary,
  ProviderStatus,
} from "../../lib/agents/types";
import AgentStatusDot from "./AgentStatusDot";

export default function AgentSidebar({
  projects,
  providers,
  threads,
  activeProjectId,
  activeThreadId,
  status,
  selectedProviderId,
  onSelectProvider,
  onAddProject,
  onSelectProject,
  onRemoveProject,
  onSetTrust,
  onNewThread,
  onOpenThread,
  onDeleteThread,
  onArchiveThread,
  onPinThread,
  onStartProvider,
  onStopProvider,
  onRestartProvider,
}: {
  projects: AgentProject[];
  providers: AgentProviderInstance[];
  threads: AgentThreadSummary[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  status: ProviderStatus | null;
  selectedProviderId: string;
  onSelectProvider: (providerId: string) => void;
  onAddProject: () => void;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onSetTrust: (projectId: string, trusted: boolean) => void;
  onNewThread: () => void;
  onOpenThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onArchiveThread: (threadId: string, archived: boolean) => void;
  onPinThread: (threadId: string, pinned: boolean) => void;
  onStartProvider: () => void;
  onStopProvider: () => void;
  onRestartProvider: () => void;
}) {
  const [query, setQuery] = useState("");
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const provider = providers.find((entry) => entry.id === selectedProviderId);
  const visibleThreads = query.trim()
    ? threads.filter((thread) =>
        `${thread.title} ${thread.providerInstanceId}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : threads;
  const activeStatus = status?.instanceId === selectedProviderId ? status : null;
  return (
    <aside className="agents-sidebar" aria-label="Agent projects and chats">
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
                {project.trusted ? (
                  <ShieldCheck size={13} aria-label="Trusted" />
                ) : (
                  <ShieldAlert size={13} aria-label="Not trusted" />
                )}
              </button>
              <button
                type="button"
                className="agents-icon-button"
                title="Remove project"
                aria-label={`Remove ${project.name}`}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${project.name} from Arc? Its chats and transcripts will be deleted.`,
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
        <section className="agents-sidebar-section agents-trust-section">
          {activeProject.trusted ? (
            <button
              type="button"
              className="agents-trust-status trusted"
              onClick={() => onSetTrust(activeProject.id, false)}
              title="Revoke project trust"
            >
              <ShieldCheck size={14} /> Trusted. Revoke
            </button>
          ) : (
            <div className="agents-trust-prompt">
              <p>
                OpenCode will run commands with your OS user permissions. Project
                trust is consent, not a sandbox.
              </p>
              <button
                type="button"
                className="action-button action-button--primary action-button--compact"
                onClick={() => onSetTrust(activeProject.id, true)}
              >
                Trust project
              </button>
            </div>
          )}
        </section>
      ) : null}

      <section className="agents-sidebar-section agents-provider-section">
        <header>
          <h2>Provider</h2>
          <Server size={14} />
        </header>
        <select
          className="agents-model-select agents-provider-select"
          aria-label="Provider for new chats"
          value={selectedProviderId}
          onChange={(event) => onSelectProvider(event.target.value)}
        >
          {providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <p>
          {provider?.driver ?? "provider"}{" "}
          <span className={activeStatus?.running ? "agents-online" : "agents-offline"}>
            {activeStatus?.running
              ? `running ${activeStatus.version ?? ""}`
              : "offline"}
          </span>
        </p>
        <div className="agents-provider-actions">
          {activeStatus?.running ? (
            <>
              <button
                type="button"
                className="action-button action-button--secondary action-button--compact"
                onClick={onStopProvider}
              >
                Stop
              </button>
              <button
                type="button"
                className="action-button action-button--secondary action-button--compact"
                onClick={onRestartProvider}
                title="Restart provider"
              >
                <RotateCw size={13} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="action-button action-button--primary action-button--compact"
              onClick={onStartProvider}
            >
              Start {provider?.label ?? "provider"}
            </button>
          )}
        </div>
      </section>

      <section className="agents-sidebar-section agents-thread-section">
        <header>
          <h2>Chats</h2>
          <button
            type="button"
            className="agents-icon-button"
            title="New chat"
            aria-label="New chat"
            onClick={onNewThread}
            disabled={!activeProject || !activeProject.trusted}
          >
            <Plus size={15} />
          </button>
        </header>
        <input
          className="agents-thread-search"
          type="search"
          placeholder="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search chats"
        />
        <ul className="agents-thread-list">
          {visibleThreads.map((thread) => (
            <li
              key={thread.id}
              className={thread.id === activeThreadId ? "active" : ""}
            >
              <button
                type="button"
                className="agents-thread-button"
                onClick={() => onOpenThread(thread.id)}
              >
                <AgentStatusDot status={thread.uiStatus} />
                <span>{thread.title}</span>
                <small>{thread.providerInstanceId}</small>
              </button>
              <button
                type="button"
                className="agents-icon-button"
                title={thread.pinnedAt ? "Unpin" : "Pin"}
                aria-label={thread.pinnedAt ? "Unpin chat" : "Pin chat"}
                onClick={() => onPinThread(thread.id, !thread.pinnedAt)}
              >
                <Pin size={13} />
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
                  if (window.confirm(`Delete "${thread.title}"?`))
                    onDeleteThread(thread.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {visibleThreads.length === 0 ? (
            <li className="agents-empty-hint">
              {threads.length === 0 ? "No chats yet." : "No matching chats."}
            </li>
          ) : null}
        </ul>
      </section>
    </aside>
  );
}
