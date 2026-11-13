import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';

import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = Pick<PoolClient, 'query'>;

export const newId = (): string => randomBytes(12).toString('base64url');

export const newShareCode = (): string => randomBytes(16).toString('base64url').slice(0, 22);

let ready = false;

export const dbReady = (): boolean => ready;

export const applySchema = async (): Promise<void> => {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  for (;;) {
    try {
      await pool.query(sql);
      ready = true;
      return;
    } catch (error) {
      ready = false;
      process.stderr.write(`waiting for postgres: ${(error as Error).message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

export const transact = async <T>(fn: (db: Db) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
