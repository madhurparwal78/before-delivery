import { query, queryOne, type Transaction } from '../db/pool.js';
import { newPostcardId, newShareToken } from '../db/ids.js';
import { config } from '../config.js';
import { fail, validation } from '../http/errors.js';
import { shareUrlFor } from '../http/boundary.js';
import { isoTime } from './time.js';
import { inspectPng } from './png.js';
import {
  deletePostcardImage,
  listPostcardImages,
  putPostcardImage,
} from '../services/postcardStore.js';

export const POSTBOX_CAP = 24;
export const MAIL_SENDS_PER_WINDOW = 5;

export interface PostcardRecord {
  postcard_id: string;
  share_token: string;
  width: number;
  height: number;
  bytes: number;
  created_at: Date;
}

export function postcardBody(record: PostcardRecord): unknown {
  return {
    postcard_id: record.postcard_id,
    share_url: shareUrlFor(record.share_token),
    width: record.width,
    height: record.height,
    bytes: record.bytes,
    created_at: isoTime(record.created_at),
  };
}

const POSTCARD_COLUMNS = 'postcard_id, share_token, width, height, bytes, created_at';

export async function listPostcards(courierId: string): Promise<PostcardRecord[]> {
  return query<PostcardRecord>(
    `select ${POSTCARD_COLUMNS} from postcards
     where courier_id = $1 and revoked_at is null
     order by created_at desc, postcard_id desc`,
    [courierId],
  );
}

export async function ownedPostcard(
  courierId: string,
  postcardId: string,
): Promise<PostcardRecord | null> {
  return queryOne<PostcardRecord>(
    `select ${POSTCARD_COLUMNS} from postcards
     where postcard_id = $1 and courier_id = $2 and revoked_at is null`,
    [postcardId, courierId],
  );
}

export async function postcardByShareToken(
  shareToken: string,
): Promise<(PostcardRecord & { courier_id: string }) | null> {
  return queryOne<PostcardRecord & { courier_id: string }>(
    `select ${POSTCARD_COLUMNS}, courier_id from postcards
     where share_token = $1 and revoked_at is null`,
    [shareToken],
  );
}

/** Stores a sound still PNG, then its record; a record that cannot be written takes the image with it. */
export async function createPostcard(courierId: string, body: Buffer): Promise<PostcardRecord> {
  const held = await queryOne<{ count: string }>(
    'select count(*)::text as count from postcards where courier_id = $1 and revoked_at is null',
    [courierId],
  );
  if (Number(held?.count ?? '0') >= POSTBOX_CAP) throw fail('postbox_full');

  const checked = inspectPng(body);
  if ('fault' in checked) throw validation({ image: checked.fault });

  const postcardId = newPostcardId();
  await putPostcardImage(postcardId, body);
  try {
    const record = await queryOne<PostcardRecord>(
      `insert into postcards (postcard_id, courier_id, share_token, width, height, bytes, created_at)
       values ($1, $2, $3, $4, $5, $6, now())
       returning ${POSTCARD_COLUMNS}`,
      [postcardId, courierId, newShareToken(), checked.width, checked.height, body.length],
    );
    return record!;
  } catch (fault) {
    await deletePostcardImage(postcardId).catch(() => undefined);
    throw fault;
  }
}

/** Hides the record first, then removes the image, then the record. */
export async function revokePostcard(courierId: string, postcardId: string): Promise<void> {
  const hidden = await queryOne<{ postcard_id: string }>(
    `update postcards set revoked_at = now()
     where postcard_id = $1 and courier_id = $2 and revoked_at is null
     returning postcard_id`,
    [postcardId, courierId],
  );
  if (hidden === null) throw fail('not_found');
  try {
    await deletePostcardImage(postcardId);
  } catch (fault) {
    await query('update postcards set revoked_at = null where postcard_id = $1', [postcardId]);
    throw fault;
  }
  await query('delete from postcards where postcard_id = $1', [postcardId]).catch(() => undefined);
}

interface MailSlot {
  retryAfterSeconds: number;
}

/** Reserves one of the courier's mail slots in the window, in the sending transaction. */
export async function reserveMailSlot(tx: Transaction, courierId: string): Promise<void> {
  await tx.lock(`mail-slots:${courierId}`);
  await tx.query(
    'delete from mail_slots where courier_id = $1 and reserved_at <= now() - make_interval(secs => $2)',
    [courierId, config.postcardMailWindowSeconds],
  );
  const counted = await tx.query<{ reserved_at: Date }>(
    'select reserved_at from mail_slots where courier_id = $1 order by reserved_at',
    [courierId],
  );
  if (counted.length >= MAIL_SENDS_PER_WINDOW) {
    const oldest = counted[0]!.reserved_at.getTime();
    const freesAt = oldest + config.postcardMailWindowSeconds * 1000;
    const wait: MailSlot = {
      retryAfterSeconds: Math.max(1, Math.ceil((freesAt - Date.now()) / 1000)),
    };
    throw fail('mail_limit', { headers: { 'Retry-After': String(wait.retryAfterSeconds) } });
  }
  await tx.query('insert into mail_slots (courier_id, reserved_at) values ($1, now())', [courierId]);
}

/**
 * Keeps records and stored images in step: a hidden record goes once its image has gone, and an
 * image with no record is cleaned away.
 */
export async function sweepPostcards(): Promise<void> {
  await query(
    "delete from postcards where revoked_at is not null and revoked_at < now() - interval '5 seconds'",
  );
  const stored = await listPostcardImages();
  if (stored.length === 0) return;
  const known = await query<{ postcard_id: string }>(
    'select postcard_id from postcards where postcard_id = any($1::text[])',
    [stored.map((image) => image.postcardId)],
  );
  const keep = new Set(known.map((row) => row.postcard_id));
  const cutoff = Date.now() - 60_000;
  for (const image of stored) {
    if (keep.has(image.postcardId)) continue;
    if (image.lastModified.getTime() > cutoff) continue;
    await deletePostcardImage(image.postcardId);
  }
}

export async function sweepMailSlots(): Promise<void> {
  await query('delete from mail_slots where reserved_at <= now() - make_interval(secs => $1)', [
    config.postcardMailWindowSeconds,
  ]);
}

export async function sweepPostboxKeys(): Promise<void> {
  await query("delete from postbox_keys where created_at < now() - interval '7 days'");
}
