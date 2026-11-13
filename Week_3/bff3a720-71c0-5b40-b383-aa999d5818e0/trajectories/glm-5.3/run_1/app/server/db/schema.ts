import pg from 'pg';

// BIGINT (int8) reads back as a number: every epoch-ms column is int8.
pg.types.setTypeParser(20, (val: string) => Number(val));

export function makePool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 20 });
  pool.on('error', (err: Error) => {
    console.error('idle pg client error', err.message);
  });
  return pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clock_offset (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  offset_ms BIGINT NOT NULL DEFAULT 0
);
INSERT INTO clock_offset (id, offset_ms) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  id_state TEXT NOT NULL DEFAULT 'none' CHECK (id_state IN ('none','pending','verified','rejected')),
  id_reason TEXT,
  photo_file_id TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sign_in_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  issued_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES members(id),
  make_model TEXT NOT NULL,
  colour TEXT NOT NULL,
  seats INT NOT NULL
);

CREATE TABLE IF NOT EXISTS rides (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES members(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  state TEXT NOT NULL CHECK (state IN ('published','changed','departed','arrived','cancelled')),
  version INT NOT NULL DEFAULT 1,
  booking_mode TEXT NOT NULL CHECK (booking_mode IN ('instant','request')),
  seats INT NOT NULL,
  price_cents INT NOT NULL,
  route_km INT NOT NULL,
  departure BIGINT NOT NULL,
  arrival BIGINT NOT NULL,
  free_cancel_until BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS ride_stops (
  ride_id TEXT NOT NULL REFERENCES rides(id),
  idx INT NOT NULL,
  city TEXT NOT NULL,
  km INT NOT NULL,
  time BIGINT NOT NULL,
  PRIMARY KEY (ride_id, idx)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL REFERENCES rides(id),
  passenger_id TEXT NOT NULL REFERENCES members(id),
  boarding TEXT NOT NULL,
  alighting TEXT NOT NULL,
  boarding_time BIGINT NOT NULL,
  alighting_time BIGINT NOT NULL,
  seats INT NOT NULL,
  seat_numbers INT[] NOT NULL,
  segment_km INT NOT NULL,
  price_cents INT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held','requested','confirmed','completed','rated','expired','declined','withdrawn','cancelled_by_passenger','cancelled_by_driver')),
  created_at BIGINT NOT NULL,
  hold_expires_at BIGINT,
  request_expires_at BIGINT,
  ride_version INT NOT NULL,
  free_cancel_until BIGINT
);

CREATE TABLE IF NOT EXISTS booking_history (
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  state TEXT NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (booking_id, state, at)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  booking_id TEXT,
  at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  account TEXT NOT NULL,
  amount_cents INT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id TEXT NOT NULL,
  route_path TEXT NOT NULL,
  key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INT NOT NULL,
  response TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (member_id, route_path, key)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  author_id TEXT NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  sent_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  by_member_id TEXT NOT NULL REFERENCES members(id),
  stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  submitted_at BIGINT NOT NULL,
  PRIMARY KEY (booking_id, by_member_id)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('photo','id_document')),
  owner_id TEXT NOT NULL REFERENCES members(id),
  content_type TEXT NOT NULL,
  bytes INT NOT NULL,
  object_key TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS id_documents (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  file_id TEXT NOT NULL REFERENCES files(id),
  state TEXT NOT NULL CHECK (state IN ('pending','approved','rejected')),
  reason TEXT,
  uploaded_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent')),
  attempts INT NOT NULL DEFAULT 0,
  last_attempt_at BIGINT,
  sent_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox (status);
CREATE INDEX IF NOT EXISTS outbox_created_idx ON outbox (created_at);
`;

export async function applySchema(db: pg.Pool): Promise<void> {
  await db.query(SCHEMA);
}
