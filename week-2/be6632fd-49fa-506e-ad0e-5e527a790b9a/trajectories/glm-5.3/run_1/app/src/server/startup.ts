import type { Db } from './db.js';
import type { PoolClient } from 'pg';

// Every start-up step is safe when several copies run it at once: the schema DDL
// is idempotent, and the seed runs under an advisory lock with existence checks.
export async function applySchema(db: Db): Promise<void> {
  await db.query('SELECT pg_advisory_lock(902500)');
  try {
    await runSchema(db);
  } finally {
    await db.query('SELECT pg_advisory_unlock(902500)');
  }
}

async function runSchema(db: Db): Promise<void> {
  const { SCHEMA_SQL } = await import('./schema.js');
  await db.query(SCHEMA_SQL);
}

export async function seedExists(db: Db, workspaceName: string): Promise<boolean> {
  const res = await db.query('SELECT id FROM workspaces WHERE name = $1', [workspaceName]);
  return res.rowCount !== null && res.rowCount > 0;
}

export function id(prefix: string): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + '_' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export function token(chars: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(chars);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

export async function runUnderLock<T>(client: PoolClient, key: number, fn: () => Promise<T>): Promise<T | null> {
  const res = await client.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [key]);
  if (!res.rows[0].ok) return null;
  return await fn();
}
