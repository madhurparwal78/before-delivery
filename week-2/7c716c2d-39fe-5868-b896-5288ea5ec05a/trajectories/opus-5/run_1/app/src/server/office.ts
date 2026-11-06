import { now, nowDate } from './clock.js';
import { config } from './config.js';
import { db, type Queryable } from './db.js';
import { ApiError } from './errors.js';
import { appendEvent } from './events.js';
import { zoneOf } from './calendarstore.js';
import { storedInstant } from './domain/zone.js';
import type { Floor, Knock, Room } from '../shared/types.js';

export type RoomRow = {
  id: string;
  workspace_id: string;
  name: string;
  kind: 'open' | 'private';
  x: number;
  y: number;
  w: number;
  h: number;
};

export type KnockRow = {
  id: string;
  workspace_id: string;
  room_id: string;
  person_id: string;
  status: 'waiting' | 'let_in' | 'not_now' | 'expired';
  created_at: string;
  expires_at: string;
};

/** A knock is waiting until its expiry instant; the edge itself counts as expired. */
export function knockBody(row: KnockRow, zone: string): Knock {
  const expired = row.status === 'waiting' && now() >= Date.parse(row.expires_at);
  return {
    id: row.id,
    room_id: row.room_id,
    person_id: row.person_id,
    status: expired ? 'expired' : row.status,
    created_at: storedInstant(zone, row.created_at) ?? row.created_at,
    expires_at: storedInstant(zone, row.expires_at) ?? row.expires_at,
  };
}

export function knockExpiresAt(createdAt: number): string {
  return new Date(createdAt + config.knockTtlSeconds * 1000).toISOString();
}

export async function roomBody(roomId: string, client: Queryable = db): Promise<Room> {
  const room = await client.one<RoomRow>(
    'select id, workspace_id, name, kind, x, y, w, h from rooms where id = $1',
    [roomId],
  );
  if (room === undefined) throw new ApiError('not_found');
  const occupants = await client.query<{ person_id: string; name: string; away: boolean }>(
    `select o.person_id, p.name, p.away from room_occupants o join people p on p.id = o.person_id
      where o.room_id = $1 and p.removed = false order by p.name asc, p.id asc`,
    [roomId],
  );
  return {
    id: room.id,
    name: room.name,
    kind: room.kind,
    x: Number(room.x),
    y: Number(room.y),
    w: Number(room.w),
    h: Number(room.h),
    occupants: occupants.map((row) => ({
      person_id: row.person_id,
      name: row.name,
      status: row.away ? 'away' : 'active',
    })),
  };
}

export async function floorBody(
  workspaceId: string,
  personId: string,
  client: Queryable = db,
): Promise<Floor> {
  const rooms = await client.query<RoomRow>(
    'select id, workspace_id, name, kind, x, y, w, h from rooms where workspace_id = $1 order by sort asc',
    [workspaceId],
  );
  const bodies: Room[] = [];
  for (const room of rooms) bodies.push(await roomBody(room.id, client));
  const me = await client.one<{ room_id: string; away: boolean }>(
    `select o.room_id, p.away from people p left join room_occupants o on o.person_id = p.id where p.id = $1`,
    [personId],
  );
  return {
    rooms: bodies,
    me: { room_id: me?.room_id ?? null, status: me?.away === true ? 'away' : 'active' },
  };
}

export async function emitRoom(
  client: Queryable,
  workspaceId: string,
  roomId: string,
  at: string,
): Promise<void> {
  const body = await roomBody(roomId, client);
  await appendEvent(client, workspaceId, 'room', { ...body }, { type: 'workspace' }, at);
}

export async function emitKnock(
  client: Queryable,
  workspaceId: string,
  knockId: string,
  at: string,
): Promise<void> {
  const row = await client.one<KnockRow>(
    'select id, workspace_id, room_id, person_id, status, created_at, expires_at from knocks where id = $1',
    [knockId],
  );
  if (row === undefined) return;
  const zone = await zoneOf(workspaceId, client);
  await appendEvent(
    client,
    workspaceId,
    'knock',
    { ...knockBody(row, zone) },
    { type: 'knock', id: knockId },
    at,
  );
}

/** A private room that loses its last occupant expires its waiting knocks at once. */
export async function expireKnocksOfEmptyRoom(
  client: Queryable,
  workspaceId: string,
  roomId: string,
  at: string,
): Promise<void> {
  const room = await client.one<{ kind: string }>('select kind from rooms where id = $1', [roomId]);
  if (room === undefined || room.kind !== 'private') return;
  const occupants = await client.one<{ count: number }>(
    'select count(*)::int as count from room_occupants where room_id = $1',
    [roomId],
  );
  if ((occupants?.count ?? 0) > 0) return;
  const expired = await client.query<{ id: string }>(
    `update knocks set status = 'expired' where room_id = $1 and status = 'waiting' returning id`,
    [roomId],
  );
  for (const knock of expired) await emitKnock(client, workspaceId, knock.id, at);
}

/** Moves a person into a room, emitting the room changes their move causes. */
export async function enterRoom(
  client: Queryable,
  workspaceId: string,
  personId: string,
  roomId: string,
): Promise<void> {
  const at = nowDate().toISOString();
  const previous = await client.one<{ room_id: string }>(
    'select room_id from room_occupants where person_id = $1',
    [personId],
  );
  if (previous?.room_id === roomId) return;
  await client.query(
    `insert into room_occupants (person_id, room_id, workspace_id, joined_at) values ($1, $2, $3, $4)
     on conflict (person_id) do update set room_id = excluded.room_id, joined_at = excluded.joined_at`,
    [personId, roomId, workspaceId, at],
  );
  if (previous !== undefined) {
    await emitRoom(client, workspaceId, previous.room_id, at);
    await expireKnocksOfEmptyRoom(client, workspaceId, previous.room_id, at);
  }
  await emitRoom(client, workspaceId, roomId, at);
}

export async function leaveRoom(
  client: Queryable,
  workspaceId: string,
  personId: string,
): Promise<void> {
  const at = nowDate().toISOString();
  const left = await client.one<{ room_id: string }>(
    'delete from room_occupants where person_id = $1 returning room_id',
    [personId],
  );
  if (left === undefined) return;
  await emitRoom(client, workspaceId, left.room_id, at);
  await expireKnocksOfEmptyRoom(client, workspaceId, left.room_id, at);
}
