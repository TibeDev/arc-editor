import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentApproval,
  AgentItem,
  AgentModel,
  AgentModelRef,
  AgentOption,
  AgentProject,
  AgentPermissionMode,
  AgentProviderInstance,
  AgentQuestion,
  AgentRun,
  AgentThread,
  AgentThreadDetail,
  AgentThreadSummary,
  ProviderCommand,
  ProviderSkill,
  ProviderStatus,
} from "./types";

export const agentsApi = {
  listProjects: () => invoke<AgentProject[]>("agent_project_list"),
  pickProject: () => invoke<string | null>("agent_project_pick"),
  addProject: (path: string) => invoke<AgentProject>("agent_project_add", { path }),
  removeProject: (projectId: string) =>
    invoke<void>("agent_project_remove", { projectId }),
  setProjectTrust: (projectId: string, trusted: boolean) =>
    invoke<AgentProject>("agent_project_set_trust", { projectId, trusted }),
  listProviders: () => invoke<AgentProviderInstance[]>("agent_provider_list"),
  providerStatus: () => invoke<ProviderStatus>("agent_provider_status"),
  providerStart: (providerInstanceId?: string) =>
    invoke<ProviderStatus>("agent_provider_start", {
      providerInstanceId: providerInstanceId ?? null,
    }),
  providerStop: () => invoke<ProviderStatus>("agent_provider_stop"),
  providerRestart: (providerInstanceId?: string) =>
    invoke<ProviderStatus>("agent_provider_restart", {
      providerInstanceId: providerInstanceId ?? null,
    }),
  listThreads: (projectId?: string) =>
    invoke<AgentThreadSummary[]>("agent_thread_list", {
      projectId: projectId ?? null,
    }),
  createThread: (
    projectId: string,
    providerInstanceId: string,
    model?: AgentModelRef,
  ) =>
    invoke<AgentThread>("agent_thread_create", {
      projectId,
      providerInstanceId,
      model: model ?? null,
    }),
  openThread: (threadId: string) =>
    invoke<AgentThreadDetail>("agent_thread_open", { threadId }),
  renameThread: (threadId: string, title: string) =>
    invoke<void>("agent_thread_rename", { threadId, title }),
  setThreadModel: (threadId: string, model: AgentModelRef | null) =>
    invoke<AgentThread>("agent_thread_set_model", { threadId, model }),
  setThreadPermissionMode: (threadId: string, mode: AgentPermissionMode) =>
    invoke<AgentThread>("agent_thread_set_permission_mode", { threadId, mode }),
  setThreadProvider: (threadId: string, providerInstanceId: string) =>
    invoke<AgentThread>("agent_thread_set_provider", {
      threadId,
      providerInstanceId,
    }),
  archiveThread: (threadId: string, archived: boolean) =>
    invoke<void>("agent_thread_archive", { threadId, archived }),
  deleteThread: (threadId: string) =>
    invoke<void>("agent_thread_delete", { threadId }),
  send: (threadId: string, text: string, model?: AgentModelRef) =>
    invoke<string>("agent_thread_send", {
      threadId,
      text,
      model: model ?? null,
    }),
  interrupt: (threadId: string) =>
    invoke<void>("agent_thread_interrupt", { threadId }),
  models: (providerInstanceId: string) =>
    invoke<AgentModel[]>("agent_model_list", { providerInstanceId }),
  agents: (providerInstanceId: string) =>
    invoke<AgentOption[]>("agent_agent_list", { providerInstanceId }),
  commands: (providerInstanceId: string) =>
    invoke<ProviderCommand[]>("agent_command_list", { providerInstanceId }),
  skills: (providerInstanceId: string) =>
    invoke<ProviderSkill[]>("agent_skill_list", { providerInstanceId }),
  respondApproval: (
    approvalId: string,
    decision: "once" | "always" | "reject",
    feedback?: string,
  ) =>
    invoke<void>("agent_approval_respond", {
      approvalId,
      decision,
      feedback: feedback ?? null,
    }),
  respondQuestion: (questionId: string, answers: unknown) =>
    invoke<void>("agent_question_respond", { questionId, answers }),
  rejectQuestion: (questionId: string) =>
    invoke<void>("agent_question_reject", { questionId }),
  reconcile: () => invoke<void>("agent_reconcile"),
};

export type AgentsEventHandlers = {
  onThread?: (thread: AgentThread) => void;
  onRun?: (run: AgentRun) => void;
  onItem?: (item: AgentItem) => void;
  onApprovalRequested?: (approval: AgentApproval) => void;
  onApprovalResolved?: (approval: AgentApproval) => void;
  onQuestionRequested?: (question: AgentQuestion) => void;
  onQuestionResolved?: (question: AgentQuestion) => void;
  onProviderStatus?: (status: ProviderStatus) => void;
  onNotice?: (notice: { kind?: string }) => void;
};

export async function subscribeAgents(
  handlers: AgentsEventHandlers,
): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [];
  const add = async <T,>(
    name: string,
    callback: (payload: T) => void,
  ): Promise<void> => {
    unlisteners.push(await listen<T>(name, (event) => callback(event.payload)));
  };
  if (handlers.onThread) await add("agent://thread-updated", handlers.onThread);
  if (handlers.onRun) await add("agent://run-updated", handlers.onRun);
  if (handlers.onItem) await add("agent://item-updated", handlers.onItem);
  if (handlers.onApprovalRequested)
    await add("agent://approval-requested", handlers.onApprovalRequested);
  if (handlers.onApprovalResolved)
    await add("agent://approval-resolved", handlers.onApprovalResolved);
  if (handlers.onQuestionRequested)
    await add("agent://question-requested", handlers.onQuestionRequested);
  if (handlers.onQuestionResolved)
    await add("agent://question-resolved", handlers.onQuestionResolved);
  if (handlers.onProviderStatus)
    await add("agent://provider-status", handlers.onProviderStatus);
  if (handlers.onNotice) await add("agent://notice", handlers.onNotice);
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}
