# OpenCode `run --format json` transport characterization

Characterized on 2026-08-22 with OpenCode 1.18.18. The checked-in NDJSON is a sanitized,
deterministic copy of two real invocations in a temporary non-repository directory; it contains no
credentials, account identity, original prompt, or machine-specific path.

The first invocation used `opencode run --format json --auto --model <model> --dir <temp-dir>` and
performed one shell tool call. The second invocation added `--session <first-session-id>`, read the
first turn's file, and performed a second shell tool call. Both processes exited successfully.

Observed transport contract:

- every frame carries the same provider session ID, including across the second process;
- assistant text is live in `text` frames;
- tool lifecycle data includes tool name, call ID, status, input, bounded output metadata, and exit
  status;
- intermediate model steps end with `step_finish.reason = "tool-calls"`;
- the native turn ends with `step_finish.reason = "stop"` and the process exits normally;
- cancellation is process-scoped because `opencode run` has no separate cancellation RPC; an
  interrupt after the first `step_start` terminated the probe immediately without a terminal
  provider frame, matching the existing bounded child-process termination primitive; and
- `--auto` is accepted by this installed version and avoids interactive permission admission.

No native structured user-question frame was observed or found in this stream. An ordinary prose
question is therefore assistant text followed by a normal `stop`, which must make the conversation
idle. An unexpected permission request under `--auto` remains a per-turn provider failure.

Decision: this transport passes the section 7.4 gate and is the Phase 2 target. The existing local
`opencode serve` adapter remains in place until the reduced conversation runner seam is introduced;
there is no need to retain it as the planned fallback.
