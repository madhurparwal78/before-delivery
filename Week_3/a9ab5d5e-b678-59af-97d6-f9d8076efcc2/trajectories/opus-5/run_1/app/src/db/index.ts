import { EventEmitter } from 'node:events';
import { Client, Pool, PoolClient, types } from 'pg';
import { config } from '../config';
import { ApiError } from '../errors';
import { schemaSql } from './schema';

types.setTypeParser(1082, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 10000 });

pool.on('error', () => {
  /* a dropped idle connection is reported again on the next query */
});

const connectionCodes = new Set(['57P01', '57P02', '57P03', '08000', '08003', '08006', '08001', '08004', '53300']);

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code && (connectionCodes.has(code) || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT')) {
    return true;
  }
  return /connection terminated|connection ended|server closed the connection|timeout exceeded|connect econnrefused/i.test(
    error.message,
  );
}

export function asDatabaseError(error: unknown): unknown {
  return isConnectionFailure(error) ? new ApiError('database_unavailable') : error;
}

export interface Queryable {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export async function rows(sql: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
  try {
    const result = await pool.query(sql, params as unknown[]);
    return result.rows as Record<string, unknown>[];
  } catch (error) {
    throw asDatabaseError(error);
  }
}

export async function one(sql: string, params: readonly unknown[] = []): Promise<Record<string, unknown> | null> {
  const found = await rows(sql, params);
  return found[0] ?? null;
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw asDatabaseError(error);
  }
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is already gone */
    }
    throw asDatabaseError(error);
  } finally {
    client.release();
  }
}

/** Every state change takes the household row, so log sequence and claims stay in commit order. */
export async function inHousehold<T>(householdId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [householdId]);
    return run(client);
  });
}

export async function nextId(client: Queryable): Promise<string> {
  const result = await client.query("SELECT nextval('entity_ids')::text AS id");
  return (result.rows[0] as { id: string }).id;
}

export interface LogEntry {
  seq: string;
  at: string;
  actor: 'planning' | 'other' | 'system';
  type: string;
  subjectId: string | null;
}

export async function appendLog(
  client: Queryable,
  householdId: string,
  actor: 'planning' | 'other' | 'system',
  type: string,
  subjectId: string | null,
): Promise<LogEntry> {
  const inserted = await client.query(
    `INSERT INTO record_log (household_id, seq, actor, type, subject_id)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4 FROM record_log WHERE household_id = $1
     RETURNING seq::text AS seq, at, actor, type, subject_id::text AS subject_id`,
    [householdId, actor, type, subjectId],
  );
  const row = inserted.rows[0] as {
    seq: string;
    at: Date;
    actor: 'planning' | 'other' | 'system';
    type: string;
    subject_id: string | null;
  };
  const entry: LogEntry = {
    seq: row.seq,
    at: row.at.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    actor: row.actor,
    type: row.type,
    subjectId: row.subject_id,
  };
  await client.query('SELECT pg_notify($1, $2)', ['twohouse_log', JSON.stringify({ householdId, entry })]);
  return entry;
}

export const logEvents = new EventEmitter();

let listener: Client | null = null;

/** One listening connection per process turns commits on any process into local stream events. */
export function startLogListener(): void {
  const connect = (): void => {
    const client = new Client({ connectionString: config.databaseUrl });
    listener = client;
    client.on('notification', (message) => {
      if (message.channel !== 'twohouse_log' || !message.payload) return;
      const parsed = JSON.parse(message.payload) as { householdId: string; entry: LogEntry };
      logEvents.emit(parsed.householdId, parsed.entry);
    });
    client.on('error', () => {
      client.end().catch(() => undefined);
      if (listener === client) listener = null;
      setTimeout(connect, 1000);
    });
    client
      .connect()
      .then(() => client.query('LISTEN twohouse_log'))
      .catch(() => {
        if (listener === client) listener = null;
        setTimeout(connect, 1000);
      });
  };
  connect();
}

export async function applySchema(): Promise<void> {
  for (;;) {
    try {
      await pool.query(schemaSql);
      return;
    } catch (error) {
      if (!isConnectionFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
