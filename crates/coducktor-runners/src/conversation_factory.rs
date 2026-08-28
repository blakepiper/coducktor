//! Conversation-native runner seam over the four concrete harness transports.
//!
//! The compatibility workflow factory remains available while legacy task records are readable.
//! This factory accepts only a concrete conversation turn, selects the harness directly, uses its
//! autonomous permission preset, and converts provider return into marker-free turn outcomes.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use coducktor_contract::{
    ConversationQuestionAnswer, ConversationSkillAttachment, ImageInput, Runner,
};
use coducktor_core::agent_session::{
    AgentSession, EventInput, PromptImage, SessionOutcome, SessionReport,
};
use coducktor_core::conversations::{
    ConversationEventInput, ConversationSession, ConversationSessionFactory,
    ConversationTurnRequest, PendingQuestion, PendingRequest, TurnOutcome, TurnReport,
};
use coducktor_core::skills::{BUILT_IN_PLANNING_SKILL_BODY, read_skill_body};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

use crate::agent_runner::{AgentRunSpec, ContentBlock, ImageSource, prepend_system_prompt};
use crate::claude_runner;
use crate::omp_runner;
use crate::opencode_run::OpencodeRunSession;
use crate::session_factory::DefaultSessionFactory;
use crate::{codex_runner, pi_runner};

const MAX_SKILLS_PER_TURN: usize = 8;
const MAX_SKILL_CONTEXT_BYTES: usize = 64 * 1024;

struct ConversationAgentSession {
    inner: Box<dyn AgentSession + Send>,
    cancellation: crate::agent_runner::AgentCancellation,
    opening_turn: bool,
    pending_request: Option<PendingRequest>,
    pending_headers: HashMap<String, String>,
}

impl ConversationAgentSession {
    fn new(
        inner: Box<dyn AgentSession + Send>,
        cancellation: crate::agent_runner::AgentCancellation,
    ) -> Self {
        Self {
            inner,
            cancellation,
            opening_turn: true,
            pending_request: None,
            pending_headers: HashMap::new(),
        }
    }

    fn run(
        &mut self,
        request: &ConversationTurnRequest,
        on_event: &mut dyn FnMut(ConversationEventInput) -> std::io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        self.cancellation
            .replace_conversation(request.cancellation.clone());
        let mut captured = None;
        let result = if self.opening_turn {
            self.opening_turn = false;
            self.inner
                .turn(&mut |event| forward_event(event, &mut captured, on_event))
        } else {
            let images = prompt_images(&request.images);
            let context = provider_turn_context(request)?;
            let provider_prompt = prepend_system_prompt(context.as_deref(), &request.user_text);
            self.inner
                .send_message(&provider_prompt, &images, &mut |event| {
                    forward_event(event, &mut captured, on_event)
                })
        };
        if let Some((pending, headers)) = captured {
            self.pending_request = Some(pending);
            self.pending_headers = headers;
        }
        convert_outcome(
            result,
            self.pending_request.clone(),
            request.cancellation.is_requested(),
            self.inner.session_id(),
            self.inner.model_identity(),
        )
    }
}

impl ConversationSession for ConversationAgentSession {
    fn turn(
        &mut self,
        request: &ConversationTurnRequest,
        on_event: &mut dyn FnMut(ConversationEventInput) -> std::io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        self.run(request, on_event)
    }

