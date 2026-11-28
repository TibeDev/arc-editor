use std::collections::HashMap;

use super::store::AgentRecord;
use super::types::{AgentApproval, AgentRun, AgentThread};

const ACTIVE_RUN_STATES: [&str; 3] = ["starting", "running", "waiting"];

/// Repairs state left behind by a previous Arc process. Returns records that
/// must be appended to the thread transcript.
pub fn repair_thread(
    thread: &mut AgentThread,
    runs: &mut HashMap<String, AgentRun>,
    approvals: &mut HashMap<String, AgentApproval>,
    now: &str,
) -> Vec<AgentRecord> {
    let mut records = Vec::new();
    let mut interrupted = false;
    let mut last_failed = false;
    let mut last_started = String::new();
    for run in runs.values().filter(|run| run.thread_id == thread.id) {
        if run.started_at >= last_started {
            last_started = run.started_at.clone();
            last_failed = run.status == "failed";
        }
    }
    let run_ids: Vec<String> = runs
        .values()
        .filter(|run| {
            run.thread_id == thread.id && ACTIVE_RUN_STATES.contains(&run.status.as_str())
        })
        .map(|run| run.id.clone())
        .collect();
    for run_id in run_ids {
        if let Some(run) = runs.get_mut(&run_id) {
            run.status = "stopped".to_string();
            run.ended_at = Some(now.to_string());
            run.error = Some("Arc restarted while the agent was running.".to_string());
            interrupted = true;
            records.push(AgentRecord::Run { run: run.clone() });
        }
    }
    if thread.ui_status == "working" || thread.ui_status == "needs-input" {
        thread.ui_status = if interrupted || last_failed {
            "error".to_string()
        } else {
            "idle".to_string()
        };
        thread.updated_at = now.to_string();
    }
    let pending: Vec<String> = approvals
        .values()
        .filter(|approval| approval.thread_id == thread.id && approval.decision.is_none())
        .map(|approval| approval.id.clone())
        .collect();
    for approval_id in pending {
        if let Some(approval) = approvals.get_mut(&approval_id) {
            approval.decision = Some("expired".to_string());
            approval.resolved_at = Some(now.to_string());
            records.push(AgentRecord::ApprovalResolved {
                approval_id,
                decision: "expired".to_string(),
            });
        }
    }
    records
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::AgentApproval;

    fn thread() -> AgentThread {
        AgentThread {
            id: "thread-1".into(),
            project_id: "project-1".into(),
            provider_instance_id: "opencode-default".into(),
            title: "Chat".into(),
            model: None,
            permission_mode: "supervised".into(),
            native_session_id: Some("session-1".into()),
            worktree_path: None,
            ui_status: "working".into(),
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
            last_visited_at: None,
            archived_at: None,
            pinned_at: None,
        }
    }

    fn run(status: &str) -> AgentRun {
        AgentRun {
            id: "run-1".into(),
            thread_id: "thread-1".into(),
            status: status.into(),
            started_at: "2026-01-01T00:00:00.000Z".into(),
            ended_at: None,
            error: None,
        }
    }

    #[test]
    fn repairs_interrupted_runs_and_pending_approvals() {
        let mut thread = thread();
        let mut runs = HashMap::from([("run-1".into(), run("running"))]);
        let mut approvals = HashMap::from([(
            "approval-1".into(),
            AgentApproval {
                id: "approval-1".into(),
                thread_id: "thread-1".into(),
                run_id: "run-1".into(),
                provider_request_id: "req".into(),
                title: "Approve".into(),
                detail: "detail".into(),
                action: Some("bash".into()),
                resources: None,
                decision: None,
                created_at: "2026-01-01T00:00:00.000Z".into(),
                resolved_at: None,
            },
        )]);
        let records = repair_thread(
            &mut thread,
            &mut runs,
            &mut approvals,
            "2026-01-02T00:00:00.000Z",
        );
        assert_eq!(runs["run-1"].status, "stopped");
        assert_eq!(thread.ui_status, "error");
        assert_eq!(approvals["approval-1"].decision.as_deref(), Some("expired"));
        assert!(records
            .iter()
            .any(|record| matches!(record, AgentRecord::Run { .. })));
        assert!(records
            .iter()
            .any(|record| matches!(record, AgentRecord::ApprovalResolved { .. })));
    }
}
