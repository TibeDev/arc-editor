use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::process::ProcessManager;

use super::codex::{self, CodexClient};
use super::events;
use super::ids::{iso_now, new_id, random_hex};
use super::opencode::{self, StreamMessage};
use super::permissions::{self, PERMISSION_MODE_SUPERVISED};
use super::provider_process::{self, ServerHandle};
use super::recovery;
use super::store::{
    AgentRecord, AgentStore, ProjectsIndex, ProvidersIndex, ThreadsIndex, INDEX_VERSION,
};
use super::types::*;

const ACTIVE_RUN_STATES: [&str; 3] = ["starting", "running", "waiting"];

pub struct AgentManager {
    inner: Arc<Mutex<AgentState>>,
    provider_lock: Mutex<()>,
}

pub(crate) struct AgentState {
    store: AgentStore,
    projects: Vec<AgentProject>,
    providers: Vec<AgentProviderInstance>,
    threads: Vec<AgentThread>,
    runs: HashMap<String, AgentRun>,
    items: HashMap<String, Vec<AgentItem>>,
    approvals: HashMap<String, AgentApproval>,
    questions: HashMap<String, AgentQuestion>,
    user_message_ids: HashSet<String>,
    loaded_threads: HashSet<String>,
    server: Option<ServerHandle>,
    codex: Option<CodexRuntime>,
    active_provider: Option<String>,
    codex_requests: HashMap<String, Value>,
    codex_questions: HashMap<String, Value>,
    codex_turns: HashMap<String, (String, String)>,
    codex_loaded_threads: HashSet<String>,
    event_stop: Option<Arc<AtomicBool>>,
    event_sender: Option<Sender<StreamMessage>>,
    event_streams: Vec<JoinHandle<()>>,
    consumer_thread: Option<JoinHandle<()>>,
    restart_attempts: Vec<u64>,
    warnings: Vec<String>,
}

struct CodexRuntime {
    client: CodexClient,
    child: Child,
    reader: JoinHandle<()>,
    version: String,
    binary: String,
    managed_id: Option<u64>,
    started_at: String,
}

impl AgentManager {
    fn lock(&self) -> MutexGuard<'_, AgentState> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn active_run(status: &str) -> bool {
    ACTIVE_RUN_STATES.contains(&status)
}

fn fold_records(state: &mut AgentState, thread_id: &str, records: Vec<AgentRecord>) {
    let mut items = state.items.remove(thread_id).unwrap_or_default();
    for record in records {
        match record {
            AgentRecord::Run { run } => {
                state.runs.insert(run.id.clone(), run);
            }
            AgentRecord::Item { item } => {
                if let Some(existing) = items.iter_mut().find(|entry| entry.id == item.id) {
                    *existing = item;
                } else {
                    items.push(item);
                }
            }
            AgentRecord::ItemPatch { id, patch } => {
                if let Some(item) = items.iter_mut().find(|entry| entry.id == id) {
                    if let (Ok(mut value), Value::Object(patch)) =
                        (serde_json::to_value(&*item), patch)
                    {
                        if let Value::Object(map) = &mut value {
                            for (key, entry) in patch {
                                map.insert(key, entry);
                            }
                        }
                        if let Ok(updated) = serde_json::from_value(value) {
                            *item = updated;
                        }
                    }
                }
            }
            AgentRecord::Approval { approval } => {
                state.approvals.insert(approval.id.clone(), approval);
            }
            AgentRecord::ApprovalResolved {
                approval_id,
                decision,
            } => {
                if let Some(approval) = state.approvals.get_mut(&approval_id) {
                    approval.decision = Some(decision);
                    approval.resolved_at = Some(iso_now());
                }
            }
            AgentRecord::Question { question } => {
                state.questions.insert(question.id.clone(), question);
            }
            AgentRecord::QuestionResolved {
                question_id,
                status,
            } => {
                if let Some(question) = state.questions.get_mut(&question_id) {
                    question.status = status;
                }
            }
        }
    }
    if items.len() > 2000 {
        let excess = items.len() - 2000;
        items.drain(0..excess);
    }
    state.items.insert(thread_id.to_string(), items);
    state.loaded_threads.insert(thread_id.to_string());
}

fn ensure_thread_loaded(state: &mut AgentState, thread_id: &str) {
    if state.loaded_threads.contains(thread_id) {
        return;
    }
    match state.store.read_records(thread_id) {
        Ok(records) => fold_records(state, thread_id, records),
        Err(error) => {
            state.warnings.push(error);
            state.loaded_threads.insert(thread_id.to_string());
            state.items.entry(thread_id.to_string()).or_default();
        }
    }
}

fn save_projects(state: &AgentState) -> Result<(), String> {
    state.store.write_index(
        "projects.json",
        &ProjectsIndex {
            version: INDEX_VERSION,
            projects: state.projects.clone(),
        },
    )
}

fn save_providers(state: &AgentState) -> Result<(), String> {
    state.store.write_index(
        "providers.json",
        &ProvidersIndex {
            version: INDEX_VERSION,
            providers: state.providers.clone(),
        },
    )
}

fn save_threads(state: &AgentState) -> Result<(), String> {
    state.store.write_index(
        "threads.json",
        &ThreadsIndex {
            version: INDEX_VERSION,
            threads: state.threads.clone(),
        },
    )
}

impl AgentManager {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
        let store = AgentStore::new(data_dir.join("agent"))?;
        let mut warnings = Vec::new();

        let projects = match store.load_index::<ProjectsIndex>("projects.json") {
            Ok(Some(index)) if index.version <= INDEX_VERSION => index.projects,
            Ok(Some(index)) => {
                return Err(format!(
                    "Agent project index uses unsupported version {}.",
                    index.version
                ))
            }
            Ok(None) => Vec::new(),
            Err(error) => {
                warnings.push(error);
                Vec::new()
            }
        };
        let mut providers = match store.load_index::<ProvidersIndex>("providers.json") {
            Ok(Some(index)) if index.version <= INDEX_VERSION => index.providers,
            Ok(Some(index)) => {
                return Err(format!(
                    "Agent provider index uses unsupported version {}.",
                    index.version
                ))
            }
            Ok(None) => Vec::new(),
            Err(error) => {
                warnings.push(error);
                Vec::new()
            }
        };
        let threads = match store.load_index::<ThreadsIndex>("threads.json") {
            Ok(Some(index)) if index.version <= INDEX_VERSION => index.threads,
            Ok(Some(index)) => {
                return Err(format!(
                    "Agent thread index uses unsupported version {}.",
                    index.version
                ))
            }
            Ok(None) => Vec::new(),
            Err(error) => {
                warnings.push(error);
                Vec::new()
            }
        };

        if !providers
            .iter()
            .any(|provider| provider.driver == "opencode")
        {
            providers.push(AgentProviderInstance {
                id: "opencode-default".to_string(),
                driver: "opencode".to_string(),
                label: "OpenCode".to_string(),
                binary_path: None,
                config_dir: None,
                created_at: iso_now(),
            });
        }
        if !providers.iter().any(|provider| provider.driver == "codex") {
            providers.push(AgentProviderInstance {
                id: "codex-default".to_string(),
                driver: "codex".to_string(),
                label: "Codex".to_string(),
                binary_path: None,
                config_dir: None,
                created_at: iso_now(),
            });
        }

        let mut state = AgentState {
            store,
            projects,
            providers,
            threads,
            runs: HashMap::new(),
            items: HashMap::new(),
            approvals: HashMap::new(),
            questions: HashMap::new(),
            user_message_ids: HashSet::new(),
            loaded_threads: HashSet::new(),
            server: None,
            codex: None,
            active_provider: None,
            codex_requests: HashMap::new(),
            codex_questions: HashMap::new(),
            codex_turns: HashMap::new(),
            codex_loaded_threads: HashSet::new(),
            event_stop: None,
            event_sender: None,
            event_streams: Vec::new(),
            consumer_thread: None,
            restart_attempts: Vec::new(),
            warnings,
        };
        if let Err(error) = save_providers(&state) {
            state.warnings.push(error);
        }
        repair_all(&mut state)?;
        for warning in &state.warnings {
            eprintln!("[agent] warning={warning}");
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(state)),
            provider_lock: Mutex::new(()),
        })
    }
}

fn repair_all(state: &mut AgentState) -> Result<(), String> {
    let thread_ids: Vec<String> = state
        .threads
        .iter()
        .map(|thread| thread.id.clone())
        .collect();
    let mut records: Vec<(String, Vec<AgentRecord>)> = Vec::new();
    for thread_id in &thread_ids {
        ensure_thread_loaded(state, thread_id);
    }
    for thread in &mut state.threads {
        let thread_records =
            recovery::repair_thread(thread, &mut state.runs, &mut state.approvals, &iso_now());
        if !thread_records.is_empty() {
            records.push((thread.id.clone(), thread_records));
        }
    }
    for (thread_id, thread_records) in records {
        for record in thread_records {
            state.store.append_record(&thread_id, &record)?;
        }
    }
    save_threads(state)
}

fn project_path(state: &AgentState, project_id: &str) -> Option<String> {
    state
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| project.path.clone())
}

fn project_trusted(state: &AgentState, project_id: &str) -> bool {
    state
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| project.trusted)
        .unwrap_or(false)
}

fn thread_index(state: &AgentState, thread_id: &str) -> Option<usize> {
    state
        .threads
        .iter()
        .position(|thread| thread.id == thread_id)
}

fn active_run_id(state: &AgentState, thread_id: &str) -> Option<String> {
    state
        .runs
        .values()
        .filter(|run| run.thread_id == thread_id && active_run(run.status.as_str()))
        .max_by_key(|run| run.started_at.clone())
        .map(|run| run.id.clone())
}

fn provider_status(state: &AgentState) -> ProviderStatus {
    let active_id = state
        .active_provider
        .clone()
        .or_else(|| state.providers.first().map(|provider| provider.id.clone()))
        .unwrap_or_default();
    let driver = state
        .providers
        .iter()
        .find(|provider| provider.id == active_id)
        .map(|provider| provider.driver.clone())
        .unwrap_or_else(|| "opencode".to_string());
    let (running, version, binary, started_at) = if let Some(codex) = state.codex.as_ref() {
        (
            true,
            Some(codex.version.clone()),
            Some(codex.binary.clone()),
            Some(codex.started_at.clone()),
        )
    } else if let Some(server) = state.server.as_ref() {
        (
            true,
            Some(server.version.clone()),
            Some(server.binary.clone()),
            Some(server.started_at.clone()),
        )
    } else {
        (false, None, None, None)
    };
    ProviderStatus {
        instance_id: active_id,
        driver,
        running,
        version,
        binary_path: binary,
        error: None,
        active_runs: state
            .runs
            .values()
            .filter(|run| active_run(run.status.as_str()))
            .count(),
        started_at,
    }
}

fn status_payload(state: &AgentState, error: Option<String>) -> ProviderStatus {
    let mut status = provider_status(state);
    status.error = error;
    status
}

#[tauri::command]
pub fn agent_project_list(state: State<'_, AgentManager>) -> Vec<AgentProject> {
    state.lock().projects.clone()
}

