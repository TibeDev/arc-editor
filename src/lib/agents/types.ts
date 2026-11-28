export type AgentProject = {
  id: string;
  path: string;
  name: string;
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentProviderInstance = {
  id: string;
  driver: "opencode" | "codex" | "claude";
  label: string;
  binaryPath?: string;
  configDir?: string;
  createdAt: string;
};

export type AgentModelRef = {
  providerID: string;
  modelID: string;
};

export type AgentUiStatus = "idle" | "working" | "needs-input" | "done" | "error";

export type AgentPermissionMode = "supervised" | "smart" | "yolo";

export type AgentThread = {
  id: string;
  projectId: string;
  providerInstanceId: string;
  title: string;
  model?: AgentModelRef;
  permissionMode: AgentPermissionMode;
  nativeSessionId?: string;
  worktreePath?: string;
  uiStatus: AgentUiStatus;
  createdAt: string;
  updatedAt: string;
  lastVisitedAt?: string;
  archivedAt?: string;
};

export type AgentThreadSummary = Pick<
  AgentThread,
  | "id"
  | "projectId"
  | "providerInstanceId"
  | "title"
  | "model"
  | "uiStatus"
  | "worktreePath"
  | "updatedAt"
  | "archivedAt"
> & { hasMessages: boolean };

export type AgentRun = {
  id: string;
  threadId: string;
  status: "starting" | "running" | "waiting" | "completed" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  error?: string;
};

export type AgentItem = {
  id: string;
  runId: string;
  kind: "user" | "assistant" | "tool" | "info" | "error";
  text?: string;
  reasoning?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  status?: "running" | "success" | "failed";
  message?: string;
  createdAt: string;
};

export type AgentApproval = {
  id: string;
  threadId: string;
  runId: string;
  providerRequestId: string;
  title: string;
  detail: string;
  action?: string;
  resources?: string[];
  decision?: "once" | "always" | "reject" | "expired";
  createdAt: string;
  resolvedAt?: string;
};

export type AgentQuestionOption = {
  label: string;
  description?: string;
};

export type AgentQuestionPrompt = {
  id: string;
  header: string;
  question: string;
  options?: AgentQuestionOption[];
  multiple?: boolean;
};

export type AgentQuestion = {
  id: string;
  threadId: string;
  runId: string;
  providerRequestId: string;
  questions: AgentQuestionPrompt[];
  answers?: unknown;
  status: "pending" | "answered" | "rejected" | "expired";
  createdAt: string;
};

export type AgentThreadDetail = {
  thread: AgentThread;
  runs: AgentRun[];
  items: AgentItem[];
  approvals: AgentApproval[];
  questions: AgentQuestion[];
};

export type AgentModel = {
  providerID: string;
  modelID: string;
  name: string;
  providerName: string;
};

export type AgentOption = {
  id: string;
  name: string;
  description?: string;
};

export type ProviderCommand = {
  name: string;
  description?: string;
};

export type ProviderSkill = {
  name: string;
  description?: string;
};

export type ProviderStatus = {
  instanceId: string;
  driver: string;
  running: boolean;
  version?: string;
  binaryPath?: string;
  error?: string;
  activeRuns: number;
  startedAt?: string;
};
