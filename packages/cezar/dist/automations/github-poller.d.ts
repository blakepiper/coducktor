import { z } from 'zod';
import type { AutomationDefinition, AutomationEvent } from './types.ts';
declare const githubItemSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodNumber>;
    node_id: z.ZodString;
    number: z.ZodNumber;
    title: z.ZodString;
    html_url: z.ZodString;
    created_at: z.ZodString;
    updated_at: z.ZodOptional<z.ZodString>;
    user: z.ZodObject<{
        login: z.ZodString;
    }, z.core.$strip>;
    assignees: z.ZodDefault<z.ZodArray<z.ZodObject<{
        login: z.ZodString;
    }, z.core.$strip>>>;
    labels: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
    }, z.core.$strip>>>;
    repository_url: z.ZodString;
    pull_request: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>;
declare const timelineEventSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodNumber>;
    node_id: z.ZodOptional<z.ZodString>;
    event: z.ZodEnum<{
        labeled: "labeled";
        unlabeled: "unlabeled";
    }>;
    created_at: z.ZodString;
    label: z.ZodObject<{
        name: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export interface GithubCandidate {
    eventId: string;
    event: AutomationEvent;
    timestamp: string;
    tieBreaker: string;
    repo: string;
    nodeId: string;
    number: number;
    title: string;
    url: string;
    author: string;
    assignees: string[];
    labels: string[];
    changedLabel?: string;
}
export interface GithubPollResult {
    candidates: GithubCandidate[];
    truncated: boolean;
    pages: number;
    cursor?: {
        timestamp: string;
        tieBreaker: string;
    };
}
export interface GithubPollerOptions {
    run?: (executable: string, args: readonly string[]) => Promise<string>;
}
export interface GithubPollOptions {
    since?: string;
}
export declare class GithubPoller {
    private readonly run;
    constructor(options?: GithubPollerOptions);
    poll(owner: string, repo: string, definition: AutomationDefinition, options?: GithubPollOptions): Promise<GithubPollResult>;
    private timeline;
}
export declare function buildSearchQuery(owner: string, repo: string, definition: AutomationDefinition, family?: 'issues' | 'prs' | 'mixed', activity?: 'created' | 'updated', since?: string): string;
export declare function reconstructLabelEvents(owner: string, repo: string, item: z.infer<typeof githubItemSchema>, timeline: z.infer<typeof timelineEventSchema>[]): GithubCandidate[];
export declare function matchesFilters(candidate: GithubCandidate, definition: AutomationDefinition): boolean;
export {};
