import pg from 'pg';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface DbState {
  pool: Pool;
  ready: boolean;
}

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 20,
  });
}

let schemaSql: string | null = null;
function getSchemaSql(): string {
  if (!schemaSql) {
    schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  }
  return schemaSql;
}

/** Apply schema and seed safely on every serve; seed only an empty database. */
export async function applySchemaAndSeed(pool: Pool): Promise<string> {
  await pool.query('SELECT pg_advisory_lock(hashtext($1))', ['interval-schema']);
  try {
    await pool.query(getSchemaSql());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let copyId: string | null = null;
      const existing = await client.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'copy_id' FOR UPDATE");
      if (existing.rows.length === 0) {
        await seed(client);
        const copy = await client.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'copy_id'");
        copyId = copy.rows[0]?.value ?? null;
      } else {
        copyId = existing.rows[0].value;
      }
      await client.query('COMMIT');
      return copyId ?? '';
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await pool.query('SELECT pg_advisory_unlock(hashtext($1))', ['interval-schema']);
  }
}
