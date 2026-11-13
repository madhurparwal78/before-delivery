import { db, isUniqueViolation } from '../db.js';
import { fail, notFound, validation } from '../errors.js';
import { hub, roomChannel } from '../events.js';
import { empty, json, route, type Ctx } from '../http.js';
import { store } from '../s3.js';
import { assertEditable, findRoom, listNodes, listPlacements, reloadRoom, toRoom, type RoomRow } from '../domain/rooms.js';
import { recordChange, changesSince } from '../domain/changes.js';
import { activeSession, latestRunSessionId, settleExpired } from '../domain/playtests.js';
import type { RoomDetail } from '../../shared/types.js';

const NAME_MAX = 60;

async function roomDetail(ctx: Ctx, row: RoomRow): Promise<RoomDetail> {
  return {
    room: await toRoom(ctx.db, row),
    placements: await listPlacements(ctx.db, row.id),
    nodes: await listNodes(ctx.db, row.id),
    sceneOrder: row.scene_order,
    activeSession: await activeSession(ctx.db, row.id, ctx.now),
    latestSessionId: await latestRunSessionId(ctx.db, row.id),
  };
}

const roomLoader = (lock = false) => async (ctx: Ctx): Promise<RoomRow> => findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, lock);

async function nameTaken(ctx: Ctx, name: string, exceptRoomId?: string): Promise<boolean> {
  const found = await ctx.db.query(`SELECT 1 FROM rooms WHERE workspace_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3)`, [
    ctx.actor.workspaceId, name, exceptRoomId ?? null,
  ]);
  return found.rows.length > 0;
}

