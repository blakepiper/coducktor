import { type WorkspaceConfig } from '../../workspace/config.ts';
import { QuotaCoordinator } from './coordinator.ts';
import { ProviderUsageService } from './usage-service.ts';
export interface QuotaRuntime {
    usage: ProviderUsageService;
    coordinator: QuotaCoordinator;
    updateConfig(config: WorkspaceConfig): void;
    dispose(): void;
}
/** One process-wide quota runtime; project managers share its reservations and cache. */
export declare function createQuotaRuntime(repoRoot: string, config?: WorkspaceConfig): Promise<QuotaRuntime>;
