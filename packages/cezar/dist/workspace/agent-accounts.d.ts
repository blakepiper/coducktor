import { z } from 'zod';
import { DEFAULT_AGENT_ACCOUNT_ID } from '../contract/index.js';
import { type ProviderId } from '../core/provider-auth.ts';
/**
 * `~/.cezar/agent-accounts.json` — the agent-accounts store (spec `2026-07-29-agent-profiles.md`).
 *
 * ## Why its own file
 *
 * These keys started life in `config.json`, where their survival across a cezar downgrade rested
 * on a `.passthrough()` modifier in the OTHER version's schema. That held for the versions in
 * this repo's history — measured, not assumed — but it is not a guarantee this repo can make on
 * behalf of a build someone switches to, and it fails completely in the one case that matters
 * most: any version that cannot parse `config.json` degrades to in-memory defaults, and its next
 * merge-write rewrites the file without whatever it did not understand.
 *
 * A version that has never heard of accounts does not open THIS file, so it cannot lose them.
 * That is the entire argument, and it is why the selections live here too rather than on the
 * project registry.
 *
 * ## House rules (the same ones `config.json` follows, for the same reasons)
 *
 * - every field optional/defaulted with `.catch`, so a bad value degrades per key;
 * - `.passthrough()` at every object level, so a NEWER cezar's keys survive an older one;
 * - per-entry salvage for `accounts` — one hand-edited row never evicts the rest;
 * - atomic tmp+rename at `0600` through the shared writer;
 * - a corrupt or unreadable file degrades to empty with ONE warning, never a boot failure.
 *
 * ## Identity
 *
 * Selections are keyed by the project's REALPATH'D ROOT, not its registry slug. The root is what
 * every consumer already has in hand (`resolveProfileEnvForRoot` takes it), it survives the
 * registry being rebuilt, and it means this file needs no cross-reference into `config.json` at
 * all. An orphaned entry — a project the user deregistered — resolves to nothing and is inert.
 */
/** `id` slug rule — the project rule, for the same URL/segment-safety reason. */
export declare const AGENT_ACCOUNT_ID_RE: RegExp;
/**
 * Reserved id meaning "the dir cezar discovers" (`agentHomePaths()`).
 *
 * NEVER stored and never allocated: the default account is the zero-config answer, so an absent
 * file behaves exactly as cezar always has. Materializing it would turn a discovered fact into
 * state a user has to maintain.
 *
 * Re-exported from the contract rather than spelled again here: the cockpit sends this exact string
 * to mean "the discovered account, whatever the repo is set to", so a second definition is a place
 * for the two sides to drift apart silently.
 */
export { DEFAULT_AGENT_ACCOUNT_ID };
/**
 * Is `configDir` absolute on `platform`? The account routes' only path rule, and the reason it is a
 * named function rather than a test written inline.
 *
 * A relative dir would resolve against whatever cwd the agent happens to be spawned in — for a task
 * that is a throwaway worktree — so it has to be refused. But the obvious spelling of that refusal,
 * a leading-`/` test, refuses every real Windows path too: `C:\Users\me\.claude-work` starts with
 * neither `/` nor `~`. That is not a corner case: `core/shell-env.ts` renders `set "VAR=v"` for
 * `cmd.exe` precisely so an account survives a Windows terminal handoff, and the Add-account dialog
 * delegates ALL path validation to the server, so a string test would leave the whole feature
 * unreachable on the one platform the rest of this work went out of its way to support.
 *
 * `platform` is a parameter so both answers stay testable from either OS.
 */
export declare function isAbsoluteConfigDir(configDir: string, platform?: NodeJS.Platform): boolean;
/** C0 controls + DEL. A path containing one is never legitimate and would be interpolated into a
 *  shell command by the CLI handoff, so it is refused at the schema, not just at the route. */
