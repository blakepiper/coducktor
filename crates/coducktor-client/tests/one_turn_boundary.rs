//! The one-message/one-turn invariant, proved against the live conversation runtime.
//!
//! This is the guardrail behind acceptance criterion 2: an ordinary user submission must produce
//! exactly one native provider turn on every harness, and nothing Coducktor does — not prose that
//! looks finished, not a question in prose, not an empty response, not a structured answer — may
//! schedule a second one. The counting factory below fails the moment any hidden reprompt path
//! reappears.

use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use coducktor_client::{InProcessEngine, Scope};
use coducktor_contract::ConversationQuestionAnswer;
use coducktor_contract::{
    AnswerConversationQuestionInput, ConversationGitMode, ConversationState,
    CreateConversationInput, Runner, SubmitConversationMessageInput,
};
use coducktor_core::conversations::{
    ConversationEventInput, ConversationSession, ConversationSessionFactory,
    ConversationTurnRequest, PendingQuestion, PendingRequest, TurnCancellation, TurnOutcome,
    TurnReport,
};
use tempfile::TempDir;

#[derive(Default)]
struct Counts {
    opens: AtomicUsize,
    turns: AtomicUsize,
    answers: AtomicUsize,
}

/// Replies with one scripted text per turn and then counts every further provider call. `ask`
/// makes the first turn end on a native structured question instead of ordinary text.
struct CountingFactory {
    counts: Arc<Counts>,
    text: String,
    ask: bool,
}

impl ConversationSessionFactory for CountingFactory {
    fn open(
        &self,
        _request: &ConversationTurnRequest,
    ) -> Result<Box<dyn ConversationSession + Send>, String> {
        self.counts.opens.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(CountingSession {
            counts: self.counts.clone(),
            text: self.text.clone(),
            ask: self.ask,
        }))
    }
}

struct CountingSession {
    counts: Arc<Counts>,
    text: String,
    ask: bool,
}

fn report() -> TurnReport {
    TurnReport {
        provider_session_id: Some("counted-session".to_owned()),
        ..TurnReport::default()
    }
}

impl ConversationSession for CountingSession {
    fn turn(
        &mut self,
        _request: &ConversationTurnRequest,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        let turn = self.counts.turns.fetch_add(1, Ordering::SeqCst);
        on_event(ConversationEventInput::new("assistant-message").field("text", &self.text))
            .map_err(|error| error.to_string())?;
        if self.ask && turn == 0 {
            return Ok(TurnOutcome::NeedsInput {
                report: TurnReport {
                    turn_text: self.text.clone(),
                    ..report()
                },
                pending_request: PendingRequest {
                    request_id: "req-1".to_owned(),
                    questions: vec![PendingQuestion {
                        id: "q-1".to_owned(),
                        prompt: "Choose a library".to_owned(),
                        choices: vec!["vitest".to_owned(), "jest".to_owned()],
                        multiple: false,
                        allow_free_form: false,
                    }],
                },
            });
        }
        Ok(TurnOutcome::Ended {
            report: TurnReport {
                turn_text: self.text.clone(),
                ..report()
            },
            session_open: true,
        })
    }

    fn answer(
        &mut self,
        _request_id: &str,
        _answers: &[ConversationQuestionAnswer],
        _cancellation: &TurnCancellation,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        self.counts.answers.fetch_add(1, Ordering::SeqCst);
        on_event(ConversationEventInput::new("assistant-message").field("text", "answer accepted"))
            .map_err(|error| error.to_string())?;
        Ok(TurnOutcome::Ended {
            report: TurnReport {
                turn_text: "answer accepted".to_owned(),
                ..report()
            },
            session_open: true,
        })
    }

    fn provider_session_id(&self) -> Option<String> {
        Some("counted-session".to_owned())
    }
}

fn harnesses() -> [Runner; 5] {
    [
        Runner::Claude,
        Runner::Codex,
        Runner::OpenCode,
        Runner::Pi,
        Runner::Omp,
    ]
}

fn create_input(text: &str, harness: Runner) -> CreateConversationInput {
    CreateConversationInput {
        project_id: String::new(),
        text: text.to_owned(),
        images: Vec::new(),
        skills: Vec::new(),
        harness,
        model: None,
        reasoning: None,
        base_branch: None,
        worktree: false,
        git_mode: ConversationGitMode::Manual,
    }
}

fn engine(repo: &TempDir, workspace: &TempDir, factory: CountingFactory) -> Arc<InProcessEngine> {
    Arc::new(
        InProcessEngine::at(
            repo.path(),
            "0.0.0-one-turn-test",
            workspace.path().join("config.json"),
        )
        .with_conversation_factory(factory),
    )
}

/// `NeedsInput` counts as active, so a question has to be waited for by name.
async fn wait_for_needs_input(engine: &InProcessEngine, scope: &Scope, id: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let state = engine.get_conversation(scope, id).await.unwrap().state;
            if state == ConversationState::NeedsInput {
                return;
            }
            assert!(
                state.is_active(),
                "the conversation settled to {state:?} instead of asking its question"
            );
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the conversation should ask its question");
}

