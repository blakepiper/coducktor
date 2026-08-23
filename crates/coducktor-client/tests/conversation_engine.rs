//! Phase 3 gates for the conversation engine path.
//!
//! Each test here proves one property the conversation runtime must hold at the engine seam:
//! per-project isolation, no manager lock held across a provider call, and a Git policy that
//! never costs a provider turn.

use std::io;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use coducktor_client::{InProcessEngine, Scope};
use coducktor_contract::ConversationQuestionAnswer;
use coducktor_contract::{
    ConversationGitMode, ConversationState, CreateConversationInput, Runner,
    SubmitConversationMessageInput, UpdateConversationGitModeInput,
};
use coducktor_core::conversations::{
    ConversationEventInput, ConversationSession, ConversationSessionFactory,
    ConversationTurnRequest, TurnCancellation, TurnOutcome, TurnReport,
};
use tempfile::TempDir;

#[derive(Default)]
struct Counts {
    opens: AtomicUsize,
    turns: AtomicUsize,
    answers: AtomicUsize,
    in_turn: AtomicBool,
}

/// A harness stand-in whose turn can be held open for as long as a test needs, and which can be
/// asked to write a file so post-turn Git policy has something real to commit.
struct ScriptedFactory {
    counts: Arc<Counts>,
    hold: Arc<Mutex<bool>>,
    write_file: Option<String>,
}

impl ScriptedFactory {
    fn new() -> Self {
        Self {
            counts: Arc::new(Counts::default()),
            hold: Arc::new(Mutex::new(false)),
            write_file: None,
        }
    }

    fn writing(mut self, name: &str) -> Self {
        self.write_file = Some(name.to_owned());
        self
    }
}

impl ConversationSessionFactory for ScriptedFactory {
    fn open(
        &self,
        _request: &ConversationTurnRequest,
    ) -> Result<Box<dyn ConversationSession + Send>, String> {
        self.counts.opens.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(ScriptedSession {
            counts: self.counts.clone(),
            hold: self.hold.clone(),
            write_file: self.write_file.clone(),
        }))
    }
}

struct ScriptedSession {
    counts: Arc<Counts>,
    hold: Arc<Mutex<bool>>,
    write_file: Option<String>,
}

impl ScriptedSession {
    fn report() -> TurnReport {
        TurnReport {
            provider_session_id: Some("scripted-session".to_owned()),
            turn_text: "done".to_owned(),
            ..TurnReport::default()
        }
    }
}

