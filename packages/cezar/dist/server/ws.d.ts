import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
/**
 * The cockpit's WebSocket subscription bus (`GET /api/v1/ws`, upgrade-only).
 * Design + the subscribe/unsubscribe discipline: spec
 * `.ai/specs/2026-07-23-websocket-subscriptions.md`.
 *
 * One socket per cockpit, many topics per socket: the client sends
 * `{type:'subscribe'|'unsubscribe', topic}` frames and receives
 * `{type:'event', topic, data}` frames for the topics it holds. The point of
 * the topic layer is that server-side work is DEMAND-DRIVEN: a topic's
 * publisher starts when its subscriber count goes 0→1 and is stopped at 1→0,
 * so a workspace with no cockpit open (or a cockpit that navigated away from
 * everything using a topic) costs zero timers, zero shell-outs, zero anything.
 * That is what replaced the per-tab `GET /api/health` poll (#369): N tabs used
 * to mean N polls every 5 s forever; now they mean one publisher while at
 * least one tab subscribes, and none afterwards.
 *
 * Security: the hub itself never decides who may connect — `attach` takes the
 * upgrade guard as a function, and server.ts supplies the WebSocket twin of
 * the `/api/*` request-origin guard (#426). See `verifyWsUpgrade` there for
 * what it admits, and the caveat about which topics may live on this hub.
 */
/** The one upgrade path. Workspace-level like `/api/workspace/events` — never
 *  mirrored under `/api/p/:projectId` (topics carry workspace data). */
export declare const WS_PATH = "/api/v1/ws";
export interface TopicPublisher {
    /** Fresh payload for a subscriber that just arrived — sent immediately so a
     *  (re)connecting cockpit never waits out a publisher interval to render. */
    snapshot(): Promise<unknown>;
    /** Subscriber count went 0→1: start producing. Call `publish` whenever the
     *  topic has news (every call is broadcast verbatim to all subscribers).
     *  Returns the stop function, called at 1→0. */
    start(publish: (data: unknown) => void): () => void;
}
export interface TopicOptions {
    /** Whether an ADMITTED-BUT-UNTRUSTED connection may subscribe (see
     *  `WsUpgradeVerdict`). Defaults to `false` — the safe default that makes the
     *  topic-safety invariant mechanical: a topic carrying run/repo/PR content is
     *  legible only to the cockpit itself unless a publisher explicitly opts in.
     *  Set `true` only for data already safe for any local page (e.g. `health`,
     *  the CORS-open discovery payload). */
    loopbackReadable?: boolean;
}
/**
 * The upgrade guard's verdict: reject, or admit at a trust level.
 *
 * `false` — reject the handshake (403). A `trusted` connection is provably the
 * cockpit itself — a same-authority Origin, a no-Origin native client, or a dev
 * proxy the browser vouches for via `Sec-Fetch-Site` — and may subscribe to any
 * topic. A NON-`trusted` connection was admitted by the loopback-origin fallback
 * on a browser that ships no `Sec-Fetch` metadata, where the dev proxy and a
 * foreign page on another local port are indistinguishable at the handshake: it
 * may subscribe ONLY to topics a publisher flagged `loopbackReadable`.
 */
export type WsUpgradeVerdict = false | {
    trusted: boolean;
};
/** The minimal server surface `attach` needs — satisfied by the `http.Server`
 *  that `@hono/node-server`'s `serve()` returns. */
export interface UpgradeCapableServer {
    on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
}
export interface SocketHub {
    /** Register a topic clients may subscribe to. Registration is boot-time
     *  wiring (createApp), so a duplicate name is a programming error: throw.
     *  `options.loopbackReadable` defaults to `false` (topic legible to trusted
     *  connections only) — see `TopicOptions`. */
    registerTopic(name: string, publisher: TopicPublisher, options?: TopicOptions): void;
    /** Start accepting `WS_PATH` upgrades on `server`. `verifyUpgrade` is the
     *  request-origin guard — `false` answers 403 before the handshake, otherwise
     *  its `trusted` flag decides which topics the connection may read. Boot-time
     *  wiring like `registerTopic`: attaching twice throws. */
    attach(server: UpgradeCapableServer, verifyUpgrade: (req: IncomingMessage) => WsUpgradeVerdict): void;
    /** Stop publishers, terminate clients, clear timers. Idempotent; also runs
     *  on the attached server's own `close`. */
    close(): void;
}
export interface SocketHubOptions {
    /** Heartbeat interval override (ms). Defaults to `HEARTBEAT_MS`; tests set it
     *  small so reaping and the liveness beat are observable without a 30 s wait. */
    heartbeatMs?: number;
}
export declare function createSocketHub(options?: SocketHubOptions): SocketHub;
