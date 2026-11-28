use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use super::ids::{base64, percent_encode_path};
use super::permissions::supervised_ruleset;
use super::types::{AgentModel, AgentModelRef, AgentOption, ProviderCommand, ProviderSkill};

#[derive(Clone)]
pub enum StreamMessage {
    Event(Value),
    Disconnected,
}

fn auth_header(password: &str) -> String {
    format!(
        "Basic {}",
        base64(format!("opencode:{password}").as_bytes())
    )
}

fn url(port: u16, path: &str, directory: Option<&str>) -> String {
    match directory {
        Some(directory) if !directory.is_empty() => format!(
            "http://127.0.0.1:{port}{path}{}directory={}",
            if path.contains('?') { '&' } else { '?' },
            percent_encode_path(directory)
        ),
        _ => format!("http://127.0.0.1:{port}{path}"),
    }
}

pub fn request(
    port: u16,
    password: &str,
    method: &str,
    path: &str,
    directory: Option<&str>,
    body: Option<Value>,
) -> Result<Value, String> {
    let target = url(port, path, directory);
    let auth = auth_header(password);
    let body = serde_json::to_string(&body.unwrap_or(Value::Null))
        .map_err(|error| format!("Could not encode request for {path}: {error}"))?;
    let response = match method {
        "GET" => ureq::get(&target).set("Authorization", &auth).call(),
        "DELETE" => ureq::delete(&target).set("Authorization", &auth).call(),
        "PATCH" => ureq::patch(&target)
            .set("Authorization", &auth)
            .set("Content-Type", "application/json")
            .send_string(&body),
        _ => ureq::post(&target)
            .set("Authorization", &auth)
            .set("Content-Type", "application/json")
            .send_string(&body),
    };
    match response {
        Ok(response) => {
            let text = response.into_string().unwrap_or_default();
            if text.trim().is_empty() {
                Ok(Value::Null)
            } else {
                serde_json::from_str(&text)
                    .map_err(|error| format!("OpenCode returned invalid JSON for {path}: {error}"))
            }
        }
        Err(ureq::Error::Status(code, response)) => {
            let text = response.into_string().unwrap_or_default();
            Err(format!(
                "OpenCode {path} failed ({code}): {}",
                truncate(&text, 400)
            ))
        }
        Err(error) => Err(format!("OpenCode {path} failed: {error}")),
    }
}

fn truncate(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        value.to_string()
    } else {
        format!("{}…", &value[..limit])
    }
}

pub fn health(port: u16, password: &str) -> Result<(), String> {
    request(port, password, "GET", "/global/health", None, None).map(|_| ())
}

pub fn create_session(
    port: u16,
    password: &str,
    directory: &str,
    title: &str,
    model: Option<&AgentModelRef>,
) -> Result<String, String> {
    let mut body = json!({
        "title": title,
        "permission": supervised_ruleset(),
    });
    if let Some(model) = model {
        body["model"] = json!({
            "providerID": model.provider_id,
            "id": model.model_id,
        });
    }
    let response = request(
        port,
        password,
        "POST",
        "/session",
        Some(directory),
        Some(body),
    )?;
    response
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| {
            response
                .get("info")
                .and_then(|info| info.get("id"))
                .and_then(Value::as_str)
        })
        .map(str::to_string)
        .ok_or_else(|| "OpenCode did not return a session id.".to_string())
}

pub fn send_prompt(
    port: u16,
    password: &str,
    directory: &str,
    session_id: &str,
    text: &str,
    model: Option<&AgentModelRef>,
) -> Result<Option<String>, String> {
    let mut body = json!({
        "parts": [{ "type": "text", "text": text }],
    });
    if let Some(model) = model {
        body["model"] = json!({
            "providerID": model.provider_id,
            "modelID": model.model_id,
        });
    }
    let response = request(
        port,
        password,
        "POST",
        &format!("/session/{session_id}/prompt_async"),
        Some(directory),
        Some(body),
    )?;
    Ok(message_id_from(&response))
}

fn message_id_from(response: &Value) -> Option<String> {
    response
        .get("info")
        .and_then(|info| info.get("id"))
        .and_then(Value::as_str)
        .or_else(|| response.get("messageID").and_then(Value::as_str))
        .or_else(|| response.get("id").and_then(Value::as_str))
        .map(str::to_string)
}

pub fn abort(port: u16, password: &str, directory: &str, session_id: &str) -> Result<(), String> {
    request(
        port,
        password,
        "POST",
        &format!("/session/{session_id}/abort"),
        Some(directory),
        Some(json!({})),
    )
    .map(|_| ())
}

pub fn delete_session(
    port: u16,
    password: &str,
    directory: &str,
    session_id: &str,
) -> Result<(), String> {
    request(
        port,
        password,
        "DELETE",
        &format!("/session/{session_id}"),
        Some(directory),
        None,
    )
    .map(|_| ())
}

pub fn reply_permission(
    port: u16,
    password: &str,
    directory: &str,
    session_id: &str,
    request_id: &str,
    decision: &str,
    feedback: Option<&str>,
) -> Result<(), String> {
    let mut body = json!({ "response": decision });
    if let Some(feedback) = feedback.filter(|value| !value.trim().is_empty()) {
        body["feedback"] = json!(feedback);
    }
    request(
        port,
        password,
        "POST",
        &format!("/session/{session_id}/permissions/{request_id}"),
        Some(directory),
        Some(body),
    )
    .map(|_| ())
}

pub fn reply_question(
    port: u16,
    password: &str,
    request_id: &str,
    answers: Value,
) -> Result<(), String> {
    request(
        port,
        password,
        "POST",
        &format!("/question/{request_id}/reply"),
        None,
        Some(json!({ "answers": answers })),
    )
    .map(|_| ())
}

