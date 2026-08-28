/**
 * Normalized agent-event protocol v2 — the shared vocabulary every runner
 * emits ALONGSIDE the v1 `AgentEvent` stream (never replacing it; mixed
 * NDJSON files stay valid — old recordings must keep replaying).
 *
 * Contract sources (authoritative, in this order):
 *  - `.ai/analysis/cockpit-ui-redesign/agent-event-protocols.md` §7 (schema)
 *    and §7.1 (per-backend mapping tables);
 *  - the spec `.ai/specs/2026-07-14-cockpit-ui-redesign.md`
 *    §"Normalized agent-event protocol v2".
 *
 * Design rules baked in:
 *  1. Item-lifecycle model (Codex/ACP style): one stable `id` per item with
 *     started/delta/updated/completed phases — two of the three backends are
 *     natively item-shaped and claude maps trivially.
 *  2. ACP vocabulary wherever a choice is arbitrary (tool status/kind, plan
 *     entries, diff shape, stop reasons) for ecosystem alignment.
 *  3. Every v1 `AgentEvent` stays derivable from this stream, so consumers
 *     can migrate one panel at a time.
 *
 * This module is pure vocabulary: no runtime imports, no runner coupling.
 * Mirrored into `packages/api-client/src/protocol/`.
 */
export {};
//# sourceMappingURL=ui-events.js.map