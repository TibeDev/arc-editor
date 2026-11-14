use std::collections::HashMap;
use std::process::Command;
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

pub const STOP_GRACE: Duration = Duration::from_millis(1500);

#[derive(Default)]
pub struct ProcessManager {
    inner: Mutex<Registry>,
}

#[derive(Default)]
struct Registry {
    next_id: u64,
    shutting_down: bool,
    processes: HashMap<u64, ManagedProcess>,
}

struct ManagedProcess {
    pid: u32,
    label: String,
    #[cfg(windows)]
    job: Option<windows_job::JobHandle>,
}

pub fn prepare_command(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP);
    }
}

impl ProcessManager {
    pub fn register(&self, label: impl Into<String>, pid: u32) -> Option<u64> {
        let label = label.into();
        #[cfg(windows)]
        let job = windows_job::create(pid);
        #[cfg(windows)]
        if job.is_none() {
            log("job_unavailable", &format!("pid={pid} label={label:?}"));
        }

        let mut registry = self.registry();
        if registry.shutting_down {
            log("register_rejected", &format!("pid={pid} label={label:?}"));
            return None;
        }
        registry.next_id = registry.next_id.saturating_add(1);
        let id = registry.next_id;
        registry.processes.insert(
            id,
            ManagedProcess {
                pid,
                label: label.clone(),
                #[cfg(windows)]
                job,
            },
        );
        log("spawned", &format!("id={id} pid={pid} label={label:?}"));
        Some(id)
    }

    pub fn unregister(&self, id: u64) {
        let process = self.registry().processes.remove(&id);
        drop(process);
    }

    pub fn stop(&self, id: u64, grace: Duration) {
        let process = self.registry().processes.remove(&id);
        if let Some(process) = process {
            process.terminate(grace);
        }
    }

    pub fn shutdown(&self) {
        let processes = {
            let mut registry = self.registry();
            if registry.shutting_down {
                return;
            }
            registry.shutting_down = true;
            let processes: Vec<ManagedProcess> = registry
                .processes
                .drain()
                .map(|(_, process)| process)
                .collect();
            processes
        };
        if processes.is_empty() {
            log("shutdown", "count=0");
            return;
        }

        #[cfg(unix)]
        {
            for process in &processes {
                process.signal(libc::SIGTERM);
            }
            let deadline = Instant::now() + STOP_GRACE;
            while Instant::now() < deadline && processes.iter().any(ManagedProcess::is_alive) {
                thread::sleep(Duration::from_millis(25));
            }
            for process in &processes {
                if process.is_alive() {
                    process.signal(libc::SIGKILL);
                    log(
                        "shutdown_forced",
                        &format!("pid={} label={:?}", process.pid, process.label),
                    );
                }
            }
        }
        #[cfg(windows)]
        {
            for process in &processes {
                process.terminate(Duration::ZERO);
            }
        }

        log("shutdown", &format!("count={}", processes.len()));
    }

    fn registry(&self) -> MutexGuard<'_, Registry> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Drop for ProcessManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl ManagedProcess {
    fn terminate(&self, grace: Duration) {
        log(
            "stopping",
            &format!("pid={} label={:?}", self.pid, self.label),
        );
        #[cfg(unix)]
        {
            self.signal(libc::SIGTERM);
            if grace.is_zero() {
                self.signal(libc::SIGKILL);
            } else {
                let deadline = Instant::now() + grace;
                while Instant::now() < deadline {
                    if !self.is_alive() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(20));
                }
                if self.is_alive() {
                    self.signal(libc::SIGKILL);
                    log(
                        "forced",
                        &format!("pid={} label={:?}", self.pid, self.label),
                    );
                }
            }
        }
        #[cfg(windows)]
        {
            let _ = grace;
            if let Some(job) = &self.job {
                windows_job::terminate_job(job);
            } else {
                windows_job::terminate(self.pid);
            }
        }
    }

    #[cfg(unix)]
    fn signal(&self, signal: i32) {
        let result = unsafe { libc::kill(-(self.pid as i32), signal) };
        if result == -1 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                log(
                    "signal_failed",
                    &format!(
                        "pid={} label={:?} signal={signal} error={error}",
                        self.pid, self.label
                    ),
                );
            }
        }
    }

    #[cfg(unix)]
    fn is_alive(&self) -> bool {
        unsafe { libc::kill(-(self.pid as i32), 0) == 0 }
    }
}

fn log(event: &str, fields: &str) {
    eprintln!("[process] event={event} {fields}");
}

#[cfg(windows)]
mod windows_job {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, TerminateProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    pub struct JobHandle(HANDLE);

    unsafe impl Send for JobHandle {}

    impl Drop for JobHandle {
        fn drop(&mut self) {
            unsafe {
                if !self.0.is_null() {
                    CloseHandle(self.0);
                }
            }
        }
    }

    pub fn create(pid: u32) -> Option<JobHandle> {
        unsafe {
            let job = CreateJobObjectW(ptr::null(), ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if configured == 0 {
                CloseHandle(job);
                return None;
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                CloseHandle(job);
                return None;
            }
            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == 0 {
                CloseHandle(job);
                return None;
            }
            Some(JobHandle(job))
        }
    }

    pub fn terminate(pid: u32) {
        unsafe {
            let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                super::log(
                    "terminate_failed",
                    &format!("pid={pid} error={}", std::io::Error::last_os_error()),
                );
                return;
            }
            if TerminateProcess(process, 1) == 0 {
                super::log(
                    "terminate_failed",
                    &format!("pid={pid} error={}", std::io::Error::last_os_error()),
                );
            }
            CloseHandle(process);
        }
    }

    pub fn terminate_job(job: &JobHandle) {
        unsafe {
            if TerminateJobObject(job.0, 1) == 0 {
                super::log(
                    "terminate_job_failed",
                    &format!("error={}", std::io::Error::last_os_error()),
                );
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;

    #[test]
    fn stops_the_whole_process_group() {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("sleep 30 & wait")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        prepare_command(&mut command);
        let mut child = command.spawn().expect("spawn shell");
        let manager = ProcessManager::default();
        let id = manager
            .register("test:process-group", child.id())
            .expect("register process");
        let started = Instant::now();
        manager.stop(id, Duration::from_millis(500));
        child.wait().expect("wait for shell");
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
