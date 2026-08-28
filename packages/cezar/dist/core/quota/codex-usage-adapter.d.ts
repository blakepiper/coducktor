import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ProviderUsageAdapter, ProviderUsageReading } from './usage-service.ts';
import type { ProviderAccountRef } from './types.ts';
export type ReadCodexRateLimits = (account: ProviderAccountRef) => Promise<unknown>;
export interface InstalledCodexUsageAdapterOptions {
    /** Any accessible project root; account identity comes from CODEX_HOME. */
    cwd: string;
    bin?: string;
    timeoutMs?: number;
    /** Fixture seam; production uses the app-server request below. */
    readRateLimits?: ReadCodexRateLimits;
}
export interface CodexRateLimitReadOptions {
    cwd: string;
    bin?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    spawn?: (bin: string, cwd: string, env?: Record<string, string>) => ChildProcessWithoutNullStreams;
}
/**
 * One bounded authenticated app-server read. The long-lived usage service
 * caches the answer, so this process is never spawned per UI render.
 */
export declare function readCodexRateLimitsFromAppServer(options: CodexRateLimitReadOptions): Promise<unknown>;
/** Normalizes the app-server's primary/secondary/model rate-limit windows. */
export declare function normalizeCodexRateLimits(raw: unknown): ProviderUsageReading;
/** App-server transport is injected so lifecycle ownership stays outside the adapter. */
export declare class CodexUsageAdapter implements ProviderUsageAdapter {
    private readonly readRateLimits;
    readonly provider: 'codex';
    constructor(readRateLimits: ReadCodexRateLimits);
    read(account: ProviderAccountRef): Promise<ProviderUsageReading>;
}
/** Build the production Codex adapter with the selected profile's CODEX_HOME. */
export declare function createInstalledCodexUsageAdapter(options: InstalledCodexUsageAdapterOptions): CodexUsageAdapter;
