use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use coducktor_contract::RunnerSelection;
use coducktor_contract::workflows::{WorkflowDef, WorkflowSource, WorkflowStepDef};
use coducktor_core::workflows::run::{
    AgentSession, EventInput, PromptImage, RunManager, SessionFactory, SessionOutcome,
    SessionReport, SessionRequest, StartRunInput, TurnMarkerDecision, TurnStep,
};

#[derive(Default)]
struct CallCounts {
    opens: AtomicUsize,
    turns: AtomicUsize,
    messages: AtomicUsize,
    structured_answers: AtomicUsize,
    requested_runners: Mutex<Vec<RunnerSelection>>,
}

struct CountingFactory {
    counts: Arc<CallCounts>,
    first: SessionOutcome,
    follow_up: SessionOutcome,
}

impl SessionFactory for CountingFactory {
    fn open(&self, request: SessionRequest) -> Result<Box<dyn AgentSession + Send>, String> {
        self.counts.opens.fetch_add(1, Ordering::SeqCst);
        self.counts
            .requested_runners
            .lock()
            .unwrap()
            .push(request.runner);
        Ok(Box::new(CountingSession {
            counts: self.counts.clone(),
            first: Some(self.first.clone()),
            follow_up: self.follow_up.clone(),
        }))
    }
}

struct CountingSession {
    counts: Arc<CallCounts>,
    first: Option<SessionOutcome>,
    follow_up: SessionOutcome,
}

impl AgentSession for CountingSession {
    fn turn(
        &mut self,
        _on_event: &mut dyn FnMut(EventInput) -> io::Result<()>,
    ) -> Result<SessionOutcome, String> {
        self.counts.turns.fetch_add(1, Ordering::SeqCst);
        self.first
            .take()
            .ok_or_else(|| "provider turn called more than once".to_owned())
    }

    fn send_message(
        &mut self,
        prompt: &str,
        _images: &[PromptImage],
        _on_event: &mut dyn FnMut(EventInput) -> io::Result<()>,
    ) -> Result<SessionOutcome, String> {
        self.counts.messages.fetch_add(1, Ordering::SeqCst);
        if prompt.starts_with("answer:") {
            self.counts
                .structured_answers
                .fetch_add(1, Ordering::SeqCst);
        }
        Ok(self.follow_up.clone())
    }
}

fn workflow() -> WorkflowDef {
    WorkflowDef {
        name: "conversation-boundary".to_owned(),
        description: None,
        steps: vec![WorkflowStepDef {
            id: "turn".to_owned(),
            name: Some("turn".to_owned()),
            prompt: Some("{{task}}".to_owned()),
            skill: None,
            model: None,
            runner: None,
            allowed_tools: None,
            bash_allowlist: None,
            command: None,
            on_fail: None,
        }],
        source: WorkflowSource::BuiltIn,
        path: None,
    }
}

fn terminal_outcome(text: &str) -> SessionOutcome {
    SessionOutcome::Waiting(SessionReport {
        session_id: Some("provider-session".to_owned()),
        turn_text: text.to_owned(),
        ..SessionReport::default()
    })
}

fn input(runner: RunnerSelection) -> StartRunInput {
    StartRunInput {
        task: "exact user message".to_owned(),
        runner: Some(runner),
        // The legacy flag controls Coducktor-owned continuation, not harness permissions.
        // Conversation turns deliberately disable that old behavior.
        autonomous: Some(false),
        git_auto: Some(false),
        ..StartRunInput::default()
    }
}

fn harnesses() -> [RunnerSelection; 4] {
    [
        RunnerSelection::Claude,
        RunnerSelection::Codex,
        RunnerSelection::OpenCode,
        RunnerSelection::Pi,
    ]
}

#[test]
fn every_terminal_response_stops_after_one_provider_turn_for_every_harness() {
    let responses = [
        "Implemented the requested change without a marker.",
        "Which option would you prefer?",
        "The plan is complete.",
        "Stopped because the model reached its token limit.",
        "",
    ];

    for runner in harnesses() {
        for response in responses {
            let dir = tempfile::tempdir().unwrap();
            let counts = Arc::new(CallCounts::default());
            let factory = CountingFactory {
                counts: counts.clone(),
                first: terminal_outcome(response),
                follow_up: terminal_outcome("unexpected automatic follow-up"),
            };
            let mut manager = RunManager::with_session_factory(dir.path(), factory);

            manager.start_run(&workflow(), input(runner)).unwrap();

            assert_eq!(counts.opens.load(Ordering::SeqCst), 1, "{runner:?}");
            assert_eq!(counts.turns.load(Ordering::SeqCst), 1, "{runner:?}");
            assert_eq!(
                counts.messages.load(Ordering::SeqCst),
                0,
                "{runner:?}: {response:?}"
            );
            assert_eq!(
                counts.requested_runners.lock().unwrap().as_slice(),
                &[runner]
            );
        }
    }
}

#[test]
fn second_user_message_is_exactly_one_follow_up_on_the_same_live_session() {
    for runner in harnesses() {
        let dir = tempfile::tempdir().unwrap();
        let counts = Arc::new(CallCounts::default());
        let factory = CountingFactory {
            counts: counts.clone(),
            first: terminal_outcome("first response"),
            follow_up: terminal_outcome("second response"),
        };
        let mut manager = RunManager::with_session_factory(dir.path(), factory);
        let run = manager.start_run(&workflow(), input(runner)).unwrap();

        let mut active = manager
            .begin_message(&run.id, "exact second user message", Vec::new())
            .unwrap()
            .unwrap();
        let result =
            active
                .session_mut()
                .send_message("exact second user message", &[], &mut |_| Ok(()));
        let next = manager
            .apply_active_turn(&run.id, active, result, false)
            .unwrap();

        assert!(matches!(next, TurnStep::Done));
        assert_eq!(counts.opens.load(Ordering::SeqCst), 1, "{runner:?}");
        assert_eq!(counts.turns.load(Ordering::SeqCst), 1, "{runner:?}");
        assert_eq!(counts.messages.load(Ordering::SeqCst), 1, "{runner:?}");
    }
}

#[test]
fn structured_answer_is_the_only_non_user_turn_response_call() {
    let dir = tempfile::tempdir().unwrap();
    let counts = Arc::new(CallCounts::default());
    let factory = CountingFactory {
        counts: counts.clone(),
        first: SessionOutcome::Waiting(SessionReport {
            decision: Some(TurnMarkerDecision::Ask),
            turn_text: "Choose a library".to_owned(),
            ..SessionReport::default()
        }),
        follow_up: terminal_outcome("answer accepted"),
    };
    let mut manager = RunManager::with_session_factory(dir.path(), factory);
    let run = manager
        .start_run(&workflow(), input(RunnerSelection::Codex))
        .unwrap();

    let mut active = manager
        .begin_message(&run.id, "answer:vitest", Vec::new())
        .unwrap()
        .unwrap();
    let result = active
        .session_mut()
        .send_message("answer:vitest", &[], &mut |_| Ok(()));
    let next = manager
        .apply_active_turn(&run.id, active, result, false)
        .unwrap();

    assert!(matches!(next, TurnStep::Done));
    assert_eq!(counts.opens.load(Ordering::SeqCst), 1);
    assert_eq!(counts.turns.load(Ordering::SeqCst), 1);
    assert_eq!(counts.messages.load(Ordering::SeqCst), 1);
    assert_eq!(counts.structured_answers.load(Ordering::SeqCst), 1);
}
