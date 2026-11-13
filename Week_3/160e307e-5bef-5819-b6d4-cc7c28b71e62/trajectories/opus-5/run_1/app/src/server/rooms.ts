import { randomInt } from 'node:crypto';
import { one, query, transaction } from './db.js';
import { conflict, forbidden, gone, notFound } from './errors.js';
import { env } from './env.js';
import { bus } from './bus.js';
import { createMatch, getMatch, seatGuest } from './match.js';
import { equippedFor, playerById } from './players.js';
import type { PlayerRow } from './players.js';
import type { Format } from '../shared/types.js';
import { ROOM_ALPHABET, ROOM_CODE_LENGTH } from '../shared/room.js';


interface RoomRow {
  code: string;
  format: Format;
  host_id: string;
  guest_id: string | null;
  status: 'open' | 'full' | 'closed';
  match_id: string | null;
  expires_at: Date;
}

function newCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += ROOM_ALPHABET[randomInt(0, ROOM_ALPHABET.length)];
  return code;
}

export async function createRoom(host: PlayerRow, format: Format): Promise<{ code: string; matchId: string }> {
  const match = await createMatch({
    mode: 'private',
    format,
    seats: [
      {
        playerId: host.id,
        name: host.name,
        avatar: host.avatar,
        strikerSkin: (await equippedFor(host.id)).striker,
      },
    ],
    startActive: false,
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = newCode();
    const rows = await query<{ code: string }>(
      `insert into rooms (code, format, host_id, status, match_id, expires_at)
       values ($1, $2, $3, 'open', $4, now() + ($5 || ' seconds')::interval)
       on conflict (code) do nothing returning code`,
      [code, format, host.id, match.id, String(env.roomExpirySeconds)],
    );
    if (rows.length > 0) {
      await query('update matches set room_code = $2 where id = $1', [match.id, code]);
      const live = await getMatch(match.id);
      if (live !== null) live.roomCode = code;
      return { code, matchId: match.id };
    }
  }
  throw conflict('ROOM_FULL');
}

async function roomRow(code: string): Promise<RoomRow | null> {
  return one<RoomRow>(
    'select code, format, host_id, guest_id, status, match_id::text, expires_at from rooms where code = $1',
    [code.toUpperCase()],
  );
}

function expired(room: RoomRow): boolean {
  return room.guest_id === null && room.expires_at.getTime() <= Date.now();
}

export async function roomJson(code: string): Promise<Record<string, unknown>> {
  const room = await roomRow(code);
  if (room === null) throw notFound('ROOM_NOT_FOUND');
  const host = await playerById(room.host_id);
  const guest = room.guest_id === null ? null : await playerById(room.guest_id);
  const status = room.status === 'closed' || expired(room) ? 'closed' : room.guest_id === null ? 'open' : 'full';
  return {
    code: room.code,
    format: room.format,
    status,
    host: host === null ? null : { id: host.id, name: host.name },
    guest: guest === null ? null : { id: guest.id, name: guest.name },
    expiresInMs: status === 'open' ? Math.max(0, room.expires_at.getTime() - Date.now()) : null,
    matchId: room.match_id,
  };
}

function pushRoom(code: string): void {
  void roomJson(code).then(
    (json) => bus.toMatch(`room:${code.toUpperCase()}`, 'roomStatus', json),
    () => undefined,
  );
}

/** A room admits exactly one joiner: the claim is a single atomic update. */
export async function joinRoom(code: string, player: PlayerRow): Promise<{ matchId: string }> {
  const upper = code.toUpperCase();
  const room = await roomRow(upper);
  if (room === null) throw notFound('ROOM_NOT_FOUND');
  if (room.match_id === null) throw notFound('ROOM_NOT_FOUND');
  if (room.host_id === player.id) return { matchId: room.match_id };
  if (room.guest_id === player.id) return { matchId: room.match_id };
  if (room.status === 'closed' || expired(room)) throw gone('ROOM_CLOSED');

  const claimed = await transaction(async (client) => {
    const result = await client.query<{ match_id: string }>(
      `update rooms set guest_id = $2, status = 'full'
       where code = $1 and guest_id is null and status = 'open' and expires_at > now()
       returning match_id::text`,
      [upper, player.id],
    );
    return result.rows[0] ?? null;
  });
  if (claimed === null) {
    const after = await roomRow(upper);
    if (after === null) throw notFound('ROOM_NOT_FOUND');
    if (after.guest_id === player.id) return { matchId: room.match_id };
    if (after.status === 'closed' || expired(after)) throw gone('ROOM_CLOSED');
    throw conflict('ROOM_FULL');
  }
  const match = await getMatch(claimed.match_id);
  if (match === null) throw notFound('ROOM_NOT_FOUND');
  await seatGuest(match, player.id, player.name, player.avatar);
  pushRoom(upper);
  return { matchId: claimed.match_id };
}

export async function closeRoom(code: string, player: PlayerRow): Promise<void> {
  const room = await roomRow(code);
  if (room === null) throw notFound('ROOM_NOT_FOUND');
  if (room.host_id !== player.id) throw forbidden('NOT_HOST');
  await query("update rooms set status = 'closed' where code = $1", [room.code]);
  pushRoom(room.code);
}