export function roomRoutes(): void {
  route('GET', '/api/rooms', {
    auth: 'member',
    run: async (ctx) => {
      const found = await ctx.db.query<RoomRow>(`SELECT * FROM rooms WHERE workspace_id = $1 ORDER BY lower(name), name`, [ctx.actor.workspaceId]);
      return json(200, { rooms: await Promise.all(found.rows.map((row) => toRoom(ctx.db, row))) });
    },
  });

  route('POST', '/api/rooms', {
    auth: 'member',
    conflict: async (ctx) => {
      const name = (ctx.body as { name?: unknown } | undefined)?.name;
      if (typeof name === 'string' && (await nameTaken(ctx, name))) throw fail(409, 'name_taken');
    },
    validate: (ctx) => {
      const input = ctx.input();
      const out = {
        name: input.text('name', 1, NAME_MAX, { trim: true }),
        widthMm: input.int('widthMm', 1000, 30_000),
        depthMm: input.int('depthMm', 1000, 30_000),
        heightMm: input.int('heightMm', 2000, 6000),
      };
      input.fields.check();
      return out as { name: string; widthMm: number; depthMm: number; heightMm: number };
    },
    run: async (ctx, _l, input) => {
      const id = crypto.randomUUID();
      try {
        await ctx.db.query(`INSERT INTO rooms (id, workspace_id, name, width_mm, depth_mm, height_mm) VALUES ($1,$2,$3,$4,$5,$6)`, [
          id, ctx.actor.workspaceId, input.name, input.widthMm, input.depthMm, input.heightMm,
        ]);
      } catch (error) {
        if (isUniqueViolation(error)) throw fail(409, 'name_taken');
        throw error;
      }
      return json(201, { room: await reloadRoom(ctx.db, id) });
    },
  });

  route('GET', '/api/rooms/:roomId', {
    auth: 'member',
    load: async (ctx) => {
      const row = await findRoom(db, ctx.actor.workspaceId, ctx.params.roomId!);
      await settleExpired(row.id, ctx.now);
      return findRoom(ctx.db, ctx.actor.workspaceId, row.id);
    },
    run: async (ctx, row) => json(200, await roomDetail(ctx, row)),
  });

  route('PATCH', '/api/rooms/:roomId', {
    auth: 'member',
    transaction: true,
    load: roomLoader(true),
    conflict: async (ctx, row) => {
      await assertEditable(ctx.db, row.id);
      const body = ctx.body as { name?: unknown; version?: unknown } | undefined;
      if (typeof body?.name === 'string' && (await nameTaken(ctx, body.name, row.id))) throw fail(409, 'name_taken');
      if (typeof body?.version === 'number' && body.version !== row.version) throw fail(412, 'stale_version', { current: await toRoom(ctx.db, row) });
    },
    validate: (ctx, row) => {
      const input = ctx.input();
      input.int('version', 0, 2_147_483_647);
      const out: { name?: string; widthMm?: number; depthMm?: number; heightMm?: number } = {};
      if (input.has('name')) out.name = input.text('name', 1, NAME_MAX, { trim: true });
      if (input.has('widthMm')) out.widthMm = input.int('widthMm', 1000, 30_000);
      if (input.has('depthMm')) out.depthMm = input.int('depthMm', 1000, 30_000);
      if (input.has('heightMm')) out.heightMm = input.int('heightMm', 2000, 6000);
      input.fields.check();
      return { ...out, row };
    },
    run: async (ctx, row, input) => {
      const width = input.widthMm ?? row.width_mm;
      const depth = input.depthMm ?? row.depth_mm;
      const height = input.heightMm ?? row.height_mm;
      const outside = await ctx.db.query<{ x_mm: number; y_mm: number; z_mm: number; width_mm: number; depth_mm: number; height_mm: number }>(
        `SELECT x_mm, y_mm, z_mm, width_mm, depth_mm, height_mm FROM placements WHERE room_id = $1 AND deleted_at IS NULL`,
        [row.id],
      );
      const fields: Record<string, string> = {};
      for (const p of outside.rows) {
        if (p.x_mm > width || p.width_mm > width) fields.widthMm ??= 'would leave a placement outside the room';
        if (p.z_mm > depth || p.depth_mm > depth) fields.depthMm ??= 'would leave a placement outside the room';
        if (p.y_mm > height || p.height_mm > height) fields.heightMm ??= 'would leave a placement outside the room';
      }
      if (Object.keys(fields).length > 0) throw validation(fields);
      await ctx.db.query(`UPDATE rooms SET name = $2, width_mm = $3, depth_mm = $4, height_mm = $5, version = version + 1 WHERE id = $1`, [
        row.id, input.name ?? row.name, width, depth, height,
      ]);
      await recordChange(ctx, row, { kind: 'update', placementId: null, scope: `room:${row.id}`, status: 200, response: () => undefined });
      const room = await reloadRoom(ctx.db, row.id);
      ctx.after.push(() => hub.publish(roomChannel(row.id), 'room', { room }));
      return json(200, { room });
    },
  });

  route('PUT', '/api/rooms/:roomId/thumbnail', {
    auth: 'member',
    limit: 'thumbnail',
    load: roomLoader(),
    validate: (ctx) => {
      const png = ctx.raw.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!png) throw validation({ file: 'not a PNG image' });
      return ctx.raw;
    },
    needs: ['storage'],
    run: async (ctx, row, png) => {
      await store.put(`thumbnails/${row.id}.png`, png, 'image/png');
      await ctx.db.query(`UPDATE rooms SET thumbnail_at = clock_timestamp() WHERE id = $1`, [row.id]);
      const room = await reloadRoom(ctx.db, row.id);
      ctx.after.push(() => hub.publish(roomChannel(row.id), 'room', { room }));
      return empty(204);
    },
  });

  route('GET', '/api/rooms/:roomId/thumbnail', {
    auth: 'member',
    load: roomLoader(),
    conflict: async (_ctx, row) => {
      if (!row.thumbnail_at) throw notFound();
    },
    needs: ['storage'],
    run: async (_ctx, row) => {
      const object = await store.get(`thumbnails/${row.id}.png`);
      if (!object) throw notFound();
      return { status: 200, bytes: object.body, headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000, immutable' } };
    },
  });

  route('GET', '/api/rooms/:roomId/changes', {
    auth: 'member',
    load: roomLoader(),
    run: async (ctx, row) => {
      const since = Number(ctx.query.get('since') ?? 0);
      return json(200, { revision: row.revision, changes: await changesSince(ctx.db, row.id, Number.isInteger(since) && since > 0 ? since : 0) });
    },
  });
}

