import { z } from 'zod';
/**
 * The global follow-up inbox (spec 007): `.ai/cezar/todos.json`, a flat JSON
 * array agents append to (via CEZ_TODOS_FILE). Agent entries are external
 * data — each one is zod-validated on read and malformed ones are skipped
 * with a warning, never fatal. Server writes are serialized with an
 * in-process lock (the janitor `withLock` pattern) and land atomically
 * (tmp + rename, the runs.json pattern).
 */
export declare const todoSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    ts: z.ZodOptional<z.ZodString>;
    taskId: z.ZodOptional<z.ZodString>;
    summary: z.ZodString;
    action: z.ZodOptional<z.ZodString>;
    prUrl: z.ZodOptional<z.ZodString>;
    suggestedSkill: z.ZodOptional<z.ZodString>;
    suggestedArgs: z.ZodOptional<z.ZodString>;
    suggestedPrompt: z.ZodOptional<z.ZodString>;
    runnable: z.ZodOptional<z.ZodBoolean>;
    startedTaskId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TodoItem = z.infer<typeof todoSchema> & {
    id: string;
};
export declare function todosPath(dataDir: string): string;
export declare function readTodos(dataDir: string): Promise<TodoItem[]>;
/** Check off (delete) an entry. False when the id isn't there. */
export declare function removeTodo(dataDir: string, id: string): Promise<boolean>;
/** The task text "▶ Run" turns an entry into: the suggested prompt (or the summary when the
 *  entry carries none), plus the suggested args as a trailing line. The single server-side
 *  source for `POST /api/todos/:id/start`; the cockpit's prefill copy
 *  (`packages/web/src/routes/inbox.tsx`, #374) lives in another process and cannot import this, so
 *  the two are pinned to the shared cases in `test/fixtures/todo-task-text.json`. */
export declare function todoTaskText(todo: Pick<TodoItem, 'summary' | 'suggestedPrompt' | 'suggestedArgs'>): string;
/** Record that "▶ Run" turned the entry into task `taskId`. The entry stays
 *  in the file as an audit trail; the GUI hides started entries. First start wins: an entry
 *  that already carries a `startedTaskId` is left untouched and answers false, so the
 *  best-effort `todoId` bookkeeping on `POST /api/runs` (#374) can never overwrite the audit
 *  trail — the check shares this lock, so two concurrent launches cannot both claim the entry. */
export declare function markStarted(dataDir: string, id: string, taskId: string): Promise<boolean>;
/** Subscribe to `dataDir`'s inbox changes; the watch is created on the first
 *  subscription and torn down when the last subscriber leaves. Returns the
 *  unsubscribe function (idempotent — a stale double call can never tear down
 *  a watch that later subscribers re-created). */
export declare function onTodosChanged(dataDir: string, cb: () => void): () => void;
/** Test hook: is a live watch registered for `dataDir`? */
export declare function todosWatchActive(dataDir: string): boolean;
