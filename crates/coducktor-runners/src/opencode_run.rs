//! Conversation transport for `opencode run --format json --auto`.
//!
//! One short-lived process is one provider turn. The provider session ID from the stream is kept
//! on this logical session and passed back with `--session` on the next process, so process
//! recreation never requires transcript replay.

use std::collections::{BTreeMap, HashSet};
use std::io;
use std::time::Duration;

use coducktor_contract::{ConversationQuestionAnswer, Runner};
use coducktor_core::conversations::{
    ConversationEventInput, ConversationSession, ConversationTurnRequest, TurnOutcome, TurnReport,
};
use serde_json::Value;

use crate::agent_runner::{AgentRunSpec, prepend_system_prompt, selected_reasoning};
use crate::child_process::{ChildProcess, NextLine, SpawnConfig};
use crate::conversation_factory::provider_turn_context;

/// Where to find the opencode binary. Production wiring resolves `program`/`prefix_args` from
/// `DUCK_OPENCODE_BIN` in the session factory; tests point `program` at `node` with
/// `prefix_args: vec![mock_script_path]`.
#[derive(Debug, Clone)]
pub struct OpencodeSpawnConfig {
    pub program: String,
    pub prefix_args: Vec<String>,
    /// Grace period after a cancelled turn's SIGTERM before escalating to SIGKILL.
    pub kill_grace: Duration,
}

impl Default for OpencodeSpawnConfig {
    fn default() -> Self {
        Self {
            program: "opencode".to_owned(),
            prefix_args: Vec::new(),
            kill_grace: Duration::from_millis(4_000),
        }
    }
}

pub struct OpencodeRunSession {
    config: OpencodeSpawnConfig,
    spec: AgentRunSpec,
    host_env: BTreeMap<String, String>,
    provider_session_id: Option<String>,
}

impl OpencodeRunSession {
    pub fn new(
        config: OpencodeSpawnConfig,
        spec: AgentRunSpec,
        host_env: BTreeMap<String, String>,
    ) -> Self {
        let provider_session_id = spec.session_id.clone();
        Self {
            config,
            spec,
            host_env,
            provider_session_id,
        }
    }

    fn run_turn(
        &mut self,
        request: &ConversationTurnRequest,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        if !request.images.is_empty() {
            return Err(
                "OpenCode's conversation run transport does not support image input".to_owned(),
            );
        }
        if !request.additional_directories.is_empty() {
            return Err(
                "OpenCode's conversation run transport does not support additional directories"
                    .to_owned(),
            );
        }
        let context = provider_turn_context(request)?;
        let prompt = prepend_system_prompt(context.as_deref(), &request.user_text);
        let mut args = self.config.prefix_args.clone();
        args.extend(build_opencode_run_args(
            &self.spec,
            self.provider_session_id.as_deref(),
            &request.cwd.to_string_lossy(),
            &prompt,
        ));
        let mut process = ChildProcess::spawn(
            &SpawnConfig {
                program: self.config.program.clone(),
                args,
                eof_term_grace: Duration::ZERO,
                eof_kill_grace: Duration::ZERO,
            },
            Runner::OpenCode,
            &request.cwd,
            &self.spec.env,
            &self.host_env,
        )
        .map_err(|error| wrap_spawn_error(&error, &self.config.program))?;
        process.set_cancellation(request.cancellation.clone());
        // `opencode run` waits for piped stdin to reach EOF before it begins the argument-supplied
        // prompt. Coducktor never sends protocol data on this transport, so retaining the pipe
        // makes a real interactive launch wait forever even though fixture processes exit.
        process.close_stdin();

        let mut state = RunState::default();
        loop {
            match process.next_line(None) {
                Ok(NextLine::Line(line)) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<Value>(trimmed) {
                        Ok(frame) => state.handle_frame(&frame, on_event)?,
                        Err(_) => on_event(ConversationEventInput::new("note").field(
                            "message",
                            format!(
                                "opencode: skipped unparseable stream line: {}",
                                truncate(trimmed, 200)
                            ),
                        ))
                        .map_err(|error| error.to_string())?,
                    }
                }
                Ok(NextLine::Closed) => break,
                Err(_) => unreachable!("an unbounded read cannot time out"),
            }
        }

        if request.cancellation.is_requested() {
            if !process.has_exited() {
                process.escalate_immediately(self.config.kill_grace);
            }
            process.wait_for_exit();
            on_event(ConversationEventInput::new("turn-end")).map_err(|error| error.to_string())?;
            self.adopt_session_id(state.session_id.clone());
            return Ok(TurnOutcome::Cancelled {
                report: state.report(self.provider_session_id.clone()),
                session_open: self.provider_session_id.is_some(),
            });
        }

