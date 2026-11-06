// The event log in Postgres and the per-page event stream. Events are written inside the
// transaction of the change they describe, under a per-workspace lock, so ids commit in order.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { mayReceive, projectBody, streamAccess, type StreamAccess, type StreamEvent, type Viewer } from "./access.js";
import { config } from "./config.js";
import { query, tx, type Db } from "./db.js";
import { route } from "./router.js";
import { nowMs } from "./time.js";
import { unreadBody } from "./unread.js";

type EventName = "message" | "thread_reply" | "message_deleted" | "unread" | "typing" | "presence" | "room" | "knock" | "issue" | "doc" | "notice" | "revoked";

const KEEP = 1000;
const BATCH = 500;

interface Audience {
  channelId?: string;
  projectId?: string;
  recipients?: string[];
  /** Only the streams of these sessions (a password change revokes the person's other sessions). */
  sessions?: string[];
}

/** Held to commit, so event ids commit in order. A body derived from shared rows is computed under it. */
export async function lockEvents(db: Db, workspaceId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('tr-events:' || $1))", [workspaceId]);
}

export async function emit(db: Db, workspaceId: string, name: EventName, data: Record<string, unknown>, audience: Audience = {}): Promise<void> {
  await lockEvents(db, workspaceId);
  await db.query("INSERT INTO events (workspace_id, name, channel_id, project_id, recipients, sessions, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
    workspaceId,
    name,
    audience.channelId ?? null,
    audience.projectId ?? null,
    audience.recipients ?? null,
    audience.sessions ?? null,
    JSON.stringify(data),
    nowMs(),
  ]);
  await db.query("SELECT pg_notify('tr_events', $1)", [workspaceId]);
}

/** The cursor a page's first stream resumes from, so nothing committed after its first paint is missed. */
export async function latestEventId(db: Db, workspaceId: string): Promise<string> {
  const { rows } = await db.query<{ latest: number | null }>("SELECT max(id) AS latest FROM events WHERE workspace_id = $1", [workspaceId]);
  return String(rows[0]?.latest ?? 0);
}

/** Keeps the 1,000 most recent events of each workspace and records how far it pruned. */
export async function pruneEvents(): Promise<void> {
  const workspaces = await query<{ id: string }>("SELECT id FROM workspaces");
  for (const { id } of workspaces) {
    await tx(async (db) => {
      const { rows } = await db.query<{ id: number }>("SELECT id FROM events WHERE workspace_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1", [id, KEEP]);
      const cutoff = rows[0]?.id;
      if (cutoff === undefined) return;
      await db.query("DELETE FROM events WHERE workspace_id = $1 AND id <= $2", [id, cutoff]);
      await db.query("UPDATE workspaces SET pruned_through = GREATEST(pruned_through, $2) WHERE id = $1", [id, cutoff]);
    });
  }
}

class Stream {
  private cursor = 0;
  private running: Promise<void> = Promise.resolve();
  private queued: Promise<void> | null = null;
  closed = false;

  constructor(
    readonly viewer: Viewer,
    private readonly res: ServerResponse,
    readonly lease: string,
  ) {}

  start(cursor: number): void {
    this.cursor = cursor;
  }

  write(chunk: string): void {
    if (!this.closed) this.res.write(chunk);
  }

  /** Runs one drain after the one in progress; callers can wait for it. */
  pump(): Promise<void> {
    if (this.queued) return this.queued;
    this.queued = this.running.then(() => {
      this.queued = null;
      return this.drain();
    });
    this.running = this.queued;
    return this.queued;
  }

  /** Sends every stored event after the cursor that this person may receive now. */
  private async drain(): Promise<void> {
    try {
      while (!this.closed) {
        const events = await query<StreamEvent>(
          "SELECT id, name, channel_id, project_id, recipients, sessions, data FROM events WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT $3",
          [this.viewer.workspaceId, this.cursor, BATCH],
        );
        if (events.length === 0) return;
        const messageIds = events.filter((e) => e.name === "message" || e.name === "thread_reply").map((e) => e.data.id as number);
        const { access, present } = await tx(async (db) => ({
          access: await streamAccess(db, this.viewer),
          present: new Set((await db.query<{ id: number }>("SELECT id FROM messages WHERE id = ANY($1)", [messageIds])).rows.map((r) => r.id)),
        }));
        for (const event of events) {
          if (this.closed) return;
          this.cursor = event.id;
          if (!mayReceive(access, this.viewer.id, this.viewer.sessionId, event)) continue;
          if ((event.name === "message" || event.name === "thread_reply") && !present.has(event.data.id as number)) continue;
          this.send(event, await this.bodyFor(event, access));
          if (event.name === "revoked" && event.data.scope === "workspace") {
            this.end();
            return;
          }
        }
        if (!access.active) {
          this.end();
          return;
        }
        if (events.length < BATCH) return;
      }
    } catch {
      // the database dropped; the next tick pumps again
    }
  }

  /** The body projected for this person; a stale `unread` naming a lost channel is derived afresh. */
  private async bodyFor(event: StreamEvent, access: StreamAccess): Promise<Record<string, unknown>> {
    const body = projectBody(this.viewer.id, event);
    if (event.name !== "unread") return body;
    if (Object.keys(body.channels as Record<string, number>).every((id) => access.channels.has(id))) return body;
    return tx((db) => unreadBody(db, this.viewer.id));
  }

