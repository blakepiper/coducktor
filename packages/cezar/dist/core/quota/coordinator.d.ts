import type { AutoProvider } from '../runner-selection.ts';
import { type QuotaRoutingPolicy, type RoutingDecision } from './router.ts';
import type { ProviderAccountRef } from './types.ts';
import { ProviderUsageService } from './usage-service.ts';
export interface QuotaProviderCandidate {
    account: ProviderAccountRef;
    available: boolean;
    authenticated: boolean;
}
export interface QuotaAcquireInput {
    candidates: Readonly<Record<AutoProvider, QuotaProviderCandidate>>;
    attemptedProviders?: ReadonlySet<AutoProvider>;
    /** A runtime quota failure must not reuse its previously healthy cache. */
    forceRefresh?: boolean;
}
export interface ProviderLease {
    provider: AutoProvider;
    profileId: string;
    release(): void;
}
export type QuotaAcquireResult = Exclude<RoutingDecision, {
    kind: 'selected';
}> | {
    kind: 'selected';
    provider: AutoProvider;
    decision: RoutingDecision & {
        kind: 'selected';
    };
    lease: ProviderLease;
};
/**
 * Serializes refresh → decision → reservation so two queued runs cannot both
 * observe the final provider slot. It is process-scoped; cross-process usage
 * remains advisory by design.
 */
export declare class QuotaCoordinator {
    #private;
    private readonly usage;
    constructor(usage: ProviderUsageService, policy: () => QuotaRoutingPolicy);
    setPolicy(policy: QuotaRoutingPolicy): void;
    onWake(listener: () => void): () => void;
    /** Publish a confirmed runner-side quota failure before its lease is released.
     * The next selection cannot send fresh work back to this account merely
     * because usage telemetry has not caught up yet. */
    reportQuotaExhausted(account: ProviderAccountRef): void;
    acquire(input: QuotaAcquireInput): Promise<QuotaAcquireResult>;
    dispose(): void;
}
