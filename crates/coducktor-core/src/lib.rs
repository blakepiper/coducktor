//! Durable state, skills, Git helpers, and conversation lifecycle for Coducktor.
//!
//! This crate is the source of truth for the local file behavior used by the
//! in-process engine and terminal UI. All writes preserve the repository's compatibility and
//! atomicity rules; presentation and agent-wire details stay in their owning crates.

pub mod agent_session;
pub mod config;
pub mod conversations;
pub mod git;
pub mod handoff;
pub mod legacy_runs;
pub mod paths;
pub mod runs;
pub mod skills;
pub mod time;
pub mod workspace;
mod zod;
