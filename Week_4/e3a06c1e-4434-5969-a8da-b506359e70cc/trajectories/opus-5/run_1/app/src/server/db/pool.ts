import pg from 'pg';
import { config } from '../config.js';

export const APP_CONNECTION_NAME = 'lowfield-app';
export const STREAM_CONNECTION_PREFIX = 'lowfield-stream:';

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  application_name: APP_CONNECTION_NAME,
  max: 12,
  idleTimeoutMillis: 30_000,
});

export type QueryParam = string | number | boolean | null | Date | string[] | Buffer;

export const query = async <T extends pg.QueryResultRow>(text: string, params: QueryParam[] = []): Promise<T[]> => {
  const result = await pool.query<T>(text, params);
  return result.rows;
};

export const queryOne = async <T extends pg.QueryResultRow>(
  text: string,
  params: QueryParam[] = [],
): Promise<T | null> => {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
};

export const withTransaction = async <T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * One dedicated connection per open live socket or event stream, labelled
 * `lowfield-stream:<session_id>` so it can be seen and accounted for.
 */
export const openStreamConnection = async (sessionId: string): Promise<pg.Client> => {
  const client = new pg.Client({
    connectionString: config.databaseUrl,
    application_name: `${STREAM_CONNECTION_PREFIX}${sessionId}`,
  });
  client.on('error', () => undefined);
  await client.connect();
  return client;
};
