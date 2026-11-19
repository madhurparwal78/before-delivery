import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.INT8, Number);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", () => undefined);

export interface Db {
  query<R extends pg.QueryResultRow = Record<string, unknown>>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export const rows = async <R extends pg.QueryResultRow = Record<string, unknown>>(db: Db, text: string, values: unknown[] = []): Promise<R[]> =>
  (await db.query<R>(text, values)).rows;
export const one = async <R extends pg.QueryResultRow = Record<string, unknown>>(db: Db, text: string, values: unknown[] = []): Promise<R | undefined> =>
  (await db.query<R>(text, values)).rows[0];

/** One row the caller knows exists, such as the row it has just written. */
export const only = async <R extends pg.QueryResultRow = Record<string, unknown>>(db: Db, text: string, values: unknown[] = []): Promise<R> =>
  (await db.query<R>(text, values)).rows[0];

/** Runs `work` in one transaction: everything it writes lands together or not at all. */
export const transaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
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
};

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS desks (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, email_folded text NOT NULL UNIQUE, password_hash text NOT NULL,
  next_run integer NOT NULL DEFAULT 1, holidays jsonb, holidays_read_at bigint, review_list jsonb NOT NULL DEFAULT '[]', created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, desk_id text NOT NULL REFERENCES desks, created_at bigint NOT NULL, ended_at bigint);
CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY, desk_id text NOT NULL REFERENCES desks, name text, email text, email_folded text, telephone text, telephone_folded text,
  language text NOT NULL DEFAULT 'en', notes text, state text NOT NULL DEFAULT 'active', closed_at bigint, erase_at bigint, created_at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS customers_desk ON customers (desk_id);
CREATE TABLE IF NOT EXISTS rate_tables (
  id text PRIMARY KEY, desk_id text NOT NULL REFERENCES desks, effective_from text NOT NULL, margin_halves integer NOT NULL, waiting_rate bigint NOT NULL,
  second_driver bigint NOT NULL, deposit_minibus bigint NOT NULL, deposit_minibus_higher bigint NOT NULL, deposit_coach bigint NOT NULL, deposit_coach_higher bigint NOT NULL,
  UNIQUE (desk_id, effective_from));
CREATE TABLE IF NOT EXISTS hires (
  id text PRIMARY KEY, desk_id text NOT NULL REFERENCES desks, customer_id text NOT NULL REFERENCES customers, occasion text NOT NULL, journey_type text NOT NULL,
  state text NOT NULL DEFAULT 'new', plan_sizes integer[], party jsonb NOT NULL, details text, name text, email text, telephone text, language text NOT NULL DEFAULT 'en',
  submitted_body text, merged_into text, created_at bigint NOT NULL, created_seq bigserial,
  depart_date text NOT NULL, depart_time text NOT NULL, depart_repeated text, depart_instant bigint NOT NULL,
  return_date text, return_time text, return_repeated text, return_instant bigint,
  legs jsonb, plan_out_of_date boolean NOT NULL DEFAULT false, awarded_operator text, awarded_at bigint,
  quote_version integer NOT NULL DEFAULT 1, quote_token text, quote_sent_at bigint, quote_ends_at bigint, rate_table_id text,
  quote_mailed boolean NOT NULL DEFAULT false, quote_edited boolean NOT NULL DEFAULT false, quote_changed_at bigint,
  accepted_at bigint, deposit_said_sent boolean NOT NULL DEFAULT false, reminded boolean NOT NULL DEFAULT false, cancellation jsonb);
CREATE INDEX IF NOT EXISTS hires_desk ON hires (desk_id, created_at DESC, id);
CREATE TABLE IF NOT EXISTS replaced_tokens (token text PRIMARY KEY, hire_id text NOT NULL REFERENCES hires, language text NOT NULL DEFAULT 'en');
CREATE TABLE IF NOT EXISTS stops (id text PRIMARY KEY, hire_id text NOT NULL REFERENCES hires, position integer NOT NULL, text text NOT NULL, checked boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS stops_hire ON stops (hire_id, position);
CREATE TABLE IF NOT EXISTS operators (
  desk_id text NOT NULL REFERENCES desks, id text NOT NULL, name text NOT NULL, town text NOT NULL, email text NOT NULL, telephone text NOT NULL, sizes integer[] NOT NULL,
  listed boolean NOT NULL DEFAULT true, dbs_checked_on text, PRIMARY KEY (desk_id, id));
CREATE TABLE IF NOT EXISTS papers (
  desk_id text NOT NULL, operator_id text NOT NULL, kind text NOT NULL, ends_on text NOT NULL, stored boolean NOT NULL DEFAULT false, object_key text, content_type text,
  expiry_mailed boolean NOT NULL DEFAULT false, PRIMARY KEY (desk_id, operator_id, kind));
CREATE TABLE IF NOT EXISTS bid_asks (
  token text PRIMARY KEY, desk_id text NOT NULL, hire_id text NOT NULL REFERENCES hires, operator_id text NOT NULL, sent_at bigint NOT NULL, closes_at bigint NOT NULL,
  prices bigint[], received_at bigint, withdrawn boolean NOT NULL DEFAULT false, mailed boolean NOT NULL DEFAULT false, UNIQUE (hire_id, operator_id));
CREATE TABLE IF NOT EXISTS vehicles (
  id text PRIMARY KEY, hire_id text NOT NULL REFERENCES hires, position integer NOT NULL, seats integer NOT NULL, operator_id text, bought bigint NOT NULL, margin_halves integer NOT NULL,
  deposit bigint NOT NULL, charges bigint NOT NULL DEFAULT 0, depart_date text NOT NULL, depart_time text NOT NULL, depart_repeated text, depart_instant bigint NOT NULL);
CREATE INDEX IF NOT EXISTS vehicles_hire ON vehicles (hire_id, position);
CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY, desk_id text NOT NULL, number integer NOT NULL, hire_id text NOT NULL REFERENCES hires, vehicle_id text NOT NULL REFERENCES vehicles,
  driver_name text, driver_telephone text, telephone_folded text, told_at bigint, confirmed boolean NOT NULL DEFAULT false, token text NOT NULL UNIQUE, second_driver boolean NOT NULL DEFAULT false,
  duty_start bigint, blocks jsonb NOT NULL DEFAULT '[]');
