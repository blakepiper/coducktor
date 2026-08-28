const DEFAULT_TTL_MS = 5 * 60 * 1_000;
/** Host-level, in-memory model discovery cache shared by every workspace. */
export class RunnerModelCatalog {
    #adapters;
    #now;
    #ttlMs;
    #cache = new Map();
    #inFlight = new Map();
    constructor(options) {
        this.#adapters = options.adapters;
        this.#now = options.now ?? Date.now;
        this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    }
    get(runner) {
        const cached = this.#cache.get(runner);
        if (cached && this.#now() < cached.expiresAt) {
            if (cached.failureReason) {
                return Promise.resolve({
                    runner,
                    models: cached.models,
                    source: cached.models.length > 0 ? 'cache' : 'unavailable',
                    stale: cached.models.length > 0,
                    reason: cached.failureReason,
                });
            }
            return Promise.resolve({ runner, models: cached.models, source: 'cache', stale: false });
        }
        const pending = this.#inFlight.get(runner);
        if (pending)
            return pending;
        const refresh = this.#refresh(runner, cached).finally(() => {
            this.#inFlight.delete(runner);
        });
        this.#inFlight.set(runner, refresh);
        return refresh;
    }
    async #refresh(runner, cached) {
        try {
            const adapter = this.#adapters[runner];
            if (!adapter)
                throw new Error('adapter unavailable');
            const models = await adapter.discover();
            const value = { models: [...models], expiresAt: this.#now() + this.#ttlMs };
            this.#cache.set(runner, value);
            return { runner, models: value.models, source: 'live', stale: false };
        }
        catch {
            const reason = unavailableReason(runner);
            if (cached) {
                this.#cache.set(runner, { models: cached.models, expiresAt: this.#now() + this.#ttlMs, failureReason: reason });
                return { runner, models: cached.models, source: 'cache', stale: true, reason };
            }
            this.#cache.set(runner, { models: [], expiresAt: this.#now() + this.#ttlMs, failureReason: reason });
            return { runner, models: [], source: 'unavailable', stale: false, reason };
        }
    }
}
function unavailableReason(runner) {
    const name = runner === 'codex' ? 'Codex' : runner === 'claude' ? 'Claude' : 'OpenCode';
    return `${name} model discovery is temporarily unavailable`;
}
//# sourceMappingURL=runner-model-catalog.js.map