/**
 * Async line iterator over a readable stream of UTF-8 NDJSON — one trimmed,
 * non-empty line per yield. Shared by every stdout/stdin-JSONL runner
 * (the claude CLI's stream-json and codex app-server's JSON-RPC transport).
 */
export declare function readNdjson(stream: NodeJS.ReadableStream): AsyncGenerator<string>;
