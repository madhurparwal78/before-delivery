import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.js";
import { query } from "./db.js";
import { parseCookies, sameOrigin } from "./http.js";
import { COOKIE } from "./accounts.js";
import { deliverWarnings, sendState } from "./live.js";
import { friendsHint } from "./notify.js";
import { personForLogin } from "./people.js";
import { enqueue, meConns, sessionConns, track, untrack, type Conn } from "./registry.js";
import { isInside, loadSession } from "./sessiondata.js";
import { onValkeyDown, onValkeyRecovered, presenceKey, run, socketsKey, valkeyFlaggedDown } from "./valkey.js";

const wss = new WebSocketServer({ noServer: true });
const answered = new WeakSet<WebSocket>();

/** A socket that never answers a ping is dead; ending it lets the grace period count down. */
setInterval(() => {
  for (const registry of [sessionConns, meConns]) {
    for (const conns of registry.values()) {
      for (const { ws } of conns) {
        if (!answered.has(ws)) ws.terminate();
        else {
          answered.delete(ws);
          ws.ping();
        }
      }
    }
  }
}, 25_000).unref();

function refuse(socket: Duplex, status: number, phrase: string): void {
  socket.write(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

// ---------------------------------------------------------------------------------------------
// Sockets per person: this instance's count lives in the Valkey hash sockets:<personId>.

const localCounts = new Map<string, number>();
const dirty = new Set<string>();
const chains = new Map<string, Promise<void>>();

async function publishCount(personId: string): Promise<void> {
  const count = localCounts.get(personId) ?? 0;
  const wasOnline = await run(async (client) => (await client.exists(presenceKey(personId))) === 1);
  await run(async (client) => {
    if (count > 0) {
      await client.hset(socketsKey(personId), config.instanceId, String(count));
      await client.set(presenceKey(personId), "1");
    } else await client.hdel(socketsKey(personId), config.instanceId);
  });
  dirty.delete(personId);
  if (count > 0) {
    await query("DELETE FROM drops WHERE person_id = $1", [personId]);
    if (!wasOnline) await friendsHint(personId);
  } else if ((await run((client) => client.hlen(socketsKey(personId)))) === 0) {
    await query(
      `INSERT INTO drops (person_id, due_at) SELECT p.id, world_now(p.world_id) + make_interval(secs => $2) FROM people p WHERE p.id = $1
       ON CONFLICT (person_id) DO UPDATE SET due_at = excluded.due_at`,
      [personId, config.dropGraceSeconds],
    );
  }
}

function changeCount(personId: string, delta: number): void {
  const next = Math.max(0, (localCounts.get(personId) ?? 0) + delta);
  if (next === 0) localCounts.delete(personId);
  else localCounts.set(personId, next);
  const previous = chains.get(personId) ?? Promise.resolve();
  chains.set(
    personId,
    previous
      .then(() => publishCount(personId))
      .catch(() => void dirty.add(personId)),
  );
}

onValkeyDown(() => {
  for (const conns of sessionConns.values()) for (const conn of conns) conn.ws.close(1013, "unavailable");
});

/** When Valkey returns, the counts missed during the outage are written and the grace starts again. */
onValkeyRecovered(() => {
  for (const personId of dirty) changeCount(personId, 0);
  void query("UPDATE drops d SET due_at = world_now(p.world_id) + make_interval(secs => $1) FROM people p WHERE p.id = d.person_id", [config.dropGraceSeconds]);
});

// ---------------------------------------------------------------------------------------------

async function accept(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  if (!sameOrigin(req)) return refuse(socket, 403, "Forbidden");
  const person = await personForLogin(parseCookies(req.headers.cookie).get(COOKIE));
  if (!person) return refuse(socket, 401, "Unauthorized");
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  let sessionId: string | null = null;
  if (path !== "/ws/me") {
    const match = /^\/ws\/sessions\/([^/]+)$/.exec(path);
    const session = match ? await loadSession(decodeURIComponent(match[1] ?? ""), person.worldId) : null;
    if (!session || !(await isInside(session.id, person.id))) return refuse(socket, 404, "Not Found");
    if (valkeyFlaggedDown()) return refuse(socket, 503, "Service Unavailable");
    sessionId = session.id;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const conn: Conn = { ws, personId: person.id, worldId: person.worldId, sessionId, chain: Promise.resolve() };
    const registry = sessionId ? sessionConns : meConns;
    const key = sessionId ?? person.id;
    track(registry, key, conn);
    changeCount(person.id, 1);
    ws.on("close", () => {
      untrack(registry, key, conn);
      changeCount(person.id, -1);
    });
    ws.on("error", () => undefined);
    answered.add(ws);
    ws.on("pong", () => answered.add(ws));
    if (sessionId) enqueue(conn, () => sendState(conn));
    else enqueue(conn, () => deliverWarnings(conn));
  });
}

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  socket.on("error", () => undefined);
  accept(req, socket, head).catch(() => refuse(socket, 500, "Internal Server Error"));
}
