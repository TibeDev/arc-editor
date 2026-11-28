import { agentsApi, subscribeAgents } from "./api";
import type {
  AgentApproval,
  AgentItem,
  AgentModel,
  AgentModelRef,
  AgentOption,
  AgentPermissionMode,
  AgentProject,
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

export type AgentsState = {
  loaded: boolean;
  loading: boolean;
  error: string;
  projects: AgentProject[];
  providers: AgentProviderInstance[];
  threads: AgentThreadSummary[];
  activeProjectId: string | null;
  activeThreadId: string | null;
  detail: AgentThreadDetail | null;
  status: ProviderStatus | null;
  models: AgentModel[];
  modelsByProvider: Record<string, AgentModel[]>;
  agentOptions: AgentOption[];
  commands: ProviderCommand[];
  skills: ProviderSkill[];
};

const initialState: AgentsState = {
  loaded: false,
  loading: false,
  error: "",
  projects: [],
  providers: [],
  threads: [],
  activeProjectId: null,
  activeThreadId: null,
  detail: null,
  status: null,
  models: [],
  modelsByProvider: {},
  agentOptions: [],
  commands: [],
  skills: [],
};

let state: AgentsState = initialState;
const subscribers = new Set<() => void>();
let listenersStarted: Promise<void> | null = null;

function setState(patch: Partial<AgentsState>) {
  state = { ...state, ...patch };
  for (const subscriber of subscribers) subscriber();
}

function setIdle(threadId: string) {
  setState({
    threads: state.threads.map((thread) =>
      thread.id === threadId ? { ...thread, uiStatus: "idle" } : thread,
    ),
    detail:
      state.detail?.thread.id === threadId
        ? {
            ...state.detail,
            thread: { ...state.detail.thread, uiStatus: "idle" },
          }
        : state.detail,
  });
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/provider disconnected/i.test(message)) return;
  setState({ error: message });
}

function upsertThread(thread: AgentThread) {
  const existing = state.threads.find((entry) => entry.id === thread.id);
  const summary: AgentThreadSummary = {
    id: thread.id,
    projectId: thread.projectId,
    providerInstanceId: thread.providerInstanceId,
    title: thread.title,
    model: thread.model,
    uiStatus: thread.uiStatus,
    worktreePath: thread.worktreePath,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    hasMessages:
      existing?.hasMessages ??
      (state.detail?.thread.id === thread.id &&
        state.detail.items.some((item) => item.kind === "user")),
  };
  const exists = state.threads.some((entry) => entry.id === thread.id);
  const threads = exists
    ? state.threads.map((entry) => (entry.id === thread.id ? summary : entry))
    : [summary, ...state.threads];
  const detail =
    state.detail && state.detail.thread.id === thread.id
      ? { ...state.detail, thread }
      : state.detail;
  setState({ threads, detail });
}

function upsertRun(run: AgentRun) {
  if (!state.detail || state.detail.thread.id !== run.threadId) return;
  const exists = state.detail.runs.some((entry) => entry.id === run.id);
  const runs = exists
    ? state.detail.runs.map((entry) => (entry.id === run.id ? run : entry))
    : [...state.detail.runs, run];
  setState({ detail: { ...state.detail, runs } });
}

function upsertItem(item: AgentItem) {
  if (!state.detail) return;
  if (item.kind === "user") {
    setState({
      threads: state.threads.map((thread) =>
        thread.id === state.detail?.thread.id && !thread.hasMessages
          ? { ...thread, hasMessages: true }
          : thread,
      ),
    });
  }
  const exists = state.detail.items.some((entry) => entry.id === item.id);
  const items = exists
    ? state.detail.items.map((entry) => (entry.id === item.id ? item : entry))
    : [...state.detail.items, item];
  setState({ detail: { ...state.detail, items } });
}

function upsertApproval(approval: AgentApproval) {
  if (!state.detail) return;
  const exists = state.detail.approvals.some((entry) => entry.id === approval.id);
  const approvals = exists
    ? state.detail.approvals.map((entry) =>
        entry.id === approval.id ? approval : entry,
      )
    : [...state.detail.approvals, approval];
  setState({ detail: { ...state.detail, approvals } });
}

function upsertQuestion(question: AgentQuestion) {
  if (!state.detail) return;
  const exists = state.detail.questions.some((entry) => entry.id === question.id);
  const questions = exists
    ? state.detail.questions.map((entry) =>
        entry.id === question.id ? question : entry,
      )
    : [...state.detail.questions, question];
  setState({ detail: { ...state.detail, questions } });
}

