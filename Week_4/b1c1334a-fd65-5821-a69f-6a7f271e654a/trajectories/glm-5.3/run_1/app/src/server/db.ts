import { Pool, PoolClient } from 'pg';

export interface ColumnModel {
  id: string;
  tableId: string;
  name: string;
  type: 'text' | 'decimal' | 'date' | 'bool' | 'reference' | 'formula';
  formula: string | null;
  targetTableId: string | null;
  position: number;
  revision: number;
}

export interface TableModel {
  id: string;
  documentId: string;
  name: string;
  kind: 'table' | 'summary';
  position: number;
  sourceTableId: string | null;
  revision: number;
  ownerColumnId: string | null;
  groupBy: string[] | null;
  sumColumns: string[] | null;
}

export interface RowModel {
  id: string;
  tableId: string;
  position: number;
  revision: number;
}

export interface CellModel {
  rowId: string;
  columnId: string;
  value: string | null;
  revision: number;
}

export interface DocumentModel {
  id: string;
  name: string;
  revision: number;
}

export interface ShareModel {
  id: string;
  documentId: string;
  position: number;
  email: string;
  role: 'editor' | 'viewer';
  rowScope: 'all' | 'own';
  inviteStatus: 'sent' | 'not_sent';
}

export interface PersonModel {
  id: string;
  email: string;
  displayName: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_person_id TEXT NOT NULL,
  revision INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS history (
  id BIGSERIAL PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision INT NOT NULL,
  kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  table_id TEXT,
  UNIQUE (document_id, revision)
);
CREATE TABLE IF NOT EXISTS doc_tables (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  position INT NOT NULL,
  source_table_id TEXT,
  revision INT NOT NULL DEFAULT 1,
  owner_column_id TEXT,
  group_by JSONB,
  sum_columns JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS doc_columns (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES doc_tables(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  formula TEXT,
  target_table_id TEXT,
  position INT NOT NULL,
  revision INT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS doc_rows (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES doc_tables(id) ON DELETE CASCADE,
  position BIGINT NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rows_position_live ON doc_rows(table_id, position) WHERE NOT deleted;
CREATE TABLE IF NOT EXISTS doc_cells (
  row_id TEXT NOT NULL REFERENCES doc_rows(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES doc_columns(id) ON DELETE CASCADE,
  value TEXT,
  revision INT NOT NULL DEFAULT 1,
  PRIMARY KEY (row_id, column_id)
);
CREATE TABLE IF NOT EXISTS undo_entries (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  stack TEXT NOT NULL,
  seq INT NOT NULL,
  kind TEXT NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (person_id, document_id, stack, seq)
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  position INT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  row_scope TEXT NOT NULL,
  invite_status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL,
  byte_size BIGINT,
  sha256 TEXT,
  created_by TEXT NOT NULL,
  document_revision INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  query TEXT NOT NULL,
  body TEXT NOT NULL,
  status INT,
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, document_id, key)
);
CREATE INDEX IF NOT EXISTS idx_cells_column ON doc_cells(column_id);
CREATE INDEX IF NOT EXISTS idx_rows_table ON doc_rows(table_id);
CREATE INDEX IF NOT EXISTS idx_columns_table ON doc_columns(table_id);
CREATE INDEX IF NOT EXISTS idx_history_doc ON history(document_id, revision);
CREATE TABLE IF NOT EXISTS doc_summary_groups (
  summary_table_id TEXT NOT NULL REFERENCES doc_tables(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  key_json TEXT NOT NULL,
  row_id TEXT NOT NULL,
  PRIMARY KEY (summary_table_id, key_json)
);
`;

export class Database {
  constructor(readonly pool: Pool) {}

  static connect(url: string): Database {
    const pool = new Pool({
      connectionString: url,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', () => {
      /* the next request retries */
    });
    return new Database(pool);
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* connection is already gone */
        }
        throw err;
      }
    });
  }

  /** A snapshot read: one repeatable-read transaction, never blocking edits. */
  async snapshot<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withClient(async (client) => {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* connection is already gone */
        }
        throw err;
      }
    });
  }

  async setup(): Promise<void> {
    await this.pool.query(SCHEMA);
  }
}

export async function lockDocument(client: PoolClient, documentId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [documentId]);
}
