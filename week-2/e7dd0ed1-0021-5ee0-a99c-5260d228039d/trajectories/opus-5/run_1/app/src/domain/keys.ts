import type { PoolClient } from '../db';
import { one, query, row } from '../db';
import { config } from '../config';
import { apiError } from '../errors';
import { isoSecond } from '../format';
import { randomAlphanumeric, randomUpperAlphanumeric, seal, unseal } from '../crypto/seal';
import { nowSecond } from '../http/core';
import { byteLength, countCharacters } from './text';
import { isValidObjectKey } from './content';

export interface AccessKeyRecord {
  key_id: string;
  workspace_slug: string;
  description: string;
  permission: string;
  buckets: string[] | null;
  prefix: string | null;
  expires_at: string | null;
  state: string;
  created_at: string;
  last_used_at: string | null;
  secret_sealed: string;
  previous_secret_sealed: string | null;
  previous_secret_expires_at: string | null;
  previous_secret_last_used_at: string | null;
}

const columns = `key_id, workspace_slug, description, permission, buckets, prefix, expires_at, state, created_at,
  last_used_at, secret_sealed, previous_secret_sealed, previous_secret_expires_at, previous_secret_last_used_at`;

export const keyMessages = {
  description: 'Descriptions are limited to 140 characters.',
  permission: 'Choose read or read-write.',
  buckets: 'Choose buckets from this workspace, or all buckets.',
  prefix: 'Prefixes are 1 to 1,024 bytes and follow the key rules.',
  expiresAt: 'Pick a time after now and within 365 days.',
};

export function newKeyId(): string {
  return `FSK${randomUpperAlphanumeric(17)}`;
}

export function newSecret(): string {
  return randomAlphanumeric(40);
}

export function isExpired(key: AccessKeyRecord, at: Date = new Date()): boolean {
  return key.expires_at !== null && at.getTime() >= new Date(key.expires_at).getTime();
}

/** The one place that decides which of a key's secrets may verify a request. */
export function usableSecrets(key: AccessKeyRecord, at: Date = new Date()): { current: string; previous: string | null } {
  const previousLive =
    key.previous_secret_sealed !== null &&
    key.previous_secret_expires_at !== null &&
    at.getTime() < new Date(key.previous_secret_expires_at).getTime();
  return {
    current: unseal(key.secret_sealed),
    previous: previousLive ? unseal(key.previous_secret_sealed as string) : null,
  };
}

export function previousSecretExpiresAt(key: AccessKeyRecord, at: Date = new Date()): string | null {
  if (!key.previous_secret_expires_at) return null;
  return at.getTime() < new Date(key.previous_secret_expires_at).getTime() ? isoSecond(key.previous_secret_expires_at) : null;
}

export function keyJson(key: AccessKeyRecord, at: Date = new Date()): Record<string, unknown> {
  return {
    key_id: key.key_id,
    description: key.description,
    permission: key.permission,
    buckets: key.buckets,
    prefix: key.prefix,
    expires_at: key.expires_at ? isoSecond(key.expires_at) : null,
    expired: isExpired(key, at),
    state: key.state,
    created_at: isoSecond(key.created_at),
    last_used_at: key.last_used_at ? isoSecond(key.last_used_at) : null,
    previous_secret_expires_at: previousSecretExpiresAt(key, at),
    previous_secret_last_used_at: key.previous_secret_last_used_at ? isoSecond(key.previous_secret_last_used_at) : null,
  };
}

export async function listKeys(slug: string): Promise<AccessKeyRecord[]> {
  return query<AccessKeyRecord>(`select ${columns} from access_keys where workspace_slug = $1 order by created_at desc`, [slug]);
}

export async function findKey(keyId: string): Promise<AccessKeyRecord | null> {
  return one<AccessKeyRecord>(`select ${columns} from access_keys where key_id = $1`, [keyId]) as Promise<AccessKeyRecord | null>;
}

export async function findKeyIn(client: PoolClient, slug: string, keyId: string): Promise<AccessKeyRecord | null> {
  return row<AccessKeyRecord>(client, `select ${columns} from access_keys where key_id = $1 and workspace_slug = $2 for update`, [
    keyId,
    slug,
  ]);
}

export interface CreateKeyInput {
  description: string;
  permission: 'read' | 'read-write';
  buckets: string[] | null;
  prefix: string | null;
  expiresAt: Date | null;
}