async fn wait_for_settled(engine: &InProcessEngine, scope: &Scope, id: &str) -> ConversationState {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let state = engine.get_conversation(scope, id).await.unwrap().state;
            if !state.is_active() {
                return state;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the conversation should settle")
}

#[tokio::test]
async fn every_terminal_response_stops_after_one_provider_turn_for_every_harness() {
    // Each of these once had, or could plausibly regrow, a "keep going" interpretation:
    // markerless prose, a question asked only in prose, a completed plan, a truncated turn, and
    // an empty final message. None of them may produce a second provider call.
    let responses = [
        "Implemented the requested change without a marker.",
        "Which option would you prefer?",
        "The plan is complete.",
        "Stopped because the model reached its token limit.",
        "",
    ];

    for harness in harnesses() {
        for response in responses {
            let workspace = TempDir::new().unwrap();
            let repo = TempDir::new().unwrap();
            let counts = Arc::new(Counts::default());
            let engine = engine(
                &repo,
                &workspace,
                CountingFactory {
                    counts: counts.clone(),
                    text: response.to_owned(),
                    ask: false,
                },
            );
            let scope = Scope::Workspace;
            let created = engine
                .create_conversation(&scope, create_input("do the thing", harness))
                .await
                .unwrap();
            let id = created.conversation.id.clone();
            engine.activate_conversations(&scope).unwrap();
            wait_for_settled(&engine, &scope, &id).await;

            assert_eq!(
                counts.opens.load(Ordering::SeqCst),
                1,
                "{harness:?} opened more than one session for {response:?}"
            );
            assert_eq!(
                counts.turns.load(Ordering::SeqCst),
                1,
                "{harness:?} took more than one turn for {response:?}"
            );
            assert_eq!(
                counts.answers.load(Ordering::SeqCst),
                0,
                "{harness:?} answered a question nobody asked for {response:?}"
            );
        }
    }
}

#[tokio::test]
async fn a_second_user_message_is_exactly_one_more_turn_on_the_same_session() {
    for harness in harnesses() {
        let workspace = TempDir::new().unwrap();
        let repo = TempDir::new().unwrap();
        let counts = Arc::new(Counts::default());
        let engine = engine(
            &repo,
            &workspace,
            CountingFactory {
                counts: counts.clone(),
                text: "first response".to_owned(),
                ask: false,
            },
        );
        let scope = Scope::Workspace;
        let created = engine
            .create_conversation(&scope, create_input("first message", harness))
            .await
            .unwrap();
        let id = created.conversation.id.clone();
        engine.activate_conversations(&scope).unwrap();
        wait_for_settled(&engine, &scope, &id).await;

        engine
            .submit_conversation_message(
                &scope,
                &id,
                SubmitConversationMessageInput {
                    text: "exact second user message".to_owned(),
                    images: Vec::new(),
                    skills: Vec::new(),
                },
            )
            .await
            .unwrap();
        wait_for_settled(&engine, &scope, &id).await;

        assert_eq!(
            counts.turns.load(Ordering::SeqCst),
            2,
            "{harness:?}: two user messages must be exactly two provider turns"
        );
        assert_eq!(
            counts.opens.load(Ordering::SeqCst),
            1,
            "{harness:?}: the second turn must reuse the retained session"
        );
    }
}

#[tokio::test]
async fn a_structured_answer_is_not_another_ordinary_turn() {
    let workspace = TempDir::new().unwrap();
    let repo = TempDir::new().unwrap();
    let counts = Arc::new(Counts::default());
    let engine = engine(
        &repo,
        &workspace,
        CountingFactory {
            counts: counts.clone(),
            text: "Choose a library".to_owned(),
            ask: true,
        },
    );
    let scope = Scope::Workspace;
    let created = engine
        .create_conversation(&scope, create_input("pick a test runner", Runner::Codex))
        .await
        .unwrap();
    let id = created.conversation.id.clone();
    engine.activate_conversations(&scope).unwrap();
    wait_for_needs_input(&engine, &scope, &id).await;

    engine
        .answer_conversation_question(
            &scope,
            &id,
            AnswerConversationQuestionInput {
                request_id: "req-1".to_owned(),
                answers: vec![ConversationQuestionAnswer {
                    question_id: "q-1".to_owned(),
                    values: vec!["vitest".to_owned()],
                }],
            },
        )
        .await
        .unwrap();
    wait_for_settled(&engine, &scope, &id).await;

    assert_eq!(counts.opens.load(Ordering::SeqCst), 1);
    assert_eq!(
        counts.turns.load(Ordering::SeqCst),
        1,
        "answering a native question must not start another ordinary turn"
    );
    assert_eq!(counts.answers.load(Ordering::SeqCst), 1);
}