  private send(event: StreamEvent, body: Record<string, unknown>): void {
    this.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${JSON.stringify(body)}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }
}

const streams = new Map<string, Set<Stream>>();
let listener: pg.Client | null = null;

function pumpWorkspace(workspaceId: string): void {
  for (const stream of streams.get(workspaceId) ?? []) void stream.pump();
}

/** One LISTEN connection per process; on loss it reconnects on the next tick. */
async function ensureListener(): Promise<void> {
  if (listener) return;
  const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000 });
  listener = client;
  client.on("notification", (message) => {
    if (message.payload) pumpWorkspace(message.payload);
  });
  client.on("error", () => {
    listener = null;
    void client.end().catch(() => undefined);
  });
  try {
    await client.connect();
    await client.query("LISTEN tr_events");
  } catch {
    listener = null;
    await client.end().catch(() => undefined);
  }
}

/** Fallback for notifications lost while the listener reconnected, lease upkeep, and the end of
 * streams whose session has ended. */
export async function streamTick(): Promise<void> {
  await ensureListener();
  const open = [...streams.values()].flatMap((set) => [...set]);
  if (open.length === 0) return;
  await query(
    "INSERT INTO stream_leases (id, person_id, seen_at) SELECT id, person_id, $3 FROM unnest($1::uuid[], $2::uuid[]) AS open_stream(id, person_id) ON CONFLICT (id) DO UPDATE SET seen_at = EXCLUDED.seen_at",
    [open.map((s) => s.lease), open.map((s) => s.viewer.id), nowMs()],
  );
  await query("UPDATE people SET streams_closed_at = NULL WHERE id = ANY($1) AND streams_closed_at IS NOT NULL", [open.map((s) => s.viewer.id)]);
  const live = await query<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE token_hash = ANY($1)", [open.map((s) => s.viewer.sessionId)]);
  const sessions = new Set(live.map((r) => r.token_hash));
  for (const stream of open) {
    void stream.pump().then(() => {
      if (!sessions.has(stream.viewer.sessionId)) stream.end();
    });
  }
}

async function openStream(req: IncomingMessage, res: ServerResponse, viewer: Viewer): Promise<void> {
  const header = req.headers["last-event-id"];
  const lastId = typeof header === "string" && /^\d+$/.test(header.trim()) ? Number(header.trim()) : null;
  const lease = randomUUID();
  let gone = false;
  const leave = (): void => {
    gone = true;
  };
  req.on("close", leave);
  const { latest, oldestGone } = await tx(async (db) => {
    await db.query("INSERT INTO stream_leases (id, person_id, seen_at) VALUES ($1, $2, $3)", [lease, viewer.id, nowMs()]);
    await db.query("UPDATE people SET streams_closed_at = NULL WHERE id = $1", [viewer.id]);
    const { rows } = await db.query<{ latest: number | null; past_window: number | null; pruned: number }>(
      `SELECT (SELECT max(id) FROM events WHERE workspace_id = $1) AS latest,
              (SELECT id FROM events WHERE workspace_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1) AS past_window,
              pruned_through AS pruned
       FROM workspaces WHERE id = $1`,
      [viewer.workspaceId, KEEP],
    );
    return { latest: rows[0]?.latest ?? 0, oldestGone: Math.max(rows[0]?.past_window ?? 0, rows[0]?.pruned ?? 0) };
  });
  req.off("close", leave);
  if (gone || req.destroyed) {
    await releaseLease(lease, viewer.id);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const stream = new Stream(viewer, res, lease);
  if (lastId === null) {
    stream.start(latest);
  } else if (lastId < oldestGone) {
    stream.write("event: reset\ndata: {}\n\n");
    stream.start(latest);
  } else {
    stream.start(lastId);
  }
  const set = streams.get(viewer.workspaceId) ?? new Set<Stream>();
  streams.set(viewer.workspaceId, set);
  set.add(stream);
  res.write(": open\n\n");
  const keepalive = setInterval(() => stream.write(": keepalive\n\n"), 15_000);

  const release = (): void => {
    clearInterval(keepalive);
    stream.closed = true;
    set.delete(stream);
    void releaseLease(lease, viewer.id);
  };
  req.on("close", release);
  res.on("close", release);
  void stream.pump();
}

/** Drops the lease; when it was the person's last one, the grace period for their room starts. */
async function releaseLease(lease: string, personId: string): Promise<void> {
  try {
    await tx(async (db) => {
      await db.query("SELECT 1 FROM people WHERE id = $1 FOR UPDATE", [personId]);
      const { rowCount } = await db.query("DELETE FROM stream_leases WHERE id = $1", [lease]);
      if (!rowCount) return;
      const { rows } = await db.query("SELECT 1 FROM stream_leases WHERE person_id = $1 AND seen_at > $2", [personId, nowMs() - 15_000]);
      if (rows.length === 0) await db.query("UPDATE people SET streams_closed_at = $2 WHERE id = $1", [personId, nowMs()]);
    });
  } catch {
    // database down: the stale lease ages out and the presence sweeper handles the room
  }
}

route("GET", "/api/events", { access: "workspace" }, async (ctx) => openStream(ctx.req, ctx.res, ctx.viewer));
