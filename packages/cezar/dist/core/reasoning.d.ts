import type { ConcreteReasoningEffort, ReasoningEffort } from '../contract/index.js';
/** Resolve the authored policy at the chunk boundary. Auto stays deterministic and explainable,
 * while a fresh session gets a fresh decision from its current task/step prompt. */
export declare function resolveReasoningEffort(requested: ReasoningEffort | undefined, context: {
    task: string;
    prompt: string;
    stepName?: string;
}): ConcreteReasoningEffort;
