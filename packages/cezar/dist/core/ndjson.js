/**
 * Async line iterator over a readable stream of UTF-8 NDJSON — one trimmed,
 * non-empty line per yield. Shared by every stdout/stdin-JSONL runner
 * (the claude CLI's stream-json and codex app-server's JSON-RPC transport).
 */
export async function* readNdjson(stream) {
    stream.setEncoding('utf8');
    let buffer = '';
    for await (const chunk of stream) {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line)
                yield line;
        }
    }
    const tail = buffer.trim();
    if (tail)
        yield tail;
}
//# sourceMappingURL=ndjson.js.map