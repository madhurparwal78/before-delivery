import { EventEmitter } from 'node:events';
import { Client, Pool, PoolClient, types } from 'pg';
import { config } from '../config';
import { ApiError } from '../errors';
import { logFault } from '../log';
import { schemaSql } from './schema';

types.setTypeParser(1082, (value) => value);
/** Money, sizes and counts arrive as plain integers; ids (which exceed 2^53) stay exact strings. */
types.setTypeParser(20, (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : value));

const POOL_SIZE = 10;
const IDLE_CONNECTION_MS = 10_000;

const pool = new Pool({ connectionString: config.databaseUrl, max: POOL_SIZE, idleTimeoutMillis: IDLE_CONNECTION_MS });

pool.on('error', (error) => logFault('database pool', error));

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

function asDatabaseError(error: unknown): unknown {
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
  let brokenConnection: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      brokenConnection = rollbackError as Error;
    }
    throw asDatabaseError(error);
  } finally {
    client.release(brokenConnection);
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
  seq: number;
  /** Whole seconds: log instants are written without fractions. */
  atSeconds: number;
  actor: 'planning' | 'other' | 'system';
  type: string;
  subjectId: string | null;
}

export const LOG_COLUMNS =
  'seq::int AS seq, floor(extract(epoch FROM at))::int AS at_seconds, actor, type, subject_id::text AS subject_id';

export function logEntryOf(row: Record<string, unknown>): LogEntry {
  return {
    seq: row.seq as number,
    atSeconds: row.at_seconds as number,
    actor: row.actor as LogEntry['actor'],
    type: row.type as string,
    subjectId: row.subject_id as string | null,
  };
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
     RETURNING ${LOG_COLUMNS}`,
    [householdId, actor, type, subjectId],
  );
  const entry = logEntryOf(inserted.rows[0] as Record<string, unknown>);
  await client.query('SELECT pg_notify($1, $2)', ['twohouse_log', JSON.stringify({ householdId, entry })]);
  return entry;
}

export const logEvents = new EventEmitter();
const RECONNECT_MS = 1000;

/** One listening connection per process turns commits on any process into local stream events. */
export function startLogListener(): void {
  const connect = (): void => {
    const client = new Client({ connectionString: config.databaseUrl });
    const reconnect = (error: unknown): void => {
      logFault('log listener', error);
      client.end().catch((endError: unknown) => logFault('log listener close', endError));
      setTimeout(connect, RECONNECT_MS);
    };
    client.on('notification', (message) => {
      if (message.channel !== 'twohouse_log' || !message.payload) return;
      const parsed = JSON.parse(message.payload) as { householdId: string; entry: LogEntry };
      logEvents.emit(parsed.householdId, parsed.entry);
    });
    client.on('error', reconnect);
    client
      .connect()
      .then(() => client.query('LISTEN twohouse_log'))
      .catch(reconnect);
  };
  connect();
}

/** Processes starting together on one database take turns applying the schema. */
export const SCHEMA_LOCK = 4_173_001;

export async function applySchema(): Promise<void> {
  for (;;) {
    try {
      await transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
        await client.query(schemaSql);
      });
      return;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'database_unavailable')) throw error;
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
    }
  }
}