    fn answer(
        &mut self,
        request_id: &str,
        answers: &[ConversationQuestionAnswer],
        cancellation: &coducktor_core::conversations::TurnCancellation,
        on_event: &mut dyn FnMut(ConversationEventInput) -> std::io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        let Some(pending) = self.pending_request.as_ref() else {
            return Err("the provider session has no pending structured question".to_owned());
        };
        if pending.request_id != request_id {
            return Err("the provider question request id does not match".to_owned());
        }
        let text = answers
            .iter()
            .map(|answer| {
                let header = self
                    .pending_headers
                    .get(&answer.question_id)
                    .map(String::as_str)
                    .unwrap_or(answer.question_id.as_str());
                format!("{header}: {}", answer.values.join(", "))
            })
            .collect::<Vec<_>>()
            .join("\n");
        self.pending_request = None;
        self.pending_headers.clear();
        self.cancellation.replace_conversation(cancellation.clone());
        let mut captured = None;
        let result = self.inner.send_message(&text, &[], &mut |event| {
            forward_event(event, &mut captured, on_event)
        });
        if let Some((pending, headers)) = captured {
            self.pending_request = Some(pending);
            self.pending_headers = headers;
        }
        convert_outcome(
            result,
            self.pending_request.clone(),
            cancellation.is_requested(),
            self.inner.session_id(),
            self.inner.model_identity(),
        )
    }

    fn cancel(&mut self) {
        self.inner.cancel();
    }

    fn provider_session_id(&self) -> Option<String> {
        self.inner.session_id()
    }
}

fn forward_event(
    event: EventInput,
    captured: &mut Option<(PendingRequest, HashMap<String, String>)>,
    on_event: &mut dyn FnMut(ConversationEventInput) -> std::io::Result<()>,
) -> std::io::Result<()> {
    if event.event_type == "ask.requested"
        && let Some(parsed) = pending_request_from_event(&event)
    {
        *captured = Some(parsed);
        return Ok(());
    }
    on_event(ConversationEventInput {
        event_type: event.event_type,
        extra: event.extra,
    })
}

fn pending_request_from_event(
    event: &EventInput,
) -> Option<(PendingRequest, HashMap<String, String>)> {
    let request_id = match event.extra.get("requestId")? {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        _ => return None,
    };
    let raw_questions = event.extra.get("questions")?.as_array()?;
    if raw_questions.is_empty() {
        return None;
    }
    let mut questions = Vec::with_capacity(raw_questions.len());
    let mut headers = HashMap::new();
    for (index, raw) in raw_questions.iter().enumerate() {
        let question = raw.as_object()?;
        let id = question
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| index.to_string());
        let header = question
            .get("header")
            .and_then(Value::as_str)
            .unwrap_or(id.as_str())
            .to_owned();
        let prompt = question
            .get("question")
            .or_else(|| question.get("prompt"))
            .and_then(Value::as_str)?
            .to_owned();
        let choices = question
            .get("options")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|option| {
                option
                    .as_str()
                    .or_else(|| option.get("label").and_then(Value::as_str))
                    .map(str::to_owned)
            })
            .collect();
        headers.insert(id.clone(), header);
        questions.push(PendingQuestion {
            id,
            prompt,
            choices,
            multiple: question
                .get("multiSelect")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            allow_free_form: true,
        });
    }
    Some((
        PendingRequest {
            request_id,
            questions,
        },
        headers,
    ))
}

fn convert_outcome(
    result: Result<SessionOutcome, String>,
    pending: Option<PendingRequest>,
    cancellation_requested: bool,
    session_id: Option<String>,
    model_identity: Option<String>,
) -> Result<TurnOutcome, String> {
    let outcome = result?;
    let report = match &outcome {
        SessionOutcome::Completed(report)
        | SessionOutcome::Running(report)
        | SessionOutcome::Waiting(report)
        | SessionOutcome::Cancelled(report) => turn_report(report, session_id, model_identity),
        SessionOutcome::Failed { report, .. } => turn_report(report, session_id, model_identity),
    };
    if cancellation_requested || matches!(outcome, SessionOutcome::Cancelled(_)) {
        return Ok(TurnOutcome::Cancelled {
            report,
            session_open: false,
        });
    }
    if let Some(pending_request) = pending {
        return Ok(TurnOutcome::NeedsInput {
            report,
            pending_request,
        });
    }
    match outcome {
        SessionOutcome::Failed { message, .. } => Ok(TurnOutcome::Failed {
            message,
            report,
            session_open: false,
        }),
        SessionOutcome::Completed(_)
        | SessionOutcome::Running(_)
        | SessionOutcome::Waiting(_)
        | SessionOutcome::Cancelled(_) => Ok(TurnOutcome::Ended {
            report,
            session_open: true,
        }),
    }
}

