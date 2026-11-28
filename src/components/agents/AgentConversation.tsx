import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { showArcDialog } from "../../lib/dialog";
import type {
  AgentModel,
  AgentModelRef,
  AgentThreadDetail,
  ProviderCommand,
  ProviderSkill,
  ProviderStatus,
} from "../../lib/agents/types";
import { store } from "../../lib/agents/store";
import AgentComposer from "./AgentComposer";
import AgentStatusDot from "./AgentStatusDot";
import AgentTranscript from "./AgentTranscript";

export default function AgentConversation({
  detail,
  projectPath,
  trusted,
  status,
  models,
  commands,
  skills,
  editorWorkspace,
  dirtyPaths,
  confirmDirtyFiles,
  onSaveAllDirty,
  onOpenInEditor,
}: {
  detail: AgentThreadDetail;
  projectPath: string;
  trusted: boolean;
  status: ProviderStatus | null;
  models: AgentModel[];
  commands: ProviderCommand[];
  skills: ProviderSkill[];
  editorWorkspace: string;
  dirtyPaths: string[];
  confirmDirtyFiles: boolean;
  onSaveAllDirty: () => Promise<boolean>;
  onOpenInEditor: (path: string) => void;
}) {
  const thread = detail.thread;
  const [modelKey, setModelKey] = useState(
    thread.model ? `${thread.model.providerID}/${thread.model.modelID}` : "",
  );
  useEffect(() => {
    setModelKey(
      thread.model ? `${thread.model.providerID}/${thread.model.modelID}` : "",
    );
  }, [thread.id, thread.model]);
  const busy = thread.uiStatus === "working";
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
      <header className="agents-conversation-header">
        <div>
          <AgentStatusDot status={thread.uiStatus} />
          <strong>{thread.title}</strong>
          <span className="agents-conversation-provider">
            {thread.providerInstanceId}
          </span>
        </div>
        <div className="agents-conversation-actions">
          <select
            aria-label="Model"
            className="agents-model-select"
            value={modelKey}
            onChange={(event) => setModelKey(event.target.value)}
            disabled={models.length === 0}
          >
            <option value="">
              {status?.running ? "Default model" : "Provider offline"}
            </option>
            {models.map((model) => (
              <option
                key={`${model.providerID}/${model.modelID}`}
                value={`${model.providerID}/${model.modelID}`}
              >
                {model.providerName}: {model.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="action-button action-button--secondary action-button--compact"
            onClick={() => onOpenInEditor(projectPath)}
            title="Open this project in the editor"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </header>
      <AgentTranscript
        items={detail.items}
        approvals={detail.approvals}
        questions={detail.questions}
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
        disabled={!trusted}
        commands={commands}
        skills={skills}
      />
    </section>
  );
}
