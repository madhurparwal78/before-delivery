import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withClient } from './db.js';
import { log } from './log.js';

const MIGRATION_LOCK = 8471120354190001n;

function migrationsDir(): string {
  return resolve(import.meta.dirname, 'migrations');
}

/**
 * Versioned files applied exactly once, even when several instances boot against one
 * database: an advisory lock serialises the run and schema_migrations records it.
 */
export async function migrate(): Promise<void> {
  await withClient(async (db) => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    try {
      const files = (await readdir(migrationsDir())).filter((name) => name.endsWith('.sql')).sort();
      const applied = new Set(
        (await db.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
          (row) => row.version,
        ),
      );
      for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (applied.has(version)) continue;
        const sql = await readFile(resolve(migrationsDir(), file), 'utf8');
        await db.query('BEGIN');
        try {
          await db.query(sql);
          await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
          await db.query('COMMIT');
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
        log.event({ event: 'migration_applied', version });
      }
    } finally {
      await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    }
  });
}
