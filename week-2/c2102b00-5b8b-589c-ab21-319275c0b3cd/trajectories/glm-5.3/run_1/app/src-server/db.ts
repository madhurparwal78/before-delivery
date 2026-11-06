import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config";
import { ApiError, errors } from "./errors";

export const db: DatabaseSync = openDb();
export const config = loadConfig();

function openDb(): DatabaseSync {
  const cfg = loadConfig();
  mkdirSync(dirname(cfg.dbPath), { recursive: true });
  const handle = new DatabaseSync(cfg.dbPath);
  handle.exec("PRAGMA journal_mode=WAL");
  handle.exec("PRAGMA busy_timeout=5000");
  handle.exec("PRAGMA synchronous=FULL");
  handle.exec("PRAGMA foreign_keys=ON");
  return handle;
}

export class DbBusy extends Error {}

/** Runs fn inside one write transaction, committing if it returns. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back by an error inside exec */
    }
    if (e instanceof Error && /database is locked|database is busy/i.test(e.message)) {
      throw errors.databaseBusy();
    }
    throw e;
  }
}

export function one<T>(sql: string, ...args: (string | number | null)[]): T | undefined {
  const row = db.prepare(sql).get(...args) as T | undefined;
  return row;
}

export function all<T>(sql: string, ...args: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}

