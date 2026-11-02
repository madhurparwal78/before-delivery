import type { PoolClient, QueryResult } from 'pg';

export type SQLParam = string | number | boolean | null | SQLParam[] | Uint8Array;

export interface DbRow {
  [k: string]: unknown;
}

export interface TxLike {
  query<T extends DbRow>(sql: string, params?: SQLParam[]): Promise<T[]>;
  queryOne<T extends DbRow>(sql: string, params?: SQLParam[]): Promise<T | null>;
}

const TIMEOUT_MS = 20000;

export class Transaction {
  constructor(readonly client: PoolClient) {}

  async query<T extends DbRow>(sql: string, params?: SQLParam[]): Promise<T[]> {
    const res = (await withTimeout(this.client.query(sql, params as never[]), TIMEOUT_MS)) as QueryResult<T>;
    return res.rows;
  }

  async queryOne<T extends DbRow>(sql: string, params?: SQLParam[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0]! : null;
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
