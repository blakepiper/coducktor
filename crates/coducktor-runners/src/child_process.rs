//! Shared subprocess plumbing for every agent-CLI backend: spawn with the curated child env
//! (`agent_env`), a live stdout-line channel, stderr collection, and the SIGTERM->SIGKILL
//! escalation used by the post-`finish()` EOF watchdog.
//!
//! Protocol semantics (what to write and how to interpret a line) stay in each backend; this
//! module only owns the process itself.
//!
//! On Unix each child gets its own process group and every stop signal goes to that group. An
//! agent CLI is often a launcher — `codex` is a Node script that spawns a vendored binary — so
//! signalling the pid alone kills the launcher and leaves the real agent running, orphaned, with
//! the write ends of these pipes still open. That both leaks the agent and makes the pipe readers
//! unreadable-until-forever, which is why teardown also bounds how long it waits on them.

use std::collections::BTreeMap;
use std::io::{self, BufRead, BufReader, Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::agent_env::{self, BuildChildEnvOptions};
use crate::agent_runner::AgentCancellation;
use coducktor_contract::Runner;

#[cfg(test)]
use coducktor_core::agent_session::CancellationToken;

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub program: String,
    pub args: Vec<String>,
    /// Grace period after `finish()` closes stdin before escalating to SIGTERM.
    pub eof_term_grace: Duration,
    /// Grace period after that SIGTERM before escalating to SIGKILL.
    pub eof_kill_grace: Duration,
}

/// A spawned agent-CLI child process: piped stdin, a background-thread-fed stdout line channel,
/// and background-collected stderr.
/// How long teardown waits for one pipe reader before abandoning it. A reader can only still be
/// blocked here if something outside this child's process group holds the write end, which is not
/// a thing teardown can fix — and a safety net that deadlocks is worse than one that gives up.
const READER_JOIN_GRACE: Duration = Duration::from_millis(500);

pub struct ChildProcess {
    child: Child,
    /// The child's own pid, kept separately because signalling must stop once the child has been
    /// reaped: `Child::id` would then name a pid the kernel is free to hand to someone else.
    pid: u32,
    reaped: bool,
    stdin: Option<ChildStdin>,
    stdout_rx: Receiver<String>,
    stdout_handle: Option<JoinHandle<()>>,
    stdout_discard_handle: Option<JoinHandle<()>>,
    stderr_handle: Option<JoinHandle<String>>,
    eof_term_grace: Duration,
    eof_kill_grace: Duration,
    cancellation: Option<AgentCancellation>,
}

pub enum NextLine {
    Line(String),
    /// stdout closed — the process exited (or crashed).
    Closed,
}

/// A caller-provided deadline elapsed while waiting for the next line.
pub struct TimedOut;

fn clean_up_missing_pipe(child: &mut Child, pipe: &str) -> io::Error {
    let _ = child.kill();
    let _ = child.wait();
    io::Error::other(format!("spawned agent process has no piped {pipe}"))
}

impl ChildProcess {
    pub fn spawn(
        config: &SpawnConfig,
        backend: Runner,
        cwd: &Path,
        extra_env: &BTreeMap<String, String>,
        host_env: &BTreeMap<String, String>,
    ) -> io::Result<Self> {
        let child_env = agent_env::build_child_env(BuildChildEnvOptions {
            backend,
            extra_env,
            source: host_env,
        });
        let mut command = Command::new(&config.program);
        command
            .args(&config.args)
            .current_dir(cwd)
            .env_clear()
            .envs(child_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Its own process group, so one signal reaches the launcher and whatever it spawned. It
        // also keeps the cockpit's own terminal signals away from agents: Coducktor stops them
        // deliberately, through cancellation, rather than by whatever hits the foreground group.
        #[cfg(unix)]
        command.process_group(0);

        let mut child = command.spawn()?;
        let pid = child.id();
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => return Err(clean_up_missing_pipe(&mut child, "stdin")),
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => return Err(clean_up_missing_pipe(&mut child, "stdout")),
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => return Err(clean_up_missing_pipe(&mut child, "stderr")),
        };

        let (tx, rx) = mpsc::channel();
        let stdout_handle = thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if tx.send(line).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        let stderr_handle = thread::spawn(move || {
            let mut buffer = String::new();
            let mut stderr = stderr;
            let _ = stderr.read_to_string(&mut buffer);
            buffer
        });

        Ok(Self {
            child,
            pid,
            reaped: false,
            stdin: Some(stdin),
            stdout_rx: rx,
            stdout_handle: Some(stdout_handle),
            stdout_discard_handle: None,
            stderr_handle: Some(stderr_handle),
            eof_term_grace: config.eof_term_grace,
            eof_kill_grace: config.eof_kill_grace,
            cancellation: None,
        })
    }