export function run(sql: string, ...args: (string | number | null)[]): { changes: number; lastInsertRowid: number } {
  const r = db.prepare(sql).run(...args);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** Turns a provider read inside a request path into a 503 when the db is busy. */
export function busyTo503<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && /database is locked|database is busy/i.test(e.message)) {
      throw errors.databaseBusy();
    }
    throw e;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS club (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  distributor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('coordinator','volunteer')),
  name TEXT NOT NULL,
  access_code TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS households (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  access_code TEXT NOT NULL UNIQUE,
  carried_forward_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  person_name TEXT NOT NULL,
  household_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  case_name TEXT NOT NULL,
  pack INTEGER NOT NULL,
  unit TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','open','sealing','ordered','received','breakdown','closing','closed')),
  revision INTEGER NOT NULL,
  cutoff_at INTEGER,
  pickup_start_at INTEGER,
  pickup_end_at INTEGER,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cycle_products (
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, product_id)
);
CREATE TABLE IF NOT EXISTS lines (
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('filling','sealed','taken_up','dropped')),
  PRIMARY KEY (cycle_id, product_id)
);
CREATE TABLE IF NOT EXISTS pledges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  product_id TEXT NOT NULL,
  household_code TEXT NOT NULL,
  units INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (cycle_id, product_id, household_code)
);
CREATE TABLE IF NOT EXISTS pledge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  household_code TEXT NOT NULL,
  delta_units INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS short_units (
  cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_index INTEGER NOT NULL,
  household_code TEXT NOT NULL,
  short_id INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, product_id, unit_index)
);
CREATE TABLE IF NOT EXISTS shorts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  person TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  status INTEGER,
  response_body TEXT,
  PRIMARY KEY (person, key)
);
CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('carried_forward','top_up','pledge_charge','short_credit','take_up_charge')),
  cycle_id TEXT,
  memo TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS legs (
  movement_id INTEGER NOT NULL REFERENCES movements(id),
  account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  cycle_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, kind)
);
CREATE TABLE IF NOT EXISTS upload_locks (
  cycle_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, kind)
);
CREATE TABLE IF NOT EXISTS close_locks (
  cycle_id TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_slip_deletions (
  key TEXT PRIMARY KEY,
  enqueued_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bag_items (
  cycle_id TEXT NOT NULL,
  household_code TEXT NOT NULL,
  product_id TEXT NOT NULL,
  packed INTEGER NOT NULL DEFAULT 0,
  flagged_units INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cycle_id, household_code, product_id)
);
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL,
  household_code TEXT NOT NULL,
  product_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT,
  kind TEXT NOT NULL,
  household_code TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  endpoint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  sending_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lines_cycle ON lines(cycle_id);
CREATE INDEX IF NOT EXISTS idx_pledges_line ON pledges(cycle_id, product_id, id);
CREATE INDEX IF NOT EXISTS idx_events_cycle ON pledge_events(cycle_id);
CREATE INDEX IF NOT EXISTS idx_movements_household ON movements(household_code, id);
CREATE INDEX IF NOT EXISTS idx_legs_account ON legs(account);
CREATE INDEX IF NOT EXISTS idx_shorts_line ON short_units(cycle_id, product_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status, endpoint);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
`;

export interface HouseholdRow {
  code: string;
  name: string;
  email: string;
  access_code: string;
  carried_forward_cents: number;
}

export interface ProductRow {
  id: string;
  case_name: string;
  pack: number;
  unit: string;
  price_cents: number;
  sort_order: number;
}

export interface CycleRow {
  id: string;
  name: string;
  status: string;
  revision: number;
  cutoff_at: number | null;
  pickup_start_at: number | null;
  pickup_end_at: number | null;
  created_at: number;
  sort_order: number;
}

export interface LineRow {
  cycle_id: string;
  product_id: string;
  version: number;
  status: string;
}

export interface PledgeRow {
  id: number;
  cycle_id: string;
  product_id: string;
  household_code: string;
  units: number;
  created_at: number;
}

export function applySchema(): void {
  db.exec(SCHEMA);
  // Older database files gain newer columns without losing anything.
  try {
    db.exec("ALTER TABLE emails ADD COLUMN sending_until INTEGER");
  } catch {
    /* the column already exists */
  }
}

const SEED_HOUSEHOLDS: [string, string, string, string, number][] = [
  ["HH-1001", "Okafor-Lindqvist household", "hh1001@elmstreet.example", "HOME-1001", 12000],
  ["HH-1002", "Bellweather household", "hh1002@elmstreet.example", "HOME-1002", 8000],
  ["HH-1003", "Tran-Osei household", "hh1003@elmstreet.example", "HOME-1003", 6000],
  ["HH-1004", "Kowalczyk household", "hh1004@elmstreet.example", "HOME-1004", 9500],
  ["HH-1005", "Ruiz-Abernathy household", "hh1005@elmstreet.example", "HOME-1005", 1500],
  ["HH-1006", "Patel-Mercer household", "hh1006@elmstreet.example", "HOME-1006", 0],
];

const SEED_PRODUCTS: [string, string, number, string, number][] = [
  ["P-OATS", "Rolled oats, 25 lb sack", 25, "lb", 3850],
  ["P-TAHINI", "Tahini, 12 jars", 12, "jar", 4700],
  ["P-OLIVE", "Olive oil, 6 bottles", 6, "bottle", 8999],
  ["P-LENTIL", "Red lentils, 25 lb sack", 25, "lb", 4125],
  ["P-PNUT", "Peanut butter, 12 jars", 12, "jar", 5150],
  ["P-MAPLE", "Maple syrup, 6 jugs", 6, "jug", 7400],
  ["P-RICE", "Brown rice, 50 lb sack", 50, "lb", 6299],
  ["P-QUINOA", "Quinoa, 10 lb bag", 10, "lb", 3333],
];

const CLUB_TIME_ZONE = "America/Chicago";

export function seedIfEmpty(): void {
  const existing = one<{ n: number }>("SELECT COUNT(*) AS n FROM cycles");
  if (existing && existing.n > 0) return;
  const timeZone = CLUB_TIME_ZONE;
  const nowSec = Math.floor(Date.now() / 1000);
  tx(() => {
    db.exec("DELETE FROM cycles");
    run(
      "INSERT INTO club (id, name, time_zone, distributor) VALUES (1, 'Elm Street Basement Co-op', ?, 'Prairie Hollow Naturals')",
      timeZone
    );
    run("INSERT INTO people (role, name, access_code) VALUES ('coordinator', 'Marisol Ferreira-Quinn', 'COORD-2718')");
    run("INSERT INTO people (role, name, access_code) VALUES ('volunteer', 'Desmond Achterberg', 'VOL-3141')");
    for (const [code, name, email, access, cents] of SEED_HOUSEHOLDS) {
      run(
        "INSERT INTO households (code, name, email, access_code, carried_forward_cents) VALUES (?, ?, ?, ?, ?)",
        code, name, email, access, cents
      );
      if (cents > 0) {
        const m = run(
          "INSERT INTO movements (household_code, kind, cycle_id, memo, created_at) VALUES (?, 'carried_forward', NULL, 'Carried forward', ?)",
          code, nowSec
        );
        run("INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, 'household:'||?, ?)", m.lastInsertRowid, code, cents);
        run("INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, 'opening:carried-forward', ?)", m.lastInsertRowid, -cents);
      }
    }
    SEED_PRODUCTS.forEach(([id, caseName, pack, unit, price], i) => {
      run(
        "INSERT INTO products (id, case_name, pack, unit, price_cents, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        id, caseName, pack, unit, price, i + 1
      );
    });

    // Cycle 44: cutoff 20:00 club time seven days out, pickup 09:00-12:00 the day after.
    const seedDay = localSeedDay(nowSec, timeZone);
    const cutoffSec = wallToInstant(seedDay + 7, 20, 0, 0, timeZone);
    const pickupStart = wallToInstant(seedDay + 8, 9, 0, 0, timeZone);
    const pickupEnd = wallToInstant(seedDay + 8, 12, 0, 0, timeZone);
    run(
      "INSERT INTO cycles (id, name, status, revision, cutoff_at, pickup_start_at, pickup_end_at, created_at, sort_order) VALUES (?, 'Cycle 44', 'open', 2, ?, ?, ?, ?, 44)",
      "cy-44", cutoffSec, pickupStart, pickupEnd, nowSec
    );
    const cases: [string, number][] = [
      ["P-TAHINI", 1],
      ["P-OLIVE", 2],
      ["P-OATS", 3],
      ["P-MAPLE", 4],
    ];
    for (const [pid, order] of cases) {
      run("INSERT INTO cycle_products (cycle_id, product_id, sort_order) VALUES ('cy-44', ?, ?)", pid, order);
      run("INSERT INTO lines (cycle_id, product_id, version, status) VALUES ('cy-44', ?, 1, 'filling')", pid);
    }
    const seedPledges: [string, string, number][] = [
      ["P-TAHINI", "HH-1002", 5],
      ["P-TAHINI", "HH-1003", 4],
      ["P-OLIVE", "HH-1004", 4],
      ["P-MAPLE", "HH-1001", 6],
    ];
    let tahiniVersion = 1;
    let mapleVersion = 1;
    for (const [pid, hh, units] of seedPledges) {
      run(
        "INSERT INTO pledges (cycle_id, product_id, household_code, units, created_at) VALUES ('cy-44', ?, ?, ?, ?)",
        pid, hh, units, nowSec
      );
      run(
        "INSERT INTO pledge_events (cycle_id, product_id, household_code, delta_units, accepted_at) VALUES ('cy-44', ?, ?, ?, ?)",
        pid, hh, units, nowSec
      );
      if (pid === "P-TAHINI") {
        tahiniVersion += 1;
        run("UPDATE lines SET version = ?, status = 'filling' WHERE cycle_id = 'cy-44' AND product_id = 'P-TAHINI'", tahiniVersion);
      } else if (pid === "P-MAPLE") {
        mapleVersion += 1;
        run("UPDATE lines SET version = ?, status = 'sealed' WHERE cycle_id = 'cy-44' AND product_id = 'P-MAPLE'", mapleVersion);
      } else {
        run("UPDATE lines SET version = 2 WHERE cycle_id = 'cy-44' AND product_id = ?", pid);
      }
    }
  });
}

/** The club-local date of `now`, as days since epoch in that zone. */
function localSeedDay(nowSec: number, timeZone: string): number {
  const d = new Date(nowSec * 1000);
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = f.formatToParts(d);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / 86400000);
}

function wallToInstant(daySinceEpoch: number, hour: number, minute: number, second: number, timeZone: string): number {
  const naive = daySinceEpoch * 86400000 + hour * 3600000 + minute * 60000 + second * 1000;
  // 20:00 and midday are never in a gap.
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = f.formatToParts(naive);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.floor((naive - (asUtc - naive)) / 1000);
}
