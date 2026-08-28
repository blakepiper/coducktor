import { type WorkflowDef } from './types.ts';
export declare const WORKFLOWS_DIR = ".ai/cezar/workflows";
export interface WorkflowLoadIssue {
    path: string;
    message: string;
}
/**
 * Load the workflow catalog: the built-in `quick-task` plus every
 * `.ai/cezar/workflows/*.{yaml,yml}` in the repo. File workflows win name
 * collisions with built-ins. Invalid files are reported, never fatal.
 */
export declare function loadWorkflows(repoRoot: string): Promise<{
    workflows: WorkflowDef[];
    issues: WorkflowLoadIssue[];
}>;
