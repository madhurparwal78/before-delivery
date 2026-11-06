import { Pool, type PoolClient } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
});

const LOCK_NAMESPACE = {
  project: 1,
  idempotencyKey: 2,
  migration: 3,
} as const;

export async function withClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('begin');
    try {
      const result = await run(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
}

/** Serialises seals and ingestion batches of one project across every instance. */
export async function lockProject(client: PoolClient, slug: string): Promise<void> {
  await client.query('select pg_advisory_xact_lock($1, hashtext($2))', [
    LOCK_NAMESPACE.project,
    slug,
  ]);
}

/** Serialises requests that share a person and idempotency key across every instance. */
export async function lockIdempotencyKey(
  client: PoolClient,
  personId: string,
  key: string,
): Promise<void> {
  await client.query('select pg_advisory_xact_lock($1, hashtext($2))', [
    LOCK_NAMESPACE.idempotencyKey,
    `${personId}\n${key}`,
  ]);
}

export async function lockMigration(client: PoolClient): Promise<void> {
  await client.query('select pg_advisory_lock($1, $2)', [LOCK_NAMESPACE.migration, 0]);
}

export async function unlockMigration(client: PoolClient): Promise<void> {
  await client.query('select pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE.migration, 0]);
}
