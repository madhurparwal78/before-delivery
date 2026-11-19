import pg from 'pg';
import { config } from './config.js';

// Postgres DATE columns always travel as plain YYYY-MM-DD strings.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const SCHEMA_VERSION = 2;

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());

    CREATE TABLE hotels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      business_date DATE NOT NULL,
      clock_fixed_at TIMESTAMPTZ,
      next_invoice_number INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL
    );
    CREATE UNIQUE INDEX users_hotel_email_idx ON users (hotel_id, lower(email));

    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      number TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'clean',
      UNIQUE (hotel_id, number)
    );

    CREATE TABLE rate_plans (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      name TEXT NOT NULL,
      weeknight_cents INT NOT NULL,
      weekend_cents INT NOT NULL
    );

    CREATE TABLE tax_rates (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      percent NUMERIC(5,2) NOT NULL,
      start_date DATE
    );

    CREATE TABLE guests (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX guests_lower_email_idx ON guests (hotel_id, lower(email));

    CREATE TABLE stays (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      guest_id TEXT NOT NULL REFERENCES guests(id),
      rate_plan_id TEXT NOT NULL REFERENCES rate_plans(id),
      guests INT NOT NULL,
      arrival DATE NOT NULL,
      departure DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'booked',
      version INT NOT NULL DEFAULT 1,
      checked_in_online BOOLEAN NOT NULL DEFAULT FALSE,
      online_checkin_name TEXT,
      online_checkin_phone TEXT,
      check_in_night DATE,
      id_photo BYTEA,
      id_photo_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE stay_nights (
      id TEXT PRIMARY KEY,
      stay_id TEXT NOT NULL REFERENCES stays(id),
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      date DATE NOT NULL,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      room_cents INT NOT NULL,
      tax_cents INT NOT NULL,
      city_tax_cents INT NOT NULL,
      posted BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE (stay_id, date)
    );
    CREATE INDEX stay_nights_room_date_idx ON stay_nights (room_id, date);

    CREATE TABLE stay_segments (
      id TEXT PRIMARY KEY,
      stay_id TEXT NOT NULL REFERENCES stays(id),
      room_id TEXT NOT NULL REFERENCES rooms(id),
      first_night DATE NOT NULL,
      nights INT NOT NULL
    );

    CREATE TABLE folios (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      stay_id TEXT NOT NULL REFERENCES stays(id),
      name TEXT NOT NULL,
      payer_name TEXT NOT NULL,
      payer_email TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      letter TEXT NOT NULL
    );

    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      folio_id TEXT NOT NULL REFERENCES folios(id),
      kind TEXT NOT NULL,
      date DATE NOT NULL,
      description TEXT NOT NULL,
      amount_cents INT NOT NULL,
      room_number TEXT,
      reverses_entry_id TEXT REFERENCES entries(id),
      split_of_entry_id TEXT REFERENCES entries(id),
      seq BIGSERIAL
    );
    CREATE INDEX entries_folio_idx ON entries (folio_id);

    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      folio_id TEXT NOT NULL REFERENCES folios(id),
      number TEXT NOT NULL,
      state TEXT NOT NULL,
      mail_state TEXT NOT NULL DEFAULT 'not_sent',
      bill_to_name TEXT NOT NULL,
      payer_email TEXT NOT NULL,
      pdf_key TEXT NOT NULL,
      UNIQUE (hotel_id, number)
    );

    CREATE TABLE checkin_tokens (
      token TEXT PRIMARY KEY,
      stay_id TEXT NOT NULL REFERENCES stays(id),
      sent_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ
    );

    CREATE TABLE closed_nights (
      hotel_id TEXT NOT NULL REFERENCES hotels(id),
      date DATE NOT NULL,
      rooms_available INT NOT NULL,
      rooms_sold INT NOT NULL,
      room_revenue_cents INT NOT NULL,
      PRIMARY KEY (hotel_id, date)
    );

    CREATE TABLE idempotency (
      hotel_id TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status INT NOT NULL,
      response_body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (hotel_id, key)
    );
    `
  },
  {
    version: 2,
    sql: `
    ALTER TABLE checkin_tokens ADD COLUMN mail_sent BOOLEAN NOT NULL DEFAULT FALSE;
    `
  }
];

export async function applyMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['nightroll-migrate']);
    const res = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(res.rows.map(r => r.version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
    }
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['nightroll-migrate']);
  } finally {
    client.release();
  }
}

export function id(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
