//! The non-interactive `coducktor`/`duck` subcommands: `run`, `init`, `usage`, `doctor`, and
//! `projects`. Console wording is intentionally terminal-native.

use std::path::{Path, PathBuf};
use std::process::Command as ShellCommand;

use coducktor_client::{InProcessEngine, Scope};
use coducktor_contract::{
    BackendCheckName, ConversationGitMode, ConversationSkillSelection, ConversationState,
    CreateConversationInput, Runner,
};
use coducktor_core::paths::{ProcessEnv, project_state_dir, workspace_config_path};
use coducktor_core::workflows::run::RunManager;
use coducktor_core::workspace::config::ProjectSource;
use coducktor_core::workspace::projects;
use coducktor_protocol::{MessageRole, UiItem};

use crate::cli::ProjectsCommand;

/// Resolve the requested directory, preferring its enclosing Git repository root over an
/// arbitrary subdirectory. Falls back to the directory itself when it is not inside a Git repo.
pub fn resolve_repo_root(explicit: Option<&Path>) -> PathBuf {
    let start = explicit
        .map(Path::to_path_buf)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let output = ShellCommand::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&start)
        .output();
    match output {
        Ok(output) if output.status.success() => {
            let root = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            if root.is_empty() {
                start
            } else {
                PathBuf::from(root)
            }
        }
        _ => start,
    }
}

/// Back up and repair a run index that was quarantined during load.
pub fn repair_runs_command(repo_root: &Path) -> i32 {
    let mut manager = RunManager::open(project_state_dir(repo_root, &ProcessEnv));
    match manager.repair_quarantined_index() {
        Ok(Some(backup)) => {
            println!(
                "repaired runs.json; original backed up to {}",
                backup.display()
            );
            0
        }
        Ok(None) => {
            println!("runs.json does not need repair");
            0
        }
        Err(error) => {
            eprintln!("could not repair runs.json: {error}");
            1
        }
    }
}

// ---- run (headless) -----------------------------------------------------------------------

/// `coducktor run "<message>"` — create one conversation, run exactly one native harness turn,
/// print its normalized output, and return success only when the turn ended normally.
pub struct RunCommandOptions {
    pub message: String,
    pub harness: Runner,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub skills: Vec<String>,
    pub base_branch: Option<String>,
    pub worktree: bool,
    pub git_mode: ConversationGitMode,
}

pub async fn run_command(repo_root: PathBuf, options: RunCommandOptions) -> i32 {
    let engine = InProcessEngine::new(&repo_root, env!("CARGO_PKG_VERSION"));
    run_command_with_engine(&engine, options).await
}

async fn run_command_with_engine(engine: &InProcessEngine, options: RunCommandOptions) -> i32 {
    let RunCommandOptions {
        message,
        harness,
        model,
        reasoning,
        skills,
        base_branch,
        worktree,
        git_mode,
    } = options;
    if message.trim().is_empty() {
        eprintln!("usage: coducktor run [OPTIONS] \"<message>\"");
        return 1;
    }
    if git_mode == ConversationGitMode::Auto && !worktree {
        eprintln!("automatic Git mode requires --worktree true");
        return 1;
    }

    let scope = Scope::Workspace;
    let input = CreateConversationInput {
        project_id: String::new(),
        text: message,
        images: Vec::new(),
        skills: skills
            .into_iter()
            .map(|id| ConversationSkillSelection { id })
            .collect(),
        harness,
        model,
        reasoning,
        base_branch,
        worktree,
        git_mode,
    };
    let conversation = match engine.create_conversation(&scope, input).await {
        Ok(response) => response.conversation,
        Err(error) => {
            eprintln!("  ✗ {error}");
            return 1;
        }
    };
    if let Err(error) = engine.activate_conversations(&scope) {
        eprintln!("  ✗ {error}");
        return 1;
    }

    let settled = loop {
        match engine.get_conversation(&scope, &conversation.id).await {
            Ok(record) if !record.state.is_active() => break record,
            Ok(_) => tokio::time::sleep(std::time::Duration::from_millis(25)).await,
            Err(error) => {
                eprintln!("  ✗ {error}");
                return 1;
            }
        }
    };
    if let Ok(history) = engine
        .conversation_history(&scope, &conversation.id, None)
        .await
    {
        for event in history.events {
            print_conversation_event(&event);
        }
    }
    if let Some(error) = &settled.last_error {
        eprintln!("  ✗ {error}");
    }
    eprintln!(
        "\nchat {} — {:?} — {} tokens",
        settled.id, settled.state, settled.tokens_used as i64
    );
    match settled.state {
        ConversationState::Idle => 0,
        ConversationState::NeedsInput => {
            eprintln!("  ✗ the harness requested structured input; continue in coducktor");
            1
        }
        ConversationState::Queued
        | ConversationState::Running
        | ConversationState::Failed
        | ConversationState::Cancelled => 1,
    }
}

