/** The Server-Sent Events streams with gap-free resume. */

import type { Pool } from "../db/pool.js";
import type { Response } from "express";
import { eventsAfter, latestSeq, visibleTo } from "./events.js";
import { sessionUser } from "./sessions.js";
import { presence } from "./presence.js";
import { friendsList } from "../invites/invites.js";
import { weatherView } from "../world/weather.js";
import { worldView, loadWorldBySlug } from "../world/world.js";
import { loadTable, tableView } from "../tables/serialize.js";

interface StreamContext {
  serverId: string;
  userId: string;
  handle: string;
  userCharacterIds: Set<string>;
  worldSlug: string | null;
  tableId: string | null;
}

function sendEvent(res: Response, id: string, event: string, data: unknown): void {
  res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendSnapshot(res: Response, id: string, event: string, data: unknown): void {
  sendEvent(res, id, event, data);
}

async function characterIdsOf(pool: Pool, serverId: string, userId: string): Promise<Set<string>> {
  const rows = await pool.query<{ id: string }>("SELECT id FROM characters WHERE server_id = $1 AND user_id = $2", [serverId, userId]);
  return new Set(rows.rows.map((r) => r.id));
}

/** Runs one SSE stream, honouring Last-Event-ID. */
export async function runStream(
  pool: Pool,
  res: Response,
  input: { serverId: string; kind: "server" | "world" | "table"; worldSlug?: string; tableId?: string }
): Promise<void> {
  const lastEventId = res.req.headers["last-event-id"];
  let last = lastEventId === undefined ? 0 : Number(lastEventId);
  if (!Number.isFinite(last) || last < 0) last = 0;

  const user = await sessionUser(pool, res.req);
  if (user === null) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in to continue." });
    return;
  }
  const member = await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [input.serverId, user.id]);
  if (member.rows.length === 0) {
    res.status(404).json({ error: "not_found", message: "Not found." });
    return;
  }
  if (input.kind === "world" && input.worldSlug !== undefined) {
    const world = await loadWorldBySlug(pool, input.serverId, input.worldSlug);
    if (world === null) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
  }
  if (input.kind === "table" && input.tableId !== undefined) {
    const table = (await pool.query<{ server_id: string }>("SELECT server_id FROM tables_ WHERE id = $1", [input.tableId])).rows[0];
    if (table === undefined || table.server_id !== input.serverId) {
      res.status(404).json({ error: "not_found", message: "Not found." });
      return;
    }
  }

  const ctx: StreamContext = {
    serverId: input.serverId,
    userId: user.id,
    handle: user.handle,
    userCharacterIds: await characterIdsOf(pool, input.serverId, user.id),
    worldSlug: input.worldSlug ?? null,
    tableId: input.tableId ?? null,
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");
  presence.open(input.serverId, user.handle);

  async function refreshFriends(): Promise<void> {
    const { publishFriends } = await import("../invites/invites.js");
    await publishFriends(pool, input.serverId);
  }

  let closed = false;
  res.on("close", () => {
    closed = true;
    presence.close(input.serverId, user.handle);
    void refreshFriends();
  });

  const snapshotId = await latestSeq(pool, input.serverId);
  const fresh = last === 0 || last < snapshotId - 1800;
  if (fresh) {
    await sendSnapshots(pool, res, ctx, String(snapshotId));
    last = snapshotId;
  } else {
    await replayMissed(pool, res, ctx, last);
    last = (await latestSeq(pool, input.serverId)) - 1;
  }

  const heartbeat = setInterval(() => {
    if (closed) return;
    res.write(": ping\n\n");
    presence.heartbeat(input.serverId, user.handle);
  }, 15000);

  const pollTimer = setInterval(async () => {
    if (closed) return;
    try {
      const rows = await eventsAfter(pool, input.serverId, last, 100);
      for (const row of rows) {
        if (visibleTo(row, ctx.userId, ctx.handle, ctx.userCharacterIds, ctx.worldSlug, ctx.tableId)) {
          if (row.kind === "server") {
            await sendServerSnapshot(pool, res, ctx, row.seq);
          } else {
            sendEvent(res, row.seq, row.kind, row.payload);
          }
        }
        last = Number(row.seq);
      }
    } catch {
      // the stream ends on the next tick
    }
  }, 400);
  res.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(pollTimer);
  });
  void pollTimer;
}

async function replayMissed(pool: Pool, res: Response, ctx: StreamContext, after: number): Promise<void> {
  const rows = await eventsAfter(pool, ctx.serverId, after, 500);
  for (const row of rows) {
    if (visibleTo(row, ctx.userId, ctx.handle, ctx.userCharacterIds, ctx.worldSlug, ctx.tableId)) {
      if (row.kind === "server") {
        await sendServerSnapshot(pool, res, ctx, row.seq);
      } else {
        sendEvent(res, row.seq, row.kind, row.payload);
      }
    }
  }
}

async function sendSnapshots(pool: Pool, res: Response, ctx: StreamContext, id: string): Promise<void> {
  if (ctx.tableId !== null) {
    const table = await loadTable(pool, ctx.tableId);
    if (table !== null) {
      const view = await tableView(pool, table, { userId: ctx.userId });
      sendSnapshot(res, id, "snapshot", { table: view });
    }
    return;
  }
  if (ctx.worldSlug !== null) {
    const world = await loadWorldBySlug(pool, ctx.serverId, ctx.worldSlug);
    if (world !== null) {
      const view = await worldView(pool, world);
      sendSnapshot(res, id, "snapshot", { world: view });
    }
    return;
  }
  await sendServerSnapshot(pool, res, ctx, id);
}

async function sendServerSnapshot(pool: Pool, res: Response, ctx: StreamContext, id: string): Promise<void> {
  const server = (await pool.query<{ id: string; slug: string; name: string; owner_id: string; status: string; time_zone: string; plan: string; season: number; suspends_at: Date | null }>(
    "SELECT id, slug, name, owner_id, status, time_zone, plan, season, suspends_at FROM servers WHERE id = $1",
    [ctx.serverId]
  )).rows[0];
  if (server === undefined) return;
  const owner = (await pool.query<{ handle: string }>("SELECT handle FROM users WHERE id = $1", [server.owner_id])).rows[0];
  const worlds = await pool.query<{ slug: string; name: string }>("SELECT slug, name FROM worlds WHERE server_id = $1 ORDER BY slug", [ctx.serverId]);
  const counts = await pool.query<{ member_count: string; character_count: string }>(
    `SELECT (SELECT count(*) FROM members WHERE server_id = $1)::text AS member_count,
            (SELECT count(*) FROM characters WHERE server_id = $1)::text AS character_count`,
    [ctx.serverId]
  );
  const friends = await friendsList(pool, ctx.serverId);
  const weather = await weatherView(pool, ctx.serverId);
  const { zoneLabelWithZone, isoInstant } = await import("../time.js");
  const payload = {
    server: {
      id: server.id,
      slug: server.slug,
      name: server.name,
      owner: owner?.handle ?? "",
      role: server.owner_id === ctx.userId ? "owner" : "member",
      status: server.status,
      suspends_at: server.suspends_at === null ? null : isoInstant(server.suspends_at),
      suspends_at_label: server.suspends_at === null ? null : zoneLabelWithZone(server.suspends_at, server.time_zone),
      time_zone: server.time_zone,
      plan: server.plan,
      season: server.season,
      worlds: worlds.rows,
      member_count: Number(counts.rows[0]?.member_count ?? 0),
      character_count: Number(counts.rows[0]?.character_count ?? 0),
    },
    friends,
    weather,
  };
  sendSnapshot(res, id, "snapshot", payload);
}
