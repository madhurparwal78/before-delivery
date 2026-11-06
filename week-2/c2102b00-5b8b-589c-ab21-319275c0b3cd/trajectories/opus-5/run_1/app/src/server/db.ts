import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export class DatabaseBusyError extends Error {
  constructor() {
    super('database is busy');
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS club (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  distributor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  access_code TEXT NOT NULL UNIQUE,
  household_code TEXT
);
CREATE TABLE IF NOT EXISTS households (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  case_name TEXT NOT NULL,
  pack INTEGER NOT NULL,
  unit TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  cutoff_at TEXT,
  pickup_start_at TEXT,
  pickup_end_at TEXT,
  created_at TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cycle_lines (
  cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (cycle_id, product_id)
);
CREATE TABLE IF NOT EXISTS pledges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  pledger TEXT NOT NULL,
  units INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (cycle_id, product_id, pledger)
);
CREATE TABLE IF NOT EXISTS pledge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  pledger TEXT NOT NULL,
  delta INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shorts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS short_units (
  cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_number INTEGER NOT NULL,
  short_id INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, product_id, unit_number)
);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  cycle_id TEXT,
  memo TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id INTEGER NOT NULL,
  account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payment_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS documents (
  cycle_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  PRIMARY KEY (cycle_id, kind)
);
CREATE TABLE IF NOT EXISTS upload_locks (
  cycle_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, kind)
);
CREATE TABLE IF NOT EXISTS close_locks (
  cycle_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_deletes (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bag_items (
  cycle_id TEXT NOT NULL,
  household_code TEXT NOT NULL,
  product_id TEXT NOT NULL,
  packed INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, household_code, product_id)
);
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL,
  household_code TEXT NOT NULL,
  product_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  cycle_id TEXT,
  household_code TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  message_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  person_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  person_key TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  status INTEGER,
  response TEXT,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (person_key, key)
);
CREATE INDEX IF NOT EXISTS pledges_line ON pledges (cycle_id, product_id, id);
CREATE INDEX IF NOT EXISTS legs_movement ON legs (movement_id);
CREATE INDEX IF NOT EXISTS legs_account ON legs (account);
CREATE INDEX IF NOT EXISTS movements_order ON movements (created_at DESC, id DESC);
`;

export const db = openDatabase();

function openDatabase(): Database.Database {
  const file = path.resolve(config.dbPath);
  mkdirSync(path.dirname(file), { recursive: true });
  const handle = new Database(file);
  handle.pragma('journal_mode = WAL');
  handle.pragma('synchronous = NORMAL');
  handle.pragma('busy_timeout = 5000');
  handle.pragma('foreign_keys = ON');
  handle.exec(SCHEMA);
  return handle;
}

function isBusy(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT' || code === 'SQLITE_LOCKED';
}

/** Runs a read, turning lock contention into a 503 for the caller. */
export function readTx<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (isBusy(error)) throw new DatabaseBusyError();
    throw error;
  }
}

/** Runs a check and the write it allows inside one immediate transaction. */
export function writeTx<T>(work: () => T): T {
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch (error) {
    if (isBusy(error)) throw new DatabaseBusyError();
    throw error;
  }
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    if (isBusy(error)) throw new DatabaseBusyError();
    throw error;
  }
}
