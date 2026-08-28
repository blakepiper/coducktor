import { z } from 'zod';
/** User-facing reasoning policy. `auto` is resolved independently for each agent chunk. */
export declare const reasoningEffortSchema: z.ZodEnum<{
    auto: "auto";
    high: "high";
    low: "low";
    medium: "medium";
    xhigh: "xhigh";
}>;
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
/** A concrete level sent to a backend after the run manager resolves `auto`. */
export declare const concreteReasoningEffortSchema: z.ZodEnum<{
    high: "high";
    low: "low";
    medium: "medium";
    xhigh: "xhigh";
}>;
export type ConcreteReasoningEffort = z.infer<typeof concreteReasoningEffortSchema>;
