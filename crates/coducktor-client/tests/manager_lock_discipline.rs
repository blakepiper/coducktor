use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use coducktor_client::{InProcessEngine, Scope};
use coducktor_contract::{
    ConversationGitMode, ConversationQuestionAnswer, CreateConversationInput, CreateRunInput,
    CreateRunResponse, MessageInput, RunStatus, Runner, UpdateConversationGitModeInput,
    WorkflowStepDef,
};
use coducktor_core::workflows::run::{
    AgentSession, EventInput, PromptImage, SessionFactory, SessionOutcome, SessionReport,
    SessionRequest, TurnMarkerDecision,
};
use tempfile::TempDir;

#[derive(Default)]
struct SlowCalls {
    sending: AtomicBool,
    finishing: AtomicBool,
}

struct SlowSession {
    calls: Arc<SlowCalls>,
}

impl SlowSession {
    fn parked() -> SessionOutcome {
        SessionOutcome::Waiting(SessionReport {
            session_id: Some("slow-session".to_owned()),
            turn_text: "Waiting for the next turn.".to_owned(),
            decision: Some(TurnMarkerDecision::Waiting),
            ..SessionReport::default()
        })
    }
}

impl AgentSession for SlowSession {
    fn turn(
        &mut self,
        _on_event: &mut dyn FnMut(EventInput) -> io::Result<()>,
    ) -> Result<SessionOutcome, String> {
        Ok(Self::parked())
    }

    fn send_message(
        &mut self,
        _prompt: &str,
        _images: &[PromptImage],
        _on_event: &mut dyn FnMut(EventInput) -> io::Result<()>,
    ) -> Result<SessionOutcome, String> {
        self.calls.sending.store(true, Ordering::Release);
        std::thread::sleep(Duration::from_secs(1));
        Ok(Self::parked())
    }

    fn finish(
        &mut self,
        _on_event: &mut dyn FnMut(EventInput) -> io::Result<()>,
    ) -> Result<SessionOutcome, String> {
        self.calls.finishing.store(true, Ordering::Release);
        std::thread::sleep(Duration::from_secs(1));
        Ok(SessionOutcome::Completed(SessionReport {
            session_id: Some("slow-session".to_owned()),
            turn_text: "Finished.".to_owned(),
            decision: Some(TurnMarkerDecision::Done),
            ..SessionReport::default()
        }))
    }
}

struct SlowFactory {
    calls: Arc<SlowCalls>,
}

impl SessionFactory for SlowFactory {
    fn open(&self, _request: SessionRequest) -> Result<Box<dyn AgentSession + Send>, String> {
        Ok(Box::new(SlowSession {
            calls: self.calls.clone(),
        }))
    }
}

fn run_input() -> CreateRunInput {
    CreateRunInput {
        workflow: None,
        steps: Some(vec![WorkflowStepDef {
            id: "task".to_owned(),
            name: Some("Task".to_owned()),
            prompt: Some("{{task}}".to_owned()),
            skill: None,
            model: None,
            runner: None,
            allowed_tools: None,
            bash_allowlist: None,
            command: None,
            on_fail: None,
        }]),
        task: "exercise manager lock discipline".to_owned(),
        model: None,
        reasoning_effort: None,
        runner: None,
        agent_profile: None,
        variants: None,
        worktree: Some(false),
        autonomous: None,
        git_auto: None,
        system_prompt: None,
        images: None,
    }
}

