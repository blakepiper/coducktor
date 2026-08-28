import type { ProviderAccountRef } from './types.ts';
/** The only credential material the usage adapter may receive, held in memory only. */
export interface ClaudeOAuthCredential {
    accessToken: string;
    /** ISO timestamp when known; expired credentials are never sent. */
    expiresAt?: string;
}
/** Platform-specific file/Keychain access belongs behind this narrow seam. */
export type ReadClaudeOAuthCredential = (account: ProviderAccountRef) => Promise<ClaudeOAuthCredential | undefined>;
export interface ClaudeCredentialReaderOptions {
    platform?: NodeJS.Platform;
    readFile?: (path: string, encoding: 'utf8') => Promise<string>;
    readKeychain?: () => Promise<string>;
    resolveProfilePath?: (profileId: string) => Promise<string>;
}
/**
 * Read the installed Claude Code credential for one already-resolved account.
 * macOS keeps its JSON blob in Keychain; other platforms keep the same shape
 * in that profile's `.credentials.json`. No caller receives the raw blob.
 */
export declare function createInstalledClaudeCredentialReader(options?: ClaudeCredentialReaderOptions): ReadClaudeOAuthCredential;
/**
 * Creates the adapter-facing resolver without exposing credential metadata to
 * callers. Bad, blank, or expired values fail closed as an unavailable token.
 */
export declare function createClaudeAccessTokenResolver(readCredential: ReadClaudeOAuthCredential, now?: () => number): (account: ProviderAccountRef) => Promise<string | undefined>;
