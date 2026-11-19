import { query, type Queryable } from './db.js';
import { config } from './config.js';
import type { Ctx } from './http.js';
import { stateAtTick, worldTick } from './domain/world.js';

export type LiveKind =
  | 'world'
  | 'progress'
  | 'position'
  | 'like'
  | 'hall'
  | 'safari'
  | 'sighting'
  | 'safari_photo'
  | 'note'
  | 'board';

export async function publish(
  db: Queryable,
  worldId: string,
  audience: string | null,
  kind: LiveKind,
  payload: unknown,
): Promise<void> {
  await db.query('INSERT INTO events (world_id, audience, kind, payload) VALUES ($1, $2, $3, $4)', [
    worldId,
    audience,
    kind,
    JSON.stringify(payload),
  ]);
}

const POLL_MS = Math.max(100, Math.min(config.liveIntervalMs, 400));

export async function streamLive(ctx: Ctx, playerId: string, worldId: string): Promise<void> {
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const start = await query<{ id: string }>('SELECT coalesce(max(id), 0)::text AS id FROM events WHERE world_id = $1', [
    worldId,
  ]);
  let lastEventId = Number(start.rows[0].id);
  let lastTick = -1;
  let closed = false;

  const write = (payload: unknown): void => {
    if (closed) return;
    ctx.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const poll = async (): Promise<void> => {
    if (closed) return;
    const tick = await worldTick(worldId);
    if (tick !== lastTick) {
      lastTick = tick;
      write({ kind: 'world', world: stateAtTick(worldId, tick) });
    }
    const events = await query<{ id: string; kind: string; payload: unknown }>(
      `SELECT id::text AS id, kind, payload FROM events
       WHERE world_id = $1 AND id > $2 AND (audience IS NULL OR audience = $3)
       ORDER BY id ASC LIMIT 200`,
      [worldId, lastEventId, playerId],
    );
    for (const row of events.rows) {
      lastEventId = Number(row.id);
      write({ kind: row.kind, ...(row.payload as Record<string, unknown>) });
    }
    await query("UPDATE safaris SET guest_seen_at = now() WHERE guest_id = $1 AND status = 'joined'", [playerId]);
  };

  await poll().catch(() => undefined);
  const timer = setInterval(() => {
    void poll().catch(() => undefined);
  }, POLL_MS);

  const finish = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    void query("UPDATE safaris SET guest_seen_at = now() WHERE guest_id = $1 AND status = 'joined'", [playerId]).catch(
      () => undefined,
    );
    ctx.res.end();
  };

  ctx.req.on('close', finish);
  ctx.req.on('error', finish);
  ctx.res.on('error', finish);

  await new Promise<void>((resolve) => {
    ctx.res.on('close', () => resolve());
  });
}

/** Frees a guest seat once the published release window has passed since the guest's last stream. */
export async function sweepSafariSeats(): Promise<void> {
  const freed = await query<{ code: string; world_id: string; host_id: string; guest_name: string; guest_id: string }>(
    `UPDATE safaris SET status = 'open', guest_id = NULL, guest_seen_at = NULL
     WHERE status = 'joined' AND guest_seen_at < now() - ($1 || ' seconds')::interval
     RETURNING code, world_id, host_id,
       (SELECT name FROM players WHERE id = safaris.guest_id) AS guest_name,
       guest_id`,
    [config.safariSeatReleaseSeconds],
  );
  for (const row of freed.rows) {
    await publish({ query }, row.world_id, row.host_id, 'safari', {
      event: 'guest_left',
      code: row.code,
      guest_name: row.guest_name,
    });
  }
}

export async function pruneEvents(): Promise<void> {
  await query("DELETE FROM events WHERE created_at < now() - interval '10 minutes'");
}