/// Print normalized conversation events with terminal-friendly formatting.
fn print_conversation_event(event: &coducktor_contract::RunHistoryEvent) {
    let text = |key: &str| -> String {
        event
            .extra
            .get(key)
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_owned()
    };
    match event.event_type.as_str() {
        "text" => println!("{}", text("text")),
        "item.started" | "item.updated" | "item.completed" => {
            let Some(item) = event.extra.get("item") else {
                return;
            };
            match serde_json::from_value::<UiItem>(item.clone()) {
                Ok(UiItem::Message(message)) if message.role == MessageRole::Assistant => {
                    println!("{}", message.text)
                }
                Ok(UiItem::Tool(tool)) => println!("  → {}", tool.title),
                _ => {}
            }
        }
        "tool-call" => {
            let input = event
                .extra
                .get("input")
                .map(preview_json)
                .unwrap_or_default();
            println!("  → {} {input}", text("tool"));
        }
        "tool-result" => println!("  ← {}", first_line(&text("result"))),
        "note" | "lifecycle" => println!("  · {}", text("message")),
        "error" => eprintln!("  ✗ {}", text("message")),
        _ => {}
    }
}

fn preview_json(value: &serde_json::Value) -> String {
    let rendered = value.to_string();
    if rendered.len() > 120 {
        format!("{}…", &rendered[..117])
    } else {
        rendered
    }
}

fn first_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or_default();
    if line.chars().count() > 120 {
        let head: String = line.chars().take(117).collect();
        format!("{head}…")
    } else {
        line.to_owned()
    }
}

// ---- init ----------------------------------------------------------------------------------

/// `coducktor init` — scaffold one local skill example without introducing workflow execution.
pub fn init_command(repo_root: &Path) {
    let skills_dir = repo_root.join(".ai/coducktor/skills");
    let _ = std::fs::create_dir_all(&skills_dir);

    let examples = [(
        skills_dir.join("project-conventions.md"),
        "---\nname: project-conventions\ndescription: House rules the agent should follow in this repo.\n---\n\n# Project conventions\n\n- Describe your stack, style, and testing conventions here.\n- Attach this skill from New Chat or with `duck run --skill project-conventions`.\n",
    )];

    for (path, content) in examples {
        if path.exists() {
            println!("  = {} (exists, left untouched)", path.display());
        } else if std::fs::write(&path, content).is_ok() {
            println!("  + {}", path.display());
        }
    }
    println!("\nDone. Start the cockpit with: coducktor");
}

// ---- usage ---------------------------------------------------------------------------------

/// `coducktor usage` — the same sanitized quota view rendered by Settings.
pub async fn usage_command(repo_root: PathBuf, json: bool, refresh: bool) -> i32 {
    let engine = InProcessEngine::new(repo_root, env!("CARGO_PKG_VERSION"));
    let response = if refresh {
        engine.refresh_workspace_usage().await
    } else {
        engine.workspace_usage().await
    };
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            eprintln!("coducktor usage: {error}");
            return 1;
        }
    };
    if json {
        match serde_json::to_string_pretty(&response) {
            Ok(output) => println!("{output}"),
            Err(error) => {
                eprintln!("coducktor usage: {error}");
                return 1;
            }
        }
        return 0;
    }
    for provider in response.providers {
        let upstream = provider
            .upstream_provider
            .as_deref()
            .map(|upstream| format!(" · {upstream}"))
            .unwrap_or_default();
        println!(
            "{}{} · {} · {:?}",
            usage_provider_label(provider.provider),
            upstream,
            provider.profile_id,
            provider.health
        );
        for window in &provider.windows {
            let kind = usage_window_label(window);
            let used = window
                .used_percent
                .map(|used| format!("{used:.0}% used"))
                .unwrap_or_else(|| "usage unknown".to_owned());
            let reset = window
                .resets_at
                .as_deref()
                .map(|reset| format!(", resets {reset}"))
                .unwrap_or_default();
            println!("  {kind}: {used}{reset}");
        }
        if provider.windows.is_empty()
            && let Some(error) = provider.error
        {
            println!("  {}", error.message);
        }
    }
    0
}

