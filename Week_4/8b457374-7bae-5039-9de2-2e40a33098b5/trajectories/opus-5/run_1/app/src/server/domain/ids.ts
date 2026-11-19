import { createHash, randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

/** A Dotgain key, at least 32 characters long, shown to its person once. */
export function newPersonKey(): string {
  return `dgk_${randomBytes(24).toString('base64url')}`;
}

/** A fix code: a random secret of at least 32 URL-safe characters. */
export function newFixCode(): string {
  return randomBytes(24).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function hashBody(body: unknown): string {
  return createHash('sha256').update(stableJson(body), 'utf8').digest('hex');
}

/** Serialises JSON with object keys in order, so key order is ignored when comparing bodies. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}
