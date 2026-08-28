function cacheKey(account) {
    return `${account.provider}:${account.profileId}`;
}
const HEALTHS = new Set([
    'available', 'soft_exhausted', 'hard_exhausted', 'auth_error', 'unavailable', 'unknown',
]);
const WINDOW_KINDS = new Set(['short', 'long', 'model', 'unknown']);
const SAFE_SOURCES = new Set(['claude-oauth', 'codex-app-server', 'cache', 'runtime', 'none', 'fake']);
const SAFE_ERROR_CODES = new Set([
    'auth_error', 'rate_limited', 'request_failed', 'invalid_response', 'adapter_unavailable', 'refresh_failed', 'provider_error',
]);
const GENERIC_ERROR_MESSAGE = 'Provider usage could not be refreshed.';
const ERROR_MESSAGES = {
    auth_error: 'Provider authentication is unavailable.',
    rate_limited: 'Provider usage is temporarily rate limited.',
    request_failed: 'Provider usage could not be refreshed.',
    invalid_response: 'Provider usage response was invalid.',
    adapter_unavailable: 'Usage is not available for this provider.',
    refresh_failed: 'Provider usage could not be refreshed.',
    provider_error: GENERIC_ERROR_MESSAGE,
};
/**
 * Adapters are an internal seam, but their input is still provider-controlled.
 * Normalize again here before a reading can enter the cache or an API response;
 * this keeps a malformed adapter/plugin from smuggling raw response text or a
 * credential into durable state.
 */
function sanitizeReading(provider, value) {
    if (typeof value !== 'object' || value === null) {
        return {
            health: 'unknown', source: provider, windows: [],
            error: { code: 'provider_error', message: GENERIC_ERROR_MESSAGE },
        };
    }
    const reading = value;
    const health = typeof reading.health === 'string' && HEALTHS.has(reading.health)
        ? reading.health
        : 'unknown';
    const source = typeof reading.source === 'string' && SAFE_SOURCES.has(reading.source)
        ? reading.source
        : provider;
    const windows = [];
    if (Array.isArray(reading.windows)) {
        for (const value of reading.windows.slice(0, 8)) {
            if (typeof value !== 'object' || value === null)
                continue;
            const window = value;
            if (typeof window.kind !== 'string' || !WINDOW_KINDS.has(window.kind))
                continue;
            const usedPercent = window.usedPercent;
            if (usedPercent !== null && (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100))
                continue;
            const resetsAt = typeof window.resetsAt === 'string'
                && window.resetsAt.length <= 64
                && Number.isFinite(Date.parse(window.resetsAt))
                ? window.resetsAt
                : undefined;
            windows.push({
                kind: window.kind,
                usedPercent: usedPercent,
                ...(resetsAt ? { resetsAt } : {}),
                ...(window.hardLimitReached === true ? { hardLimitReached: true } : {}),
            });
        }
    }
    const rawError = reading.error;
    let error;
    if (typeof rawError === 'object' && rawError !== null) {
        const code = rawError.code;
        const safeCode = typeof code === 'string' && SAFE_ERROR_CODES.has(code) ? code : 'provider_error';
        error = { code: safeCode, message: ERROR_MESSAGES[safeCode] ?? GENERIC_ERROR_MESSAGE };
    }
    return { health, source, windows, ...(error ? { error } : {}) };
}
function staleSnapshot(snapshot, now, ttlMs) {
    return {
        ...snapshot,
        stale: Date.parse(snapshot.fetchedAt) + ttlMs <= now,
    };
}
function equalMeaningful(a, b) {
    if (!a)
        return false;
    return a.provider === b.provider
        && a.profileId === b.profileId
        && a.health === b.health
        && a.source === b.source
        && a.stale === b.stale
        && JSON.stringify(a.windows) === JSON.stringify(b.windows)
        && JSON.stringify(a.error) === JSON.stringify(b.error);
}
function earliestFutureReset(snapshot, now) {
    return snapshot.windows
        .map((window) => Date.parse(window.resetsAt ?? ''))
        .filter((time) => Number.isFinite(time) && time > now)
        .sort((a, b) => a - b)[0];
}
/**
 * Process-shared cache for provider usage. It serializes only each account's
 * refresh; the coordinator owns cross-account selection and reservations.
 */
