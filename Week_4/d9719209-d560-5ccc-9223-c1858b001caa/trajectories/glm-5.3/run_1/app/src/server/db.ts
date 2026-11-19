/* Database access: a thin typed wrapper over pg with the query helpers the
   routes use. Postgres is the only source of truth. */
import pg from 'pg';
import type { AppConfig } from '../config.js';
import { SCHEMA_SQL } from './schema.js';
import { seed } from './seed.js';

export type QueryResult<T = Record<string, unknown>> = { rows: T[]; rowCount: number | null };

export interface Db {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  connect(): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export class PgDb implements Db {
  private client: pg.Client;
  private inTx = false;

  constructor(connectionString: string) {
    this.client = new pg.Client({ connectionString });
  }

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    const res = await this.client.query(text, params as never[]);
    return { rows: res.rows as Record<string, unknown>[], rowCount: res.rowCount ?? null };
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async begin(): Promise<void> {
    await this.client.query('BEGIN');
    this.inTx = true;
  }

  async commit(): Promise<void> {
    await this.client.query('COMMIT');
    this.inTx = false;
  }

  async rollback(): Promise<void> {
    if (this.inTx) await this.client.query('ROLLBACK');
    this.inTx = false;
  }
}

/* Applies the schema, and the seed when `fieldnotes` doesn't exist. Both are
   idempotent, and they run before the server reports healthy. */
export async function applySchemaAndSeed(db: Db, cfg: AppConfig): Promise<void> {
  await db.query(SCHEMA_SQL);
  const exists = await db.query(`SELECT 1 FROM communities WHERE name_lc = 'fieldnotes'`);
  if (exists.rows.length === 0) await seed(db, cfg);
}
