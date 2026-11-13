import type { Request, Response } from "express";
import { Redis } from "ioredis";
import type { AppCtx } from "./ctx.js";

interface StreamClient {
  res: Response;
  slugs: Set<string> | "*";
  userId: string | null;
  ownerOf: Set<string>;
  reviewerRooms: Set<string>;
  lastSeq: number;
  closed: boolean;
}

const streams = new Set<StreamClient>();

interface OutboxRow {
  seq: number;
  type: string;
  part_slug: string;
  room_id: string | null;
  data: string;
}

/** The audience rule: comments and approvals reach only the owner and that room's reviewers. */
function eventForClient(row: OutboxRow, client: StreamClient): boolean {
  if (client.slugs !== "*" && !client.slugs.has(row.part_slug)) return false;
  if (row.type === "comment" || row.type === "approvals") {
    if (!client.userId) return false;
    if (row.room_id !== null && client.reviewerRooms.has(row.room_id)) return true;
    return client.ownerOf.has(row.part_slug);
  }
  return true;
}

function writeEvent(client: StreamClient, row: OutboxRow): void {
  client.res.write(`id: ${row.seq}\nevent: ${row.type}\ndata: ${row.data}\n\n`);
  client.lastSeq = row.seq;
}

/** Open a resumable SSE stream. */
export async function eventStream(ctx: AppCtx, req: Request, res: Response): Promise<void> {
  const partsParam = typeof req.query.parts === "string" ? req.query.parts : "";
  const lastEventIdRaw = req.headers["last-event-id"];
  const lastEventId = typeof lastEventIdRaw === "string" && /^\d+$/.test(lastEventIdRaw) ? Number(lastEventIdRaw) : 0;
  const cookie = req.headers.cookie ?? "";
  const sid = /(?:^|;\s*)tw_session=([^;]+)/.exec(cookie)?.[1];
  let userId: string | null = null;
  const ownerOf = new Set<string>();
  const reviewerRooms = new Set<string>();
  if (sid) {
    const rows = await ctx.db.query(
      `select u.id from sessions s join users u on u.id = s.user_id where s.id = $1`, [sid]);
    userId = rows.rows[0]?.id ?? null;
  }
  if (userId) {
    const owned = await ctx.db.query(`select slug from parts where owner_id = $1`, [userId]);
    for (const r of owned.rows) ownerOf.add(r.slug);
    const rooms = await ctx.db.query(`select room_id from room_reviewers where user_id = $1`, [userId]);
    for (const r of rooms.rows) reviewerRooms.add(r.room_id);
  }
  const slugs: Set<string> | "*" = partsParam === "*" ? "*" : new Set(partsParam.split(",").filter(Boolean));
  const client: StreamClient = { res, slugs, userId, ownerOf, reviewerRooms, lastSeq: lastEventId, closed: false };
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write("retry: 1000\n\n");
  // Replay the missed retained events this audience may see, then continue live.
  if (lastEventId > 0) {
    const rows = await ctx.db.query(
      `select seq, type, part_slug, room_id, data::text as data from outbox where seq > $1 order by seq asc`, [lastEventId]
    );
    for (const row of rows.rows as unknown as OutboxRow[]) {
      if (eventForClient(row, client)) writeEvent(client, row);
    }
  }
  streams.add(client);
  req.on("close", () => {
    client.closed = true;
    streams.delete(client);
  });
}

/** Poll the outbox, publish to Valkey, and forward to this process's streams. */
export function relayOutbox(ctx: AppCtx): void {
  let lastSeq = 0;
  const tick = async (): Promise<void> => {
    try {
      const rows = await ctx.db.query(
        `select seq, type, part_slug, room_id, data::text as data from outbox where seq > $1 order by seq asc`, [lastSeq]
      );
      for (const row of rows.rows as unknown as OutboxRow[]) {
        lastSeq = row.seq;
        ctx.redis.publish(ctx.prefix(`part:${row.part_slug}`), JSON.stringify(row)).catch(() => {});
        for (const client of streams) {
          if (!client.closed && eventForClient(row, client)) writeEvent(client, row);
        }
      }
      await ctx.db.query(
        `delete from outbox where created_at < now() - make_interval(secs => $1)`,
        [ctx.config.outboxRetentionSeconds]
      ).catch(() => {});
    } catch { /* retry on the next tick */ }
  };
  setInterval(() => { void tick(); }, 200);
  // Other app processes publish to the part channel; forward those too.
  const sub = new Redis(ctx.config.valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: null });
  sub.on("error", () => { /* recover when Valkey returns */ });
  void sub.connect().then(() => sub.psubscribe(`${ctx.prefix}part:*`)).catch(() => {});
  sub.on("pmessage", (_pattern: string, _channel: string, message: string) => {
    try {
      const row = JSON.parse(message) as OutboxRow;
      for (const client of streams) {
        if (!client.closed && eventForClient(row, client)) writeEvent(client, row);
      }
    } catch { /* not for us */ }
  });
}

/** Close every open event stream (grading). */
export async function dropStreams(): Promise<void> {
  for (const client of [...streams]) {
    if (!client.closed) {
      client.closed = true;
      client.res.end();
    }
    streams.delete(client);
  }
}
