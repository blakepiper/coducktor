import { type ConfigFileDef } from './catalog.ts';
/**
 * Read and write the coding agents' own config files, addressed by catalog id
 * (never by a client-supplied path, so traversal is impossible by
 * construction). Every function degrades — a missing file is "absent", an
 * unreadable one is an honest error — and none throw. Writes validate first,
 * refuse a stale overwrite via a content hash, write atomically through
 * symlinks, and never touch a byte the user did not type.
 */
/** sha256 of the exact file bytes. mtime is coarse and lies across filesystems. */
declare function hashBytes(content: string): string;
export interface ReadResult {
    id: string;
    path: string;
    exists: boolean;
    content: string;
    /** sha256 of the bytes, or null when the file does not exist. */
    version: string | null;
}
export type WriteOutcome = {
    ok: true;
    read: ReadResult;
} | {
    ok: false;
    status: 400 | 409 | 500;
    error: string;
};
declare function resolvePath(def: ConfigFileDef, repoRoot: string, env: NodeJS.ProcessEnv): string;
/** Read a config file by id. Unknown id → null; absent file → exists:false; unreadable → thrown-free error string via `error`. */
export declare function readConfigFile(id: string, repoRoot: string, env?: NodeJS.ProcessEnv): Promise<ReadResult | {
    error: string;
} | null>;
/**
 * Write a config file by id. Validates the content against the file's format,
 * refuses when `version` does not match what is on disk (stale / lost-update),
 * creates the parent dir on demand, and writes atomically through any symlink
 * rather than replacing the link. `version: null` means "I expect no file to
 * exist yet" — the create path.
 */
export declare function writeConfigFile(id: string, content: string, version: string | null, repoRoot: string, env?: NodeJS.ProcessEnv): Promise<WriteOutcome | null>;
/** Whether a path currently exists (used by the listing to report `exists`/`size`). */
export declare function statConfigPath(path: string): Promise<{
    exists: boolean;
    size: number;
}>;
export { resolvePath, hashBytes };