export function validateKeyInput(body: Record<string, unknown>, workspaceBuckets: string[]): CreateKeyInput {
  const failures: Record<string, string> = {};
  const description = body.description === undefined || body.description === null ? '' : body.description;
  if (typeof description !== 'string' || countCharacters(description) > 140) failures.description = keyMessages.description;
  const permission = body.permission;
  if (permission !== 'read' && permission !== 'read-write') failures.permission = keyMessages.permission;
  let buckets: string[] | null = null;
  if (body.buckets === undefined || body.buckets === null) buckets = null;
  else if (
    Array.isArray(body.buckets) &&
    body.buckets.every((name) => typeof name === 'string' && workspaceBuckets.includes(name)) &&
    body.buckets.length > 0
  ) {
    buckets = body.buckets as string[];
  } else failures.buckets = keyMessages.buckets;
  let prefix: string | null = null;
  if (body.prefix === undefined || body.prefix === null) prefix = null;
  else if (typeof body.prefix === 'string' && byteLength(body.prefix) >= 1 && byteLength(body.prefix) <= 1024 && isValidObjectKey(body.prefix.replace(/\/$/, '') || 'x')) {
    prefix = body.prefix;
  } else failures.prefix = keyMessages.prefix;
  let expiresAt: Date | null = null;
  if (body.expires_at === undefined || body.expires_at === null) expiresAt = null;
  else if (typeof body.expires_at === 'string') {
    const parsed = new Date(body.expires_at);
    const now = Date.now();
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= now || parsed.getTime() > now + 365 * 86400000) {
      failures.expires_at = keyMessages.expiresAt;
    } else expiresAt = parsed;
  } else failures.expires_at = keyMessages.expiresAt;
  if (Object.keys(failures).length > 0) throw apiError('validation_failed', 'Some fields need fixing.', { errors: failures });
  return { description: description as string, permission: permission as 'read' | 'read-write', buckets, prefix, expiresAt };
}

export async function createKey(client: PoolClient, slug: string, input: CreateKeyInput): Promise<{ key: AccessKeyRecord; secret: string }> {
  const keyId = newKeyId();
  const secret = newSecret();
  const created = await row<AccessKeyRecord>(
    client,
    `insert into access_keys (key_id, workspace_slug, description, permission, buckets, prefix, expires_at, state, created_at, secret_sealed)
     values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9) returning ${columns}`,
    [
      keyId,
      slug,
      input.description,
      input.permission,
      input.buckets,
      input.prefix,
      input.expiresAt ? input.expiresAt.toISOString() : null,
      nowSecond().toISOString(),
      seal(secret),
    ],
  );
  return { key: created as AccessKeyRecord, secret };
}

/** Rotation issues a new secret and keeps the previous one alive for the configured overlap. */
export async function rotateKey(client: PoolClient, key: AccessKeyRecord): Promise<{ key: AccessKeyRecord; secret: string }> {
  const at = nowSecond();
  if (isExpired(key, at)) {
    throw apiError('invalid_transition', "That change isn't allowed from the current state.", { from: 'expired', to: 'rotated' });
  }
  if (key.state !== 'active') {
    throw apiError('invalid_transition', "That change isn't allowed from the current state.", { from: key.state, to: 'rotated' });
  }
  if (previousSecretExpiresAt(key, at) !== null) throw apiError('rotation_in_progress');
  const secret = newSecret();
  const overlapEnd = new Date(at.getTime() + config.timing.keyRotationOverlap * 1000);
  const updated = await row<AccessKeyRecord>(
    client,
    `update access_keys set secret_sealed = $2, previous_secret_sealed = $3, previous_secret_expires_at = $4,
       previous_secret_last_used_at = null where key_id = $1 returning ${columns}`,
    [key.key_id, seal(secret), key.secret_sealed, overlapEnd.toISOString()],
  );
  return { key: updated as AccessKeyRecord, secret };
}

export async function disableKey(client: PoolClient, key: AccessKeyRecord): Promise<AccessKeyRecord> {
  if (key.state !== 'active') {
    throw apiError('invalid_transition', "That change isn't allowed from the current state.", { from: key.state, to: 'disabled' });
  }
  const updated = await row<AccessKeyRecord>(
    client,
    `update access_keys set state = 'disabled', previous_secret_sealed = null, previous_secret_expires_at = null
     where key_id = $1 returning ${columns}`,
    [key.key_id],
  );
  return updated as AccessKeyRecord;
}

export async function deleteKey(client: PoolClient, key: AccessKeyRecord): Promise<void> {
  if (key.state !== 'disabled') {
    throw apiError('invalid_transition', 'Disable the key before deleting it.', { from: key.state, to: 'deleted' });
  }
  await client.query('delete from access_keys where key_id = $1', [key.key_id]);
}

export function keyAllowsBucket(key: AccessKeyRecord, bucket: string): boolean {
  return key.buckets === null || key.buckets.includes(bucket);
}

/** The one prefix-scope decision. */
export function keyAllowsObjectKey(key: AccessKeyRecord, objectKey: string): boolean {
  return key.prefix === null || objectKey.startsWith(key.prefix);
}

export function keyAllowsListPrefix(key: AccessKeyRecord, listPrefix: string): boolean {
  return key.prefix === null || listPrefix.startsWith(key.prefix);
}

export function keyAllowsWrite(key: AccessKeyRecord): boolean {
  return key.permission === 'read-write';
}

export async function markKeyUsed(keyId: string, usedPrevious: boolean): Promise<void> {
  if (usedPrevious) {
    await query(
      "update access_keys set last_used_at = date_trunc('second', now()), previous_secret_last_used_at = date_trunc('second', now()) where key_id = $1",
      [keyId],
    );
    return;
  }
  await query("update access_keys set last_used_at = date_trunc('second', now()) where key_id = $1", [keyId]);
}
