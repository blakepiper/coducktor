import type { RunStore } from '../runs/store.ts';
import type { RunManager } from '../workflows/run.ts';
import type { GithubCandidate } from './github-poller.ts';
import type { AutomationDefinition } from './types.ts';
export declare function validateAutomationPrompt(prompt: string): string | null;
export declare function renderAutomationTask(definition: AutomationDefinition, candidate: GithubCandidate): string;
export declare function launchAutomationRun(options: {
    root: string;
    manager: RunManager;
    store: RunStore;
    definition: AutomationDefinition;
    candidate: GithubCandidate;
    receiptId: string;
}): Promise<{
    runId: string;
}>;
/** Reserved receipts are reconciled against additive run provenance after restart. */
export declare function reconcileAutomationReceipts(automationStore: import('./store.js').AutomationStore, runStore: RunStore): number;