fn turn_report(
    report: &SessionReport,
    fallback_session_id: Option<String>,
    model_identity: Option<String>,
) -> TurnReport {
    TurnReport {
        provider_session_id: report.session_id.clone().or(fallback_session_id),
        model_identity,
        tokens_used: report.tokens_used,
        input_tokens: report.input_tokens,
        output_tokens: report.output_tokens,
        cost_usd: report.cost_usd,
        turn_text: report.turn_text.clone(),
    }
}

fn prompt_images(images: &[ImageInput]) -> Vec<PromptImage> {
    images
        .iter()
        .map(|image| PromptImage {
            media_type: image.media_type.clone(),
            data: image.data.clone(),
        })
        .collect()
}

fn content_blocks(images: &[ImageInput]) -> Vec<ContentBlock> {
    images
        .iter()
        .map(|image| ContentBlock::Image {
            source: ImageSource {
                kind: "base64".to_owned(),
                media_type: image.media_type.clone(),
                data: image.data.clone(),
            },
        })
        .collect()
}

fn skill_body(attachment: &ConversationSkillAttachment, cwd: &Path) -> Result<String, String> {
    if attachment.path == "builtin:planning" {
        return Ok(BUILT_IN_PLANNING_SKILL_BODY.to_owned());
    }
    let path = PathBuf::from(&attachment.path);
    let path = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    read_skill_body(&path)
        .map_err(|error| format!("skill {:?} could not be read: {error}", attachment.name))
}

fn sha256(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("sha256:{hex}")
}

pub(crate) fn provider_skill_context(
    attachments: &[ConversationSkillAttachment],
    cwd: &Path,
) -> Result<Option<String>, String> {
    if attachments.is_empty() {
        return Ok(None);
    }
    if attachments.len() > MAX_SKILLS_PER_TURN {
        return Err(format!(
            "at most {MAX_SKILLS_PER_TURN} skills may be attached to one turn"
        ));
    }
    let mut total = 0;
    let mut context = String::from(
        "The following local skills are provider-only instructions selected by the user. Apply them to this turn.\n<coducktor-skill-context>",
    );
    for attachment in attachments {
        let body = skill_body(attachment, cwd)?;
        total += body.len();
        if total > MAX_SKILL_CONTEXT_BYTES {
            return Err(format!(
                "attached skill content exceeds {MAX_SKILL_CONTEXT_BYTES} bytes"
            ));
        }
        let actual_hash = sha256(&body);
        if !attachment.content_hash.is_empty() && attachment.content_hash != actual_hash {
            return Err(format!(
                "skill {:?} changed since it was selected",
                attachment.name
            ));
        }
        context.push_str("\n<skill name=");
        context
            .push_str(&serde_json::to_string(&attachment.name).map_err(|error| error.to_string())?);
        context.push_str(">\n");
        context.push_str(&body);
        context.push_str("\n</skill>");
    }
    context.push_str("\n</coducktor-skill-context>");
    Ok(Some(context))
}

/// All provider-only context for one turn: the session handoff a restart still owes, then this
/// turn's skill attachments. Both are delimited blocks the harness sees and the transcript does
/// not — the user's own message is never rewritten.
///
/// Handoff first because it is history the rest reads against; skills last because they are
/// instructions for the turn about to happen.
pub(crate) fn provider_turn_context(
    request: &ConversationTurnRequest,
) -> Result<Option<String>, String> {
    let skills = provider_skill_context(&request.skill_context, &request.cwd)?;
    Ok(match (request.session_handoff.as_deref(), skills) {
        (None, skills) => skills,
        (Some(handoff), None) => Some(handoff.to_owned()),
        (Some(handoff), Some(skills)) => Some(format!("{handoff}\n\n{skills}")),
    })
}

