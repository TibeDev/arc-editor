import { useEffect, useState } from "react";
import { ArrowLeft, MessagesSquare, Plus, X } from "lucide-react";
import TitleBar from "../TitleBar";
import { store } from "../../lib/agents/store";
import { useAgentsStore } from "../../lib/agents/useAgentsStore";
import "../../styles/controls.css";
import AgentConversation from "./AgentConversation";
import AgentSidebar from "./AgentSidebar";
import "./AgentsWorkspace.css";

export default function AgentsWorkspace({
  titleBarEnabled,
  editorWorkspace,
  editorDirtyPaths,
  confirmDirtyFiles,
  onOpenProjectInEditor,
  onSaveAllDirty,
  onClose,
}: {
  titleBarEnabled: boolean;
  editorWorkspace: string;
  editorDirtyPaths: string[];
  confirmDirtyFiles: boolean;
  onOpenProjectInEditor: (path: string) => void;
  onSaveAllDirty: () => Promise<boolean>;
  onClose: () => void;
}) {
  const state = useAgentsStore();
  const [selectedProviderId, setSelectedProviderId] = useState("");
  useEffect(() => {
    void store.ensureLoaded();
  }, []);
  const effectiveProviderId =
    selectedProviderId ||
    state.status?.instanceId ||
    state.providers[0]?.id ||
    "";

  const activeProject = state.projects.find(
    (project) => project.id === state.activeProjectId,
  );
  const activeThread = state.threads.find(
    (thread) => thread.id === state.activeThreadId,
  );

  return (
    <main className={`agents-workspace-page ${titleBarEnabled ? "" : "titlebar-off"}`}>
      {titleBarEnabled && <TitleBar />}
      <header className="agents-workspace-header">
        <button
          type="button"
          className="agents-back-button"
          onClick={onClose}
          title="Back to editor"
        >
          <ArrowLeft size={15} />
          Editor
        </button>
        <h1>Agents</h1>
        {state.status?.running ? (
          <span className="agents-header-status">
            OpenCode {state.status.version ?? ""}
          </span>
        ) : (
          <span className="agents-header-status offline">OpenCode offline</span>
        )}
      </header>

      {state.error ? (
        <div className="agents-error" role="alert">
          <span>{state.error}</span>
          <button
            type="button"
            className="agents-icon-button"
            aria-label="Dismiss error"
            onClick={() => store.clearError()}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {state.status?.error ? (
        <div className="agents-error" role="status">
          <span>{state.status.error}</span>
        </div>
      ) : null}

      <div className="agents-workspace-body">
        <AgentSidebar
          projects={state.projects}
          providers={state.providers}
          threads={state.threads}
          activeProjectId={state.activeProjectId}
          activeThreadId={state.activeThreadId}
          status={state.status}
          selectedProviderId={effectiveProviderId}
          onSelectProvider={setSelectedProviderId}
          onAddProject={() => void store.addProject()}
          onSelectProject={(projectId) => void store.selectProject(projectId)}
          onRemoveProject={(projectId) => void store.removeProject(projectId)}
          onSetTrust={(projectId, trusted) =>
            void store.setTrust(projectId, trusted)
          }
          onNewThread={() =>
            void store.createThread(effectiveProviderId || undefined)
          }
          onOpenThread={(threadId) => void store.openThread(threadId)}
          onDeleteThread={(threadId) => void store.deleteThread(threadId)}
          onArchiveThread={(threadId, archived) =>
            void store.archiveThread(threadId, archived)
          }
          onPinThread={(threadId, pinned) =>
            void store.pinThread(threadId, pinned)
          }
          onStartProvider={() =>
            void store.startProvider(effectiveProviderId || undefined)
          }
          onStopProvider={() => void store.stopProvider()}
          onRestartProvider={() =>
            void store.restartProvider(effectiveProviderId || undefined)
          }
        />

        {state.detail && activeThread && activeProject ? (
          <AgentConversation
            key={state.detail.thread.id}
            detail={state.detail}
            projectPath={activeProject.path}
            trusted={activeProject.trusted}
            status={state.status}
            models={state.models}
            commands={state.commands}
            skills={state.skills}
            editorWorkspace={editorWorkspace}
            dirtyPaths={editorDirtyPaths}
            confirmDirtyFiles={confirmDirtyFiles}
            onSaveAllDirty={onSaveAllDirty}
            onOpenInEditor={onOpenProjectInEditor}
          />
        ) : (
          <section className="agents-empty-conversation">
            <MessagesSquare size={28} />
            <h2>
              {activeProject
                ? activeProject.trusted
                  ? "Start a chat"
                  : "Trust this project to start"
                : "Add a project to begin"}
            </h2>
            <p>
              Chats are stored by Arc in app data. Skills and MCP configuration stay
              OpenCode-native. Arc does not sandbox the agent.
            </p>
            {activeProject?.trusted ? (
              <button
                type="button"
                className="action-button action-button--primary action-button--compact"
                onClick={() =>
                  void store.createThread(effectiveProviderId || undefined)
                }
              >
                <Plus size={14} /> New chat
              </button>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
