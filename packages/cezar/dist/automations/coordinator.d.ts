import { AutomationStore } from './store.ts';
export interface AutomationProjectSource {
    id: string;
    root: string;
    status: 'ok' | 'missing' | 'not-git';
}
export interface AutomationCoordinatorOptions {
    listProjects: () => Promise<readonly AutomationProjectSource[]>;
    warn?: (message: string) => void;
}
/**
 * Lightweight workspace index for project automation state. Discovery checks
 * only the optional definitions file and never materializes a RunManager or a
 * full ProjectContext. Schedulers attach to these handles in Phase 4.
 */
export declare class AutomationCoordinator {
    private readonly options;
    private readonly stores;
    private readonly roots;
    constructor(options: AutomationCoordinatorOptions);
    refresh(): Promise<void>;
    store(projectId: string, root?: string): AutomationStore | undefined;
    enabledProjectIds(): string[];
    remove(projectId: string): void;
    ids(): string[];
}
