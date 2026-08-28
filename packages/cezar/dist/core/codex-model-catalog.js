import { z } from 'zod';
import { readNdjson } from './ndjson.js';
import { CodexAppServerRpc, endCodexAppServer, resolveCodexExecutable, spawnCodexAppServer, } from './codex-app-server-transport.js';
const modelSchema = z.object({
    model: z.string(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    hidden: z.boolean().optional(),
    supportedReasoningEfforts: z.array(z.string().min(1)).optional(),
}).passthrough();
const pageSchema = z.object({
    data: z.array(modelSchema),
    nextCursor: z.string().nullable().optional(),
}).passthrough();
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000;
const MAX_MODEL_PAGES = 25;
const MAX_MODELS = 500;
/** Discover the visible catalog exposed by the authenticated host Codex CLI. */
export async function discoverCodexModels(options) {
    const child = (options.spawn ?? spawnCodexAppServer)(resolveCodexExecutable(options.bin), options.cwd);
    const rpc = new CodexAppServerRpc(child);
    let readerError;
    const reader = (async () => {
        try {
            for await (const line of readNdjson(child.stdout)) {
                let message;
                try {
                    message = JSON.parse(line);
                }
                catch {
                    throw new Error('Codex model discovery returned malformed NDJSON');
                }
                rpc.dispatchResponse(message);
            }
        }
        catch (error) {
            readerError = error instanceof Error ? error : new Error(String(error));
            rpc.rejectPending(readerError.message);
        }
    })();
    const exited = new Promise((_, reject) => {
        const fail = (detail) => {
            const error = new Error(detail);
            rpc.rejectPending(error.message);
            reject(error);
        };
        child.once('error', () => fail('Codex model discovery child failed'));
        child.once('exit', (code) => fail(`Codex model discovery child exited (${code ?? 'unknown'})`));
    });
    const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
    let timeout;
    const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            const error = new Error('Codex model discovery timed out');
            rpc.rejectPending(error.message);
            reject(error);
        }, timeoutMs);
        timeout.unref?.();
    });
    try {
        return await Promise.race([
            discoverPages(rpc),
            exited,
            deadline,
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
        endCodexAppServer(child);
        void reader.catch(() => undefined);
        if (readerError)
            rpc.rejectPending(readerError.message);
    }
}
async function discoverPages(rpc) {
    await rpc.initialize();
    const models = [];
    const ids = new Set();
    const cursors = new Set();
    let cursor = null;
    for (let pageNumber = 0; pageNumber < MAX_MODEL_PAGES; pageNumber += 1) {
        const raw = await rpc.request('model/list', { cursor, includeHidden: false });
        const parsed = pageSchema.safeParse(raw);
        if (!parsed.success)
            throw new Error('Codex model discovery returned malformed model data');
        for (const model of parsed.data.data) {
            const id = model.model.trim();
            if (!id || model.hidden || ids.has(id))
                continue;
            if (models.length >= MAX_MODELS)
                throw new Error('Codex model discovery exceeded the size limit');
            ids.add(id);
            models.push({
                id,
                label: model.displayName?.trim() || id,
                description: model.description ?? '',
                ...(model.supportedReasoningEfforts
                    ? { reasoningEfforts: model.supportedReasoningEfforts }
                    : {}),
            });
        }
        const nextCursor = parsed.data.nextCursor ?? null;
        if (nextCursor === null)
            return models;
        if (!nextCursor || cursors.has(nextCursor)) {
            throw new Error('Codex model discovery returned a cursor loop');
        }
        cursors.add(nextCursor);
        cursor = nextCursor;
    }
    throw new Error('Codex model discovery exceeded the page limit');
}
//# sourceMappingURL=codex-model-catalog.js.map