import type { RepoInfo } from '../git.ts';
import type { ForgeDriver, ForgeKind } from './types.ts';
/**
 * Forge resolution (cockpit-ui redesign spec §"Forge-driver seam"): map the
 * repo's origin remote to a driver — github.com → the GitHub driver, anything
 * else (GitLab, self-hosted, no remote, not a repo) → null. The health route
 * serializes the result as `forge: {kind, available, reason?} | null`; a null
 * forge means plain-git features only (diffs, commit, push, branches).
 */
export interface ParsedRemote {
    host: string;
    owner: string;
    repo: string;
}
/**
 * Parse a git remote URL into host/owner/repo. Handles the scheme forms
 * (`https://`, `ssh://`, `git://`, with optional credentials and port) and the
 * scp-like form (`git@host:owner/repo.git`). Null for local paths and anything
 * else that doesn't look like a forge remote.
 */
export declare function parseRemote(remote: string): ParsedRemote | null;
/**
 * Which forge a remote URL belongs to, without building a driver (#698): the
 * registry's per-project probe classifies each root from its remote alone —
 * plain string parsing, no `gh` shell-out — so the sidebar can gate each
 * project's GitHub tab on the project's own remote.
 */
export declare function forgeKindOfRemote(remote: string | undefined): ForgeKind | null;
/**
 * A remote's web root — `https://github.com/owner/repo` — or null for anything not on a known
 * forge host.
 *
 * Built from the PARSED remote, never by string-editing the raw one, and that is the point: a
 * remote may carry credentials (`https://user:token@github.com/o/r.git`), and this is a value the
 * cockpit renders and links to. Rebuilding it from `{host, owner, repo}` leaves nothing to leak.
 */
export declare function forgeWebRoot(remote: string | undefined): string | null;
/** Remote host → driver | null. GitLab lands here later as one more case. */
export declare function resolveForge(repoInfo: RepoInfo | null): ForgeDriver | null;
export type { ForgeDriver, ForgeAvailability, ForgeItem, ForgeKind, ForgePrStatus, ForgeRefKind } from './types.ts';
