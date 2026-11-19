import type pg from "pg";
import { now } from "./clock.js";
import { LOCK, lock, one, pool, rows } from "./db.js";
import type { AuthedCtx, Reply } from "./http.js";

export type EventName =
  | "message.created"
  | "message.updated"
  | "message.deleted"
  | "receipts.updated"
  | "channel.updated"
  | "channel.added"
  | "channel.revoked"
  | "session.ended";

export type LoggedEvent = {
  workspaceId: string;
  channelId: string | null;
  userId: string | null;
  name: EventName;
  payload: unknown;
};

// Appends events to the PostgreSQL event log. Called last in a transaction: the advisory lock is
// held until commit, so ids become visible in id order and a reader never skips a late commit.
// Payloads are built only once the lock is held, so the counts they carry include every commit
// logged before them and a later id never carries an older count.
export async function logEvents(client: pg.PoolClient, build: () => Promise<LoggedEvent[]>): Promise<number[]> {
  await lock(client, LOCK.events);
  const events = await build();
  const at = now();
  const ids: number[] = [];
  for (const event of events) {
    const row = await one<{ id: string }>(
      client,
      "INSERT INTO events (workspace_id, channel_id, user_id, name, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [event.workspaceId, event.channelId, event.userId, event.name, JSON.stringify(event.payload), at],
    );
    ids.push(Number(row?.id));
  }
  return ids;
}

// Which logged events a person may receive: their workspace, addressed to everyone or to them,
// and for a channel only while they are a current member who joined before the event. Their own
// channel.added / channel.revoked always reach them.
const DELIVERABLE = `
SELECT e.id::text AS id, e.name, e.payload
  FROM events e
 WHERE e.id > $1 AND e.workspace_id = $2 AND (e.user_id IS NULL OR e.user_id = $3)
   AND (
        (e.user_id = $3 AND (e.channel_id IS NULL OR e.name IN ('channel.added', 'channel.revoked')))
     OR EXISTS (SELECT 1 FROM memberships m
                 WHERE m.channel_id = e.channel_id AND m.user_id = $3 AND m.joined_event_id < e.id)
   )
 ORDER BY e.id
 LIMIT 500`;

type Connection = {
  viewer: AuthedCtx["viewer"];
  cursor: number;
  write: (chunk: string) => void;
  close: () => void;
  pumping: boolean;
  again: boolean;
};

const connections = new Set<Connection>();

async function pump(connection: Connection): Promise<void> {
  if (connection.pumping) {
    connection.again = true;
    return;
  }
  connection.pumping = true;
  try {
    do {
      connection.again = false;
      const batch = await rows<{ id: string; name: EventName; payload: unknown }>(pool, DELIVERABLE, [
        connection.cursor, connection.viewer.workspace.id, connection.viewer.id,
      ]);
      for (const event of batch) {
        connection.cursor = Number(event.id);
        connection.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${JSON.stringify(event.payload)}\n\n`);
        if (event.name === "session.ended") {
          connection.close();
          return;
        }
      }
      if (batch.length === 500) connection.again = true;
    } while (connection.again && connections.has(connection));
  } finally {
    connection.pumping = false;
  }
}

let newestSeen = 0;

async function newestLoggedId(): Promise<number> {
  const row = await one<{ newest: string | null; seq: string; called: boolean }>(
    pool,
    "SELECT (SELECT max(id) FROM events)::text AS newest, last_value::text AS seq, is_called AS called FROM events_id_seq",
  );
  if (row?.newest) return Number(row.newest);
  return row?.called ? Number(row.seq) : 0;
}

// One poll per process wakes every open stream when the log grows (other processes write too).
export function startEventPoller(): void {
  const tick = async () => {
    try {
      const newest = await newestLoggedId();
      if (newest !== newestSeen) {
        newestSeen = newest;
        for (const connection of connections) void pump(connection).catch(() => connection.close());
      }
    } catch {
      // The database is unreachable for a moment; the next tick retries.
    }
  };
  setInterval(() => void tick(), 200).unref();
}

export function closeSessionStreams(sessionHash: string): void {
  for (const connection of connections) {
    if (connection.viewer.sessionHash === sessionHash) connection.close();
  }
}

function resumeId(ctx: AuthedCtx): string | undefined {
  const header = ctx.req.headers["last-event-id"];
  if (typeof header === "string") return header.trim();
  return ctx.url.searchParams.get("last_event_id")?.trim() ?? undefined;
}

export async function openStream(ctx: AuthedCtx): Promise<Reply> {
  const { req, res, viewer } = ctx;
  const requested = resumeId(ctx);
  const newest = await newestLoggedId();
  const oldestRow = await one<{ oldest: string | null }>(pool, "SELECT min(id)::text AS oldest FROM events");
  const oldest = oldestRow?.oldest ? Number(oldestRow.oldest) : newest;
  let cursor = newest;
  let reset = false;
  if (requested !== undefined) {
    const value = /^\d+$/.test(requested) ? Number(requested) : Number.NaN;
    if (Number.isSafeInteger(value) && value >= oldest && value <= newest) cursor = value;
    else reset = true;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  req.socket.setNoDelay(true);
  req.socket.setTimeout(0);

  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  const connection: Connection = {
    viewer,
    cursor,
    write: (chunk) => {
      res.write(chunk);
    },
    close: () => {
      clearInterval(keepAlive);
      connections.delete(connection);
      res.end();
    },
    pumping: false,
    again: false,
  };
  res.on("close", () => {
    clearInterval(keepAlive);
    connections.delete(connection);
  });

  // The first block names the stream's starting position so a client can resume after a drop
  // even before its first event arrives; it carries no event.
  res.write(reset ? `id: ${newest}\nevent: stream.reset\ndata: {}\n\n` : `id: ${cursor}\n\n`);
  connections.add(connection);
  await pump(connection);
  return { kind: "taken" };
}