fn usage_window_label(window: &coducktor_contract::ProviderUsageWindow) -> &'static str {
    match window.id.as_deref() {
        Some(id) if id.ends_with(":rolling") => "session",
        Some(id) if id.ends_with(":weekly") => "weekly",
        Some(id) if id.ends_with(":monthly") => "monthly",
        _ => match window.kind {
            coducktor_contract::ProviderUsageWindowKind::Short => "short",
            coducktor_contract::ProviderUsageWindowKind::Long => "weekly",
            coducktor_contract::ProviderUsageWindowKind::Model => "model",
            coducktor_contract::ProviderUsageWindowKind::Unknown => "window",
        },
    }
}

fn usage_provider_label(provider: coducktor_contract::QuotaProvider) -> &'static str {
    match provider {
        coducktor_contract::QuotaProvider::Claude => "Claude",
        coducktor_contract::QuotaProvider::Codex => "Codex",
        coducktor_contract::QuotaProvider::OpenCode => "OpenCode",
    }
}

// ---- doctor -------------------------------------------------------------------------------

/// Inspect the local installation without opening a TUI or a listening socket.
///
/// The update row is intentionally source-first: this build has no package registry or
/// background updater, so the honest update action is to pull the checkout and rerun
/// `install.sh`.
pub async fn doctor_command(repo_root: PathBuf, json: bool) -> i32 {
    let engine = InProcessEngine::new(repo_root, env!("CARGO_PKG_VERSION"));
    let health = match engine.diagnostic_health().await {
        Ok(health) => health,
        Err(error) => {
            eprintln!("coducktor doctor: {error}");
            return 1;
        }
    };

    let agent_checks = health.checks.iter().filter(|check| {
        matches!(
            check.name,
            BackendCheckName::Claude
                | BackendCheckName::Codex
                | BackendCheckName::OpenCode
                | BackendCheckName::Pi
        )
    });
    let agent_count = agent_checks.clone().count();
    let available_agents = agent_checks.filter(|check| check.available).count();

    if json {
        let report = serde_json::json!({
            "version": health.version,
            "update": {
                "available": false,
                "hint": "source-first install: run git pull and ./install.sh",
            },
            "repoRoot": health.repo_root,
            "checks": health.checks,
        });
        match serde_json::to_string_pretty(&report) {
            Ok(rendered) => println!("{rendered}"),
            Err(error) => {
                eprintln!("coducktor doctor: could not render JSON: {error}");
                return 1;
            }
        }
    } else {
        println!("coducktor doctor");
        println!("  version: {}", health.version);
        println!("  update: source-first install — run `git pull && ./install.sh`");
        println!("  repo: {}", health.repo_root);
        println!("  agent CLIs: {available_agents}/{agent_count} available");
        for check in &health.checks {
            let mark = if check.available { "✓" } else { "✗" };
            let version = check
                .version
                .as_deref()
                .map(|version| format!(" ({version})"))
                .unwrap_or_default();
            let hint = check
                .hint
                .as_deref()
                .map(|hint| format!(" — {hint}"))
                .unwrap_or_default();
            println!(
                "  {mark} {}{version}{hint}",
                backend_check_label(check.name)
            );
        }
    }

    if available_agents > 0 { 0 } else { 1 }
}

fn backend_check_label(name: BackendCheckName) -> &'static str {
    match name {
        BackendCheckName::Claude => "claude",
        BackendCheckName::Codex => "codex",
        BackendCheckName::OpenCode => "opencode",
        BackendCheckName::Pi => "pi",
        BackendCheckName::Gh => "gh",
        BackendCheckName::Git => "git",
    }
}

// ---- projects --------------------------------------------------------------------------------

/// `coducktor projects [list|add [<dir>]|remove <id>|rm <id>]` — the terminal project-registry
/// commands. They operate directly on the per-user workspace config and need no service.
pub fn projects_command(repo_root: &Path, action: Option<ProjectsCommand>) -> i32 {
    projects_command_at(&workspace_config_path(&ProcessEnv), repo_root, action)
}

/// The testable core of [`projects_command`] — takes the registry file path explicitly so a
/// test operates on a tempdir's own registry instead of the real `~/.coducktor/config.json`.
fn projects_command_at(path: &Path, repo_root: &Path, action: Option<ProjectsCommand>) -> i32 {
    match action {
        None | Some(ProjectsCommand::List) => projects_list(path),
        Some(ProjectsCommand::Add { dir }) => {
            let root = dir.unwrap_or_else(|| repo_root.to_path_buf());
            projects_add(path, &root)
        }
        Some(ProjectsCommand::Remove { id }) => projects_remove(path, &id),
    }
}