CREATE INDEX IF NOT EXISTS runs_desk ON runs (desk_id);
CREATE TABLE IF NOT EXISTS run_flights (
  run_id text NOT NULL REFERENCES runs, stop_id text NOT NULL, code text NOT NULL, landed_at bigint, read_at bigint, failed boolean NOT NULL DEFAULT false, PRIMARY KEY (run_id, stop_id));
CREATE TABLE IF NOT EXISTS presses (
  id text PRIMARY KEY, run_id text NOT NULL REFERENCES runs, stop_id text NOT NULL, kind text NOT NULL, at bigint NOT NULL, repeat_key text NOT NULL,
  UNIQUE (run_id, repeat_key), UNIQUE (run_id, stop_id, kind));
CREATE TABLE IF NOT EXISTS accepted_charges (
  run_id text NOT NULL REFERENCES runs, stop_id text NOT NULL, kind text NOT NULL, minutes integer NOT NULL, pennies bigint NOT NULL, PRIMARY KEY (run_id, stop_id, kind));
CREATE TABLE IF NOT EXISTS ledger_lines (
  id text PRIMARY KEY, desk_id text NOT NULL, movement_id text NOT NULL, hire_id text NOT NULL REFERENCES hires, vehicle_id text, account text NOT NULL, pennies bigint NOT NULL,
  at bigint NOT NULL, part text NOT NULL, description text NOT NULL, seq bigserial);
CREATE INDEX IF NOT EXISTS ledger_hire ON ledger_lines (hire_id);
CREATE INDEX IF NOT EXISTS ledger_desk ON ledger_lines (desk_id);
CREATE TABLE IF NOT EXISTS statement_rows (
  desk_id text NOT NULL, date text NOT NULL, amount bigint NOT NULL, description text NOT NULL, balance text NOT NULL, PRIMARY KEY (desk_id, date, amount, description, balance));
CREATE TABLE IF NOT EXISTS statement_previews (id text PRIMARY KEY, desk_id text NOT NULL, matched jsonb NOT NULL, created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS passengers (
  id text PRIMARY KEY, hire_id text NOT NULL REFERENCES hires, position bigserial, name text NOT NULL, grp text NOT NULL DEFAULT '', needs text NOT NULL DEFAULT '', folded text NOT NULL,
  listed_twice boolean NOT NULL DEFAULT false, wheelchair boolean NOT NULL DEFAULT false, vehicle_id text, seat text);
CREATE INDEX IF NOT EXISTS passengers_hire ON passengers (hire_id, position);
CREATE TABLE IF NOT EXISTS passenger_lists (id text PRIMARY KEY, hire_id text NOT NULL REFERENCES hires, object_key text NOT NULL);
CREATE TABLE IF NOT EXISTS changes (id text PRIMARY KEY, hire_id text NOT NULL REFERENCES hires, at bigint NOT NULL, body jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY, desk_id text NOT NULL, hire_id text NOT NULL REFERENCES hires, kind text NOT NULL, state text NOT NULL, number text, object_key text, customer_name text,
  created_at bigint NOT NULL, created_seq bigserial, history jsonb NOT NULL DEFAULT '[]', erased boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS documents_desk ON documents (desk_id);
CREATE TABLE IF NOT EXISTS number_counters (desk_id text NOT NULL, kind text NOT NULL, year integer NOT NULL, last integer NOT NULL, PRIMARY KEY (desk_id, kind, year));
CREATE TABLE IF NOT EXISTS downloads (desk_id text NOT NULL, at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS enquiry_requests (email_folded text NOT NULL, at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS enquiry_requests_email ON enquiry_requests (email_folded, at);
CREATE TABLE IF NOT EXISTS complaints (
  id text PRIMARY KEY, desk_id text NOT NULL, customer_id text NOT NULL, summary text NOT NULL, received_date text NOT NULL, received_time text NOT NULL, reply_due text NOT NULL,
  holiday_line text, created_seq bigserial);
CREATE TABLE IF NOT EXISTS lost_items (
  id text PRIMARY KEY, desk_id text NOT NULL, description text NOT NULL, found_on text NOT NULL, held_to text NOT NULL, returned_at bigint, owner_details text, created_seq bigserial);
`;

export const migrate = async (): Promise<void> => {
  await pool.query(SCHEMA);
};
