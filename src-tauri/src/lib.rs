use notify_debouncer_full::{
    new_debouncer,
    notify::{event::EventKind, event::ModifyKind, event::RenameMode, Event, RecommendedWatcher},
    Debouncer, RecommendedCache,
};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, sync_channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

#[derive(Default)]
struct TerminalState(Mutex<TerminalSessions>);

#[derive(Default)]
struct LocalHttpServerState(Mutex<HashMap<String, LocalHttpServer>>);

#[derive(Default)]
struct PluginProcessState(Mutex<HashMap<String, Arc<PluginProcess>>>);

struct PluginProcess {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
}

#[derive(Default)]
struct PluginSocketState(Mutex<HashMap<String, PluginSocketConnection>>);

enum PluginSocketConnection {
    Tcp(TcpStream),
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixStream),
    #[cfg(windows)]
    Pipe(std::fs::File),
}

#[derive(Default)]
struct PluginHttpServerState(Mutex<HashMap<String, PluginHttpServer>>);

struct PluginHttpServer {
    stop: Arc<AtomicBool>,
    pending: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<HttpReply>>>>,
    thread: Option<JoinHandle<()>>,
    _active_connections: Arc<AtomicUsize>,
}

struct HttpReply {
    status: u16,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Serialize, Clone)]