    pub fn set_cancellation(&mut self, cancellation: impl Into<AgentCancellation>) {
        self.cancellation = Some(cancellation.into());
    }

    fn cancellation_requested(&self) -> bool {
        self.cancellation
            .as_ref()
            .is_some_and(AgentCancellation::is_requested)
    }

    pub fn write_line(&mut self, line: &str) -> Result<(), String> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Err("session is closed".to_owned());
        };
        let mut out = line.to_owned();
        out.push('\n');
        stdin
            .write_all(out.as_bytes())
            .map_err(|error| format!("stdin write failed: {error}"))
    }

    /// Drop the stdin handle, delivering EOF to the child.
    pub fn close_stdin(&mut self) {
        self.stdin = None;
    }

    /// Stop caring about further stdout content — for a backend (opencode) that only needs
    /// stdout briefly at startup (to read back a bound URL) and communicates over some other
    /// channel afterward. Moves the live channel to a background thread that keeps draining it
    /// (discarding each line) so neither the channel nor the underlying OS pipe backs up over a
    /// long session; `self`'s own receiver is replaced with an already-disconnected one, so a
    /// stray later call to `next_line` returns `Closed` rather than reading stale/interleaved
    /// output.
    pub fn discard_stdout(&mut self) {
        let rx = std::mem::replace(&mut self.stdout_rx, mpsc::channel().1);
        self.stdout_discard_handle = Some(thread::spawn(move || while rx.recv().is_ok() {}));
    }

    /// Block for the next stdout line, honoring an optional deadline. `Ok(NextLine::Closed)`
    /// means the process's stdout has closed (it exited or crashed) — not a timeout.
    pub fn next_line(&mut self, deadline: Option<Instant>) -> Result<NextLine, TimedOut> {
        loop {
            if self.cancellation_requested() {
                if !self.has_exited() {
                    self.signal_term();
                }
                return Ok(NextLine::Closed);
            }
            match deadline {
                Some(dl) => {
                    let now = Instant::now();
                    if now >= dl {
                        return Err(TimedOut);
                    }
                    match self
                        .stdout_rx
                        .recv_timeout((dl - now).min(Duration::from_millis(50)))
                    {
                        Ok(line) => return Ok(NextLine::Line(line)),
                        Err(RecvTimeoutError::Timeout) => continue,
                        Err(RecvTimeoutError::Disconnected) => return Ok(NextLine::Closed),
                    }
                }
                None => match self.stdout_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(line) => return Ok(NextLine::Line(line)),
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => return Ok(NextLine::Closed),
                },
            }
        }
    }

    pub fn has_exited(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(Some(_)) => {
                // `try_wait` reaps, so the pid is free for reuse from here on.
                self.reaped = true;
                true
            }
            _ => false,
        }
    }

    /// Signal the child's whole process group.
    ///
    /// Refuses once the child has been reaped: the pid would then name whichever process the
    /// kernel handed it to next, and negating it would take out that process's entire group.
    #[cfg(unix)]
    fn signal_group(&mut self, signal: libc::c_int) {
        if self.reaped {
            return;
        }
        unsafe {
            // The group first — that is the launcher plus the agent it really runs. The direct
            // pid after it, in case this platform or spawn never established the group.
            libc::kill(-(self.pid as libc::pid_t), signal);
            libc::kill(self.pid as libc::pid_t, signal);
        }
    }

    /// Send a graceful stop signal. On Unix this is a real SIGTERM to the child's process group
    /// (the CLI installs its own handler and can act on it); `std::process::Child::kill` has no
    /// SIGTERM concept off Unix, so non-Unix targets fall back to the same hard kill
    /// `signal_kill` uses — there is no softer option there.
    pub fn signal_term(&mut self) {
        #[cfg(unix)]
        self.signal_group(libc::SIGTERM);
        #[cfg(not(unix))]
        {
            let _ = self.child.kill();
        }
    }

    pub fn signal_kill(&mut self) {
        #[cfg(unix)]
        self.signal_group(libc::SIGKILL);
        let _ = self.child.kill();
    }

    /// Poll `try_wait` for up to `budget`, sleeping briefly between checks. Returns whether the
    /// child had exited by the time the budget elapsed.
    pub fn wait_exited_within(&mut self, budget: Duration) -> bool {
        let deadline = Instant::now() + budget;
        loop {
            if self.has_exited() {
                return true;
            }
            if Instant::now() >= deadline {
                return self.has_exited();
            }
            thread::sleep(
                Duration::from_millis(20).min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }

    pub fn wait_for_exit(&mut self) -> Option<i32> {
        let status = self.child.wait().ok();
        self.reaped = true;
        status.and_then(|status| status.code())
    }

    /// The last (at most) three non-empty stderr lines, joined for an error message's detail
    /// suffix. Blocks briefly on the stderr-collector thread if it hasn't finished yet — normally
    /// called once the child has already exited, so its stderr pipe is closed too. Bounded by
    /// [`READER_JOIN_GRACE`] because an orphaned grandchild can hold that pipe open, and no error
    /// message is worth wedging the caller for.
    pub fn take_stderr_tail(&mut self) -> String {
        let Some(handle) = self.stderr_handle.take() else {
            return String::new();
        };
        let raw: String =
            join_within(handle, Instant::now() + READER_JOIN_GRACE).unwrap_or_default();
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        let lines: Vec<&str> = trimmed.lines().collect();
        lines[lines.len().saturating_sub(3)..].join(" | ")
    }

    /// The EOF SIGTERM->SIGKILL watchdog a backend's `finish()` arms after closing stdin.
    pub fn escalate_after_eof(&mut self) {
        if self.wait_exited_within(self.eof_term_grace) {
            return;
        }
        self.signal_term();
        if self.wait_exited_within(self.eof_kill_grace) {
            return;
        }
        self.signal_kill();
    }

    /// A stop sequence with no earlier EOF opportunity to wait out first: signal SIGTERM right
    /// away, wait `grace`, then escalate to SIGKILL if still alive. This is used by a backend
    /// whose process has no stdin protocol to close gracefully, such as OpenCode.
    pub fn escalate_immediately(&mut self, grace: Duration) {
        self.signal_term();
        if !self.wait_exited_within(grace) {
            self.signal_kill();
        }
    }

    /// Join both pipe readers, but never wait longer than [`READER_JOIN_GRACE`] on either.
    ///
    /// A reader is still blocked at this point only if a process outside this child's group holds
    /// the write end open, which teardown cannot resolve. Abandoning the thread leaks one blocked
    /// reader until the process exits; joining it unconditionally would hang teardown forever.
    fn join_readers_bounded(&mut self) {
        let deadline = Instant::now() + READER_JOIN_GRACE;
        if let Some(handle) = self.stdout_handle.take() {
            join_within(handle, deadline);
        }
        if let Some(handle) = self.stdout_discard_handle.take() {
            join_within(handle, deadline);
        }
        if let Some(handle) = self.stderr_handle.take() {
            join_within(handle, deadline);
        }
    }
}

impl Drop for ChildProcess {
    /// A best-effort safety net, not a substitute for a backend's own `finish()`/`cancel()`: if
    /// this value is dropped while the child is still running — a panic unwinding past a normal
    /// teardown call being the main way that happens — hard-kill its process group so neither the
    /// child nor anything it spawned outlives the session that owned it. Then reap it and join
    /// the pipe readers, bounded, so repeated lifecycle churn cannot accumulate detached readers
    /// and one stuck reader cannot wedge the whole teardown.
    fn drop(&mut self) {
        if !self.has_exited() {
            self.signal_kill();
            let _ = self.wait_exited_within(Duration::from_millis(250));
        }
        if self.has_exited() {
            let _ = self.wait_for_exit();
        }
        self.join_readers_bounded();
    }
}

/// Join `handle` if it finishes before `deadline`, otherwise abandon it. Returns the thread's
/// value only when it was actually joined.
fn join_within<T>(handle: JoinHandle<T>, deadline: Instant) -> Option<T> {
    while !handle.is_finished() {
        let now = Instant::now();
        if now >= deadline {
            return None;
        }
        thread::sleep(Duration::from_millis(10).min(deadline - now));
    }
    handle.join().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_reads_lines_over_a_real_echoing_process() {
        // -e prints stdin back to stdout — no fixture needed for this plumbing-only test.
        let dir = tempfile::tempdir().unwrap();
        let config = SpawnConfig {
            program: crate::test_node_program(),
            args: vec![
                "-e".to_owned(),
                "process.stdin.pipe(process.stdout)".to_owned(),
            ],
            eof_term_grace: Duration::from_millis(50),
            eof_kill_grace: Duration::from_millis(50),
        };
        let mut proc = ChildProcess::spawn(
            &config,
            Runner::Claude,
            dir.path(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        proc.write_line("hello").unwrap();
        match proc.next_line(None).ok().unwrap() {
            NextLine::Line(line) => assert_eq!(line, "hello"),
            NextLine::Closed => panic!("expected a line"),
        }
        proc.close_stdin();
        proc.escalate_after_eof();
        assert!(proc.has_exited());
    }

    #[test]
    fn next_line_reports_timed_out_without_touching_the_channel() {
        let dir = tempfile::tempdir().unwrap();
        let config = SpawnConfig {
            program: crate::test_node_program(),
            args: vec!["-e".to_owned(), "setInterval(() => {}, 60000)".to_owned()],
            eof_term_grace: Duration::from_millis(50),
            eof_kill_grace: Duration::from_millis(50),
        };
        let mut proc = ChildProcess::spawn(
            &config,
            Runner::Claude,
            dir.path(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_millis(50);
        assert!(proc.next_line(Some(deadline)).is_err());
        proc.signal_kill();
        proc.wait_for_exit();
    }

    #[test]
    fn drop_kills_and_reaps_a_live_child_with_its_pipe_readers() {
        let dir = tempfile::tempdir().unwrap();
        let config = SpawnConfig {
            program: crate::test_node_program(),
            args: vec![
                "-e".to_owned(),
                "setInterval(() => console.log('still running'), 1000)".to_owned(),
            ],
            eof_term_grace: Duration::from_millis(50),
            eof_kill_grace: Duration::from_millis(50),
        };
        let started = Instant::now();
        let process = ChildProcess::spawn(
            &config,
            Runner::Claude,
            dir.path(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        drop(process);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    /// A launcher script that spawns the real agent and waits, mirroring how `codex` runs a
    /// vendored binary. The grandchild inherits this process's stdout, so if teardown only
    /// signals the direct child, the grandchild survives and holds the pipe open.
    fn launcher_config() -> SpawnConfig {
        SpawnConfig {
            program: crate::test_node_program(),
            args: vec![
                "-e".to_owned(),
                "const {spawn} = require('node:child_process'); \
                 const child = spawn(process.execPath, ['-e', \
                 \"console.log('grandchild ' + process.pid); setInterval(() => {}, 1000)\"], \
                 {stdio: 'inherit'}); \
                 child.on('exit', () => process.exit(0)); \
                 setInterval(() => {}, 1000)"
                    .to_owned(),
            ],
            eof_term_grace: Duration::from_millis(50),
            eof_kill_grace: Duration::from_millis(50),
        }
    }

    #[cfg(unix)]
    fn process_is_alive(pid: u32) -> bool {
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }

    /// The regression behind a hung `coducktor run --runner codex`: an agent CLI that is really a
    /// launcher leaves a grandchild holding these pipes, so signalling the pid alone leaked the
    /// agent and then deadlocked teardown on a reader that could never see EOF.
    #[cfg(unix)]
    #[test]
    fn teardown_stops_a_grandchild_the_agent_launcher_spawned() {
        let dir = tempfile::tempdir().unwrap();
        let mut process = ChildProcess::spawn(
            &launcher_config(),
            Runner::Codex,
            dir.path(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();

        let line = loop {
            match process.next_line(Some(Instant::now() + Duration::from_secs(10))) {
                Ok(NextLine::Line(line)) if line.starts_with("grandchild ") => break line,
                Ok(NextLine::Line(_)) => continue,
                Ok(NextLine::Closed) => panic!("the launcher exited before spawning"),
                Err(TimedOut) => panic!("the launcher never reported its grandchild"),
            }
        };
        let grandchild: u32 = line
            .trim_start_matches("grandchild ")
            .trim()
            .parse()
            .expect("the fixture prints its grandchild pid");
        assert!(process_is_alive(grandchild));

        let started = Instant::now();
        drop(process);

        assert!(
            started.elapsed() < Duration::from_secs(2),
            "teardown must not block on a reader the grandchild holds open"
        );
        // The kill is delivered to the group; give the kernel a moment to reap both.
        let deadline = Instant::now() + Duration::from_secs(2);
        while process_is_alive(grandchild) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            !process_is_alive(grandchild),
            "the agent the launcher spawned must not outlive its session"
        );
    }

    /// Teardown must stay bounded even when nothing it can signal holds the pipe: here an
    /// unrelated process outside the child's group keeps the write end open forever.
    #[cfg(unix)]
    #[test]
    fn teardown_abandons_a_reader_no_signal_can_free() {
        let dir = tempfile::tempdir().unwrap();
        let config = SpawnConfig {
            program: crate::test_node_program(),
            args: vec![
                "-e".to_owned(),
                // Hand this process's stdout to a fully detached grandchild, then exit.
                "const {spawn} = require('node:child_process'); \
                 spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], \
                 {stdio: 'inherit', detached: true}).unref(); \
                 process.exit(0)"
                    .to_owned(),
            ],
            eof_term_grace: Duration::from_millis(50),
            eof_kill_grace: Duration::from_millis(50),
        };
        let mut process = ChildProcess::spawn(
            &config,
            Runner::Codex,
            dir.path(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(process.wait_exited_within(Duration::from_secs(10)));

        let started = Instant::now();
        drop(process);

        assert!(
            started.elapsed() < Duration::from_secs(2),
            "an unfreeable reader is abandoned, never waited on forever"
        );
    }

    #[test]
    fn cancellation_wakes_an_unbounded_read_and_signals_the_child() {
        let dir = tempfile::tempdir().unwrap();
        let config = SpawnConfig {
            program: crate::test_node_program(),
            args: vec!["-e".to_owned(), "setInterval(() => {}, 60000)".to_owned()],
            eof_term_grace: Duration::from_millis(50),
            eof_kill_grace: Duration::from_millis(50),
        };
        let mut proc = ChildProcess::spawn(
            &config,
            Runner::Codex,
            dir.path(),
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        let cancellation = CancellationToken::default();
        proc.set_cancellation(cancellation.clone());
        cancellation.request();

        let started = Instant::now();
        assert!(matches!(proc.next_line(None), Ok(NextLine::Closed)));
        assert!(started.elapsed() < Duration::from_millis(250));
        proc.signal_kill();
        proc.wait_for_exit();
    }

    #[test]
    fn dropping_one_child_keeps_the_session_cancellation_token_live() {
        let dir = tempfile::tempdir().unwrap();
        let config = SpawnConfig {
            program: crate::test_node_program(),
            args: vec!["-e".to_owned(), "setInterval(() => {}, 60000)".to_owned()],
            eof_term_grace: Duration::from_millis(50),
            eof_kill_grace: Duration::from_millis(50),
        };
        let cancellation = CancellationToken::default();
        {
            let mut process = ChildProcess::spawn(
                &config,
                Runner::Codex,
                dir.path(),
                &BTreeMap::new(),
                &BTreeMap::new(),
            )
            .unwrap();
            process.set_cancellation(cancellation.clone());
        }

        // An AgentSession can spawn another child for send_message after this one exits. Only the
        // session owner may deactivate its shared token.
        assert!(cancellation.request());
    }
}
