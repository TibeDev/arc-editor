import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ArrowDownToLine, ArrowUpFromLine, Check, ExternalLink, Frown, GitBranch, Github,
  LoaderCircle, Plus, RefreshCw, Upload,
} from "lucide-react";
import "./GithubPanel.css";
import "./GithubPanel.controls.css";
import "./GithubPanel.updates.css";
import "./GithubPanel.auth.css";
import "./GithubPanel.setup.css";
import "./GithubPanel.layout.css";
import { forgetTerminalOutput, subscribeTerminalOutput, terminalOutputReady } from "./terminalOutput";

type GithubChange = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
};

type GithubStatus = {
  platform: string;
  gitInstalled: boolean;
  ghInstalled: boolean;
  authenticated: boolean;
  isRepo: boolean;
  isGithubRepo: boolean;
  branch: string | null;
  branches: string[];
  remote: string | null;
  repoUrl: string | null;
  ahead: number;
  behind: number;
  changes: GithubChange[];
  userName: string;
  userEmail: string;
};

const githubStatusCache = new Map<string, GithubStatus>();
const githubLoadedWorkspaces = new Set<string>();
const githubFailedWorkspaces = new Set<string>();
const githubPendingLoads = new Map<string, Promise<void>>();
const githubWorkspaceOrder: string[] = [];
const GITHUB_WORKSPACE_CACHE_LIMIT = 6;

function touchGithubWorkspace(workspace: string) {
  const index = githubWorkspaceOrder.indexOf(workspace);
  if (index >= 0) githubWorkspaceOrder.splice(index, 1);
  githubWorkspaceOrder.push(workspace);
  while (githubWorkspaceOrder.length > GITHUB_WORKSPACE_CACHE_LIMIT) {
    const oldest = githubWorkspaceOrder.shift();
    if (oldest === undefined) break;
    githubStatusCache.delete(oldest);
    githubLoadedWorkspaces.delete(oldest);
    githubFailedWorkspaces.delete(oldest);
  }
}

type SetupPlatform = "windows" | "linux" | "macos";
type LinuxDistro = "debian" | "fedora" | "arch" | "opensuse" | "alpine" | "other";

const linuxCommands: Record<LinuxDistro, { git: string; gh: string }> = {
  debian: { git: "sudo apt install git", gh: "sudo apt install gh" },
  fedora: { git: "sudo dnf install git", gh: "sudo dnf install gh" },
  arch: { git: "sudo pacman -S git", gh: "sudo pacman -S github-cli" },
  opensuse: { git: "sudo zypper install git", gh: "sudo zypper install gh" },
  alpine: { git: "sudo apk add git", gh: "sudo apk add github-cli" },
  other: { git: "", gh: "" },
};

