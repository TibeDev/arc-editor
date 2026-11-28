import { useEffect, useState } from "react";
import { showArcDialog } from "../../lib/dialog";
import type {
  AgentModel,
  AgentModelRef,
  AgentProviderInstance,
  AgentThreadDetail,
  ProviderCommand,
  ProviderSkill,
  ProviderStatus,
} from "../../lib/agents/types";
import { store } from "../../lib/agents/store";
import AgentComposer from "./AgentComposer";
import AgentTranscript from "./AgentTranscript";


function formatWorked(startedAt: string, endedAt: string): string {
  const seconds = Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `Worked for ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const minuteText = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return rest ? `Worked for ${minuteText} ${rest} second${rest === 1 ? "" : "s"}` : `Worked for ${minuteText}`;
}


export default function AgentConversation({
  detail,
  projectPath,
  providers,
  status,
  models,
  commands,
  skills,
  editorWorkspace,
  dirtyPaths,
  confirmDirtyFiles,
  onSaveAllDirty,
  onProviderChange,
}: {
  detail: AgentThreadDetail;
  projectPath: string;
  providers: AgentProviderInstance[];
  status: ProviderStatus | null;
  models: AgentModel[];
  commands: ProviderCommand[];
  skills: ProviderSkill[];
  editorWorkspace: string;
  dirtyPaths: string[];
  confirmDirtyFiles: boolean;
  onSaveAllDirty: () => Promise<boolean>;
  onProviderChange: (providerId: string) => void;
}) {
  const thread = detail.thread;
  const [modelKey, setModelKey] = useState(
    thread.model ? `${thread.model.providerID}/${thread.model.modelID}` : "",
  );
  useEffect(() => {
    setModelKey(
      thread.model ? `${thread.model.providerID}/${thread.model.modelID}` : "",
    );
  }, [thread.id, thread.model, thread.providerInstanceId]);
  const activeRun = [...detail.runs]
    .reverse()
    .find((run) =>
      ["starting", "running", "waiting"].includes(run.status),
    );
  const busy = thread.uiStatus === "working" || Boolean(activeRun);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy, thread.id]);
  const elapsed = activeRun
    ? Math.max(
        0,
        Math.floor((now - Date.parse(activeRun.startedAt)) / 1000),
      )
    : 0;
  const lastItem = detail.items[detail.items.length - 1];
  const activity =
    lastItem?.kind === "tool" && lastItem.status === "running"
      ? "Running tool"
      : elapsed < 6
        ? "Thinking"
        : elapsed < 18
          ? "Planning"
          : "Building";
  const lastCompletedRun = [...detail.runs]
    .reverse()
    .find((run) => run.status === "completed" && run.endedAt);
  const workedFor = lastCompletedRun?.endedAt
    ? formatWorked(lastCompletedRun.startedAt, lastCompletedRun.endedAt)
    : "";
  const selectedModel: AgentModelRef | undefined = (() => {
    const model = models.find(
      (entry) => `${entry.providerID}/${entry.modelID}` === modelKey,
    );
    return model
      ? { providerID: model.providerID, modelID: model.modelID }
      : thread.model;
  })();

  const send = async (text: string) => {
    if (
      confirmDirtyFiles &&
      dirtyPaths.length > 0 &&
      editorWorkspace === projectPath
    ) {
      const choice = await showArcDialog({
        title: "Unsaved editor changes",
        message: `${dirtyPaths.length} file${dirtyPaths.length === 1 ? "" : "s"} have unsaved changes in this project. The agent may read files from disk.`,
        buttons: [
          { label: "Save all", value: "save", primary: true },
          { label: "Cancel", value: "cancel" },
          { label: "Send anyway", value: "send" },
        ],
      });
      if (!choice || choice === "cancel") return;
      if (choice === "save" && !(await onSaveAllDirty())) return;
    }
    await store.send(thread.id, text, selectedModel);
  };

  return (
    <section className="agents-conversation" aria-label="Conversation">
      <AgentTranscript
        items={detail.items}
        approvals={detail.approvals}
        questions={detail.questions}
        activity={
          busy
            ? { status: thread.uiStatus, elapsed, label: activity }
            : undefined
        }
        workedFor={busy ? "" : workedFor}
        onApproval={(approvalId, decision) =>
          void store.respondApproval(approvalId, decision)
        }
        onQuestion={(questionId, answers) =>
          void store.respondQuestion(questionId, answers)
        }
        onRejectQuestion={(questionId) => void store.rejectQuestion(questionId)}
      />
      <AgentComposer
        onSend={(text) => void send(text)}
        onStop={() => void store.interrupt(thread.id)}
        busy={busy}
        commands={commands}
        skills={skills}
        providers={providers}
        providerId={thread.providerInstanceId}
        projectPath={projectPath}
        onProviderChange={(providerId) => {
          onProviderChange(providerId);
          setModelKey("");
        }}
        models={models}
        modelKey={modelKey}
        permissionMode={thread.permissionMode}
        onPermissionModeChange={(mode) =>
          void store.setThreadPermissionMode(thread.id, mode)
        }
        onModelChange={(key) => {
          setModelKey(key);
          const model = models.find(
            (entry) => `${entry.providerID}/${entry.modelID}` === key,
          );
          void store.setThreadModel(
            thread.id,
            model
              ? { providerID: model.providerID, modelID: model.modelID }
              : null,
          );
        }}
        providerRunning={Boolean(
          status?.running && status.instanceId === thread.providerInstanceId,
        )}
      />
    </section>
  );
}
