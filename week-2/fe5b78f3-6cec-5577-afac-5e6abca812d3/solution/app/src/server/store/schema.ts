// Schema and seed, applied idempotently on every start under one advisory lock (several instances may share the database).
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Catalog, Stop, Train } from "../domain/catalog.js";
import { SEEDED_ACCOUNTS, TRAINS } from "../domain/seed.js";
import { hashPassword } from "./accounts.js";

const MIGRATION_LOCK = 4_173_001;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stations (code text PRIMARY KEY, name text NOT NULL, seq int NOT NULL);
CREATE TABLE IF NOT EXISTS trains (number text PRIMARY KEY, name text NOT NULL, seq int NOT NULL);
CREATE TABLE IF NOT EXISTS stops (
  train text NOT NULL REFERENCES trains, seq int NOT NULL, code text NOT NULL REFERENCES stations,
  km int NOT NULL, minutes int NOT NULL, remote boolean NOT NULL, PRIMARY KEY (train, seq));
CREATE TABLE IF NOT EXISTS coaches (
  train text NOT NULL REFERENCES trains, code text NOT NULL, class text NOT NULL CHECK (class IN ('SL', '3A')),
  seq int NOT NULL, PRIMARY KEY (train, code));
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, phone text NOT NULL,
  password_hash text NOT NULL, kb_account_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS runs (
  train text NOT NULL REFERENCES trains, run_date date NOT NULL, class text NOT NULL, PRIMARY KEY (train, run_date, class));
CREATE TABLE IF NOT EXISTS bookings (
  pnr text PRIMARY KEY CHECK (pnr ~ '^[1-9][0-9]{9}$'), seq bigserial UNIQUE, account_id uuid NOT NULL REFERENCES accounts,
  train text NOT NULL REFERENCES trains, run_date date NOT NULL, class text NOT NULL, quota text NOT NULL,
  from_code text NOT NULL, to_code text NOT NULL, from_seq int NOT NULL, to_seq int NOT NULL,
  keep_in_one_coach boolean NOT NULL, lower_berth_only boolean NOT NULL, contact_phone text NOT NULL,
  total_paise bigint NOT NULL CHECK (total_paise >= 0), fare_lines jsonb NOT NULL, version int NOT NULL,
  chart_recorded boolean NOT NULL DEFAULT false, kb_payment_id text NOT NULL);
CREATE INDEX IF NOT EXISTS bookings_run ON bookings (train, run_date, class);
CREATE INDEX IF NOT EXISTS bookings_uncharted ON bookings (train, run_date) WHERE NOT chart_recorded;
CREATE TABLE IF NOT EXISTS passengers (
  pnr text NOT NULL REFERENCES bookings, number int NOT NULL, name text NOT NULL, age int NOT NULL,
  gender text NOT NULL, berth_preference text NOT NULL, fare_paise bigint NOT NULL CHECK (fare_paise >= 0),
  booking_status jsonb NOT NULL, status text NOT NULL, position int, coach text, berth int, rac_place int, queue_seq bigint,
  PRIMARY KEY (pnr, number));
CREATE TABLE IF NOT EXISTS history (
  id bigserial PRIMARY KEY, pnr text NOT NULL REFERENCES bookings, number int NOT NULL,
  at_ms bigint NOT NULL, from_label text NOT NULL, to_label text NOT NULL);
CREATE TABLE IF NOT EXISTS cancellations (
  pnr text NOT NULL REFERENCES bookings, number int NOT NULL, requested_ms bigint NOT NULL,
  passengers jsonb NOT NULL, refund_paise bigint NOT NULL, PRIMARY KEY (pnr, number));
CREATE TABLE IF NOT EXISTS refunds (
  pnr text NOT NULL REFERENCES bookings, number int NOT NULL, reason text NOT NULL,
  refund_paise bigint NOT NULL CHECK (refund_paise > 0), status text NOT NULL DEFAULT 'pending', issued_ms bigint,
  claimed_until timestamptz, PRIMARY KEY (pnr, number));
CREATE TABLE IF NOT EXISTS tickets (
  pnr text NOT NULL REFERENCES bookings, version int NOT NULL, kind text NOT NULL, created_ms bigint NOT NULL,
  snapshot jsonb NOT NULL, stored boolean NOT NULL DEFAULT false, etag text, claimed_until timestamptz,
  PRIMARY KEY (pnr, version));
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL,
  attach_pnr text, attach_version int, sent_at timestamptz, claimed_until timestamptz);
CREATE TABLE IF NOT EXISTS idempotency (
  account_id uuid NOT NULL REFERENCES accounts, key text NOT NULL, fingerprint text NOT NULL, state text NOT NULL,
  status int, body text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (account_id, key));
`;

export async function migrate(db: Pool): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(SCHEMA);
    const stations = new Map<string, string>();
    for (const train of TRAINS) for (const s of train.stops) if (!stations.has(s.code)) stations.set(s.code, s.name);
    let seq = 0;
    for (const [code, name] of stations) {
      await client.query("INSERT INTO stations (code, name, seq) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [code, name, seq++]);
    }
    for (const [i, train] of TRAINS.entries()) {
      await client.query("INSERT INTO trains (number, name, seq) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [train.number, train.name, i]);
      for (const [j, s] of train.stops.entries()) {
        await client.query(
          "INSERT INTO stops (train, seq, code, km, minutes, remote) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
          [train.number, j, s.code, s.km, s.minutes, s.remote],
        );
      }
      for (const [j, c] of train.coaches.entries()) {
        await client.query("INSERT INTO coaches (train, code, class, seq) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [
          train.number, c.code, c.cls, j,
        ]);
      }
    }
    for (const a of SEEDED_ACCOUNTS) {
      const exists = await client.query("SELECT 1 FROM accounts WHERE email = $1", [a.email]);
      if (exists.rowCount === 0) {
        await client.query("INSERT INTO accounts (id, name, email, phone, password_hash) VALUES ($1, $2, $3, $4, $5)", [
          randomUUID(), a.name, a.email, a.phone, await hashPassword(a.password),
        ]);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

export async function loadCatalog(db: Pool): Promise<Catalog> {
  const stations = await db.query<{ code: string; name: string }>("SELECT code, name FROM stations ORDER BY seq");
  const trains = await db.query<{ number: string; name: string }>("SELECT number, name FROM trains ORDER BY seq");
  const stops = await db.query<Stop & { train: string }>(
    "SELECT s.train, s.seq, s.code, st.name, s.km, s.minutes, s.remote FROM stops s JOIN stations st ON st.code = s.code ORDER BY s.train, s.seq",
  );
  const coaches = await db.query<{ train: string; code: string; class: "SL" | "3A" }>(
    "SELECT train, code, class FROM coaches ORDER BY train, seq",
  );
  const list: Train[] = trains.rows.map((t) => ({
    number: t.number,
    name: t.name,
    stops: stops.rows.filter((s) => s.train === t.number).map(({ train: _train, ...s }) => s),
    coaches: coaches.rows.filter((c) => c.train === t.number).map((c) => ({ code: c.code, cls: c.class })),
  }));
  return { stations: stations.rows, trains: list };
}
