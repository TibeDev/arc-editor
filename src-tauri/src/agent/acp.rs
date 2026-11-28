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

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone)]
pub struct AcpClient {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    next_id: Arc<AtomicU64>,
}

pub struct SpawnedAcp {
    pub client: AcpClient,
    pub child: Child,
    pub stdout: ChildStdout,
    pub version: String,
    pub managed_id: Option<u64>,
    pub started_at: String,
}

pub fn spawn(
    binary: &std::path::Path,
    args: &[String],
    env: &[(String, String)],
    processes: &crate::process::ProcessManager,
) -> Result<SpawnedAcp, String> {
    let version =
        super::provider_process::read_version(binary).unwrap_or_else(|_| "ACP".to_string());
    let mut command = crate::external_command(&binary.to_string_lossy());
    command
        .args(args)
        .envs(env.iter().cloned())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    strip_foreign_credentials(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the ACP provider: {error}"))?;
    let managed_id = processes.register("agent:acp", child.id());
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open the ACP provider stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not read the ACP provider output.".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut sink = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut sink);
        });
    }
    Ok(SpawnedAcp {
        client: AcpClient {
            stdin: Arc::new(Mutex::new(stdin)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
        },
        child,
        stdout,
        version,
        managed_id,
        started_at: iso_now(),
    })
}

impl AcpClient {
    pub fn initialize(&self) -> Result<Value, String> {
        self.request_with_timeout(
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": { "readTextFile": false, "writeTextFile": false },
                    "terminal": false,
                    "auth": { "terminal": false }
                },
                "clientInfo": { "name": "Arc", "version": env!("CARGO_PKG_VERSION") }
            }),
            INITIALIZE_TIMEOUT,
        )
    }

    pub fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_with_timeout(method, params, REQUEST_TIMEOUT)
    }

    pub fn request_wait(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let (sender, receiver) = channel();
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id.clone(), sender);
        self.write(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;
        match receiver.recv() {
            Ok(response) => response_result(method, response),
            Err(_) => Err(format!("ACP {method} connection closed.")),
        }
    }

    fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let (sender, receiver) = channel();
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id.clone(), sender);
        self.write(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;
        match receiver.recv_timeout(timeout) {
            Ok(response) => response_result(method, response),
            Err(_) => {
                self.pending
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .remove(&id);
                Err(format!("ACP {method} timed out."))
            }
        }
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    pub fn reply(&self, request_id: &Value, result: Value) -> Result<(), String> {
        self.write(json!({ "jsonrpc": "2.0", "id": request_id, "result": result }))
    }

    pub fn reply_error(&self, request_id: &Value, code: i64, message: &str) -> Result<(), String> {
        self.write(json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": { "code": code, "message": message }
        }))
    }

    fn write(&self, value: Value) -> Result<(), String> {
        let line = serde_json::to_string(&value)
            .map_err(|error| format!("Could not encode ACP message: {error}"))?;
        let mut stdin = self
            .stdin
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Could not write to the ACP provider: {error}"))
    }

    pub fn dispatch_response(&self, value: &Value) -> bool {
        let Some(id) = value.get("id") else {
            return false;
        };
        let key = match id {
            Value::String(text) => text.clone(),
            Value::Number(number) => number.to_string(),
            _ => return false,
        };
        let sender = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&key);
        if let Some(sender) = sender {
            let _ = sender.send(value.clone());
            true
        } else {
            false
        }
    }

    pub fn fail_pending(&self) {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for sender in pending.values() {
            let _ = sender.send(json!({
                "error": { "code": -32000, "message": "ACP provider disconnected." }
            }));
        }
    }
}

fn response_result(method: &str, response: Value) -> Result<Value, String> {
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        Err(format!("ACP {method} failed: {message}"))
    } else {
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_response_shape() {
        let value = json!({
            "outcome": { "outcome": "selected", "optionId": "allow_once" }
        });
        assert_eq!(value["outcome"]["optionId"], "allow_once");
    }
}