#[tauri::command(async)]
pub async fn agent_project_pick(app: AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog().file().set_title("Add project to Agents");
    let folder = if let Some(window) = app.get_webview_window("main") {
        dialog.set_parent(&window).blocking_pick_folder()
    } else {
        dialog.blocking_pick_folder()
    };
    folder
        .map(|folder| {
            folder
                .into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|error| error.to_string())
        })
        .transpose()
}

#[tauri::command(async)]
pub async fn agent_project_add(
    app: AppHandle,
    state: State<'_, AgentManager>,
    path: String,
) -> Result<AgentProject, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("A project path is required.".to_string());
    }
    let canonical = fs::canonicalize(trimmed)
        .map_err(|error| format!("Could not resolve project path: {error}"))?;
    if !canonical.is_dir() {
        return Err("The selected path is not a directory.".to_string());
    }
    let canonical_path = canonical.to_string_lossy().into_owned();
    let mut state = state.lock();
    if let Some(existing) = state
        .projects
        .iter()
        .find(|project| project.path == canonical_path)
    {
        return Ok(existing.clone());
    }
    let name = canonical
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| canonical_path.clone());
    let now = iso_now();
    let project = AgentProject {
        id: new_id("project"),
        path: canonical_path,
        name,
        trusted: false,
        created_at: now.clone(),
        updated_at: now,
    };
    state.projects.push(project.clone());
    save_projects(&state)?;
    if let (Some(server), Some(stop), Some(sender)) = (
        state
            .server
            .as_ref()
            .map(|server| (server.port, server.password.clone())),
        state.event_stop.clone(),
        state.event_sender.clone(),
    ) {
        spawn_project_stream(
            &mut state,
            server.0,
            &server.1,
            &stop,
            &sender,
            project.path.clone(),
        );
    }
    events::emit(&app, events::NOTICE, json!({ "kind": "projects" }));
    Ok(project)
}

#[tauri::command(async)]
pub async fn agent_project_remove(
    app: AppHandle,
    state: State<'_, AgentManager>,
    project_id: String,
) -> Result<(), String> {
    let mut state = state.lock();
    let thread_ids: Vec<String> = state
        .threads
        .iter()
        .filter(|thread| thread.project_id == project_id)
        .map(|thread| thread.id.clone())
        .collect();
    let has_active = state
        .runs
        .values()
        .any(|run| thread_ids.contains(&run.thread_id) && active_run(run.status.as_str()));
    if has_active {
        return Err("Stop the running agent before removing this project.".to_string());
    }
    state.projects.retain(|project| project.id != project_id);
    for thread_id in &thread_ids {
        state.threads.retain(|thread| thread.id != *thread_id);
        state.runs.retain(|_, run| run.thread_id != *thread_id);
        state.items.remove(thread_id);
        state.loaded_threads.remove(thread_id);
        state
            .approvals
            .retain(|_, approval| approval.thread_id != *thread_id);
        state
            .questions
            .retain(|_, question| question.thread_id != *thread_id);
        let _ = state.store.delete_thread_file(thread_id);
    }
    save_projects(&state)?;
    save_threads(&state)?;
    events::emit(&app, events::NOTICE, json!({ "kind": "projects" }));
    Ok(())
}

#[tauri::command(async)]
pub async fn agent_project_set_trust(
    app: AppHandle,
    state: State<'_, AgentManager>,
    project_id: String,
    trusted: bool,
) -> Result<AgentProject, String> {
    let mut state = state.lock();
    let project = state
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "Project not found.".to_string())?;
    project.trusted = trusted;
    project.updated_at = iso_now();
    let result = project.clone();
    save_projects(&state)?;
    events::emit(&app, events::NOTICE, json!({ "kind": "projects" }));
    Ok(result)
}

#[tauri::command]
pub fn agent_provider_list(state: State<'_, AgentManager>) -> Vec<AgentProviderInstance> {
    state.lock().providers.clone()
}

#[tauri::command]
pub fn agent_thread_list(
    state: State<'_, AgentManager>,
    project_id: Option<String>,
) -> Vec<AgentThreadSummary> {
    let state = state.lock();
    let mut threads: Vec<AgentThreadSummary> = state
        .threads
        .iter()
        .filter(|thread| {
            project_id
                .as_ref()
                .map(|id| thread.project_id == *id)
                .unwrap_or(true)
        })
        .map(AgentThreadSummary::from)
        .collect();
    threads.sort_by(|a, b| {
        b.pinned_at
            .is_some()
            .cmp(&a.pinned_at.is_some())
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    threads
}

#[tauri::command(async)]
pub async fn agent_thread_create(
    app: AppHandle,
    state: State<'_, AgentManager>,
    project_id: String,
    provider_instance_id: String,
    model: Option<AgentModelRef>,
) -> Result<AgentThread, String> {
    let mut state = state.lock();
    if !project_trusted(&state, &project_id) {
        return Err("Grant trust to this project before creating a chat.".to_string());
    }
    if !state
        .providers
        .iter()
        .any(|provider| provider.id == provider_instance_id)
    {
        return Err("Provider instance not found.".to_string());
    }
    let now = iso_now();
    let thread = AgentThread {
        id: new_id("thread"),
        project_id,
        provider_instance_id,
        title: "New chat".to_string(),
        model,
        permission_mode: PERMISSION_MODE_SUPERVISED.to_string(),
        native_session_id: None,
        ui_status: "idle".to_string(),
        created_at: now.clone(),
        updated_at: now,
        last_visited_at: None,
        archived_at: None,
        pinned_at: None,
    };
    state.threads.push(thread.clone());
    state.items.insert(thread.id.clone(), Vec::new());
    state.loaded_threads.insert(thread.id.clone());
    save_threads(&state)?;
    events::emit(&app, events::THREAD_UPDATED, &thread);
    Ok(thread)
}

#[tauri::command(async)]
pub async fn agent_thread_open(
    app: AppHandle,
    state: State<'_, AgentManager>,
    thread_id: String,
) -> Result<AgentThreadDetail, String> {
    let mut state = state.lock();
    let index = thread_index(&state, &thread_id).ok_or_else(|| "Chat not found.".to_string())?;
    ensure_thread_loaded(&mut state, &thread_id);
    let now = iso_now();
    state.threads[index].last_visited_at = Some(now);
    save_threads(&state)?;
    let thread = state.threads[index].clone();
    let mut runs: Vec<AgentRun> = state
        .runs
        .values()
        .filter(|run| run.thread_id == thread_id)
        .cloned()
        .collect();
    runs.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    let items = state.items.get(&thread_id).cloned().unwrap_or_default();
    let mut approvals: Vec<AgentApproval> = state
        .approvals
        .values()
        .filter(|approval| approval.thread_id == thread_id)
        .cloned()
        .collect();
    approvals.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let mut questions: Vec<AgentQuestion> = state
        .questions
        .values()
        .filter(|question| question.thread_id == thread_id)
        .cloned()
        .collect();
    questions.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    events::emit(&app, events::THREAD_UPDATED, &thread);
    Ok(AgentThreadDetail {
        thread,
        runs,
        items,
        approvals,
        questions,
    })
}

#[tauri::command(async)]
pub async fn agent_thread_rename(
    app: AppHandle,
    state: State<'_, AgentManager>,
    thread_id: String,
    title: String,
) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("A chat title is required.".to_string());
    }
    let mut state = state.lock();
    let index = thread_index(&state, &thread_id).ok_or_else(|| "Chat not found.".to_string())?;
    state.threads[index].title = title.chars().take(120).collect();
    state.threads[index].updated_at = iso_now();
    let thread = state.threads[index].clone();
    save_threads(&state)?;
    events::emit(&app, events::THREAD_UPDATED, &thread);
    Ok(())
}

#[tauri::command(async)]
pub async fn agent_thread_pin(
    app: AppHandle,
    state: State<'_, AgentManager>,
    thread_id: String,
    pinned: bool,
) -> Result<(), String> {
    let mut state = state.lock();
    let index = thread_index(&state, &thread_id).ok_or_else(|| "Chat not found.".to_string())?;
    state.threads[index].pinned_at = pinned.then(iso_now);
    let thread = state.threads[index].clone();
    save_threads(&state)?;
    events::emit(&app, events::THREAD_UPDATED, &thread);
    Ok(())
}

#[tauri::command(async)]
pub async fn agent_thread_archive(
    app: AppHandle,
    state: State<'_, AgentManager>,
    thread_id: String,
    archived: bool,
) -> Result<(), String> {
    let mut state = state.lock();
    let index = thread_index(&state, &thread_id).ok_or_else(|| "Chat not found.".to_string())?;
    state.threads[index].archived_at = archived.then(iso_now);
    state.threads[index].updated_at = iso_now();
    let thread = state.threads[index].clone();
    save_threads(&state)?;
    events::emit(&app, events::THREAD_UPDATED, &thread);
    Ok(())
}

#[tauri::command(async)]
pub async fn agent_thread_delete(
    app: AppHandle,
    state: State<'_, AgentManager>,
    thread_id: String,
) -> Result<(), String> {
    let mut state = state.lock();
    let index = thread_index(&state, &thread_id).ok_or_else(|| "Chat not found.".to_string())?;
    let thread = state.threads.remove(index);
    let project = project_path(&state, &thread.project_id);
    if let (Some(server), Some(native), Some(project)) = (
        state.server.as_ref(),
        thread.native_session_id.as_deref(),
        project,
    ) {
        let _ = opencode::delete_session(server.port, &server.password, &project, native);
    }
    state.runs.retain(|_, run| run.thread_id != thread_id);
    state.items.remove(&thread_id);
    state.loaded_threads.remove(&thread_id);
    state
        .approvals
        .retain(|_, approval| approval.thread_id != thread_id);
    state
        .questions
        .retain(|_, question| question.thread_id != thread_id);
    let _ = state.store.delete_thread_file(&thread_id);
    save_threads(&state)?;
    events::emit(&app, events::NOTICE, json!({ "kind": "threads" }));
    Ok(())
}

#[tauri::command]
pub fn agent_provider_status(state: State<'_, AgentManager>) -> ProviderStatus {
    provider_status(&state.lock())
}

#[tauri::command(async)]
pub async fn agent_provider_start(
    app: AppHandle,
    state: State<'_, AgentManager>,
    processes: State<'_, ProcessManager>,
    provider_instance_id: Option<String>,
) -> Result<ProviderStatus, String> {
    let _guard = state
        .provider_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    start_provider(&app, &state, &processes, provider_instance_id.as_deref())
}

#[tauri::command(async)]
pub async fn agent_provider_stop(
    app: AppHandle,
    state: State<'_, AgentManager>,
    processes: State<'_, ProcessManager>,
) -> Result<ProviderStatus, String> {
    let _guard = state
        .provider_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    stop_provider(&app, &state, &processes);
    Ok(status_payload(&state.lock(), None))
}

#[tauri::command(async)]
pub async fn agent_provider_restart(
    app: AppHandle,
    state: State<'_, AgentManager>,
    processes: State<'_, ProcessManager>,
    provider_instance_id: Option<String>,
) -> Result<ProviderStatus, String> {
    let _guard = state
        .provider_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    {
        let mut state = state.lock();
        let now = super::ids::now_millis();
        state
            .restart_attempts
            .retain(|stamp| now.saturating_sub(*stamp) < 60_000);
        if state.restart_attempts.len() >= 3 {
            return Err(
                "OpenCode was restarted too often. Wait a minute and try again.".to_string(),
            );
        }
        state.restart_attempts.push(now);
    }
    stop_provider(&app, &state, &processes);
    start_provider(&app, &state, &processes, provider_instance_id.as_deref())
}