function SetupRequirement({ name, command, url, onOpen }: {
  name: string;
  command: string;
  url: string;
  onOpen: (url: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return <div className="github-setup-requirement">
    <div className="github-setup-requirement-heading"><strong>{name}</strong><span>Required</span></div>
    {command && <div className="github-install-command"><code>{command}</code><button className="github-secondary" onClick={() => void writeText(command).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "Copied" : "Copy"}</button></div>}
    <button className="github-text-button" onClick={() => onOpen(url)}>Official installation instructions <ExternalLink size={12} /></button>
  </div>;
}

export default function GithubPanel({ workspace }: { workspace: string }) {
  const [status, setStatus] = useState<GithubStatus | null>(() => githubStatusCache.get(workspace) ?? null);
  const [loading, setLoading] = useState(() => !githubLoadedWorkspaces.has(workspace) && !githubFailedWorkspaces.has(workspace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionFailed, setConnectionFailed] = useState(() => githubFailedWorkspaces.has(workspace));
  const [notice, setNotice] = useState("");
  const [repoName, setRepoName] = useState(workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? "my-project");
  const [visibility, setVisibility] = useState("private");
  const [gitName, setGitName] = useState("");
  const [gitEmail, setGitEmail] = useState("");
  const [branchName, setBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [authSessionId, setAuthSessionId] = useState<string | null>(null);
  const [authDeviceCode, setAuthDeviceCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [platformOverride, setPlatformOverride] = useState<SetupPlatform | "">("");
  const [linuxDistro, setLinuxDistro] = useState<LinuxDistro>("debian");
  const authSession = useRef<{ id: string; unsubscribe: () => void; enterSent: boolean } | null>(null);
  const authOutput = useRef("");
  const requestRef = useRef(0);

  const refresh = useCallback(async (fetchRemote = false): Promise<GithubStatus | null> => {
    const requestId = ++requestRef.current;
    const isCurrent = () => requestRef.current === requestId;
    if (!isTauri()) {
      githubLoadedWorkspaces.add(workspace);
      githubFailedWorkspaces.add(workspace);
      setConnectionFailed(true);
      setLoading(false);
      return null;
    }
    setError("");
    try {
      let next = await invoke<GithubStatus>("github_status", { root: workspace });
      if (!isCurrent()) return next;
      githubStatusCache.set(workspace, next);
      githubLoadedWorkspaces.add(workspace);
      githubFailedWorkspaces.delete(workspace);
      setConnectionFailed(false);
      setStatus(next);
      setLoading(false);
      setGitName((value) => value || next.userName);
      setGitEmail((value) => value || next.userEmail);
      if (fetchRemote && next.isGithubRepo && next.authenticated) {
        try {
          await invoke("github_fetch", { root: workspace });
          next = await invoke<GithubStatus>("github_status", { root: workspace });
          if (!isCurrent()) return next;
          githubStatusCache.set(workspace, next);
          setStatus(next);
          setGitName((value) => value || next.userName);
          setGitEmail((value) => value || next.userEmail);
        } catch (cause) {
          if (isCurrent()) setError(`Could not fetch from GitHub: ${String(cause)}`);
          return null;
        }
      }
      return next;
    } catch (cause) {
      if (isCurrent()) {
        githubLoadedWorkspaces.add(workspace);
        githubFailedWorkspaces.add(workspace);
        setError(String(cause));
        setConnectionFailed(true);
      }
      return null;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [workspace]);

  const finishAuth = useCallback(async (id: string) => {
    const session = authSession.current;
    if (!session || session.id !== id) return;
    session.unsubscribe();
    authSession.current = null;
    setAuthSessionId(null);
    await invoke("terminal_close", { id }).catch(() => undefined);
    forgetTerminalOutput(id);
    const next = await refresh();
    if (next?.authenticated) setNotice("GitHub account connected.");
  }, [refresh]);

  useEffect(() => {
    if (!authSessionId) return;
    const interval = window.setInterval(() => {
      void invoke<GithubStatus>("github_status", { root: workspace }).then((next) => {
        if (next.authenticated) void finishAuth(authSessionId);
      }).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [authSessionId, finishAuth, workspace]);

  useEffect(() => () => {
    const session = authSession.current;
    if (!session) return;
    session.unsubscribe();
    void invoke("terminal_close", { id: session.id });
    forgetTerminalOutput(session.id);
    authSession.current = null;
  }, []);

  const beginAuth = async () => {
    const id = `github-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    authOutput.current = "";
    setAuthDeviceCode("");
    setAuthError("");
    setNotice("");
    setBusy(true);
    try {
      await terminalOutputReady();
      const unsubscribe = subscribeTerminalOutput(id, (data) => {
        authOutput.current = `${authOutput.current}${data}`.slice(-12000);
        const plain = authOutput.current
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/\r/g, "\n");
        const match = plain.match(/one-time code\s*:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)
          ?? plain.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/i);
        const session = authSession.current;
        if (match && session?.id === id) {
          setAuthDeviceCode(match[1].toUpperCase());
          if (!session.enterSent) {
            session.enterSent = true;
            void invoke("terminal_write", { id, data: "\r" });
          }
        }
        if (plain.includes("__ARC_GH_AUTH_FAILED__")) {
          setAuthError("GitHub sign-in did not complete. Try again.");
        }
      });
      authSession.current = { id, unsubscribe, enterSent: false };
      setAuthSessionId(id);
      await invoke("terminal_spawn", {
        id,
        cwd: workspace || null,
        command: "gh auth login --hostname github.com --git-protocol https --web && echo __ARC_GH_AUTH_DONE__ || echo __ARC_GH_AUTH_FAILED__",
      });
    } catch (cause) {
      authSession.current?.unsubscribe();
      authSession.current = null;
      setAuthSessionId(null);
      setAuthError(String(cause));
      await invoke("terminal_close", { id }).catch(() => undefined);
      forgetTerminalOutput(id);
    } finally {
      setBusy(false);
    }
  };

  const cancelAuth = async () => {
    const session = authSession.current;
    if (!session) return;
    session.unsubscribe();
    authSession.current = null;
    setAuthSessionId(null);
    await invoke("terminal_close", { id: session.id }).catch(() => undefined);
    forgetTerminalOutput(session.id);
  };

  const checkForUpdates = useCallback(async () => {
    setBusy(true);
    setNotice("");
    try {
      const next = await refresh(true);
      if (next?.isGithubRepo && next.authenticated) {
        setNotice(next.behind > 0
          ? `${next.behind} new commit${next.behind === 1 ? "" : "s"} available to pull.`
          : "No new commits available to pull.");
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  useEffect(() => {
    touchGithubWorkspace(workspace);
    setRepoName(workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? "my-project");
    const cached = githubStatusCache.get(workspace) ?? null;
    const loaded = githubLoadedWorkspaces.has(workspace);
    const failed = githubFailedWorkspaces.has(workspace);
    const pending = githubPendingLoads.get(workspace);
    if (cached || loaded || failed) {
      setStatus(cached);
      setConnectionFailed(failed);
      setLoading(false);
    }
    if (pending) {
      setLoading(!cached && !loaded && !failed);
      const restoreCachedStatus = () => {
        setStatus(githubStatusCache.get(workspace) ?? null);
        setConnectionFailed(githubFailedWorkspaces.has(workspace));
        setLoading(false);
      };
      void pending.then(restoreCachedStatus, restoreCachedStatus);
      return;
    }
    setLoading(!cached && !loaded && !failed);
    const request = refresh(false).then(() => undefined);
    githubPendingLoads.set(workspace, request);
    void request.then(() => {
      if (githubPendingLoads.get(workspace) === request) githubPendingLoads.delete(workspace);
    }, () => {
      if (githubPendingLoads.get(workspace) === request) githubPendingLoads.delete(workspace);
    });
  }, [refresh, workspace]);

  const perform = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const stageAll = async () => {
    if (!status) return;
    const shouldStage = status.changes.some((change) => !change.staged);
    await perform(async () => {
      for (const change of status.changes) {
        if (!shouldStage && !change.staged) continue;
        await invoke("github_stage", { root: workspace, path: change.path, stage: shouldStage });
      }
    });
  };

  const openLink = async (url: string) => {
    try {
      await openUrl(url);
    } catch (cause) {
      setError(`Could not open browser: ${String(cause)}`);
    }
  };

  const detectedPlatform: SetupPlatform = status?.platform === "windows"
    ? "windows"
    : status?.platform === "macos" ? "macos" : "linux";
  const setupPlatform = platformOverride || detectedPlatform;
  const setupCommands = setupPlatform === "windows"
    ? { git: "winget install --id Git.Git -e", gh: "winget install --id GitHub.cli -e" }
    : setupPlatform === "macos"
      ? { git: "xcode-select --install", gh: "brew install gh" }
      : linuxCommands[linuxDistro];
  const gitInstallUrl = setupPlatform === "windows"
    ? "https://git-scm.com/download/win"
    : setupPlatform === "macos" ? "https://git-scm.com/download/mac" : "https://git-scm.com/download/linux";
  const ghInstallUrl = setupPlatform === "windows"
    ? "https://github.com/cli/cli/blob/trunk/docs/install_windows.md"
    : setupPlatform === "macos" ? "https://cli.github.com/manual/installation" : "https://github.com/cli/cli/blob/trunk/docs/install_linux.md";

  const displayedRepoName = status?.repoUrl
    ?.replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "") ?? repoName;

  return <div className="github-panel" style={{ backgroundColor: "var(--bg, #111315)" }}>
    <header className="github-header">
      <div className="github-heading"><GitBranch size={17} /><strong title={displayedRepoName}>{displayedRepoName}</strong></div>
      <div className="github-header-actions">
        {status?.repoUrl && <button className="github-icon-button" title="Open repository in browser" aria-label="Open repository in browser" onClick={() => void openLink(status.repoUrl!)}><ExternalLink size={15} /></button>}
        <button className="github-icon-button" title="Fetch and refresh repository" aria-label="Fetch and refresh repository" disabled={busy} onClick={() => void checkForUpdates()}>{busy ? <LoaderCircle size={15} className="github-spin" /> : <RefreshCw size={15} />}</button>
      </div>
    </header>

    {loading ? <div className="github-loading"><LoaderCircle size={17} className="github-spin" /> Checking GitHub setup…</div>
      : connectionFailed ? <div className="github-unavailable"><Frown size={30} /><span>Couldn’t connect to GitHub</span></div>
        : <>
    {error && <div className="github-feedback error">{error}</div>}
    {notice && <div className="github-feedback success">{notice}</div>}

    {!status?.gitInstalled || !status.ghInstalled ? <section className="github-setup-card github-setup-guide">
      <div className="github-setup-icon"><Github size={22} /></div>
      <h2>Set up GitHub tools</h2>
      <p>Install Git and GitHub CLI, then restart Arc. Choose your operating system for matching instructions.</p>
      <label className="github-field"><span>Operating system</span><select value={setupPlatform} onChange={(event) => setPlatformOverride(event.target.value as SetupPlatform)}>
        <option value="windows">Windows</option><option value="linux">Linux</option><option value="macos">macOS</option>
      </select></label>
      {setupPlatform === "linux" && <label className="github-field"><span>Linux distribution</span><select value={linuxDistro} onChange={(event) => setLinuxDistro(event.target.value as LinuxDistro)}>
        <option value="debian">Ubuntu / Debian</option><option value="fedora">Fedora</option><option value="arch">Arch / Manjaro</option><option value="opensuse">openSUSE</option><option value="alpine">Alpine</option><option value="other">Other distribution</option>
      </select></label>}
      {!status?.gitInstalled && <SetupRequirement name={setupPlatform === "windows" ? "Git for Windows" : "Git"} command={setupCommands.git} url={gitInstallUrl} onOpen={(url) => void openLink(url)} />}
      {!status?.ghInstalled && <SetupRequirement name="GitHub CLI" command={setupCommands.gh} url={ghInstallUrl} onOpen={(url) => void openLink(url)} />}
      {setupPlatform === "linux" && <span className="github-help">Package names and commands can vary by distribution version. Official instructions cover additional distros.</span>}
    </section> : !status.authenticated ? <section className="github-setup-card">
      <div className="github-setup-icon"><Github size={24} /></div>
      <h2>Set up GitHub with Arc</h2>
      {authSessionId ? <div className="github-auth-flow">
        <p>{authDeviceCode ? "Enter this one-time code on GitHub:" : "Starting secure GitHub sign-in…"}</p>
        {authDeviceCode && <div className="github-device-code"><code>{authDeviceCode}</code><button className="github-secondary" onClick={() => void writeText(authDeviceCode).then(() => setNotice("Device code copied." )).catch((cause) => setAuthError(String(cause)))}>Copy code</button></div>}
        <span className="github-help">Browser opens automatically. Arc waits here until you approve sign-in.</span>
        {authDeviceCode && <button className="github-secondary" onClick={() => void openLink("https://github.com/login/device")}><ExternalLink size={13} /> Open GitHub device page</button>}
        {authError && <span className="github-auth-error">{authError}</span>}
        <button className="github-text-button" onClick={() => void cancelAuth()}>Cancel sign-in</button>
      </div> : <>
        <p>Sign in once. Arc completes GitHub’s device authorization inside this panel.</p>
        <button className="github-primary" disabled={busy} onClick={() => void beginAuth()}>{busy ? <LoaderCircle size={14} className="github-spin" /> : <Github size={15} />} Sign in to GitHub</button>
        {authError && <span className="github-auth-error">{authError}</span>}
      </>}
    </section> : !status.isGithubRepo ? <>
      {!status.userName || !status.userEmail ? <IdentitySetup
        name={gitName}
        email={gitEmail}
        disabled={busy}
        onName={setGitName}
        onEmail={setGitEmail}
        onSave={() => void perform(() => invoke("github_configure_identity", { name: gitName, email: gitEmail }), "Git identity saved.")}
      /> : null}
      <section className="github-setup-card publish-card">
        <div className="github-setup-icon"><Upload size={22} /></div>
        <h2>{status.isRepo ? "Publish this repository" : "Create a GitHub repository"}</h2>
        <p>{status.isRepo
          ? "This folder has Git history but no GitHub remote. Create a repository and connect it."
          : "Create a GitHub repository from this folder. Arc initializes Git when needed."}</p>
        <label className="github-field"><span>Repository name</span><input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="my-project" /></label>
        <label className="github-field"><span>Visibility</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">Private</option><option value="public">Public</option></select></label>
        <button className="github-primary" disabled={busy || !repoName.trim()} onClick={() => void perform(
          () => invoke("github_create_repo", { root: workspace, name: repoName.trim(), visibility }),
          "GitHub repository created.",
        )}>{busy ? <LoaderCircle size={14} className="github-spin" /> : <Plus size={14} />} Create repository</button>
      </section>
    </> : <>
      {status.behind > 0 && <div className="github-incoming-banner">
        <ArrowDownToLine size={15} />
        <span><strong>{status.behind} new commit{status.behind === 1 ? "" : "s"}</strong> available to pull from GitHub.</span>
        <button className="github-secondary" disabled={busy} onClick={() => void perform(() => invoke("github_pull", { root: workspace }), "Pulled changes.")}>Pull now</button>
      </div>}
      {status.ahead > 0 && <div className="github-feedback"><ArrowUpFromLine size={14} /> <strong>{status.ahead} local commit{status.ahead === 1 ? "" : "s"}</strong> ready to push.</div>}
      {status.remote && status.ahead === 0 && status.behind === 0 && <div className="github-feedback success">Branch is up to date with GitHub.</div>}

      {!status.userName || !status.userEmail ? <IdentitySetup
        name={gitName}
        email={gitEmail}
        disabled={busy}
        onName={setGitName}
        onEmail={setGitEmail}
        onSave={() => void perform(() => invoke("github_configure_identity", { name: gitName, email: gitEmail }), "Git identity saved.")}
      /> : null}

      <section className="github-section github-branch-row">
        <label className="github-field"><span>Current branch</span><select value={status.branch ?? ""} disabled={busy || !status.branches.length} onChange={(event) => void perform(() => invoke("github_switch_branch", { root: workspace, branch: event.target.value }))}>
          {!status.branch && <option value="">No branch</option>}
          {status.branches.map((branch) => <option value={branch} key={branch}>{branch}</option>)}
        </select></label>
        <div className="github-create-branch"><input value={branchName} onChange={(event) => setBranchName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void perform(async () => { await invoke("github_create_branch", { root: workspace, branch: branchName }); setBranchName(""); }); }} placeholder="New branch" aria-label="New branch name" />
          <button className="github-icon-button" title="Create and switch branch" disabled={busy || !branchName.trim()} onClick={() => void perform(async () => { await invoke("github_create_branch", { root: workspace, branch: branchName }); setBranchName(""); })}><Plus size={15} /></button></div>
      </section>
      <section className="github-sync-row">
        <button className="github-secondary" disabled={busy || !status.remote} onClick={() => void perform(() => invoke("github_pull", { root: workspace }))}><ArrowDownToLine size={14} /> Pull</button>
        <button className="github-primary" disabled={busy || !status.remote || !status.branch} onClick={() => void perform(() => invoke("github_push", { root: workspace }))}><ArrowUpFromLine size={14} /> Push</button>
      </section>

      <section className="github-section github-changes">
        <div className="github-section-heading"><strong>Changes</strong><span>{status.changes.length}</span>
          {status.changes.length > 0 && <button className="github-text-button" disabled={busy} onClick={() => void stageAll()}>{status.changes.every((change) => change.staged) ? "Unstage all" : "Stage all"}</button>}
        </div>
        {status.changes.length ? <div className="github-change-list">{status.changes.map((change) => <label className="github-change" key={change.path} title={change.path}>
          <input type="checkbox" checked={change.staged} disabled={busy} onChange={(event) => void perform(() => invoke("github_stage", { root: workspace, path: change.path, stage: event.target.checked }))} />
          <span className={`github-change-status ${change.status.toLowerCase()}`}>{change.status.slice(0, 1)}</span>
          <span className="github-change-path">{change.path}</span>
          <span className="github-change-kind">{change.staged && change.unstaged ? "Staged + modified" : change.status}</span>
        </label>)}</div> : <div className="github-empty-changes"><Check size={15} /> No local changes</div>}
      </section>

      <section className="github-commit-section">
        <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Summary (required)" aria-label="Commit summary" />
        <textarea value={commitDescription} onChange={(event) => setCommitDescription(event.target.value)} placeholder="Description (optional)" aria-label="Commit description" rows={3} />
        <button className="github-primary github-commit-button" disabled={busy || !commitMessage.trim() || !status.changes.some((change) => change.staged) || !status.userName || !status.userEmail} onClick={() => void perform(async () => {
          await invoke("github_commit", { root: workspace, message: commitMessage, description: commitDescription });
          setCommitMessage("");
          setCommitDescription("");
        }, "Changes committed.")}>{busy ? <LoaderCircle size={14} className="github-spin" /> : <Check size={14} />} Commit staged changes</button>
      </section>

    </>}
    </>}
  </div>;
}

function IdentitySetup({ name, email, disabled, onName, onEmail, onSave }: {
  name: string;
  email: string;
  disabled: boolean;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onSave: () => void;
}) {
  return <section className="github-identity-card">
    <strong>Set up commit identity</strong>
    <span>Git uses this name and email on your commits. Arc saves them to your global Git config.</span>
    <input value={name} onChange={(event) => onName(event.target.value)} placeholder="Your name" aria-label="Git name" />
    <input value={email} onChange={(event) => onEmail(event.target.value)} placeholder="you@example.com" aria-label="Git email" />
    <button className="github-secondary" disabled={disabled || !name.trim() || !email.trim()} onClick={onSave}>Save identity</button>
  </section>;
}
