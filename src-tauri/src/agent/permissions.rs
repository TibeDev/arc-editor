use serde_json::{json, Value};

pub const PERMISSION_MODE_SUPERVISED: &str = "supervised";
pub const PERMISSION_MODE_SMART: &str = "smart";
pub const PERMISSION_MODE_YOLO: &str = "yolo";

const SUPERVISED_ACTIONS: [&str; 9] = [
    "edit",
    "write",
    "patch",
    "bash",
    "webfetch",
    "external_directory",
    "task",
    "skill",
    "question",
];

/// Native OpenCode v1 permission ruleset: `{ permission, pattern, action }`.
pub fn supervised_ruleset() -> Value {
    Value::Array(
        SUPERVISED_ACTIONS
            .iter()
            .map(|permission| {
                json!({
                    "permission": permission,
                    "pattern": "*",
                    "action": "ask",
                })
            })
            .collect(),
    )
}

pub fn validate_mode(mode: &str) -> Result<&str, String> {
    match mode {
        PERMISSION_MODE_SUPERVISED | PERMISSION_MODE_SMART | PERMISSION_MODE_YOLO => Ok(mode),
        _ => Err("Permission mode must be supervised, smart, or yolo.".to_string()),
    }
}

fn has_token(text: &str, token: &str) -> bool {
    text.split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part == token)
}

/// Smart mode runs normal file/read/search work and asks for shell, network,
/// delete, and unknown tools. YOLO approves everything.
pub fn should_auto_approve(mode: &str, action: &str, detail: &str) -> bool {
    match mode {
        PERMISSION_MODE_YOLO => true,
        PERMISSION_MODE_SMART => {
            let text = format!("{action} {detail}").to_ascii_lowercase();
            const SENSITIVE: [&str; 15] = [
                "bash", "shell", "command", "execute", "exec", "terminal", "fetch", "webfetch",
                "http", "network", "external", "delete", "remove", "sudo", "curl",
            ];
            if SENSITIVE.iter().any(|token| has_token(&text, token)) {
                return false;
            }
            const ROUTINE: [&str; 12] = [
                "edit",
                "write",
                "patch",
                "read",
                "search",
                "glob",
                "grep",
                "list",
                "think",
                "move",
                "filechange",
                "applypatch",
            ];
            ROUTINE.iter().any(|token| has_token(&text, token))
        }
        _ => false,
    }
}

pub fn validate_decision(decision: &str) -> Result<&str, String> {
    match decision {
        "once" | "always" | "reject" => Ok(decision),
        _ => Err("Decision must be once, always, or reject.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervised_ruleset_uses_native_shape() {
        let rules = supervised_ruleset();
        let array = rules.as_array().expect("ruleset array");
        assert_eq!(array.len(), SUPERVISED_ACTIONS.len());
        for rule in array {
            assert!(rule.get("permission").and_then(Value::as_str).is_some());
            assert_eq!(rule.get("pattern").and_then(Value::as_str), Some("*"));
            assert_eq!(rule.get("action").and_then(Value::as_str), Some("ask"));
        }
    }

    #[test]
    fn classifies_permission_modes() {
        assert!(!should_auto_approve("supervised", "edit", ""));
        assert!(should_auto_approve("smart", "edit", ""));
        assert!(should_auto_approve("smart", "fileChange", ""));
        assert!(!should_auto_approve("smart", "bash", "rm -rf build"));
        assert!(!should_auto_approve("smart", "webfetch", ""));
        assert!(should_auto_approve("yolo", "bash", "rm -rf build"));
        assert!(validate_mode("yolo").is_ok());
        assert!(validate_mode("auto").is_err());
    }

    #[test]
    fn validates_approval_decisions() {
        assert_eq!(validate_decision("once").unwrap(), "once");
        assert_eq!(validate_decision("always").unwrap(), "always");
        assert_eq!(validate_decision("reject").unwrap(), "reject");
        assert!(validate_decision("auto").is_err());
    }
}