fn start_provider(
    app: &AppHandle,
    manager: &AgentManager,
    processes: &ProcessManager,
    requested: Option<&str>,
) -> Result<ProviderStatus, String> {
    let provider = {
        let state = manager.lock();
        let provider = match requested {
            Some(id) => state.providers.iter().find(|provider| provider.id == id),
            None => state.providers.first(),
        }
        .cloned()
        .ok_or_else(|| "Provider instance not found.".to_string())?;
        if let Some(server) = state.server.as_ref() {
            if server.instance_id == provider.id
                && opencode::health(server.port, &server.password).is_ok()
            {
                return Ok(provider_status(&state));
            }
        }
        if state.codex.is_some() && state.active_provider.as_deref() == Some(provider.id.as_str()) {
            return Ok(provider_status(&state));
        }
        provider
    };
    stop_provider(app, manager, processes);
    {
        let mut state = manager.lock();
        state.active_provider = Some(provider.id.clone());
    }
    if provider.driver == "codex" {
        return start_codex_provider(app, manager, processes, &provider);
    }
    start_opencode_provider(app, manager, processes, &provider)
}

fn start_opencode_provider(
    app: &AppHandle,
    manager: &AgentManager,
    processes: &ProcessManager,
    provider: &AgentProviderInstance,
) -> Result<ProviderStatus, String> {
    let instance_id = provider.id.clone();
    let binary_path = provider.binary_path.clone();
    let binary = provider_process::resolve_binary("opencode", binary_path.as_deref())?;
    let password = random_hex(32);
    let server = provider_process::spawn(&instance_id, &binary, &password, processes)?;
    if let Err(error) = opencode::health(server.port, &password) {
        let mut server = server;
        server.stop(processes);
        return Err(format!("OpenCode health check failed: {error}"));
    }
    let port = server.port;
    let password_for_reader = password.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let (sender, receiver) = channel();
    let consumer_stop = stop.clone();
    let inner = manager.inner.clone();
    let consumer_app = app.clone();
    let consumer_thread = thread::spawn(move || {
        consume_events(consumer_app, inner, receiver, consumer_stop, port);
    });
    let mut state = manager.lock();
    if let Some(old_stop) = state.event_stop.replace(stop.clone()) {
        old_stop.store(true, Ordering::Relaxed);
    }
    state.event_sender = Some(sender.clone());
    state.event_streams.clear();
    let mut directories: Vec<String> = state
        .projects
        .iter()
        .map(|project| project.path.clone())
        .collect();
    directories.sort();
    directories.dedup();
    for directory in directories {
        spawn_project_stream(
            &mut state,
            port,
            &password_for_reader,
            &stop,
            &sender,
            directory,
        );
    }
    state.server = Some(server);
    state.consumer_thread = Some(consumer_thread);
    let status = provider_status(&state);
    if let Some(server) = state.server.as_ref() {
        eprintln!(
            "[agent] event=provider_started port={} pid={} version={}",
            server.port, server.pid, server.version
        );
    }
    events::emit(app, events::PROVIDER_STATUS, &status);
    Ok(status)
}

fn start_codex_provider(
    app: &AppHandle,
    manager: &AgentManager,
    processes: &ProcessManager,
    provider: &AgentProviderInstance,
) -> Result<ProviderStatus, String> {
    let binary = provider_process::resolve_binary("codex", provider.binary_path.as_deref())?;
    let codex::SpawnedCodex {
        client,
        child,
        stdout,
        version,
        binary,
        pid,
        managed_id,
        started_at,
    } = codex::spawn(&binary, processes)?;
    let reader_client = client.clone();
    let reader_app = app.clone();
    let inner = manager.inner.clone();
    let reader = thread::spawn(move || {
        codex_reader(reader_app, inner, reader_client, stdout);
    });
    if let Err(error) = client.request(
        "initialize",
        json!({
            "clientInfo": { "name": "arc", "title": "Arc", "version": "0.1.4" }
        }),
    ) {
        if let Some(managed) = managed_id {
            processes.stop(managed, Duration::from_millis(200));
        }
        let mut child = child;
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("Codex handshake failed: {error}"));
    }
    let _ = client.notify("initialized", json!({}));
    let mut state = manager.lock();
    state.codex = Some(CodexRuntime {
        client,
        child,
        reader,
        version: version.clone(),
        binary: binary.clone(),
        managed_id,
        started_at,
    });
    state.active_provider = Some(provider.id.clone());
    state.codex_loaded_threads.clear();
    state.codex_turns.clear();
    state.codex_requests.clear();
    state.codex_questions.clear();
    eprintln!("[agent] event=provider_started driver=codex pid={pid} version={version}");
    let status = provider_status(&state);
    events::emit(app, events::PROVIDER_STATUS, &status);
    Ok(status)
}

fn codex_reader(
    app: AppHandle,
    inner: Arc<Mutex<AgentState>>,
    client: CodexClient,
    stdout: std::process::ChildStdout,
) {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("method").and_then(Value::as_str).is_some() {
            if value.get("id").is_some() {
                handle_codex_request(&app, &inner, &client, &value);
            } else {
                handle_codex_notification(&app, &inner, &value);
            }
        } else {
            client.dispatch_response(&value);
        }
    }
    mark_codex_down(&app, &inner);
}

fn mark_codex_down(app: &AppHandle, inner: &Arc<Mutex<AgentState>>) {
    let mut state = inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(mut runtime) = state.codex.take() {
        let _ = runtime.child.wait();
    }
    state.codex_loaded_threads.clear();
    state.codex_turns.clear();
    let now = iso_now();
    let run_ids: Vec<String> = state
        .runs
        .values()
        .filter(|run| active_run(run.status.as_str()))
        .map(|run| run.id.clone())
        .collect();
    for run_id in run_ids {
        if let Some(run) = state.runs.get_mut(&run_id) {
            run.status = "failed".to_string();
            run.ended_at = Some(now.clone());
            run.error = Some("The Codex provider disconnected.".to_string());
            let run = run.clone();
            let _ = state
                .store
                .append_record(&run.thread_id, &AgentRecord::Run { run: run.clone() });
            events::emit(app, events::RUN_UPDATED, &run);
        }
    }
    let status = status_payload(&state, Some("The Codex provider disconnected.".to_string()));
    events::emit(app, events::PROVIDER_STATUS, &status);
}

fn codex_thread_id(state: &AgentState, native: &str) -> Option<String> {
    thread_for_session(state, native)
}

