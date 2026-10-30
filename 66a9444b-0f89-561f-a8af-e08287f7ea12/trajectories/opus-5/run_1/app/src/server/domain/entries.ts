import { many, one, type Queryable } from '../db/pool.js';
import { toUtcIso } from '../lib/time.js';
import type { ProgrammeState } from './states.js';

export interface EntryRow {
  id: string;
  artist_id: string;
  artist_name: string;
  title: string;
  statement: string;
  discipline: string;
  medium: string;
  year: string;
  status: ProgrammeState;
  effective_status: ProgrammeState;
  publish_at: Date | null;
}

const EFFECTIVE_STATUS = `
  CASE WHEN e.status = 'scheduled' AND e.publish_at IS NOT NULL AND e.publish_at <= now()
       THEN 'published' ELSE e.status END`;

const ENTRY_COLUMNS = `e.id, e.artist_id, u.name AS artist_name, e.title, e.statement,
  e.discipline, e.medium, e.year, e.status, e.publish_at, ${EFFECTIVE_STATUS} AS effective_status`;

export interface EntryImage {
  id: string;
  width: number;
  height: number;
  original_key: string;
  display_key: string;
}

export interface SerialisedEntry {
  id: string;
  artist_id: string;
  artist_name: string;
  title: string;
  statement: string;
  discipline: string;
  medium: string;
  year: string;
  status: ProgrammeState;
  publish_at: string | null;
  images: Array<{ id: string; width: number; height: number; display_url: string | null }>;
}

export async function loadEntry(db: Queryable, id: string): Promise<EntryRow | null> {
  return one<EntryRow>(
    db,
    `SELECT ${ENTRY_COLUMNS} FROM entries e JOIN users u ON u.id = e.artist_id WHERE e.id = $1`,
    [id],
  );
}

export async function listEntries(
  db: Queryable,
  options: { artistId?: string; statuses?: readonly string[] } = {},
): Promise<EntryRow[]> {
  if (options.artistId !== undefined) {
    return many<EntryRow>(
      db,
      `SELECT ${ENTRY_COLUMNS} FROM entries e JOIN users u ON u.id = e.artist_id
       WHERE e.artist_id = $1 ORDER BY e.created_at`,
      [options.artistId],
    );
  }
  if (options.statuses !== undefined) {
    return many<EntryRow>(
      db,
      `SELECT * FROM (SELECT ${ENTRY_COLUMNS} FROM entries e JOIN users u ON u.id = e.artist_id) t
       WHERE t.effective_status = ANY($1::text[]) ORDER BY t.title`,
      [[...options.statuses]],
    );
  }
  return many<EntryRow>(
    db,
    `SELECT ${ENTRY_COLUMNS} FROM entries e JOIN users u ON u.id = e.artist_id
     ORDER BY e.created_at`,
  );
}

export async function entryImages(db: Queryable, entryId: string): Promise<EntryImage[]> {
  return many<EntryImage>(
    db,
    `SELECT id, width, height, original_key, display_key FROM entry_images
     WHERE entry_id = $1 ORDER BY created_at`,
    [entryId],
  );
}

export async function loadEntryImage(
  db: Queryable,
  imageId: string,
): Promise<(EntryImage & { entry_id: string }) | null> {
  return one<EntryImage & { entry_id: string }>(
    db,
    `SELECT id, entry_id, width, height, original_key, display_key FROM entry_images
     WHERE id = $1`,
    [imageId],
  );
}

/** Artwork images are served publicly only once the entry is published. */
export async function serialiseEntry(db: Queryable, row: EntryRow): Promise<SerialisedEntry> {
  const images = await entryImages(db, row.id);
  const published = row.effective_status === 'published';
  return {
    id: row.id,
    artist_id: row.artist_id,
    artist_name: row.artist_name,
    title: row.title,
    statement: row.statement,
    discipline: row.discipline,
    medium: row.medium,
    year: row.year,
    status: row.effective_status,
    publish_at: row.publish_at === null ? null : toUtcIso(row.publish_at),
    images: images.map((image) => ({
      id: image.id,
      width: image.width,
      height: image.height,
      display_url: published ? `/api/media/artworks/${image.id}` : null,
    })),
  };
}
