import { PROVIDER_IDS } from '../core/provider-auth.js';
import { stepKind } from '../workflows/types.js';
const ORDER = PROVIDER_IDS;
const LABEL = {
    claude: 'Claude Code',
    codex: 'Codex',
    opencode: 'OpenCode',
    pi: 'pi',
};
export function providersRequiredByWorkflow(workflow, fallback) {
    const required = new Set();
    for (const step of workflow.steps) {
        const selected = step.runner ?? fallback;
        if (stepKind(step) === 'agent' && selected !== 'auto')
            required.add(selected);
    }
    return ORDER.filter((provider) => required.has(provider));
}
export function providerForExistingRun(run, override) {
    if (override)
        return override;
    return run.runner ?? 'claude';
}
/** The provider that owns a currently live session, when the record is attributed. */
export function providerForActiveRun(run) {
    const current = run.currentStepId
        ? run.steps.find((step) => step.id === run.currentStepId)
        : undefined;
    if (current?.backend)
        return current.backend;
    // `execute()` persists the task backend before it starts a step. This is the
    // conservative fallback for older records whose current step lacks affinity.
    if (run.runner)
        return run.runner;
    // Pre-affinity records can still carry a prior attributed session. It is a
    // better fallback than guessing Claude, but never outranks the live step or
    // the run's current runner.
    for (let index = run.steps.length - 1; index >= 0; index -= 1) {
        const backend = run.steps[index]?.backend;
        if (backend)
            return backend;
    }
    return 'claude';
}
export function unavailableProviderMessage(required, response) {
    for (const provider of required) {
        const row = response.providers.find(({ provider: id }) => id === provider);
        if (row?.enabled === false) {
            return `${LABEL[provider]} is disabled. Enable it in Settings → Agents → Providers.`;
        }
        if (row?.status !== 'connected') {
            return `${LABEL[provider]} credentials are unavailable. Authorize it in Settings → Agents → Providers.`;
        }
    }
    return null;
}
//# sourceMappingURL=provider-action-gate.js.map