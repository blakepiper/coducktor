/**
 * Normalized agent-event protocol v2 — the api-client's mirror of
 * `src/core/ui-events.ts` (Step 2.4 of the R2 plan).
 *
 * Why a mirror and not an import: the server original lives in the NodeNext
 * program next to the runners that emit these events, and the types are the
 * contract, not the module graph. The mirror is *checked*, not trusted:
 * `src/server/api-types.test.ts` asserts type exactness between every
 * declaration here and the server's own, so a drift fails
 * `npm run typecheck` (the gate) instead of the UI at runtime.
 *
 * This module MUST stay import-free so the NodeNext-side guard can reach it.
 * The field-level contract docs (per-backend mappings, ACP rationale) live on
 * the server original — they are about how runners EMIT these events; this
 * side only consumes them.
 */
export {};
//# sourceMappingURL=ui-events.js.map