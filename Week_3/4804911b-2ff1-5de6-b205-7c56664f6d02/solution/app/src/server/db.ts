import pg from "pg";
import { config } from "./config.js";
import { ApiError, unavailable } from "./errors.js";

pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export type Row = Record<string, unknown>;
export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

const pool = new pg.Pool({
  connectionString: config.databaseUrl || undefined,
  max: 5,
  connectionTimeoutMillis: 6000,
  idleTimeoutMillis: 10000,
});
pool.on("error", () => undefined);

export const db: Queryable = pool;

let ready = false;
export const isReady = (): boolean => ready;
export const markReady = (): void => {
  ready = true;
};

export async function tx<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function ping(): Promise<boolean> {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500)),
    ]);
    return true;
  } catch {
    return false;
  }
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "57P01", "57P02", "57P03", "08000", "08003", "08006", "3D000", "28P01", "28000"]);
export function asApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  const e = error as { code?: string; message?: string };
  if ((e.code && CONNECTION_CODES.has(e.code)) || /Connection terminated|timeout exceeded when trying to connect|ECONNREFUSED/.test(e.message ?? ""))
    return unavailable();
  return null;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS drinks (id text PRIMARY KEY, name text NOT NULL, carbonated boolean NOT NULL, sugar_mg_per_100ml int NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS skus (code text PRIMARY KEY, drink_id text NOT NULL REFERENCES drinks(id), variant text NOT NULL, format text NOT NULL, size_ml int NOT NULL, shelf_days int NOT NULL, launch_mrp_paise int NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS sku_history (id bigserial PRIMARY KEY, sku_code text NOT NULL, at timestamptz NOT NULL, field text NOT NULL, from_value text NOT NULL, to_value text NOT NULL);
CREATE TABLE IF NOT EXISTS aliases (alias text PRIMARY KEY, sku_code text NOT NULL REFERENCES skus(code));
CREATE TABLE IF NOT EXISTS batches (code text PRIMARY KEY, sku_code text NOT NULL REFERENCES skus(code), packed_date text NOT NULL, old_wrapper boolean NOT NULL DEFAULT false, seq bigserial);
CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY, role text NOT NULL, email text NOT NULL UNIQUE, display_name text NOT NULL, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS notices (number text PRIMARY KEY, year int NOT NULL, seq int NOT NULL, UNIQUE (year, seq));
CREATE TABLE IF NOT EXISTS notice_versions (number text NOT NULL REFERENCES notices(number), version int NOT NULL, title text NOT NULL, effective_date text NOT NULL, run_out_until text, published_at timestamptz NOT NULL, reason text, print_state text NOT NULL, pdf_sha256 text, sheet_id text, PRIMARY KEY (number, version));
CREATE TABLE IF NOT EXISTS notice_rows (number text NOT NULL, version int NOT NULL, position int NOT NULL, sku_code text NOT NULL, name text NOT NULL, kind text NOT NULL, old_mrp_paise int NOT NULL, revised_mrp_paise int NOT NULL, old_rate int, new_rate int, ceiling_paise int, PRIMARY KEY (number, version, position));
CREATE INDEX IF NOT EXISTS notice_rows_sku ON notice_rows (sku_code);
CREATE TABLE IF NOT EXISTS drafts (id text PRIMARY KEY, seq bigserial, state text NOT NULL DEFAULT 'draft', revision int NOT NULL, title text NOT NULL, effective_date text NOT NULL, run_out_until text, sheet_id text, rows jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS sheets (id text PRIMARY KEY, seq bigserial, filename text NOT NULL, sha256 text NOT NULL UNIQUE, size_bytes int NOT NULL, imported_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sheet_rows (sheet_id text NOT NULL, row_number int NOT NULL, raw jsonb NOT NULL, norm_desc text NOT NULL, status text NOT NULL, matched_by text, sku_code text, candidates jsonb NOT NULL DEFAULT '[]', reason text, new_mrp_paise int, old_rate int, new_rate int, merged_into_row int, ignored boolean NOT NULL DEFAULT false, final boolean NOT NULL DEFAULT false, PRIMARY KEY (sheet_id, row_number));
CREATE INDEX IF NOT EXISTS sheet_rows_desc ON sheet_rows (norm_desc);
CREATE TABLE IF NOT EXISTS endpoints (id text PRIMARY KEY, seq bigserial, account_id text NOT NULL REFERENCES accounts(id), url text NOT NULL, normalized_url text NOT NULL, secret text NOT NULL, registered boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL, removed_at timestamptz, svix_removed boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX IF NOT EXISTS endpoints_live_url ON endpoints (account_id, normalized_url) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS deliveries (event_id text PRIMARY KEY, seq bigserial, endpoint_id text NOT NULL REFERENCES endpoints(id), account_id text NOT NULL, event_type text NOT NULL, notice_number text, notice_version int, payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending', handed_over boolean NOT NULL DEFAULT false, svix_msg_id text, redelivery_known int, resend_sent boolean NOT NULL DEFAULT false, attempts jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL, queued_at timestamptz);
CREATE INDEX IF NOT EXISTS deliveries_endpoint ON deliveries (endpoint_id);
CREATE TABLE IF NOT EXISTS outbox (id bigserial PRIMARY KEY, job jsonb NOT NULL, published boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS outbox_unpublished ON outbox (id) WHERE NOT published;
`;
