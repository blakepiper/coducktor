/**
 * Provider usage-limit detection (spec 2026-08-03-auto-resume-after-usage-limit).
 *
 * A subscription that runs out of its window does not fail like an agent bug does: the work is
 * fine, the account is simply closed until a KNOWN instant. That instant is the whole feature —
 * without it there is nothing to schedule, so this module answers exactly one question about a
 * terminal error string: "is this a usage limit, and when does it lift?".
 *
 * The evidence differs per backend, so the shapes are recognized in order of how exact they are:
 *
 *  1. Claude Code's machine-readable envelope, `Claude AI usage limit reached|<epoch>` — the CLI
 *     puts it in an `is_error` result frame, which reaches cezar verbatim as the run's `error`.
 *     Exact, no locale, no parsing of prose. This is the one that matters in practice.
 *  2. An explicit reset instant in the prose (`try again at 2026-08-03T18:00:00Z`) — how Codex and
 *     OpenCode phrase the same thing when they carry a timestamp at all.
 *  3. A clock-only reset in prose (`resets 8:10pm (Europe/Warsaw)`) — how Claude Code phrases
 *     session windows in some interactive output.
 *  4. A relative delay (`try again in 42 minutes`, `retry-after: 3600`).
 *
 * Nothing else counts. A limit message with no recoverable reset instant returns `null` on
 * purpose: guessing a window would turn one interruption into a retry loop against a provider
 * that is still refusing, and "we don't know when" is an honest answer the caller can surface.
 */
export interface UsageLimitHit {
    /** When the provider says the limit lifts. Never in the past — a stale instant clamps to now. */
    resetAt: Date;
    /** Which shape carried it — the lifecycle note quotes this so the schedule is auditable. */
    evidence: 'claude-marker' | 'timestamp' | 'clock' | 'delay';
}
/**
 * The furthest ahead a reset may sit and still be believed. Claude's weekly window is the real
 * ceiling; anything beyond a week is a corrupt or unit-confused number, and parking a task on it
 * would be indistinguishable from losing the task.
 */
export declare const MAX_USAGE_LIMIT_WAIT_MS: number;
/**
 * Read a usage limit out of a terminal error message, or `null` when it is not one (or carries no
 * usable reset instant). `now` is injected so callers and tests share one clock.
 *
 * Never throws: this runs on the failure path of every run, where a second failure helps nobody.
 */
export declare function parseUsageLimit(message: string | undefined, now?: number): UsageLimitHit | null;
