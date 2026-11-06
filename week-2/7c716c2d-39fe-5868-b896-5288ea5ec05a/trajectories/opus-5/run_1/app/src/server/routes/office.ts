import { randomUUID } from 'node:crypto';
import { now, nowDate } from '../clock.js';
import { config } from '../config.js';
import { db, tx, type Queryable } from '../db.js';
import { ApiError } from '../errors.js';
import { requireWorkspace, type Actor } from '../access.js';
import {
  emitKnock,
  enterRoom,
  floorBody,
  knockBody,
  knockExpiresAt,
  leaveRoom,
  type KnockRow,
  type RoomRow,
} from '../office.js';
import { sessionRoute, type Route } from '../router.js';
import { uuidOrNotFound } from '../validate.js';
import { zoneOf } from '../calendarstore.js';

const knockColumns =
  'id, workspace_id, room_id, person_id, status, created_at, expires_at';

async function requireRoom(actor: Actor, roomId: string, client: Queryable = db): Promise<RoomRow> {
  const row = await client.one<RoomRow>(
    'select id, workspace_id, name, kind, x, y, w, h from rooms where id = $1 and workspace_id = $2',
    [roomId, actor.workspaceId],
  );
  if (row === undefined) throw new ApiError('not_found');
  return row;
}

async function occupantCount(roomId: string, client: Queryable = db): Promise<number> {
  const row = await client.one<{ count: number }>(
    `select count(*)::int as count from room_occupants o join people p on p.id = o.person_id
      where o.room_id = $1 and p.removed = false`,
    [roomId],
  );
  return row?.count ?? 0;
}

async function isInside(roomId: string, personId: string, client: Queryable = db): Promise<boolean> {
  const row = await client.one<{ person_id: string }>(
    'select person_id from room_occupants where room_id = $1 and person_id = $2',
    [roomId, personId],
  );
  return row !== undefined;
}

