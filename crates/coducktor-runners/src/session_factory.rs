//! Per-harness binary resolution for the conversation runtime.
//!
//! [`DefaultSessionFactory`] holds one environment snapshot and turns it into the concrete spawn
//! configuration each backend runner needs. Opening a session is
//! [`crate::conversation_factory`]'s job; nothing here dispatches a turn.
//!
//! Binary resolution follows each runner's supported configuration:
//! - claude/pi: `DUCK_CLAUDE_BIN`/`DUCK_PI_BIN` override, else — when `DUCK_DRY_RUN=1` — the
//!   bundled mock script, else the bare binary name on PATH.
//! - codex/opencode/omp: their `DUCK_*_BIN` override, else the bare binary name on PATH.
//!
//! The dry-run mock scripts live under the repository's root-level `fixtures/` directory. They
//! are resolved relative to the conversation's repository root.

use std::collections::BTreeMap;
use std::path::Path;

use crate::claude_runner::ClaudeSpawnConfig;
use crate::codex_runner::CodexSpawnConfig;
use crate::opencode_run::OpencodeSpawnConfig;
use crate::pi_runner::PiSpawnConfig;

const MOCK_CLAUDE_RELATIVE: &str = "fixtures/scripts/mock-claude.mjs";
const MOCK_PI_RELATIVE: &str = "fixtures/scripts/mock-pi-rpc.mjs";
/// Resolves the real agent CLI (or, for claude/pi under `DUCK_DRY_RUN=1`, the bundled mock) for
/// whichever backend a conversation names.
pub struct DefaultSessionFactory {
    host_env: BTreeMap<String, String>,
}

impl DefaultSessionFactory {
    pub(crate) fn host_env(&self) -> &BTreeMap<String, String> {
        &self.host_env
    }

    /// Captures the current process environment once — every backend spawn reads from this
    /// snapshot rather than re-querying `std::env` per session, matching how every backend's own
    /// test suite already passes a fixed `host_env` map rather than the live environment.
    pub fn new() -> Self {
        Self::with_env(std::env::vars().collect())
    }

    /// Same as [`Self::new`], but over an explicit env snapshot rather than the live process
    /// environment — the seam a caller (a test, or a future non-CLI embedder) uses to get
    /// deterministic backend resolution without mutating global process state.
    pub fn with_env(host_env: BTreeMap<String, String>) -> Self {
        Self { host_env }
    }

    fn dry_run(&self) -> bool {
        self.host_env.get("DUCK_DRY_RUN").map(String::as_str) == Some("1")
    }

    fn mock_node_config(&self, repo_root: &Path, relative: &str) -> (String, Vec<String>) {
        let script = repo_root.join(relative);
        (
            "node".to_owned(),
            vec![script.to_string_lossy().into_owned()],
        )
    }

    pub(crate) fn claude_config(&self, repo_root: &Path) -> ClaudeSpawnConfig {
        let mut config = ClaudeSpawnConfig::default();
        if let Some(bin) = self.host_env.get("DUCK_CLAUDE_BIN") {
            config.program = bin.clone();
        } else if self.dry_run() {
            let (program, args) = self.mock_node_config(repo_root, MOCK_CLAUDE_RELATIVE);
            config.program = program;
            config.prefix_args = args;
        }
        config
    }

    pub(crate) fn codex_config(&self) -> CodexSpawnConfig {
        let mut config = CodexSpawnConfig::default();
        if let Some(bin) = self.host_env.get("DUCK_CODEX_BIN") {
            config.program = bin.clone();
        }
        config
    }

    pub(crate) fn opencode_config(&self) -> OpencodeSpawnConfig {
        let mut config = OpencodeSpawnConfig::default();
        if let Some(bin) = self.host_env.get("DUCK_OPENCODE_BIN") {
            config.program = bin.clone();
        }
        config
    }

