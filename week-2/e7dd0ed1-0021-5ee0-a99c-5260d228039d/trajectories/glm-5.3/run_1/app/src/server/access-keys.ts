import { one, query } from './db.js';
import { config } from './config.js';
import { unseal } from './crypto.js';

interface KeyRecord {
  key_id: string; workspace_slug: string; permission: string; buckets: string[] | null;
  prefix: string | null; expires_at: Date | null; state: string;
  sealed_secret: string; sealed_prev_secret: string | null; prev_expires_at: Date | null;
  prev_last_used_at: Date | null; last_used_at: Date | null;
}

/** Loads the key and the secret that verified: current first, then previous within its overlap. */
export async function verifyAccessKey(keyId: string): Promise<{ key: KeyRecord; secret: string; usingPrevious: boolean } | null> {
  const k = await one<KeyRecord>(
    `SELECT key_id, workspace_slug, permission, buckets, prefix, expires_at, state,
            sealed_secret, sealed_prev_secret, prev_expires_at, prev_last_used_at, last_used_at
     FROM access_keys WHERE key_id = $1 AND deleted_at IS NULL`, [keyId]
  );
  if (!k) return null;
  if (k.state !== 'active') return null;
  if (k.expires_at !== null && k.expires_at.getTime() <= Date.now()) return null;
  const current = unseal(config.secretKey, k.sealed_secret);
  if (current !== null) return { key: k, secret: current, usingPrevious: false };
  const prevLive = k.prev_expires_at !== null && k.prev_expires_at.getTime() > Date.now();
  if (prevLive && k.sealed_prev_secret) {
    const prev = unseal(config.secretKey, k.sealed_prev_secret);
    if (prev !== null) return { key: k, secret: prev, usingPrevious: true };
  }
  return null;
}

/** Marks the key used; tracks which secret did the verifying. */
export async function markKeyUsed(keyId: string, usingPrevious: boolean): Promise<void> {
  if (usingPrevious) {
    await query(`UPDATE access_keys SET prev_last_used_at = now() WHERE key_id = $1`, [keyId]);
  } else {
    await query(`UPDATE access_keys SET last_used_at = now() WHERE key_id = $1`, [keyId]);
  }
}

export async function keyWorkspace(key: KeyRecord): Promise<{ slug: string; name: string; status: string }> {
  const w = await one<{ slug: string; name: string; status: string }>(`SELECT slug, name, status FROM workspaces WHERE slug = $1`, [key.workspace_slug]);
  return w!;
}

/** The prefix scope decision: a key with a prefix may only name keys under it. */
export function prefixAllows(keyPrefix: string | null, objectKey: string): boolean {
  if (keyPrefix === null) return true;
  return objectKey.startsWith(keyPrefix);
}

export function permissionAllowsWrite(permission: string): boolean {
  return permission === 'read-write';
}

export function bucketAllows(buckets: string[] | null, bucketName: string): boolean {
  if (buckets === null) return true;
  return buckets.includes(bucketName);
}

export type { KeyRecord };
