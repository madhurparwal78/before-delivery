// The one embedded SQLite file, shared by every server process. Writes are serialized with
// BEGIN IMMEDIATE and a 5-second busy wait; a request still blocked answers 503 database_busy.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA busy_timeout = 5000");

/**
 * Startup statements, retried while another process starting on the same new file holds it:
 * switching the journal mode reports busy at once instead of waiting.
 */
function atStartup(statement: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      db.exec(statement);
      return;
    } catch (error) {
      if (!isBusy(error) || attempt >= 100) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

if ((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode !== "wal") {
  atStartup("PRAGMA journal_mode = WAL");
}
db.exec("PRAGMA synchronous = NORMAL");

atStartup(`
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS club (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL,
  time_zone TEXT NOT NULL, distributor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (access_code TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL,
  household_code TEXT);
CREATE TABLE IF NOT EXISTS households (code TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, case_name TEXT NOT NULL, pack INTEGER NOT NULL,
  unit TEXT NOT NULL, price_cents INTEGER NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, access_code TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cycles (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  status TEXT NOT NULL, revision INTEGER NOT NULL, cutoff_at INTEGER, pickup_start_at INTEGER,
  pickup_end_at INTEGER, close_key TEXT, close_started_at INTEGER);
CREATE TABLE IF NOT EXISTS lines (cycle_id TEXT NOT NULL, product_id TEXT NOT NULL, position INTEGER NOT NULL,
  version INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (cycle_id, product_id));
CREATE TABLE IF NOT EXISTS pledges (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL, pledger TEXT NOT NULL, units INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pledges_line ON pledges (cycle_id, product_id, id);
CREATE INDEX IF NOT EXISTS pledges_pledger ON pledges (pledger);
CREATE TABLE IF NOT EXISTS shorts (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL, units INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS shorts_line ON shorts (cycle_id, product_id);
CREATE TABLE IF NOT EXISTS pledge_days (cycle_id TEXT NOT NULL, date TEXT NOT NULL, units_pledged INTEGER NOT NULL,
  units_withdrawn INTEGER NOT NULL, PRIMARY KEY (cycle_id, date));
CREATE TABLE IF NOT EXISTS movements (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, cycle_id TEXT,
  memo TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS legs (movement_id INTEGER NOT NULL, account TEXT NOT NULL, amount_cents INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS legs_account ON legs (account, movement_id);
CREATE INDEX IF NOT EXISTS legs_movement ON legs (movement_id);
CREATE TABLE IF NOT EXISTS topups (id INTEGER PRIMARY KEY AUTOINCREMENT, household_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (person TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  status INTEGER, body TEXT, headers TEXT, claimed_at INTEGER NOT NULL, PRIMARY KEY (person, key));
CREATE TABLE IF NOT EXISTS documents (cycle_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
  content_type TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, uploaded_at TEXT NOT NULL,
  PRIMARY KEY (cycle_id, kind));
CREATE TABLE IF NOT EXISTS upload_locks (cycle_id TEXT NOT NULL, kind TEXT NOT NULL, token TEXT NOT NULL,
  started_at INTEGER NOT NULL, PRIMARY KEY (cycle_id, kind));
CREATE TABLE IF NOT EXISTS stale_objects (key TEXT PRIMARY KEY, since INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bag_items (cycle_id TEXT NOT NULL, household_code TEXT NOT NULL,
  product_id TEXT NOT NULL, packed INTEGER NOT NULL, PRIMARY KEY (cycle_id, household_code, product_id));
CREATE TABLE IF NOT EXISTS flags (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id TEXT NOT NULL,
  household_code TEXT NOT NULL, product_id TEXT NOT NULL, units INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, cycle_id TEXT NOT NULL,
  household_code TEXT NOT NULL, recipient TEXT NOT NULL, message_id TEXT NOT NULL UNIQUE, subject TEXT NOT NULL,
  body TEXT NOT NULL, endpoint TEXT NOT NULL, status TEXT NOT NULL, failed_attempts INTEGER NOT NULL,
  lease_until INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mail_pending ON mail (endpoint, status);
`);

const statements = new Map<string, StatementSync>();

/** A cached prepared statement. */
function sql(text: string): StatementSync {
  let statement = statements.get(text);
  if (!statement) {
    statement = db.prepare(text);
    statements.set(text, statement);
  }
  return statement;
}

export function one<T>(text: string, ...params: SQLInputValue[]): T | undefined {
  return sql(text).get(...params) as T | undefined;
}

export function all<T>(text: string, ...params: SQLInputValue[]): T[] {
  return sql(text).all(...params) as T[];
}

export function run(text: string, ...params: SQLInputValue[]): { changes: number; lastId: number } {
  const result = sql(text).run(...params);
  return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) };
}

export function isBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /database is locked|database table is locked|SQLITE_BUSY/i.test(message);
}

export const databaseBusy = () =>
  new ApiError(503, "database_busy", "The database is busy. Nothing was changed; try again.");

let depth = 0;

/** Runs fn inside one write transaction; every change commits together or not at all. */
export function transaction<T>(fn: () => T): T {
  if (depth > 0) return fn();
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    throw isBusy(error) ? databaseBusy() : error;
  }
  depth++;
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // the failed statement already ended the transaction
    }
    throw isBusy(error) ? databaseBusy() : error;
  } finally {
    depth--;
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