pub fn reject_question(port: u16, password: &str, request_id: &str) -> Result<(), String> {
    request(
        port,
        password,
        "POST",
        &format!("/question/{request_id}/reject"),
        None,
        Some(json!({})),
    )
    .map(|_| ())
}

pub fn models(port: u16, password: &str) -> Result<Vec<AgentModel>, String> {
    let value = request(port, password, "GET", "/config/providers", None, None)?;
    Ok(extract_models(&value))
}

fn extract_models(value: &Value) -> Vec<AgentModel> {
    let providers = value
        .get("providers")
        .and_then(Value::as_array)
        .or_else(|| value.get("all").and_then(Value::as_array))
        .or_else(|| value.as_array());
    let Some(providers) = providers else {
        return Vec::new();
    };
    let mut models = Vec::new();
    for provider in providers {
        let provider_id = provider
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let provider_name = provider
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(&provider_id)
            .to_string();
        let entries: Vec<(String, &Value)> = match provider.get("models") {
            Some(Value::Object(map)) => map
                .iter()
                .map(|(key, value)| (key.clone(), value))
                .collect(),
            Some(Value::Array(list)) => list
                .iter()
                .filter_map(|model| {
                    model
                        .get("id")
                        .and_then(Value::as_str)
                        .map(|id| (id.to_string(), model))
                })
                .collect(),
            _ => Vec::new(),
        };
        for (key, model) in entries {
            let model_id = model
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or(&key)
                .to_string();
            let name = model
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(&model_id)
                .to_string();
            if provider_id.is_empty() || model_id.is_empty() {
                continue;
            }
            models.push(AgentModel {
                provider_id: provider_id.clone(),
                model_id,
                name,
                provider_name: provider_name.clone(),
            });
        }
    }
    models
}

pub fn agents(port: u16, password: &str) -> Result<Vec<AgentOption>, String> {
    let value = request(port, password, "GET", "/agent", None, None)?;
    let list = value
        .as_array()
        .cloned()
        .or_else(|| value.get("agents").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    Ok(list
        .into_iter()
        .filter(|agent| {
            agent
                .get("mode")
                .and_then(Value::as_str)
                .map(|mode| mode == "primary")
                .unwrap_or(true)
        })
        .filter_map(|agent| {
            let name = agent
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| agent.get("id").and_then(Value::as_str))?
                .to_string();
            Some(AgentOption {
                id: name.clone(),
                name,
                description: agent
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect())
}

pub fn commands(port: u16, password: &str) -> Result<Vec<ProviderCommand>, String> {
    let value = request(port, password, "GET", "/command", None, None)?;
    let list = value
        .as_array()
        .cloned()
        .or_else(|| value.get("commands").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    Ok(list
        .into_iter()
        .filter_map(|command| {
            let name = command
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| command.get("id").and_then(Value::as_str))?
                .to_string();
            Some(ProviderCommand {
                name,
                description: command
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect())
}

pub fn skills(port: u16, password: &str) -> Result<Vec<ProviderSkill>, String> {
    let value = request(port, password, "GET", "/skill", None, None)?;
    let list = value
        .as_array()
        .cloned()
        .or_else(|| value.get("skills").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    Ok(list
        .into_iter()
        .filter_map(|skill| {
            let name = skill
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| skill.get("id").and_then(Value::as_str))?
                .to_string();
            Some(ProviderSkill {
                name,
                description: skill
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect())
}

pub fn event_stream_loop(
    port: u16,
    password: &str,
    stop: &AtomicBool,
    sender: Sender<StreamMessage>,
    directory: Option<&str>,
) {
    let target = url(port, "/event", directory);
    let auth = auth_header(password);
    let mut backoff = Duration::from_millis(250);
    while !stop.load(Ordering::Relaxed) {
        match ureq::get(&target).set("Authorization", &auth).call() {
            Ok(response) => {
                backoff = Duration::from_millis(250);
                let reader = BufReader::new(response.into_reader());
                for line in reader.lines().map_while(Result::ok) {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let data = data.trim();
                    if data.is_empty() || data == "[DONE]" {
                        continue;
                    }
                    match serde_json::from_str::<Value>(data) {
                        Ok(event) => {
                            if sender.send(StreamMessage::Event(event)).is_err() {
                                return;
                            }
                        }
                        Err(error) => {
                            eprintln!("[agent] event=invalid_sse_json error={error}");
                        }
                    }
                }
                let _ = sender.send(StreamMessage::Disconnected);
            }
            Err(error) => {
                eprintln!("[agent] event=stream_failed error={error}");
                let _ = sender.send(StreamMessage::Disconnected);
            }
        }
        if stop.load(Ordering::Relaxed) {
            return;
        }
        thread::sleep(backoff);
        backoff = (backoff * 2).min(Duration::from_secs(10));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_directory_query() {
        let target = url(1234, "/session", Some("/home/me/my project"));
        assert_eq!(
            target,
            "http://127.0.0.1:1234/session?directory=/home/me/my%20project"
        );
        let target = url(1234, "/session?limit=5", Some("/tmp"));
        assert_eq!(
            target,
            "http://127.0.0.1:1234/session?limit=5&directory=/tmp"
        );
    }

    #[test]
    fn extracts_models_tolerantly() {
        let value = json!({
            "providers": [{
                "id": "anthropic",
                "name": "Anthropic",
                "models": {
                    "claude": { "id": "claude", "name": "Claude" }
                }
            }]
        });
        let models = extract_models(&value);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].provider_id, "anthropic");
        assert_eq!(models[0].model_id, "claude");
    }

    #[test]
    fn builds_basic_auth_header() {
        assert_eq!(auth_header("abc"), "Basic b3BlbmNvZGU6YWJj");
    }
}
