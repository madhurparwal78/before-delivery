import type { DbClient } from './db.js';
import { ApiError, errors } from './errors.js';
import { sha256Hex } from './crypto.js';

export function isValidIdempotencyKey(key: string): boolean {
  if (key.length < 1 || key.length > 255) return false;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

/**
 * Begin an idempotent write. Returns a replay marker when the stored response
 * should be returned instead, otherwise records the key as in progress.
 */
export async function beginIdempotency(
  client: DbClient,
  scope: string,
  key: string,
  fingerprint: string,
  now = new Date(),
): Promise<{ replay: { status: number; body: unknown } | null }> {
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (key, scope, fingerprint, in_progress)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (scope, key) DO NOTHING`,
    [key, scope, fingerprint],
  );
  if ((inserted.rowCount ?? 0) > 0) return { replay: null };
  const existing = await client.query<{ fingerprint: string; status: number | null; body: unknown; in_progress: boolean; created_at: Date }>(
    `SELECT fingerprint, status, body, in_progress, created_at FROM idempotency_keys WHERE scope = $1 AND key = $2 FOR UPDATE`,
    [scope, key],
  );
  if (existing.rows.length === 0) {
    // Raced with a rollback between insert and select; retry path is a fresh run.
    return { replay: null };
  }
  const row = existing.rows[0];
  if (row.fingerprint !== fingerprint) {
    throw errors.idempotencyKeyReused();
  }
  if (row.in_progress) {
    throw errors.idempotencyInProgress();
  }
  if (row.status !== null && row.status >= 200 && row.status <= 499) {
    return { replay: { status: row.status, body: row.body } };
  }
  return { replay: null };
}

export async function finishIdempotency(
  client: DbClient,
  scope: string,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  const retryable = status >= 500 || status === 401 || status === 429;
  await client.query(
    `UPDATE idempotency_keys
     SET in_progress = false,
         status = $3,
         body = $4,
         created_at = now(),
         fingerprint = fingerprint
     WHERE scope = $1 AND key = $2`,
    [scope, key, retryable ? null : status, retryable ? null : JSON.parse(JSON.stringify(body ?? null))],
  );
}

export async function abandonIdempotency(client: DbClient, scope: string, key: string): Promise<void> {
  await client.query(`DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2`, [scope, key]);
}

export function jsonFingerprint(method: string, path: string, body: unknown): string {
  const sorted =
    body && typeof body === 'object' && !Array.isArray(body)
      ? sortKeys(body as Record<string, unknown>)
      : body;
  return sha256Hex(`${method}\n${path}\n${canonicalBody(sorted)}`);
}

function canonicalBody(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalBody).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalBody(obj[k])}`).join(',')}}`;
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) out[k] = value[k];
  return out;
}

export function multipartFingerprint(method: string, path: string, fields: Record<string, string>, fileSha: string): string {
  const keys = Object.keys(fields).sort();
  return sha256Hex(`${method}\n${path}\n${keys.map((k) => `${k}=${fields[k]}`).join('\n')}\n${fileSha}`);
}

export class IdempotencyScope {
  private scope: string;
  private key: string | null = null;
  private active = false;

  constructor(scope: string) {
    this.scope = scope;
  }

  async begin(
    client: DbClient,
    key: string | null,
    fingerprint: string,
  ): Promise<{ replay: { status: number; body: unknown } | null }> {
    if (!key) return { replay: null };
    if (!isValidIdempotencyKey(key)) throw errors.invalidIdempotencyKey();
    this.key = key;
    this.active = true;
    const result = await beginIdempotency(client, this.scope, key, fingerprint);
    return result;
  }

  async finish(client: DbClient, status: number, body: unknown): Promise<void> {
    if (!this.active || !this.key) return;
    await finishIdempotency(client, this.scope, this.key, status, body);
    this.active = false;
  }

  async abandon(client: DbClient): Promise<void> {
    if (!this.active || !this.key) return;
    await abandonIdempotency(client, this.scope, this.key);
    this.active = false;
  }
}

export { ApiError };
