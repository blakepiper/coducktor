/**
 * The backend-agnostic seam for running one agent task. Adapted from
 * @cezar/core's `agents/agent-runner.ts`, trimmed for single-user local use:
 * no token-budget circuit breaker, no zod response schemas — one run is one
 * agent-CLI session streaming normalized events.
 *
 * Four interchangeable backends implement this seam, each as a persistent
 * process so multi-turn follow-ups, `waiting`, interrupt and resume all work:
 *  - `claude`   — Claude Code CLI, stream-json over stdin/stdout;
 *  - `codex`    — `codex app-server`, JSON-RPC 2.0 (JSONL) over stdin/stdout;
 *  - `opencode` — `opencode serve`, HTTP + SSE;
 *  - `pi`       — pi coding CLI, RPC over JSONL stdin/stdout, selecting its
 *                 model with `provider/model`.
 */
/**
 * The user-selectable runners (what config/GUI expose), in display order — the SINGLE source of
 * truth for the set. Every runtime enumeration derives from this tuple (zod schemas, the
 * server-install "at least one agent CLI" gate, the CLI-handoff registry) rather than repeating
 * the literals, so adding runner #5 is a one-line change here and typecheck finds the rest.
 */
export const RUNNER_IDS = ['claude', 'codex', 'opencode', 'pi'];
/** Narrow an arbitrary string (a config value, a check name) to a runner id. */
export function isRunnerId(value) {
    return RUNNER_IDS.includes(value);
}
/**
 * Backends without a dedicated system-prompt channel (codex app-server,
 * opencode serve) deliver `spec.systemPrompt` as a leading block of the
 * opening user message — the documented per-backend mapping (spec §protocol
 * v2: claude = `--append-system-prompt`, codex/opencode = prepended here).
 */
export function prependSystemPrompt(systemPrompt, userPrompt) {
    return systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;
}
/**
 * True for the `128 + signal` exit codes an agent CLI reports when it handles
 * a stop signal itself instead of dying from it (SIGINT/SIGKILL/SIGTERM).
 *
 * Every runner arms a SIGTERM→SIGKILL watchdog on `end()` and signals on
 * `interrupt()` (#703): the CLIs install their own handlers, so a session the
 * runner tore down on purpose comes back as a NON-ZERO exit. Paired with a
 * "we sent the signal" flag, this predicate keeps that teardown out of the
 * error path — an exit cezar caused is never an agent failure.
 */
export function isSignalTerminationExit(exitCode) {
    return exitCode === 130 || exitCode === 137 || exitCode === 143;
}
/**
 * Returns a predicate that answers "has this child actually terminated?".
 *
 * `ChildProcess.killed` answers a different question — it flips as soon as a
 * signal is *delivered*, whether or not the child dies from it. Every agent CLI
 * installs its own SIGTERM handler, so gating a SIGTERM→SIGKILL watchdog on
 * `!child.killed` disables the escalation for exactly the child it exists for:
 * `killed` is true, `exitCode` stays null, and the process outlives the whole
 * grace window (#844, same defect fixed for the discovery probe in #841).
 *
 * Seeded from `exitCode`/`signalCode` so a child that died before the watchdog
 * was armed is recognized without waiting for an event that already fired.
 */
export function trackChildExit(child) {
    let exited = child.exitCode != null || child.signalCode != null;
    child.once('exit', () => {
        exited = true;
    });
    return () => exited;
}
//# sourceMappingURL=agent-runner.js.map