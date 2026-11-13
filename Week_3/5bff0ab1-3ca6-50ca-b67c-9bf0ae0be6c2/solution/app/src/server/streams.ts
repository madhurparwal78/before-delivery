import type { IncomingMessage, ServerResponse } from "node:http";
import type { FinishId, HubId, ModelId } from "../shared/catalogue.js";
import { wholeHourOf } from "../shared/clock.js";
import type { Caller } from "./auth.js";
import { events, now } from "./core.js";
import { q } from "./db.js";
import { readingFor } from "./views.js";

/**
 * Live streams. An open stream owns no Postgres or Valkey connection: it listens to the copy's one poller and reads the
 * shared pool only while it writes an event.
 */

type Conn = {
  res: ServerResponse;
  hub: HubId;
  model: ModelId;
  finish: FinishId;
  sessionId: string | null;
  riderId: string | null;
  expiresMs: number | null;
  busy: boolean;
  dirty: boolean;
};

const conns = new Set<Conn>();
const PING_MS = 10_000;

const send = (conn: Conn, name: string, data: unknown): void => {
  if (!conn.res.writableEnded) conn.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
};

async function pushLive(conn: Conn): Promise<void> {
  if (conn.busy) {
    conn.dirty = true;
    return;
  }
  conn.busy = true;
  try {
    do {
      conn.dirty = false;
      send(conn, "live", await readingFor(conn.hub, conn.model, conn.finish, conn.riderId, await now()));
    } while (conn.dirty);
  } catch {
    // Postgres is away; the next change event reads again.
  } finally {
    conn.busy = false;
  }
}

export function openStream(req: IncomingMessage, res: ServerResponse, selection: { hub: HubId; model: ModelId; finish: FinishId }, caller: Caller): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const conn: Conn = { res, ...selection, sessionId: caller.sessionId, riderId: caller.user?.role === "rider" ? caller.user.id : null, expiresMs: caller.expiresMs, busy: false, dirty: false };
  conns.add(conn);
  res.write("retry: 2000\n\n");
  void pushLive(conn);
  const ping = setInterval(() => send(conn, "ping", {}), PING_MS);
  req.on("close", () => {
    clearInterval(ping);
    conns.delete(conn);
  });
}

async function watchSessions(): Promise<void> {
  const watched = [...conns].filter((c) => c.sessionId);
  if (watched.length === 0) return;
  const rows = await q<{ id: string; revoked: boolean }>("SELECT id, revoked FROM sessions WHERE id = ANY($1)", [[...new Set(watched.map((c) => c.sessionId))]]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const at = await now();
  for (const conn of watched) {
    const row = byId.get(conn.sessionId as string);
    if (!row || row.revoked) {
      send(conn, "session", { state: "signed_out" });
    } else if (conn.expiresMs !== null && conn.expiresMs <= at) {
      send(conn, "session", { state: "ended" });
    } else continue;
    conn.sessionId = null;
    conn.riderId = null;
  }
}

let lastHour = -1;

async function hourly(): Promise<void> {
  const hour = wholeHourOf(await now());
  const changed = lastHour !== -1 && hour !== lastHour;
  lastHour = hour;
  if (!changed) return;
  const holders = new Set((await q<{ rider_id: string }>("SELECT DISTINCT rider_id FROM locks WHERE state='locked'")).map((r) => r.rider_id));
  for (const conn of conns) if (conn.riderId && holders.has(conn.riderId)) send(conn, "mine", {});
}

export function startStreams(): void {
  events.on("hub", (hub: HubId) => {
    for (const conn of conns) if (conn.hub === hub) void pushLive(conn);
  });
  events.on("rider", (rider: string) => {
    for (const conn of conns) if (conn.riderId === rider) send(conn, "mine", {});
  });
  setInterval(() => void watchSessions().catch(() => undefined), 500).unref();
  setInterval(() => void hourly().catch(() => undefined), 500).unref();
}

