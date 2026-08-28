import { FileProviderUsageSnapshotStore } from '../../workspace/provider-usage.js';
import { loadWorkspaceConfig } from '../../workspace/config.js';
import { createInstalledClaudeUsageAdapter } from './claude-usage-adapter.js';
import { createInstalledCodexUsageAdapter } from './codex-usage-adapter.js';
import { QuotaCoordinator } from './coordinator.js';
import { quotaRoutingPolicy } from './policy.js';
import { ProviderUsageService } from './usage-service.js';
/** One process-wide quota runtime; project managers share its reservations and cache. */
export async function createQuotaRuntime(repoRoot, config) {
    const workspaceConfig = config ?? await loadWorkspaceConfig();
    const usage = new ProviderUsageService({
        adapters: [
            createInstalledClaudeUsageAdapter({ timeoutMs: workspaceConfig.quotaRouting.requestTimeoutSeconds * 1_000 }),
            createInstalledCodexUsageAdapter({
                cwd: repoRoot,
                timeoutMs: workspaceConfig.quotaRouting.requestTimeoutSeconds * 1_000,
            }),
        ],
        cacheTtlMs: workspaceConfig.quotaRouting.cacheTtlSeconds * 1_000,
        refreshIntervalMs: workspaceConfig.quotaRouting.refreshIntervalSeconds * 1_000,
        store: new FileProviderUsageSnapshotStore(),
    });
    await usage.restore();
    const coordinator = new QuotaCoordinator(usage, () => quotaRoutingPolicy(workspaceConfig));
    return {
        usage,
        coordinator,
        updateConfig: (next) => coordinator.setPolicy(quotaRoutingPolicy(next)),
        dispose: () => {
            coordinator.dispose();
            usage.dispose();
        },
    };
}
//# sourceMappingURL=runtime.js.map