export declare const CONTROL_CHARS_RE: RegExp;
/**
 * One extra config dir for a provider — a second login of the same CLI
 * (`CLAUDE_CONFIG_DIR=~/.claude-klaudiusz claude`), see `src/core/agent-profiles.ts`.
 *
 * `id`, `provider` and `configDir` are load-bearing and carry no `.catch`: a row missing any of
 * them names no account, so the per-entry salvage below drops it. Display fields degrade per key.
 *
 * `configDir` is stored AS WRITTEN — a literal `~` survives — and every consumer expands it
 * through `expandTilde`.
 */
declare const agentAccountSchema: z.ZodObject<{
    id: z.ZodString;
    provider: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>;
    configDir: z.ZodString;
    label: z.ZodCatch<z.ZodString>;
    addedAt: z.ZodCatch<z.ZodString>;
}, z.core.$loose>;
export type AgentAccount = z.infer<typeof agentAccountSchema>;
/** One project's choice, per provider. Explicit keys so `PROVIDER_IDS` stays the one source of
 *  truth and the value is bounded. An absent key means the discovered default. */
declare const selectionSchema: z.ZodObject<{
    claude: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    codex: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    opencode: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    pi: z.ZodCatch<z.ZodOptional<z.ZodString>>;
}, z.core.$loose>;
export type AgentAccountSelection = z.infer<typeof selectionSchema>;
declare const storeSchema: z.ZodObject<{
    version: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
    accounts: z.ZodPipe<z.ZodCatch<z.ZodDefault<z.ZodArray<z.ZodUnknown>>>, z.ZodTransform<{
        [x: string]: unknown;
        id: string;
        provider: "claude" | "codex" | "opencode" | "pi";
        configDir: string;
        label: string;
        addedAt: string;
    }[], unknown[]>>;
    defaults: z.ZodCatch<z.ZodDefault<z.ZodObject<{
        claude: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        codex: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        opencode: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        pi: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    }, z.core.$loose>>>;
    selections: z.ZodPipe<z.ZodCatch<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>, z.ZodTransform<Record<string, {
        [x: string]: unknown;
        claude?: string | undefined;
        codex?: string | undefined;
        opencode?: string | undefined;
        pi?: string | undefined;
    }>, Record<string, unknown>>>;
}, z.core.$loose>;
export type AgentAccountStore = z.infer<typeof storeSchema>;
/** The in-memory default — what a missing file behaves like, and the zero-config state. */
export declare function defaultAgentAccountStore(): AgentAccountStore;
/**
 * Read the store on demand — never cached, never throws.
 *
 * Not cached because `~/.cezar/` is shared by every cezar process on the machine, so a snapshot is
 * a staleness bug; one small JSON read is free next to spawning a CLI.
 *
 * A missing file is the zero-config default (silent). A corrupt one degrades to the default with a
 * one-line warning and is left on disk untouched, so the user can repair it by hand — the next
 * successful merge-write is what replaces it.
 */
export declare function loadAgentAccounts(): Promise<AgentAccountStore>;
/**
 * Read-modify-write merge: re-read, apply `mutator`, atomic-rename write.
 *
 * Because every writer re-reads immediately before writing, two cezar processes editing different
 * accounts converge instead of dropping each other's — last-writer-wins only inside the tiny
 * read→rename window, which is the same bargain `config.json` makes. Throws on write failure (a
 * read-only home); degrading is the caller's policy.
 */
export declare function mergeWriteAgentAccounts(mutator: (store: AgentAccountStore) => AgentAccountStore | void): Promise<AgentAccountStore>;
/**
 * The account `provider` uses for `repoRoot`, or undefined when nothing has an opinion.
 *
 * Repo first, then the machine-wide default. The order is the whole feature: a repo that chose is
 * never overruled by a later change to the default, and a repo that never chose follows it — so
 * adding a second login is a one-time act rather than one per checkout.
 */
export declare function selectionFor(store: Pick<AgentAccountStore, 'selections' | 'defaults'>, repoRoot: string | undefined, provider: ProviderId): string | undefined;