        let exit_code = process.wait_for_exit();
        let stderr = process.take_stderr_tail();
        self.adopt_session_id(state.session_id.clone());
        on_event(ConversationEventInput::new("turn-end")).map_err(|error| error.to_string())?;
        let report = state.report(self.provider_session_id.clone());
        if let Some(message) = state.error {
            return Ok(TurnOutcome::Failed {
                message,
                report,
                session_open: self.provider_session_id.is_some(),
            });
        }
        if exit_code.is_some_and(|code| code != 0) {
            let detail = if stderr.is_empty() {
                String::new()
            } else {
                format!(" — {stderr}")
            };
            return Ok(TurnOutcome::Failed {
                message: format!(
                    "opencode run exited with code {}{detail}",
                    exit_code.unwrap_or_default()
                ),
                report,
                session_open: self.provider_session_id.is_some(),
            });
        }
        if self.provider_session_id.is_none() {
            return Ok(TurnOutcome::Failed {
                message: "opencode run ended without reporting a provider session id".to_owned(),
                report,
                session_open: false,
            });
        }
        Ok(TurnOutcome::Ended {
            report,
            session_open: true,
        })
    }

    fn adopt_session_id(&mut self, session_id: Option<String>) {
        if session_id.is_some() {
            self.provider_session_id = session_id;
        }
    }
}

impl ConversationSession for OpencodeRunSession {
    fn turn(
        &mut self,
        request: &ConversationTurnRequest,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        self.run_turn(request, on_event)
    }

    fn answer(
        &mut self,
        _request_id: &str,
        _answers: &[ConversationQuestionAnswer],
        _cancellation: &coducktor_core::conversations::TurnCancellation,
        _on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        Err("OpenCode's conversation run transport has no structured-question response".to_owned())
    }

    fn provider_session_id(&self) -> Option<String> {
        self.provider_session_id.clone()
    }
}

pub fn build_opencode_run_args(
    spec: &AgentRunSpec,
    session_id: Option<&str>,
    cwd: &str,
    prompt: &str,
) -> Vec<String> {
    let mut args = vec![
        "run".to_owned(),
        "--format".to_owned(),
        "json".to_owned(),
        "--auto".to_owned(),
        "--dir".to_owned(),
        cwd.to_owned(),
    ];
    if let Some(model) = &spec.model {
        args.push("--model".to_owned());
        args.push(model.clone());
    }
    if let Some(reasoning) = selected_reasoning(spec) {
        args.push("--variant".to_owned());
        args.push(reasoning.to_owned());
    }
    if let Some(session_id) = session_id {
        args.push("--session".to_owned());
        args.push(session_id.to_owned());
    }
    args.push(prompt.to_owned());
    args
}

fn wrap_spawn_error(error: &io::Error, program: &str) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        format!(
            "`{program}` not found on PATH — install OpenCode (https://opencode.ai) and run `opencode` once to configure a provider"
        )
    } else {
        error.to_string()
    }
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() > max {
        format!("{}…", text.chars().take(max).collect::<String>())
    } else {
        text.to_owned()
    }
}

#[derive(Default)]
struct RunState {
    session_id: Option<String>,
    text_chunks: Vec<String>,
    seen_tools: HashSet<String>,
    tokens_used: f64,
    input_tokens: Option<f64>,
    output_tokens: Option<f64>,
    cost_usd: Option<f64>,
    error: Option<String>,
}