fn to_agent_run_spec(request: &ConversationTurnRequest) -> Result<AgentRunSpec, String> {
    Ok(AgentRunSpec {
        cancellation: request.cancellation.clone().into(),
        system_prompt: provider_turn_context(request)?,
        user_prompt: request.user_text.clone(),
        images: content_blocks(&request.images),
        cwd: request.cwd.clone(),
        additional_directories: request
            .additional_directories
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        env: BTreeMap::new(),
        model: request.model.clone(),
        reasoning: request.reasoning.clone(),
        session_id: request.provider_session_id.clone(),
        resume: request.resume,
    })
}

impl ConversationSessionFactory for DefaultSessionFactory {
    fn open(
        &self,
        request: &ConversationTurnRequest,
    ) -> Result<Box<dyn ConversationSession + Send>, String> {
        let spec = to_agent_run_spec(request)?;
        if request.harness == Runner::OpenCode {
            return Ok(Box::new(OpencodeRunSession::new(
                self.opencode_config(),
                spec,
                self.host_env().clone(),
            )));
        }
        let cancellation = spec.cancellation.clone();
        let inner: Box<dyn AgentSession + Send> = match request.harness {
            Runner::Claude => Box::new(claude_runner::open_claude_session(
                &self.claude_config(&request.cwd),
                &spec,
                self.host_env(),
            )?),
            Runner::Codex => Box::new(codex_runner::open_codex_session(
                &self.codex_config(),
                spec,
                self.host_env(),
            )?),
            Runner::Pi => Box::new(pi_runner::open_pi_session(
                &self.pi_config(&request.cwd),
                &spec,
                self.host_env(),
            )?),
            Runner::Omp => Box::new(omp_runner::open_omp_session(
                &self.omp_config(&request.cwd),
                &spec,
                self.host_env(),
            )?),
            Runner::OpenCode => unreachable!("OpenCode returned above"),
        };
        Ok(Box::new(ConversationAgentSession::new(inner, cancellation)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coducktor_core::agent_session::{SessionReport, TurnMarkerDecision};
    use std::sync::{Arc, Mutex};

    struct FakeSession {
        outcomes: Vec<SessionOutcome>,
        prompts: Vec<String>,
    }

    impl AgentSession for FakeSession {
        fn turn(
            &mut self,
            _on_event: &mut dyn FnMut(EventInput) -> std::io::Result<()>,
        ) -> Result<SessionOutcome, String> {
            Ok(self.outcomes.remove(0))
        }

        fn send_message(
            &mut self,
            prompt: &str,
            _images: &[PromptImage],
            _on_event: &mut dyn FnMut(EventInput) -> std::io::Result<()>,
        ) -> Result<SessionOutcome, String> {
            self.prompts.push(prompt.to_owned());
            Ok(self.outcomes.remove(0))
        }

        fn session_id(&self) -> Option<String> {
            Some("session-1".to_owned())
        }
    }

    fn marker_outcome(decision: TurnMarkerDecision, text: &str) -> SessionOutcome {
        SessionOutcome::Waiting(SessionReport {
            turn_text: text.to_owned(),
            decision: Some(decision),
            ..SessionReport::default()
        })
    }

    #[test]
    fn markerless_questions_and_marker_decisions_all_end_without_an_automatic_turn() {
        for (decision, text) in [
            (TurnMarkerDecision::Idle, "What should I do next?"),
            (TurnMarkerDecision::Done, "DUCK:DONE"),
            (TurnMarkerDecision::Monitoring, "DUCK:MONITORING"),
        ] {
            let cancellation = crate::agent_runner::AgentCancellation::from(
                coducktor_core::conversations::TurnCancellation::default(),
            );
            let mut session = ConversationAgentSession::new(
                Box::new(FakeSession {
                    outcomes: vec![marker_outcome(decision, text)],
                    prompts: Vec::new(),
                }),
                cancellation,
            );
            let outcome = session
                .run(&request(), &mut |_| Ok(()))
                .expect("turn should settle");
            assert!(matches!(outcome, TurnOutcome::Ended { .. }));
        }
    }

    fn request() -> ConversationTurnRequest {
        ConversationTurnRequest {
            conversation_id: "chat-1".to_owned(),
            turn_id: "turn-1".to_owned(),
            user_text: "exact user message".to_owned(),
            images: Vec::new(),
            skill_context: Vec::new(),
            harness: Runner::Claude,
            model: None,
            reasoning: None,
            provider_session_id: None,
            resume: false,
            cwd: PathBuf::from("/repo"),
            additional_directories: Vec::new(),
            session_handoff: None,
            cancellation: Default::default(),
        }
    }

    fn request_in(cwd: &Path, harness: Runner, text: &str) -> ConversationTurnRequest {
        let mut request = request();
        request.cwd = cwd.to_path_buf();
        request.harness = harness;
        request.user_text = text.to_owned();
        request
    }

    #[test]
    fn the_exact_reasoning_value_reaches_the_spawn_spec_untranslated() {
        let mut request = request();
        request.reasoning = Some("provider-native-value".to_owned());
        let spec = to_agent_run_spec(&request).expect("spec should build");
        assert_eq!(spec.user_prompt, "exact user message");
        assert_eq!(spec.reasoning.as_deref(), Some("provider-native-value"));
    }

    #[test]
    fn skill_body_is_provider_only_bounded_and_hash_checked() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("SKILL.md");
        std::fs::write(
            &path,
            "---\nname: focused\ndescription: metadata only\n---\nExact skill instructions.\n",
        )
        .unwrap();
        let body = "Exact skill instructions.\n";
        let mut request = request_in(dir.path(), Runner::Claude, "visible exact prompt");
        request.skill_context = vec![ConversationSkillAttachment {
            id: "skill-1".to_owned(),
            name: "focused".to_owned(),
            source: coducktor_contract::SkillSource::Agents,
            path: path.to_string_lossy().into_owned(),
            content_hash: sha256(body),
            extra: Default::default(),
        }];

        let spec = to_agent_run_spec(&request).expect("unchanged skill should resolve");
        assert_eq!(spec.user_prompt, "visible exact prompt");
        let provider_context = spec
            .system_prompt
            .expect("skill context should be attached");
        assert!(provider_context.contains(body));
        assert!(!provider_context.contains("description: metadata only"));

        std::fs::write(&path, "changed instructions").unwrap();
        assert!(
            to_agent_run_spec(&request)
                .is_err_and(|error| error.contains("changed since it was selected"))
        );
    }

    struct AskingSession {
        answers: Arc<Mutex<Vec<String>>>,
    }

    impl AgentSession for AskingSession {
        fn turn(
            &mut self,
            on_event: &mut dyn FnMut(EventInput) -> std::io::Result<()>,
        ) -> Result<SessionOutcome, String> {
            on_event(
                EventInput::new("ask.requested")
                    .field("requestId", "request-1")
                    .field(
                        "questions",
                        serde_json::json!([{
                            "id": "library",
                            "header": "Library",
                            "question": "Which library?",
                            "options": [{"label":"Vitest"},{"label":"Jest"}],
                            "multiSelect": false
                        }]),
                    ),
            )
            .map_err(|error| error.to_string())?;
            Ok(SessionOutcome::Waiting(SessionReport::default()))
        }

        fn send_message(
            &mut self,
            prompt: &str,
            _images: &[PromptImage],
            _on_event: &mut dyn FnMut(EventInput) -> std::io::Result<()>,
        ) -> Result<SessionOutcome, String> {
            self.answers.lock().unwrap().push(prompt.to_owned());
            Ok(SessionOutcome::Waiting(SessionReport::default()))
        }
    }

    #[test]
    fn native_question_answer_uses_the_pending_rpc_instead_of_an_ordinary_turn() {
        let answers = Arc::new(Mutex::new(Vec::new()));
        let cancellation = crate::agent_runner::AgentCancellation::from(
            coducktor_core::conversations::TurnCancellation::default(),
        );
        let mut session = ConversationAgentSession::new(
            Box::new(AskingSession {
                answers: answers.clone(),
            }),
            cancellation,
        );
        let outcome = session
            .turn(&request(), &mut |_| Ok(()))
            .expect("question should park");
        assert!(matches!(outcome, TurnOutcome::NeedsInput { .. }));
        let answer_cancellation = coducktor_core::conversations::TurnCancellation::default();
        let outcome = session
            .answer(
                "request-1",
                &[ConversationQuestionAnswer {
                    question_id: "library".to_owned(),
                    values: vec!["Vitest".to_owned()],
                }],
                &answer_cancellation,
                &mut |_| Ok(()),
            )
            .expect("answer should continue the pending provider turn");
        assert!(matches!(outcome, TurnOutcome::Ended { .. }));
        assert_eq!(answers.lock().unwrap().as_slice(), ["Library: Vitest"]);
    }

    #[test]
    fn all_five_harness_transports_complete_two_marker_free_conversation_turns() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut env = BTreeMap::from([
            (
                "DUCK_CLAUDE_BIN".to_owned(),
                root.join("fixtures/scripts/mock-claude.mjs")
                    .to_string_lossy()
                    .into_owned(),
            ),
            (
                "DUCK_CODEX_BIN".to_owned(),
                root.join("fixtures/codex/mock-codex-app-server.mjs")
                    .to_string_lossy()
                    .into_owned(),
            ),
            (
                "DUCK_OPENCODE_BIN".to_owned(),
                root.join("fixtures/opencode/mock-opencode-run.mjs")
                    .to_string_lossy()
                    .into_owned(),
            ),
            (
                "DUCK_PI_BIN".to_owned(),
                root.join("fixtures/scripts/mock-pi-rpc.mjs")
                    .to_string_lossy()
                    .into_owned(),
            ),
            (
                "DUCK_OMP_BIN".to_owned(),
                root.join("fixtures/scripts/mock-pi-rpc.mjs")
                    .to_string_lossy()
                    .into_owned(),
            ),
        ]);
        if let Ok(path) = std::env::var("PATH") {
            env.insert("PATH".to_owned(), path);
        }
        let factory = DefaultSessionFactory::with_env(env);
        let dir = tempfile::tempdir().unwrap();

        for harness in [
            Runner::Claude,
            Runner::Codex,
            Runner::OpenCode,
            Runner::Pi,
            Runner::Omp,
        ] {
            let mut first = request_in(dir.path(), harness, "first exact conversation prompt");
            let mut session = ConversationSessionFactory::open(&factory, &first)
                .unwrap_or_else(|error| panic!("{harness:?} should open: {error}"));
            let first_outcome = session
                .turn(&first, &mut |_| Ok(()))
                .unwrap_or_else(|error| panic!("{harness:?} first turn failed: {error}"));
            assert!(
                matches!(first_outcome, TurnOutcome::Ended { .. }),
                "unexpected {harness:?} first outcome: {first_outcome:?}"
            );

            first.turn_id = "turn-2".to_owned();
            first.user_text = "second exact conversation prompt".to_owned();
            let second_outcome = session
                .turn(&first, &mut |_| Ok(()))
                .unwrap_or_else(|error| panic!("{harness:?} second turn failed: {error}"));
            assert!(
                matches!(second_outcome, TurnOutcome::Ended { .. }),
                "unexpected {harness:?} second outcome: {second_outcome:?}"
            );
        }
    }
}
