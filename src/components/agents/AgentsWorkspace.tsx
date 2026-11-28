import { useEffect } from "react";
import { ArrowLeft, MessagesSquare, X } from "lucide-react";
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
  enabledProviderIds,
}: {
  titleBarEnabled: boolean;
  editorWorkspace: string;
  editorDirtyPaths: string[];
  confirmDirtyFiles: boolean;
  onOpenProjectInEditor: (path: string) => void;
  onSaveAllDirty: () => Promise<boolean>;
  onClose: () => void;
  enabledProviderIds: string[];
}) {
  const state = useAgentsStore();
  useEffect(() => {
    void store.ensureLoaded();
  }, []);
  useEffect(() => {
    return () => {
      void store.stopProvider();
    };
  }, []);
  const enabledProviders = state.providers.filter((provider) =>
    enabledProviderIds.includes(provider.id),
  );
  const defaultProviderId =
    enabledProviders[0]?.id ||
    state.status?.instanceId ||
    state.providers[0]?.id ||
    "";

  const activeProject = state.projects.find(
    (project) => project.id === state.activeProjectId,
  );
  const activeThread = state.threads.find(
    (thread) => thread.id === state.activeThreadId,
  );
  const activeProviderId =
    activeThread?.providerInstanceId || defaultProviderId;
  const conversationProviderId = state.detail?.thread.providerInstanceId;
  const baseProviders = enabledProviders.length
    ? enabledProviders
    : state.providers;
  const conversationProviders =
    conversationProviderId &&
    !baseProviders.some((provider) => provider.id === conversationProviderId)
      ? [
          ...baseProviders,
          ...state.providers.filter(
            (provider) => provider.id === conversationProviderId,
          ),
        ]
      : baseProviders;

  useEffect(() => {
    if (!state.loaded || !activeProviderId) return;
    if (state.status?.running && state.status.instanceId === activeProviderId) {
      void store.ensureModels(activeProviderId);
      return;
    }
    void store.startProvider(activeProviderId);
  }, [
    state.loaded,
    activeProviderId,
    state.status?.instanceId,
    state.status?.running,
  ]);

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

      <div className="agents-workspace-body">
        <AgentSidebar
          projects={state.projects}
          threads={state.threads}
          activeProjectId={state.activeProjectId}
          activeThreadId={state.activeThreadId}
          onAddProject={() => void store.addProject()}
          onSelectProject={(projectId) => void store.selectProject(projectId)}
          onRemoveProject={(projectId) => void store.removeProject(projectId)}
          onOpenProjectInEditor={onOpenProjectInEditor}
          onNewThread={() => void store.createThread(defaultProviderId)}
          onOpenThread={(threadId) => void store.openThread(threadId)}
          onDeleteThread={(threadId) => void store.deleteThread(threadId)}
          onRenameThread={(threadId, title) =>
            void store.renameThread(threadId, title)
          }
          onArchiveThread={(threadId, archived) =>
            void store.archiveThread(threadId, archived)
          }
        />

        {state.detail && activeThread && activeProject ? (
          <AgentConversation
            key={state.detail.thread.id}
            detail={state.detail}
            projectPath={activeProject.path}
            providers={conversationProviders}
            status={state.status}
            models={
              state.modelsByProvider[state.detail.thread.providerInstanceId] ?? []
            }
            commands={state.commands}
            skills={state.skills}
            editorWorkspace={editorWorkspace}
            dirtyPaths={editorDirtyPaths}
            confirmDirtyFiles={confirmDirtyFiles}
            onSaveAllDirty={onSaveAllDirty}
            onProviderChange={(providerId) =>
              void store.setThreadProvider(
                state.detail!.thread.id,
                providerId,
              )
            }
          />
        ) : (
          <section className="agents-empty-conversation">
            <MessagesSquare size={28} />
            <h2>
              {activeProject ? "Start a chat" : "Add a project to begin"}
            </h2>
            <p>
              Chats are stored by Arc in app data. Skills and MCP configuration stay
              provider-native. Arc does not sandbox the agent.
            </p>

          </section>
        )}
      </div>
    </main>
  );
}
