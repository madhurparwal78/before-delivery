import { ApiError } from '../../shared/errors.js';
import { creatureById } from '../../shared/creatures.js';
import { query } from '../db.js';
import { isUuid } from '../ids.js';
import { publish } from '../live.js';
import type { PlayerRow } from './players.js';

export type BoardEntry = {
  rank: number;
  player: string;
  handle: string;
  creature: string;
  creature_name: string;
  total: number;
  tick: number;
  photo: string;
};

type EntryRow = {
  player: string;
  handle: string;
  creature_id: string;
  total: number;
  tick: string;
  photo: string;
  created_at: Date;
};

/** The published board ranking: total, then the photo's earlier tick, then the entry made first. */
export async function board(
  worldId: string,
  island: number,
  filter: string | null,
): Promise<{ entries: BoardEntry[]; total: number; shown: number }> {
  if (!Number.isInteger(island) || island < 1 || island > 5) throw new ApiError('not_found');
  const found = await query<EntryRow>(
    `SELECT players.name AS player, players.handle, photos.creature_id, photos.total, photos.tick::text AS tick,
            photos.id AS photo, board_entries.created_at
       FROM board_entries
       JOIN photos ON photos.id = board_entries.photo_id
       JOIN players ON players.id = board_entries.player_id
      WHERE board_entries.world_id = $1 AND board_entries.island = $2
      ORDER BY photos.total DESC, photos.tick ASC, board_entries.created_at ASC`,
    [worldId, island],
  );
  const ranked: BoardEntry[] = found.rows.map((row, index) => {
    const creature = creatureById(row.creature_id);
    return {
      rank: index + 1,
      player: row.player,
      handle: row.handle,
      creature: row.creature_id,
      creature_name: creature ? creature.name : row.creature_id,
      total: row.total,
      tick: Number(row.tick),
      photo: row.photo,
    };
  });
  const needle = filter?.trim().toLowerCase() ?? '';
  const entries = needle.length > 0 ? ranked.filter((entry) => entry.player.toLowerCase().includes(needle)) : ranked;
  return { entries, total: ranked.length, shown: entries.length };
}

export async function enterPhoto(
  player: PlayerRow,
  island: number,
  photoId: unknown,
): Promise<{ entry: BoardEntry; created: boolean }> {
  if (!Number.isInteger(island) || island < 1 || island > 5) throw new ApiError('not_found');
  if (typeof photoId !== 'string' || !isUuid(photoId)) throw new ApiError('not_found');
  const found = await query<{ island: number; total: number; creature_id: string }>(
    'SELECT island, total, creature_id FROM photos WHERE id = $1 AND player_id = $2',
    [photoId, player.id],
  );
  const photo = found.rows[0];
  if (!photo) throw new ApiError('not_found');
  if (!player.confirmed) throw new ApiError('unconfirmed');
  if (photo.island !== island) throw new ApiError('wrong_island');

  const existing = await query<{ photo_id: string; total: number }>(
    `SELECT board_entries.photo_id, photos.total FROM board_entries JOIN photos ON photos.id = board_entries.photo_id
      WHERE board_entries.world_id = $1 AND board_entries.island = $2 AND board_entries.player_id = $3`,
    [player.world_id, island, player.id],
  );
  const had = existing.rows[0];
  let created = false;
  if (!had) {
    await query(
      'INSERT INTO board_entries (world_id, island, player_id, photo_id) VALUES ($1, $2, $3, $4)',
      [player.world_id, island, player.id, photoId],
    );
    created = true;
  } else if (photo.total > had.total) {
    await query(
      'UPDATE board_entries SET photo_id = $4, created_at = now() WHERE world_id = $1 AND island = $2 AND player_id = $3',
      [player.world_id, island, player.id, photoId],
    );
  }
  const refreshed = await board(player.world_id, island, null);
  const entry = refreshed.entries.find((candidate) => candidate.handle === player.handle)!;
  await publish({ query }, player.world_id, null, 'board', {
    island,
    player_name: entry.player,
    rank: entry.rank,
  });
  return { entry, created };
}
