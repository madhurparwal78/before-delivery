import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, type Db } from '../db.js';
import { newId } from '../util.js';

/**
 * Photo paths are signed with a key ring kept in Postgres. When a path is about to be
 * signed and the newest key is old enough, a new key is created first — exactly once
 * across instances — and new paths use it. A path verifies with the key its `k` names
 * until its own expiry.
 */
const KEY_RING_LOCK = 8471120354190002n;

interface KeyRow {
  id: string;
  secret: Buffer;
  created_at: Date;
}

async function newestKey(db: Db): Promise<KeyRow | null> {
  return await queryOne<KeyRow>(
    db,
    'SELECT id, secret, created_at FROM photo_signing_keys WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1',
  );
}

async function currentKey(db: Db): Promise<KeyRow> {
  const instant = now();
  const found = await newestKey(db);
  const ageSeconds = found === null ? Infinity : (instant.getTime() - found.created_at.getTime()) / 1000;
  if (found !== null && ageSeconds < config.photoUrlKeyRotateSeconds) return found;

  await query(db, 'SELECT pg_advisory_xact_lock($1)', [KEY_RING_LOCK]);
  const recheck = await newestKey(db);
  const recheckAge =
    recheck === null ? Infinity : (instant.getTime() - recheck.created_at.getTime()) / 1000;
  if (recheck !== null && recheckAge < config.photoUrlKeyRotateSeconds) return recheck;

  const created = await queryOne<KeyRow>(
    db,
    `INSERT INTO photo_signing_keys (id, secret, created_at) VALUES ($1,$2,$3)
     RETURNING id, secret, created_at`,
    [newId(), randomBytes(32), instant],
  );
  if (created === null) throw new Error('signing key was not created');
  return created;
}

function canonical(
  resourceId: string,
  variant: string,
  exp: number,
  vetLinkId: string | null,
  keyId: string,
): string {
  return [resourceId, variant, String(exp), vetLinkId ?? '', keyId].join('|');
}

export interface SignedPath {
  url: string;
  expiresAt: Date;
}

/** Signed paths are issued only after the visibility check. */
export async function signPhotoPath(
  db: Db,
  photoId: string,
  options: { thumbnail?: boolean; vetLinkId?: string | null } = {},
): Promise<SignedPath> {
  const key = await currentKey(db);
  const thumbnail = options.thumbnail === true;
  const vetLinkId = options.vetLinkId ?? null;
  const expiresAt = new Date(now().getTime() + config.photoUrlTtlSeconds * 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const signature = createHmac('sha256', key.secret)
    .update(canonical(photoId, thumbnail ? 'thumb' : 'full', exp, vetLinkId, key.id))
    .digest('hex');
  const base = `/media/${encodeURIComponent(photoId)}${thumbnail ? '/thumb' : ''}`;
  const vetPart = vetLinkId === null ? '' : `&v=${encodeURIComponent(vetLinkId)}`;
  return {
    url: `${base}?k=${encodeURIComponent(key.id)}&exp=${exp}&sig=${signature}${vetPart}`,
    expiresAt,
  };
}

export type SignatureCheck =
  | { kind: 'valid'; vetLinkId: string | null }
  | { kind: 'invalid' };

/** A path whose key is unknown, or a key other than the one that signed it, is invalid. */
export async function verifyPhotoPath(
  db: Db,
  photoId: string,
  thumbnail: boolean,
  params: URLSearchParams,
): Promise<SignatureCheck> {
  const keyId = params.get('k');
  const expRaw = params.get('exp');
  const signature = params.get('sig');
  const vetLinkId = params.get('v');
  if (keyId === null || expRaw === null || signature === null) return { kind: 'invalid' };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { kind: 'invalid' };
  // A path verifies before its exp and not at or after it.
  if (now().getTime() >= exp * 1000) return { kind: 'invalid' };

  const key = await queryOne<KeyRow>(
    db,
    'SELECT id, secret, created_at FROM photo_signing_keys WHERE id = $1',
    [keyId],
  );
  if (key === null) return { kind: 'invalid' };

  const expected = createHmac('sha256', key.secret)
    .update(canonical(photoId, thumbnail ? 'thumb' : 'full', exp, vetLinkId, key.id))
    .digest('hex');
  const given = Buffer.from(signature, 'hex');
  const want = Buffer.from(expected, 'hex');
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { kind: 'invalid' };
  return { kind: 'valid', vetLinkId };
}

/** The month's ledger export is reached through the same key ring. */
export async function signExportPath(db: Db, jobId: string): Promise<SignedPath> {
  const key = await currentKey(db);
  const expiresAt = new Date(now().getTime() + config.photoUrlTtlSeconds * 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const signature = createHmac('sha256', key.secret)
    .update(canonical(jobId, 'export', exp, null, key.id))
    .digest('hex');
  return {
    url: `/media/exports/${encodeURIComponent(jobId)}?k=${encodeURIComponent(key.id)}&exp=${exp}&sig=${signature}`,
    expiresAt,
  };
}

export async function verifyExportPath(
  db: Db,
  jobId: string,
  params: URLSearchParams,
): Promise<boolean> {
  const keyId = params.get('k');
  const expRaw = params.get('exp');
  const signature = params.get('sig');
  if (keyId === null || expRaw === null || signature === null) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || now().getTime() >= exp * 1000) return false;
  const key = await queryOne<KeyRow>(
    db,
    'SELECT id, secret, created_at FROM photo_signing_keys WHERE id = $1',
    [keyId],
  );
  if (key === null) return false;
  const expected = createHmac('sha256', key.secret)
    .update(canonical(jobId, 'export', exp, null, key.id))
    .digest('hex');
  const given = Buffer.from(signature, 'hex');
  const want = Buffer.from(expected, 'hex');
  return given.length === want.length && timingSafeEqual(given, want);
}

/** A retired key is removed only after every path it signed has expired. */
export async function pruneSigningKeys(db: Db): Promise<void> {
  const instant = now();
  await query(
    db,
    `UPDATE photo_signing_keys SET retired_at = $1
     WHERE retired_at IS NULL AND created_at < $2
       AND id <> (SELECT id FROM photo_signing_keys ORDER BY created_at DESC LIMIT 1)`,
    [instant, new Date(instant.getTime() - config.photoUrlKeyRotateSeconds * 1000)],
  );
  await query(
    db,
    'DELETE FROM photo_signing_keys WHERE retired_at IS NOT NULL AND retired_at < $1',
    [new Date(instant.getTime() - config.photoUrlTtlSeconds * 1000)],
  );
}
