/**
 * Redact credentials before they are persisted to a run's NDJSON transcript
 * (#427). Tool-result output is written verbatim to disk and served back over
 * the API, so the moment an agent runs a command whose output contains a
 * secret (`printenv`, `cat ~/.aws/credentials`, …) that secret would land in
 * `.ai/cezar/` — violating the "No secrets in state files" invariant
 * (AGENTS.md / CODE_REVIEW.md).
 *
 * Two complementary strategies:
 *   1. Value-based — the concrete values of the host's own secret-named env
 *      vars (GITHUB_TOKEN, ANTHROPIC_API_KEY, AWS_SECRET_ACCESS_KEY, …). If
 *      any of them appears in event text, it is scrubbed.
 *   2. Pattern-based — well-known token shapes (gh*, sk-*, AKIA*, AIza*,
 *      xox*-*) so secrets that never lived in cezar's own env are still caught.
 *
 * Zero-config: redaction is on by default; `CEZ_REDACT_SECRETS=0` opts out.
 */
export declare const REDACTED = "[REDACTED]";
/**
 * Names that look like a credential — the single source of truth for "is this
 * var a secret?", shared with `agent-env.ts` (#427 review). The two used to
 * carry near-identical but subtly different lists, so a var could be stripped
 * from the child env yet never collected for redaction (or vice versa). One
 * constant, one answer: what we refuse to forward is exactly what we scrub.
 */
export declare const SECRET_NAME_RE: RegExp;
/** Collect the concrete secret values present in `env` (deduped, longest
 *  first so a value that contains another is replaced whole). */
export declare function collectSecretValues(env?: NodeJS.ProcessEnv): string[];
/** Replace every known secret value / token shape in `text` with `[REDACTED]`. */
export declare function redactSecrets(text: string, secretValues: readonly string[]): string;
/**
 * Deep-copy `value`, redacting every string leaf. Structure/keys are
 * preserved; only string values (and string keys are left untouched — keys are
 * event field names, never secrets) are scrubbed.
 */
export declare function redactDeep<T>(value: T, secretValues: readonly string[]): T;