fn handle_codex_request(
    app: &AppHandle,
    inner: &Arc<Mutex<AgentState>>,
    client: &CodexClient,
    value: &Value,
) {
    let method = value.get("method").and_then(Value::as_str).unwrap_or("");
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    let raw_id = value.get("id").cloned().unwrap_or(Value::Null);
    let mut state = inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(thread_id) = params
        .get("threadId")
        .and_then(Value::as_str)
        .and_then(|native| codex_thread_id(&state, native))
    else {
        let _ = client.reply(
            &raw_id,
            json!({ "decision": "decline", "error": "Unknown thread." }),
        );
        return;
    };
    let turn_id = params.get("turnId").and_then(Value::as_str).unwrap_or("");
    let run_id = state
        .codex_turns
        .get(turn_id)
        .map(|(_, run)| run.clone())
        .or_else(|| active_run_id(&state, &thread_id))
        .unwrap_or_default();
    match method {
        "item/commandExecution/requestApproval" => {
            let command = params
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("command")
                .to_string();
            let cwd = params.get("cwd").and_then(Value::as_str).unwrap_or("");
            let approval = AgentApproval {
                id: new_id("approval"),
                thread_id: thread_id.clone(),
                run_id,
                provider_request_id: raw_id.to_string(),
                title: "Approve command".to_string(),
                detail: if cwd.is_empty() {
                    command.clone()
                } else {
                    format!("{command}\n\ncwd: {cwd}")
                },
                action: Some("command".to_string()),
                resources: Some(vec![command]),
                decision: None,
                created_at: iso_now(),
                resolved_at: None,
            };
            state.codex_requests.insert(approval.id.clone(), raw_id);
            state
                .approvals
                .insert(approval.id.clone(), approval.clone());
            let _ = state.store.append_record(
                &thread_id,
                &AgentRecord::Approval {
                    approval: approval.clone(),
                },
            );
            set_thread_ui(&mut state, &thread_id, "needs-input");
            let _ = save_threads(&state);
            events::emit(app, events::APPROVAL_REQUESTED, &approval);
        }
        "item/fileChange/requestApproval" | "applyPatchApproval" => {
            let reason = params
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("Codex wants to change files.");
            let approval = AgentApproval {
                id: new_id("approval"),
                thread_id: thread_id.clone(),
                run_id,
                provider_request_id: raw_id.to_string(),
                title: "Approve file changes".to_string(),
                detail: reason.to_string(),
                action: Some("fileChange".to_string()),
                resources: None,
                decision: None,
                created_at: iso_now(),
                resolved_at: None,
            };
            state.codex_requests.insert(approval.id.clone(), raw_id);
            state
                .approvals
                .insert(approval.id.clone(), approval.clone());
            let _ = state.store.append_record(
                &thread_id,
                &AgentRecord::Approval {
                    approval: approval.clone(),
                },
            );
            set_thread_ui(&mut state, &thread_id, "needs-input");
            let _ = save_threads(&state);
            events::emit(app, events::APPROVAL_REQUESTED, &approval);
        }
        "item/tool/requestUserInput" => {
            let questions = params
                .get("questions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let prompts: Vec<AgentQuestionPrompt> = questions
                .into_iter()
                .filter_map(|question| {
                    let id = question.get("id").and_then(Value::as_str)?.to_string();
                    let options =
                        question
                            .get("options")
                            .and_then(Value::as_array)
                            .map(|options| {
                                options
                                    .iter()
                                    .filter_map(|option| {
                                        let label = option.get("label").and_then(Value::as_str)?;
                                        Some(AgentQuestionOption {
                                            label: label.to_string(),
                                            description: option
                                                .get("description")
                                                .and_then(Value::as_str)
                                                .map(str::to_string),
                                        })
                                    })
                                    .collect()
                            });
                    Some(AgentQuestionPrompt {
                        id,
                        header: question
                            .get("header")
                            .and_then(Value::as_str)
                            .unwrap_or("Question")
                            .to_string(),
                        question: question
                            .get("question")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        options,
                        multiple: None,
                    })
                })
                .collect();
            if prompts.is_empty() {
                let _ = client.reply(&raw_id, json!({ "answers": {} }));
                return;
            }
            let question = AgentQuestion {
                id: new_id("question"),
                thread_id: thread_id.clone(),
                run_id,
                provider_request_id: raw_id.to_string(),
                questions: prompts,
                answers: None,
                status: "pending".to_string(),
                created_at: iso_now(),
            };
            state.codex_questions.insert(question.id.clone(), raw_id);
            state
                .questions
                .insert(question.id.clone(), question.clone());
            let _ = state.store.append_record(
                &thread_id,
                &AgentRecord::Question {
                    question: question.clone(),
                },
            );
            set_thread_ui(&mut state, &thread_id, "needs-input");
            let _ = save_threads(&state);
            events::emit(app, events::QUESTION_REQUESTED, &question);
        }
        _ => {
            let _ = client.reply(
                &raw_id,
                json!({ "error": format!("Arc does not handle {method}.") }),
            );
        }
    }
}

fn handle_codex_notification(app: &AppHandle, inner: &Arc<Mutex<AgentState>>, value: &Value) {
    let method = value.get("method").and_then(Value::as_str).unwrap_or("");
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    let mut state = inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(native) = params
        .get("threadId")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    let Some(thread_id) = codex_thread_id(&state, &native) else {
        return;
    };
    ensure_thread_loaded(&mut state, &thread_id);
    let turn_id = params.get("turnId").and_then(Value::as_str).unwrap_or("");
    let run_id = state
        .codex_turns
        .get(turn_id)
        .map(|(_, run)| run.clone())
        .or_else(|| active_run_id(&state, &thread_id))
        .unwrap_or_default();
    match method {
        "thread/status/changed" => {
            let status = params
                .get("status")
                .and_then(|status| status.get("type"))
                .and_then(Value::as_str);
            match status {
                Some("active") => set_thread_ui(&mut state, &thread_id, "working"),
                Some("idle") => {
                    if active_run_id(&state, &thread_id).is_none() {
                        set_thread_ui(&mut state, &thread_id, "idle");
                    }
                }
                Some("systemError") => set_thread_ui(&mut state, &thread_id, "error"),
                _ => {}
            }
        }
        "turn/started" => {
            if let Some(id) = params
                .get("turn")
                .and_then(|turn| turn.get("id"))
                .and_then(Value::as_str)
            {
                state
                    .codex_turns
                    .insert(id.to_string(), (thread_id.clone(), run_id.clone()));
            }
            if let Some(run) = state.runs.get_mut(&run_id) {
                run.status = "running".to_string();
                let run = run.clone();
                let _ = state
                    .store
                    .append_record(&thread_id, &AgentRecord::Run { run: run.clone() });
                events::emit(app, events::RUN_UPDATED, &run);
            }
            set_thread_ui(&mut state, &thread_id, "working");
        }
        "turn/completed" => {
            let turn = params.get("turn").cloned().unwrap_or(Value::Null);
            let status = turn
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let error = turn
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let (run_status, ui) = match status {
                "completed" => ("completed", "idle"),
                "interrupted" => ("stopped", "idle"),
                _ => ("failed", "error"),
            };
            if let Some(run) = state.runs.get_mut(&run_id) {
                run.status = run_status.to_string();
                run.ended_at = Some(iso_now());
                run.error = error.clone();
                let run = run.clone();
                let _ = state
                    .store
                    .append_record(&thread_id, &AgentRecord::Run { run: run.clone() });
                events::emit(app, events::RUN_UPDATED, &run);
            }
            set_thread_ui(&mut state, &thread_id, ui);
            state.codex_turns.remove(turn_id);
            let _ = save_threads(&state);
            if let Some(index) = thread_index(&state, &thread_id) {
                let thread = state.threads[index].clone();
                events::emit(app, events::THREAD_UPDATED, &thread);
            }
        }
        "item/agentMessage/delta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                let item_id = params
                    .get("itemId")
                    .and_then(Value::as_str)
                    .unwrap_or("assistant");
                append_codex_text(app, &mut state, &thread_id, &run_id, item_id, delta, false);
            }
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                let item_id = params
                    .get("itemId")
                    .and_then(Value::as_str)
                    .unwrap_or("reasoning");
                append_codex_text(app, &mut state, &thread_id, &run_id, item_id, delta, true);
            }
        }
        "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                let item_id = params
                    .get("itemId")
                    .and_then(Value::as_str)
                    .unwrap_or("tool");
                append_codex_output(app, &mut state, &thread_id, item_id, delta);
            }
        }
        "item/started" | "item/completed" => {
            if let Some(item) = params.get("item") {
                if let Some(mapped) = codex_item(item, &run_id) {
                    upsert_part_item(app, &mut state, &thread_id, mapped);
                }
            }
        }
        "error" => {
            let message = params
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("Codex reported an error.")
                .to_string();
            finish_run(app, &mut state, &thread_id, "failed", Some(message));
        }
        "serverRequest/resolved" => {
            let request_id = params.get("requestId").cloned().unwrap_or(Value::Null);
            let approval_id = state
                .codex_requests
                .iter()
                .find(|(_, raw)| *raw == &request_id)
                .map(|(id, _)| id.clone());
            if let Some(approval_id) = approval_id {
                if let Some(approval) = state.approvals.get_mut(&approval_id) {
                    approval.decision = Some("expired".to_string());
                    approval.resolved_at = Some(iso_now());
                    let approval = approval.clone();
                    let _ = state.store.append_record(
                        &thread_id,
                        &AgentRecord::ApprovalResolved {
                            approval_id: approval.id.clone(),
                            decision: "expired".to_string(),
                        },
                    );
                    state.codex_requests.remove(&approval.id);
                    events::emit(app, events::APPROVAL_RESOLVED, &approval);
                }
            }
        }
        _ => {}
    }
}

fn append_codex_text(
    app: &AppHandle,
    state: &mut AgentState,
    thread_id: &str,
    run_id: &str,
    item_id: &str,
    delta: &str,
    reasoning: bool,
) {
    let items = state.items.entry(thread_id.to_string()).or_default();
    let index = match items.iter().position(|item| item.id == item_id) {
        Some(index) => index,
        None => {
            items.push(AgentItem {
                id: item_id.to_string(),
                run_id: run_id.to_string(),
                kind: "assistant".to_string(),
                text: Some(String::new()),
                reasoning: None,
                name: None,
                input: None,
                output: None,
                status: None,
                message: None,
                created_at: iso_now(),
            });
            items.len() - 1
        }
    };
    if reasoning {
        items[index]
            .reasoning
            .get_or_insert_with(String::new)
            .push_str(delta);
    } else {
        items[index]
            .text
            .get_or_insert_with(String::new)
            .push_str(delta);
    }
    let stored = items[index].clone();
    let _ = state.store.append_record(
        thread_id,
        &AgentRecord::Item {
            item: stored.clone(),
        },
    );
    events::emit(app, events::ITEM_UPDATED, &stored);
}

fn append_codex_output(
    app: &AppHandle,
    state: &mut AgentState,
    thread_id: &str,
    item_id: &str,
    delta: &str,
) {
    let items = state.items.entry(thread_id.to_string()).or_default();
    let Some(item) = items.iter_mut().find(|item| item.id == item_id) else {
        return;
    };
    let mut output = item
        .output
        .as_ref()
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    output.push_str(delta);
    item.output = Some(Value::String(output));
    let stored = item.clone();
    let _ = state.store.append_record(
        thread_id,
        &AgentRecord::Item {
            item: stored.clone(),
        },
    );
    events::emit(app, events::ITEM_UPDATED, &stored);
}

fn codex_item(item: &Value, run_id: &str) -> Option<AgentItem> {
    let id = item.get("id").and_then(Value::as_str)?.to_string();
    let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
    let status = match item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("completed")
    {
        "inProgress" | "running" => "running",
        "failed" => "failed",
        _ => "success",
    };
    match kind {
        "userMessage" => None,
        "agentMessage" => Some(AgentItem {
            id,
            run_id: run_id.to_string(),
            kind: "assistant".to_string(),
            text: item.get("text").and_then(Value::as_str).map(str::to_string),
            reasoning: None,
            name: None,
            input: None,
            output: None,
            status: None,
            message: None,
            created_at: iso_now(),
        }),
        "reasoning" => Some(AgentItem {
            id,
            run_id: run_id.to_string(),
            kind: "assistant".to_string(),
            text: None,
            reasoning: item.get("text").and_then(Value::as_str).map(str::to_string),
            name: None,
            input: None,
            output: None,
            status: None,
            message: None,
            created_at: iso_now(),
        }),
        "commandExecution" => Some(AgentItem {
            id,
            run_id: run_id.to_string(),
            kind: "tool".to_string(),
            text: None,
            reasoning: None,
            name: Some("command".to_string()),
            input: Some(json!({
                "command": item.get("command").cloned().unwrap_or(Value::Null),
                "cwd": item.get("cwd").cloned().unwrap_or(Value::Null),
            })),
            output: item
                .get("aggregatedOutput")
                .cloned()
                .filter(|value| !value.is_null()),
            status: Some(status.to_string()),
            message: None,
            created_at: iso_now(),
        }),
        "fileChange" => Some(AgentItem {
            id,
            run_id: run_id.to_string(),
            kind: "tool".to_string(),
            text: None,
            reasoning: None,
            name: Some("fileChange".to_string()),
            input: item.get("changes").cloned(),
            output: None,
            status: Some(status.to_string()),
            message: None,
            created_at: iso_now(),
        }),
        "mcpToolCall" | "functionCall" | "webSearch" => Some(AgentItem {
            id,
            run_id: run_id.to_string(),
            kind: "tool".to_string(),
            text: None,
            reasoning: None,
            name: Some(kind.to_string()),
            input: item.get("arguments").cloned(),
            output: item.get("result").cloned(),
            status: Some(status.to_string()),
            message: None,
            created_at: iso_now(),
        }),
        _ => None,
    }
}

