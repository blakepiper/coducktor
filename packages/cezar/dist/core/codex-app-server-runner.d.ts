import type { AgentEvent, AgentRunResult, AgentRunSpec, AgentRunner, AgentSession, SessionOptions } from './agent-runner.ts';
export interface CodexRunnerOptions {
    /** Override the binary name/path; defaults to `codex` on PATH. */
    bin?: string;
    /** Wall-clock timeout for a run (ms); per-spec `timeoutMs` still wins. */
    timeoutMs?: number;
}
/**
 * `AgentRunner` over `codex app-server` — the same JSONL transport the VS Code
 * extension and desktop app use (JSON-RPC 2.0, newline-delimited, over
 * stdin/stdout). One long-lived process per session gives Codex the same
 * multi-turn shape as the Claude runner: `turn/start` for a new turn,
 * `turn/steer` for a mid-turn follow-up, `turn/interrupt` to cancel, and
 * `thread/resume` to reopen a stored thread for "Continue".
 *
 * Auth = the host's logged-in ChatGPT/Codex session (or CODEX_API_KEY). The
 * agent runs autonomously via `sandbox: danger-full-access` +
 * `approvalPolicy: never`, matching cezar's default auto permission mode
 * (spec 2026-07-17-permission-modes). Codex has no per-tool allowlist, so
 * `spec.allowedTools` is ignored. `CEZ_CODEX_NETWORK=0` retains the previous
 * network-blocked `workspace-write` sandbox as an explicit restriction.
 */
export declare class CodexAppServerRunner implements AgentRunner {
    readonly backend: 'codex';
    private readonly bin;
    private readonly timeoutMs;
    private lastSession;
    constructor(opts?: CodexRunnerOptions);
    run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult>;
    interrupt(): Promise<void>;
    startSession(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void, opts?: SessionOptions): AgentSession;
}
/**
 * The reasoning-summary override sent on `turn/start` (TurnStartParams.summary).
 * Defaults to `auto` so reasoning is visible out of the box — without it the
 * app-server runs with its own default (no summary) and the reasoning thread
 * stays empty even when the model reasons. `CEZ_CODEX_REASONING` overrides the
 * default (`auto`/`concise`/`detailed`, or `none` to opt out); an unrecognized
 * value falls back to `auto`.
 */
export declare function reasoningSummary(env?: NodeJS.ProcessEnv): string;
