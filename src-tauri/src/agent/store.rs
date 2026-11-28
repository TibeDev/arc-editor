use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::ids::now_millis;
use super::types::{
    AgentApproval, AgentItem, AgentProject, AgentProviderInstance, AgentQuestion, AgentRun,
    AgentThread,
};

pub const INDEX_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
pub struct ProjectsIndex {
    pub version: u32,
    pub projects: Vec<AgentProject>,
}

#[derive(Serialize, Deserialize)]
pub struct ProvidersIndex {
    pub version: u32,
    pub providers: Vec<AgentProviderInstance>,
}

#[derive(Serialize, Deserialize)]
pub struct ThreadsIndex {
    pub version: u32,
    pub threads: Vec<AgentThread>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(
    rename_all = "camelCase",
    tag = "type",
    rename_all_fields = "camelCase"
)]
pub enum AgentRecord {
    Run {
        run: AgentRun,
    },
    Item {
        item: AgentItem,
    },
    ItemPatch {
        id: String,
        patch: serde_json::Value,
    },
    Approval {
        approval: AgentApproval,
    },
    ApprovalResolved {
        approval_id: String,
        decision: String,
    },
    Question {
        question: AgentQuestion,
    },
    QuestionResolved {
        question_id: String,
        status: String,
    },
}

pub struct AgentStore {
    root: PathBuf,
    threads_dir: PathBuf,
}

impl AgentStore {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        let threads_dir = root.join("threads");
        fs::create_dir_all(&threads_dir)
            .map_err(|error| format!("Could not create agent data directory: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&root, fs::Permissions::from_mode(0o700));
            let _ = fs::set_permissions(&threads_dir, fs::Permissions::from_mode(0o700));
        }
        Ok(Self { root, threads_dir })
    }

    #[allow(dead_code)]
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn load_index<T: DeserializeOwned>(&self, name: &str) -> Result<Option<T>, String> {
        let path = self.root.join(name);
        if !path.exists() {
            return Ok(None);
        }
        let text =
            fs::read_to_string(&path).map_err(|error| format!("Could not read {name}: {error}"))?;
        match serde_json::from_str::<T>(&text) {
            Ok(value) => Ok(Some(value)),
            Err(error) => {
                let quarantine = path.with_extension(format!("corrupt-{}", now_millis()));
                let _ = fs::rename(&path, &quarantine);
                Err(format!(
                    "{name} was corrupt and has been preserved as {}: {error}",
                    quarantine.display()
                ))
            }
        }
    }

    pub fn write_index<T: Serialize>(&self, name: &str, value: &T) -> Result<(), String> {
        let target = self.root.join(name);
        let serialized = serde_json::to_vec_pretty(value)
            .map_err(|error| format!("Could not serialize {name}: {error}"))?;
        let temp = self.root.join(format!(".{name}.tmp-{}", now_millis()));
        {
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temp)
                .map_err(|error| format!("Could not write {name}: {error}"))?;
            file.write_all(&serialized)
                .and_then(|_| file.sync_all())
                .map_err(|error| format!("Could not write {name}: {error}"))?;
        }
        #[cfg(windows)]
        {
            if target.exists() {
                let _ = fs::remove_file(&target);
            }
        }
        fs::rename(&temp, &target).map_err(|error| format!("Could not replace {name}: {error}"))?;
        Ok(())
    }

    pub fn thread_path(&self, thread_id: &str) -> Result<PathBuf, String> {
        if thread_id.is_empty()
            || !thread_id
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
        {
            return Err("Invalid thread id.".to_string());
        }
        Ok(self.threads_dir.join(format!("{thread_id}.jsonl")))
    }

    pub fn append_record(&self, thread_id: &str, record: &AgentRecord) -> Result<(), String> {
        let path = self.thread_path(thread_id)?;
        let line = serde_json::to_string(record)
            .map_err(|error| format!("Could not serialize transcript record: {error}"))?;
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&path)
            .map_err(|error| format!("Could not open transcript: {error}"))?;
        file.write_all(line.as_bytes())
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.flush())
            .map_err(|error| format!("Could not append transcript: {error}"))?;
        Ok(())
    }

    pub fn read_records(&self, thread_id: &str) -> Result<Vec<AgentRecord>, String> {
        let path = self.thread_path(thread_id)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let file =
            fs::File::open(&path).map_err(|error| format!("Could not read transcript: {error}"))?;
        let mut records = Vec::new();
        for line in BufReader::new(file).lines() {
            let Ok(line) = line else { continue };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<AgentRecord>(line) {
                Ok(record) => records.push(record),
                Err(error) => {
                    eprintln!("[agent] event=corrupt_transcript_line error={error}");
                }
            }
        }
        Ok(records)
    }

    pub fn delete_thread_file(&self, thread_id: &str) -> Result<(), String> {
        let path = self.thread_path(thread_id)?;
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("Could not delete transcript: {error}"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let suffix = now_millis();
        let root = std::env::temp_dir().join(format!("arc-agent-{label}-{suffix}"));
        let _ = fs::remove_dir_all(&root);
        root
    }

    fn sample_project() -> AgentProject {
        AgentProject {
            id: "project-1".into(),
            path: "/tmp/project".into(),
            name: "project".into(),
            trusted: true,
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn writes_and_reloads_an_index_atomically() {
        let root = temp_root("index");
        let store = AgentStore::new(root.clone()).unwrap();
        let index = ProjectsIndex {
            version: INDEX_VERSION,
            projects: vec![sample_project()],
        };
        store.write_index("projects.json", &index).unwrap();
        let loaded: ProjectsIndex = store.load_index("projects.json").unwrap().unwrap();
        assert_eq!(loaded.projects.len(), 1);
        assert_eq!(loaded.projects[0].path, "/tmp/project");

        let leftovers: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn appends_and_reads_transcript_records() {
        let root = temp_root("jsonl");
        let store = AgentStore::new(root.clone()).unwrap();
        let run = AgentRun {
            id: "run-1".into(),
            thread_id: "thread-1".into(),
            status: "running".into(),
            started_at: "2026-01-01T00:00:00.000Z".into(),
            ended_at: None,
            error: None,
        };
        store
            .append_record("thread-1", &AgentRecord::Run { run: run.clone() })
            .unwrap();
        store
            .append_record(
                "thread-1",
                &AgentRecord::ItemPatch {
                    id: "item-1".into(),
                    patch: serde_json::json!({ "text": "hello" }),
                },
            )
            .unwrap();
        let records = store.read_records("thread-1").unwrap();
        assert_eq!(records.len(), 2);
        assert!(matches!(records[0], AgentRecord::Run { .. }));
        assert!(store.thread_path("../evil").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn quarantines_a_corrupt_index() {
        let root = temp_root("corrupt");
        let store = AgentStore::new(root.clone()).unwrap();
        fs::write(root.join("projects.json"), "{ not json").unwrap();
        assert!(store.load_index::<ProjectsIndex>("projects.json").is_err());
        assert!(!root.join("projects.json").exists());
        let quarantined = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("projects.corrupt-")
            });
        assert!(quarantined.is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_store_under_its_root() {
        let root = temp_root("root");
        let store = AgentStore::new(root.clone()).unwrap();
        assert!(store.root().starts_with(std::env::temp_dir()));
        assert_eq!(store.root(), root.as_path());
        fs::remove_dir_all(root).unwrap();
    }
}
