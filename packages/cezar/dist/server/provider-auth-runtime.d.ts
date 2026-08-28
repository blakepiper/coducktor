import { type ProviderAuthService, type ProviderStatus } from '../core/provider-auth.ts';
import type { RunStore } from '../runs/store.ts';
export declare function watchProviderRuntimeAuthFailures(store: RunStore, providerAuth: ProviderAuthService, onInvalidated: (status: ProviderStatus) => void): () => void;
/**
 * Process-wide dedupe for store observation. The same boot store is wired
 * before recovery and again when the HTTP app is constructed; lazy stores are
 * wired both at creation and at the existing context-built hook. One listener
 * per RunStore keeps those lifecycle overlaps harmless.
 */
export declare class ProviderRuntimeAuthObserver {
    private readonly providerAuth;
    private readonly onInvalidated;
    private readonly watched;
    constructor(providerAuth: ProviderAuthService, onInvalidated: (status: ProviderStatus) => void);
    watch(store: RunStore): void;
}
/**
 * Boot ordering seam: observation must exist before recovery starts because a
 * resumed runner can emit its first normalized error before recover() returns.
 */
export declare function recoverWithProviderRuntimeAuthObservation(store: RunStore, recover: () => Promise<void>, observer: ProviderRuntimeAuthObserver): Promise<void>;
