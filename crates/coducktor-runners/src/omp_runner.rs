//! `AgentSession` over oh-my-pi's documented RPC mode.
//!
//! OMP is a Pi-derived CLI, but its RPC turn boundary is `agent_end` rather
//! than Pi's `agent_settled`. The shared Pi-compatible transport mapper keeps
//! the normalized event behavior identical without coupling the rest of the
//! application to OMP wire types.

use std::collections::BTreeMap;

use coducktor_contract::Runner;

use crate::agent_runner::AgentRunSpec;
use crate::pi_runner::{PiSession, PiSpawnConfig, build_omp_args, open_rpc_session};

/// Spawn an OMP RPC session, probe its state, and send its opening prompt.
pub fn open_omp_session(
    config: &PiSpawnConfig,
    spec: &AgentRunSpec,
    host_env: &BTreeMap<String, String>,
) -> Result<PiSession, String> {
    open_rpc_session(
        config,
        spec,
        host_env,
        Runner::Omp,
        "omp",
        "agent_end",
        build_omp_args(spec),
    )
}

/// OMP's session implementation is the shared Pi-compatible RPC session.
pub type OmpSession = PiSession;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omp_args_use_yolo_rpc_and_native_resume() {
        let spec = AgentRunSpec {
            session_id: Some("session-1".to_owned()),
            resume: true,
            model: Some("anthropic/claude-sonnet-5".to_owned()),
            system_prompt: Some("Stay focused.".to_owned()),
            reasoning: Some("high".to_owned()),
            ..Default::default()
        };
        assert_eq!(
            build_omp_args(&spec),
            vec![
                "--mode",
                "rpc",
                "--approval-mode",
                "yolo",
                "--resume",
                "session-1",
                "--append-system-prompt",
                "Stay focused.",
                "--model",
                "anthropic/claude-sonnet-5",
                "--thinking",
                "high",
            ]
        );
    }

    #[test]
    fn omp_fresh_sessions_do_not_pass_a_pi_only_session_id_flag() {
        let spec = AgentRunSpec {
            session_id: Some("old-session".to_owned()),
            ..Default::default()
        };
        let args = build_omp_args(&spec);
        assert!(!args.iter().any(|arg| arg == "--session-id"));
        assert!(!args.iter().any(|arg| arg == "--resume"));
    }
}