async function startListeners() {
  if (listenersStarted) return listenersStarted;
  listenersStarted = (async () => {
    const unsubscribe = await subscribeAgents({
      onThread: upsertThread,
      onRun: upsertRun,
      onItem: upsertItem,
      onApprovalRequested: upsertApproval,
      onApprovalResolved: upsertApproval,
      onQuestionRequested: upsertQuestion,
      onQuestionResolved: upsertQuestion,
      onProviderStatus: (status) => setState({ status }),
      onNotice: () => {
        void store.refreshProjects();
        void store.refreshThreads();
      },
    });
    // Intentionally keep the subscription for the lifetime of the module.
    void unsubscribe;
  })();
  return listenersStarted;
}

async function loadCatalog(providerId?: string) {
  const provider = providerId
    ? state.providers.find((entry) => entry.id === providerId)
    : (state.providers.find((entry) => entry.id === state.status?.instanceId) ??
      state.providers[0]);
  if (!provider || !state.status?.running) return;
  if (state.status.instanceId !== provider.id) return;
  try {
    const [models, agentOptions, commands, skills] = await Promise.all([
      agentsApi.models(provider.id),
      agentsApi.agents(provider.id),
      agentsApi.commands(provider.id),
      agentsApi.skills(provider.id),
    ]);
    setState({
      models,
      modelsByProvider: { ...state.modelsByProvider, [provider.id]: models },
      agentOptions,
      commands,
      skills,
    });
  } catch {
    setState({
      models: [],
      modelsByProvider: { ...state.modelsByProvider, [provider.id]: [] },
      agentOptions: [],
      commands: [],
      skills: [],
    });
  }
}

async function loadProjectsAndProviders() {
  const [projects, providers] = await Promise.all([
    agentsApi.listProjects(),
    agentsApi.listProviders(),
  ]);
  setState({
    projects,
    providers,
    activeProjectId:
      state.activeProjectId && projects.some((p) => p.id === state.activeProjectId)
        ? state.activeProjectId
        : (projects[0]?.id ?? null),
  });
}

