import type { AutomationCoordinator } from './coordinator.ts';
import type { GithubCandidate, GithubPoller, GithubPollResult } from './github-poller.ts';
import type { AutomationStore } from './store.ts';
import type { AutomationDefinition } from './types.ts';
export interface AutomationLaunchResult {
    runId: string;
}
export type AutomationLauncher = (definition: AutomationDefinition, candidate: GithubCandidate, receiptId: string) => Promise<AutomationLaunchResult>;
export interface ProjectAutomationHandle {
    projectId: string;
    owner: string;
    repo: string;
    store: AutomationStore;
    poller: GithubPoller;
    launch?: AutomationLauncher;
    onChange?: (automationId: string, revision: number) => void;
}
export declare class ProjectAutomationScheduler {
    private readonly handle;
    constructor(handle: ProjectAutomationHandle);
    check(definition: AutomationDefinition, mode?: 'preview' | 'execute'): Promise<GithubPollResult>;
    private launch;
    private recordFailure;
}
export interface WorkspaceAutomationSchedulerOptions {
    coordinator: AutomationCoordinator;
    handle: (projectId: string, store: AutomationStore) => ProjectAutomationHandle | undefined;
    now?: () => number;
}
/** One workspace timer, created only while at least one enabled definition exists. */
export declare class WorkspaceAutomationScheduler {
    private readonly options;
    private timer?;
    private stopped;
    private scheduleGeneration;
    constructor(options: WorkspaceAutomationSchedulerOptions);
    start(): Promise<void>;
    reschedule(): Promise<void>;
    stop(): void;
    hasTimer(): boolean;
    private schedule;
}
