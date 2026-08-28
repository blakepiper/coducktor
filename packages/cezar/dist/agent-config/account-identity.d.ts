import type { ProviderId } from '../core/provider-auth.ts';
/**
 * Who an agent account is logged in AS — the "Show details" read (spec
 * `2026-07-29-agent-profiles.md`).
 *
 * This is the second place vendor knowledge lives about an agent's home, beside
 * `catalog.ts` (which config FILES exist) and `core/agent-profiles.ts` (which env var relocates
 * the home). This one knows where each agent writes its own identity. Facts verified against the
 * files on disk 2026-07-29; re-verify before changing them.
 *
 * ## Two rules that are not negotiable
 *
 * 1. **Named fields only, never pass-through.** `~/.codex/auth.json` holds `OPENAI_API_KEY`,
 *    `access_token` and `refresh_token` right beside the identity claims. Every reader below picks
 *    fields by name and builds a fresh object; nothing here spreads, forwards or stringifies a
 *    parsed vendor object, so a key the vendor adds tomorrow cannot leak through. The JWT is read
 *    for its CLAIMS and its signature is never a credential we hold onto.
 * 2. **Read on demand, answered to exactly one route.** This never joins the accounts listing,
 *    never enters `runs.json` or the NDJSON, and is never logged. `provider-auth.ts` keeps account
 *    identity out of its own boundary on purpose; this is the deliberate, opt-in exception —
 *    localHandoff-gated, and only when the user asks for it — not a widening of that rule.
 */
/** One labelled row, as the pane renders it. Deliberately not a fixed per-provider shape: what an
 *  agent knows about its own login differs, and inventing an empty "Organization" for one that has
 *  no concept of it would be a worse answer than omitting the row. */
export interface AccountIdentityField {
    label: string;
    value: string;
}
export interface AccountIdentity {
    /** False when there is nothing to show — not signed in, no file, or a file we cannot parse. */
    available: boolean;
    /** Why, in the user's terms, when `available` is false. */
    reason?: string;
    fields: AccountIdentityField[];
}
/**
 * What this account is logged in as, or an honest reason there is nothing to show.
 *
 * Never throws. OpenCode answers "unsupported": its credentials live in a SQLite DB outside the
 * config dir (see `core/agent-profiles.ts`), so there is nothing in a config folder to read — and
 * guessing from the default login would attribute one account's identity to another.
 */
export declare function readAccountIdentity(provider: ProviderId, configDir: string): Promise<AccountIdentity>;
