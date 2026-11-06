import crypto from 'node:crypto';
import { connectDb, type Tx, type Row } from './db.js';
import { config } from './config.js';
import { now } from './time.js';

/** Signed photo paths and the key ring in Postgres (DP-99, Photo URLs). */
function sign(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

async function currentKey(tx: Tx): Promise<{ id: number; secret: string }> {
  const latest = await tx.query(`select id, secret, created_at from signing_keys order by id desc limit 1`);
  if (latest.length === 0 || (now().getTime() - latest[0].created_at.getTime()) >= config.photoUrlKeyRotateSeconds * 1000) {
    const existing = await tx.query(
      `insert into signing_keys(id, secret, created_at)
       values(coalesce((select max(id) from signing_keys), 0) + 1, $1, $2)
       on conflict(id) do update set created_at = signing_keys.created_at
       returning id, secret`,
      [crypto.randomBytes(32).toString('hex'), now()]
    );
    if (existing.length > 0) return { id: existing[0].id, secret: existing[0].secret };
    return { id: latest[0].id, secret: latest[0].secret };
  }
  return { id: latest[0].id, secret: latest[0].secret };
}

export interface SignedPath {
  path: string;
  expiresAt: Date;
}

export async function signPhotoPath(tx: Tx, photoId: string, thumb: boolean, vetLink: boolean, vetLinkId: string | null): Promise<SignedPath> {
  const key = await currentKey(tx);
  const exp = Math.floor((now().getTime() + config.photoUrlTtlSeconds * 1000) / 1000);
  const base = thumb ? `${photoId}/thumb` : photoId;
  const v = vetLink ? `&v=${vetLinkId}` : '';
  const data = `${base}?k=${key.id}&exp=${exp}${v}`;
  return { path: `/media/${data}&sig=${sign(key.secret, data)}`, expiresAt: new Date(exp * 1000) };
}

export async function verifyPhotoPath(
  photoId: string,
  thumb: boolean,
  k: string,
  exp: string,
  sig: string,
  v: string | null
): Promise<'ok' | 'invalid' | 'expired'> {
  const keyRows = await connectDb().query(`select id, secret from signing_keys where id = $1`, [Number(k)]);
  if (keyRows.rows.length === 0) return 'invalid';
  const base = thumb ? `${photoId}/thumb` : photoId;
  const vPart = v !== null ? `&v=${v}` : '';
  const data = `${base}?k=${k}&exp=${exp}${vPart}`;
  if (sign(keyRows.rows[0].secret, data) !== sig) return 'invalid';
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || now().getTime() >= expNum * 1000) return 'expired';
  return 'ok';
}

export async function photoKeyPath(tx: Tx, row: Row, thumb: boolean): Promise<SignedPath> {
  return signPhotoPath(tx, row.id, thumb, false, null);
}
