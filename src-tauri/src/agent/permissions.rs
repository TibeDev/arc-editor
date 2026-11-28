use serde_json::{json, Value};

pub const PERMISSION_MODE_SUPERVISED: &str = "supervised";

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
    fn validates_approval_decisions() {
        assert_eq!(validate_decision("once").unwrap(), "once");
        assert_eq!(validate_decision("always").unwrap(), "always");
        assert_eq!(validate_decision("reject").unwrap(), "reject");
        assert!(validate_decision("auto").is_err());
    }
}
