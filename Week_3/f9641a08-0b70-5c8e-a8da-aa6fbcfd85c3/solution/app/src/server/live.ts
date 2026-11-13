import type { IncomingMessage, ServerResponse } from "node:http";
import pg from "pg";
import { config } from "./config";
import { one, pool, rows } from "./db";
import type { Session } from "./auth";

// Server-sent events from the shared sequence in PostgreSQL, so every copy of the app streams
// every event whichever copy wrote it. A reconnecting client resumes from its last sequence number.

interface Row {
  seq: number;
  type: string;
  data: object;
  audience: "all" | "owner" | "staff";
  owner: string | null;
}

interface Connection {
  res: ServerResponse;
  owner: string | null;
  staff: boolean;
  cursor: number;
}

const connections = new Set<Connection>();
const DAY_MS = 24 * 3600 * 1000;
let ticking = false;
let listener: pg.Client | null = null;

function visible(row: Row, conn: Connection): boolean {
  if (row.audience === "all") return true;
  if (row.audience === "staff") return conn.staff;
  return conn.staff || (conn.owner !== null && conn.owner === row.owner);
}

function frame(row: Row): string {
  return `id: ${row.seq}\nevent: ${row.type}\ndata: ${JSON.stringify(row.data)}\n\n`;
}

async function deliver(): Promise<void> {
  if (ticking || connections.size === 0) return;
  ticking = true;
  try {
    const from = Math.min(...[...connections].map((c) => c.cursor));
    const fresh = await rows<Row>(pool, "SELECT seq, type, data, audience, owner FROM live_events WHERE seq > $1 ORDER BY seq", [from]);
    for (const conn of connections) {
      for (const row of fresh) {
        if (row.seq <= conn.cursor) continue;
        conn.cursor = row.seq;
        if (visible(row, conn)) conn.res.write(frame(row));
      }
    }
  } finally {
    ticking = false;
  }
}

async function startListening(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  client.on("error", () => {
    listener = null;
  });
  client.on("notification", () => void deliver());
  await client.connect();
  await client.query("LISTEN live");
  listener = client;
}

/** Wakes the stream on NOTIFY, with a short poll as the safety net. */
export function startLiveHub(): void {
  setInterval(() => {
    if (!listener && connections.size > 0) void startListening().catch(() => undefined);
    void deliver().catch(() => undefined);
  }, 250);
}

export async function openStream(req: IncomingMessage, res: ServerResponse, session: Session | null, after: number | null): Promise<void> {
  const staff = session?.user ? session.user.role !== "customer" : false;
  const last = await one<{ seq: number }>(pool, "SELECT seq FROM live_counter WHERE id = 1");
  const latest = last?.seq ?? 0;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  res.write(": connected\n\n");
  const conn: Connection = { res, owner: session?.owner ?? null, staff, cursor: latest };
  if (after !== null && after < latest) {
    const point = await one<{ at: Date }>(pool, "SELECT at FROM live_events WHERE seq = $1", [after]);
    if (after > 0 && point && Date.now() - point.at.getTime() > DAY_MS) {
      res.write("event: reset\ndata: {}\n\n");
    } else {
      conn.cursor = after;
    }
  }
  connections.add(conn);
  const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(beat);
    connections.delete(conn);
  });
  void deliver().catch(() => undefined);
}
