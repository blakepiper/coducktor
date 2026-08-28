import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { agentHomePaths } from '../paths.js';
import { findConfigFile } from './catalog.js';
import { validateConfig } from './validate.js';
/**
 * Read and write the coding agents' own config files, addressed by catalog id
 * (never by a client-supplied path, so traversal is impossible by
 * construction). Every function degrades — a missing file is "absent", an
 * unreadable one is an honest error — and none throw. Writes validate first,
 * refuse a stale overwrite via a content hash, write atomically through
 * symlinks, and never touch a byte the user did not type.
 */
/** sha256 of the exact file bytes. mtime is coarse and lies across filesystems. */
function hashBytes(content) {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}
function resolvePath(def, repoRoot, env) {
    return def.resolve(repoRoot, agentHomePaths(env));
}
/** Read a config file by id. Unknown id → null; absent file → exists:false; unreadable → thrown-free error string via `error`. */
export async function readConfigFile(id, repoRoot, env = process.env) {
    const def = findConfigFile(id);
    if (!def)
        return null;
    const path = resolvePath(def, repoRoot, env);
    try {
        const content = await readFile(path, 'utf8');
        return { id, path, exists: true, content, version: hashBytes(content) };
    }
    catch (err) {
        const e = err;
        if (e.code === 'ENOENT')
            return { id, path, exists: false, content: '', version: null };
        return { error: e.message };
    }
}
/**
 * Write a config file by id. Validates the content against the file's format,
 * refuses when `version` does not match what is on disk (stale / lost-update),
 * creates the parent dir on demand, and writes atomically through any symlink
 * rather than replacing the link. `version: null` means "I expect no file to
 * exist yet" — the create path.
 */
export async function writeConfigFile(id, content, version, repoRoot, env = process.env) {
    const def = findConfigFile(id);
    if (!def)
        return null;
    const check = validateConfig(content, def.format);
    if (!check.ok)
        return { ok: false, status: 400, error: `Invalid ${def.format}: ${check.error}` };
    const path = resolvePath(def, repoRoot, env);
    // Stale-write guard: the version the caller read must still match disk.
    let current = null;
    try {
        current = await readFile(path, 'utf8');
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            return { ok: false, status: 500, error: err.message };
        }
    }
    // Footgun guard: emptying a populated file passes format validation (empty is
    // valid TOML/markdown, and JSON just errors) but silently wipes real config —
    // unrecoverable for the gitignored/home files that aren't in git. Refuse it;
    // deleting a config file is a deliberate act, not a stray select-all-delete.
    if (content.trim() === '' && current !== null && current.trim() !== '') {
        return {
            ok: false,
            status: 400,
            error: 'refusing to overwrite a non-empty config file with empty content — delete the file manually if you mean to remove it',
        };
    }
    const currentVersion = current === null ? null : hashBytes(current);
    if (currentVersion !== version) {
        return {
            ok: false,
            status: 409,
            error: currentVersion === null
                ? 'the file no longer exists on disk — reload before saving'
                : 'the file changed on disk since you opened it — reload before saving',
        };
    }
    try {
        // Resolve the real target so an atomic rename writes THROUGH a symlink
        // (e.g. ~/.claude → a dotfiles repo) instead of replacing the link itself.
        let target = path;
        try {
            target = await realpath(path);
        }
        catch {
            // file/link absent — target stays as the resolved path (the create case)
        }
        await mkdir(dirname(target), { recursive: true });
        // Unique per write (not just per process) so two concurrent saves of the same
        // file can't rename the same tmp path over each other and tear the bytes.
        const tmp = `${target}.cez-tmp-${process.pid}-${randomUUID()}`;
        await writeFile(tmp, content, 'utf8');
        await rename(tmp, target);
        const written = await readFile(target, 'utf8');
        return { ok: true, read: { id, path, exists: true, content: written, version: hashBytes(written) } };
    }
    catch (err) {
        return { ok: false, status: 500, error: err.message };
    }
}
/** Whether a path currently exists (used by the listing to report `exists`/`size`). */
export async function statConfigPath(path) {
    try {
        const s = await stat(path);
        return { exists: true, size: s.size };
    }
    catch {
        return { exists: false, size: 0 };
    }
}
export { resolvePath, hashBytes };
//# sourceMappingURL=files.js.map