import type { Pool, PoolClient } from "pg";
import { pool } from "./db";
import { now } from "./clock";

// Live updates: server push on /api/events. Cross-instance changes travel through
// Postgres LISTEN/NOTIFY; each instance fans messages out to its own SSE streams,
// filtered by what each viewer may read.

export type EventKind = "piece" | "load" | "charge" | "credit" | "invite" | "rates" | "studio" | "member" | "month" | "session";

type SseClient = {
  sessionId: string;
  studioId: string;
  personId: string;
  role: string;
  write: (chunk: string) => void;
};

const clients = new Set<SseClient>();

export function addSseClient(c: SseClient): void {
  clients.add(c);
}

export function removeSseClient(c: SseClient): void {
  clients.delete(c);
}

function deliver(msg: { kind: EventKind; id: string; studioId: string; memberId?: string; sessionId?: string }): void {
  const data = JSON.stringify({ kind: msg.kind, id: msg.id });
  for (const c of clients) {
    if (c.studioId !== msg.studioId) continue;
    if (msg.kind === "session") {
      if (c.sessionId === msg.sessionId) {
        c.write(`event: change\ndata: ${data}\n\n`);
        c.write("event: end\ndata: {}\n\n");
      }
      continue;
    }
    if (c.role === "member" && msg.memberId !== undefined && msg.memberId !== c.personId) continue;
    c.write(`event: change\ndata: ${data}\n\n`);
  }
}

// Notify all instances (including this one) about a committed change.
export async function publish(db: Pool | PoolClient, kind: EventKind, id: string, studioId: string, opts?: { memberId?: string; sessionId?: string }): Promise<void> {
  const payload = JSON.stringify({ kind, id, studioId, memberId: opts?.memberId, sessionId: opts?.sessionId });
  try {
    await db.query("SELECT pg_notify('kd_events', $1)", [payload]);
  } catch {
    /* notifications are best-effort */
  }
}

let listenerReady = false;

export async function startEventListener(): Promise<void> {
  if (listenerReady) return;
  const client = await pool.connect();
  listenerReady = true;
  const onNotification = (msg: { channel?: string; payload?: string }) => {
    if (msg.channel !== "kd_events") return;
    try {
      const parsed = JSON.parse(msg.payload ?? "{}") as { kind: EventKind; id: string; studioId: string; memberId?: string; sessionId?: string };
      deliver(parsed);
    } catch {
      /* ignore malformed */
    }
  };
  client.on("notification", onNotification);
  client.on("error", () => {
    listenerReady = false;
    client.release();
  });
  await client.query("LISTEN kd_events");
  // Keep this client out of the pool's idle rotation by holding it forever.
  void client;
}

// The reminder sweep and settler also produce events; keep timestamps fresh.
export function eventNow(): Date {
  return now();
}
