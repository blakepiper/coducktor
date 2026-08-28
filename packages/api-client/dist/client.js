import { hc } from 'hono/client';
/**
 * Build a typed client for a cezar service.
 *
 * `T` is the service's `AppType`. It is left unconstrained so that a JS consumer, or a
 * consumer that does not want the server package installed, still gets a working (untyped)
 * client instead of a type error.
 */
export function createCezarClient(options = {}) {
    const { baseUrl = '', token, headers, fetch } = options;
    return hc(baseUrl, {
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        ...(fetch ? { fetch } : {}),
    });
}
//# sourceMappingURL=client.js.map