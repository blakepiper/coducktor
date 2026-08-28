import { routeAutoStep } from './router.js';
function accountKey(account) {
    return `${account.provider}:${account.profileId}`;
}
/**
 * Serializes refresh → decision → reservation so two queued runs cannot both
 * observe the final provider slot. It is process-scoped; cross-process usage
 * remains advisory by design.
 */
export class QuotaCoordinator {
    usage;
    #activeCounts = new Map();
    #softExhausted = new Set();
    /** Runtime quota failures are authoritative until a changed usage reading
     * proves the account has recovered. */
    #runtimeExhausted = new Set();
    #wakeListeners = new Set();
    #tail = Promise.resolve();
    #policy;
    #offUsage;
    constructor(usage, policy) {
        this.usage = usage;
        this.#policy = policy;
        this.#offUsage = usage.onChange((snapshot) => {
            const key = accountKey(snapshot);
            if (this.#runtimeExhausted.has(key) && snapshot.health === 'available') {
                this.#runtimeExhausted.delete(key);
            }
            this.#wake();
        });
    }
    setPolicy(policy) {
        this.#policy = () => policy;
        this.#wake();
    }
    onWake(listener) {
        this.#wakeListeners.add(listener);
        return () => this.#wakeListeners.delete(listener);
    }
    /** Publish a confirmed runner-side quota failure before its lease is released.
     * The next selection cannot send fresh work back to this account merely
     * because usage telemetry has not caught up yet. */
    reportQuotaExhausted(account) {
        this.#runtimeExhausted.add(accountKey(account));
        this.#wake();
    }
    async acquire(input) {
        return this.#serialized(async () => {
            const policy = this.#policy();
            const snapshots = await Promise.all(['claude', 'codex'].map(async (provider) => {
                const candidate = input.candidates[provider];
                if (!candidate.available || !candidate.authenticated)
                    return [provider, this.usage.get(candidate.account)];
                return [provider, await this.usage.refresh(candidate.account, input.forceRefresh)];
            }));
            const usage = Object.fromEntries(snapshots);
            const decision = routeAutoStep({
                policy,
                attemptedProviders: input.attemptedProviders,
                providers: {
                    claude: this.#state(input.candidates.claude, usage.claude),
                    codex: this.#state(input.candidates.codex, usage.codex),
                },
            });
            this.#recordHysteresis(input, decision);
            if (decision.kind !== 'selected')
                return decision;
            const candidate = input.candidates[decision.provider];
            const key = accountKey(candidate.account);
            this.#activeCounts.set(key, (this.#activeCounts.get(key) ?? 0) + 1);
            let released = false;
            return {
                kind: 'selected',
                provider: decision.provider,
                decision,
                lease: {
                    provider: decision.provider,
                    profileId: candidate.account.profileId,
                    release: () => {
                        if (released)
                            return;
                        released = true;
                        const next = (this.#activeCounts.get(key) ?? 1) - 1;
                        if (next <= 0)
                            this.#activeCounts.delete(key);
                        else
                            this.#activeCounts.set(key, next);
                        this.#wake();
                    },
                },
            };
        });
    }
    dispose() {
        this.#offUsage();
        this.#runtimeExhausted.clear();
        this.#wakeListeners.clear();
    }
    #state(candidate, snapshot) {
        const key = accountKey(candidate.account);
        return {
            available: candidate.available,
            authenticated: candidate.authenticated,
            activeCount: this.#activeCounts.get(key) ?? 0,
            snapshot: this.#runtimeExhausted.has(key) ? this.#hardExhaustedSnapshot(candidate.account, snapshot) : snapshot,
            softExhausted: this.#softExhausted.has(key),
        };
    }
    #hardExhaustedSnapshot(account, snapshot) {
        return {
            ...(snapshot ?? {
                ...account,
                fetchedAt: new Date().toISOString(),
                source: 'runtime',
                stale: false,
                windows: [],
            }),
            health: 'hard_exhausted',
        };
    }
    #recordHysteresis(input, decision) {
        for (const candidate of decision.considered) {
            const key = accountKey(input.candidates[candidate.provider].account);
            if (decision.softExhausted.has(candidate.provider))
                this.#softExhausted.add(key);
            // Only a fresh eligible evaluation proves recovery. A stale snapshot,
            // full concurrency, or a same-step exclusion must not erase a previous
            // soft stop and let the next queue sweep flap back onto the provider.
            else if (candidate.eligible)
                this.#softExhausted.delete(key);
        }
    }
    #wake() {
        for (const listener of this.#wakeListeners)
            listener();
    }
    async #serialized(operation) {
        const result = this.#tail.then(operation, operation);
        this.#tail = result.then(() => undefined, () => undefined);
        return result;
    }
}
//# sourceMappingURL=coordinator.js.map