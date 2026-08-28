import type { RunnerId } from '../core/agent-runner.ts';
/**
 * The catalog of coding-agent config files cezar can surface and edit (spec
 * `.ai/specs/2026-07-16-agent-config-files.md`). This file is the ONLY place
 * vendor knowledge lives: where each agent keeps its files, at which scope, in
 * what format, and — the load-bearing part — the vendor's OWN documented
 * precedence, quoted so a UI label never claims a merge cezar does not perform.
 *
 * Hardcoding is the design. cezar's value here is knowing where the files are
 * and what the docs say; an unknown file is not shown rather than guessed at.
 * A raw editor cannot drift on a vendor's *schema*; it can drift on *paths and
 * precedence strings*, so every entry carries a `docsUrl` and this table is the
 * single maintenance surface. Facts verified against primary docs 2026-07-16.
 */
export type ConfigFormat = 'json' | 'jsonc' | 'toml' | 'markdown';
export type ConfigScope = 'user' | 'project' | 'local';
/** `settings` = behavior knobs; `memory` = instruction/markdown; `mcp` = a dedicated MCP file. */
export type ConfigKind = 'settings' | 'memory' | 'mcp';
/**
 * Git status *by convention* — it drives the honest label, it is not read from
 * git. The seed path re-checks with `git check-ignore` before trusting it.
 */
export type ConfigTracked = 'tracked' | 'gitignored' | 'outside-repo';
/** Resolved home directories per agent, injected so the catalog stays pure and testable. */
export interface AgentHomePaths {
    /** `~/.claude` */
    claude: string;
    /** `$CODEX_HOME` or `~/.codex` */
    codex: string;
    /** `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode` */
    opencodeConfig: string;
}
export interface ConfigFileDef {
    /** Stable, opaque, URL-safe. The ONLY thing a client may name (traversal-proof). */
    id: string;
    /** Every runner that reads this file. `<repo>/AGENTS.md` is one file, two readers. */
    runners: RunnerId[];
    kind: ConfigKind;
    scope: ConfigScope;
    /** Absolute path, resolved per request so `$CODEX_HOME`/`$XDG_CONFIG_HOME` are honoured. */
    resolve: (repoRoot: string, home: AgentHomePaths) => string;
    /** What the user sees, e.g. `~/.claude/settings.json`, `.claude/settings.local.json`. */
    label: string;
    format: ConfigFormat;
    tracked: ConfigTracked;
    /** True only for Claude's gitignored personal layer — the files seeded into a run's worktree. */
    seeded?: boolean;
    /** True when this file holds MCP server definitions (drives the MCP section's filter). */
    holdsMcp?: boolean;
    /** Top-level native setting that supplies the agent's new-session model, when present. */
    modelKey?: string;
    /** Native model keys checked in precedence order, including nested `env.*` settings. */
    modelKeys?: readonly string[];
    /** Native provider key paired with the model, when the vendor separates the two. */
    modelProviderKey?: string;
    /** Higher values win when resolving a native default model across config scopes. */
    modelPriority?: number;
    /** VERBATIM from the vendor docs. Never computed, never generic. */
    precedence: string;
    /** Documented mid-run reload behaviour, or undefined when the vendor is silent. */
    hotReload?: string;
    docsUrl: string;
}
/**
 * The table. Order is presentation order: per runner, then user → project →
 * local so each scope ladder reads top (broad) to bottom (specific).
 */
export declare const CONFIG_FILES: ConfigFileDef[];
/** The whole catalog. */
export declare function listConfigFiles(): ConfigFileDef[];
/** Look up one entry by its stable id, or undefined when the id is unknown. */
export declare function findConfigFile(id: string): ConfigFileDef | undefined;
