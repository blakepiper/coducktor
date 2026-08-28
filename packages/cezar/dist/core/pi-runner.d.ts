import type { AgentEvent, AgentRunResult, AgentRunSpec, AgentRunner, AgentSession, SessionOptions } from './agent-runner.js';
export interface PiRunnerOptions {
    /** Override the binary name/path; defaults to `pi` on PATH (`CEZ_PI_BIN`). */
    bin?: string;
    /** Wall-clock timeout for a run (ms); per-spec `timeoutMs` still wins. */
    timeoutMs?: number;
}
/**
 * Persistent subprocess adapter for pi's documented RPC mode.
 *
 * Contract: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md
 * Pi has its own command/event vocabulary; it is not Claude stream-json.
 */
export declare class PiRunner implements AgentRunner {
    readonly backend: 'pi';
    private readonly bin;
    private readonly timeoutMs;
    private lastSession;
    constructor(opts?: PiRunnerOptions);
    run(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult>;
    interrupt(): Promise<void>;
    startSession(spec: AgentRunSpec, onEvent?: (event: AgentEvent) => void, opts?: SessionOptions): AgentSession;
}
export declare function buildPiArgs(spec: AgentRunSpec): string[];