impl ConversationSession for ScriptedSession {
    fn turn(
        &mut self,
        request: &ConversationTurnRequest,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String> {
        self.counts.turns.fetch_add(1, Ordering::SeqCst);
        self.counts.in_turn.store(true, Ordering::Release);
        // Held while the caller probes unrelated engine work: if any of it needs the manager
        // lock this worker owns, the probe blocks and the test fails. A real harness polls its
        // cancellation token the same way, so shutdown can end the hold too.
        while *self.hold.lock().map_err(|error| error.to_string())?
            && !request.cancellation.is_requested()
        {
            std::thread::sleep(Duration::from_millis(5));
        }
        self.counts.in_turn.store(false, Ordering::Release);
        if request.cancellation.is_requested() {
            return Ok(TurnOutcome::Cancelled {
                report: Self::report(),
                session_open: false,
            });
        }
        if let Some(name) = self.write_file.as_deref() {
            std::fs::write(request.cwd.join(name), "agent output\n")
                .map_err(|error| error.to_string())?;
        }
        on_event(ConversationEventInput::new("assistant-message").field("text", "done"))
            .map_err(|error| error.to_string())?;
        Ok(TurnOutcome::Ended {
            report: Self::report(),
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
        self.counts.answers.fetch_add(1, Ordering::SeqCst);
        Ok(TurnOutcome::Ended {
            report: Self::report(),
            session_open: true,
        })
    }

    fn provider_session_id(&self) -> Option<String> {
        Some("scripted-session".to_owned())
    }
}

fn create_input(
    text: &str,
    worktree: bool,
    git_mode: ConversationGitMode,
) -> CreateConversationInput {
    CreateConversationInput {
        project_id: String::new(),
        text: text.to_owned(),
        images: Vec::new(),
        skills: Vec::new(),
        harness: Runner::Claude,
        model: None,
        reasoning: None,
        base_branch: None,
        worktree,
        git_mode,
    }
}

fn engine(repo: &TempDir, workspace: &TempDir, factory: ScriptedFactory) -> Arc<InProcessEngine> {
    Arc::new(
        InProcessEngine::at(
            repo.path(),
            "0.0.0-conversation-test",
            workspace.path().join("config.json"),
        )
        .with_conversation_factory(factory),
    )
}

async fn wait_for_idle(engine: &InProcessEngine, scope: &Scope, id: &str) -> ConversationState {
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
async fn two_projects_holding_the_same_conversation_id_stay_isolated() {
    let workspace = TempDir::new().unwrap();
    let first_repo = TempDir::new().unwrap();
    let second_repo = TempDir::new().unwrap();
    let factory = ScriptedFactory::new();
    let counts = factory.counts.clone();
    let engine = engine(&first_repo, &workspace, factory);
    engine
        .register_project(&coducktor_contract::RegisterProjectInput {
            root: second_repo.path().to_string_lossy().into_owned(),
        })
        .await
        .unwrap();
    let second_scope = Scope::Project(engine.projects().await.unwrap().projects[0].id.clone());

    let created = engine
        .create_conversation(
            &Scope::Workspace,
            create_input("first project", false, ConversationGitMode::Manual),
        )
        .await
        .unwrap()
        .conversation;

    // Plant the collision the gate is about, before the second project's manager is ever opened:
    // both stores now hold the same conversation id over different content, which only stays
    // distinguishable if every registry and data directory is project-keyed.
    plant_colliding_conversation(
        &coducktor_core::paths::project_state_dir_in(workspace.path(), first_repo.path()),
        &coducktor_core::paths::project_state_dir_in(workspace.path(), second_repo.path()),
        &created.id,
    );

    let first_seen = engine
        .get_conversation(&Scope::Workspace, &created.id)
        .await
        .unwrap();
    let second_seen = engine
        .get_conversation(&second_scope, &created.id)
        .await
        .unwrap();
    assert_eq!(first_seen.id, second_seen.id);
    assert_eq!(first_seen.initial_message.text, "first project");
    assert_eq!(second_seen.initial_message.text, "second project");

    // The browser distinguishes them by project, not by id alone.
    let index = engine.conversations_index().await.unwrap();
    let rows = index
        .conversations
        .iter()
        .filter(|row| row.id == created.id)
        .collect::<Vec<_>>();
    assert_eq!(rows.len(), 2);
    assert_ne!(rows[0].project_id, rows[1].project_id);

    // Deleting one project's copy leaves the other project's untouched, transcript included.
    // Cancelling the queued turn first never opens a provider, so the turn count stays at zero.
    assert!(
        engine
            .cancel_conversation_turn(&second_scope, &created.id)
            .await
            .unwrap()
            .cancelled
    );
    assert!(
        engine
            .delete_conversation(&second_scope, &created.id)
            .await
            .unwrap()
            .deleted
    );
    assert_eq!(
        engine
            .get_conversation(&Scope::Workspace, &created.id)
            .await
            .unwrap()
            .initial_message
            .text,
        "first project"
    );
    assert!(
        engine
            .get_conversation(&second_scope, &created.id)
            .await
            .is_err()
    );
    assert!(
        !engine
            .conversation_history(&Scope::Workspace, &created.id, None)
            .await
            .unwrap()
            .events
            .is_empty()
    );
    assert_eq!(counts.turns.load(Ordering::SeqCst), 0);
}

/// Copy one project's durable conversation into another project's store under the same id, with
/// distinguishable content, so the two can only be told apart by their project.
fn plant_colliding_conversation(from_dir: &Path, into_dir: &Path, conversation_id: &str) {
    std::fs::create_dir_all(into_dir.join("runs")).unwrap();
    let index = std::fs::read_to_string(from_dir.join("runs.json")).unwrap();
    std::fs::write(
        into_dir.join("runs.json"),
        index.replace("first project", "second project"),
    )
    .unwrap();
    let history = format!("runs/{conversation_id}.ndjson");
    let events = std::fs::read_to_string(from_dir.join(&history)).unwrap();
    std::fs::write(
        into_dir.join(&history),
        events.replace("first project", "second project"),
    )
    .unwrap();
}

#[tokio::test]
async fn a_blocked_provider_turn_never_delays_unrelated_reads_or_mutations() {
    let workspace = TempDir::new().unwrap();
    let repo = TempDir::new().unwrap();
    let factory = ScriptedFactory::new();
    let counts = factory.counts.clone();
    let hold = factory.hold.clone();
    *hold.lock().unwrap() = true;
    let engine = engine(&repo, &workspace, factory);

    let blocking = engine
        .create_conversation(
            &Scope::Workspace,
            create_input("blocking turn", false, ConversationGitMode::Manual),
        )
        .await
        .unwrap()
        .conversation;
    engine.activate_conversations(&Scope::Workspace).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !counts.in_turn.load(Ordering::Acquire) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the provider turn should start");
    // Created after activation, so this one is only ever queued — nothing here opens a provider.
    let idle = engine
        .create_conversation(
            &Scope::Workspace,
            create_input("idle chat", false, ConversationGitMode::Manual),
        )
        .await
        .unwrap()
        .conversation;

    // Every one of these needs the conversation manager. None may wait behind the held turn.
    let started = Instant::now();
    let listed = engine.list_conversations(&Scope::Workspace).await.unwrap();
    let fetched = engine
        .get_conversation(&Scope::Workspace, &blocking.id)
        .await
        .unwrap();
    let history = engine
        .conversation_history(&Scope::Workspace, &blocking.id, None)
        .await
        .unwrap();
    let index = engine.conversations_index().await.unwrap();
    let read = engine
        .read_conversation(&Scope::Workspace, &blocking.id, true)
        .await
        .unwrap();
    // Cancelling the other conversation's queued turn settles it without opening a provider, so
    // the idle-only mutations below have something to act on while the first turn is still held.
    let cancelled = engine
        .cancel_conversation_turn(&Scope::Workspace, &idle.id)
        .await
        .unwrap();
    let git_mode = engine
        .update_conversation_git_mode(
            &Scope::Workspace,
            &idle.id,
            UpdateConversationGitModeInput {
                git_mode: ConversationGitMode::Manual,
            },
        )
        .await
        .unwrap();
    let archived = engine
        .archive_conversation(&Scope::Workspace, &idle.id, true)
        .await
        .unwrap();
    let elapsed = started.elapsed();

    assert!(
        elapsed < Duration::from_secs(1),
        "unrelated engine work waited {elapsed:?} behind a live provider turn"
    );
    assert_eq!(listed.len(), 2);
    assert_eq!(fetched.state, ConversationState::Running);
    assert!(!history.events.is_empty());
    assert_eq!(index.conversations.len(), 2);
    assert!(read.seen_at.is_some());
    assert!(cancelled.cancelled);
    assert!(git_mode.updated);
    assert!(archived.archived);
    // The turn really was still in flight for all of it.
    assert!(counts.in_turn.load(Ordering::Acquire));

    *hold.lock().unwrap() = false;
    wait_for_idle(&engine, &Scope::Workspace, &blocking.id).await;
    assert_eq!(counts.turns.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn automatic_git_commits_and_pushes_without_another_provider_turn() {
    let workspace = TempDir::new().unwrap();
    let repo = TempDir::new().unwrap();
    init_repo(repo.path());
    let factory = ScriptedFactory::new().writing("agent.txt");
    let counts = factory.counts.clone();
    let engine = engine(&repo, &workspace, factory);

    let created = engine
        .create_conversation(
            &Scope::Workspace,
            create_input("Fix the login redirect", true, ConversationGitMode::Auto),
        )
        .await
        .unwrap()
        .conversation;
    let worktree = created
        .worktree_path
        .clone()
        .expect("automatic Git mode requires a managed worktree");
    engine.activate_conversations(&Scope::Workspace).unwrap();
    let state = wait_for_idle(&engine, &Scope::Workspace, &created.id).await;

    assert_eq!(state, ConversationState::Idle);
    // Exactly one provider turn for one submission — Git policy is local and adds none.
    assert_eq!(counts.turns.load(Ordering::SeqCst), 1);
    assert_eq!(counts.answers.load(Ordering::SeqCst), 0);

    // Git policy runs after the turn has already settled, so wait for its activity rather than
    // for the conversation state.
    let kinds = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let history = engine
                .conversation_history(&Scope::Workspace, &created.id, None)
                .await
                .unwrap();
            let kinds = history
                .events
                .iter()
                .map(|event| event.event_type.clone())
                .collect::<Vec<_>>();
            // A push with no remote configured is reported as activity, not swallowed.
            if kinds.iter().any(|kind| kind == "git.failed") {
                return kinds;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("automatic Git activity should be recorded");
    assert!(
        kinds.iter().any(|kind| kind == "git.committed"),
        "{kinds:?}"
    );

    // The subject is derived locally from the user's own message, never asked of the agent.
    assert_eq!(
        git(Path::new(&worktree), &["log", "-1", "--pretty=format:%s"]),
        "coducktor: Fix the login redirect"
    );
    assert!(
        git(Path::new(&worktree), &["status", "--porcelain"]).is_empty(),
        "the worktree should be clean after an automatic commit"
    );
    assert_eq!(
        engine
            .get_conversation(&Scope::Workspace, &created.id)
            .await
            .unwrap()
            .state,
        ConversationState::Idle
    );
    assert_eq!(counts.turns.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn manual_git_mode_leaves_the_worktree_exactly_as_the_agent_left_it() {
    let workspace = TempDir::new().unwrap();
    let repo = TempDir::new().unwrap();
    init_repo(repo.path());
    let factory = ScriptedFactory::new().writing("agent.txt");
    let counts = factory.counts.clone();
    let engine = engine(&repo, &workspace, factory);

    let created = engine
        .create_conversation(
            &Scope::Workspace,
            create_input("Leave this uncommitted", true, ConversationGitMode::Manual),
        )
        .await
        .unwrap()
        .conversation;
    let worktree = created.worktree_path.clone().unwrap();
    engine.activate_conversations(&Scope::Workspace).unwrap();
    wait_for_idle(&engine, &Scope::Workspace, &created.id).await;

    // "Manual" must be truthful: no recovery commit, no push, the change still pending.
    assert!(
        !git(Path::new(&worktree), &["status", "--porcelain"]).is_empty(),
        "manual mode must not commit the agent's changes"
    );
    let history = engine
        .conversation_history(&Scope::Workspace, &created.id, None)
        .await
        .unwrap();
    assert!(
        !history
            .events
            .iter()
            .any(|event| event.event_type.starts_with("git.")),
        "manual mode must not perform Git activity"
    );
    assert_eq!(counts.turns.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_second_message_is_a_second_turn_on_the_same_resumed_session() {
    let workspace = TempDir::new().unwrap();
    let repo = TempDir::new().unwrap();
    let factory = ScriptedFactory::new();
    let counts = factory.counts.clone();
    let engine = engine(&repo, &workspace, factory);

    let created = engine
        .create_conversation(
            &Scope::Workspace,
            create_input("first", false, ConversationGitMode::Manual),
        )
        .await
        .unwrap()
        .conversation;
    engine.activate_conversations(&Scope::Workspace).unwrap();
    wait_for_idle(&engine, &Scope::Workspace, &created.id).await;

    let accepted = engine
        .submit_conversation_message(
            &Scope::Workspace,
            &created.id,
            SubmitConversationMessageInput {
                text: "second".to_owned(),
                images: Vec::new(),
                skills: Vec::new(),
            },
        )
        .await
        .unwrap();
    assert!(accepted.accepted);
    wait_for_idle(&engine, &Scope::Workspace, &created.id).await;

    // Two ordinary submissions, two provider turns, one session — no automatic continuation.
    assert_eq!(counts.turns.load(Ordering::SeqCst), 2);
    assert_eq!(counts.opens.load(Ordering::SeqCst), 1);
    assert_eq!(
        engine
            .get_conversation(&Scope::Workspace, &created.id)
            .await
            .unwrap()
            .provider_session_id
            .as_deref(),
        Some("scripted-session")
    );
}

fn init_repo(root: &Path) {
    git(root, &["init", "--initial-branch=main"]);
    git(root, &["config", "user.name", "Conversation Test"]);
    git(root, &["config", "user.email", "test@example.invalid"]);
    std::fs::write(root.join("README.md"), "seed\n").unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "-m", "seed"]);
}

fn git(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .expect("git should be available");
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

#[tokio::test]
async fn shutdown_signals_a_live_conversation_turn_instead_of_abandoning_it() {
    let workspace = TempDir::new().unwrap();
    let repo = TempDir::new().unwrap();
    let factory = ScriptedFactory::new();
    let counts = factory.counts.clone();
    let hold = factory.hold.clone();
    *hold.lock().unwrap() = true;
    let engine = engine(&repo, &workspace, factory);

    let created = engine
        .create_conversation(
            &Scope::Workspace,
            create_input("held turn", false, ConversationGitMode::Manual),
        )
        .await
        .unwrap()
        .conversation;
    engine.activate_conversations(&Scope::Workspace).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !counts.in_turn.load(Ordering::Acquire) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the provider turn should start");

    // The hold is never released: only the cancellation token shutdown signals can end this turn.
    engine.shutdown(Duration::from_secs(5));

    assert!(
        !counts.in_turn.load(Ordering::Acquire),
        "shutdown must signal the live turn, not abandon it"
    );
    assert_eq!(
        engine
            .get_conversation(&Scope::Workspace, &created.id)
            .await
            .unwrap()
            .state,
        ConversationState::Cancelled
    );
    assert_eq!(counts.turns.load(Ordering::SeqCst), 1);
}
