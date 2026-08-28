export declare const PROVIDER_IDS: readonly ['claude', 'codex', 'opencode', 'pi'];
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderConnectionState = 'connected' | 'disconnected' | 'not-installed' | 'unknown';
export interface ProviderStatus {
    provider: ProviderId;
    status: ProviderConnectionState;
    enabled?: boolean;
    hint?: string;
    authFailureId?: string;
    /** Which agent account this row describes (spec 2026-07-29-agent-profiles). Absent on the rows
     *  `status()` builds — that route answers for the discovered default only, and stays exactly
     *  as wide as it has always been. Stamped in by `profileStatus()`. */
    profileId?: string;
}
export interface ProviderStatusResponse {
    providers: ProviderStatus[];
}
export interface ProviderCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    errorCode?: string;
    timedOut?: boolean;
}
export type RunProviderCommand = (executable: string, args: readonly string[], timeoutMs: number, 
/** Extra environment for the probe — how an agent profile's config dir reaches the CLI (spec
 *  2026-07-29-agent-profiles). Optional so every existing caller and the test kit keep their
 *  three-argument signature; absent means the default profile, which needs nothing. */
env?: Record<string, string>) => Promise<ProviderCommandResult>;
/**
 * The explicit environment lock delegates model and credential configuration
 * to each native coding agent. In that mode Cezar must not second-guess the
 * agent's own credentials through the provider checks introduced by #652.
 *
 * Config-file model locks intentionally do not disable the checks: this bypass
 * is an operator-level process policy and only the exact documented `1` opts in.
 */
export declare function providerAuthChecksDisabled(env?: NodeJS.ProcessEnv): boolean;
export declare function isRuntimeProviderAuthFailure(message: string): boolean;
/** One authoritative runtime authentication incident. The identifier is opaque
 * and stable until the user explicitly acknowledges that exact incident. */
export interface RuntimeAuthFailureReport {
    status: ProviderStatus & {
        status: 'disconnected';
        authFailureId: string;
    };
    /** True only for the global latch edge, so callers can fan out one coarse
     * status update while every affected task still records its own callout. */
    transitioned: boolean;
}
export declare class ProviderAuthService {
    private readonly runCommand;
    private readonly now;
    private readonly platform;
    private readonly createAuthFailureId;
    private readonly runtimeFailures;
    private nextRuntimeFailureGeneration;
    private nextProbeGeneration;
    private completed?;
    private inFlight?;
    /** Per-account probe results, keyed by `profileCacheKey` (spec 2026-07-29-agent-profiles).
     *  Separate from `completed` because a second Claude login is a different answer to the same
     *  question, and sharing one slot would let whichever probe ran last speak for both. */
    private readonly completedProfiles;
    private readonly inFlightProfiles;
    constructor(options?: {
        runCommand?: RunProviderCommand;
        now?: () => number;
        platform?: NodeJS.Platform;
        createAuthFailureId?: () => string;
    });
    /**
     * Every provider's authentication state — STALE-WHILE-REVALIDATE, the same policy the health
     * snapshot uses.
     *
     * Once anything is known, a reader gets it immediately and an expired cache is refreshed BEHIND
     * the answer instead of in front of it. Awaiting the refresh is what made `GET
     * /providers/status` cost ~0.8s here (and ~3s on a slower box) every time the window lapsed:
     * the endpoint is read by the cockpit on a poll, so "occasionally slow" means "slow in the UI,
     * unpredictably". Only a genuinely cold cache waits, and after the boot warm there isn't one.
     *
     * `refresh: true` still blocks — it is what "Check again", `POST /providers/connect` and the
     * action gate's verify-before-refuse use, and they are asking precisely because they need an
     * answer that is true NOW.
     */
    status(options?: {
        refresh?: boolean;
    }): Promise<ProviderStatusResponse>;
    reportRuntimeAuthFailure(provider: ProviderId): RuntimeAuthFailureReport | null;
    /** Clear only the incident the caller actually observed. A stale retry must
     * never erase a rejection that arrived after the user began recovery. */
    clearRuntimeAuthFailure(provider: ProviderId, authFailureId: string): boolean;
    /**
     * The command that logs `provider` in, as a copyable one-liner.
     *
     * `configDir` points the login at a specific agent account (spec 2026-07-29-agent-profiles) —
     * without it, "Connect" on a second Claude account would sign the user into the FIRST one and
     * report success. Returns `null` when the dir cannot be embedded safely on this platform, and
     * the caller must then refuse rather than fall back to the bare command: a login aimed at the
     * wrong account is the failure this whole path exists to prevent.
     */
    loginCommand(provider: ProviderId, configDir?: string | null): string | null;
    installHint(provider: ProviderId): string;
    private withRuntimeFailures;
    private startFreshProbe;
    /**
     * One NON-default agent account's authentication state (spec 2026-07-29-agent-profiles).
     *
     * Deliberately a separate entry point from `status()`, which keeps answering exactly one row
     * per provider — the discovered default — so `GET /api/v1/providers/status` is byte-identical
     * for anyone with no extra accounts. Per-account rows are carried by the agent-profiles route.
     *
     * Cached on the same asymmetric lifetime as `status()` (`cacheTtlFor`: minutes for a connected
     * answer, a minute for anything else), keyed by `(provider, profileId)` so two Claude accounts never read
     * each other's answer. The runtime-auth latch is deliberately NOT applied: it is a coarse
     * per-provider signal and stamping it onto every account of that provider would mark an
     * untouched account as broken.
     */
    profileStatus(provider: ProviderId, profile: {
        id: string;
        configDir: string | null;
    }): Promise<ProviderStatus>;
    /**
     * Drop a cached per-account answer — used when an account's dir changes under us.
     *
     * TARGETED by default, because this cache is warmed at boot and is meant to survive: clearing
     * every account because ONE was repointed would throw away knowledge that is still true and make
     * the other accounts re-probe. Called with no argument it clears everything, which is what a
     * shutdown or a whole-store reload wants.
     */
    forgetProfileStatus(provider?: ProviderId, profileId?: string): void;
    /**
     * The cached answer for one account, or `undefined` when nothing is known yet — WITHOUT
     * spawning anything.
     *
     * Every probe shells out to an agent CLI, which costs hundreds of milliseconds per provider and
     * per account. A route whose real job is "what exists" must not pay that: `GET /api/v1/health`
     * already established this posture (it serves whatever the cache holds and never pays a `gh`
     * shell-out), and this is the same rule for auth.
     *
     * The peeks deliberately ignore the TTLs below — they answer with the last thing known, however
     * old. The short window exists to stop a stale NEGATIVE from blocking a run, and a peek blocks
     * nothing: it fills in a dot on a settings page that offers Connect and a re-check right beside
     * it. Applying the window here instead made the whole cache expire in five seconds on any machine
     * where a single provider is logged out — which is most of them, since few people are signed into
     * all three — and put the shell-out straight back on the page load this exists to protect.
     * Callers that need a guaranteed-fresh answer call {@link status} or pass `refresh`.
     */
    peekProfileStatus(provider: ProviderId, profileId: string): ProviderStatus | undefined;
    /** The cached default-profile rows, or `undefined` when the probe has never completed. Same
     *  no-spawn contract as {@link peekProfileStatus}. */
    peekStatus(): ProviderStatusResponse | undefined;
    private probe;
}
