import { randomUUID } from 'node:crypto';
import { ApiError } from '../../shared/errors.js';
import { creatureById } from '../../shared/creatures.js';
import { islandName } from '../../shared/islands.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { isUuid } from '../ids.js';
import { MailUnreachable, sendPostcard } from '../mail.js';
import { getPhoto, StorageUnreachable } from '../storage.js';
import type { PlayerRow } from './players.js';

export const LINE_LIMIT = 140;

export type PublicPostcard = {
  id: string;
  image_url: string;
  creature_name: string;
  total: number;
  island_name: string;
  line: string;
  sender_name: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function postPostcard(
  sender: PlayerRow,
  body: { photo: unknown; recipient: unknown; line: unknown },
): Promise<{ id: string; url: string; status: 'posted' }> {
  const photoId = body.photo;
  if (typeof photoId !== 'string' || !isUuid(photoId)) throw new ApiError('not_found');
  const found = await query<{ id: string; creature_id: string; island: number; total: number; image_key: string; content_type: string }>(
    'SELECT id, creature_id, island, total, image_key, content_type FROM photos WHERE id = $1 AND player_id = $2',
    [photoId, sender.id],
  );
  const photo = found.rows[0];
  if (!photo) throw new ApiError('not_found');
  if (!sender.confirmed) throw new ApiError('unconfirmed');
  if (typeof body.recipient !== 'string' || !EMAIL.test(body.recipient.trim())) throw new ApiError('bad_email');
  const line = body.line;
  if (typeof line !== 'string' || line.trim().length === 0) throw new ApiError('line_empty');
  if ([...line].length > LINE_LIMIT) throw new ApiError('line_too_long');

  const window = await query<{ created_at: Date }>(
    `SELECT created_at FROM postcards
      WHERE sender_id = $1 AND status = 'posted' AND created_at > now() - ($2 || ' seconds')::interval
      ORDER BY created_at ASC`,
    [sender.id, config.postcardWindowSeconds],
  );
  if (window.rows.length >= config.postcardLimit) {
    const oldest = window.rows[0].created_at.getTime();
    const retry = Math.max(1, Math.ceil((oldest + config.postcardWindowSeconds * 1000 - Date.now()) / 1000));
    throw new ApiError('postcard_limit', { limit: config.postcardLimit, retryAfter: retry });
  }

  let image;
  try {
    image = await getPhoto(photo.image_key);
  } catch (error) {
    if (error instanceof StorageUnreachable) throw new ApiError('storage_unavailable', { variant: 'postcard' });
    throw error;
  }

  const id = randomUUID();
  const url = `${config.publicUrl}/postcards/${id}`;
  const creature = creatureById(photo.creature_id);
  try {
    await sendPostcard({
      to: body.recipient.trim(),
      senderName: sender.name,
      islandName: islandName(photo.island),
      creatureName: creature ? creature.name : photo.creature_id,
      total: photo.total,
      line,
      url,
      attachment: {
        filename: `${photo.creature_id}.${photo.content_type === 'image/jpeg' ? 'jpg' : 'png'}`,
        content: image.body,
        contentType: photo.content_type,
      },
    });
  } catch (error) {
    if (error instanceof MailUnreachable) throw new ApiError('mail_unavailable', { variant: 'postcard' });
    throw error;
  }

  await query(
    "INSERT INTO postcards (id, sender_id, photo_id, recipient, line, status) VALUES ($1, $2, $3, $4, $5, 'posted')",
    [id, sender.id, photo.id, body.recipient.trim(), line],
  );
  return { id, url, status: 'posted' };
}

export async function publicPostcard(id: string): Promise<PublicPostcard> {
  if (!isUuid(id)) throw new ApiError('not_found');
  const found = await query<{
    id: string;
    line: string;
    creature_id: string;
    island: number;
    total: number;
    photo_id: string;
    sender_name: string;
  }>(
    `SELECT postcards.id, postcards.line, photos.creature_id, photos.island, photos.total, photos.id AS photo_id,
            players.name AS sender_name
       FROM postcards JOIN photos ON photos.id = postcards.photo_id
       JOIN players ON players.id = postcards.sender_id
      WHERE postcards.id = $1 AND postcards.status = 'posted'`,
    [id],
  );
  const row = found.rows[0];
  if (!row) throw new ApiError('not_found');
  const creature = creatureById(row.creature_id);
  return {
    id: row.id,
    image_url: `/api/photos/${row.photo_id}/image`,
    creature_name: creature ? creature.name : row.creature_id,
    total: row.total,
    island_name: islandName(row.island),
    line: row.line,
    sender_name: row.sender_name,
  };
}
