import { type ReadClaudeOAuthCredential } from './claude-credentials.ts';
import type { ProviderUsageAdapter, ProviderUsageReading } from './usage-service.ts';
import type { ProviderAccountRef } from './types.ts';
export declare const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export type ResolveClaudeAccessToken = (account: ProviderAccountRef) => Promise<string | undefined>;
export interface ClaudeUsageAdapterOptions {
    resolveAccessToken: ResolveClaudeAccessToken;
    fetch?: typeof fetch;
    timeoutMs?: number;
}
/** Options for the installed-Claude factory. Test seams stop before a token is exposed. */
export interface InstalledClaudeUsageAdapterOptions extends Omit<ClaudeUsageAdapterOptions, 'resolveAccessToken'> {
    readCredential?: ReadClaudeOAuthCredential;
    now?: () => number;
}
/** Converts the documented OAuth usage response into the narrow Cezar representation. */
export declare function normalizeClaudeUsage(raw: unknown): ProviderUsageReading;
/**
 * Reads only the selected account's access token, holds it in local scope, and
 * sends it to Anthropic's fixed HTTPS origin. The credential resolver owns
 * platform-specific file/Keychain access and must never return it to callers.
 */
export declare class ClaudeUsageAdapter implements ProviderUsageAdapter {
    #private;
    private readonly options;
    readonly provider: 'claude';
    constructor(options: ClaudeUsageAdapterOptions);
    read(account: ProviderAccountRef): Promise<ProviderUsageReading>;
}
/**
 * Production adapter for the locally authenticated Claude Code installation.
 * The credential object is consumed immediately by the token resolver and is
 * never visible to the usage service, coordinator, or API layer.
 */
export declare function createInstalledClaudeUsageAdapter(options?: InstalledClaudeUsageAdapterOptions): ClaudeUsageAdapter;
