import type { Env, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
/**
 * Request validation as ROUTE MIDDLEWARE — the `json` / `param` / `query` trio every mutating
 * route reaches for.
 *
 * The point is not that handlers stop restating six lines of `safeParse`, though they do. It is
 * that Hono only records a validated shape in the ROUTE TYPE when validation happens as
 * middleware. Parsing inside a handler is invisible to it, which is why `POST /runs` used to
 * accept `{ totalNonsense: 12345 }` from `hc` without a murmur. Everything typed-client-side
 * flows from validating here instead of there.
 *
 * ## Why not `@hono/zod-validator`
 *
 * It is a thin wrapper over the same `hono/validator` used below, so it inherits Hono's two
 * behaviours at the JSON boundary — and both are wrong for this server:
 *
 *   - a malformed body answers Hono's PLAIN-TEXT `400 Malformed JSON in request body`, and the
 *     error hook never runs, so the `{error}` shape BACKWARD_COMPATIBILITY.md §2 protects (and
 *     the cockpit renders verbatim in a toast) is bypassed entirely;
 *   - a body sent WITHOUT a JSON content-type is silently discarded and the handler runs against
 *     `{}` — a 200 that applied an empty update, which is worse than a rejection.
 *
 * Both were verified against `@hono/zod-validator@0.9.0`, not inferred. `jsonZodValidator` settles
 * those cases itself and only delegates to Hono on the well-formed path, so the wire matches what
 * these handlers did when they parsed inline (`await c.req.json().catch(() => absent)`).
 */
type ErrorOptions = {
    /** Fixed 400 text, for routes that answer one instead of the zod issues. */
    message?: string;
};
type JsonOptions = ErrorOptions & {
    /**
     * What a request with NO body parses as — the old `.catch(() => …)` fallback. Hono hands a
     * bodyless request `{}`, which is not the same as a request that really sent `{}`: routes that
     * tolerate no body at all pass `{}` here, and the rest keep rejecting it exactly as they did.
     */
    absent?: unknown;
    /**
     * What a body that is PRESENT but not parseable as JSON becomes. Defaults to `absent`, which is
     * what every route wants when both cases are rejected anyway.
     *
     * `POST /todos/:id/start` is the one route that must tell them apart: no body at all is the
     * pre-#401 bodyless POST and has to succeed (`absent: undefined`, which its optional schema
     * accepts), while a truncated payload must 400 rather than pass as "no body" and silently 201
     * (`malformed: null`, which it does not). That distinction lived in the handler's own
     * `JSON.parse` before the route moved its body onto a validator; it is expressed here so the
     * behaviour moved with it rather than being lost in the move.
     */
    malformed?: unknown;
};
/**
 * The request/response split, spelled out rather than inferred.
 *
 * Hono derives a validator's request type from its validation function's first parameter, but
 * declares that parameter as a CONDITIONAL type — which is not an inference site, so annotating
 * it achieves nothing and the request silently falls back to the schema's OUTPUT. That makes any
 * `.optional().transform(…)` or `.default(…)` field REQUIRED on the wire: `POST /runs` demanded a
 * `systemPrompt` no caller should send, and `POST …/merge` demanded `overrideRules`. Naming both
 * sides here is the same thing `@hono/zod-validator` does, and for the same reason.
 */
type JsonValidator<S extends z.ZodType, E extends Env, P extends string> = MiddlewareHandler<E, P, {
    in: {
        json: z.input<S>;
    };
    out: {
        json: z.output<S>;
    };
}>;
export declare function jsonZodValidator<S extends z.ZodType, E extends Env = Env, P extends string = string>(schema: S | (() => S), options?: JsonOptions): JsonValidator<S, E, P>;
/**
 * Path params. No guard needed: these come off the matched URL, so there is no body to parse, no
 * content-type to gate on and no malformed-input path — Hono's own behaviour is already right.
 * The schema receives the whole param object (`{ provider: 'codex' }`), not a single value.
 */
export declare function paramZodValidator<S extends z.ZodType>(schema: S, { message }?: ErrorOptions): MiddlewareHandler<any, string, {
    in: {
        param: import("hono/validator").InferInput<z.TypeOf<S> extends infer T ? T extends z.TypeOf<S> ? T extends Promise<infer PR> ? PR extends Response | import("hono").TypedResponse<any, any, any> ? never : PR : T extends Response | import("hono").TypedResponse<any, any, any> ? never : T : never : never, "param", import("hono/types").FormValue>;
    };
    out: {
        param: z.TypeOf<S> extends infer T ? T extends z.TypeOf<S> ? T extends Promise<infer PR> ? PR extends Response | import("hono").TypedResponse<any, any, any> ? never : PR : T extends Response | import("hono").TypedResponse<any, any, any> ? never : T : never : never;
    };
}, import("hono").TypedResponse<{
    error: string;
}, 400, "json"> | (z.TypeOf<S> extends infer T_1 ? T_1 extends z.TypeOf<S> ? T_1 extends Promise<infer PR_1> ? PR_1 extends import("hono").TypedResponse<infer T_2, infer S_1 extends import("hono/utils/http-status").StatusCode, infer F extends string> ? import("hono").TypedResponse<T_2, S_1, F> : PR_1 extends Response ? PR_1 : PR_1 extends undefined ? never : never : T_1 extends import("hono").TypedResponse<infer T_3, infer S_2 extends import("hono/utils/http-status").StatusCode, infer F_1 extends string> ? import("hono").TypedResponse<T_3, S_2, F_1> : T_1 extends Response ? T_1 : T_1 extends undefined ? never : never : never : never)>;
/** Query string, on the same terms as {@link paramZodValidator}. */
export declare function queryZodValidator<S extends z.ZodType>(schema: S, { message }?: ErrorOptions): MiddlewareHandler<any, string, {
    in: {
        query: import("hono/validator").InferInput<z.TypeOf<S> extends infer T ? T extends z.TypeOf<S> ? T extends Promise<infer PR> ? PR extends Response | import("hono").TypedResponse<any, any, any> ? never : PR : T extends Response | import("hono").TypedResponse<any, any, any> ? never : T : never : never, "query", import("hono/types").FormValue>;
    };
    out: {
        query: z.TypeOf<S> extends infer T ? T extends z.TypeOf<S> ? T extends Promise<infer PR> ? PR extends Response | import("hono").TypedResponse<any, any, any> ? never : PR : T extends Response | import("hono").TypedResponse<any, any, any> ? never : T : never : never;
    };
}, import("hono").TypedResponse<{
    error: string;
}, 400, "json"> | (z.TypeOf<S> extends infer T_1 ? T_1 extends z.TypeOf<S> ? T_1 extends Promise<infer PR_1> ? PR_1 extends import("hono").TypedResponse<infer T_2, infer S_1 extends import("hono/utils/http-status").StatusCode, infer F extends string> ? import("hono").TypedResponse<T_2, S_1, F> : PR_1 extends Response ? PR_1 : PR_1 extends undefined ? never : never : T_1 extends import("hono").TypedResponse<infer T_3, infer S_2 extends import("hono/utils/http-status").StatusCode, infer F_1 extends string> ? import("hono").TypedResponse<T_3, S_2, F_1> : T_1 extends Response ? T_1 : T_1 extends undefined ? never : never : never : never)>;
export {};
