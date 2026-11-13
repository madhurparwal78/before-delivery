import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import pg from "pg";
import { WebSocketServer, type WebSocket } from "ws";
import type { LiveMessage } from "../shared/types.js";
import { config } from "./config.js";
import { database, query } from "./db.js";
import { iso, now, sleep } from "./time.js";

type EventRow = { seq: number; person_id: string | null; type: string; at: Date; data: Record<string, unknown> };
type Connection = { socket: WebSocket; personId: string; ready: boolean; sent: number; buffer: LiveMessage[] };

const REPLAY_LIMIT = 1000;
const report = (error: unknown): void => console.error("live events:", error instanceof Error ? error.message : error);
const connections = new Set<Connection>();
const sockets = new WebSocketServer({ noServer: true });
let lastSeq = 0;
let pumping = false;

function messageOf(row: EventRow): LiveMessage {
  return { seq: row.seq, type: row.type, at: iso(row.at), data: row.data };
}

function deliver(connection: Connection, message: LiveMessage): void {
  if (message.seq <= connection.sent) return;
  connection.sent = message.seq;
  connection.socket.send(JSON.stringify(message));
  if (message.type === "access.removed") connection.socket.close();
}

function dispatch(row: EventRow): void {
  const message = messageOf(row);
  for (const connection of connections) {
    if (row.person_id !== null && row.person_id !== connection.personId) continue;
    if (connection.ready) deliver(connection, message);
    else connection.buffer.push(message);
  }
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const rows = await query<EventRow>(
        "SELECT seq, person_id, type, at, data FROM live_events WHERE seq > $1 ORDER BY seq LIMIT 500",
        [lastSeq],
      );
      for (const row of rows) {
        lastSeq = row.seq;
        dispatch(row);
      }
      if (rows.length < 500) break;
    }
  } finally {
    pumping = false;
  }
}

export async function currentSequence(): Promise<number> {
  const rows = await query<{ seq: number }>("SELECT coalesce(max(seq), 0)::bigint AS seq FROM live_events");
  return rows[0]?.seq ?? 0;
}

async function listen(): Promise<void> {
  for (;;) {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    try {
      await client.connect();
      await client.query("LISTEN live_events");
      client.on("notification", () => void pump().catch(report));
      await new Promise<void>((resolve) => {
        client.on("error", () => resolve());
        client.on("end", () => resolve());
      });
    } catch (error) {
      report(error);
      await sleep(2000);
    } finally {
      await client.end().catch(report);
    }
  }
}

function broadcastClock(): void {
  const at = iso(now());
  const message = JSON.stringify({ seq: 0, type: "clock", at, data: { server_time: at } });
  for (const connection of connections) {
    if (connection.ready) connection.socket.send(message);
  }
}

/** Starts the fan-out of stored events to open sockets, and the one-second clock. */
export async function startLive(): Promise<void> {
  database();
  lastSeq = await currentSequence();
  void listen();
  setInterval(() => void pump().catch(report), 500);
  setInterval(broadcastClock, 1000);
}

async function replay(connection: Connection, since: number): Promise<void> {
  const rows = await query<EventRow>(
    `SELECT seq, person_id, type, at, data FROM live_events
      WHERE seq > $1 AND (person_id = $2 OR person_id IS NULL)
      ORDER BY seq DESC LIMIT $3`,
    [since, connection.personId, REPLAY_LIMIT],
  );
  for (const row of rows.reverse()) deliver(connection, messageOf(row));
  for (const message of connection.buffer) deliver(connection, message);
  connection.buffer = [];
  connection.ready = true;
}

export function acceptSocket(request: IncomingMessage, socket: Duplex, head: Buffer, personId: string, since: number | null): void {
  sockets.handleUpgrade(request, socket, head, (ws) => {
    const connection: Connection = { socket: ws, personId, ready: false, sent: since ?? 0, buffer: [] };
    connections.add(connection);
    ws.on("close", () => connections.delete(connection));
    ws.on("error", (error) => {
      report(error);
      connections.delete(connection);
    });
    const at = iso(now());
    ws.send(JSON.stringify({ seq: 0, type: "clock", at, data: { server_time: at } }));
    if (since === null) connection.ready = true;
    else void replay(connection, since).catch(() => ws.close());
  });
}
