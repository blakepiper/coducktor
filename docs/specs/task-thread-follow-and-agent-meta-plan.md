# Task thread follow mode and agent metadata

> Superseded for current product behavior on 2026-08-23 by the
> [conversation-first harness cockpit](conversation-first-harness-cockpit.md). Follow-mode details
> remain historical implementation evidence for the current conversation timeline.

## Decision

The task transcript follows live output while it is at the bottom. Scrolling upward pauses
following so history remains readable; returning to the bottom resumes following automatically.
The opened task header shows the effective runner, model, and reasoning level when known.

## Scope

- Re-enable transcript follow mode whenever scrolling reaches the bottom.
- Render task-agent metadata in the session header, preferring the active step's concrete values.
