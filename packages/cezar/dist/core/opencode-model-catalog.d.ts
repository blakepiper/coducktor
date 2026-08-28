import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ModelOption } from './runner-model-catalog.ts';
export interface OpencodeModelDiscoveryOptions {
    cwd: string;
    bin?: string;
    timeoutMs?: number;
    spawn?: (bin: string, args: readonly string[], cwd: string) => ChildProcessWithoutNullStreams;
}
/** The host binary, resolved exactly like `OpencodeServerRunner` and the backend probe. */
export declare function resolveOpencodeExecutable(bin?: string): string;
/**
 * Discover the models the host's own OpenCode installation offers, by asking it: `opencode
 * models` lists every `provider/model` id the configured providers expose, which is the same
 * list OpenCode's own picker routes to.
 *
 * Best-effort by contract — `RunnerModelCatalog` turns any throw here into a cached or
 * `unavailable` answer, and `auto` stays selectable either way. No config is read or written,
 * no session is started; the child is short-lived and bounded by a deadline, a stdout cap and
 * a model cap.
 */
export declare function discoverOpencodeModels(options: OpencodeModelDiscoveryOptions): Promise<ModelOption[]>;
/**
 * Turn `opencode models` output into picker options, preserving OpenCode's own order.
 *
 * Empty output is a legitimate answer (no provider configured yet) and yields no models, so the
 * picker shows `auto` alone. Output that contains lines but NO recognizable id is treated as a
 * failure instead: the CLI said something we cannot read, and reporting "unavailable" is more
 * honest than an empty catalog that looks like "you have no models".
 */
export declare function parseOpencodeModels(stdout: string): ModelOption[];
