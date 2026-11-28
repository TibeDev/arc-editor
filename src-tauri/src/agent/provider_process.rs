use std::env;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::channel;
use std::thread;
use std::time::{Duration, Instant};

use super::ids::iso_now;

const MIN_VERSION: (u64, u64, u64) = (1, 19, 5);
const MAX_MAJOR: u64 = 2;

#[allow(dead_code)]
pub struct ServerHandle {
    pub instance_id: String,
    pub port: u16,
    pub password: String,
    pub version: String,
    pub binary: String,
    pub pid: u32,
    pub managed_id: Option<u64>,
    pub child: Child,
    pub started_at: String,
}

pub fn resolve_binary(executable: &str, configured: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
        return Err(format!("Configured OpenCode binary was not found: {path}"));
    }
    if let Some(path) = crate::find_executable(executable) {
        return Ok(path);
    }
    if let Some(path) = login_shell_lookup(executable) {
        return Ok(path);
    }
    Err(format!(
        "{executable} was not found. Install it, or set its binary path in the provider instance."
    ))
}

fn login_shell_lookup(executable: &str) -> Option<PathBuf> {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut command = crate::external_command(&shell);
    command
        .arg("-lc")
        .arg(format!("command -v {executable}"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    let path = output.lines().next()?.trim();
    if path.is_empty() {
        None
    } else {
        let candidate = PathBuf::from(path);
        candidate.is_file().then_some(candidate)
    }
}

pub fn read_version(binary: &Path) -> Result<String, String> {
    let output = crate::external_command(&binary.to_string_lossy())
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not run provider binary: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Provider version check failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    Ok(raw
        .split_whitespace()
        .find(|part| {
            part.chars()
                .next()
                .is_some_and(|value| value.is_ascii_digit())
        })
        .unwrap_or(raw.trim())
        .trim_start_matches('v')
        .to_string())
}

pub fn probe_version(binary: &Path) -> Result<String, String> {
    let version = read_version(binary)?;
    validate_version(&version)?;
    Ok(version)
}

pub fn validate_version(version: &str) -> Result<(), String> {
    let parsed = parse_version(version)
        .ok_or_else(|| format!("Could not parse OpenCode version: {version}"))?;
    if parsed < MIN_VERSION {
        return Err(format!(
            "OpenCode {version} is too old. Arc requires 1.19.5 or newer."
        ));
    }
    if parsed.0 >= MAX_MAJOR {
        return Err(format!(
            "OpenCode {version} is not supported. Arc supports OpenCode 1.x."
        ));
    }
    Ok(())
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.trim().trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts
        .next()
        .unwrap_or("0")
        .split(|character: char| !character.is_ascii_digit())
        .next()
        .unwrap_or("0")
        .parse()
        .ok()?;
    Some((major, minor, patch))
}

pub fn spawn(
    instance_id: &str,
    binary: &Path,
    password: &str,
    processes: &crate::process::ProcessManager,
) -> Result<ServerHandle, String> {
    let version = probe_version(binary)?;
    let mut command = crate::external_command(&binary.to_string_lossy());
    command
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("0")
        .env("OPENCODE_SERVER_PASSWORD", password)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    strip_foreign_credentials(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start OpenCode: {error}"))?;
    let managed_id = processes.register(format!("agent:opencode:{instance_id}"), child.id());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not read OpenCode output.".to_string())?;
    let stderr = child.stderr.take();
    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let mut sink = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut sink);
        });
    }
    let (sender, receiver) = channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(port) = parse_listening_port(&line) {
                let _ = sender.send(port);
            }
        }
    });
    let port = match receiver.recv_timeout(Duration::from_secs(15)) {
        Ok(port) => port,
        Err(_) => {
            if let Some(managed) = managed_id {
                processes.stop(managed, Duration::from_millis(200));
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(
                "OpenCode did not report a listening address within 15 seconds.".to_string(),
            );
        }
    };
    let pid = child.id();
    Ok(ServerHandle {
        instance_id: instance_id.to_string(),
        port,
        password: password.to_string(),
        version,
        binary: binary.to_string_lossy().into_owned(),
        pid,
        managed_id,
        child,
        started_at: iso_now(),
    })
}

impl ServerHandle {
    pub fn stop(&mut self, processes: &crate::process::ProcessManager) {
        if let Some(managed) = self.managed_id.take() {
            processes.stop(managed, crate::process::STOP_GRACE);
        } else {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}

pub fn parse_listening_port(line: &str) -> Option<u16> {
    let marker = "http://";
    let start = line.find(marker)? + marker.len();
    let rest = &line[start..];
    let host_end = rest.find(':')?;
    let host = &rest[..host_end];
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    let digits: String = rest[host_end + 1..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

pub(crate) fn strip_foreign_credentials(command: &mut Command) {
    for (key, _) in env::vars_os() {
        let key = key.to_string_lossy();
        if is_foreign_credential(&key) {
            command.env_remove(key.as_ref());
        }
    }
}

fn is_foreign_credential(key: &str) -> bool {
    const PREFIXES: [&str; 6] = [
        "ANTHROPIC_",
        "OPENAI_",
        "GEMINI_",
        "GOOGLE_",
        "AWS_",
        "AZURE_",
    ];
    const EXACT: [&str; 2] = ["GITHUB_TOKEN", "GH_TOKEN"];
    PREFIXES.iter().any(|prefix| key.starts_with(prefix))
        || EXACT.contains(&key)
        || key.ends_with("_API_KEY")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_versions() {
        assert!(validate_version("1.19.5").is_ok());
        assert!(validate_version("v1.20.0").is_ok());
        assert!(validate_version("1.18.9").is_err());
        assert!(validate_version("2.0.0").is_err());
    }

    #[test]
    fn parses_listening_urls() {
        assert_eq!(
            parse_listening_port("opencode server listening on http://127.0.0.1:34567"),
            Some(34567)
        );
        assert_eq!(parse_listening_port("no address here"), None);
        assert_eq!(parse_listening_port("http://0.0.0.0:1234"), None);
    }

    #[test]
    fn identifies_foreign_credentials() {
        assert!(is_foreign_credential("OPENAI_API_KEY"));
        assert!(is_foreign_credential("GITHUB_TOKEN"));
        assert!(is_foreign_credential("SOME_API_KEY"));
        assert!(!is_foreign_credential("PATH"));
        assert!(!is_foreign_credential("OPENCODE_SERVER_PASSWORD"));
    }
}
