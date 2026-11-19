import { randomInt, randomUUID } from 'node:crypto';
import { ApiError } from '../../shared/errors.js';
import { isLand } from '../../shared/islands.js';
import { query, type Queryable } from '../db.js';
import { publish } from '../live.js';
import type { PlayerRow } from './players.js';

export type SafariRow = {
  id: string;
  world_id: string;
  code: string;
  status: 'open' | 'joined' | 'ended';
  host_id: string;
  guest_id: string | null;
};

export type Sighting = { island: number; x: number; y: number; by: string };

export type Safari = {
  code: string;
  status: 'open' | 'joined' | 'ended';
  host: string;
  guest: string | null;
  sightings?: Sighting[];
};

function code(): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += String.fromCharCode(65 + randomInt(0, 26));
  return out;
}

async function names(db: Queryable, row: SafariRow): Promise<Safari> {
  const found = await db.query<{ id: string; name: string }>('SELECT id, name FROM players WHERE id = ANY($1)', [
    [row.host_id, row.guest_id].filter((id): id is string => id !== null),
  ]);
  const byId = new Map(found.rows.map((player) => [player.id, player.name]));
  return {
    code: row.code,
    status: row.status,
    host: byId.get(row.host_id) ?? '',
    guest: row.guest_id ? (byId.get(row.guest_id) ?? null) : null,
  };
}

export async function sightingsOf(db: Queryable, safariId: string): Promise<Sighting[]> {
  const found = await db.query<{ island: number; x: number; y: number; by: string }>(
    `SELECT sightings.island, sightings.x, sightings.y, players.name AS by
       FROM sightings JOIN players ON players.id = sightings.by_id
      WHERE sightings.safari_id = $1 ORDER BY sightings.created_at ASC`,
    [safariId],
  );
  return found.rows;
}

export async function currentSafariRow(db: Queryable, playerId: string): Promise<SafariRow | null> {
  const found = await db.query<SafariRow>(
    "SELECT * FROM safaris WHERE status <> 'ended' AND (host_id = $1 OR guest_id = $1) ORDER BY created_at DESC LIMIT 1",
    [playerId],
  );
  return found.rows[0] ?? null;
}

export async function currentSafari(playerId: string): Promise<(Safari & { host_id: string; guest_id: string | null }) | null> {
  const row = await currentSafariRow({ query }, playerId);
  if (!row) return null;
  const safari = await names({ query }, row);
  return { ...safari, sightings: await sightingsOf({ query }, row.id), host_id: row.host_id, guest_id: row.guest_id };
}

export async function startSafari(player: PlayerRow): Promise<{ safari: Safari; created: boolean }> {
  const existing = await query<SafariRow>(
    "SELECT * FROM safaris WHERE host_id = $1 AND status <> 'ended' ORDER BY created_at DESC LIMIT 1",
    [player.id],
  );
  if (existing.rows[0]) return { safari: await names({ query }, existing.rows[0]), created: false };
  const inserted = await query<SafariRow>(
    "INSERT INTO safaris (id, world_id, code, status, host_id) VALUES ($1, $2, $3, 'open', $4) RETURNING *",
    [randomUUID(), player.world_id, code(), player.id],
  );
  const row = inserted.rows[0];
  await publish({ query }, player.world_id, player.id, 'safari', { event: 'started', code: row.code });
  return { safari: await names({ query }, row), created: true };
}

async function byCode(codeValue: string): Promise<SafariRow> {
  const found = await query<SafariRow>('SELECT * FROM safaris WHERE code = $1', [codeValue.toUpperCase()]);
  const row = found.rows[0];
  if (!row) throw new ApiError('no_safari');
  return row;
}

export async function joinSafari(player: PlayerRow, codeValue: string): Promise<Safari> {
  const row = await byCode(codeValue);
  if (row.status === 'ended') throw new ApiError('safari_ended');
  if (row.host_id === player.id) throw new ApiError('own_safari');
  if (row.guest_id === player.id) return names({ query }, row);
  const taken = await query<SafariRow>(
    `UPDATE safaris SET status = 'joined', guest_id = $2, guest_seen_at = now()
      WHERE id = $1 AND status = 'open' AND guest_id IS NULL RETURNING *`,
    [row.id, player.id],
  );
  const seated = taken.rows[0];
  if (!seated) throw new ApiError('safari_full');
  await publish({ query }, row.world_id, row.host_id, 'safari', {
    event: 'guest_joined',
    code: row.code,
    guest_name: player.name,
  });
  await publish({ query }, row.world_id, player.id, 'safari', {
    event: 'joined',
    code: row.code,
    host_name: (await names({ query }, seated)).host,
  });
  return names({ query }, seated);
}

export async function markSighting(
  player: PlayerRow,
  codeValue: string,
  island: number,
  tile: [number, number],
): Promise<Sighting> {
  const row = await byCode(codeValue);
  if (row.host_id !== player.id) throw new ApiError('not_host');
  if (row.status === 'ended') throw new ApiError('safari_ended');
  if (!Number.isInteger(island) || island < 1 || island > 5 || !isLand(island, tile[0], tile[1]))
    throw new ApiError('not_land');
  await query('INSERT INTO sightings (id, safari_id, island, x, y, by_id) VALUES ($1, $2, $3, $4, $5, $6)', [
    randomUUID(),
    row.id,
    island,
    tile[0],
    tile[1],
    player.id,
  ]);
  const sighting: Sighting = { island, x: tile[0], y: tile[1], by: player.name };
  for (const audience of [row.host_id, row.guest_id].filter((id): id is string => id !== null))
    await publish({ query }, row.world_id, audience, 'sighting', { code: row.code, sighting });
  return sighting;
}

export async function leaveSafari(player: PlayerRow, codeValue: string): Promise<Safari> {
  const row = await byCode(codeValue);
  if (row.guest_id !== player.id) throw new ApiError('no_safari');
  const freed = await query<SafariRow>(
    "UPDATE safaris SET status = 'open', guest_id = NULL, guest_seen_at = NULL WHERE id = $1 RETURNING *",
    [row.id],
  );
  await publish({ query }, row.world_id, row.host_id, 'safari', {
    event: 'guest_left',
    code: row.code,
    guest_name: player.name,
  });
  return names({ query }, freed.rows[0]);
}

export async function endSafari(player: PlayerRow, codeValue: string): Promise<Safari> {
  const row = await byCode(codeValue);
  if (row.host_id !== player.id) throw new ApiError('not_host');
  if (row.status === 'ended') throw new ApiError('safari_ended');
  const ended = await query<SafariRow>("UPDATE safaris SET status = 'ended' WHERE id = $1 RETURNING *", [row.id]);
  for (const audience of [row.host_id, row.guest_id].filter((id): id is string => id !== null))
    await publish({ query }, row.world_id, audience, 'safari', { event: 'ended', code: row.code });
  return names({ query }, ended.rows[0]);
}

export async function relayPosition(player: PlayerRow, island: number, tile: [number, number]): Promise<void> {
  await publish({ query }, player.world_id, player.id, 'position', { island, tile });
  const hosted = await query<SafariRow>(
    "SELECT * FROM safaris WHERE host_id = $1 AND status = 'joined' LIMIT 1",
    [player.id],
  );
  const row = hosted.rows[0];
  if (row?.guest_id)
    await publish({ query }, player.world_id, row.guest_id, 'position', { host: true, island, tile });
}
