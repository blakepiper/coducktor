import { type ChildProcessWithoutNullStreams } from 'node:child_process';
export interface CodexAppServerMessage {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: unknown;
}
export declare function resolveCodexExecutable(override?: string): string;
export declare function buildCodexAppServerEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv;
/** Spawn the authenticated host's app-server with the same least-privilege env used by runs. */
export declare function spawnCodexAppServer(bin: string, cwd: string, extraEnv?: Record<string, string>): ChildProcessWithoutNullStreams;
/** Minimal newline-JSON request correlator shared by runs and short-lived discovery. */
export declare class CodexAppServerRpc {
    readonly child: ChildProcessWithoutNullStreams;
    private nextId;
    private readonly pending;
    constructor(child: ChildProcessWithoutNullStreams);
    allocateId(): number;
    request(method: string, params: unknown): Promise<Record<string, unknown>>;
    notify(method: string, params: unknown): void;
    respond(message: unknown): void;
    dispatchResponse(message: CodexAppServerMessage): boolean;
    initialize(): Promise<void>;
    rejectPending(message?: string): void;
    private write;
}
/**
 * Close stdin, then escalate SIGTERM→SIGKILL for a server that ignores EOF.
 * `onSignal` fires when the watchdog actually signals: the caller needs to
 * know a non-zero exit was its own doing, not a codex failure (#703).
 */
export declare function endCodexAppServer(child: ChildProcessWithoutNullStreams, onTimers?: (term: NodeJS.Timeout, kill: NodeJS.Timeout | undefined) => void, onSignal?: () => void): void;
export declare function waitForCodexAppServerExit(child: ChildProcessWithoutNullStreams): Promise<number | null>;
export declare function codexSpawnError(error: unknown, bin: string): Error;