fn projects_list(path: &Path) -> i32 {
    let entries = projects::list_projects(path, &ProcessEnv);
    if entries.is_empty() {
        println!("\n  no projects registered yet");
        println!("  start coducktor in a repo or add one: coducktor projects add <dir>\n");
        return 0;
    }
    println!();
    for project in &entries {
        let status = projects::probe_status(Path::new(&project.root));
        let (mark, label) = match status {
            coducktor_contract::ProjectStatus::Missing => ("✗", "missing".to_owned()),
            coducktor_contract::ProjectStatus::NotGit => ("·", "not a git repo".to_owned()),
            coducktor_contract::ProjectStatus::Ok => ("✓", "ok".to_owned()),
        };
        let tags = project
            .tags
            .as_ref()
            .filter(|tags| !tags.is_empty())
            .map(|tags| format!("  [{}]", tags.join(" ")))
            .unwrap_or_default();
        println!("  {mark} {}  {label}  {}{tags}", project.id, project.root);
    }
    println!(
        "\n  {} project(s) — registry: {}\n",
        entries.len(),
        path.display()
    );
    0
}

fn projects_add(path: &Path, root: &Path) -> i32 {
    if !root.is_dir() {
        eprintln!("not a directory: {}", root.display());
        return 1;
    }
    if !projects::should_register_project(root, &ProcessEnv) {
        eprintln!(
            "refusing to register {} — coducktor task worktrees and your home directory are not projects",
            root.display()
        );
        return 1;
    }
    let known: std::collections::HashSet<String> = projects::list_projects(path, &ProcessEnv)
        .into_iter()
        .map(|project| project.id)
        .collect();
    match projects::register_project(path, &ProcessEnv, root, ProjectSource::Local) {
        Ok(entry) => {
            if known.contains(&entry.id) {
                println!("  = {} (already registered)  {}", entry.id, entry.root);
            } else {
                println!("  + {}  {}", entry.id, entry.root);
            }
            0
        }
        Err(error) => {
            eprintln!("failed to register {}: {error}", root.display());
            1
        }
    }
}

