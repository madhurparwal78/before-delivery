/**
 * The claim records. Postgres holds every record and all shared state, so nothing here is
 * cached in process between requests.
 *
 * The desk never exits because Postgres is down: it keeps serving pages and its health
 * check, answers every action that needs records with 503, and applies its schema as soon
 * as Postgres answers again.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

import { config } from '../config';
import { seedDesk } from './seed';

// A `date` column is a Europe/London calendar date and must stay the text it was written as.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

/** Thrown when the claim records cannot be reached; the API turns this into 503. */
export class DatabaseUnavailable extends Error {
  constructor(cause: unknown) {
    super('claim records unavailable');
    this.name = 'DatabaseUnavailable';
    this.cause = cause;
  }
}

/**
 * A reply from Postgres carries a five-character SQLSTATE. Anything without one never
 * reached the server, and SQLSTATE class 08 and the 57P0x codes mean the connection or the
 * server itself went away. Everything else is a real answer and must not be mistaken for
 * an outage.
 */
function isRecordsOutage(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return true;
  return code.startsWith('08') || code === '57P01' || code === '57P02' || code === '57P03';
}

function asRecordsError(error: unknown): unknown {
  return isRecordsOutage(error) ? new DatabaseUnavailable(error) : error;
}

const SCHEMA_LOCK = 8_417_205;

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 30_000,
});

// A dropped backend must never reach the process as an unhandled error event.
pool.on('error', () => undefined);

let schemaApplied = false;

function schemaSql(): string {
  return readFileSync(join(__dirname, 'schema.sql'), 'utf8');
}

async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One copy at a time applies the schema and loads the seed.
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
    await client.query(schemaSql());
    await seedDesk(client);
    await client.query('COMMIT');
    schemaApplied = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSchema(): Promise<void> {
  if (schemaApplied) return;
  await applySchema();
}

/** Keeps trying in the background so the schema lands as soon as Postgres answers. */
export function watchForRecords(): void {
  const attempt = (): void => {
    if (schemaApplied) return;
    void applySchema()
      .catch(() => undefined)
      .finally(() => {
        if (!schemaApplied) setTimeout(attempt, 2000).unref();
      });
  };
  attempt();
}

export async function query<Row extends QueryResultRow>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  try {
    await ensureSchema();
    const result = await pool.query<Row>(sql, values as unknown[]);
    return result.rows;
  } catch (error) {
    throw asRecordsError(error);
  }
}

export async function queryOne<Row extends QueryResultRow>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(sql, values);
  return rows[0] ?? null;
}

export interface Transaction {
  query<Row extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<Row[]>;
  queryOne<Row extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<Row | null>;
}

class ClientTransaction implements Transaction {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []): Promise<Row[]> {
    try {
      const result = await this.client.query<Row>(sql, values as unknown[]);
      return result.rows;
    } catch (error) {
      throw asRecordsError(error);
    }
  }

  async queryOne<Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []): Promise<Row | null> {
    const rows = await this.query<Row>(sql, values);
    return rows[0] ?? null;
  }
}

/**
 * Runs work in one transaction. A thrown error rolls everything back, which is how a claim
 * start, a decline and an erasure stay all-or-nothing.
 */
export async function withTransaction<Result>(work: (tx: Transaction) => Promise<Result>): Promise<Result> {
  let client: PoolClient;
  try {
    await ensureSchema();
    client = await pool.connect();
  } catch (error) {
    throw asRecordsError(error);
  }
  try {
    await client.query('BEGIN');
    const result = await work(new ClientTransaction(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