    pub(crate) fn pi_config(&self, repo_root: &Path) -> PiSpawnConfig {
        let mut config = PiSpawnConfig::default();
        if let Some(bin) = self.host_env.get("DUCK_PI_BIN") {
            config.program = bin.clone();
        } else if self.dry_run() {
            let (program, args) = self.mock_node_config(repo_root, MOCK_PI_RELATIVE);
            config.program = program;
            config.prefix_args = args;
        }
        config
    }
    pub(crate) fn omp_config(&self, repo_root: &Path) -> PiSpawnConfig {
        let mut config = PiSpawnConfig::default();
        if let Some(bin) = self.host_env.get("DUCK_OMP_BIN") {
            config.program = bin.clone();
        } else if self.dry_run() {
            let (program, args) = self.mock_node_config(repo_root, MOCK_PI_RELATIVE);
            config.program = program;
            config.prefix_args = args;
        } else {
            config.program = "omp".to_owned();
        }
        config
    }
}

impl Default for DefaultSessionFactory {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn factory_with_env(pairs: &[(&str, &str)]) -> DefaultSessionFactory {
        DefaultSessionFactory::with_env(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
        )
    }

    #[test]
    fn claude_config_prefers_the_env_override_over_dry_run() {
        let factory =
            factory_with_env(&[("DUCK_CLAUDE_BIN", "/opt/claude"), ("DUCK_DRY_RUN", "1")]);
        let config = factory.claude_config(Path::new("/repo"));
        assert_eq!(config.program, "/opt/claude");
        assert!(config.prefix_args.is_empty());
    }

    #[test]
    fn claude_config_falls_back_to_the_bundled_mock_under_dry_run() {
        let factory = factory_with_env(&[("DUCK_DRY_RUN", "1")]);
        let config = factory.claude_config(Path::new("/repo"));
        assert_eq!(config.program, "node");
        assert_eq!(
            config.prefix_args,
            vec!["/repo/fixtures/scripts/mock-claude.mjs".to_owned()]
        );
    }

    #[test]
    fn claude_config_defaults_to_the_bare_binary_name_outside_dry_run() {
        let factory = factory_with_env(&[]);
        let config = factory.claude_config(Path::new("/repo"));
        assert_eq!(config.program, "claude");
        assert!(config.prefix_args.is_empty());
    }

    #[test]
    fn pi_config_follows_the_same_dry_run_convention_as_claude() {
        let factory = factory_with_env(&[("DUCK_DRY_RUN", "1")]);
        let config = factory.pi_config(Path::new("/repo"));
        assert_eq!(config.program, "node");
        assert_eq!(
            config.prefix_args,
            vec!["/repo/fixtures/scripts/mock-pi-rpc.mjs".to_owned()]
        );
    }

    #[test]
    fn codex_config_has_no_dry_run_fallback() {
        let factory = factory_with_env(&[("DUCK_DRY_RUN", "1")]);
        let config = factory.codex_config();
        assert_eq!(config.program, "codex");
        assert!(config.prefix_args.is_empty());
    }

    #[test]
    fn opencode_config_has_no_dry_run_fallback() {
        let factory = factory_with_env(&[("DUCK_DRY_RUN", "1")]);
        let config = factory.opencode_config();
        assert_eq!(config.program, "opencode");
        assert!(config.prefix_args.is_empty());
    }

    #[test]
    fn codex_config_honors_its_own_env_override() {
        let factory = factory_with_env(&[("DUCK_CODEX_BIN", "/opt/codex")]);
        assert_eq!(factory.codex_config().program, "/opt/codex");
    }

    #[test]
    fn opencode_config_honors_its_own_env_override() {
        let factory = factory_with_env(&[("DUCK_OPENCODE_BIN", "/opt/opencode")]);
        assert_eq!(factory.opencode_config().program, "/opt/opencode");
    }
    #[test]
    fn omp_config_uses_its_override_and_dry_run_mock() {
        let factory = factory_with_env(&[("DUCK_OMP_BIN", "/opt/omp"), ("DUCK_DRY_RUN", "1")]);
        assert_eq!(factory.omp_config(Path::new("/repo")).program, "/opt/omp");

        let factory = factory_with_env(&[("DUCK_DRY_RUN", "1")]);
        let config = factory.omp_config(Path::new("/repo"));
        assert_eq!(config.program, "node");
        assert_eq!(
            config.prefix_args,
            vec!["/repo/fixtures/scripts/mock-pi-rpc.mjs".to_owned()]
        );
    }
}
