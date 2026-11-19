import { Pool } from "pg";
import { ROOMS, JOINABLE_PAIRS } from "../shared/seed.js";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export interface BookingRow {
  reference: string;
  status: "booked" | "seated" | "completed" | "no_show" | "cancelled_refunded" | "cancelled_retained";
  source: "online" | "waitlist" | "walk_in";
  date: string;
  time: string;
  starts_at: Date;
  party_size: number;
  table_id: string;
  name: string;
  email: string | null;
  manage_token: string | null;
  deposit_cents: number;
  deposit_state: "none" | "paid" | "refunded" | "retained";
  kb_payment_id: string | null;
  kb_transaction_id: string | null;
  created_at: Date;
}

export interface HoldRow {
  hold_id: string;
  table_id: string;
  date: string;
  time: string;
  party_size: number;
  status: "live" | "expired" | "released" | "confirmed";
  expires_at: Date;
  deposit_cents: number;
  reserved_reference: string | null;
  name: string | null;
  email: string | null;
}

export interface OfferRow {
  offer_id: string;
  token: string;
  entry_id: string;
  table_id: string;
  date: string;
  time: string;
  party_size: number;
  status: "offered" | "claimed" | "lapsed";
  expires_at: Date;
  deposit_cents: number;
}

export interface WaitlistRow {
  entry_id: string;
  email_lower: string;
  name: string;
  date: string;
  party_size: number;
  earliest: string;
  latest: string;
  status: "waiting" | "offered" | "claimed" | "lapsed";
  joined_at: Date;
}

export interface HostSessionRow {
  id: string;
  host_id: number;
  token: string;
  signed_in_at: Date;
}

export interface EmailRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  created_at: Date;
}

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  seats INT NOT NULL,
  sort_order INT NOT NULL
);

CREATE TABLE IF NOT EXISTS tables (
  table_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  min_seats INT NOT NULL,
  max_seats INT NOT NULL,
  sort_order INT NOT NULL,
  round_shape BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS joinable_pairs (
  pair_id TEXT PRIMARY KEY,
  table_a TEXT NOT NULL REFERENCES tables(table_id),
  table_b TEXT NOT NULL REFERENCES tables(table_id),
  min_seats INT NOT NULL,
  max_seats INT NOT NULL,
  sort_order INT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS host_sessions (
  id TEXT PRIMARY KEY,
  host_id BIGINT NOT NULL REFERENCES hosts(id),
  token TEXT NOT NULL UNIQUE,
  signed_in_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS holds (
  hold_id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  party_size INT NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  deposit_cents INT NOT NULL,
  reserved_reference TEXT,
  name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  reference TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  party_size INT NOT NULL,
  table_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  manage_token TEXT UNIQUE,
  deposit_cents INT NOT NULL DEFAULT 0,
  deposit_state TEXT NOT NULL DEFAULT 'none',
  kb_payment_id TEXT,
  kb_transaction_id TEXT,
  hold_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  cleared_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  entry_id TEXT PRIMARY KEY,
  email_lower TEXT NOT NULL,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  party_size INT NOT NULL,
  earliest TEXT NOT NULL,
  latest TEXT NOT NULL,
  status TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_live_per_email_date
  ON waitlist_entries (email_lower, date)
  WHERE status IN ('waiting', 'offered');

CREATE TABLE IF NOT EXISTS offers (
  offer_id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  entry_id TEXT NOT NULL REFERENCES waitlist_entries(entry_id),
  table_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  party_size INT NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  deposit_cents INT NOT NULL,
  reserved_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT NOT NULL,
  scope TEXT NOT NULL,
  status INT NOT NULL,
  body TEXT NOT NULL,
  request_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idempotency_key, scope)
);

CREATE TABLE IF NOT EXISTS outbox_emails (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pending_freed_tables (
  id BIGSERIAL PRIMARY KEY,
  table_id TEXT NOT NULL,
  date TEXT NOT NULL,
  noticed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const SEED_ROOMS = ROOMS.map((r, i) => [r.room_id, r.name, r.seats, i] as const);
const SEED_TABLES = ROOMS.flatMap((r, ri) =>
  r.tables.map((t, ti) => {
    const round = t.max_seats <= 2;
    return [t.table_id, r.room_id, t.min_seats, t.max_seats, ri * 100 + ti, round] as const;
  }),
);
const SEED_PAIRS = JOINABLE_PAIRS.map((p, i) => [p.pair_id, p.tables[0], p.tables[1], p.min_seats, p.max_seats, i] as const);

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Apply schema and seed idempotently on every serve. */
export async function migrate(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
  for (const [roomId, name, seats, sortOrder] of SEED_ROOMS) {
    await pool.query(
      `INSERT INTO rooms (room_id, name, seats, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id) DO UPDATE SET name = EXCLUDED.name, seats = EXCLUDED.seats, sort_order = EXCLUDED.sort_order`,
      [roomId, name, seats, sortOrder],
    );
  }
  for (const [tableId, roomId, minSeats, maxSeats, sortOrder, round] of SEED_TABLES) {
    await pool.query(
      `INSERT INTO tables (table_id, room_id, min_seats, max_seats, sort_order, round_shape) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (table_id) DO UPDATE SET room_id = EXCLUDED.room_id, min_seats = EXCLUDED.min_seats, max_seats = EXCLUDED.max_seats, sort_order = EXCLUDED.sort_order, round_shape = EXCLUDED.round_shape`,
      [tableId, roomId, minSeats, maxSeats, sortOrder, round],
    );
  }
  for (const [pairId, tableA, tableB, minSeats, maxSeats, sortOrder] of SEED_PAIRS) {
    await pool.query(
      `INSERT INTO joinable_pairs (pair_id, table_a, table_b, min_seats, max_seats, sort_order) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pair_id) DO UPDATE SET table_a = EXCLUDED.table_a, table_b = EXCLUDED.table_b, min_seats = EXCLUDED.min_seats, max_seats = EXCLUDED.max_seats, sort_order = EXCLUDED.sort_order`,
      [pairId, tableA, tableB, minSeats, maxSeats, sortOrder],
    );
  }
}

