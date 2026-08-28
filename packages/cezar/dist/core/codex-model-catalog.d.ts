import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ModelOption } from './runner-model-catalog.ts';
export interface CodexModelDiscoveryOptions {
    cwd: string;
    bin?: string;
    timeoutMs?: number;
    spawn?: (bin: string, cwd: string) => ChildProcessWithoutNullStreams;
}
/** Discover the visible catalog exposed by the authenticated host Codex CLI. */
export declare function discoverCodexModels(options: CodexModelDiscoveryOptions): Promise<ModelOption[]>;
