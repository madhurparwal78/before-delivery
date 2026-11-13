import { randomUUID } from 'node:crypto';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { limits } from '../config.js';
import { requireMember } from '../domain/session.js';
import { FieldCollector, asRecord, has, integer, text } from '../domain/validate.js';
import {
  chainFigures,
  livePlacements,
  loadRoom,
  orderedNodes,
  roomColumns,
  sceneOrder,
  toPlacement,
  toRoom,
  recordChange,
} from '../repo/rooms.js';
import type { RoomRow } from '../repo/rooms.js';
import { one, query, tx } from '../services/db.js';
import { getObject, putObject } from '../services/storage.js';
import { loadSession, serialiseSession, sessionColumns } from '../domain/playtest.js';
import type { SessionRow } from '../domain/playtest.js';
import { endDueSession } from '../domain/endings.js';
import { assertNoRunningPlaytest, memberRoom, publishRoom, reply } from './support.js';
import type { ChainFigures } from '../../shared/types.js';

const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const roomRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/rooms',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      return tx(async (client) => {
        const list = await client.query<RoomRow>(
          `select ${roomColumns} from rooms where workspace_id = $1 order by lower(name)`,
          [member.workspaceId],
        );
        const rooms = [];
        for (const row of list.rows) {
          rooms.push(toRoom(row, await chainFigures(client, row.id)));
        }
        return { rooms };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/rooms',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const body = asRecord(ctx.body);
      const collector = new FieldCollector();
      const name = text(body, 'name', 1, 60, collector);
      const widthMm = integer(body, 'widthMm', 1000, 30_000, collector);
      const depthMm = integer(body, 'depthMm', 1000, 30_000, collector);
      const heightMm = integer(body, 'heightMm', 2000, 6000, collector);
      if (name !== null) {
        const taken = await one<{ id: string }>(
          `select id from rooms where workspace_id = $1 and name_lower = $2`,
          [member.workspaceId, name.toLowerCase()],
        );
        if (taken) throw errors.nameTaken();
      }
      collector.throwIfAny();
      const roomId = randomUUID();
      await query(
        `insert into rooms (id, workspace_id, name, name_lower, starter, width_mm, depth_mm,
           height_mm)
         values ($1,$2,$3,$4,false,$5,$6,$7)`,
        [roomId, member.workspaceId, name, (name as string).toLowerCase(), widthMm, depthMm, heightMm],
      );
      const room = await tx((client) => loadRoom(client, roomId));
      return reply(201, { room });
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const roomRow = await memberRoom(member, ctx.params.roomId);
      await endDueSession(roomRow.id);
      return tx(async (client) => {
        const room = await loadRoom(client, roomRow.id);
        const placements = (await livePlacements(client, roomRow.id)).map(toPlacement);
        const nodes = await orderedNodes(client, roomRow.id);
        const order = await sceneOrder(client, roomRow.id);
        const active = await client.query<SessionRow>(
          `select ${sessionColumns} from playtests
             where room_id = $1 and state in ('lobby','running') limit 1`,
          [roomRow.id],
        );
        const latest = await client.query<{ id: string }>(
          `select id from playtests where room_id = $1 order by created_at desc limit 1`,
          [roomRow.id],
        );
        return {
          room,
          placements,
          nodes,
          sceneOrder: order,
          activeSession: active.rows[0]
            ? await serialiseSession(client, active.rows[0])
            : null,
          latestSessionId: latest.rows[0] ? latest.rows[0].id : null,
        };
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/rooms/:roomId',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const roomRow = await memberRoom(member, ctx.params.roomId);
      const body = asRecord(ctx.body);
      return tx(async (client) => {
        await assertNoRunningPlaytest(client, roomRow.id);
        const current = await loadRoom(client, roomRow.id);
        if (!current) throw errors.notFound();
        if (body.version !== current.version) throw errors.staleVersion(current);
        const collector = new FieldCollector();
        const name = has(body, 'name') ? text(body, 'name', 1, 60, collector) : null;
        const widthMm = has(body, 'widthMm')
          ? integer(body, 'widthMm', 1000, 30_000, collector)
          : null;
        const depthMm = has(body, 'depthMm')
          ? integer(body, 'depthMm', 1000, 30_000, collector)
          : null;
        const heightMm = has(body, 'heightMm')
          ? integer(body, 'heightMm', 2000, 6000, collector)
          : null;
        if (name !== null && name.toLowerCase() !== roomRow.name.toLowerCase()) {
          const taken = await one<{ id: string }>(
            `select id from rooms where workspace_id = $1 and name_lower = $2`,
            [member.workspaceId, name.toLowerCase()],
          );
          if (taken) throw errors.nameTaken();
        }
        const nextWidth = widthMm ?? current.widthMm;
        const nextDepth = depthMm ?? current.depthMm;
        const nextHeight = heightMm ?? current.heightMm;
        const placements = await livePlacements(client, roomRow.id);
        for (const placement of placements) {
          if (placement.x_mm > nextWidth || placement.width_mm > nextWidth) {
            collector.add('widthMm', 'a placement would fall outside the room');
          }
          if (placement.z_mm > nextDepth || placement.depth_mm > nextDepth) {
            collector.add('depthMm', 'a placement would fall outside the room');
          }
          if (placement.y_mm > nextHeight || placement.height_mm > nextHeight) {
            collector.add('heightMm', 'a placement would fall outside the room');
          }
        }
        collector.throwIfAny();
        await client.query(
          `update rooms set name = coalesce($2, name), name_lower = coalesce($3, name_lower),
             width_mm = $4, depth_mm = $5, height_mm = $6, version = version + 1 where id = $1`,
          [
            roomRow.id,
            name,
            name === null ? null : name.toLowerCase(),
            nextWidth,
            nextDepth,
            nextHeight,
          ],
        );
        const room = await loadRoom(client, roomRow.id);
        await recordChange(client, member.workspaceId, roomRow.id, {
          kind: 'update',
          placementId: null,
          opId: null,
          userId: member.id,
          status: 200,
          response: { room },
        });
        const refreshed = await loadRoom(client, roomRow.id);
        publishRoom(roomRow.id, 'room', { room: refreshed });
        return { room: refreshed };
      });
    },
  },
  {
    method: 'PUT',
    pattern: '/api/rooms/:roomId/thumbnail',
    body: 'bytes',
    bodyLimit: limits.thumbnail,
    async handler(ctx) {
      const member = await requireMember(ctx);
      const roomRow = await memberRoom(member, ctx.params.roomId);
      if (!ctx.bytes.subarray(0, 8).equals(pngMagic)) {
        throw errors.field('file', 'not a PNG image');
      }
      await putObject(`thumbnails/${roomRow.id}.png`, ctx.bytes, 'image/png');
      await query(`update rooms set has_thumbnail = true where id = $1`, [roomRow.id]);
      return undefined;
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId/thumbnail',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const roomRow = await memberRoom(member, ctx.params.roomId);
      if (!roomRow.has_thumbnail) throw errors.notFound();
      const bytes = await getObject(`thumbnails/${roomRow.id}.png`);
      if (bytes === null) throw errors.notFound();
      ctx.res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-cache',
      });
      ctx.res.end(bytes);
      return null;
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId/changes',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const roomRow = await memberRoom(member, ctx.params.roomId);
      const since = Number(ctx.query.get('since') ?? '0');
      const list = await query<{
        revision: number;
        op_id: string | null;
        kind: string;
        placement_id: string | null;
        user_id: string;
      }>(
        `select revision, op_id, kind, placement_id, user_id from room_changes
           where room_id = $1 and revision > $2 order by revision`,
        [roomRow.id, Number.isFinite(since) ? since : 0],
      );
      const current = await one<{ revision: number }>(`select revision from rooms where id = $1`, [
        roomRow.id,
      ]);
      return {
        revision: current ? current.revision : 0,
        changes: list.map((row) => ({
          revision: row.revision,
          opId: row.op_id,
          kind: row.kind,
          placementId: row.placement_id,
          userId: row.user_id,
        })),
      };
    },
  },
];

export async function roomStats(roomId: string): Promise<ChainFigures> {
  return tx((client) => chainFigures(client, roomId));
}

export async function sessionOf(sessionId: string): Promise<SessionRow | null> {
  return tx((client) => loadSession(client, sessionId));
}
