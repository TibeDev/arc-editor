use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const THREAD_UPDATED: &str = "agent://thread-updated";
pub const RUN_UPDATED: &str = "agent://run-updated";
pub const ITEM_UPDATED: &str = "agent://item-updated";
pub const APPROVAL_REQUESTED: &str = "agent://approval-requested";
pub const APPROVAL_RESOLVED: &str = "agent://approval-resolved";
pub const QUESTION_REQUESTED: &str = "agent://question-requested";
pub const QUESTION_RESOLVED: &str = "agent://question-resolved";
pub const PROVIDER_STATUS: &str = "agent://provider-status";
pub const NOTICE: &str = "agent://notice";

pub fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(error) = app.emit(event, payload) {
        eprintln!("[agent] event=emit_failed name={event} error={error}");
    }
}
