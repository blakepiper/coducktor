import type { WorkspaceConfig } from '../../workspace/config.ts';
import type { QuotaRoutingPolicy } from './router.ts';
/**
 * The coordinator deliberately accepts only its synchronous, execution-relevant
 * policy. Keep workspace persistence details (refresh cadence and request
 * timeout) out of the pure router.
 */
export declare function quotaRoutingPolicy(config: WorkspaceConfig): QuotaRoutingPolicy;
