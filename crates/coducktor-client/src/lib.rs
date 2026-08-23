//! Domain-shaped client boundary for the terminal cockpit.

mod engine;
mod error;
mod events;
mod in_process;
mod scope;

pub use engine::{Engine, Topic};
pub use error::EngineError;
pub use events::EngineEvent;
pub use in_process::InProcessEngine;
pub use in_process::conversation_index_entry;
pub use scope::Scope;
