//! Conversation-first durable state and runtime foundations.
//!
//! Storage intentionally remains in the compatibility `runs.json` and `runs/<id>.ndjson`
//! locations. Legacy workflow records are readable data, never executable conversation state.

pub mod events;
pub mod git;
pub mod lifecycle;
pub mod manager;
pub mod persistence;
pub mod restart;
pub mod retention;

pub use lifecycle::*;
pub use manager::*;
