import { randomBytes } from 'node:crypto';
import { Pool, types } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { env } from './env';
import { SCHEMA_SQL } from './schema';

const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

export const pool = new Pool({ connectionString: env.databaseUrl, max: 12 });

const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(): string {
  const bytes = randomBytes(16);
  let out = '';
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch {
      process.stdout.write('waiting for postgres…\n');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises writes that touch a feature's derived counters or score version. */
export async function lockFeature(client: Queryable, featureId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`feature:${featureId}`]);
}

export async function lockRelease(client: Queryable, releaseId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`release:${releaseId}`]);
}

export async function lockWorkspaceImport(client: Queryable, workspaceId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`import:${workspaceId}`]);
}

export async function lockWorkspaceBoard(client: Queryable, workspaceId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`board:${workspaceId}`]);
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  if (!candidate || candidate.code !== '23505') return false;
  return constraint === undefined || candidate.constraint === constraint;
}