export class ProviderUsageService {
    options;
    #adapters = new Map();
    #cache = new Map();
    #inFlight = new Map();
    #listeners = new Set();
    #resetTimers = new Map();
    #refreshTimer;
    #now;
    constructor(options) {
        this.options = options;
        this.#now = options.now ?? Date.now;
        for (const adapter of options.adapters)
            this.#adapters.set(adapter.provider, adapter);
        if (options.refreshIntervalMs !== undefined && options.refreshIntervalMs > 0) {
            this.#refreshTimer = setInterval(() => {
                for (const snapshot of this.#cache.values()) {
                    void this.refresh({ provider: snapshot.provider, profileId: snapshot.profileId }, true);
                }
            }, options.refreshIntervalMs);
            this.#refreshTimer.unref?.();
        }
    }
    /** Load a prior sanitized cache. Restored values always begin stale. */
    async restore() {
        if (!this.options.store)
            return;
        const snapshots = await this.options.store.load().catch(() => []);
        for (const snapshot of snapshots) {
            const reading = sanitizeReading(snapshot.provider, snapshot);
            this.#cache.set(cacheKey(snapshot), { ...snapshot, ...reading, stale: true });
        }
    }
    get(account) {
        const snapshot = this.#cache.get(cacheKey(account));
        return snapshot && staleSnapshot(snapshot, this.#now(), this.options.cacheTtlMs);
    }
    onChange(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    async refresh(account, force = false) {
        const key = cacheKey(account);
        const cached = this.get(account);
        if (!force && cached && !cached.stale)
            return cached;
        const existing = this.#inFlight.get(key);
        if (existing)
            return existing;
        const refresh = this.#read(account).finally(() => this.#inFlight.delete(key));
        this.#inFlight.set(key, refresh);
        return refresh;
    }
    dispose() {
        if (this.#refreshTimer)
            clearInterval(this.#refreshTimer);
        for (const timer of this.#resetTimers.values())
            clearTimeout(timer);
        this.#resetTimers.clear();
        this.#listeners.clear();
    }
    async #read(account) {
        const adapter = this.#adapters.get(account.provider);
        const prior = this.#cache.get(cacheKey(account));
        let reading;
        if (!adapter) {
            reading = {
                health: 'unavailable', source: 'none', windows: [],
                error: { code: 'adapter_unavailable', message: 'Usage is not available for this provider.' },
            };
        }
        else {
            try {
                reading = sanitizeReading(account.provider, await adapter.read(account));
            }
            catch {
                reading = {
                    health: 'unknown', source: adapter.provider, windows: [],
                    error: { code: 'refresh_failed', message: 'Usage could not be refreshed.' },
                };
            }
        }
        const key = cacheKey(account);
        // A transient provider failure must not erase useful telemetry. Keep the last successful
        // snapshot visible, mark it stale, and attach the current sanitized error. Routing already
        // treats stale snapshots as unknown, so this improves the cockpit without making dispatch
        // trust data that failed to refresh.
        const snapshot = prior && reading.error && (prior.windows.length > 0 || prior.health !== 'unknown')
            ? { ...prior, source: reading.source, stale: true, error: reading.error }
            : {
                ...account,
                ...reading,
                fetchedAt: new Date(this.#now()).toISOString(),
                stale: false,
            };
        this.#cache.set(key, snapshot);
        this.#scheduleReset(account, snapshot);
        void this.#persist();
        if (!equalMeaningful(prior, snapshot)) {
            for (const listener of this.#listeners)
                listener(snapshot);
        }
        return snapshot;
    }
    #scheduleReset(account, snapshot) {
        const key = cacheKey(account);
        const previous = this.#resetTimers.get(key);
        if (previous)
            clearTimeout(previous);
        this.#resetTimers.delete(key);
        const resetAt = earliestFutureReset(snapshot, this.#now());
        if (resetAt === undefined)
            return;
        const timer = setTimeout(() => {
            this.#resetTimers.delete(key);
            void this.refresh(account, true);
        }, resetAt - this.#now());
        timer.unref?.();
        this.#resetTimers.set(key, timer);
    }
    async #persist() {
        if (!this.options.store)
            return;
        await this.options.store.save([...this.#cache.values()]).catch(() => undefined);
    }
}
//# sourceMappingURL=usage-service.js.map