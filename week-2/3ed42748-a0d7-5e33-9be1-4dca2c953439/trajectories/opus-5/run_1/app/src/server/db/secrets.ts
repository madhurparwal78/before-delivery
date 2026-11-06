import { randomBytes } from 'node:crypto';
import { queryOne } from './pool.js';

const cache = new Map<string, Buffer>();

/** A long-lived random key kept in Postgres, used to sign opaque cursors. */
export async function signingKey(name: string): Promise<Buffer> {
  const cached = cache.get(name);
  if (cached) return cached;
  const row = await queryOne<{ value: string }>(
    `insert into server_secrets (name, value) values ($1, $2)
     on conflict (name) do update set value = server_secrets.value
     returning value`,
    [name, randomBytes(32).toString('base64url')],
  );
  const key = Buffer.from(row!.value, 'base64url');
  cache.set(name, key);
  return key;
}
