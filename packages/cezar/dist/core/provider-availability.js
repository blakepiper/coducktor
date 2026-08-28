import { providerAuthChecksDisabled, } from './provider-auth.js';
export function applyProviderEnablement(response, disabledProviders) {
    const disabled = new Set(providerAuthChecksDisabled() ? [] : disabledProviders);
    return {
        providers: response.providers.map((row) => ({
            ...row,
            enabled: !disabled.has(row.provider),
        })),
    };
}
export function isProviderUsable(row) {
    return row.enabled !== false && row.status === 'connected';
}
//# sourceMappingURL=provider-availability.js.map