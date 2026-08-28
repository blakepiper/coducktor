import type { AutoProvider } from '../runner-selection.ts';
import type { ProviderUsageSnapshot } from './types.ts';
export type { ProviderQuotaHealth, ProviderUsageSnapshot, ProviderUsageWindow } from './types.ts';
export interface ProviderRoutingPolicy {
    enabled: boolean;
    stopNewWorkAtPercent: number;
    longWindowStopAtPercent: number;
    resumeBelowPercent: number;
    maxConcurrent: number;
}
export interface QuotaRoutingPolicy {
    enabled: boolean;
    providerOrder: readonly AutoProvider[];
    unknownUsagePolicy: 'allow' | 'deny';
    providers: Readonly<Record<AutoProvider, ProviderRoutingPolicy>>;
}
export interface ProviderRoutingState {
    available: boolean;
    authenticated: boolean;
    activeCount: number;
    snapshot?: ProviderUsageSnapshot;
    /** A provider soft-stopped by a prior observation stays stopped until a reset
     * or a usage value below `resumeBelowPercent` proves recovery. */
    softExhausted: boolean;
}
export type ProviderIneligibility = 'disabled' | 'unavailable' | 'unauthenticated' | 'attempted' | 'concurrency_full' | 'hard_exhausted' | 'soft_exhausted' | 'auth_error' | 'unknown_usage';
export interface ConsideredProvider {
    provider: AutoProvider;
    eligible: boolean;
    reason?: ProviderIneligibility;
}
export type RoutingDecision = {
    kind: 'selected';
    provider: AutoProvider;
    considered: ConsideredProvider[];
    /** Coordinator-owned next hysteresis state. */
    softExhausted: ReadonlySet<AutoProvider>;
} | {
    kind: 'wait';
    considered: ConsideredProvider[];
    retryAt?: string;
    softExhausted: ReadonlySet<AutoProvider>;
} | {
    kind: 'error';
    message: string;
    considered: ConsideredProvider[];
    softExhausted: ReadonlySet<AutoProvider>;
};
export interface RouteAutoStepInput {
    policy: QuotaRoutingPolicy;
    providers: Readonly<Record<AutoProvider, ProviderRoutingState>>;
    /** Providers that already ended this same workflow step with a confirmed
     * quota failure. The coordinator clears this set only on a new recovery
     * generation. */
    attemptedProviders?: ReadonlySet<AutoProvider>;
}
/**
 * Deterministically choose the first eligible automatic provider. This is
 * intentionally synchronous: refreshes, locks, reservations, and persistence
 * belong to the coordinator around this function.
 */
export declare function routeAutoStep(input: RouteAutoStepInput): RoutingDecision;
