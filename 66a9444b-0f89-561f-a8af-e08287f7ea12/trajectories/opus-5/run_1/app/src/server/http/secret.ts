import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { one, pool } from '../db/pool.js';

let cached: string | null = null;

/**
 * Signs session cookies and file links. Without APP_SECRET the server creates one and keeps it in
 * Postgres, so instances sharing the database agree.
 */
export async function appSecret(): Promise<string> {
  if (cached !== null) return cached;
  if (config.appSecretFromEnv !== null) {
    cached = config.appSecretFromEnv;
    return cached;
  }
  const generated = randomBytes(32).toString('base64url');
  const row = await one<{ value: string }>(
    pool,
    `INSERT INTO app_meta (key, value) VALUES ('app_secret', $1)
     ON CONFLICT (key) DO UPDATE SET value = app_meta.value
     RETURNING value`,
    [generated],
  );
  cached = row?.value ?? generated;
  return cached;
}
