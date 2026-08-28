function earliestReset(snapshot) {
    const times = (snapshot?.windows ?? [])
        .map((window) => window.resetsAt)
        .filter((value) => value !== undefined && Number.isFinite(Date.parse(value)))
        .sort();
    return times[0];
}
function windowExhausted(window, policy) {
    if (window.hardLimitReached)
        return true;
    if (window.usedPercent === null)
        return false;
    const threshold = window.kind === 'long' || window.kind === 'model'
        ? policy.longWindowStopAtPercent
        : policy.stopNewWorkAtPercent;
    return window.usedPercent >= threshold;
}
function recoveredBelowResume(snapshot, resumeBelowPercent) {
    const measured = snapshot.windows
        .map((window) => window.usedPercent)
        .filter((used) => used !== null);
    return measured.length > 0 && measured.every((used) => used < resumeBelowPercent);
}
/**
 * Deterministically choose the first eligible automatic provider. This is
 * intentionally synchronous: refreshes, locks, reservations, and persistence
 * belong to the coordinator around this function.
 */
export function routeAutoStep(input) {
    const considered = [];
    const softExhausted = new Set();
    const retryAt = [];
    const attempted = input.attemptedProviders ?? new Set();
    if (!input.policy.enabled) {
        return { kind: 'error', message: 'quota-aware routing is disabled', considered, softExhausted };
    }
    for (const provider of input.policy.providerOrder) {
        const settings = input.policy.providers[provider];
        const state = input.providers[provider];
        const snapshot = state.snapshot;
        const reset = earliestReset(snapshot);
        if (reset)
            retryAt.push(reset);
        let reason;
        if (!settings.enabled)
            reason = 'disabled';
        else if (!state.available)
            reason = 'unavailable';
        else if (!state.authenticated)
            reason = 'unauthenticated';
        else if (attempted.has(provider))
            reason = 'attempted';
        else if (state.activeCount >= settings.maxConcurrent)
            reason = 'concurrency_full';
        else if (!snapshot || snapshot.stale || snapshot.health === 'unknown') {
            if (input.policy.unknownUsagePolicy === 'deny')
                reason = 'unknown_usage';
        }
        else if (snapshot.health === 'auth_error') {
            reason = 'auth_error';
        }
        else if (snapshot.health === 'unavailable') {
            reason = 'unavailable';
        }
        else if (snapshot.health === 'hard_exhausted' || snapshot.windows.some((window) => window.hardLimitReached)) {
            reason = 'hard_exhausted';
        }
        else {
            const exhausted = snapshot.health === 'soft_exhausted'
                || snapshot.windows.some((window) => windowExhausted(window, settings));
            const heldByHysteresis = state.softExhausted && !recoveredBelowResume(snapshot, settings.resumeBelowPercent);
            if (exhausted || heldByHysteresis) {
                softExhausted.add(provider);
                reason = 'soft_exhausted';
            }
        }
        if (reason) {
            considered.push({ provider, eligible: false, reason });
            continue;
        }
        considered.push({ provider, eligible: true });
        return { kind: 'selected', provider, considered, softExhausted };
    }
    retryAt.sort();
    return {
        kind: 'wait',
        considered,
        ...(retryAt[0] !== undefined ? { retryAt: retryAt[0] } : {}),
        softExhausted,
    };
}
//# sourceMappingURL=router.js.map