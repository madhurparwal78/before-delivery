import { creaturesOfIsland } from '../../shared/creatures.js';
import { ISLANDS } from '../../shared/islands.js';
import type { Queryable } from '../db.js';

export const FILL_THRESHOLD = 60;
export const PAGE_REWARD_FRAMES = 6;
export const STAMPS_FOR_LIGHTHOUSE = 3;

export type AlbumPage = {
  creature: string;
  creature_name: string;
  filled: boolean;
  photo_id: string | null;
  total: number | null;
};

export type Album = {
  island: number;
  island_name: string;
  pages: AlbumPage[];
  pages_filled: number;
  stamp: boolean;
};

export type AlbumChange = { pageFilled: boolean; pagesFilled: number; stampEarned: boolean };

export function lighthouseState(stamps: number): 'open' | 'closed' {
  return stamps >= STAMPS_FOR_LIGHTHOUSE ? 'open' : 'closed';
}

export async function stampCount(db: Queryable, playerId: string): Promise<number> {
  const found = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM stamps WHERE player_id = $1', [
    playerId,
  ]);
  return Number(found.rows[0].count);
}

export async function albums(db: Queryable, playerId: string): Promise<Album[]> {
  const pages = await db.query<{ creature_id: string; island: number; photo_id: string; total: number }>(
    'SELECT creature_id, island, photo_id, total FROM album_pages WHERE player_id = $1',
    [playerId],
  );
  const stamps = await db.query<{ island: number }>('SELECT island FROM stamps WHERE player_id = $1', [playerId]);
  const byCreature = new Map(pages.rows.map((row) => [row.creature_id, row]));
  const stamped = new Set(stamps.rows.map((row) => row.island));
  return ISLANDS.map((island) => {
    const list = creaturesOfIsland(island.id).map((creature) => {
      const row = byCreature.get(creature.id);
      return {
        creature: creature.id,
        creature_name: creature.name,
        filled: row !== undefined,
        photo_id: row?.photo_id ?? null,
        total: row?.total ?? null,
      };
    });
    return {
      island: island.id,
      island_name: island.name,
      pages: list,
      pages_filled: list.filter((page) => page.filled).length,
      stamp: stamped.has(island.id),
    };
  });
}

/** A kept photo's effect on the album: the one place a page fills and a stamp is earned. */
export async function applyPhotoToAlbum(
  db: Queryable,
  playerId: string,
  island: number,
  creatureId: string,
  photoId: string,
  total: number,
): Promise<AlbumChange> {
  const existing = await db.query<{ total: number }>(
    'SELECT total FROM album_pages WHERE player_id = $1 AND creature_id = $2',
    [playerId, creatureId],
  );
  const had = existing.rows[0];
  let pageFilled = false;
  if (total >= FILL_THRESHOLD) {
    if (!had) {
      await db.query(
        'INSERT INTO album_pages (player_id, island, creature_id, photo_id, total) VALUES ($1, $2, $3, $4, $5)',
        [playerId, island, creatureId, photoId, total],
      );
      pageFilled = true;
    } else if (total > had.total) {
      await db.query('UPDATE album_pages SET photo_id = $3, total = $4 WHERE player_id = $1 AND creature_id = $2', [
        playerId,
        creatureId,
        photoId,
        total,
      ]);
    }
  }
  const counted = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM album_pages WHERE player_id = $1 AND island = $2',
    [playerId, island],
  );
  const pagesFilled = Number(counted.rows[0].count);
  let stampEarned = false;
  if (pagesFilled === creaturesOfIsland(island).length) {
    const inserted = await db.query(
      'INSERT INTO stamps (player_id, island) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING island',
      [playerId, island],
    );
    stampEarned = inserted.rowCount === 1;
  }
  return { pageFilled, pagesFilled, stampEarned };
}
