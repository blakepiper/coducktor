import { type SkillsRepoSource } from './config.ts';
import { type Skill } from './skills.ts';
/**
 * The git remote for a configured source, or null when the value is unsafe to
 * hand to `git` (#428). Team-skill repos are code-trusted — their skill bodies
 * become agent system prompts — but the *string* is attacker-influenceable, so
 * it must never be able to select a transport helper or pose as a git option.
 * We accept exactly:
 *  - `owner/name`         GitHub shorthand → canonical https
 *  - `https://` `http://` web URLs
 *  - `ssh://…` or scp-like `git@host:path`
 *  - a local path (`/abs`, `./`, `../`, `~/…`, `C:\…`) or `file://…`
 * and reject the RCE/argument-injection surface: a leading `-`, the `::`
 * remote-helper syntax (`ext::sh -c …`, `fd::…`), and any other URL scheme.
 *
 * Every reject here maps to a real vector. Shapes that are merely *unusual* —
 * a Windows drive path, `~/…` — stay accepted: `BACKWARD_COMPATIBILITY.md` §5
 * protects the `skillsRepos` source shape, so narrowing it is a breaking change
 * and needs a migration path, not a silent refusal.
 */
export declare function safeRemoteFor(repo: string): string | null;
/**
 * A ref safe to pass to `git` as a positional revision (#428): a branch, tag,
 * or commit SHA. Rejects a leading `-` (argument injection against git's option
 * surface), range/pathspec metacharacters, and anything outside the git
 * ref-name charset — so `${ref}:${path}` in `git show` can never be a `-`-flag.
 */
export declare function isSafeRef(ref: string): boolean;
/** A full commit SHA (sha-1 or sha-256) — a pinned, immutable ref (#428). */
export declare function isPinnedSha(ref: string): boolean;
/** Stable cache directory name: the last two path segments, `owner__name`. */
export declare function bareDirFor(repo: string): string;
/** Clone the skills repo bare (no checkout) into the global cache, once. */
export declare function ensureBareClone(repo: string): Promise<{
    bareDir: string;
    created: boolean;
}>;
/** "Refresh" — update every branch head in the bare clone from origin. */
export declare function fetchAll(bareDir: string): Promise<void>;
/**
 * Read one file from the bare clone at the source's ref. Null on any failure.
 * `atCommit` pins the read to an already-resolved commit, so a caller listing
 * many files reads them all at the same commit (and skips re-resolving).
 */
export declare function readRemoteSkill(src: SkillsRepoSource, path: string, atCommit?: string): Promise<string | null>;
/**
 * List every skill the repo defines at `src.ref`. Reads from the local bare
 * clone only — no network. Empty list when the clone doesn't exist yet or
 * the ref can't be resolved.
 */
export declare function listRemoteSkills(src: SkillsRepoSource): Promise<Skill[]>;
/**
 * Copy a directory skill (SKILL.md + references/…) out of the bare clone into
 * `<repoRoot>/.claude/skills/<name>/` so claude sees the references on disk,
 * and keep it out of the user's git via `.git/info/exclude`. Returns false
 * when there is nothing to materialize (not a directory skill, no clone…).
 */
export declare function materializeSkillDir(repoRoot: string, skill: Skill): Promise<boolean>;
/**
 * Whether a passive (non-`refresh`) load should `git fetch` an existing bare
 * clone: yes on the first touch this process, and yes once the last fetch is
 * older than `ttlMs`. Pure so the freshness policy is unit-tested without git.
 */
export declare function shouldPassiveFetch(opts: {
    attempted: boolean;
    fetchedAt: number;
    now: number;
    ttlMs: number;
}): boolean;
/**
 * The current team-skill list for this project, straight from memory. The
 * first call per `repoRoot` kicks off an async background load (clone + list)
 * and returns immediately — the GUI refetches, so remote skills appear moments
 * later instead of blocking the first `GET /api/skills`.
 */
export declare function getTeamSkillsCached(repoRoot: string): Skill[];
/**
 * Wait for the same non-refreshing load kicked off by `getTeamSkillsCached`.
 * The normal catalog read stays immediate; callers use this only for a
 * background convergence read after they have already rendered local skills.
 */
export declare function waitForTeamSkills(repoRoot: string): Promise<Skill[]>;
/** Refresh: clone missing sources, `git fetch` existing ones, reload the list. */
export declare function refreshTeamSkills(repoRoot: string): Promise<Skill[]>;
