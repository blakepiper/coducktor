import type { AgentEvent, AgentRunResult, AgentRunSpec, AgentRunner } from './agent-runner.ts';
import type { AgentSession, SessionOptions } from './agent-runner.ts';
export interface OpencodeRunnerOptions {
    /** Override the binary name/path; defaults to `opencode` on PATH. */
    bin?: string;
    /** Wall-clock timeout for a run (ms); per-spec `timeoutMs` still wins. */
    timeoutMs?: number;
}
/**
 * `AgentRunner` over `opencode serve` — a headless HTTP server (the same one
 * the opencode TUI talks to) with an SSE event stream. One server per session,
 * bound to the run's `cwd` (worktree), gives OpenCode the same multi-turn shape
 * as the Claude runner: each `sendMessage` posts another prompt to the same
 * session (history is kept server-side), `session/abort` cancels, and reusing
 * the session id resumes for "Continue".
 *
 * Auth = the host's opencode config/logins. The agent runs autonomously
 * (auto-approved permissions); OpenCode has no per-tool allowlist, so
 * `spec.allowedTools` is ignored. `spec.model` is `provider/model`.
 */
export declare class OpencodeServerRunner implements AgentRunner {
    readonly backend: 'opencode';
    private readonly bin;
    private readonly timeoutMs;
    private lastSession;
    constructor(opts?: OpencodeRunnerOptions);
    run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult>;
    interrupt(): Promise<void>;
    startSession(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void, opts?: SessionOptions): AgentSession;
}