async fn parked_engine() -> (
    TempDir,
    TempDir,
    Arc<InProcessEngine>,
    String,
    Arc<SlowCalls>,
) {
    let workspace = TempDir::new().unwrap();
    let repo = TempDir::new().unwrap();
    let calls = Arc::new(SlowCalls::default());
    let engine = Arc::new(InProcessEngine::with_session_factory_at(
        repo.path(),
        "0.0.0-lock-test",
        SlowFactory {
            calls: calls.clone(),
        },
        workspace.path().join("config.json"),
    ));
    let CreateRunResponse::Single(run) = engine.start_run(run_input()).await.unwrap() else {
        panic!("expected one run");
    };
    engine.activate_runs().unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if engine.get_run(&run.id).await.unwrap().record.status == RunStatus::Waiting {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (workspace, repo, engine, run.id, calls)
}

async fn wait_for_call(flag: &AtomicBool) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !flag.load(Ordering::Acquire) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

async fn wait_for_terminal(engine: &InProcessEngine, run_id: &str) {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let status = engine.get_run(run_id).await.unwrap().record.status;
            if matches!(
                status,
                RunStatus::Done | RunStatus::Failed | RunStatus::Cancelled | RunStatus::Review
            ) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

async fn probe_manager_calls(engine: Arc<InProcessEngine>, run_id: String) -> bool {
    let history_engine = engine.clone();
    let history_id = run_id.clone();
    let history = tokio::spawn(async move {
        let started = Instant::now();
        let _ = history_engine.run_history(&history_id, None).await;
        started.elapsed()
    });
    let list_engine = engine.clone();
    let list = tokio::spawn(async move {
        let started = Instant::now();
        let _ = list_engine.list_runs().await;
        started.elapsed()
    });
    let get_engine = engine.clone();
    let get_id = run_id.clone();
    let get = tokio::spawn(async move {
        let started = Instant::now();
        let _ = get_engine.get_run(&get_id).await;
        started.elapsed()
    });
    let archive_engine = engine.clone();
    let archive_id = run_id.clone();
    let archive = tokio::spawn(async move {
        let started = Instant::now();
        let _ = archive_engine.archive_run(&archive_id, true).await;
        started.elapsed()
    });
    let cancel = tokio::spawn(async move {
        let started = Instant::now();
        let _ = engine.cancel_run(&run_id).await;
        started.elapsed()
    });

    let completed = tokio::time::timeout(Duration::from_millis(100), async {
        let durations = tokio::join!(history, list, get, archive, cancel);
        [
            durations.0.unwrap(),
            durations.1.unwrap(),
            durations.2.unwrap(),
            durations.3.unwrap(),
            durations.4.unwrap(),
        ]
    })
    .await;
    completed.is_ok_and(|durations| {
        durations
            .into_iter()
            .all(|elapsed| elapsed < Duration::from_millis(100))
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn manager_calls_do_not_wait_for_a_slow_follow_up() {
    let (_workspace, _repo, engine, run_id, calls) = parked_engine().await;
    let sender = engine.clone();
    let send_id = run_id.clone();
    let slow_call = tokio::spawn(async move {
        sender
            .send_message(
                &send_id,
                MessageInput {
                    text: Some("follow up".to_owned()),
                    images: None,
                },
            )
            .await
    });
    wait_for_call(&calls.sending).await;

    let responsive = probe_manager_calls(engine.clone(), run_id.clone()).await;
    let _ = slow_call.await;
    assert!(responsive, "a manager call exceeded the 100ms budget");
    wait_for_terminal(&engine, &run_id).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn manager_calls_do_not_wait_for_a_slow_finish() {
    let (_workspace, _repo, engine, run_id, calls) = parked_engine().await;
    let finisher = engine.clone();
    let finish_id = run_id.clone();
    let slow_call = tokio::spawn(async move { finisher.finish_run(&finish_id).await });
    wait_for_call(&calls.finishing).await;

    let responsive = probe_manager_calls(engine.clone(), run_id.clone()).await;
    let _ = slow_call.await;
    assert!(responsive, "a manager call exceeded the 100ms budget");
    wait_for_terminal(&engine, &run_id).await;
}

// ---- conversation seam -----------------------------------------------------------------------
// The same invariant, adapted to the conversation runtime: no engine call may wait behind a live
// provider turn. `ConversationManager` has no workflow lifecycle, so the slow call under test is
// an ordinary turn rather than a follow-up or a finish.

use coducktor_core::conversations::{
    ConversationEventInput, ConversationSession, ConversationSessionFactory,
    ConversationTurnRequest, TurnCancellation, TurnOutcome, TurnReport,
};

struct HeldTurnFactory {
    entered: Arc<AtomicBool>,
    release: Arc<AtomicBool>,
}

impl ConversationSessionFactory for HeldTurnFactory {
    fn open(
        &self,
        _request: &ConversationTurnRequest,
    ) -> Result<Box<dyn ConversationSession + Send>, String> {
        Ok(Box::new(HeldTurnSession {
            entered: self.entered.clone(),
            release: self.release.clone(),
        }))
    }
}

struct HeldTurnSession {
    entered: Arc<AtomicBool>,
    release: Arc<AtomicBool>,
}

impl ConversationSession for HeldTurnSession {
    fn turn(
        &mut self,
        _request: &ConversationTurnRequest,
        _on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        self.entered.store(true, Ordering::Release);
        while !self.release.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(5));
        }
        Ok(TurnOutcome::Ended {
            report: TurnReport::default(),
            session_open: true,
        })
    }

    fn answer(
        &mut self,
        _request_id: &str,
        _answers: &[ConversationQuestionAnswer],
        _cancellation: &TurnCancellation,
        _on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        Ok(TurnOutcome::Ended {
            report: TurnReport::default(),
            session_open: true,
        })
    }
}

fn conversation_input(text: &str) -> CreateConversationInput {
    CreateConversationInput {
        project_id: String::new(),
        text: text.to_owned(),
        images: Vec::new(),
        skills: Vec::new(),
        harness: Runner::Claude,
        model: None,
        reasoning: None,
        base_branch: None,
        worktree: false,
        git_mode: ConversationGitMode::Manual,
    }
}

async fn probe_conversation_calls(
    engine: Arc<InProcessEngine>,
    running: String,
    queued: String,
) -> bool {
    let list_engine = engine.clone();
    let list = tokio::spawn(async move {
        let started = Instant::now();
        let _ = list_engine.list_conversations(&Scope::Workspace).await;
        started.elapsed()
    });
    let get_engine = engine.clone();
    let get_id = running.clone();
    let get = tokio::spawn(async move {
        let started = Instant::now();
        let _ = get_engine
            .get_conversation(&Scope::Workspace, &get_id)
            .await;
        started.elapsed()
    });
    let history_engine = engine.clone();
    let history_id = running.clone();
    let history = tokio::spawn(async move {
        let started = Instant::now();
        let _ = history_engine
            .conversation_history(&Scope::Workspace, &history_id, None)
            .await;
        started.elapsed()
    });
    let index_engine = engine.clone();
    let index = tokio::spawn(async move {
        let started = Instant::now();
        let _ = index_engine.conversations_index().await;
        started.elapsed()
    });
    let cancel_engine = engine.clone();
    let cancel_id = queued.clone();
    let cancel = tokio::spawn(async move {
        let started = Instant::now();
        let _ = cancel_engine
            .cancel_conversation_turn(&Scope::Workspace, &cancel_id)
            .await;
        started.elapsed()
    });
    let mode_engine = engine.clone();
    let mode = tokio::spawn(async move {
        let started = Instant::now();
        let _ = mode_engine
            .update_conversation_git_mode(
                &Scope::Workspace,
                &queued,
                UpdateConversationGitModeInput {
                    git_mode: ConversationGitMode::Manual,
                },
            )
            .await;
        started.elapsed()
    });

    let completed = tokio::time::timeout(Duration::from_millis(100), async {
        let durations = tokio::join!(list, get, history, index, cancel, mode);
        [
            durations.0.unwrap(),
            durations.1.unwrap(),
            durations.2.unwrap(),
            durations.3.unwrap(),
            durations.4.unwrap(),
            durations.5.unwrap(),
        ]
    })
    .await;
    completed.is_ok_and(|durations| {
        durations
            .into_iter()
            .all(|elapsed| elapsed < Duration::from_millis(100))
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn conversation_calls_do_not_wait_for_a_live_provider_turn() {
    let workspace = TempDir::new().unwrap();
    let repo = TempDir::new().unwrap();
    let entered = Arc::new(AtomicBool::new(false));
    let release = Arc::new(AtomicBool::new(false));
    let engine = Arc::new(
        InProcessEngine::with_session_factory_at(
            repo.path(),
            "0.0.0-lock-test",
            SlowFactory {
                calls: Arc::new(SlowCalls::default()),
            },
            workspace.path().join("config.json"),
        )
        .with_conversation_factory(HeldTurnFactory {
            entered: entered.clone(),
            release: release.clone(),
        }),
    );

    let running = engine
        .create_conversation(&Scope::Workspace, conversation_input("held turn"))
        .await
        .unwrap()
        .conversation;
    engine.activate_conversations(&Scope::Workspace).unwrap();
    wait_for_call(&entered).await;
    // Created after activation, so it stays queued and never opens a provider of its own.
    let queued = engine
        .create_conversation(&Scope::Workspace, conversation_input("queued chat"))
        .await
        .unwrap()
        .conversation;

    let responsive = probe_conversation_calls(engine.clone(), running.id.clone(), queued.id).await;
    release.store(true, Ordering::Release);

    assert!(responsive, "a conversation call exceeded the 100ms budget");
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let state = engine
                .get_conversation(&Scope::Workspace, &running.id)
                .await
                .unwrap()
                .state;
            if !state.is_active() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