export const officeRoutes: Route[] = [
  sessionRoute('GET', '/api/floor', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    return { status: 200, body: await floorBody(workspaceId, ctx.actor.id) };
  }),

  sessionRoute('POST', '/api/rooms/leave', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    await tx(async (client) => {
      await leaveRoom(client, workspaceId, ctx.actor.id);
    });
    return { status: 204 };
  }),

  sessionRoute('POST', '/api/presence/heartbeat', 'json', async (ctx) => {
    requireWorkspace(ctx.actor);
    return { status: 204 };
  }),

  sessionRoute('POST', '/api/rooms/:id/join', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const roomId = uuidOrNotFound(ctx.params.id);
    const room = await requireRoom(ctx.actor, roomId);
    await tx(async (client) => {
      if (room.kind === 'private' && !(await isInside(roomId, ctx.actor.id, client))) {
        const occupants = await occupantCount(roomId, client);
        if (occupants > 0) {
          const letIn = await client.one<KnockRow>(
            `select ${knockColumns} from knocks
              where room_id = $1 and person_id = $2 and status = 'let_in'
              order by created_at desc limit 1`,
            [roomId, ctx.actor.id],
          );
          const fresh =
            letIn !== undefined &&
            now() - Date.parse(letIn.created_at) < config.knockTtlSeconds * 1000;
          if (!fresh) throw new ApiError('knock_required');
        }
      }
      await enterRoom(client, workspaceId, ctx.actor.id, roomId);
    });
    return { status: 200, body: await floorBody(workspaceId, ctx.actor.id) };
  }),

  sessionRoute('POST', '/api/rooms/:id/knocks', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const zone = await zoneOf(workspaceId);
    const roomId = uuidOrNotFound(ctx.params.id);
    const room = await requireRoom(ctx.actor, roomId);
    if (room.kind === 'open') throw new ApiError('room_open');
    if (await isInside(roomId, ctx.actor.id)) throw new ApiError('already_inside');
    if ((await occupantCount(roomId)) === 0) throw new ApiError('room_empty');
    const result = await tx(async (client) => {
      const existing = await client.one<KnockRow>(
        `select ${knockColumns} from knocks
          where room_id = $1 and person_id = $2 and status = 'waiting' and expires_at > $3
          order by created_at desc limit 1`,
        [roomId, ctx.actor.id, nowDate().toISOString()],
      );
      if (existing !== undefined) return { status: 200, body: knockBody(existing, zone) };
      const at = now();
      const id = randomUUID();
      await client.query(
        `insert into knocks (${knockColumns}) values ($1, $2, $3, $4, 'waiting', $5, $6)`,
        [id, workspaceId, roomId, ctx.actor.id, new Date(at).toISOString(), knockExpiresAt(at)],
      );
      await emitKnock(client, workspaceId, id, new Date(at).toISOString());
      const row = await client.one<KnockRow>(`select ${knockColumns} from knocks where id = $1`, [id]);
      if (row === undefined) throw new ApiError('not_found');
      return { status: 201, body: knockBody(row, zone) };
    });
    return result;
  }),

  sessionRoute('GET', '/api/rooms/:id/knocks/mine', 'none', async (ctx) => {
    const zone = await zoneOf(requireWorkspace(ctx.actor));
    const roomId = uuidOrNotFound(ctx.params.id);
    await requireRoom(ctx.actor, roomId);
    const row = await db.one<KnockRow>(
      `select ${knockColumns} from knocks where room_id = $1 and person_id = $2
        order by created_at desc, id desc limit 1`,
      [roomId, ctx.actor.id],
    );
    if (row === undefined) throw new ApiError('not_found');
    return { status: 200, body: knockBody(row, zone) };
  }),

  sessionRoute('GET', '/api/rooms/:id/knocks', 'none', async (ctx) => {
    const zone = await zoneOf(requireWorkspace(ctx.actor));
    const roomId = uuidOrNotFound(ctx.params.id);
    await requireRoom(ctx.actor, roomId);
    if (!(await isInside(roomId, ctx.actor.id))) throw new ApiError('not_in_room');
    const rows = await db.query<KnockRow>(
      `select ${knockColumns} from knocks where room_id = $1 and status = 'waiting' and expires_at > $2
        order by created_at asc, id asc`,
      [roomId, nowDate().toISOString()],
    );
    return { status: 200, body: { knocks: rows.map((row) => knockBody(row, zone)) } };
  }),

  sessionRoute('GET', '/api/knocks/:id', 'none', async (ctx) => {
    const zone = await zoneOf(requireWorkspace(ctx.actor));
    const knockId = uuidOrNotFound(ctx.params.id);
    const row = await db.one<KnockRow>(
      `select ${knockColumns} from knocks where id = $1 and workspace_id = $2`,
      [knockId, ctx.actor.workspaceId],
    );
    if (row === undefined) throw new ApiError('not_found');
    const mine = row.person_id === ctx.actor.id;
    if (!mine && !(await isInside(row.room_id, ctx.actor.id))) throw new ApiError('not_found');
    return { status: 200, body: knockBody(row, zone) };
  }),

  sessionRoute('POST', '/api/knocks/:id/answer', 'json', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const zone = await zoneOf(workspaceId);
    const knockId = uuidOrNotFound(ctx.params.id);
    const answer = ctx.body.answer;
    const existing = await db.one<KnockRow>(
      `select ${knockColumns} from knocks where id = $1 and workspace_id = $2`,
      [knockId, workspaceId],
    );
    if (existing === undefined) throw new ApiError('not_found');
    if (!(await isInside(existing.room_id, ctx.actor.id))) throw new ApiError('not_in_room');
    if (answer !== 'let_in' && answer !== 'not_now') {
      throw new ApiError('validation', {
        fields: { answer: 'Answer let_in or not_now.' },
        message: 'Answer let_in or not_now.',
      });
    }
    const body = await tx(async (client) => {
      const row = await client.one<KnockRow>(
        `select ${knockColumns} from knocks where id = $1 for update`,
        [knockId],
      );
      if (row === undefined) throw new ApiError('not_found');
      const current = knockBody(row, zone);
      if (current.status === 'expired') throw new ApiError('knock_expired');
      if (current.status !== 'waiting') throw new ApiError('knock_answered');
      const at = nowDate().toISOString();
      await client.query('update knocks set status = $2 where id = $1', [knockId, answer]);
      await emitKnock(client, workspaceId, knockId, at);
      if (answer === 'let_in') await enterRoom(client, workspaceId, row.person_id, row.room_id);
      const updated = await client.one<KnockRow>(`select ${knockColumns} from knocks where id = $1`, [
        knockId,
      ]);
      if (updated === undefined) throw new ApiError('not_found');
      return knockBody(updated, zone);
    });
    return { status: 200, body };
  }),
];