export const store = {
  subscribe(subscriber: () => void) {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  },
  getSnapshot() {
    return state;
  },
  async ensureLoaded() {
    if (state.loaded || state.loading) return;
    setState({ loading: true, error: "" });
    try {
      await startListeners();
      await loadProjectsAndProviders();
      let status: ProviderStatus | null = null;
      try {
        status = await agentsApi.providerStatus();
      } catch {
        status = null;
      }
      setState({ status });
      if (state.activeProjectId) {
        await store.refreshThreads();
        if (state.activeThreadId) await store.openThread(state.activeThreadId);
      }
      setState({ loaded: true, loading: false });
      if (status?.running) void loadCatalog(status.instanceId);
    } catch (error) {
      setState({ loading: false, loaded: true });
      fail(error);
    }
  },
  async refreshProjects() {
    try {
      await loadProjectsAndProviders();
      if (state.activeProjectId) await store.refreshThreads();
    } catch (error) {
      fail(error);
    }
  },
  async refreshThreads() {
    try {
      const threads = await agentsApi.listThreads(state.activeProjectId ?? undefined);
      const activeThreadId = state.activeThreadId;
      setState({
        threads,
        activeThreadId:
          activeThreadId && threads.some((thread) => thread.id === activeThreadId)
            ? activeThreadId
            : (threads[0]?.id ?? null),
      });
    } catch (error) {
      fail(error);
    }
  },
  async selectProject(projectId: string) {
    setState({ activeProjectId: projectId, activeThreadId: null, detail: null });
    await store.refreshThreads();
    if (state.activeThreadId) await store.openThread(state.activeThreadId);
  },
  async addProject() {
    try {
      const path = await agentsApi.pickProject();
      if (!path) return;
      const project = await agentsApi.addProject(path);
      await store.refreshProjects();
      await store.selectProject(project.id);
      setState({ error: "" });
    } catch (error) {
      fail(error);
    }
  },
  async removeProject(projectId: string) {
    try {
      await agentsApi.removeProject(projectId);
      await store.refreshProjects();
      if (state.activeProjectId === projectId) {
        setState({ activeProjectId: null, activeThreadId: null, detail: null });
      }
      setState({ error: "" });
    } catch (error) {
      fail(error);
    }
  },
  async setTrust(projectId: string, trusted: boolean) {
    try {
      const project = await agentsApi.setProjectTrust(projectId, trusted);
      setState({
        projects: state.projects.map((entry) =>
          entry.id === project.id ? project : entry,
        ),
        error: "",
      });
    } catch (error) {
      fail(error);
    }
  },
  async createThread(providerId?: string, model?: AgentModelRef) {
    const projectId = state.activeProjectId;
    const provider = providerId
      ? state.providers.find((entry) => entry.id === providerId)
      : (state.providers.find((entry) => entry.id === state.status?.instanceId) ??
        state.providers[0]);
    if (!projectId || !provider) return;
    try {
      const thread = await agentsApi.createThread(projectId, provider.id, model);
      upsertThread(thread);
      setState({ activeThreadId: thread.id });
      await store.openThread(thread.id);
      setState({ error: "" });
    } catch (error) {
      fail(error);
    }
  },
  async openThread(threadId: string) {
    setState({ activeThreadId: threadId });
    try {
      const detail = await agentsApi.openThread(threadId);
      setState({
        detail,
        error: "",
        threads: state.threads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                hasMessages: detail.items.some((item) => item.kind === "user"),
              }
            : thread,
        ),
      });
    } catch (error) {
      fail(error);
    }
  },
  async setThreadModel(threadId: string, model: AgentModelRef | null) {
    try {
      const thread = await agentsApi.setThreadModel(threadId, model);
      upsertThread(thread);
    } catch (error) {
      fail(error);
    }
  },
  async setThreadPermissionMode(threadId: string, mode: AgentPermissionMode) {
    try {
      const thread = await agentsApi.setThreadPermissionMode(threadId, mode);
      upsertThread(thread);
    } catch (error) {
      fail(error);
    }
  },
  async setThreadProvider(threadId: string, providerId: string) {
    try {
      const thread = await agentsApi.setThreadProvider(threadId, providerId);
      upsertThread(thread);
      setState({ models: state.modelsByProvider[providerId] ?? [] });
    } catch (error) {
      fail(error);
      throw error;
    }
  },
  async ensureModels(providerId: string) {
    if (!providerId || state.modelsByProvider[providerId]) return;
    if (!state.status?.running || state.status.instanceId !== providerId) {
      await store.startProvider(providerId);
      return;
    }
    await loadCatalog(providerId);
  },
  async renameThread(threadId: string, title: string) {
    try {
      await agentsApi.renameThread(threadId, title);
      await store.refreshThreads();
    } catch (error) {
      fail(error);
    }
  },
  async archiveThread(threadId: string, archived: boolean) {
    try {
      await agentsApi.archiveThread(threadId, archived);
      await store.refreshThreads();
      if (archived && state.activeThreadId === threadId) {
        setState({ activeThreadId: null, detail: null });
      }
    } catch (error) {
      fail(error);
    }
  },
  async deleteThread(threadId: string) {
    try {
      await agentsApi.deleteThread(threadId);
      if (state.activeThreadId === threadId) {
        setState({ activeThreadId: null, detail: null });
      }
      await store.refreshThreads();
    } catch (error) {
      fail(error);
    }
  },
  async startProvider(providerId?: string) {
    try {
      const status = await agentsApi.providerStart(providerId);
      setState({ status, error: "" });
      await loadCatalog(status.instanceId);
    } catch (error) {
      fail(error);
      try {
        setState({ status: await agentsApi.providerStatus() });
      } catch {
        // Keep the previous status.
      }
    }
  },
  async stopProvider() {
    try {
      setState({ status: await agentsApi.providerStop(), error: "" });
    } catch (error) {
      fail(error);
    }
  },
  async restartProvider(providerId?: string) {
    try {
      const status = await agentsApi.providerRestart(providerId);
      setState({ status, error: "" });
      await loadCatalog(status.instanceId);
    } catch (error) {
      fail(error);
    }
  },
  async send(threadId: string, text: string, model?: AgentModelRef) {
    setState({
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, uiStatus: "working" } : thread,
      ),
      detail:
        state.detail?.thread.id === threadId
          ? {
              ...state.detail,
              thread: { ...state.detail.thread, uiStatus: "working" },
            }
          : state.detail,
    });
    const providerId = state.threads.find((thread) => thread.id === threadId)
      ?.providerInstanceId;
    if (!state.status?.running || state.status.instanceId !== providerId) {
      await store.startProvider(providerId);
    }
    try {
      await agentsApi.send(threadId, text, model);
      setState({ error: "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const providerFailure =
        /not running|unavailable|connection refused|health check|disconnected/i.test(
          message,
        );
      if (!providerFailure) {
        setIdle(threadId);
        fail(error);
        throw error;
      }
      try {
        const status = await agentsApi.providerRestart(providerId);
        setState({ status });
        await loadCatalog(status.instanceId);
        await agentsApi.send(threadId, text, model);
        setState({ error: "" });
      } catch (retryError) {
        setIdle(threadId);
        fail(retryError);
        throw retryError;
      }
    }
  },
  async interrupt(threadId: string) {
    try {
      await agentsApi.interrupt(threadId);
    } catch (error) {
      fail(error);
    }
  },
  async respondApproval(
    approvalId: string,
    decision: "once" | "always" | "reject",
  ) {
    try {
      await agentsApi.respondApproval(approvalId, decision);
    } catch (error) {
      fail(error);
    }
  },
  async respondQuestion(questionId: string, answers: unknown) {
    try {
      await agentsApi.respondQuestion(questionId, answers);
    } catch (error) {
      fail(error);
    }
  },
  async rejectQuestion(questionId: string) {
    try {
      await agentsApi.rejectQuestion(questionId);
    } catch (error) {
      fail(error);
    }
  },
  clearError() {
    setState({ error: "" });
  },
};
