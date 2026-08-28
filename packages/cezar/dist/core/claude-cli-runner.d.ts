import type { AgentEvent, AgentRunResult, AgentRunSpec, AgentRunner, AgentSession, SessionOptions } from './agent-runner.ts';
export type { AgentSession, SessionOptions } from './agent-runner.ts';
/** Default wall-clock cap for a single run before SIGTERM → SIGKILL.
 *  Interactive sessions pass `timeoutMs: 0` to disable it entirely. */
export declare const DEFAULT_RUN_TIMEOUT_MS: number;
/** Grace period between SIGTERM and SIGKILL when a timeout fires. */
export declare const KILL_GRACE_MS = 10000;
/** After `end()` closes stdin: claude in stream-json mode can ignore EOF and
 *  hang (janitor-confirmed CLI bug) — escalate SIGTERM, then SIGKILL. */
export declare const EOF_TERM_GRACE_MS = 8000;
export declare const EOF_KILL_GRACE_MS = 4000;
/** Reopen window after a turn ends before an auto-ended session closes stdin. */
export declare const AUTO_END_DELAY_MS = 250;
export interface ClaudeCliRunnerOptions {
    /** Override the binary name/path; defaults to `claude` on PATH. */
    bin?: string;
    /** Wall-clock timeout for a run (ms); per-spec `timeoutMs` still wins. */
    timeoutMs?: number;
}
/**
 * `AgentRunner` over the Claude Code CLI in headless stream-json mode. Auth =
 * the host's logged-in Pro/Max subscription (no API key needed). Sandboxing is
 * `--allowedTools` (default-deny for anything not listed) + running inside the
 * repo `cwd`; `Bash` is narrowed to `Bash(<prefix>:*)` patterns only when
 * `bashAllowlist` is set — the zero-config default has no allowlist, so `Bash`
 * is unrestricted shell access (#430).
 *
 * Session mechanics (multi-turn stdin, EOF watchdog, reopen window) follow
 * github-janitor's `claudeRunner.ts`; the original single-turn adaptation
 * came from @cezar/core's `ClaudeCodeCliRunner`.
 */
export declare class ClaudeCliRunner implements AgentRunner {
    readonly backend: 'claude';
    private readonly bin;
    private readonly timeoutMs;
    private lastSession;
    constructor(opts?: ClaudeCliRunnerOptions);
    /** One-shot run: start a session and auto-end it after the first turn. */
    run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult>;
    interrupt(): Promise<void>;
    startSession(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void, opts?: SessionOptions): AgentSession;
}
/**
 * Build the headless argv. `--input-format stream-json` reads user messages
 * from stdin; `--output-format stream-json --verbose` gives per-event NDJSON;
 * `--permission-mode dontAsk` keeps headless runs non-interactive: tools in
 * `--allowedTools` proceed and everything else is denied instead of prompting.
 * `CEZ_APPROVAL_GATE=1` opts back into Claude's approval UI (#435).
 */
export declare function buildClaudeArgs(spec: AgentRunSpec, env?: NodeJS.ProcessEnv): string[];
/**
 * Map `allowedTools` onto claude's `--allowedTools` syntax. `Bash` with a
 * `bashAllowlist` becomes one `Bash(<prefix>:*)` entry per allowed prefix;
 * `Bash` with no allowlist stays plain `Bash`.
 */
export declare function buildAllowedTools(allowedTools: string[], bashAllowlist?: string[]): string[];
