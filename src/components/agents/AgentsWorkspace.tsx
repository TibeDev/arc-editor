import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowLeft, MessagesSquare, PanelLeftOpen, X } from "lucide-react";
import TitleBar from "../TitleBar";
import { store } from "../../lib/agents/store";
import { useAgentsStore } from "../../lib/agents/useAgentsStore";
import "../../styles/controls.css";
import AgentConversation from "./AgentConversation";
import AgentSidebar from "./AgentSidebar";
import "./AgentsWorkspace.css";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 520;

export default function AgentsWorkspace({
  titleBarEnabled,
  editorWorkspace,
  editorDirtyPaths,
  confirmDirtyFiles,
  onOpenProjectInEditor,
  onSaveAllDirty,
  onClose,
  enabledProviderIds,
  sidebarWidth,
  sidebarHidden,
  onSidebarWidthChange,
  onSidebarHiddenChange,
}: {
  titleBarEnabled: boolean;
  editorWorkspace: string;
  editorDirtyPaths: string[];
  confirmDirtyFiles: boolean;
  onOpenProjectInEditor: (path: string) => void;
  onSaveAllDirty: () => Promise<boolean>;
  onClose: () => void;
  enabledProviderIds: string[];
  sidebarWidth: number;
  sidebarHidden: boolean;
  onSidebarWidthChange: (width: number) => void;
  onSidebarHiddenChange: (hidden: boolean) => void;
}) {
  const state = useAgentsStore();
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef({
    startX: 0,
    startWidth: 0,
    pending: 0,
    collapsed: false,
  });
  const currentSidebarWidth = dragWidth ?? sidebarWidth;
  const collapsedDuringDrag = dragWidth === 0;
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarHidden ? MIN_SIDEBAR_WIDTH : currentSidebarWidth;
    drag.current = { startX, startWidth, pending: startWidth, collapsed: false };
    const onMove = (moveEvent: PointerEvent) => {
      const width = startWidth + moveEvent.clientX - startX;
      drag.current.collapsed = width < MIN_SIDEBAR_WIDTH;
      drag.current.pending = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, width),
      );
      setDragWidth(drag.current.collapsed ? 0 : drag.current.pending);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      const { collapsed, pending } = drag.current;
      setDragWidth(null);
      if (collapsed) {
        onSidebarHiddenChange(true);
      } else {
        onSidebarHiddenChange(false);
        onSidebarWidthChange(pending);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextWidth =
      (sidebarHidden ? MIN_SIDEBAR_WIDTH : currentSidebarWidth) +
      (event.key === "ArrowRight" ? 10 : -10);
    if (nextWidth < MIN_SIDEBAR_WIDTH) {
      onSidebarHiddenChange(true);
      return;
    }
    onSidebarHiddenChange(false);
    onSidebarWidthChange(Math.min(MAX_SIDEBAR_WIDTH, nextWidth));
  };
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

      <div
        className="agents-workspace-body"
        style={{ "--agents-sidebar-width": `${currentSidebarWidth}px` } as CSSProperties}
      >
        {!sidebarHidden && !collapsedDuringDrag ? (
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
            onHide={() => onSidebarHiddenChange(true)}
          />
        ) : null}
        <div
          className={`agents-sidebar-resizer ${sidebarHidden || collapsedDuringDrag ? "collapsed" : ""}`}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize projects and chats panel"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={currentSidebarWidth}
          onPointerDown={beginResize}
          onKeyDown={resizeWithKeyboard}
        />
        {sidebarHidden || collapsedDuringDrag ? (
          <button
            type="button"
            className="agents-show-sidebar"
            title="Show projects and chats"
            aria-label="Show projects and chats"
            onClick={() => onSidebarHiddenChange(false)}
          >
            <PanelLeftOpen size={15} />
          </button>
        ) : null}

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
