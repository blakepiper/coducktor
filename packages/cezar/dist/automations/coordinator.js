import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AutomationStore } from './store.js';
/**
 * Lightweight workspace index for project automation state. Discovery checks
 * only the optional definitions file and never materializes a RunManager or a
 * full ProjectContext. Schedulers attach to these handles in Phase 4.
 */
export class AutomationCoordinator {
    options;
    stores = new Map();
    roots = new Map();
    constructor(options) {
        this.options = options;
    }
    async refresh() {
        let projects;
        try {
            projects = await this.options.listProjects();
        }
        catch (error) {
            this.options.warn?.(`Unable to refresh GitHub automations: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        const present = new Set(projects.map((project) => project.id));
        for (const id of this.stores.keys()) {
            if (!present.has(id))
                this.remove(id);
        }
        for (const project of projects) {
            if (project.status === 'missing') {
                this.remove(project.id);
                continue;
            }
            this.roots.set(project.id, project.root);
            const definitions = join(project.root, '.ai/cezar/automations.json');
            if (existsSync(definitions))
                this.store(project.id, project.root);
        }
    }
    store(projectId, root) {
        const existing = this.stores.get(projectId);
        if (existing)
            return existing;
        const projectRoot = root ?? this.roots.get(projectId);
        if (!projectRoot)
            return undefined;
        const store = AutomationStore.open(join(projectRoot, '.ai/cezar'), { warn: this.options.warn });
        this.stores.set(projectId, store);
        this.roots.set(projectId, projectRoot);
        return store;
    }
    enabledProjectIds() {
        return [...this.stores.entries()]
            .filter(([, store]) => store.list().some((definition) => definition.enabled))
            .map(([id]) => id);
    }
    remove(projectId) {
        this.stores.delete(projectId);
        this.roots.delete(projectId);
    }
    ids() {
        return [...this.stores.keys()];
    }
}
//# sourceMappingURL=coordinator.js.map