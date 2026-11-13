import { type Db } from "./db";

/** Applied idempotently on every start, under an advisory lock (see main.ts). */
const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS clock_offset (id int PRIMARY KEY, offset_seconds bigint NOT NULL)`,
  `INSERT INTO clock_offset (id, offset_seconds) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS members (
     id text PRIMARY KEY, email text NOT NULL UNIQUE, display_name text NOT NULL, roles text[] NOT NULL,
     id_state text NOT NULL DEFAULT 'none', id_reason text, photo_file_id text, created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token text PRIMARY KEY, member_id text NOT NULL REFERENCES members(id), created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sign_in_codes (
     id text PRIMARY KEY, email text NOT NULL, code text NOT NULL, issued_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false)`,
  `CREATE INDEX IF NOT EXISTS sign_in_codes_email ON sign_in_codes (email, issued_at)`,
  `CREATE TABLE IF NOT EXISTS vehicles (
     id text PRIMARY KEY, owner_id text NOT NULL REFERENCES members(id), make_model text NOT NULL, colour text NOT NULL,
     seats int NOT NULL, created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rides (
     id text PRIMARY KEY, driver_id text NOT NULL REFERENCES members(id), vehicle_id text NOT NULL REFERENCES vehicles(id),
     booking_mode text NOT NULL, seats int NOT NULL, price_cents int NOT NULL, state text NOT NULL, version int NOT NULL,
     departure timestamptz NOT NULL, created_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS rides_departure ON rides (departure)`,
  `CREATE INDEX IF NOT EXISTS rides_driver ON rides (driver_id)`,
  `CREATE TABLE IF NOT EXISTS ride_stops (
     ride_id text NOT NULL REFERENCES rides(id), position int NOT NULL, city text NOT NULL, PRIMARY KEY (ride_id, position))`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id text PRIMARY KEY, ride_id text NOT NULL REFERENCES rides(id), passenger_id text NOT NULL REFERENCES members(id),
     boarding_index int NOT NULL, alighting_index int NOT NULL, seats int NOT NULL, seat_numbers int[] NOT NULL,
     price_cents int NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL,
     free_cancel_until timestamptz, change_from timestamptz, change_to timestamptz, rating_closed boolean NOT NULL DEFAULT false)`,
  `CREATE INDEX IF NOT EXISTS bookings_ride ON bookings (ride_id)`,
  `CREATE INDEX IF NOT EXISTS bookings_passenger ON bookings (passenger_id)`,
  `CREATE INDEX IF NOT EXISTS bookings_state ON bookings (state)`,
  `CREATE TABLE IF NOT EXISTS booking_history (
     id bigserial PRIMARY KEY, booking_id text NOT NULL REFERENCES bookings(id), state text NOT NULL, at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS booking_history_booking ON booking_history (booking_id)`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
     id text PRIMARY KEY, booking_id text REFERENCES bookings(id), kind text NOT NULL, label text, at timestamptz NOT NULL,
     seq bigserial)`,
  `CREATE INDEX IF NOT EXISTS ledger_entries_booking ON ledger_entries (booking_id)`,
  `CREATE TABLE IF NOT EXISTS ledger_lines (
     id text PRIMARY KEY, entry_id text NOT NULL REFERENCES ledger_entries(id), account text NOT NULL, amount_cents int NOT NULL,
     seq bigserial)`,
  `CREATE INDEX IF NOT EXISTS ledger_lines_account ON ledger_lines (account)`,
  `CREATE INDEX IF NOT EXISTS ledger_lines_entry ON ledger_lines (entry_id)`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     member_id text NOT NULL, path text NOT NULL, key text NOT NULL, request_hash text NOT NULL, status int NOT NULL,
     body text NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (member_id, path, key))`,
  `CREATE TABLE IF NOT EXISTS messages (
     id text PRIMARY KEY, booking_id text NOT NULL REFERENCES bookings(id), author_id text NOT NULL REFERENCES members(id),
     body text NOT NULL, sent_at timestamptz NOT NULL, seq bigserial)`,
  `CREATE INDEX IF NOT EXISTS messages_booking ON messages (booking_id, seq)`,
  `CREATE TABLE IF NOT EXISTS ratings (
     id text PRIMARY KEY, booking_id text NOT NULL REFERENCES bookings(id), by_member_id text NOT NULL REFERENCES members(id),
     stars int NOT NULL, comment text NOT NULL, created_at timestamptz NOT NULL, UNIQUE (booking_id, by_member_id))`,
  `CREATE TABLE IF NOT EXISTS files (
     id text PRIMARY KEY, owner_id text NOT NULL REFERENCES members(id), kind text NOT NULL, object_key text NOT NULL,
     content_type text NOT NULL, size_bytes int NOT NULL, created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS id_documents (
     id text PRIMARY KEY, member_id text NOT NULL REFERENCES members(id), file_id text NOT NULL REFERENCES files(id),
     state text NOT NULL, reason text, uploaded_at timestamptz NOT NULL, decided_at timestamptz, seq bigserial)`,
  `CREATE TABLE IF NOT EXISTS outbox (
     id text PRIMARY KEY, kind text NOT NULL, to_email text NOT NULL, subject text NOT NULL, body text NOT NULL,
     status text NOT NULL DEFAULT 'queued', attempts int NOT NULL DEFAULT 0, last_attempt_at timestamptz,
     created_at timestamptz NOT NULL, sent_at timestamptz, ride_id text, passenger_id text, seq bigserial)`,
  `CREATE INDEX IF NOT EXISTS outbox_status ON outbox (status, seq)`,
  `CREATE INDEX IF NOT EXISTS outbox_ride ON outbox (ride_id)`,
];

export async function applySchema(db: Db): Promise<void> {
  for (const statement of STATEMENTS) await db.query(statement);
}