fn codex_send(
    app: &AppHandle,
    manager: &AgentManager,
    thread_id: String,
    text: String,
    model: Option<AgentModelRef>,
) -> Result<String, String> {
    let (run_id, thread, project, client, native, loaded) = {
        let mut state = manager.lock();
        let index =
            thread_index(&state, &thread_id).ok_or_else(|| "Chat not found.".to_string())?;
        let thread = state.threads[index].clone();
        if !project_trusted(&state, &thread.project_id) {
            return Err("Grant trust to this project before sending a message.".to_string());
        }
        if active_run_id(&state, &thread_id).is_some() {
            return Err("This chat already has a running request. Stop it first.".to_string());
        }
        let provider = state
            .providers
            .iter()
            .find(|provider| provider.id == thread.provider_instance_id)
            .cloned()
            .ok_or_else(|| "Provider instance not found.".to_string())?;
        if provider.driver != "codex" {
            return Err("This chat does not use Codex.".to_string());
        }
        if state.active_provider.as_deref() != Some(provider.id.as_str()) {
            return Err("Start the Codex provider before sending.".to_string());
        }
        let client = state
            .codex
            .as_ref()
            .map(|runtime| runtime.client.clone())
            .ok_or_else(|| "Codex is not running. Start it first.".to_string())?;
        let project = project_path(&state, &thread.project_id)
            .ok_or_else(|| "Project not found.".to_string())?;
        if model.is_some() && model != thread.model {
            state.threads[index].model = model.clone();
        }
        let now = iso_now();
        let run = AgentRun {
            id: new_id("run"),
            thread_id: thread_id.clone(),
            status: "starting".to_string(),
            started_at: now.clone(),
            ended_at: None,
            error: None,
        };
        let run_id = run.id.clone();
        state.runs.insert(run.id.clone(), run.clone());
        state.threads[index].ui_status = "working".to_string();
        state.threads[index].updated_at = now;
        ensure_thread_loaded(&mut state, &thread_id);
        state
            .store
            .append_record(&thread_id, &AgentRecord::Run { run: run.clone() })?;
        let user_item = AgentItem {
            id: new_id("user"),
            run_id: run_id.clone(),
            kind: "user".to_string(),
            text: Some(text.clone()),
            reasoning: None,
            name: None,
            input: None,
            output: None,
            status: None,
            message: None,
            created_at: iso_now(),
        };
        state
            .items
            .entry(thread_id.clone())
            .or_default()
            .push(user_item.clone());
        state.store.append_record(
            &thread_id,
            &AgentRecord::Item {
                item: user_item.clone(),
            },
        )?;
        let thread = state.threads[index].clone();
        save_threads(&state)?;
        events::emit(&app, events::THREAD_UPDATED, &thread);
        events::emit(&app, events::RUN_UPDATED, &run);
        events::emit(&app, events::ITEM_UPDATED, &user_item);
        let loaded = state.codex_loaded_threads.contains(&thread.id);
        (
            run_id,
            thread,
            project,
            client,
            state.threads[index].native_session_id.clone(),
            loaded,
        )
    };
    let native = match native {
        Some(native) if loaded => native,
        Some(native) => {
            if let Err(error) = client.request("thread/resume", json!({ "threadId": native })) {
                fail_run(
                    &app,
                    &manager.inner,
                    &thread_id,
                    &run_id,
                    &format!("Could not resume Codex thread: {error}"),
                );
                return Err(error);
            }
            let mut state = manager.lock();
            state.codex_loaded_threads.insert(native.clone());
            native
        }
        None => {
            let mut body = json!({
                "cwd": project,
                "approvalPolicy": "on-request",
                "sandbox": "workspace-write",
            });
            if let Some(model) = thread.model.as_ref() {
                body["model"] = json!(model.model_id);
            }
            match client.request("thread/start", body) {
                Ok(response) => {
                    let id = response
                        .get("thread")
                        .and_then(|thread| thread.get("id"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| "Codex did not return a thread id.".to_string())?
                        .to_string();
                    let mut state = manager.lock();
                    if let Some(index) = thread_index(&state, &thread_id) {
                        state.threads[index].native_session_id = Some(id.clone());
                        let _ = save_threads(&state);
                        let thread = state.threads[index].clone();
                        events::emit(&app, events::THREAD_UPDATED, &thread);
                    }
                    state.codex_loaded_threads.insert(id.clone());
                    id
                }
                Err(error) => {
                    fail_run(&app, &manager.inner, &thread_id, &run_id, &error);
                    return Err(error);
                }
            }
        }
    };
    let response = match client.request(
        "turn/start",
        json!({
            "threadId": native,
            "input": [{ "type": "text", "text": text }],
        }),
    ) {
        Ok(response) => response,
        Err(error) => {
            fail_run(&app, &manager.inner, &thread_id, &run_id, &error);
            return Err(error);
        }
    };
    let turn_id = response
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut state = manager.lock();
    if !turn_id.is_empty() {
        state
            .codex_turns
            .insert(turn_id.clone(), (thread_id.clone(), run_id.clone()));
    }
    if let Some(run) = state.runs.get_mut(&run_id) {
        run.status = "running".to_string();
        let run = run.clone();
        let _ = state
            .store
            .append_record(&thread_id, &AgentRecord::Run { run: run.clone() });
        events::emit(&app, events::RUN_UPDATED, &run);
    }
    save_threads(&state)?;
    Ok(run_id)
}

fn codex_interrupt(app: &AppHandle, manager: &AgentManager, thread_id: &str) -> Result<(), String> {
    let (client, native, turn_id, run_id) = {
        let state = manager.lock();
        let thread = state
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| "Chat not found.".to_string())?;
        let client = state
            .codex
            .as_ref()
            .map(|runtime| runtime.client.clone())
            .ok_or_else(|| "Codex is not running.".to_string())?;
        let native = thread
            .native_session_id
            .clone()
            .ok_or_else(|| "Codex thread not found.".to_string())?;
        let run_id = active_run_id(&state, thread_id).unwrap_or_default();
        let turn_id = state
            .codex_turns
            .iter()
            .find(|(_, (thread, run))| thread == thread_id && run == &run_id)
            .map(|(turn, _)| turn.clone())
            .unwrap_or_default();
        (client, native, turn_id, run_id)
    };
    if !turn_id.is_empty() {
        let _ = client.request(
            "turn/interrupt",
            json!({ "threadId": native, "turnId": turn_id }),
        );
    }
    let mut state = manager.lock();
    if let Some(run) = state.runs.get_mut(&run_id) {
        run.status = "stopped".to_string();
        run.ended_at = Some(iso_now());
        let run = run.clone();
        let _ = state
            .store
            .append_record(thread_id, &AgentRecord::Run { run: run.clone() });
        events::emit(app, events::RUN_UPDATED, &run);
    }
    state.codex_turns.remove(&turn_id);
    set_thread_ui(&mut state, thread_id, "idle");
    let _ = save_threads(&state);
    Ok(())
}

