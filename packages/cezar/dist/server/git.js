import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
async function git(root, args) {
    const { stdout } = await exec('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
}
/** Null when `dir` isn't inside a git repository. */
export async function getRepoInfo(dir) {
    try {
        const root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
        const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
        let remote;
        try {
            remote = (await git(root, ['remote', 'get-url', 'origin'])).trim() || undefined;
        }
        catch {
            // No remote named `origin` — fall back to the first configured remote,
            // so repos whose only remote is named e.g. `github` or `upstream` still
            // get forge detection. Truly remote-less repos land in the inner catch.
            try {
                const names = (await git(root, ['remote'])).split('\n').map((n) => n.trim()).filter(Boolean);
                if (names[0]) {
                    remote = (await git(root, ['remote', 'get-url', names[0]])).trim() || undefined;
                }
            }
            catch {
                // no remotes at all — local-only repo
            }
        }
        return { root, branch, remote };
    }
    catch {
        return null;
    }
}
/** The current commit, pinned as a full SHA. Null outside a repository or before its first commit. */
export async function getHeadCommit(root) {
    try {
        return (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim() || null;
    }
    catch {
        return null;
    }
}
export async function getStatus(root) {
    const out = await git(root, ['status', '--porcelain']);
    return out
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ status: line.slice(0, 2).trim() || '??', path: line.slice(3) }));
}
/** Working-tree diff vs HEAD (staged + unstaged), capped for the GUI. */
export async function getDiff(root, cap = 400_000) {
    const diff = await git(root, ['diff', 'HEAD']);
    if (diff.length > cap)
        return `${diff.slice(0, cap)}\n… (diff truncated)`;
    return diff;
}
/** Local + origin branch names, deduped (origin/x counts as x), sorted.
 *  Feeds the Repo tab's base-branch picker. */
export async function getBranches(root) {
    const names = new Set();
    try {
        const local = await git(root, ['branch', '--list', '--format=%(refname:short)']);
        for (const line of local.split('\n')) {
            const name = line.trim();
            if (name)
                names.add(name);
        }
    }
    catch {
        // no branches — empty list
    }
    try {
        const remote = await git(root, ['branch', '-r', '--list', '--format=%(refname:short)']);
        for (const line of remote.split('\n')) {
            const name = line.trim();
            if (!name || name.includes('HEAD'))
                continue;
            names.add(name.replace(/^origin\//, ''));
        }
    }
    catch {
        // no remotes — local only
    }
    return [...names].filter((n) => !n.startsWith('cez/')).sort((a, b) => a.localeCompare(b));
}
/** One commit — message + stat + patch — for the Repo view's expandable rows. */
export async function getCommit(root, sha, cap = 200_000) {
    if (!/^[0-9a-f]{4,40}$/i.test(sha))
        return '(not a commit hash)';
    const out = await git(root, ['show', '--stat', '--patch', '--no-color', sha]);
    if (out.length > cap)
        return `${out.slice(0, cap)}\n… (diff truncated)`;
    return out;
}
export async function getLog(root, count = 20) {
    const out = await git(root, [
        'log',
        `-${count}`,
        '--pretty=format:%h%x1f%s%x1f%an%x1f%cr',
    ]);
    return out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
        const [hash = '', subject = '', author = '', when = ''] = line.split('\x1f');
        return { hash, subject, author, when };
    });
}
//# sourceMappingURL=git.js.map