import { validator } from 'hono/validator';
/**
 * `{ error }`, the one 400 shape this API answers (BACKWARD_COMPATIBILITY.md §2).
 *
 * Each issue is prefixed with the field path, because zod's own message never names the field:
 * `"Invalid input: expected array, received undefined"` on its own does not tell the cockpit user
 * WHICH field to fix. That is the same information `z.prettifyError` adds, minus its multi-line
 * `✖ …\n  → at task` layout — this string is rendered verbatim in a toast, so it stays one line.
 */
function reject(c, error, override) {
    const detail = error.issues
        .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
        .join('; ');
    return c.json({ error: override ?? detail }, 400);
}
export function jsonZodValidator(
// A thunk is accepted because several schemas are declared next to the route family they
// belong to, which is BELOW the route using them; resolving per request keeps those
// declarations where they read best. Pass the schema directly whenever it is already in scope —
// a GENERIC thunk is worse than either, since an unresolved schema type makes Hono drop the
// route from the app type silently (see typed-bodies.test.ts).
schema, options = {}) {
    // Key presence, not a destructuring default: `undefined` IS a meaningful value for both of
    // these (it is what `POST /todos/:id/start` wants a bodyless request to parse as), and a
    // `= null` default would silently overwrite exactly that case.
    const absent = 'absent' in options ? options.absent : null;
    const malformed = 'malformed' in options ? options.malformed : absent;
    const { message } = options;
    const check = (input, c) => {
        const resolved = typeof schema === 'function' ? schema() : schema;
        const parsed = resolved.safeParse(input);
        return parsed.success
            ? { ok: true, data: parsed.data }
            : { ok: false, response: reject(c, parsed.error, message) };
    };
    const validate = validator('json', (value, c) => {
        const result = check(value, c);
        return result.ok ? result.data : result.response;
    });
    // Anything Hono would treat differently than the old inline parse is settled here and published
    // straight to `c.req.valid('json')`; only well-formed JSON under a JSON content-type — what
    // every real client sends — takes Hono's own path. See the header note.
    const guard = async (c, next) => {
        const text = await c.req.text().catch(() => '');
        let body = absent;
        let parseable = false;
        if (text.trim() !== '') {
            try {
                body = JSON.parse(text);
                parseable = true;
            }
            catch {
                body = malformed;
            }
        }
        const contentType = c.req.header('content-type');
        if (parseable && contentType !== undefined && /^application\/([a-z\-.]+\+)?json/.test(contentType)) {
            return validate(c, next);
        }
        const result = check(body, c);
        if (!result.ok)
            return result.response;
        c.req.addValidatedData('json', result.data);
        return next();
    };
    return guard;
}
/**
 * Path params. No guard needed: these come off the matched URL, so there is no body to parse, no
 * content-type to gate on and no malformed-input path — Hono's own behaviour is already right.
 * The schema receives the whole param object (`{ provider: 'codex' }`), not a single value.
 */
export function paramZodValidator(schema, { message } = {}) {
    return validator('param', (value, c) => {
        const parsed = schema.safeParse(value);
        return parsed.success ? parsed.data : reject(c, parsed.error, message);
    });
}
/** Query string, on the same terms as {@link paramZodValidator}. */
export function queryZodValidator(schema, { message } = {}) {
    return validator('query', (value, c) => {
        const parsed = schema.safeParse(value);
        return parsed.success ? parsed.data : reject(c, parsed.error, message);
    });
}
//# sourceMappingURL=validators.js.map