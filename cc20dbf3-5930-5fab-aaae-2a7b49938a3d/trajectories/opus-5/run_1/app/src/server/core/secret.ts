import { randomBytes } from 'node:crypto';
import type { Database } from '../db/pool.js';

const SECRET_NAME = 'signing_key';

/**
 * The secret that signs sessions and cursors lives in PostgreSQL, so every copy of
 * the server sharing the database accepts the others' cookies and page links.
 */
export async function loadSigningSecret(pool: Database): Promise<Buffer> {
  const fresh = randomBytes(32).toString('base64url');
  const inserted = await pool.query<{ value: string }>(
    `insert into app_secret (name, value) values ($1, $2)
     on conflict (name) do update set value = app_secret.value
     returning value`,
    [SECRET_NAME, fresh],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('signing secret unavailable');
  return Buffer.from(row.value, 'base64url');
}
