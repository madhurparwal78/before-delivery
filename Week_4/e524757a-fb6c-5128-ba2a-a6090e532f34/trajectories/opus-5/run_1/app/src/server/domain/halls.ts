import { ApiError } from '../../shared/errors.js';
import { query, transaction, type Queryable } from '../db.js';
import { isUuid } from '../ids.js';
import { photoAnswer, type PhotoAnswer, type PhotoRow } from './photos.js';

export const HALL_FRAMES = 12;
export const CAPTION_LIMIT = 140;

export type HallFrame = { frame: number; caption: string; photo: PhotoAnswer; likes: number; liked_by_me?: boolean };
export type Hall = { handle: string; owner_name: string; public: boolean; frames: HallFrame[] };

type FrameRow = PhotoRow & { frame: number; caption: string; likes: string; liked_by_me: boolean };

async function framesOf(db: Queryable, ownerId: string, viewerId: string | null): Promise<HallFrame[]> {
  const found = await db.query<FrameRow>(
    `SELECT hall_frames.frame, hall_frames.caption, photos.*,
            (SELECT count(*) FROM likes WHERE likes.photo_id = photos.id)::text AS likes,
            EXISTS (SELECT 1 FROM likes WHERE likes.photo_id = photos.id AND likes.visitor_id = $2) AS liked_by_me
       FROM hall_frames JOIN photos ON photos.id = hall_frames.photo_id
      WHERE hall_frames.player_id = $1
      ORDER BY hall_frames.frame ASC`,
    [ownerId, viewerId],
  );
  return found.rows.map((row) => ({
    frame: row.frame,
    caption: row.caption,
    photo: photoAnswer(row),
    likes: Number(row.likes),
    liked_by_me: row.liked_by_me,
  }));
}

export async function ownHall(db: Queryable, player: { id: string; handle: string; name: string }): Promise<Hall> {
  const found = await db.query<{ public: boolean }>('SELECT public FROM halls WHERE player_id = $1', [player.id]);
  const row = found.rows[0];
  if (!row) throw new ApiError('not_found');
  const frames = await framesOf(db, player.id, player.id);
  return { handle: player.handle, owner_name: player.name, public: row.public, frames };
}

export async function visibleHall(handle: string, viewerId: string | null): Promise<Hall> {
  const found = await query<{ id: string; name: string; handle: string; public: boolean }>(
    'SELECT players.id, players.name, players.handle, halls.public FROM players JOIN halls ON halls.player_id = players.id WHERE players.handle = $1',
    [handle],
  );
  const owner = found.rows[0];
  if (!owner) throw new ApiError('not_found');
  if (!owner.public && owner.id !== viewerId) throw new ApiError('not_found');
  return {
    handle: owner.handle,
    owner_name: owner.name,
    public: owner.public,
    frames: await framesOf({ query }, owner.id, viewerId),
  };
}

export type HallUpdate = { public?: boolean; frames?: { photo: string; caption: string }[] };

export function checkHallUpdate(body: Record<string, unknown>): HallUpdate {
  const update: HallUpdate = {};
  if ('public' in body) {
    if (typeof body.public !== 'boolean') throw new ApiError('bad_request');
    update.public = body.public;
  }
  if ('frames' in body) {
    const frames = body.frames;
    if (!Array.isArray(frames)) throw new ApiError('bad_request');
    if (frames.length > HALL_FRAMES) throw new ApiError('hall_full');
    update.frames = frames.map((entry) => {
      if (entry === null || typeof entry !== 'object') throw new ApiError('bad_request');
      const record = entry as Record<string, unknown>;
      const photo = record.photo;
      if (typeof photo !== 'string' || !isUuid(photo)) throw new ApiError('bad_request');
      const caption = record.caption ?? '';
      if (typeof caption !== 'string') throw new ApiError('bad_request');
      if ([...caption].length > CAPTION_LIMIT) throw new ApiError('caption_too_long');
      return { photo, caption };
    });
  }
  return update;
}

export async function saveHall(
  player: { id: string; handle: string; name: string },
  update: HallUpdate,
): Promise<Hall> {
  return transaction(async (db) => {
    if (update.public !== undefined)
      await db.query('UPDATE halls SET public = $2 WHERE player_id = $1', [player.id, update.public]);
    if (update.frames) {
      for (const frame of update.frames) {
        const owned = await db.query('SELECT id FROM photos WHERE id = $1 AND player_id = $2', [
          frame.photo,
          player.id,
        ]);
        if (owned.rowCount === 0) throw new ApiError('not_found');
      }
      await db.query('DELETE FROM hall_frames WHERE player_id = $1', [player.id]);
      for (let index = 0; index < update.frames.length; index += 1) {
        const frame = update.frames[index];
        await db.query(
          'INSERT INTO hall_frames (player_id, frame, photo_id, caption) VALUES ($1, $2, $3, $4)',
          [player.id, index + 1, frame.photo, frame.caption],
        );
      }
    }
    return ownHall(db, player);
  });
}

/** A hung photo the caller may see, which is what a like needs. */
export async function likeablePhoto(photoId: string, viewerId: string): Promise<{ ownerId: string; creature: string }> {
  if (!isUuid(photoId)) throw new ApiError('not_found');
  const found = await query<{ player_id: string; creature_id: string; public: boolean }>(
    `SELECT photos.player_id, photos.creature_id, halls.public
       FROM photos JOIN hall_frames ON hall_frames.photo_id = photos.id
       JOIN halls ON halls.player_id = hall_frames.player_id
      WHERE photos.id = $1`,
    [photoId],
  );
  const row = found.rows[0];
  if (!row) throw new ApiError('not_found');
  if (!row.public && row.player_id !== viewerId) throw new ApiError('not_found');
  if (row.player_id === viewerId) throw new ApiError('own_photo');
  return { ownerId: row.player_id, creature: row.creature_id };
}

export async function setLike(photoId: string, visitorId: string, liked: boolean): Promise<number> {
  if (liked)
    await query('INSERT INTO likes (photo_id, visitor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      photoId,
      visitorId,
    ]);
  else await query('DELETE FROM likes WHERE photo_id = $1 AND visitor_id = $2', [photoId, visitorId]);
  const counted = await query<{ count: string }>('SELECT count(*)::text AS count FROM likes WHERE photo_id = $1', [
    photoId,
  ]);
  return Number(counted.rows[0].count);
}

/** The published visibility rule for a photo's image bytes. */
export async function maySeePhotoImage(photoId: string, viewerId: string | null): Promise<boolean> {
  const found = await query<{ visible: boolean }>(
    `SELECT (
        photos.player_id = $2
        OR EXISTS (SELECT 1 FROM hall_frames JOIN halls ON halls.player_id = hall_frames.player_id
                    WHERE hall_frames.photo_id = photos.id AND halls.public)
        OR EXISTS (SELECT 1 FROM board_entries WHERE board_entries.photo_id = photos.id)
        OR EXISTS (SELECT 1 FROM postcards WHERE postcards.photo_id = photos.id AND postcards.status = 'posted')
        OR EXISTS (SELECT 1 FROM safaris WHERE safaris.host_id = photos.player_id AND safaris.status = 'joined'
                    AND safaris.guest_id = $2)
      ) AS visible FROM photos WHERE photos.id = $1`,
    [photoId, viewerId],
  );
  return found.rows[0]?.visible ?? false;
}