impl RunState {
    fn handle_frame(
        &mut self,
        frame: &Value,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<(), String> {
        if let Some(session_id) = frame.get("sessionID").and_then(Value::as_str)
            && self.session_id.as_deref() != Some(session_id)
        {
            self.session_id = Some(session_id.to_owned());
            on_event(ConversationEventInput::new("session").field("sessionId", session_id))
                .map_err(|error| error.to_string())?;
        }
        let event_type = frame
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let part = frame.get("part").unwrap_or(frame);
        match event_type {
            "text" => {
                if let Some(text) = part.get("text").and_then(Value::as_str)
                    && !text.is_empty()
                {
                    self.text_chunks.push(text.to_owned());
                    on_event(ConversationEventInput::new("text").field("text", text))
                        .map_err(|error| error.to_string())?;
                }
            }
            "reasoning" => {
                if let Some(text) = part.get("text").and_then(Value::as_str)
                    && !text.is_empty()
                {
                    on_event(ConversationEventInput::new("reasoning").field("text", text))
                        .map_err(|error| error.to_string())?;
                }
            }
            "tool_use" => self.handle_tool(part, on_event)?,
            "step_finish" => self.handle_step_finish(part, on_event)?,
            "error" | "session_error" => {
                let message = part
                    .get("message")
                    .or_else(|| part.get("error"))
                    .and_then(Value::as_str)
                    .unwrap_or("OpenCode reported an error")
                    .to_owned();
                self.error = Some(message.clone());
                on_event(ConversationEventInput::new("error").field("message", message))
                    .map_err(|error| error.to_string())?;
            }
            "permission" | "permission_asked" => {
                let message = "OpenCode requested permission despite --auto".to_owned();
                self.error = Some(message.clone());
                on_event(ConversationEventInput::new("error").field("message", message))
                    .map_err(|error| error.to_string())?;
            }
            _ => {}
        }
        Ok(())
    }

    fn handle_tool(
        &mut self,
        part: &Value,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<(), String> {
        let id = part
            .get("callID")
            .or_else(|| part.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("opencode-tool");
        let tool = part
            .get("tool")
            .or_else(|| part.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("tool");
        let state = part.get("state").unwrap_or(part);
        if self.seen_tools.insert(id.to_owned()) {
            on_event(
                ConversationEventInput::new("tool-call")
                    .field("id", id)
                    .field("tool", tool)
                    .field("input", state.get("input").cloned().unwrap_or(Value::Null)),
            )
            .map_err(|error| error.to_string())?;
        }
        let status = state.get("status").and_then(Value::as_str);
        if matches!(status, Some("completed" | "error" | "failed")) {
            let is_error = matches!(status, Some("error" | "failed"));
            let result = state
                .get("output")
                .or_else(|| state.get("error"))
                .cloned()
                .unwrap_or(Value::Null);
            let exit_code = state.pointer("/metadata/exit").cloned();
            let mut event = ConversationEventInput::new("tool-result")
                .field("toolCallId", id)
                .field("result", result)
                .field("isError", is_error);
            if let Some(exit_code) = exit_code {
                event = event.field("exitCode", exit_code);
            }
            on_event(event).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn handle_step_finish(
        &mut self,
        part: &Value,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<(), String> {
        if let Some(tokens) = part.get("tokens") {
            let input = tokens.get("input").and_then(Value::as_f64);
            let output = tokens.get("output").and_then(Value::as_f64);
            let total = tokens
                .get("total")
                .and_then(Value::as_f64)
                .or_else(|| Some(input.unwrap_or(0.0) + output.unwrap_or(0.0)))
                .unwrap_or(0.0);
            self.tokens_used = total;
            self.input_tokens = input;
            self.output_tokens = output;
            on_event(
                ConversationEventInput::new("token-usage")
                    .field("tokensUsed", total)
                    .field("inputTokens", input)
                    .field("outputTokens", output),
            )
            .map_err(|error| error.to_string())?;
        }
        if let Some(cost) = part.get("cost").and_then(Value::as_f64) {
            self.cost_usd = Some(cost);
            on_event(ConversationEventInput::new("cost").field("usd", cost))
                .map_err(|error| error.to_string())?;
        }
        if part.get("reason").and_then(Value::as_str) == Some("error") {
            self.error = Some("OpenCode ended the turn with an error".to_owned());
        }
        Ok(())
    }

    fn report(&self, provider_session_id: Option<String>) -> TurnReport {
        TurnReport {
            provider_session_id,
            tokens_used: self.tokens_used,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cost_usd: self.cost_usd,
            turn_text: self.text_chunks.join("\n").trim().to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coducktor_core::conversations::TurnCancellation;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn spec() -> AgentRunSpec {
        AgentRunSpec {
            model: Some("provider/model".to_owned()),
            reasoning: Some("exact-variant".to_owned()),
            ..AgentRunSpec::default()
        }
    }

    #[test]
    fn args_use_native_auto_model_reasoning_and_resume_fields() {
        let args = build_opencode_run_args(&spec(), Some("session-1"), "/repo", "exact prompt");
        assert_eq!(
            args,
            [
                "run",
                "--format",
                "json",
                "--auto",
                "--dir",
                "/repo",
                "--model",
                "provider/model",
                "--variant",
                "exact-variant",
                "--session",
                "session-1",
                "exact prompt"
            ]
        );
    }

    #[test]
    fn committed_run_fixture_maps_text_tools_usage_and_session() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let fixture =
            std::fs::read_to_string(root.join("fixtures/opencode/run-json-first-turn.ndjson"))
                .expect("fixture should exist");
        let mut state = RunState::default();
        let mut events = Vec::new();
        for line in fixture.lines() {
            let frame: Value = serde_json::from_str(line).expect("fixture line should parse");
            state
                .handle_frame(&frame, &mut |event| {
                    events.push(event);
                    Ok(())
                })
                .expect("fixture should map");
        }
        assert_eq!(state.session_id.as_deref(), Some("ses_run_json_fixture"));
        assert_eq!(
            state.report(state.session_id.clone()).turn_text,
            "FIRST TURN COMPLETE"
        );
        assert!(events.iter().any(|event| event.event_type == "tool-call"));
        assert!(events.iter().any(|event| event.event_type == "tool-result"));
        assert!(events.iter().any(|event| event.event_type == "text"));
        assert!(events.iter().any(|event| event.event_type == "token-usage"));
    }

    #[test]
    fn malformed_and_unknown_frames_do_not_break_the_turn_mapper() {
        let mut state = RunState::default();
        state
            .handle_frame(
                &serde_json::json!({"type":"future.event","payload":true}),
                &mut |_| Ok(()),
            )
            .expect("unknown frame should be ignored");
        assert!(state.session_id.is_none());
        assert!(state.text_chunks.is_empty());
    }

    fn request(cwd: &std::path::Path, text: &str) -> ConversationTurnRequest {
        ConversationTurnRequest {
            conversation_id: "chat-1".to_owned(),
            turn_id: "turn-1".to_owned(),
            user_text: text.to_owned(),
            images: Vec::new(),
            skill_context: Vec::new(),
            harness: Runner::OpenCode,
            model: Some("provider/model".to_owned()),
            reasoning: Some("exact-variant".to_owned()),
            provider_session_id: None,
            resume: false,
            cwd: cwd.to_path_buf(),
            additional_directories: Vec::new(),
            session_handoff: None,
            cancellation: TurnCancellation::default(),
        }
    }

    #[test]
    fn process_per_turn_transport_resumes_the_discovered_native_session() {
        let dir = tempfile::tempdir().unwrap();
        let args_log = dir.path().join("args.ndjson");
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let config = OpencodeSpawnConfig {
            program: crate::test_node_program(),
            prefix_args: vec![
                root.join("fixtures/opencode/mock-opencode-run.mjs")
                    .to_string_lossy()
                    .into_owned(),
            ],
            ..OpencodeSpawnConfig::default()
        };
        let mut spec = spec();
        spec.cwd = dir.path().to_path_buf();
        spec.env.insert(
            "DUCK_MOCK_ARGS_FILE".to_owned(),
            args_log.to_string_lossy().into_owned(),
        );
        let mut session = OpencodeRunSession::new(config, spec, BTreeMap::new());

        let first = session
            .turn(&request(dir.path(), "first exact prompt"), &mut |_| Ok(()))
            .expect("first native turn should end");
        assert!(matches!(first, TurnOutcome::Ended { .. }));
        assert_eq!(
            session.provider_session_id().as_deref(),
            Some("ses_mock_opencode_run")
        );
        let second = session
            .turn(&request(dir.path(), "second exact prompt"), &mut |_| Ok(()))
            .expect("second native turn should end");
        assert!(matches!(second, TurnOutcome::Ended { .. }));

        let invocations = std::fs::read_to_string(args_log).unwrap();
        let invocations = invocations
            .lines()
            .map(|line| serde_json::from_str::<Vec<String>>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(invocations.len(), 2);
        assert!(!invocations[0].iter().any(|arg| arg == "--session"));
        let session_arg = invocations[1]
            .iter()
            .position(|arg| arg == "--session")
            .expect("follow-up should resume the discovered session");
        assert_eq!(invocations[1][session_arg + 1], "ses_mock_opencode_run");
        assert_eq!(
            invocations[0].last().map(String::as_str),
            Some("first exact prompt")
        );
        assert_eq!(
            invocations[1].last().map(String::as_str),
            Some("second exact prompt")
        );
    }

    fn mock_run_session(cwd: &std::path::Path) -> OpencodeRunSession {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let config = OpencodeSpawnConfig {
            program: crate::test_node_program(),
            prefix_args: vec![
                root.join("fixtures/opencode/mock-opencode-run.mjs")
                    .to_string_lossy()
                    .into_owned(),
            ],
            kill_grace: Duration::from_millis(100),
        };
        let mut spec = spec();
        spec.cwd = cwd.to_path_buf();
        OpencodeRunSession::new(config, spec, BTreeMap::new())
    }

    #[test]
    fn cancellation_terminates_the_process_scoped_turn_promptly() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = mock_run_session(dir.path());
        let request = request(dir.path(), "mock:slow");
        let cancellation = request.cancellation.clone();
        let requester = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            cancellation.request();
        });
        let started = Instant::now();
        let outcome = session
            .turn(&request, &mut |_| Ok(()))
            .expect("cancellation should be a native outcome");
        requester.join().unwrap();
        assert!(matches!(outcome, TurnOutcome::Cancelled { .. }));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn unexpected_permission_under_auto_is_a_recoverable_turn_failure() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = mock_run_session(dir.path());
        let outcome = session
            .turn(&request(dir.path(), "mock:permission"), &mut |_| Ok(()))
            .expect("provider permission should map to a failed outcome");
        assert!(matches!(
            outcome,
            TurnOutcome::Failed { ref message, .. }
                if message.contains("despite --auto")
        ));
    }
}