fn projects_remove(path: &Path, id: &str) -> i32 {
    match projects::remove_project(path, &ProcessEnv, id) {
        Ok(true) => {
            println!(
                "  - {id} (registry entry only — the repo and its .ai/coducktor/ are untouched)"
            );
            0
        }
        Ok(false) => {
            eprintln!("unknown project: {id}");
            1
        }
        Err(error) => {
            eprintln!("failed to remove {id}: {error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coducktor_core::workspace::config::load_workspace_config;
    use coducktor_runners::session_factory::DefaultSessionFactory;
    use std::collections::BTreeMap;

    #[test]
    fn resolve_repo_root_finds_the_git_toplevel_from_a_subdirectory() {
        let repo = tempfile::tempdir().unwrap();
        assert!(
            ShellCommand::new("git")
                .args(["init", "-q"])
                .current_dir(repo.path())
                .status()
                .unwrap()
                .success()
        );
        let nested = repo.path().join("a/b/c");
        std::fs::create_dir_all(&nested).unwrap();

        let root = resolve_repo_root(Some(&nested));
        assert_eq!(
            root.canonicalize().unwrap(),
            repo.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn resolve_repo_root_falls_back_to_the_given_directory_outside_git() {
        let dir = tempfile::tempdir().unwrap();
        // A tempdir is (almost always) not itself inside a git work tree.
        let root = resolve_repo_root(Some(dir.path()));
        assert_eq!(
            root.canonicalize().unwrap(),
            dir.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn init_command_scaffolds_only_a_shareable_skill_example() {
        let repo = tempfile::tempdir().unwrap();
        init_command(repo.path());

        let skill = repo
            .path()
            .join(".ai/coducktor/skills/project-conventions.md");
        assert!(skill.is_file());
        assert!(
            std::fs::read_to_string(&skill)
                .unwrap()
                .contains("duck run --skill project-conventions")
        );
        assert!(!repo.path().join(".ai/coducktor/workflows").exists());

        // Idempotent: a second run leaves the files alone rather than erroring or duplicating.
        let before = std::fs::read_to_string(&skill).unwrap();
        init_command(repo.path());
        assert_eq!(std::fs::read_to_string(&skill).unwrap(), before);
    }

    #[test]
    fn projects_command_add_list_remove_round_trips() {
        let home = tempfile::tempdir().unwrap();
        let registry = home.path().join("config.json");
        let repo = tempfile::tempdir().unwrap();

        let added = projects_command_at(
            &registry,
            repo.path(),
            Some(ProjectsCommand::Add { dir: None }),
        );
        assert_eq!(added, 0);
        let config = load_workspace_config(&registry, &ProcessEnv);
        assert_eq!(config.projects.len(), 1);
        let id = config.projects[0].id.clone();

        assert_eq!(projects_command_at(&registry, repo.path(), None), 0);

        let removed = projects_command_at(
            &registry,
            repo.path(),
            Some(ProjectsCommand::Remove { id: id.clone() }),
        );
        assert_eq!(removed, 0);
        assert!(
            load_workspace_config(&registry, &ProcessEnv)
                .projects
                .is_empty()
        );

        let unknown =
            projects_command_at(&registry, repo.path(), Some(ProjectsCommand::Remove { id }));
        assert_eq!(unknown, 1);
    }

    #[test]
    fn usage_output_uses_stable_provider_labels() {
        assert_eq!(
            usage_provider_label(coducktor_contract::QuotaProvider::Claude),
            "Claude"
        );
        assert_eq!(
            usage_provider_label(coducktor_contract::QuotaProvider::Codex),
            "Codex"
        );
        let monthly = coducktor_contract::ProviderUsageWindow {
            id: Some("opencode-go:monthly".to_owned()),
            kind: coducktor_contract::ProviderUsageWindowKind::Long,
            used_percent: Some(80.0),
            resets_at: None,
            hard_limit_reached: Some(false),
        };
        assert_eq!(usage_window_label(&monthly), "monthly");
    }

    /// A fake "repo" carrying just enough of the real tree's shape
    /// (`fixtures/scripts/mock-claude.mjs`) for `DefaultSessionFactory`'s dry-run path
    /// resolution to find it, without touching the real dev checkout's `.ai/coducktor/`.
    fn fake_repo_with_mock_claude() -> tempfile::TempDir {
        let repo = tempfile::tempdir().unwrap();
        let scripts_dir = repo.path().join("fixtures/scripts");
        std::fs::create_dir_all(&scripts_dir).unwrap();
        let real_mock = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/scripts/mock-claude.mjs");
        std::fs::copy(&real_mock, scripts_dir.join("mock-claude.mjs")).unwrap();
        repo
    }

    fn dry_run_factory() -> DefaultSessionFactory {
        let mut env = BTreeMap::new();
        env.insert("DUCK_DRY_RUN".to_owned(), "1".to_owned());
        if let Ok(path) = std::env::var("PATH") {
            env.insert("PATH".to_owned(), path);
        }
        DefaultSessionFactory::with_env(env)
    }

    fn dry_run_engine(repo: &Path) -> InProcessEngine {
        let config = repo.join("workspace-config.json");
        InProcessEngine::with_session_factory_at(
            repo,
            "0.0.0-headless-test",
            dry_run_factory(),
            config,
        )
        .with_conversation_factory(dry_run_factory())
    }

    #[tokio::test]
    async fn run_command_reaches_idle_and_exits_zero_against_the_dry_run_mock() {
        let repo = fake_repo_with_mock_claude();
        let engine = dry_run_engine(repo.path());
        let code = run_command_with_engine(
            &engine,
            RunCommandOptions {
                message: "investigate the login redirect bug mock:done".to_owned(),
                harness: Runner::Claude,
                model: None,
                reasoning: None,
                skills: Vec::new(),
                base_branch: None,
                worktree: false,
                git_mode: ConversationGitMode::Manual,
            },
        )
        .await;
        assert_eq!(code, 0);
    }

    #[tokio::test]
    async fn run_command_rejects_an_empty_message() {
        let repo = fake_repo_with_mock_claude();
        let engine = dry_run_engine(repo.path());
        let code = run_command_with_engine(
            &engine,
            RunCommandOptions {
                message: "   ".to_owned(),
                harness: Runner::Claude,
                model: None,
                reasoning: None,
                skills: Vec::new(),
                base_branch: None,
                worktree: false,
                git_mode: ConversationGitMode::Manual,
            },
        )
        .await;
        assert_eq!(code, 1);
    }

    #[test]
    fn repair_runs_command_backs_up_and_repairs_a_corrupt_project_index() {
        let repo = tempfile::tempdir().unwrap();
        let state = project_state_dir(repo.path(), &ProcessEnv);
        std::fs::create_dir_all(&state).unwrap();
        let index = state.join("runs.json");
        let corrupt = b"{broken";
        std::fs::write(&index, corrupt).unwrap();

        assert_eq!(repair_runs_command(repo.path()), 0);
        assert_eq!(
            coducktor_core::runs::store::load_run_index(&index, true).len(),
            0
        );
        let backups = std::fs::read_dir(&state)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains("corrupt-backup")
            })
            .count();
        assert_eq!(backups, 1);
    }
}