fn codex_models(client: &CodexClient) -> Result<Vec<AgentModel>, String> {
    let response = client.request("model/list", json!({ "limit": 100 }))?;
    let models = response
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(models
        .into_iter()
        .filter(|model| {
            !model
                .get("hidden")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .filter_map(|model| {
            let id = model
                .get("id")
                .and_then(Value::as_str)
                .or_else(|| model.get("model").and_then(Value::as_str))?
                .to_string();
            let name = model
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .to_string();
            Some(AgentModel {
                provider_id: "codex".to_string(),
                model_id: id,
                name,
                provider_name: "Codex".to_string(),
            })
        })
        .collect())
}

fn stop_provider(app: &AppHandle, manager: &AgentManager, processes: &ProcessManager) {
    let mut state = manager.lock();
    stop_event_threads(&mut state);
    if let Some(server) = state.server.as_ref() {
        let _ = opencode::request(
            server.port,
            &server.password,
            "POST",
            "/instance/dispose",
            None,
            Some(json!({})),
        );
    }
    if let Some(mut server) = state.server.take() {
        server.stop(processes);
    }
    if let Some(mut runtime) = state.codex.take() {
        if let Some(managed) = runtime.managed_id {
            processes.stop(managed, Duration::from_millis(500));
        } else {
            let _ = runtime.child.kill();
        }
        let _ = runtime.child.wait();
        let _ = runtime.reader;
    }
    state.codex_loaded_threads.clear();
    state.codex_turns.clear();
    state.codex_requests.clear();
    state.codex_questions.clear();
    for run in state.runs.values_mut() {
        if active_run(run.status.as_str()) {
            run.status = "stopped".to_string();
            run.ended_at = Some(iso_now());
            run.error = Some("The provider was stopped.".to_string());
        }
    }
    let status = status_payload(&state, None);
    events::emit(app, events::PROVIDER_STATUS, &status);
}

fn stop_event_threads(state: &mut AgentState) {
    if let Some(stop) = state.event_stop.take() {
        stop.store(true, Ordering::Relaxed);
    }
    state.event_sender = None;
    state.event_streams.clear();
    state.consumer_thread.take();
}

fn spawn_project_stream(
    state: &mut AgentState,
    port: u16,
    password: &str,
    stop: &Arc<AtomicBool>,
    sender: &Sender<StreamMessage>,
    directory: String,
) {
    let password = password.to_string();
    let stop = stop.clone();
    let sender = sender.clone();
    let handle = thread::spawn(move || {
        opencode::event_stream_loop(port, &password, &stop, sender, Some(&directory));
    });
    state.event_streams.push(handle);
}

#[tauri::command(async)]
pub async fn agent_model_list(
    state: State<'_, AgentManager>,
    _provider_instance_id: String,
) -> Result<Vec<AgentModel>, String> {
    let codex_client = {
        let state = state.lock();
        state.codex.as_ref().map(|runtime| runtime.client.clone())
    };
    if let Some(client) = codex_client {
        return codex_models(&client);
    }
    let (port, password) = server_connection(&state)?;
    opencode::models(port, &password)
}

#[tauri::command(async)]
pub async fn agent_agent_list(
    state: State<'_, AgentManager>,
    _provider_instance_id: String,
) -> Result<Vec<AgentOption>, String> {
    if state.lock().codex.is_some() {
        return Ok(Vec::new());
    }
    let (port, password) = server_connection(&state)?;
    opencode::agents(port, &password)
}

#[tauri::command(async)]
pub async fn agent_command_list(
    state: State<'_, AgentManager>,
    _provider_instance_id: String,
) -> Result<Vec<ProviderCommand>, String> {
    if state.lock().codex.is_some() {
        return Ok(Vec::new());
    }
    let (port, password) = server_connection(&state)?;
    opencode::commands(port, &password)
}

#[tauri::command(async)]
pub async fn agent_skill_list(
    state: State<'_, AgentManager>,
    _provider_instance_id: String,
) -> Result<Vec<ProviderSkill>, String> {
    if state.lock().codex.is_some() {
        return Ok(Vec::new());
    }
    let (port, password) = server_connection(&state)?;
    opencode::skills(port, &password)
}

fn server_connection(state: &AgentManager) -> Result<(u16, String), String> {
    let state = state.lock();
    let server = state
        .server
        .as_ref()
        .ok_or_else(|| "OpenCode is not running. Start it first.".to_string())?;
    Ok((server.port, server.password.clone()))
}

#[tauri::command(async)]
pub async fn agent_thread_send(
    app: AppHandle,
    state: State<'_, AgentManager>,
    thread_id: String,
    text: String,
    model: Option<AgentModelRef>,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("A message is required.".to_string());
    }
    let driver = {
        let state = state.lock();
        state
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .and_then(|thread| {
                state
                    .providers
                    .iter()
                    .find(|provider| provider.id == thread.provider_instance_id)
            })
            .map(|provider| provider.driver.clone())
            .ok_or_else(|| "Chat not found.".to_string())?
    };
    if driver == "codex" {
        return codex_send(&app, &state, thread_id, text, model);
    }
    let (run_id, thread, project, port, password) = {
        let mut state = state.lock();
        let index =
            thread_index(&state, &thread_id).ok_or_else(|| "Chat not found.".to_string())?;
        let thread = state.threads[index].clone();
        if !project_trusted(&state, &thread.project_id) {
            return Err("Grant trust to this project before sending a message.".to_string());
        }
        if active_run_id(&state, &thread_id).is_some() {
            return Err("This chat already has a running request. Stop it first.".to_string());
        }
        let project = project_path(&state, &thread.project_id)
            .ok_or_else(|| "Project not found.".to_string())?;
        let (port, password) = {
            let server = state
                .server
                .as_ref()
                .ok_or_else(|| "OpenCode is not running. Start it first.".to_string())?;
            (server.port, server.password.clone())
        };
        if model.is_some() && model != thread.model {
            state.threads[index].model = model.clone();
        }
        let now = iso_now();
        let run = AgentRun {
            id: new_id("run"),
            thread_id: thread_id.clone(),
            status: "starting".to_string(),
            started_at: now.clone(),
            ended_at: None,
            error: None,
        };
        let run_id = run.id.clone();
        state.runs.insert(run.id.clone(), run.clone());
        state.threads[index].ui_status = "working".to_string();
        state.threads[index].updated_at = now;
        ensure_thread_loaded(&mut state, &thread_id);
        if let Err(error) = state
            .store
            .append_record(&thread_id, &AgentRecord::Run { run: run.clone() })
        {
            state.runs.remove(&run_id);
            state.threads[index].ui_status = "error".to_string();
            return Err(error);
        }
        save_threads(&state)?;
        let thread = state.threads[index].clone();
        let local_user = AgentItem {
            id: new_id("local"),
            run_id: run_id.clone(),
            kind: "user".to_string(),
            text: Some(text.clone()),
            reasoning: None,
            name: None,
            input: None,
            output: None,
            status: None,
            message: None,
            created_at: iso_now(),
        };
        state
            .items
            .entry(thread_id.clone())
            .or_default()
            .push(local_user.clone());
        events::emit(&app, events::THREAD_UPDATED, &thread);
        events::emit(&app, events::RUN_UPDATED, &run);
        events::emit(&app, events::ITEM_UPDATED, &local_user);
        (run_id, thread, project, port, password)
    };
    if let Err(error) = opencode::health(port, &password) {
        fail_run(
            &app,
            &state.inner,
            &thread_id,
            &run_id,
            &format!("OpenCode is unavailable: {error}"),
        );
        return Err(error);
    }
    let mut native = thread.native_session_id.clone();
    if native.is_none() {
        match opencode::create_session(
            port,
            &password,
            &project,
            &thread.title,
            thread.model.as_ref(),
        ) {
            Ok(session) => {
                native = Some(session.clone());
                let mut state = state.lock();
                if let Some(index) = thread_index(&state, &thread_id) {
                    state.threads[index].native_session_id = Some(session);
                    save_threads(&state)?;
                    let thread = state.threads[index].clone();
                    events::emit(&app, events::THREAD_UPDATED, &thread);
                }
            }
            Err(error) => {
                fail_run(&app, &state.inner, &thread_id, &run_id, &error);
                return Err(error);
            }
        }
    }
    let native = native.unwrap_or_default();
    let message_id = match opencode::send_prompt(
        port,
        &password,
        &project,
        &native,
        &text,
        thread.model.as_ref(),
    ) {
        Ok(id) => id,
        Err(error) => {
            fail_run(&app, &state.inner, &thread_id, &run_id, &error);
            return Err(error);
        }
    };
    let mut state = state.lock();
    if let Some(run) = state.runs.get_mut(&run_id) {
        run.status = "running".to_string();
    }
    let _ = message_id;
    if let Some(run) = state.runs.get(&run_id).cloned() {
        state
            .store
            .append_record(&thread_id, &AgentRecord::Run { run: run.clone() })?;
        events::emit(&app, events::RUN_UPDATED, &run);
    }
    save_threads(&state)?;
    Ok(run_id)
}

fn fail_run(
    app: &AppHandle,
    inner: &Arc<Mutex<AgentState>>,
    thread_id: &str,
    run_id: &str,
    error: &str,
) {
    let mut state = inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(run) = state.runs.get_mut(run_id) {
        run.status = "failed".to_string();
        run.ended_at = Some(iso_now());
        run.error = Some(error.to_string());
        let run = run.clone();
        let _ = state
            .store
            .append_record(thread_id, &AgentRecord::Run { run: run.clone() });
        events::emit(app, events::RUN_UPDATED, &run);
    }
    if let Some(index) = thread_index(&state, thread_id) {
        state.threads[index].ui_status = "error".to_string();
        state.threads[index].updated_at = iso_now();
        let thread = state.threads[index].clone();
        let _ = save_threads(&state);
        events::emit(app, events::THREAD_UPDATED, &thread);
    }
    let item = AgentItem {
        id: new_id("error"),
        run_id: run_id.to_string(),
        kind: "error".to_string(),
        text: None,
        reasoning: None,
        name: None,
        input: None,
        output: None,
        status: None,
        message: Some(error.to_string()),
        created_at: iso_now(),
    };
    state
        .items
        .entry(thread_id.to_string())
        .or_default()
        .push(item.clone());
    let _ = state
        .store
        .append_record(thread_id, &AgentRecord::Item { item: item.clone() });
    events::emit(app, events::ITEM_UPDATED, &item);
}

#[tauri::command(async)]
pub async fn agent_thread_interrupt(
    app: AppHandle,
    state: State<'_, AgentManager>,
    thread_id: String,
) -> Result<(), String> {
    {
        let manager = state.lock();
        let driver = manager
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .and_then(|thread| {
                manager
                    .providers
                    .iter()
                    .find(|provider| provider.id == thread.provider_instance_id)
            })
            .map(|provider| provider.driver.clone());
        drop(manager);
        if driver.as_deref() == Some("codex") {
            return codex_interrupt(&app, &state, &thread_id);
        }
    }
    let (thread, project, run_id, port, password) = {
        let state = state.lock();
        let index =
            thread_index(&state, &thread_id).ok_or_else(|| "Chat not found.".to_string())?;
        let thread = state.threads[index].clone();
        let project = project_path(&state, &thread.project_id)
            .ok_or_else(|| "Project not found.".to_string())?;
        let run_id = active_run_id(&state, &thread_id).unwrap_or_default();
        let (port, password) = state
            .server
            .as_ref()
            .map(|server| (server.port, server.password.clone()))
            .ok_or_else(|| "OpenCode is not running.".to_string())?;
        (thread, project, run_id, port, password)
    };
    if let Some(native) = thread.native_session_id.as_deref() {
        let _ = opencode::abort(port, &password, &project, native);
    }
    if !run_id.is_empty() {
        let mut state = state.lock();
        if let Some(run) = state.runs.get_mut(&run_id) {
            run.status = "stopped".to_string();
            run.ended_at = Some(iso_now());
            let run = run.clone();
            let _ = state
                .store
                .append_record(&thread_id, &AgentRecord::Run { run: run.clone() });
            events::emit(&app, events::RUN_UPDATED, &run);
        }
        if let Some(index) = thread_index(&state, &thread_id) {
            state.threads[index].ui_status = "idle".to_string();
            state.threads[index].updated_at = iso_now();
            let thread = state.threads[index].clone();
            let _ = save_threads(&state);
            events::emit(&app, events::THREAD_UPDATED, &thread);
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub async fn agent_approval_respond(
    app: AppHandle,
    state: State<'_, AgentManager>,
    approval_id: String,
    decision: String,
    feedback: Option<String>,
) -> Result<(), String> {
    let decision_value = permissions::validate_decision(&decision)?;
    let codex_reply = {
        let state = state.lock();
        state.codex.as_ref().and_then(|runtime| {
            state
                .codex_requests
                .get(&approval_id)
                .map(|raw| (runtime.client.clone(), raw.clone()))
        })
    };
    if let Some((client, raw_id)) = codex_reply {
        let mapped = match decision_value {
            "once" => "accept",
            "always" => "acceptForSession",
            _ => "decline",
        };
        client.reply(&raw_id, json!({ "decision": mapped }))?;
        let mut state = state.lock();
        state.codex_requests.remove(&approval_id);
        if let Some(approval) = state.approvals.get_mut(&approval_id) {
            approval.decision = Some(decision_value.to_string());
            approval.resolved_at = Some(iso_now());
            let approval = approval.clone();
            state.store.append_record(
                &approval.thread_id,
                &AgentRecord::ApprovalResolved {
                    approval_id: approval.id.clone(),
                    decision: decision_value.to_string(),
                },
            )?;
            events::emit(&app, events::APPROVAL_RESOLVED, &approval);
        }
        return Ok(());
    }
    let (approval, project, session, port, password) = {
        let state = state.lock();
        let approval = state
            .approvals
            .get(&approval_id)
            .cloned()
            .ok_or_else(|| "Approval not found.".to_string())?;
        let thread = state
            .threads
            .iter()
            .find(|thread| thread.id == approval.thread_id)
            .ok_or_else(|| "Chat not found.".to_string())?;
        let project = project_path(&state, &thread.project_id)
            .ok_or_else(|| "Project not found.".to_string())?;
        let session = thread
            .native_session_id
            .clone()
            .ok_or_else(|| "Provider session not found.".to_string())?;
        let (port, password) = state
            .server
            .as_ref()
            .map(|server| (server.port, server.password.clone()))
            .ok_or_else(|| "OpenCode is not running.".to_string())?;
        (approval, project, session, port, password)
    };
    opencode::reply_permission(
        port,
        &password,
        &project,
        &session,
        &approval.provider_request_id,
        decision_value,
        feedback.as_deref(),
    )?;
    let mut state = state.lock();
    if let Some(approval) = state.approvals.get_mut(&approval_id) {
        approval.decision = Some(decision_value.to_string());
        approval.resolved_at = Some(iso_now());
        let approval = approval.clone();
        state.store.append_record(
            &approval.thread_id,
            &AgentRecord::ApprovalResolved {
                approval_id: approval.id.clone(),
                decision: decision_value.to_string(),
            },
        )?;
        events::emit(&app, events::APPROVAL_RESOLVED, &approval);
    }
    Ok(())
}

#[tauri::command(async)]
pub async fn agent_question_respond(
    app: AppHandle,
    state: State<'_, AgentManager>,
    question_id: String,
    answers: Value,
) -> Result<(), String> {
    let codex_reply = {
        let state = state.lock();
        state.codex.as_ref().and_then(|runtime| {
            state.codex_questions.get(&question_id).map(|raw| {
                (
                    runtime.client.clone(),
                    raw.clone(),
                    state.questions.get(&question_id).cloned(),
                )
            })
        })
    };
    if let Some((client, raw_id, question)) = codex_reply {
        let mut mapped = serde_json::Map::new();
        if let Value::Object(values) = &answers {
            for (key, value) in values {
                let list = match value {
                    Value::Array(values) => Value::Array(values.clone()),
                    Value::String(value) => json!([value]),
                    other => json!([other]),
                };
                mapped.insert(key.clone(), json!({ "answers": list }));
            }
        }
        client.reply(&raw_id, json!({ "answers": mapped }))?;
        let mut state = state.lock();
        state.codex_questions.remove(&question_id);
        if question.is_some() {
            if let Some(stored) = state.questions.get_mut(&question_id) {
                stored.status = "answered".to_string();
                stored.answers = Some(answers.clone());
                let stored = stored.clone();
                state.store.append_record(
                    &stored.thread_id,
                    &AgentRecord::QuestionResolved {
                        question_id: stored.id.clone(),
                        status: "answered".to_string(),
                    },
                )?;
                events::emit(&app, events::QUESTION_RESOLVED, &stored);
            }
        }
        return Ok(());
    }
    let (question, port, password) = {
        let state = state.lock();
        let question = state
            .questions
            .get(&question_id)
            .cloned()
            .ok_or_else(|| "Question not found.".to_string())?;
        let (port, password) = state
            .server
            .as_ref()
            .map(|server| (server.port, server.password.clone()))
            .ok_or_else(|| "OpenCode is not running.".to_string())?;
        (question, port, password)
    };
    opencode::reply_question(
        port,
        &password,
        &question.provider_request_id,
        answers.clone(),
    )?;
    let mut state = state.lock();
    if let Some(question) = state.questions.get_mut(&question_id) {
        question.status = "answered".to_string();
        question.answers = Some(answers);
        let question = question.clone();
        state.store.append_record(
            &question.thread_id,
            &AgentRecord::QuestionResolved {
                question_id: question.id.clone(),
                status: "answered".to_string(),
            },
        )?;
        events::emit(&app, events::QUESTION_RESOLVED, &question);
    }
    Ok(())
}

#[tauri::command(async)]
pub async fn agent_question_reject(
    app: AppHandle,
    state: State<'_, AgentManager>,
    question_id: String,
) -> Result<(), String> {
    let codex_reply = {
        let state = state.lock();
        state.codex.as_ref().and_then(|runtime| {
            state
                .codex_questions
                .get(&question_id)
                .map(|raw| (runtime.client.clone(), raw.clone()))
        })
    };
    if let Some((client, raw_id)) = codex_reply {
        client.reply(&raw_id, json!({ "answers": {} }))?;
        let mut state = state.lock();
        state.codex_questions.remove(&question_id);
        if let Some(question) = state.questions.get_mut(&question_id) {
            question.status = "rejected".to_string();
            let question = question.clone();
            state.store.append_record(
                &question.thread_id,
                &AgentRecord::QuestionResolved {
                    question_id: question.id.clone(),
                    status: "rejected".to_string(),
                },
            )?;
            events::emit(&app, events::QUESTION_RESOLVED, &question);
        }
        return Ok(());
    }
    let (question, port, password) = {
        let state = state.lock();
        let question = state
            .questions
            .get(&question_id)
            .cloned()
            .ok_or_else(|| "Question not found.".to_string())?;
        let (port, password) = state
            .server
            .as_ref()
            .map(|server| (server.port, server.password.clone()))
            .ok_or_else(|| "OpenCode is not running.".to_string())?;
        (question, port, password)
    };
    opencode::reject_question(port, &password, &question.provider_request_id)?;
    let mut state = state.lock();
    if let Some(question) = state.questions.get_mut(&question_id) {
        question.status = "rejected".to_string();
        let question = question.clone();
        state.store.append_record(
            &question.thread_id,
            &AgentRecord::QuestionResolved {
                question_id: question.id.clone(),
                status: "rejected".to_string(),
            },
        )?;
        events::emit(&app, events::QUESTION_RESOLVED, &question);
    }
    Ok(())
}

#[tauri::command(async)]
pub async fn agent_reconcile(app: AppHandle, state: State<'_, AgentManager>) -> Result<(), String> {
    let mut state = state.lock();
    repair_all(&mut state)?;
    for thread in state.threads.clone() {
        events::emit(&app, events::THREAD_UPDATED, &thread);
    }
    Ok(())
}

// ---- Event pipeline -------------------------------------------------------

fn consume_events(
    app: AppHandle,
    inner: Arc<Mutex<AgentState>>,
    receiver: std::sync::mpsc::Receiver<StreamMessage>,
    stop: Arc<AtomicBool>,
    port: u16,
) {
    let mut pending: HashMap<String, (String, String)> = HashMap::new();
    loop {
        match receiver.recv_timeout(Duration::from_millis(32)) {
            Ok(StreamMessage::Event(event)) => {
                let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
                if kind == "message.part.delta" {
                    if let Some((item_id, thread_id, delta)) = delta_parts(&inner, &event) {
                        let entry = pending
                            .entry(item_id)
                            .or_insert_with(|| (thread_id, String::new()));
                        entry.1.push_str(&delta);
                        if entry.1.len() >= 8 * 1024 {
                            flush_pending(&app, &inner, &mut pending);
                        }
                    }
                } else {
                    flush_pending(&app, &inner, &mut pending);
                    apply_event(&app, &inner, &event);
                }
            }
            Ok(StreamMessage::Disconnected) => {
                flush_pending(&app, &inner, &mut pending);
                if !stop.load(Ordering::Relaxed) {
                    mark_provider_down(&app, &inner, port);
                }
            }
            Err(RecvTimeoutError::Timeout) => flush_pending(&app, &inner, &mut pending),
            Err(RecvTimeoutError::Disconnected) => {
                flush_pending(&app, &inner, &mut pending);
                return;
            }
        }
    }
}

fn thread_for_session(state: &AgentState, session_id: &str) -> Option<String> {
    state
        .threads
        .iter()
        .find(|thread| thread.native_session_id.as_deref() == Some(session_id))
        .map(|thread| thread.id.clone())
}

fn event_session(value: &Value) -> Option<&str> {
    let props = value.get("properties")?;
    props
        .get("sessionID")
        .and_then(Value::as_str)
        .or_else(|| props.get("sessionId").and_then(Value::as_str))
        .or_else(|| props.get("session_id").and_then(Value::as_str))
        .or_else(|| {
            props
                .get("info")
                .and_then(|info| info.get("sessionID"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            props
                .get("part")
                .and_then(|part| part.get("sessionID"))
                .and_then(Value::as_str)
        })
        .or_else(|| props.get("session").and_then(Value::as_str))
}

fn delta_parts(inner: &Arc<Mutex<AgentState>>, event: &Value) -> Option<(String, String, String)> {
    let props = event.get("properties")?;
    let session = event_session(event)?;
    let delta = props
        .get("delta")
        .and_then(Value::as_str)
        .or_else(|| props.get("text").and_then(Value::as_str))?;
    let item_id = props
        .get("partID")
        .and_then(Value::as_str)
        .or_else(|| props.get("partId").and_then(Value::as_str))?
        .to_string();
    let state = inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let thread_id = thread_for_session(&state, session)?;
    Some((item_id, thread_id, delta.to_string()))
}

fn flush_pending(
    app: &AppHandle,
    inner: &Arc<Mutex<AgentState>>,
    pending: &mut HashMap<String, (String, String)>,
) {
    if pending.is_empty() {
        return;
    }
    let entries: Vec<(String, String, String)> = pending
        .drain()
        .map(|(item_id, (thread_id, delta))| (item_id, thread_id, delta))
        .collect();
    let mut state = inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for (item_id, thread_id, delta) in entries {
        ensure_thread_loaded(&mut state, &thread_id);
        let run_id = active_run_id(&state, &thread_id).unwrap_or_default();
        let items = state.items.entry(thread_id.clone()).or_default();
        let index = items
            .iter()
            .position(|item| item.id == item_id)
            .unwrap_or_else(|| {
                items.push(AgentItem {
                    id: item_id.clone(),
                    run_id,
                    kind: "assistant".to_string(),
                    text: Some(String::new()),
                    reasoning: None,
                    name: None,
                    input: None,
                    output: None,
                    status: None,
                    message: None,
                    created_at: iso_now(),
                });
                items.len() - 1
            });
        let text = items[index].text.get_or_insert_with(String::new);
        text.push_str(&delta);
        let item = items[index].clone();
        let _ = state.store.append_record(
            &thread_id,
            &AgentRecord::ItemPatch {
                id: item.id.clone(),
                patch: json!({ "text": item.text.clone().unwrap_or_default() }),
            },
        );
        events::emit(app, events::ITEM_UPDATED, &item);
    }
}

fn mark_provider_down(app: &AppHandle, inner: &Arc<Mutex<AgentState>>, port: u16) {
    let mut state = inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if state.server.as_ref().map(|server| server.port) != Some(port) {
        return;
    }
    let now = iso_now();
    let run_ids: Vec<String> = state
        .runs
        .values()
        .filter(|run| active_run(run.status.as_str()))
        .map(|run| run.id.clone())
        .collect();
    let mut thread_ids = HashSet::new();
    for run_id in run_ids {
        if let Some(run) = state.runs.get_mut(&run_id) {
            run.status = "failed".to_string();
            run.ended_at = Some(now.clone());
            run.error = Some("The OpenCode provider disconnected.".to_string());
            thread_ids.insert(run.thread_id.clone());
            let run = run.clone();
            let _ = state
                .store
                .append_record(&run.thread_id, &AgentRecord::Run { run: run.clone() });
            events::emit(app, events::RUN_UPDATED, &run);
        }
    }
    for thread_id in thread_ids {
        if let Some(index) = thread_index(&state, &thread_id) {
            state.threads[index].ui_status = "error".to_string();
            state.threads[index].updated_at = now.clone();
            let thread = state.threads[index].clone();
            events::emit(app, events::THREAD_UPDATED, &thread);
        }
    }
    let _ = save_threads(&state);
    let status = status_payload(
        &state,
        Some("The OpenCode provider disconnected.".to_string()),
    );
    events::emit(app, events::PROVIDER_STATUS, &status);
}

fn set_thread_ui(state: &mut AgentState, thread_id: &str, status: &str) {
    if let Some(index) = thread_index(state, thread_id) {
        state.threads[index].ui_status = status.to_string();
        state.threads[index].updated_at = iso_now();
    }
}

fn finish_run(
    app: &AppHandle,
    state: &mut AgentState,
    thread_id: &str,
    status: &str,
    error: Option<String>,
) {
    let now = iso_now();
    let run_ids: Vec<String> = state
        .runs
        .values()
        .filter(|run| run.thread_id == thread_id && active_run(run.status.as_str()))
        .map(|run| run.id.clone())
        .collect();
    for run_id in run_ids {
        if let Some(run) = state.runs.get_mut(&run_id) {
            run.status = status.to_string();
            run.ended_at = Some(now.clone());
            run.error = error.clone();
            let run = run.clone();
            let _ = state
                .store
                .append_record(thread_id, &AgentRecord::Run { run: run.clone() });
            events::emit(app, events::RUN_UPDATED, &run);
        }
    }
    set_thread_ui(
        state,
        thread_id,
        if status == "completed" {
            "idle"
        } else {
            "error"
        },
    );
    if let Some(index) = thread_index(state, thread_id) {
        let thread = state.threads[index].clone();
        let _ = save_threads(state);
        events::emit(app, events::THREAD_UPDATED, &thread);
    }
}

fn upsert_part_item(app: &AppHandle, state: &mut AgentState, thread_id: &str, item: AgentItem) {
    let items = state.items.entry(thread_id.to_string()).or_default();
    let index = match items.iter().position(|existing| existing.id == item.id) {
        Some(index) => {
            let text = items[index].text.clone();
            let created = items[index].created_at.clone();
            items[index] = item;
            if items[index].text.is_none() {
                items[index].text = text;
            }
            items[index].created_at = created;
            index
        }
        None => {
            items.push(item);
            items.len() - 1
        }
    };
    let stored = items[index].clone();
    let _ = state.store.append_record(
        thread_id,
        &AgentRecord::Item {
            item: stored.clone(),
        },
    );
    events::emit(app, events::ITEM_UPDATED, &stored);
}

fn part_item(part: &Value, run_id: &str) -> Option<AgentItem> {
    let id = part.get("id").and_then(Value::as_str)?.to_string();
    let part_type = part.get("type").and_then(Value::as_str).unwrap_or("text");
    match part_type {
        "text" => Some(AgentItem {
            id,
            run_id: run_id.to_string(),
            kind: "assistant".to_string(),
            text: part.get("text").and_then(Value::as_str).map(str::to_string),
            reasoning: None,
            name: None,
            input: None,
            output: None,
            status: None,
            message: None,
            created_at: iso_now(),
        }),
        "reasoning" => Some(AgentItem {
            id,
            run_id: run_id.to_string(),
            kind: "assistant".to_string(),
            text: None,
            reasoning: part.get("text").and_then(Value::as_str).map(str::to_string),
            name: None,
            input: None,
            output: None,
            status: None,
            message: None,
            created_at: iso_now(),
        }),
        "tool" => {
            let state_value = part.get("state").cloned().unwrap_or(Value::Null);
            let status = match state_value.get("status").and_then(Value::as_str) {
                Some("completed") => "success",
                Some("error") => "failed",
                _ => "running",
            };
            Some(AgentItem {
                id: part
                    .get("callID")
                    .and_then(Value::as_str)
                    .unwrap_or(id.as_str())
                    .to_string(),
                run_id: run_id.to_string(),
                kind: "tool".to_string(),
                text: None,
                reasoning: None,
                name: part.get("tool").and_then(Value::as_str).map(str::to_string),
                input: state_value.get("input").cloned(),
                output: state_value
                    .get("output")
                    .cloned()
                    .filter(|value| !value.is_null()),
                status: Some(status.to_string()),
                message: None,
                created_at: iso_now(),
            })
        }
        _ => None,
    }
}

fn apply_event(app: &AppHandle, inner: &Arc<Mutex<AgentState>>, event: &Value) {
    let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
    let Some(session) = event_session(event) else {
        return;
    };
    let mut state = inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(thread_id) = thread_for_session(&state, session) else {
        return;
    };
    ensure_thread_loaded(&mut state, &thread_id);
    let run_id = active_run_id(&state, &thread_id).unwrap_or_default();
    let props = event.get("properties").cloned().unwrap_or(Value::Null);
    match kind {
        "session.idle" => finish_run(app, &mut state, &thread_id, "completed", None),
        "session.error" => {
            let message = props
                .get("error")
                .map(|error| {
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| error.to_string())
                })
                .unwrap_or_else(|| "The provider reported an error.".to_string());
            finish_run(app, &mut state, &thread_id, "failed", Some(message));
        }
        "session.status" => {
            let status = props
                .get("status")
                .and_then(|status| status.get("type"))
                .and_then(Value::as_str)
                .or_else(|| props.get("status").and_then(Value::as_str));
            match status {
                Some("busy" | "running" | "working") => {
                    set_thread_ui(&mut state, &thread_id, "working");
                }
                Some("idle") => {
                    if active_run_id(&state, &thread_id).is_none() {
                        set_thread_ui(&mut state, &thread_id, "idle");
                    }
                }
                _ => {}
            }
        }
        "message.updated" => {
            let info = props.get("info").unwrap_or(&props);
            let role = info.get("role").and_then(Value::as_str).unwrap_or("");
            let Some(message_id) = info.get("id").and_then(Value::as_str) else {
                return;
            };
            if role == "user" && state.user_message_ids.insert(message_id.to_string()) {
                let stored = state
                    .items
                    .entry(thread_id.clone())
                    .or_default()
                    .iter()
                    .find(|item| {
                        item.kind == "user"
                            && item.id.starts_with("local-")
                            && item.run_id == run_id
                    })
                    .cloned();
                if let Some(stored) = stored {
                    let _ = state.store.append_record(
                        &thread_id,
                        &AgentRecord::Item {
                            item: stored.clone(),
                        },
                    );
                    events::emit(app, events::ITEM_UPDATED, &stored);
                }
            }
        }
        "message.part.updated" => {
            let Some(part) = props.get("part") else {
                return;
            };
            if part
                .get("messageID")
                .and_then(Value::as_str)
                .map(|message_id| {
                    state.user_message_ids.contains(message_id)
                        || state
                            .items
                            .get(&thread_id)
                            .map(|items| {
                                items
                                    .iter()
                                    .any(|item| item.id == message_id && item.kind == "user")
                            })
                            .unwrap_or(false)
                })
                .unwrap_or(false)
            {
                return;
            }
            if let Some(item) = part_item(part, &run_id) {
                upsert_part_item(app, &mut state, &thread_id, item);
            }
        }
        "permission.asked" => {
            let request_id = props
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let action = props
                .get("permission")
                .and_then(Value::as_str)
                .unwrap_or("permission")
                .to_string();
            let resources: Vec<String> = props
                .get("patterns")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let detail = if resources.is_empty() {
                props
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("OpenCode requested approval.")
                    .to_string()
            } else {
                resources.join("\n")
            };
            let approval = AgentApproval {
                id: new_id("approval"),
                thread_id: thread_id.clone(),
                run_id: run_id.clone(),
                provider_request_id: request_id,
                title: format!("Approve {action}"),
                detail,
                action: Some(action),
                resources: (!resources.is_empty()).then_some(resources),
                decision: None,
                created_at: iso_now(),
                resolved_at: None,
            };
            state
                .approvals
                .insert(approval.id.clone(), approval.clone());
            let _ = state.store.append_record(
                &thread_id,
                &AgentRecord::Approval {
                    approval: approval.clone(),
                },
            );
            set_thread_ui(&mut state, &thread_id, "needs-input");
            let _ = save_threads(&state);
            events::emit(app, events::APPROVAL_REQUESTED, &approval);
        }
        "permission.replied" => {
            let request_id = props
                .get("id")
                .and_then(Value::as_str)
                .or_else(|| props.get("requestID").and_then(Value::as_str))
                .unwrap_or_default();
            let decision = props
                .get("response")
                .and_then(Value::as_str)
                .unwrap_or("once")
                .to_string();
            let approval = state
                .approvals
                .values_mut()
                .find(|approval| approval.provider_request_id == request_id);
            if let Some(approval) = approval {
                approval.decision = Some(decision.clone());
                approval.resolved_at = Some(iso_now());
                let approval = approval.clone();
                let _ = state.store.append_record(
                    &thread_id,
                    &AgentRecord::ApprovalResolved {
                        approval_id: approval.id.clone(),
                        decision,
                    },
                );
                events::emit(app, events::APPROVAL_RESOLVED, &approval);
            }
        }
        "question.asked" => {
            let request_id = props
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let questions = parse_questions(&props);
            if questions.is_empty() {
                return;
            }
            let question = AgentQuestion {
                id: new_id("question"),
                thread_id: thread_id.clone(),
                run_id: run_id.clone(),
                provider_request_id: request_id,
                questions,
                answers: None,
                status: "pending".to_string(),
                created_at: iso_now(),
            };
            state
                .questions
                .insert(question.id.clone(), question.clone());
            let _ = state.store.append_record(
                &thread_id,
                &AgentRecord::Question {
                    question: question.clone(),
                },
            );
            set_thread_ui(&mut state, &thread_id, "needs-input");
            let _ = save_threads(&state);
            events::emit(app, events::QUESTION_REQUESTED, &question);
        }
        "question.replied" | "question.rejected" => {
            let request_id = props
                .get("id")
                .and_then(Value::as_str)
                .or_else(|| props.get("requestID").and_then(Value::as_str))
                .unwrap_or_default();
            let status = if kind == "question.replied" {
                "answered"
            } else {
                "rejected"
            };
            let question = state
                .questions
                .values_mut()
                .find(|question| question.provider_request_id == request_id);
            if let Some(question) = question {
                question.status = status.to_string();
                let question = question.clone();
                let _ = state.store.append_record(
                    &thread_id,
                    &AgentRecord::QuestionResolved {
                        question_id: question.id.clone(),
                        status: status.to_string(),
                    },
                );
                events::emit(app, events::QUESTION_RESOLVED, &question);
            }
        }
        "session.compacted" => {
            let item = AgentItem {
                id: new_id("info"),
                run_id,
                kind: "info".to_string(),
                text: Some("Session compacted.".to_string()),
                reasoning: None,
                name: None,
                input: None,
                output: None,
                status: None,
                message: None,
                created_at: iso_now(),
            };
            state
                .items
                .entry(thread_id.clone())
                .or_default()
                .push(item.clone());
            let _ = state
                .store
                .append_record(&thread_id, &AgentRecord::Item { item: item.clone() });
            events::emit(app, events::ITEM_UPDATED, &item);
        }
        "file.edited" => {
            let path = props
                .get("file")
                .and_then(Value::as_str)
                .or_else(|| props.get("path").and_then(Value::as_str))
                .unwrap_or("file");
            let item = AgentItem {
                id: new_id("info"),
                run_id,
                kind: "info".to_string(),
                text: Some(format!("Edited {path}")),
                reasoning: None,
                name: None,
                input: None,
                output: None,
                status: None,
                message: None,
                created_at: iso_now(),
            };
            state
                .items
                .entry(thread_id.clone())
                .or_default()
                .push(item.clone());
            let _ = state
                .store
                .append_record(&thread_id, &AgentRecord::Item { item: item.clone() });
            events::emit(app, events::ITEM_UPDATED, &item);
        }
        _ => {}
    }
}

fn parse_questions(props: &Value) -> Vec<AgentQuestionPrompt> {
    let list = props
        .get("questions")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| props.as_array().cloned())
        .unwrap_or_default();
    list.into_iter()
        .filter_map(|value| {
            let question = value
                .get("question")
                .and_then(Value::as_str)
                .or_else(|| value.get("prompt").and_then(Value::as_str))?
                .to_string();
            let options = value
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .filter_map(|option| {
                            let label = option
                                .get("label")
                                .and_then(Value::as_str)
                                .or_else(|| option.get("value").and_then(Value::as_str))?;
                            Some(AgentQuestionOption {
                                label: label.to_string(),
                                description: option
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .map(str::to_string),
                            })
                        })
                        .collect()
                });
            Some(AgentQuestionPrompt {
                id: value
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| new_id("q")),
                header: value
                    .get("header")
                    .and_then(Value::as_str)
                    .unwrap_or("Question")
                    .to_string(),
                question,
                options,
                multiple: value.get("multiple").and_then(Value::as_bool),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_thread_summaries() {
        let thread = AgentThread {
            id: "thread-1".into(),
            project_id: "project-1".into(),
            provider_instance_id: "opencode-default".into(),
            title: "Chat".into(),
            model: None,
            permission_mode: "supervised".into(),
            native_session_id: None,
            ui_status: "idle".into(),
            created_at: "now".into(),
            updated_at: "now".into(),
            last_visited_at: None,
            archived_at: None,
            pinned_at: None,
        };
        let summary = AgentThreadSummary::from(&thread);
        assert_eq!(summary.id, "thread-1");
        assert_eq!(summary.provider_instance_id, "opencode-default");
    }

    #[test]
    fn recognizes_active_run_states() {
        assert!(active_run("running"));
        assert!(active_run("waiting"));
        assert!(!active_run("completed"));
        assert!(!active_run("stopped"));
    }

    #[test]
    fn parses_question_payloads() {
        let props = json!({
            "questions": [{
                "id": "q1",
                "header": "Pick",
                "question": "Which one?",
                "options": [{ "label": "A", "description": "first" }],
                "multiple": false
            }]
        });
        let questions = parse_questions(&props);
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].options.as_ref().unwrap().len(), 1);
    }
}
