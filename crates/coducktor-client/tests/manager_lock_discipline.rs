use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use coducktor_client::{InProcessEngine, Scope};
use coducktor_contract::{
    ConversationGitMode, ConversationQuestionAnswer, CreateConversationInput, Runner,
    UpdateConversationGitModeInput,
};
use coducktor_core::conversations::{
    ConversationEventInput, ConversationSession, ConversationSessionFactory,
    ConversationTurnRequest, TurnCancellation, TurnOutcome, TurnReport,
};
use tempfile::TempDir;

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

async fn wait_for_call(flag: &AtomicBool) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !flag.load(Ordering::Acquire) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
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
        InProcessEngine::at(
            repo.path(),
            "0.0.0-lock-test",
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
