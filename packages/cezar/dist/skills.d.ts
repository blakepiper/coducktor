/**
 * A skill is a Markdown file with optional YAML-ish frontmatter (`name`,
 * `description`). Discovered from the repo's `.ai/skills/` (shared with other
 * agent tooling), `.ai/cezar/skills/` (cez-local), the `npx skills` install
 * dirs (`.agents/skills` + the per-agent mirrors, project and global), and
 * the configured team skills repos (spec 005 — bare clones, no checkout).
 * Adapted from @cezar/core's skill-catalog.
 */
export interface Skill {
    name: string;
    description?: string;
    /** Advisory composer hint: untouched run-mode choices default to interactive, in-place execution. */
    interactive?: true;
    body: string;
    path: string;
    source: 'ai' | 'cezar' | 'agents' | 'global' | 'team';
    /** Team skills only: where the definition lives in its skills repo. */
    team?: {
        repo: string;
        ref: string;
        path: string;
        /** True for the `SKILL.md` convention — a whole directory (references/…). */
        dir: boolean;
        /** The exact commit `ref` resolved to when the skill was read (#428). */
        commit?: string;
    };
}
export declare const SKILL_DIRS: Array<{
    dir: string;
    source: Skill['source'];
}>;
/**
 * Discover the merged skill catalog for a repo. Name collisions resolve
 * local-first: `.ai/cezar/skills` → `.ai/skills` → `.agents/skills` + agent
 * mirrors → global (`~/.agents/skills`, `~/.claude/skills`) → team repo
 * ("the user's repo is the source of truth"). Missing directories are fine —
 * an empty catalog is fully supported (steps fall back to their plain
 * prompt). Team skills come from the in-process cache; the first call starts
 * a background load so nothing here ever waits on the network.
 *
 * Opt-out gate: skills from a configured default/vendor skills repo — see
 * `gatedSkillsRepos` — appear unless the user has curated them away. `importedSkills`
 * in the GLOBAL `~/.cezar/ui-state.json` (not the
 * per-repo file — the selection describes the person and must not depend on the launch
 * directory, multi-project workspace) is a tri-state: ABSENT means "not curated" and
 * every default skill shows (the historical behavior — no upgrade break for existing
 * installs); a PRESENT array (even `[]`) means the user has taken control and only those
 * names show. A repo that sets its own `skillsRepos` gates nothing regardless. This is the
 * single chokepoint, so the decision is identical for every consumer — catalog, composer
 * picker, planner, runner.
 */
export declare function discoverSkills(repoRoot: string): Promise<Skill[]>;
/**
 * The imported team-skill names from a raw `ui-state.json` object, as a tri-state:
 * `undefined` means the key is absent — "not curated", so every default skill shows
 * (the opt-out default that keeps existing installs whole); an array (even empty) is
 * the user's explicit selection. Defensive because the file is user-editable: a value
 * that is not an array degrades to `undefined` (keep all — the safe, backward-compatible
 * reading), and non-string / empty entries inside an array are dropped rather than thrown on.
 */
export declare function readImportedSkills(uiState: Record<string, unknown>): string[] | undefined;
/**
 * The opt-out gate: keep every team skill whose repo is NOT gated (a repo with its own
 * configured `skillsRepos` — auto-loads everything). For skills from a gated default
 * (vendor) repo, `importedSkills === undefined` keeps them ALL (not curated — the
 * historical behavior), while a present array keeps only the named ones. Local skills
 * carry no `team` and are always kept. Pure so the gate is unit-testable without a
 * network clone (the gated set is a const default otherwise).
 */
export declare function filterImportedTeamSkills(teamSkills: readonly Skill[], gatedRepos: ReadonlySet<string>, importedSkills: readonly string[] | undefined): Skill[];
type FrontmatterValue = string | string[];
/**
 * Tiny purpose-built frontmatter parser — a leading `---\n … \n---\n` block
 * with `key: value` lines, `key: [a, b]` inline arrays and `key:` + `  - a`
 * block arrays. Deliberately not full YAML so we avoid a parser dependency
 * for skill files.
 */
export declare function parseFrontmatter(raw: string): {
    frontmatter: Record<string, FrontmatterValue>;
    body: string;
};
export {};
