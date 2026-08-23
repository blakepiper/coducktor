//! The `coducktor` binary's argument surface.
//!
//! Bare invocation and an explicit `tui` subcommand behave identically, and two
//! launch-time flags (`--repo`, `--model`) carry real, testable meaning
//! into the first frame rather than being decorative. The retired `-p/--port` and
//! `--no-open` flags are not reproduced because this binary owns the terminal UI and
//! opens no listener or browser.
//!
//! `run`/`init`/`usage`/`doctor`/`projects` dispatch to `headless::*` before the TUI ever
//! opens the alternate screen — see `main.rs`'s early match on `cli.command`.

use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand, ValueEnum};
use coducktor_contract::{ConversationGitMode, ProjectListEntry, Runner};

/// `coducktor` — the terminal cockpit.
#[derive(Debug, Parser)]
#[command(name = "coducktor", version, about = "The coducktor terminal cockpit", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,

    /// Open directly into this repo's project — must already be a registered
    /// project (add it from the TUI's project switcher first).
    #[arg(long, global = true, value_name = "DIR")]
    pub repo: Option<PathBuf>,

    /// Preselect a model on the New Chat screen at launch.
    #[arg(long, global = true, value_name = "MODEL")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Subcommand)]
pub enum Command {
    /// Launch the interactive TUI — the default when no subcommand is given.
    Tui,
    /// Run one conversation turn headless in the terminal.
    Run {
        /// The message text — extra words are joined with a space.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        message: Vec<String>,
        /// Concrete local harness. Coducktor never routes or fails over automatically.
        #[arg(long, value_enum, default_value_t = HarnessArg::Claude)]
        runner: HarnessArg,
        /// Provider-native reasoning value; omission uses the harness default.
        #[arg(long, value_name = "VALUE")]
        reasoning: Option<String>,
        /// Attach a discovered local skill by id or name. Repeat to attach more than one.
        #[arg(long, value_name = "SKILL")]
        skill: Vec<String>,
        /// Base branch/ref for a managed worktree.
        #[arg(long, value_name = "REF")]
        branch: Option<String>,
        /// Create a managed worktree (pass `false` to run in place).
        #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
        worktree: bool,
        /// Post-turn Git policy. `auto` requires a managed worktree.
        #[arg(long, value_enum, default_value_t = GitModeArg::Manual)]
        git_mode: GitModeArg,
    },
    /// Scaffold an example local skill under `.ai/coducktor/skills/`.
    Init,
    /// Show sanitized Claude, Codex, and supported OpenCode quota telemetry.
    Usage {
        /// Emit stable JSON for scripts.
        #[arg(long)]
        json: bool,
        /// Bypass the local quota cache.
        #[arg(long)]
        refresh: bool,
    },
    /// Check the local installation and available agent CLIs without starting the TUI.
    Doctor {
        /// Emit stable JSON for scripts.
        #[arg(long)]
        json: bool,
    },
    /// Back up and repair quarantined per-project run state.
    RepairRuns,
    /// List, register, or drop entries in the project registry.
    Projects {
        #[command(subcommand)]
        action: Option<ProjectsCommand>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum HarnessArg {
    Claude,
    Codex,
    Opencode,
    Pi,
}

impl From<HarnessArg> for Runner {
    fn from(value: HarnessArg) -> Self {
        match value {
            HarnessArg::Claude => Self::Claude,
            HarnessArg::Codex => Self::Codex,
            HarnessArg::Opencode => Self::OpenCode,
            HarnessArg::Pi => Self::Pi,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum GitModeArg {
    Manual,
    Auto,
}

impl From<GitModeArg> for ConversationGitMode {
    fn from(value: GitModeArg) -> Self {
        match value {
            GitModeArg::Manual => Self::Manual,
            GitModeArg::Auto => Self::Auto,
        }
    }
}

#[derive(Debug, Clone, Subcommand)]
pub enum ProjectsCommand {
    /// List the registered projects (also the default with no subcommand).
    List,
    /// Register a folder (default: `--repo`, else the current directory).
    Add { dir: Option<PathBuf> },
    /// Drop a registry entry — the repo itself is untouched.
    #[command(alias = "rm")]
    Remove { id: String },
}

impl Cli {
    /// Parse `argv`, exiting the process on `--help`/`--version`/a bad flag —
    /// the same startup-only escape hatch `main.rs` already uses elsewhere.
    pub fn parse_args() -> Self {
        Self::parse()
    }
}

/// Match `--repo`'s directory against the registered-projects list by canonical
/// path, so a symlink or a relative path resolves the same way a shell `cd` would.
/// Returns the matching project's id, or `None` if the directory isn't registered.
pub fn resolve_repo(registry: &[ProjectListEntry], repo: &Path) -> Option<String> {
    let target = repo.canonicalize().ok()?;
    registry
        .iter()
        .find(|entry| {
            Path::new(&entry.root)
                .canonicalize()
                .is_ok_and(|root| root == target)
        })
        .map(|entry| entry.id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: &str, root: &str) -> ProjectListEntry {
        ProjectListEntry {
            id: id.to_owned(),
            root: root.to_owned(),
            ..ProjectListEntry::default()
        }
    }

    #[test]
    fn bare_invocation_and_the_tui_subcommand_parse_identically() {
        let bare = Cli::try_parse_from(["coducktor"]).unwrap();
        let explicit = Cli::try_parse_from(["coducktor", "tui"]).unwrap();
        assert!(bare.command.is_none());
        assert!(matches!(explicit.command, Some(Command::Tui)));
        assert_eq!(bare.repo, explicit.repo);
    }

    #[test]
    fn repo_and_model_parse_on_bare_invocation() {
        let cli =
            Cli::try_parse_from(["coducktor", "--repo", "/tmp/some-repo", "--model", "sonnet"])
                .unwrap();
        assert_eq!(cli.repo, Some(PathBuf::from("/tmp/some-repo")));
        assert_eq!(cli.model.as_deref(), Some("sonnet"));
    }

    #[test]
    fn flags_are_global_and_also_parse_after_the_tui_subcommand() {
        let cli = Cli::try_parse_from(["coducktor", "tui", "--model", "sonnet"]).unwrap();
        assert!(matches!(cli.command, Some(Command::Tui)));
        assert_eq!(cli.model.as_deref(), Some("sonnet"));
    }

    #[test]
    fn unknown_subcommand_is_still_rejected() {
        assert!(Cli::try_parse_from(["coducktor", "bogus"]).is_err());
    }

    #[test]
    fn the_protected_commands_all_parse() {
        let run = Cli::try_parse_from(["coducktor", "run", "do", "the", "thing"]).unwrap();
        match run.command {
            Some(Command::Run { message, .. }) => assert_eq!(message, vec!["do", "the", "thing"]),
            other => panic!("expected Run, got {other:?}"),
        }
        assert!(matches!(
            Cli::try_parse_from(["coducktor", "init"]).unwrap().command,
            Some(Command::Init)
        ));
        assert!(matches!(
            Cli::try_parse_from(["coducktor", "usage"]).unwrap().command,
            Some(Command::Usage { .. })
        ));
        assert!(matches!(
            Cli::try_parse_from(["coducktor", "doctor", "--json"])
                .unwrap()
                .command,
            Some(Command::Doctor { json: true })
        ));
        assert!(matches!(
            Cli::try_parse_from(["coducktor", "repair-runs"])
                .unwrap()
                .command,
            Some(Command::RepairRuns)
        ));
        assert!(matches!(
            Cli::try_parse_from(["coducktor", "projects"])
                .unwrap()
                .command,
            Some(Command::Projects { action: None })
        ));
    }

    #[test]
    fn projects_add_remove_list_parse() {
        let add = Cli::try_parse_from(["coducktor", "projects", "add", "/repo"]).unwrap();
        assert!(matches!(
            add.command,
            Some(Command::Projects {
                action: Some(ProjectsCommand::Add { dir: Some(dir) })
            }) if dir == Path::new("/repo")
        ));
        let remove = Cli::try_parse_from(["coducktor", "projects", "remove", "demo"]).unwrap();
        assert!(matches!(
            remove.command,
            Some(Command::Projects {
                action: Some(ProjectsCommand::Remove { id })
            }) if id == "demo"
        ));
        let rm = Cli::try_parse_from(["coducktor", "projects", "rm", "demo"]).unwrap();
        assert!(matches!(
            rm.command,
            Some(Command::Projects {
                action: Some(ProjectsCommand::Remove { .. })
            })
        ));
    }

    #[test]
    fn help_names_every_flag_this_binary_actually_supports() {
        let error = Cli::try_parse_from(["coducktor", "--help"]).unwrap_err();
        let rendered = error.to_string();
        for needle in [
            "--repo",
            "--model",
            "tui",
            "run",
            "init",
            "usage",
            "doctor",
            "repair-runs",
            "projects",
        ] {
            assert!(
                rendered.contains(needle),
                "help text missing {needle:?}: {rendered}"
            );
        }
        // Unsupported transport flags must not resurface here.
        for needle in ["--port", "--no-open"] {
            assert!(
                !rendered.contains(needle),
                "help text unexpectedly has {needle:?}"
            );
        }
    }

    #[test]
    fn the_retired_serve_command_is_rejected() {
        assert!(Cli::try_parse_from(["coducktor", "serve"]).is_err());
    }

    #[test]
    fn resolve_repo_matches_by_canonical_path() {
        let dir = std::env::current_dir().unwrap();
        let registry = vec![project("proj-a", &dir.to_string_lossy())];
        assert_eq!(resolve_repo(&registry, &dir), Some("proj-a".to_owned()));
    }

    #[test]
    fn resolve_repo_is_none_for_an_unregistered_directory() {
        let dir = std::env::current_dir().unwrap();
        let registry = vec![project("proj-a", "/definitely/not/this/dir")];
        assert_eq!(resolve_repo(&registry, &dir), None);
    }

    #[test]
    fn run_accepts_conversation_affinity_and_policy_flags() {
        let cli = Cli::try_parse_from([
            "coducktor",
            "run",
            "--runner",
            "codex",
            "--reasoning",
            "high",
            "--skill",
            "testing",
            "--branch",
            "main",
            "--worktree",
            "false",
            "--git-mode",
            "manual",
            "fix",
            "it",
        ])
        .unwrap();
        assert!(matches!(
            cli.command,
            Some(Command::Run {
                runner: HarnessArg::Codex,
                reasoning: Some(reasoning),
                skill,
                branch: Some(branch),
                worktree: false,
                git_mode: GitModeArg::Manual,
                message,
            }) if reasoning == "high" && skill == ["testing"] && branch == "main" && message == ["fix", "it"]
        ));
    }
}
