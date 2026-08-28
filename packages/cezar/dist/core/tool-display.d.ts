/**
 * Tool display model — turns a backend tool name + raw input into the
 * `{toolKind, title, subtitle?}` a tool card renders. Computed ONCE here in
 * the protocol layer (paseo's pattern), never in components, so the thread,
 * activity groups and notifications all say the same thing.
 *
 * Pure function over untrusted input: tool inputs come off the wire and may
 * be null, partial (streamed incrementally) or arbitrarily malformed —
 * `toolDisplay` must never throw.
 *
 * Known names covered (matched case-insensitively so claude's `Bash` and
 * opencode's `bash` share one row):
 *  - claude:   Bash, Edit, Write, NotebookEdit, Read, Glob, Grep, WebFetch,
 *              WebSearch, Task, Agent, Skill, TodoWrite, TaskCreate,
 *              TaskUpdate, TaskList, mcp__server__tool
 *  - codex:    commandExecution, contextCompaction, fileChange, imageView,
 *              mcpToolCall, webSearch, plan
 *              (codex's checklist arrives as the `turn/plan/updated`
 *              notification, not as a tool call — `todoList` is kept below only
 *              as tolerance for its non-app-server transports)
 *  - opencode: bash, edit, write, read, grep, glob, webfetch, task, todowrite
 */
import type { ToolKind } from './ui-events.ts';
export interface ToolDisplay {
    toolKind: ToolKind;
    /** Human line for the card trigger, e.g. "Ran npm test". */
    title: string;
    /** Secondary detail, e.g. the claude Bash `description`. */
    subtitle?: string;
}
export declare function toolDisplay(name: string, input?: unknown): ToolDisplay;
