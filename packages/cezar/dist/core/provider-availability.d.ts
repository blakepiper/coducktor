import { type ProviderId, type ProviderStatus, type ProviderStatusResponse } from './provider-auth.ts';
export declare function applyProviderEnablement(response: ProviderStatusResponse, disabledProviders: readonly ProviderId[]): ProviderStatusResponse;
export declare function isProviderUsable(row: ProviderStatus): boolean;
