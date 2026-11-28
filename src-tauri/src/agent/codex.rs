use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use super::ids::iso_now;
use super::provider_process::strip_foreign_credentials;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct CodexClient {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, Sender<Value>>>>,
    next_id: Arc<AtomicU64>,
}

pub struct SpawnedCodex {
    pub client: CodexClient,
    pub child: Child,
    pub stdout: ChildStdout,
    pub version: String,
    pub binary: String,
    pub pid: u32,
    pub managed_id: Option<u64>,
    pub started_at: String,
}

pub fn spawn(
    binary: &std::path::Path,
    processes: &crate::process::ProcessManager,
) -> Result<SpawnedCodex, String> {
    let version = super::provider_process::read_version(binary)?;
    let mut command = crate::external_command(&binary.to_string_lossy());
    command
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    strip_foreign_credentials(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Codex: {error}"))?;
    let pid = child.id();
    let managed_id = processes.register("agent:codex", pid);
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open Codex stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not read Codex output.".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut sink = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut sink);
        });
    }
    Ok(SpawnedCodex {
        client: CodexClient {
            stdin: Arc::new(Mutex::new(stdin)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
        },
        child,
        stdout,
        version,
        binary: binary.to_string_lossy().into_owned(),
        pid,
        managed_id,
        started_at: iso_now(),
    })
}

impl CodexClient {
    pub fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = channel();
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id, sender);
        self.write(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;
        match receiver.recv_timeout(REQUEST_TIMEOUT) {
            Ok(response) => {
                if let Some(error) = response.get("error") {
                    Err(format!("Codex {method} failed: {error}"))
                } else {
                    Ok(response.get("result").cloned().unwrap_or(Value::Null))
                }
            }
            Err(_) => {
                self.pending
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .remove(&id);
                Err(format!("Codex {method} timed out."))
            }
        }
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    pub fn reply(&self, request_id: &Value, result: Value) -> Result<(), String> {
        self.write(json!({ "jsonrpc": "2.0", "id": request_id, "result": result }))
    }

    fn write(&self, value: Value) -> Result<(), String> {
        let line = serde_json::to_string(&value)
            .map_err(|error| format!("Could not encode Codex message: {error}"))?;
        let mut stdin = self
            .stdin
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Could not write to Codex: {error}"))
    }

    pub fn dispatch_response(&self, value: &Value) -> bool {
        let Some(id) = value.get("id").and_then(Value::as_u64) else {
            return false;
        };
        let sender = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&id);
        if let Some(sender) = sender {
            let _ = sender.send(value.clone());
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_jsonrpc_lines() {
        let value = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}});
        let line = serde_json::to_string(&value).unwrap();
        assert!(line.contains("\"method\":\"initialize\""));
        assert!(!line.contains('\n'));
    }
}