struct PluginProcessOutput {
    id: String,
    stream: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct PluginProcessExit {
    id: String,
    code: Option<i32>,
    signal: Option<String>,
}

#[derive(Serialize, Clone)]
struct PluginProcessErrorEvent {
    id: String,
    error: String,
}

#[derive(Serialize, Clone)]
struct TerminalExit {
    id: String,
    code: Option<u32>,
}

#[derive(Serialize, Clone)]
struct PluginSocketData {
    id: String,
    data: Vec<u8>,
}

#[derive(Serialize, Clone)]
struct PluginSocketClose {
    id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PluginHttpRequestEvent {
    id: String,
    request_id: String,
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Serialize, Clone)]
struct PluginHttpServerInfo {
    id: String,
    url: String,
}

static PLUGIN_PROCESS_COUNTER: AtomicU64 = AtomicU64::new(0);
static PLUGIN_SOCKET_COUNTER: AtomicU64 = AtomicU64::new(0);
static PLUGIN_HTTP_COUNTER: AtomicU64 = AtomicU64::new(0);
static PLUGIN_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Upper bound on concurrently handled HTTP connections per embedded server.
const MAX_SERVER_CONNECTIONS: usize = 64;

struct ConnectionSlot(Arc<AtomicUsize>);

impl Drop for ConnectionSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn acquire_connection_slot(active: &Arc<AtomicUsize>) -> Option<ConnectionSlot> {
    if active.fetch_add(1, Ordering::AcqRel) >= MAX_SERVER_CONNECTIONS {
        active.fetch_sub(1, Ordering::AcqRel);
        return None;
    }
    Some(ConnectionSlot(Arc::clone(active)))
}

impl Drop for PluginProcessState {
    fn drop(&mut self) {
        let Ok(processes) = self.0.get_mut() else {
            return;
        };
        for process in processes.values() {
            if let Ok(mut child) = process.child.lock() {
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }
    }
}

impl Drop for PluginHttpServerState {
    fn drop(&mut self) {
        let Ok(servers) = self.0.get_mut() else {
            return;
        };
        for (_, mut server) in servers.drain() {
            server.stop.store(true, Ordering::Relaxed);
            if let Some(thread) = server.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

struct LocalHttpServer {
    root: PathBuf,
    port: u16,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
    _active_connections: Arc<AtomicUsize>,
}

#[derive(Default)]
struct TerminalSessions {
    active: HashMap<String, Arc<TerminalProcess>>,
    closed: VecDeque<String>,
}

struct TerminalProcess {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

#[derive(Serialize, Clone)]
struct TerminalOutput {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct LocalServerInfo {
    root: String,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubChange {
    path: String,
    status: String,
    staged: bool,
    unstaged: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubStatus {
    platform: String,
    git_installed: bool,
    gh_installed: bool,
    authenticated: bool,
    is_repo: bool,
    is_github_repo: bool,
    branch: Option<String>,
    branches: Vec<String>,
    remote: Option<String>,
    repo_url: Option<String>,
    ahead: usize,
    behind: usize,
    changes: Vec<GithubChange>,
    user_name: String,
    user_email: String,
}

impl Drop for LocalHttpServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

impl Drop for LocalHttpServerState {
    fn drop(&mut self) {
        if let Ok(servers) = self.0.get_mut() {
            servers.clear();
        }
    }
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        let Ok(sessions) = self.0.get_mut() else {
            return;
        };
        for process in sessions.active.values() {
            if let Ok(mut child) = process.child.lock() {
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
fn terminal_spawn(
    app: tauri::AppHandle,
    state: State<'_, TerminalState>,
    id: String,
    cwd: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
    if sessions.closed.iter().any(|closed| closed == &id) {
        return Err("Terminal session is closed".to_string());
    }
    if sessions.active.contains_key(&id) {
        return Ok(());
    }

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    let shell = env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut command_builder = CommandBuilder::new(&shell);
    #[cfg(target_os = "windows")]
    command_builder.arg("/Q");
    #[cfg(not(target_os = "windows"))]
    command_builder.arg("-i");
    command_builder.env("TERM", "xterm-256color");
    command_builder.env("COLORTERM", "truecolor");
    if let Some(directory) = cwd.filter(|path| !path.is_empty()) {
        command_builder.cwd(directory);
    }
    let child = pair
        .slave
        .spawn_command(command_builder)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let process = Arc::new(TerminalProcess {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });
    sessions.active.insert(id.clone(), process);
    if let Some(command) = command.filter(|command| !command.trim().is_empty()) {
        let process = sessions
            .active
            .get(&id)
            .expect("terminal process was inserted");
        let mut writer = process.writer.lock().map_err(|error| error.to_string())?;
        writer
            .write_all(format!("{}\r", command.trim()).as_bytes())
            .map_err(|error| error.to_string())?;
    }

    std::thread::spawn(move || read_terminal_output(app, id, reader));
    Ok(())
}

fn read_terminal_output(app: tauri::AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    let (sender, receiver) = sync_channel::<Vec<u8>>(4);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    if sender.send(buffer[..length].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut pending = Vec::with_capacity(32 * 1024);
    loop {
        match receiver.recv_timeout(Duration::from_millis(8)) {
            Ok(chunk) => {
                pending.extend_from_slice(&chunk);
                if pending.len() >= 32 * 1024 && !emit_terminal_output(&app, &id, &mut pending) {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if !emit_terminal_output(&app, &id, &mut pending) {
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                emit_terminal_output(&app, &id, &mut pending);
                break;
            }
        }
    }

    if let Some(state) = app.try_state::<TerminalState>() {
        let process = state
            .0
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.active.remove(&id));
        if let Some(process) = process {
            if let Ok(mut child) = process.child.lock() {
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
                let status = child.wait().ok();
                let _ = app.emit(
                    "terminal-exit",
                    TerminalExit {
                        id: id.clone(),
                        code: status.map(|status| status.exit_code()),
                    },
                );
            }
        }
    }
}

fn emit_terminal_output(app: &tauri::AppHandle, id: &str, pending: &mut Vec<u8>) -> bool {
    if pending.is_empty() {
        return true;
    }
    let data = String::from_utf8_lossy(pending).into_owned();
    pending.clear();
    app.emit(
        "terminal-output",
        TerminalOutput {
            id: id.to_string(),
            data,
        },
    )
    .is_ok()
}

#[tauri::command]
fn terminal_write(state: State<'_, TerminalState>, id: String, data: String) -> Result<(), String> {
    let process = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .active
        .get(&id)
        .cloned()
        .ok_or_else(|| "Terminal session not found".to_string())?;
    let mut writer = process.writer.lock().map_err(|error| error.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let process = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .active
        .get(&id)
        .cloned()
        .ok_or_else(|| "Terminal session not found".to_string())?;
    let master = process.master.lock().map_err(|error| error.to_string())?;
    master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_close(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    let process = {
        let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
        if !sessions.closed.iter().any(|closed| closed == &id) {
            sessions.closed.push_back(id.clone());
            if sessions.closed.len() > 128 {
                sessions.closed.pop_front();
            }
        }
        sessions.active.remove(&id)
    };
    if let Some(process) = process {
        if let Ok(mut child) = process.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

#[tauri::command]
async fn workspace_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog().file().set_title("Open workspace");
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

#[tauri::command]
fn workspace_access_allowed(app: tauri::AppHandle, root: String) -> Result<bool, String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access folder: {error}"))?;
    Ok(app.fs_scope().is_allowed(root))
}

#[tauri::command]
fn workspace_grant_access(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access folder: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace path is not a folder.".to_string());
    }
    let scope = app.fs_scope();
    if scope.is_allowed(&root) {
        return Ok(());
    }
    scope
        .allow_directory(root, true)
        .map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
struct HiddenPathGrant {
    path: String,
    directory: bool,
}

#[tauri::command]
fn workspace_allow_hidden_paths(
    app: tauri::AppHandle,
    root: String,
    paths: Vec<HiddenPathGrant>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access workspace: {error}"))?;
    let scope = app.fs_scope();
    for entry in paths {
        let path = PathBuf::from(entry.path)
            .canonicalize()
            .map_err(|error| format!("Could not access hidden path: {error}"))?;
        if !path.starts_with(&root) {
            return Err("Hidden path is outside the workspace.".to_string());
        }
        if scope.is_allowed(&path) {
            continue;
        }
        if entry.directory {
            scope
                .allow_directory(path, true)
                .map_err(|error| error.to_string())?;
        } else {
            scope.allow_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn plugin_process_is_running(names: Vec<String>) -> Result<bool, String> {
    if names.is_empty()
        || names.iter().any(|name| {
            name.is_empty()
                || name.contains('/')
                || name.contains('\\')
                || name.chars().any(char::is_whitespace)
        })
    {
        return Err("Process names must be non-empty executable names.".to_string());
    }
    #[cfg(target_os = "linux")]
    {
        let processes = fs::read_dir("/proc")
            .map_err(|error| format!("Could not inspect running processes: {error}"))?;
        for process in processes.flatten() {
            if !process
                .file_name()
                .to_string_lossy()
                .chars()
                .all(|character| character.is_ascii_digit())
            {
                continue;
            }
            let command_line = fs::read(process.path().join("cmdline")).unwrap_or_default();
            let matches = command_line
                .split(|byte| *byte == 0)
                .filter_map(|argument| std::str::from_utf8(argument).ok())
                .filter_map(|argument| Path::new(argument).file_name())
                .any(|name| {
                    names
                        .iter()
                        .any(|candidate| name.to_string_lossy() == candidate.as_str())
                });
            if matches {
                return Ok(true);
            }
        }
        Ok(false)
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(false)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessExecResult {
    stdout: String,
    stderr: String,
    code: Option<i32>,
    signal: Option<String>,
}

fn process_exit_signal(status: &std::process::ExitStatus) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.signal().map(|signal| signal.to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}

fn stream_process_output(
    app: tauri::AppHandle,
    id: String,
    stream: &'static str,
    mut reader: Box<dyn Read + Send>,
) {
    let (sender, receiver) = sync_channel::<Vec<u8>>(4);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    if sender.send(buffer[..length].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut pending: Vec<u8> = Vec::with_capacity(32 * 1024);
    let emit = |pending: &mut Vec<u8>| {
        if pending.is_empty() {
            return;
        }
        let _ = app.emit(
            "plugin-process-output",
            PluginProcessOutput {
                id: id.clone(),
                stream: stream.to_string(),
                data: String::from_utf8_lossy(pending).into_owned(),
            },
        );
        pending.clear();
    };
    loop {
        match receiver.recv_timeout(Duration::from_millis(8)) {
            Ok(chunk) => {
                pending.extend_from_slice(&chunk);
                if pending.len() >= 32 * 1024 {
                    emit(&mut pending);
                }
            }
            Err(RecvTimeoutError::Timeout) => emit(&mut pending),
            Err(RecvTimeoutError::Disconnected) => {
                emit(&mut pending);
                break;
            }
        }
    }
}

#[tauri::command]
fn plugin_process_spawn(
    app: tauri::AppHandle,
    state: State<'_, PluginProcessState>,
    plugin_id: String,
    executable: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<String, String> {
    if executable.trim().is_empty() {
        return Err("An executable is required.".to_string());
    }
    let id = format!(
        "{plugin_id}-{}-{}",
        now_millis(),
        PLUGIN_PROCESS_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let mut command = external_command(&executable);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(directory) = cwd.filter(|path| !path.is_empty()) {
        command.current_dir(directory);
    }
    for (key, value) in env.unwrap_or_default() {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not spawn {executable}: {error}"))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let process = Arc::new(PluginProcess {
        stdin: Mutex::new(stdin),
        child: Mutex::new(child),
    });
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(id.clone(), process.clone());
    if let Some(stdout) = stdout {
        let app = app.clone();
        let output_id = id.clone();
        std::thread::spawn(move || {
            stream_process_output(app, output_id, "stdout", Box::new(stdout))
        });
    }
    if let Some(stderr) = stderr {
        let app = app.clone();
        let output_id = id.clone();
        std::thread::spawn(move || {
            stream_process_output(app, output_id, "stderr", Box::new(stderr))
        });
    }
    let app_exit = app.clone();
    let exit_id = id.clone();
    std::thread::spawn(move || {
        let mut interval = Duration::from_millis(50);
        loop {
            let status = {
                let Ok(mut child) = process.child.lock() else {
                    break;
                };
                match child.try_wait() {
                    Ok(Some(status)) => Some(status),
                    Ok(None) => None,
                    Err(ref error) => {
                        let _ = app_exit.emit(
                            "plugin-process-error",
                            PluginProcessErrorEvent {
                                id: exit_id.clone(),
                                error: error.to_string(),
                            },
                        );
                        break;
                    }
                }
            };
            if let Some(status) = status {
                let _ = app_exit.emit(
                    "plugin-process-exit",
                    PluginProcessExit {
                        id: exit_id.clone(),
                        code: status.code(),
                        signal: process_exit_signal(&status),
                    },
                );
                if let Some(state) = app_exit.try_state::<PluginProcessState>() {
                    if let Ok(mut processes) = state.0.lock() {
                        processes.remove(&exit_id);
                    }
                }
                break;
            }
            std::thread::sleep(interval);
            interval = (interval * 2).min(Duration::from_millis(500));
        }
    });
    Ok(id)
}

#[tauri::command]
fn plugin_process_write(
    state: State<'_, PluginProcessState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let process = {
        let processes = state.0.lock().map_err(|error| error.to_string())?;
        processes.get(&id).cloned()
    };
    let process = process.ok_or_else(|| "Process is not running.".to_string())?;
    let mut stdin = process.stdin.lock().map_err(|error| error.to_string())?;
    let stdin = stdin
        .as_mut()
        .ok_or_else(|| "Process stdin is closed.".to_string())?;
    stdin
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn plugin_process_close_stdin(
    state: State<'_, PluginProcessState>,
    id: String,
) -> Result<(), String> {
    let process = {
        let processes = state.0.lock().map_err(|error| error.to_string())?;
        processes.get(&id).cloned()
    };
    let process = process.ok_or_else(|| "Process is not running.".to_string())?;
    process
        .stdin
        .lock()
        .map_err(|error| error.to_string())?
        .take();
    Ok(())
}

#[tauri::command]
fn plugin_process_stop(
    state: State<'_, PluginProcessState>,
    id: String,
    timeout_ms: Option<u64>,
) -> Result<(), String> {
    let process = {
        let processes = state.0.lock().map_err(|error| error.to_string())?;
        processes.get(&id).cloned()
    };
    let Some(process) = process else {
        return Ok(());
    };
    let mut child = process.child.lock().map_err(|error| error.to_string())?;
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none()
    {
        let _ = child.kill();
    }
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(2000));
    while Instant::now() < deadline {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}

#[tauri::command]
fn plugin_process_exec(
    executable: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<ProcessExecResult, String> {
    if executable.trim().is_empty() {
        return Err("An executable is required.".to_string());
    }
    let _ = timeout_ms;
    let mut command = external_command(&executable);
    command.args(&args);
    if let Some(directory) = cwd.filter(|path| !path.is_empty()) {
        command.current_dir(directory);
    }
    for (key, value) in env.unwrap_or_default() {
        command.env(key, value);
    }
    let output = command
        .output()
        .map_err(|error| format!("Could not run {executable}: {error}"))?;
    Ok(ProcessExecResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code: output.status.code(),
        signal: process_exit_signal(&output.status),
    })
}

fn find_executable(executable: &str) -> Option<PathBuf> {
    let candidate = Path::new(executable);
    if candidate.components().count() > 1 {
        return candidate.is_file().then(|| candidate.to_path_buf());
    }
    let path = env::var_os("PATH")?;
    for directory in env::split_paths(&path) {
        let full = directory.join(executable);
        if full.is_file() {
            return Some(full);
        }
        #[cfg(windows)]
        {
            for extension in env::var_os("PATHEXT")
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| ".EXE;.CMD;.BAT;.COM".to_string())
                .split(';')
            {
                let full = directory.join(format!("{executable}{extension}"));
                if full.is_file() {
                    return Some(full);
                }
            }
        }
    }
    None
}

#[tauri::command]
fn plugin_process_which(executable: String) -> Result<Option<String>, String> {
    Ok(find_executable(&executable).map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn plugin_socket_connect(
    app: tauri::AppHandle,
    state: State<'_, PluginSocketState>,
    plugin_id: String,
    transport: String,
    target: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let id = format!(
        "{plugin_id}-{}-{}",
        now_millis(),
        PLUGIN_SOCKET_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000));
    let (connection, reader): (PluginSocketConnection, Box<dyn Read + Send>) = match transport
        .as_str()
    {
        "tcp" => {
            let address = target
                .to_socket_addrs()
                .map_err(|error| error.to_string())?
                .next()
                .ok_or_else(|| "Could not resolve address.".to_string())?;
            let stream =
                TcpStream::connect_timeout(&address, timeout).map_err(|error| error.to_string())?;
            let reader = stream.try_clone().map_err(|error| error.to_string())?;
            (PluginSocketConnection::Tcp(stream), Box::new(reader))
        }
        "unix" => {
            #[cfg(unix)]
            {
                let stream = std::os::unix::net::UnixStream::connect(&target)
                    .map_err(|error| error.to_string())?;
                let reader = stream.try_clone().map_err(|error| error.to_string())?;
                (PluginSocketConnection::Unix(stream), Box::new(reader))
            }
            #[cfg(not(unix))]
            {
                return Err("Unix-domain sockets are not supported on this platform.".to_string());
            }
        }
        "pipe" => {
            #[cfg(windows)]
            {
                let file = std::fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(format!(r"\\.\pipe\{target}"))
                    .map_err(|error| error.to_string())?;
                let reader = file.try_clone().map_err(|error| error.to_string())?;
                (PluginSocketConnection::Pipe(file), Box::new(reader))
            }
            #[cfg(not(windows))]
            {
                return Err("Named pipes are only supported on Windows.".to_string());
            }
        }
        _ => return Err(format!("Unsupported socket transport: {transport}")),
    };
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(id.clone(), connection);
    let read_id = id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    if app
                        .emit(
                            "plugin-socket-data",
                            PluginSocketData {
                                id: read_id.clone(),
                                data: buffer[..length].to_vec(),
                            },
                        )
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        let _ = app.emit(
            "plugin-socket-close",
            PluginSocketClose {
                id: read_id.clone(),
            },
        );
        if let Some(state) = app.try_state::<PluginSocketState>() {
            if let Ok(mut sockets) = state.0.lock() {
                sockets.remove(&read_id);
            }
        }
    });
    Ok(id)
}

#[tauri::command]
fn plugin_socket_write(
    state: State<'_, PluginSocketState>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut sockets = state.0.lock().map_err(|error| error.to_string())?;
    let socket = sockets
        .get_mut(&id)
        .ok_or_else(|| "Socket is not connected.".to_string())?;
    match socket {
        PluginSocketConnection::Tcp(stream) => {
            stream.write_all(&data).map_err(|error| error.to_string())
        }
        #[cfg(unix)]
        PluginSocketConnection::Unix(stream) => {
            stream.write_all(&data).map_err(|error| error.to_string())
        }
        #[cfg(windows)]
        PluginSocketConnection::Pipe(file) => {
            file.write_all(&data).map_err(|error| error.to_string())
        }
    }
}

#[tauri::command]
fn plugin_socket_close(state: State<'_, PluginSocketState>, id: String) -> Result<(), String> {
    let socket = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&id);
    if let Some(socket) = socket {
        match socket {
            PluginSocketConnection::Tcp(stream) => {
                let _ = stream.shutdown(Shutdown::Both);
            }
            #[cfg(unix)]
            PluginSocketConnection::Unix(stream) => {
                let _ = stream.shutdown(Shutdown::Both);
            }
            #[cfg(windows)]
            PluginSocketConnection::Pipe(file) => {
                let _ = file;
            }
        }
    }
    Ok(())
}

fn read_http_request(
    stream: &mut TcpStream,
) -> Result<(String, String, HashMap<String, String>, Vec<u8>), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(15)))
        .map_err(|error| error.to_string())?;
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let length = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if length == 0 {
            return Err("Connection closed before request headers.".to_string());
        }
        buffer.extend_from_slice(&chunk[..length]);
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
        if buffer.len() > 64 * 1024 {
            return Err("Request headers are too large.".to_string());
        }
    };
    let header_text = String::from_utf8_lossy(&buffer[..header_end]).into_owned();
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let url = parts.next().unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let length = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if length == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..length]);
    }
    body.truncate(content_length);
    Ok((method, url, headers, body))
}

fn write_http_response(stream: &mut TcpStream, reply: HttpReply) -> Result<(), String> {
    let mut headers = reply.headers;
    headers
        .entry("content-length".to_string())
        .or_insert_with(|| reply.body.len().to_string());
    let mut response = format!("HTTP/1.1 {} OK\r\n", reply.status);
    for (key, value) in &headers {
        response.push_str(&format!("{key}: {value}\r\n"));
    }
    response.push_str("connection: close\r\n\r\n");
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&reply.body)
        .map_err(|error| error.to_string())
}

fn handle_plugin_http_connection(
    app: tauri::AppHandle,
    server_id: String,
    pending: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<HttpReply>>>>,
    mut stream: TcpStream,
) {
    let Ok((method, url, headers, body)) = read_http_request(&mut stream) else {
        return;
    };
    let request_id = format!(
        "request-{}",
        PLUGIN_REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, receiver) = channel();
    if let Ok(mut waiting) = pending.lock() {
        waiting.insert(request_id.clone(), sender);
    }
    let _ = app.emit(
        "plugin-http-request",
        PluginHttpRequestEvent {
            id: server_id.clone(),
            request_id: request_id.clone(),
            method,
            url,
            headers,
            body,
        },
    );
    let reply = receiver
        .recv_timeout(Duration::from_secs(30))
        .unwrap_or_else(|_| HttpReply {
            status: 504,
            headers: HashMap::from([("content-type".to_string(), "text/plain".to_string())]),
            body: b"Plugin HTTP handler timed out.".to_vec(),
        });
    if let Ok(mut waiting) = pending.lock() {
        waiting.remove(&request_id);
    }
    let _ = write_http_response(&mut stream, reply);
}

#[tauri::command]
fn plugin_http_server_start(
    app: tauri::AppHandle,
    state: State<'_, PluginHttpServerState>,
    plugin_id: String,
    host: String,
    port: u16,
) -> Result<PluginHttpServerInfo, String> {
    let listener = TcpListener::bind((host.as_str(), port)).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let id = format!(
        "{plugin_id}-{}-{}",
        now_millis(),
        PLUGIN_HTTP_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let stop = Arc::new(AtomicBool::new(false));
    let pending: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<HttpReply>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let thread_stop = stop.clone();
    let thread_pending = pending.clone();
    let thread_id = id.clone();
    let active_connections = Arc::new(AtomicUsize::new(0));
    let thread_connections = Arc::clone(&active_connections);
    let thread = std::thread::spawn(move || {
        while !thread_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let Some(slot) = acquire_connection_slot(&thread_connections) else {
                        let _ = write_http_response(
                            &mut stream,
                            HttpReply {
                                status: 503,
                                headers: HashMap::from([(
                                    "content-type".to_string(),
                                    "text/plain".to_string(),
                                )]),
                                body: b"Too many concurrent requests.".to_vec(),
                            },
                        );
                        continue;
                    };
                    let app = app.clone();
                    let server_id = thread_id.clone();
                    let pending = thread_pending.clone();
                    std::thread::spawn(move || {
                        let _slot = slot;
                        handle_plugin_http_connection(app, server_id, pending, stream)
                    });
                }
                Err(ref error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        }
    });
    state.0.lock().map_err(|error| error.to_string())?.insert(
        id.clone(),
        PluginHttpServer {
            stop,
            pending,
            thread: Some(thread),
            _active_connections: active_connections,
        },
    );
    Ok(PluginHttpServerInfo {
        url: format!("http://{host}:{port}"),
        id,
    })
}

#[tauri::command]
fn plugin_http_respond(
    state: State<'_, PluginHttpServerState>,
    id: String,
    request_id: String,
    status: u16,
    headers: Option<HashMap<String, String>>,
    body: Vec<u8>,
) -> Result<(), String> {
    let reply = HttpReply {
        status,
        headers: headers.unwrap_or_default(),
        body,
    };
    let servers = state.0.lock().map_err(|error| error.to_string())?;
    let server = servers
        .get(&id)
        .ok_or_else(|| "HTTP server is not running.".to_string())?;
    let sender = server
        .pending
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&request_id)
        .ok_or_else(|| "HTTP request is no longer pending.".to_string())?;
    sender.send(reply).map_err(|error| error.to_string())
}

#[tauri::command]
fn plugin_http_server_stop(
    state: State<'_, PluginHttpServerState>,
    id: String,
) -> Result<(), String> {
    let server = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&id);
    if let Some(mut server) = server {
        server.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = server.thread.take() {
            let _ = thread.join();
        }
    }
    Ok(())
}

const PLUGIN_SECRET_SERVICE: &str = "dev.arc.ide.plugins";

fn plugin_secret_entry(plugin_id: &str, key: &str) -> Result<keyring::Entry, String> {
    if plugin_id.trim().is_empty() || key.trim().is_empty() {
        return Err("Plugin secret ID and key must not be empty.".to_string());
    }
    if plugin_id.len() > 128 || key.len() > 256 {
        return Err("Plugin secret ID or key is too long.".to_string());
    }
    let username = format!("{plugin_id}:{key}");
    keyring::Entry::new(PLUGIN_SECRET_SERVICE, &username)
        .map_err(|error| format!("OS credential store is unavailable: {error}"))
}

#[tauri::command]
fn plugin_secret_set(plugin_id: String, key: String, value: String) -> Result<(), String> {
    plugin_secret_entry(&plugin_id, &key)?
        .set_password(&value)
        .map_err(|error| format!("Could not store plugin secret: {error}"))
}

#[tauri::command]
fn plugin_secret_get(plugin_id: String, key: String) -> Result<Option<String>, String> {
    match plugin_secret_entry(&plugin_id, &key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read plugin secret: {error}")),
    }
}

#[tauri::command]
fn plugin_secret_delete(plugin_id: String, key: String) -> Result<(), String> {
    match plugin_secret_entry(&plugin_id, &key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete plugin secret: {error}")),
    }
}

#[tauri::command]
fn plugin_trash_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let source = PathBuf::from(&path);
    if !source.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let trash = cache.join("plugin-trash");
    fs::create_dir_all(&trash).map_err(|error| error.to_string())?;
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "item".to_string());
    let destination = trash.join(format!("{}-{name}", now_millis()));
    if fs::rename(&source, &destination).is_err() {
        if source.is_dir() {
            copy_directory(&source, &destination)?;
            fs::remove_dir_all(&source).map_err(|error| error.to_string())?;
        } else {
            fs::copy(&source, &destination).map_err(|error| error.to_string())?;
            fs::remove_file(&source).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let path = entry.path();
        let target = destination.join(entry.file_name());
        if path.is_dir() {
            copy_directory(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command(async)]
fn github_diff(root: String, path: Option<String>, staged: bool) -> Result<String, String> {
    let root_path = PathBuf::from(&root);
    let mut args: Vec<&str> = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    if let Some(path) = path.as_deref().filter(|path| !path.is_empty()) {
        args.push("--");
        args.push(path);
    }
    let output = git_output(&root_path, &args)?;
    if !output.status.success() {
        return Err(output_message(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[tauri::command]
fn set_native_background_blur(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            window_vibrancy::apply_acrylic(&window, None)
        } else {
            window_vibrancy::clear_acrylic(&window)
        }
        .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        if enabled {
            window_vibrancy_wayland::apply_blur(&window, None)
        } else {
            match window_vibrancy_wayland::clear_blur(&window) {
                Err(
                    window_vibrancy_wayland::Error::UnsupportedPlatform(_)
                    | window_vibrancy_wayland::Error::UnsupportedPlatformVersion(_),
                ) => Ok(()),
                result => result,
            }
        }
        .map_err(|error| error.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        if enabled {
            window_vibrancy::apply_vibrancy(
                &window,
                window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
                None,
                None,
            )
        } else {
            window_vibrancy::clear_vibrancy(&window).map(|_| ())
        }
        .map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = (window, enabled);
        Err("Native desktop blur is unsupported on this platform.".to_string())
    }
}

fn external_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "linux")]
    if let (Some(appdir), Some(library_path)) =
        (env::var_os("APPDIR"), env::var_os("LD_LIBRARY_PATH"))
    {
        let appdir = PathBuf::from(appdir);
        let host_paths = env::split_paths(&library_path).filter(|path| !path.starts_with(&appdir));
        if let Ok(host_paths) = env::join_paths(host_paths) {
            if host_paths.is_empty() {
                command.env_remove("LD_LIBRARY_PATH");
            } else {
                command.env("LD_LIBRARY_PATH", host_paths);
            }
        }
    }
    command
}

fn gh_command() -> Command {
    external_command("gh")
}

fn git_command() -> Command {
    external_command("git")
}

fn git_output(root: &Path, args: &[&str]) -> Result<Output, String> {
    git_command()
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))
}

fn output_message(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => "Command failed.".to_string(),
        (false, true) => stdout,
        (true, false) => stderr,
        (false, false) => format!("{stdout}\n{stderr}"),
    }
}

fn require_success(output: Output) -> Result<Output, String> {
    if output.status.success() {
        Ok(output)
    } else {
        Err(output_message(&output))
    }
}

fn resolve_git_root(root: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not access workspace: {error}"))?;
    let output = git_output(&root, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Err("This folder is not inside a Git repository.".to_string());
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Could not access Git repository: {error}"))
}

fn git_config_value(root: &Path, key: &str) -> String {
    git_output(root, &["config", "--get", key])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn remote_url(root: &Path, remote: &str) -> Option<String> {
    git_output(root, &["remote", "get-url", remote])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn github_web_url(remote: &str) -> Option<String> {
    let value = if let Some(path) = remote.strip_prefix("git@github.com:") {
        format!("https://github.com/{path}")
    } else if let Some(path) = remote.strip_prefix("ssh://git@github.com/") {
        format!("https://github.com/{path}")
    } else if remote.starts_with("https://github.com/") || remote.starts_with("http://github.com/")
    {
        remote.to_string()
    } else {
        return None;
    };
    Some(
        value
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .to_string(),
    )
}

fn list_remotes(root: &Path) -> Vec<String> {
    git_output(root, &["remote"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn github_remote_name(root: &Path) -> Option<String> {
    let remotes = list_remotes(root);
    remotes
        .iter()
        .find(|remote| {
            remote_url(root, remote)
                .and_then(|url| github_web_url(&url))
                .is_some()
        })
        .cloned()
        .or_else(|| {
            remotes
                .iter()
                .find(|remote| remote.as_str() == "origin")
                .cloned()
        })
        .or_else(|| remotes.first().cloned())
}

fn describe_change(path: String, index: char, worktree: char) -> GithubChange {
    let code = [index, worktree];
    let status = if code == ['?', '?'] {
        "Untracked"
    } else if code.contains(&'R') {
        "Renamed"
    } else if code.contains(&'C') {
        "Copied"
    } else if code.contains(&'D') {
        "Deleted"
    } else if code.contains(&'A') {
        "Added"
    } else if code.contains(&'U') {
        "Conflict"
    } else {
        "Modified"
    };
    GithubChange {
        path,
        status: status.to_string(),
        staged: index != ' ' && index != '?',
        unstaged: worktree != ' ',
    }
}

fn parse_changes(data: &[u8]) -> Vec<GithubChange> {
    let records = String::from_utf8_lossy(data);
    let mut entries = records.split('\0').filter(|entry| !entry.is_empty());
    let mut changes = Vec::new();
    while let Some(record) = entries.next() {
        let bytes = record.as_bytes();
        if bytes.len() < 4 {
            continue;
        }
        let index = bytes[0] as char;
        let worktree = bytes[1] as char;
        let path = String::from_utf8_lossy(&bytes[3..]).into_owned();
        changes.push(describe_change(path, index, worktree));
        if index == 'R' || index == 'C' || worktree == 'R' || worktree == 'C' {
            entries.next();
        }
    }
    changes
}

#[tauri::command(async)]
fn github_status(root: String) -> Result<GithubStatus, String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access workspace: {error}"))?;
    let git_installed = git_command()
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let gh_installed = gh_command()
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let authenticated = if gh_installed {
        gh_command()
            .args(["auth", "status"])
            .current_dir(&root)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    } else {
        false
    };
    let mut status = GithubStatus {
        platform: env::consts::OS.to_string(),
        git_installed,
        gh_installed,
        authenticated,
        is_repo: false,
        is_github_repo: false,
        branch: None,
        branches: Vec::new(),
        remote: None,
        repo_url: None,
        ahead: 0,
        behind: 0,
        changes: Vec::new(),
        user_name: String::new(),
        user_email: String::new(),
    };
    if !git_installed {
        return Ok(status);
    }
    status.user_name = git_config_value(&root, "user.name");
    status.user_email = git_config_value(&root, "user.email");
    let Ok(repo_root) = resolve_git_root(&root) else {
        return Ok(status);
    };
    status.is_repo = true;
    status.user_name = git_config_value(&repo_root, "user.name");
    status.user_email = git_config_value(&repo_root, "user.email");
    status.branch = git_output(&repo_root, &["branch", "--show-current"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|branch| !branch.is_empty());
    status.branches = git_output(&repo_root, &["branch", "--format=%(refname:short)"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|branch| !branch.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    status.changes = git_output(
        &repo_root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .ok()
    .filter(|output| output.status.success())
    .map(|output| parse_changes(&output.stdout))
    .unwrap_or_default();
    let remotes = list_remotes(&repo_root);
    status.is_github_repo = remotes.iter().any(|remote| {
        remote_url(&repo_root, remote)
            .and_then(|url| github_web_url(&url))
            .is_some()
    });
    status.remote = github_remote_name(&repo_root);
    status.repo_url = status
        .remote
        .as_ref()
        .and_then(|remote| remote_url(&repo_root, remote).and_then(|url| github_web_url(&url)));
    if let (Some(remote), Some(branch)) = (status.remote.as_ref(), status.branch.as_ref()) {
        let tracking_ref = format!("{remote}/{branch}");
        if let Ok(output) = git_output(
            &repo_root,
            &[
                "rev-list",
                "--left-right",
                "--count",
                &format!("{tracking_ref}...HEAD"),
            ],
        ) {
            if output.status.success() {
                let counts: Vec<usize> = String::from_utf8_lossy(&output.stdout)
                    .split_whitespace()
                    .filter_map(|count| count.parse().ok())
                    .collect();
                if counts.len() == 2 {
                    status.behind = counts[0];
                    status.ahead = counts[1];
                }
            }
        }
    }
    Ok(status)
}

#[tauri::command(async)]
fn github_configure_identity(name: String, email: String) -> Result<(), String> {
    let name = name.trim();
    let email = email.trim();
    if name.is_empty() || email.is_empty() {
        return Err("Enter both your Git name and email.".to_string());
    }
    require_success(
        git_command()
            .args(["config", "--global", "user.name", name])
            .output()
            .map_err(|error| format!("Could not run Git: {error}"))?,
    )?;
    require_success(
        git_command()
            .args(["config", "--global", "user.email", email])
            .output()
            .map_err(|error| format!("Could not run Git: {error}"))?,
    )?;
    Ok(())
}

#[tauri::command(async)]
fn github_stage(root: String, path: String, stage: bool) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let output = if stage {
        git_command()
            .args(["add", "--"])
            .arg(path)
            .current_dir(root)
            .output()
    } else {
        git_command()
            .args(["reset", "--"])
            .arg(path)
            .current_dir(root)
            .output()
    }
    .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command(async)]
fn github_commit(root: String, message: String, description: Option<String>) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let message = message.trim();
    if message.is_empty() {
        return Err("Enter a commit message.".to_string());
    }
    let description = description.unwrap_or_default();
    let description = description.trim();
    let mut command = git_command();
    command.args(["commit", "-m", message]);
    if !description.is_empty() {
        command.args(["-m", description]);
    }
    let output = command
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command(async)]
fn github_fetch(root: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let remote = github_remote_name(&root)
        .ok_or_else(|| "Add a GitHub remote before checking for updates.".to_string())?;
    let output = git_command()
        .args(["fetch", &remote])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command(async)]
fn github_pull(root: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let remote = github_remote_name(&root)
        .ok_or_else(|| "Add a GitHub remote before pulling.".to_string())?;
    let branch = git_output(&root, &["branch", "--show-current"])?;
    let branch = String::from_utf8_lossy(&branch.stdout).trim().to_string();
    if branch.is_empty() {
        return Err("Create or switch to a branch before pulling.".to_string());
    }
    let output = git_command()
        .args(["pull", "--rebase", &remote, &branch])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command(async)]
fn github_push(root: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let remote = github_remote_name(&root)
        .ok_or_else(|| "Add a GitHub remote before pushing.".to_string())?;
    let branch = git_output(&root, &["branch", "--show-current"])?;
    let branch = String::from_utf8_lossy(&branch.stdout).trim().to_string();
    if branch.is_empty() {
        return Err("Create or switch to a branch before pushing.".to_string());
    }
    let output = git_command()
        .args(["push", "--set-upstream", &remote, &branch])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command(async)]
fn github_switch_branch(root: String, branch: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let output = git_command()
        .args(["switch", &branch])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command(async)]
fn github_create_branch(root: String, branch: String) -> Result<(), String> {
    let root = resolve_git_root(Path::new(&root))?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("Enter a branch name.".to_string());
    }
    require_success(
        git_command()
            .args(["check-ref-format", "--branch", branch])
            .current_dir(&root)
            .output()
            .map_err(|error| format!("Could not run Git: {error}"))?,
    )?;
    let output = git_command()
        .args(["switch", "-c", branch])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    require_success(output)?;
    Ok(())
}

#[tauri::command(async)]
fn github_create_repo(root: String, name: String, visibility: String) -> Result<(), String> {
    if visibility != "public" && visibility != "private" {
        return Err("Choose public or private visibility.".to_string());
    }
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a repository name.".to_string());
    }
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access workspace: {error}"))?;
    let auth = gh_command()
        .args(["auth", "status"])
        .current_dir(&root)
        .output()
        .map_err(|error| format!("GitHub CLI is not installed: {error}"))?;
    if !auth.status.success() {
        return Err("Sign in to GitHub before creating a repository.".to_string());
    }
    let existing_root = git_output(&root, &["rev-parse", "--show-toplevel"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| PathBuf::from(String::from_utf8_lossy(&output.stdout).trim()).canonicalize())
        .transpose()
        .map_err(|error| format!("Could not access Git repository: {error}"))?;
    let repo_root = if let Some(repo_root) = existing_root {
        repo_root
    } else {
        let init = git_command()
            .args(["init", "--initial-branch=main"])
            .current_dir(&root)
            .output()
            .map_err(|error| format!("Could not run Git: {error}"))?;
        if !init.status.success() {
            let fallback = git_command()
                .arg("init")
                .current_dir(&root)
                .output()
                .map_err(|error| format!("Could not run Git: {error}"))?;
            require_success(fallback)?;
            let _ = git_output(&root, &["branch", "-M", "main"]);
        }
        root
    };
    let remotes = list_remotes(&repo_root);
    let remote = if remotes.iter().any(|remote| remote == "origin") {
        let mut candidate = "github".to_string();
        let mut suffix = 2;
        while remotes.contains(&candidate) {
            candidate = format!("github-{suffix}");
            suffix += 1;
        }
        candidate
    } else {
        "origin".to_string()
    };
    let visibility_flag = format!("--{visibility}");
    let create = gh_command()
        .args(["repo", "create", name, "--source"])
        .arg(&repo_root)
        .args(["--remote", &remote, &visibility_flag])
        .current_dir(&repo_root)
        .output()
        .map_err(|error| format!("Could not run GitHub CLI: {error}"))?;
    require_success(create)?;
    let has_commit = git_output(&repo_root, &["rev-parse", "--verify", "HEAD"])
        .map(|output| output.status.success())
        .unwrap_or(false);
    if has_commit {
        let branch = git_output(&repo_root, &["branch", "--show-current"])?;
        let branch = String::from_utf8_lossy(&branch.stdout).trim().to_string();
        if !branch.is_empty() {
            let push = git_command()
                .args(["push", "--set-upstream", &remote, &branch])
                .current_dir(&repo_root)
                .output()
                .map_err(|error| format!("Repository created, but push failed: {error}"))?;
            if !push.status.success() {
                return Err(format!(
                    "Repository created, but push failed: {}",
                    output_message(&push)
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn plugin_local_server_start(
    app: tauri::AppHandle,
    state: State<'_, LocalHttpServerState>,
    plugin_id: String,
    root: String,
    entry: String,
) -> Result<LocalServerInfo, String> {
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not access local server folder: {error}"))?;
    if !root.is_dir() {
        return Err("Local server needs a folder.".to_string());
    }
    if !app.fs_scope().is_allowed(&root) {
        return Err("Plugin local server folder is outside approved workspace access.".to_string());
    }
    if entry.contains('\\')
        || Path::new(&entry)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid local server entry path.".to_string());
    }

    let mut active = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(server) = active.get(&plugin_id).filter(|server| server.root == root) {
        return Ok(local_server_info(&server.root, server.port, &entry));
    }
    drop(active.remove(&plugin_id));

    let server = create_local_http_server(root)?;
    let info = local_server_info(&server.root, server.port, &entry);
    active.insert(plugin_id, server);
    Ok(info)
}

#[tauri::command]
fn plugin_local_server_stop(
    state: State<'_, LocalHttpServerState>,
    plugin_id: String,
) -> Result<bool, String> {
    let server = state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&plugin_id);
    let was_running = server.is_some();
    drop(server);
    Ok(was_running)
}

fn local_server_info(root: &Path, port: u16, entry: &str) -> LocalServerInfo {
    let encoded_entry = encode_url_path(entry);
    let path = if encoded_entry.is_empty() {
        "/".to_string()
    } else {
        format!("/{encoded_entry}")
    };
    LocalServerInfo {
        root: root.to_string_lossy().into_owned(),
        url: format!("http://127.0.0.1:{port}{path}"),
    }
}

fn create_local_http_server(root: PathBuf) -> Result<LocalHttpServer, String> {
    let listener = TcpListener::bind(("127.0.0.1", 5500))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|error| format!("Could not start local server: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read local server address: {error}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure local server: {error}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let generation = Arc::new(AtomicU64::new(local_file_signature(&root)));
    let server_stop = Arc::clone(&stop);
    let server_generation = Arc::clone(&generation);
    let server_root = root.clone();
    let active_connections = Arc::new(AtomicUsize::new(0));
    let server_connections = Arc::clone(&active_connections);
    let server_thread = thread::spawn(move || {
        while !server_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let Some(slot) = acquire_connection_slot(&server_connections) else {
                        respond_live_request(
                            &mut stream,
                            "503 Service Unavailable",
                            "text/plain",
                            b"Too many concurrent requests.",
                            false,
                        );
                        continue;
                    };
                    let request_root = server_root.clone();
                    let request_generation = Arc::clone(&server_generation);
                    thread::spawn(move || {
                        let _slot = slot;
                        handle_local_request(stream, &request_root, &request_generation);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(40));
                }
                Err(_) => break,
            }
        }
    });

    let watcher_thread =
        spawn_local_server_watcher(Arc::clone(&stop), Arc::clone(&generation), root.clone());

    Ok(LocalHttpServer {
        root,
        port,
        stop,
        threads: vec![server_thread, watcher_thread],
        _active_connections: active_connections,
    })
}

fn spawn_local_server_watcher(
    stop: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    root: PathBuf,
) -> JoinHandle<()> {
    let (send, receive) = channel::<notify_debouncer_full::DebounceEventResult>();
    let Ok(mut debouncer) = new_debouncer(WATCH_DEBOUNCE, None, send) else {
        return thread::spawn(move || run_local_server_poll(stop, generation, root));
    };
    let filter = build_local_server_filter(&root);
    let mut watched = HashSet::new();
    let mut failures = 0;
    let stalled = watch_directory_tree(
        &mut debouncer,
        &mut watched,
        &filter,
        &root,
        &root,
        &mut failures,
    );
    if !watched.contains(&root) || stalled || failures >= WATCH_MAX_FAILURES {
        return thread::spawn(move || run_local_server_poll(stop, generation, root));
    }
    thread::spawn(move || {
        run_local_server_watcher(stop, generation, root, debouncer, receive, filter, watched)
    })
}

fn run_local_server_watcher(
    stop: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    root: PathBuf,
    mut debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
    receive: std::sync::mpsc::Receiver<notify_debouncer_full::DebounceEventResult>,
    filter: ignore::gitignore::Gitignore,
    mut watched: HashSet<PathBuf>,
) {
    let mut failures = 0;
    while !stop.load(Ordering::Relaxed) {
        match receive.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(events)) => {
                generation.store(local_file_signature(&root), Ordering::Relaxed);
                for debounced in events {
                    let created = match &debounced.event.kind {
                        EventKind::Create(_) => debounced.event.paths.last().cloned(),
                        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                            debounced.event.paths.last().cloned()
                        }
                        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                            debounced.event.paths.get(1).cloned()
                        }
                        _ => None,
                    };
                    let Some(path) = created else { continue };
                    let Ok(is_dir) = fs::metadata(&path).map(|data| data.is_dir()) else {
                        continue;
                    };
                    if !is_dir || is_watch_ignored(&filter, &root, &path, true) {
                        continue;
                    }
                    watch_directory_tree(
                        &mut debouncer,
                        &mut watched,
                        &filter,
                        &root,
                        &path,
                        &mut failures,
                    );
                }
            }
            Ok(Err(_)) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn run_local_server_poll(stop: Arc<AtomicBool>, generation: Arc<AtomicU64>, root: PathBuf) {
    let mut previous = generation.load(Ordering::Relaxed);
    while !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(700));
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let current = local_file_signature(&root);
        if current != previous {
            generation.store(current, Ordering::Relaxed);
            previous = current;
        }
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn handle_local_request(mut stream: TcpStream, root: &Path, generation: &AtomicU64) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];
    while request.len() < 16 * 1024 && !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(length) => request.extend_from_slice(&buffer[..length]),
        }
    }
    let header_end = request
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .unwrap_or(request.len());
    let request_line = String::from_utf8_lossy(&request[..header_end]);
    let Some(mut parts) = request_line.lines().next().map(str::split_whitespace) else {
        respond_live_request(
            &mut stream,
            "400 Bad Request",
            "text/plain",
            b"Bad request",
            false,
        );
        return;
    };
    let method = parts.next().unwrap_or("");
    let Some(raw_path) = parts.next() else {
        respond_live_request(
            &mut stream,
            "400 Bad Request",
            "text/plain",
            b"Bad request",
            false,
        );
        return;
    };
    let is_head = method == "HEAD";
    if method != "GET" && !is_head {
        respond_live_request(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain",
            b"Method not allowed",
            false,
        );
        return;
    }

    let raw_path = raw_path.split(['?', '#']).next().unwrap_or("/");
    let Some(relative) = decode_url_path(raw_path) else {
        respond_live_request(
            &mut stream,
            "400 Bad Request",
            "text/plain",
            b"Invalid path",
            is_head,
        );
        return;
    };
    if relative == "__arc_live_reload" {
        let body = generation.load(Ordering::Relaxed).to_string();
        respond_live_request(
            &mut stream,
            "200 OK",
            "text/plain; charset=utf-8",
            body.as_bytes(),
            is_head,
        );
        return;
    }

    let relative_path = Path::new(&relative);
    if relative_path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        respond_live_request(
            &mut stream,
            "403 Forbidden",
            "text/plain",
            b"Forbidden",
            is_head,
        );
        return;
    }
    let requested = root.join(relative_path);
    let Ok(mut path) = requested.canonicalize() else {
        respond_live_request(
            &mut stream,
            "404 Not Found",
            "text/plain",
            b"Not found",
            is_head,
        );
        return;
    };
    if !path.starts_with(root) {
        respond_live_request(
            &mut stream,
            "403 Forbidden",
            "text/plain",
            b"Forbidden",
            is_head,
        );
        return;
    }

    if path.is_dir() {
        if let Some(index) = ["index.html", "index.htm"]
            .iter()
            .map(|name| path.join(name))
            .find(|candidate| candidate.is_file())
        {
            path = match index.canonicalize() {
                Ok(index) if index.starts_with(root) => index,
                _ => {
                    respond_live_request(
                        &mut stream,
                        "403 Forbidden",
                        "text/plain",
                        b"Forbidden",
                        is_head,
                    );
                    return;
                }
            };
        } else {
            let body = directory_listing(root, &path);
            respond_live_request(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                body.as_bytes(),
                is_head,
            );
            return;
        }
    }

    let content_type = mime_type(&path);
    if content_type == "text/html; charset=utf-8" {
        let Ok(body) = fs::read(&path) else {
            respond_live_request(
                &mut stream,
                "404 Not Found",
                "text/plain",
                b"Not found",
                is_head,
            );
            return;
        };
        respond_live_request(
            &mut stream,
            "200 OK",
            content_type,
            &inject_live_reload(body),
            is_head,
        );
        return;
    }
    let Ok(mut file) = fs::File::open(&path) else {
        respond_live_request(
            &mut stream,
            "404 Not Found",
            "text/plain",
            b"Not found",
            is_head,
        );
        return;
    };
    let length = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    if write_live_response_header(&mut stream, "200 OK", content_type, length) && !is_head {
        let _ = std::io::copy(&mut file, &mut stream);
    }
}

fn write_live_response_header(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    content_length: u64,
) -> bool {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {content_length}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(header.as_bytes()).is_ok()
}

fn respond_live_request(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    is_head: bool,
) {
    if write_live_response_header(stream, status, content_type, body.len() as u64) && !is_head {
        let _ = stream.write_all(body);
    }
}

fn decode_url_path(path: &str) -> Option<String> {
    let mut decoded = Vec::with_capacity(path.len());
    let bytes = path.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push((hex_value(high)? << 4) | hex_value(low)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let decoded = String::from_utf8(decoded).ok()?;
    Some(decoded.trim_start_matches('/').to_string())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn encode_url_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "txt" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn inject_live_reload(body: Vec<u8>) -> Vec<u8> {
    let mut html = String::from_utf8_lossy(&body).into_owned();
    let script = "<script>(()=>{let last='';const poll=async()=>{try{const response=await fetch('/__arc_live_reload',{cache:'no-store'});const next=await response.text();if(last&&next!==last)location.reload();last=next}catch{}setTimeout(poll,1000)};poll()})()</script>";
    if let Some(position) = html.rfind("</body>") {
        html.insert_str(position, script);
    } else {
        html.push_str(script);
    }
    html.into_bytes()
}

fn directory_listing(root: &Path, directory: &Path) -> String {
    let mut entries = fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if file_type.is_symlink() {
                return None;
            }
            Some((
                entry.file_name().to_string_lossy().into_owned(),
                file_type.is_dir(),
            ))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.0.to_lowercase().cmp(&right.0.to_lowercase()));
    let relative = directory.strip_prefix(root).unwrap_or(Path::new(""));
    let parent = if relative.as_os_str().is_empty() {
        String::new()
    } else {
        "<li><a href='../'>..</a></li>".to_string()
    };
    let rows = entries
        .into_iter()
        .map(|(name, is_directory)| {
            let suffix = if is_directory { "/" } else { "" };
            let relative_url = relative.to_string_lossy().replace('\\', "/");
            let prefix = if relative_url.is_empty() {
                String::new()
            } else {
                format!("{}/", encode_url_path(&relative_url))
            };
            let href = format!("/{prefix}{}{suffix}", encode_url_path(&name));
            format!(
                "<li><a href=\"{href}\">{}{suffix}</a></li>",
                html_escape(&name)
            )
        })
        .collect::<String>();
    let title = if relative.is_empty() {
        "/"
    } else {
        relative.to_str().unwrap_or("/")
    };
    format!("<!doctype html><meta charset='utf-8'><title>Index of {}</title><h1>Index of {}</h1><ul>{parent}{rows}</ul>", html_escape(title), html_escape(title))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

const LOCAL_SERVER_IGNORED_NAMES: &[&str] = &["node_modules", ".git", "target", ".next", ".cache"];

fn build_local_server_filter(root: &Path) -> ignore::gitignore::Gitignore {
    let mut builder = ignore::gitignore::GitignoreBuilder::new(root);
    for name in LOCAL_SERVER_IGNORED_NAMES {
        let _ = builder.add_line(None, name);
    }
    builder.build().unwrap_or_else(|_| {
        ignore::gitignore::GitignoreBuilder::new(Path::new(""))
            .build()
            .expect("empty gitignore builder cannot fail")
    })
}

fn local_file_signature(root: &Path) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut pending = vec![root.to_path_buf()];
    let mut count = 0;
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            if file_type.is_dir() {
                if name
                    .to_str()
                    .map(|name| LOCAL_SERVER_IGNORED_NAMES.contains(&name))
                    .unwrap_or(false)
                {
                    continue;
                }
                pending.push(path.clone());
            }
            path.strip_prefix(root)
                .unwrap_or(&path)
                .as_os_str()
                .hash(&mut hasher);
            if let Ok(metadata) = entry.metadata() {
                metadata.len().hash(&mut hasher);
                metadata
                    .modified()
                    .unwrap_or(SystemTime::UNIX_EPOCH)
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
                    .hash(&mut hasher);
            }
            count += 1;
            if count >= 20_000 {
                return hasher.finish();
            }
        }
    }
    hasher.finish()
}

// ---------- Workspace file watcher ----------

const WATCH_IGNORED_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".cache",
];
/// Upper bound on directories we register with inotify so a large
/// dependency tree can not exhaust `fs.inotify.max_user_watches`.
const WATCH_MAX_DIRS: usize = 3000;
/// Upper bound on entries reported by the catch-up listing for a freshly
/// created directory (bytes for a wholly new subtree).
const WATCH_MAX_ENTRIES: usize = 5000;
/// Once this many `watch()` calls failed (watch-limit reached), stop trying
/// to register more directories and report the error once.
const WATCH_MAX_FAILURES: usize = 32;
/// Debounce window before events are forwarded to the frontend.
const WATCH_DEBOUNCE: Duration = Duration::from_millis(200);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEvent {
    root: String,
    kind: String,
    paths: Vec<String>,
    is_dir: Option<bool>,
}

#[derive(Default)]
struct WatcherInner {
    watcher: Option<Debouncer<RecommendedWatcher, RecommendedCache>>,
    root: Option<PathBuf>,
    watched: HashSet<PathBuf>,
    failures: usize,
    reported_limit: bool,
    filter: Option<ignore::gitignore::Gitignore>,
}

#[derive(Default)]
struct WatcherState {
    inner: Arc<Mutex<WatcherInner>>,
}

fn build_watch_filter(root: &Path) -> ignore::gitignore::Gitignore {
    let mut builder = ignore::gitignore::GitignoreBuilder::new(root);
    for name in WATCH_IGNORED_NAMES {
        let _ = builder.add_line(None, name);
    }
    if let Ok(body) = fs::read_to_string(root.join(".arcwatchignore")) {
        for raw in body.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let _ = builder.add_line(None, line);
        }
    }
    builder.build().unwrap_or_else(|_| {
        ignore::gitignore::GitignoreBuilder::new(Path::new(""))
            .build()
            .expect("empty gitignore builder cannot fail")
    })
}

/// True when a path should produce no tree-sync events because it sits in a
/// tooling directory or matches a user's `.arcwatchignore` pattern.
fn is_watch_ignored(
    filter: &ignore::gitignore::Gitignore,
    root: &Path,
    path: &Path,
    is_dir: bool,
) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return true;
    };
    let mut stack = PathBuf::new();
    let depth = relative.components().count();
    for (index, component) in relative.components().enumerate() {
        let Component::Normal(name) = component else {
            return true;
        };
        if WATCH_IGNORED_NAMES.contains(&name.to_string_lossy().as_ref()) {
            return true;
        }
        let Some(name) = name.to_str() else {
            return true;
        };
        stack.push(name);
        let component_is_dir = index + 1 < depth || is_dir && index + 1 == depth;
        if filter.matched(&stack, component_is_dir).is_ignore() {
            return true;
        }
    }
    false
}

fn map_fs_event(
    filter: &ignore::gitignore::Gitignore,
    root: &Path,
    event: &Event,
) -> Option<FsEvent> {
    if event.paths.is_empty() {
        return None;
    }
    let accepted = |path: &Path, is_dir: Option<bool>| -> bool {
        if !path.starts_with(root) {
            return false;
        }
        !is_watch_ignored(filter, root, path, is_dir.unwrap_or(false))
    };
    let root_string = root.to_string_lossy().replace('\\', "/");
    let absolute_paths = |paths: &[PathBuf]| -> Vec<String> {
        paths
            .iter()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .collect()
    };
    let (kind, is_dir) = match &event.kind {
        EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            let path = event.paths.last().unwrap();
            let is_dir = fs::metadata(path).map(|data| data.is_dir()).ok();
            if !accepted(path, is_dir) {
                return None;
            }
            ("created", is_dir)
        }
        EventKind::Remove(_) => {
            let path = event.paths.last().unwrap();
            if !path.starts_with(root) || is_watch_ignored(filter, root, path, true) {
                return None;
            }
            ("removed", None)
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() >= 2 => {
            let to = &event.paths[1];
            let is_dir = fs::metadata(to).map(|data| data.is_dir()).ok();
            if accepted(to, is_dir) {
                ("renamed", is_dir)
            } else if accepted(&event.paths[0], None) {
                // filename renamed out of the workspace from the tree's view
                ("removed", None)
            } else {
                return None;
            }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            let path = &event.paths[0];
            if !accepted(path, None) {
                return None;
            }
            ("removed", None)
        }
        EventKind::Modify(_) => {
            let path = event.paths.last().unwrap();
            if !accepted(path, None) {
                return None;
            }
            ("modified", None)
        }
        _ => return None,
    };
    let paths_out = if kind == "removed" {
        let last = event.paths.last().unwrap();
        absolute_paths(std::slice::from_ref(last))
    } else {
        absolute_paths(&event.paths)
    };
    Some(FsEvent {
        root: root_string,
        kind: kind.to_string(),
        paths: paths_out,
        is_dir,
    })
}

/// Point the watcher at `dir` and every non-ignored subdirectory below it.
/// Per-directory registration instead of one recursive watch keeps
/// `node_modules`-style churn from exhausting inotify watches.
fn watch_directory_tree(
    debouncer: &mut Debouncer<RecommendedWatcher, RecommendedCache>,
    watched: &mut HashSet<PathBuf>,
    filter: &ignore::gitignore::Gitignore,
    root: &Path,
    dir: &Path,
    failures: &mut usize,
) -> bool {
    let mut stack = vec![dir.to_path_buf()];
    let mut stalled = false;
    while let Some(current) = stack.pop() {
        if watched.len() >= WATCH_MAX_DIRS || *failures >= WATCH_MAX_FAILURES {
            stalled = true;
            break;
        }
        if !watched.insert(current.clone()) {
            continue; // already registered
        }
        if let Err(_error) = debouncer.watch(
            &current,
            notify_debouncer_full::notify::RecursiveMode::NonRecursive,
        ) {
            *failures += 1;
            watched.remove(&current);
            stalled = true;
            continue;
        }
        let Ok(entries) = fs::read_dir(&current) else {
            continue; // vanished before the watch could apply
        };
        for entry in entries.flatten() {
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let child = entry.path();
            if is_watch_ignored(filter, root, &child, true) {
                continue;
            }
            stack.push(child);
        }
    }
    stalled
}

/// List `dir` and everything below it (skipping tooling directories and
/// `.arcwatchignore` matches) as one synthetic `created` event per entry.
/// This closes the races between a fresh folder tree and the watcher tree
/// registration.
fn list_catch_up_events(
    filter: &ignore::gitignore::Gitignore,
    root: &Path,
    dir: &Path,
) -> Vec<FsEvent> {
    let root_string = root.to_string_lossy().replace('\\', "/");
    let mut out = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(current) = pending.pop() {
        if out.len() >= WATCH_MAX_ENTRIES {
            break;
        }
        let Ok(entries) = fs::read_dir(&current) else {
            continue; // vanished between the event and the registration
        };
        for entry in entries.flatten() {
            if out.len() >= WATCH_MAX_ENTRIES {
                break;
            }
            let path = entry.path();
            let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            if is_watch_ignored(filter, root, &path, is_dir) {
                continue;
            }
            if relative_watch_path(root, &path).is_empty() {
                continue;
            }
            out.push(FsEvent {
                root: root_string.clone(),
                kind: "created".to_string(),
                paths: vec![path.to_string_lossy().replace('\\', "/")],
                is_dir: Some(is_dir),
            });
            if is_dir {
                pending.push(path);
            }
        }
    }
    out
}

fn relative_watch_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|rest| rest.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

#[tauri::command]
fn watch_project(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    root: String,
) -> Result<String, String> {
    let root_path =
        fs::canonicalize(&root).map_err(|error| format!("Could not watch {root}: {error}"))?;
    let filter = build_watch_filter(&root_path);
    let (send, receive) = channel::<notify_debouncer_full::DebounceEventResult>();
    let mut debouncer = new_debouncer(WATCH_DEBOUNCE, None, send)
        .map_err(|error| format!("Could not start file watcher: {error}"))?;

    let mut watched = HashSet::new();
    let mut failures = 0_usize;

    {
        let mut inner = state.inner.lock().map_err(|_error| "watcher poisoned")?;
        inner.watcher = None;
        inner.root = None;
        inner.watched.clear();
        inner.failures = 0;
        watch_directory_tree(
            &mut debouncer,
            &mut watched,
            &filter,
            &root_path,
            &root_path,
            &mut failures,
        );
        if !watched.contains(&root_path) {
            return Err(format!(
                "Could not watch {root}: watcher registration failed"
            ));
        }
        inner.watcher = Some(debouncer);
        inner.root = Some(root_path.clone());
        inner.watched = watched;
        inner.failures = failures;
        inner.filter = Some(filter);
        inner.reported_limit = false;
    }
    if failures >= WATCH_MAX_FAILURES {
        let _ = app.emit(
            "fs-watcher-error",
            "Live file updates stopped: too many files (watch limit reached). Changes will appear after refresh.",
        );
    }

    let app_handle = app.clone();
    let inner_state = state.inner.clone();
    let thread_root = root_path.clone();
    thread::spawn(move || {
        let mut last_reported = Instant::now() - Duration::from_secs(30);
        for result in receive {
            match result {
                Ok(events) => {
                    let filter = {
                        let inner = match inner_state.lock() {
                            Ok(inner) => inner,
                            Err(_) => return,
                        };
                        if inner.root.as_deref() != Some(thread_root.as_path()) {
                            return;
                        }
                        match inner.filter.as_ref() {
                            Some(filter) => filter.clone(),
                            None => return,
                        }
                    };
                    let mut removed: Vec<PathBuf> = Vec::new();
                    let mut created_dirs: Vec<PathBuf> = Vec::new();
                    let mut mapped: Vec<FsEvent> = Vec::new();
                    for debounced in events {
                        if let Some(event) = map_fs_event(&filter, &thread_root, &debounced.event) {
                            match event.kind.as_str() {
                                "created" | "renamed" => {
                                    created_dirs.push(PathBuf::from(
                                        event.paths.last().cloned().unwrap_or_default(),
                                    ));
                                }
                                "removed" => removed.push(PathBuf::from(
                                    event.paths.last().cloned().unwrap_or_default(),
                                )),
                                _ => {}
                            }
                            if event.kind == "renamed" && event.paths.len() > 1 {
                                removed.push(PathBuf::from(event.paths[0].clone()));
                            }
                            mapped.push(event);
                        }
                    }
                    if !mapped.is_empty() {
                        app_handle.emit("fs-changed", mapped).ok();
                    }
                    if !removed.is_empty() || !created_dirs.is_empty() {
                        let mut guard = match inner_state.lock() {
                            Ok(inner) => inner,
                            Err(_) => return,
                        };
                        let inner: &mut WatcherInner = &mut guard;
                        for path in removed {
                            inner.watched.retain(|watched| {
                                !(watched == &path || watched.starts_with(&path))
                            });
                        }
                        for path in created_dirs {
                            let Ok(is_dir) = fs::metadata(&path).map(|data| data.is_dir()) else {
                                continue;
                            };
                            if !is_dir {
                                continue;
                            }
                            let mut debouncer = match inner.watcher.take() {
                                Some(debouncer) => debouncer,
                                None => continue,
                            };
                            let stalled = watch_directory_tree(
                                &mut debouncer,
                                &mut inner.watched,
                                &filter,
                                &thread_root,
                                &path,
                                &mut inner.failures,
                            );
                            if inner.root.as_deref() != Some(thread_root.as_path()) {
                                // A workspace switch replaced the watcher while we
                                // were walking; keep the new one intact.
                                continue;
                            }
                            inner.watcher = Some(debouncer);
                            if inner.failures == WATCH_MAX_FAILURES && !inner.reported_limit {
                                inner.reported_limit = true;
                                let _ = app_handle.emit(
                                    "fs-watcher-error",
                                    "Live file updates stopped: too many files (watch limit reached). Changes will appear after refresh.",
                                );
                            }
                            if !stalled {
                                let catch_up = list_catch_up_events(&filter, &thread_root, &path);
                                if !catch_up.is_empty() {
                                    app_handle.emit("fs-changed", catch_up).ok();
                                }
                            }
                        }
                    }
                }
                Err(errors) => {
                    if last_reported.elapsed() > Duration::from_secs(5) {
                        last_reported = Instant::now();
                        let message = errors
                            .iter()
                            .map(|error| error.to_string())
                            .next()
                            .unwrap_or_else(|| "watcher error".to_string());
                        app_handle
                            .emit(
                                "fs-watcher-error",
                                format!("Live file updates limited: {message}"),
                            )
                            .ok();
                    }
                }
            }
        }
    });

    Ok(root_path.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn unwatch_project(state: State<'_, WatcherState>, root: String) -> Result<(), String> {
    let Ok(root_path) = fs::canonicalize(&root) else {
        return Ok(()); // root gone; dropping the watcher below is enough
    };
    let mut inner = state.inner.lock().map_err(|_error| "watcher poisoned")?;
    if inner.root.as_deref() == Some(root_path.as_path()) {
        inner.watcher = None;
        inner.root = None;
        inner.watched.clear();
        inner.failures = 0;
        inner.reported_limit = false;
        inner.filter = None;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .manage(LocalHttpServerState::default())
        .manage(PluginProcessState::default())
        .manage(PluginSocketState::default())
        .manage(PluginHttpServerState::default())
        .manage(WatcherState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            workspace_pick,
            workspace_access_allowed,
            workspace_grant_access,
            workspace_allow_hidden_paths,
            watch_project,
            unwatch_project,
            plugin_process_is_running,
            plugin_process_spawn,
            plugin_process_write,
            plugin_process_close_stdin,
            plugin_process_stop,
            plugin_process_exec,
            plugin_process_which,
            plugin_socket_connect,
            plugin_socket_write,
            plugin_socket_close,
            plugin_http_server_start,
            plugin_http_respond,
            plugin_http_server_stop,
            plugin_secret_set,
            plugin_secret_get,
            plugin_secret_delete,
            plugin_trash_path,
            github_diff,
            set_native_background_blur,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_close,
            github_status,
            github_configure_identity,
            github_stage,
            github_commit,
            github_fetch,
            github_pull,
            github_push,
            github_switch_branch,
            github_create_branch,
            github_create_repo,
            plugin_local_server_start,
            plugin_local_server_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arc");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(port: u16, path: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn bounds_concurrent_server_connections() {
        let active = Arc::new(AtomicUsize::new(0));
        let slots: Vec<_> = (0..MAX_SERVER_CONNECTIONS)
            .map(|_| acquire_connection_slot(&active).expect("slot available"))
            .collect();
        assert!(acquire_connection_slot(&active).is_none());
        drop(slots);
        assert!(acquire_connection_slot(&active).is_some());
    }

    #[test]
    fn parses_git_status_and_github_remote_urls() {
        let changes = parse_changes(b" M work.txt\0A  staged.txt\0?? new.txt\0");
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].path, "work.txt");
        assert!(changes[0].unstaged);
        assert!(!changes[0].staged);
        assert_eq!(changes[1].status, "Added");
        assert!(changes[1].staged);
        assert_eq!(changes[2].status, "Untracked");

        assert_eq!(
            github_web_url("git@github.com:owner/project.git").as_deref(),
            Some("https://github.com/owner/project")
        );
        assert_eq!(
            github_web_url("https://github.com/owner/project.git").as_deref(),
            Some("https://github.com/owner/project")
        );
        assert_eq!(github_web_url("https://gitlab.com/owner/project"), None);
    }

    #[test]
    fn local_server_serves_files_blocks_traversal_and_reloads() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("arc-local-server-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("index.html"), "<!doctype html><body>hello</body>").unwrap();
        let server = create_local_http_server(root.clone()).unwrap();

        let page = request(server.port, "/");
        assert!(page.starts_with("HTTP/1.1 200 OK"));
        assert!(page.contains("hello"));
        assert!(page.contains("__arc_live_reload"));
        assert!(request(server.port, "/..%2Fsecret").starts_with("HTTP/1.1 403 Forbidden"));

        let before = request(server.port, "/__arc_live_reload")
            .split("\r\n\r\n")
            .nth(1)
            .unwrap()
            .to_string();
        fs::write(root.join("style.css"), "body { color: red; }").unwrap();
        let css = request(server.port, "/style.css");
        assert!(css.starts_with("HTTP/1.1 200 OK"));
        assert!(css.ends_with("body { color: red; }"));
        thread::sleep(Duration::from_millis(900));
        let after = request(server.port, "/__arc_live_reload")
            .split("\r\n\r\n")
            .nth(1)
            .unwrap()
            .to_string();
        assert_ne!(before, after);

        drop(server);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn local_server_encodes_file_urls() {
        assert_eq!(
            encode_url_path("folder/a file.html"),
            "folder/a%20file.html"
        );
        assert_eq!(
            decode_url_path("/folder/a%20file.html").as_deref(),
            Some("folder/a file.html")
        );
    }

    #[test]
    fn watcher_maps_events_and_filters_ignore_paths() {
        use notify_debouncer_full::notify as notify_crate;
        use notify_debouncer_full::notify::event::{CreateKind, DataChange, RemoveKind};

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("arc-watch-root-{unique}"));
        fs::create_dir_all(root.join("node_modules/pkgs")).unwrap();
        fs::write(root.join("nested.txt"), "x").unwrap();
        fs::write(root.join(".arcwatchignore"), "private/").unwrap();
        let filter = build_watch_filter(&root);

        let event = |kind: notify_crate::EventKind, paths: Vec<PathBuf>| {
            let mut event = notify_crate::Event::new(kind);
            event.paths = paths;
            event
        };

        let created = map_fs_event(
            &filter,
            &root,
            &event(
                notify_crate::EventKind::Create(CreateKind::File),
                vec![root.join("nested.txt")],
            ),
        )
        .unwrap();
        assert_eq!(
            (created.kind.as_str(), created.is_dir),
            ("created", Some(false))
        );
        assert_eq!(created.root, root.to_string_lossy().replace('\\', "/"));

        assert!(map_fs_event(
            &filter,
            &root,
            &event(
                notify_crate::EventKind::Create(CreateKind::File),
                vec![root.join("node_modules").join("pkg.js")],
            ),
        )
        .is_none());

        assert!(map_fs_event(
            &filter,
            &root,
            &event(
                notify_crate::EventKind::Create(CreateKind::Folder),
                vec![root.join("private").join("x")],
            ),
        )
        .is_none());

        assert!(
            map_fs_event(
                &filter,
                &root,
                &event(
                    notify_crate::EventKind::Remove(RemoveKind::File),
                    vec![root.join("nested.txt")],
                ),
            )
            .is_none()
                == false // removed events must pass; metadata is gone anyway
        );

        assert!(map_fs_event(
            &filter,
            &root,
            &event(
                notify_crate::EventKind::Create(CreateKind::File),
                vec!["/etc/passwd".into()],
            ),
        )
        .is_none());

        let renamed = map_fs_event(
            &filter,
            &root,
            &event(
                notify_debouncer_full::notify::event::EventKind::Modify(
                    notify_debouncer_full::notify::event::ModifyKind::Name(
                        notify_debouncer_full::notify::event::RenameMode::Both,
                    ),
                ),
                vec![root.join("a.txt"), root.join("b.txt")],
            ),
        )
        .unwrap();
        assert_eq!(renamed.kind, "renamed");
        assert_eq!(renamed.paths.len(), 2);

        assert_eq!(
            relative_watch_path(&root, &root.join("kid").join("deep",)),
            "kid/deep"
        );
        assert_eq!(relative_watch_path(&root, &Path::new("/etc")), "");

        drop(fs::remove_dir_all(root));
    }
}
