import type { PoolClient } from 'pg';
import { pool } from './db.js';
import type { MovementReason } from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS staff (
  role text PRIMARY KEY CHECK (role IN ('owner','prep_tech')),
  passcode text NOT NULL
);

CREATE TABLE IF NOT EXISTS kits (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS unit_classes (
  id text PRIMARY KEY,
  kit_id text NOT NULL REFERENCES kits(id),
  name text NOT NULL,
  replacement_value_cents bigint NOT NULL CHECK (replacement_value_cents > 0),
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS serial_units (
  serial text PRIMARY KEY,
  class_id text NOT NULL REFERENCES unit_classes(id)
);

CREATE TABLE IF NOT EXISTS rate_cards (
  version integer PRIMARY KEY,
  effective_date date NOT NULL,
  published_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rates (
  kit_id text NOT NULL REFERENCES kits(id),
  version integer NOT NULL REFERENCES rate_cards(version),
  day_rate_cents bigint NOT NULL CHECK (day_rate_cents > 0),
  deposit_cents bigint NOT NULL CHECK (deposit_cents > 0),
  PRIMARY KEY (kit_id, version)
);

CREATE TABLE IF NOT EXISTS bookings (
  ref text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('quote','expired','confirmed','cancelled','prepped','out','returned','closed')),
  kit_id text NOT NULL REFERENCES kits(id),
  pickup_date date NOT NULL,
  return_date date NOT NULL,
  hire_days integer NOT NULL,
  billable_days integer NOT NULL,
  day_rate_cents bigint NOT NULL,
  hire_price_cents bigint NOT NULL,
  deposit_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  rate_card_version integer NOT NULL REFERENCES rate_cards(version),
  renter_name text NOT NULL,
  renter_email text NOT NULL,
  renter_key text NOT NULL,
  hold_expires_at timestamptz NOT NULL,
  payment_status text NOT NULL CHECK (payment_status IN ('none','pending','paid','failed','refunded')),
  damage_cents bigint NOT NULL DEFAULT 0,
  refund_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  closed_at timestamptz,
  confirmation_mail_at timestamptz,
  receipt_mail_at timestamptz,
  confirm_claimed_at timestamptz
);

CREATE TABLE IF NOT EXISTS booking_units (
  ref text NOT NULL REFERENCES bookings(ref) ON DELETE CASCADE,
  serial text NOT NULL REFERENCES serial_units(serial),
  class_id text NOT NULL REFERENCES unit_classes(id),
  checked_out_at timestamptz,
  checked_in_at timestamptz,
  condition text CHECK (condition IN ('ok','damaged')),
  damage_charge_cents bigint NOT NULL DEFAULT 0 CHECK (damage_charge_cents >= 0),
  checkout_notes text NOT NULL DEFAULT '',
  checkin_notes text NOT NULL DEFAULT '',
  PRIMARY KEY (ref, serial)
);

CREATE TABLE IF NOT EXISTS certificates (
  id text PRIMARY KEY,
  ref text NOT NULL REFERENCES bookings(ref) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending_review','approved','rejected')),
  uploaded_at timestamptz NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  coverage_start date,
  coverage_end date,
  limit_cents bigint,
  loss_payee_named boolean,
  reason text,
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  ref text NOT NULL REFERENCES bookings(ref) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('checkout','checkin')),
  serial text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','stored','failed')),
  storage_key text,
  uploaded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  serial text NOT NULL REFERENCES serial_units(serial),
  reason text NOT NULL CHECK (reason IN ('opening','checkout','checkin','to_repair','from_repair')),
  from_location text NOT NULL,
  to_location text NOT NULL,
  booking_ref text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movement_entries (
  movement_id bigint NOT NULL REFERENCES movements(id),
  location text NOT NULL,
  delta integer NOT NULL CHECK (delta IN (-1, 1)),
  PRIMARY KEY (movement_id, location)
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirm_claimed_at timestamptz;

CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  endpoint text NOT NULL,
  path text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response_body bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint, key)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('owner','prep_tech')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS booking_ref_seq;

CREATE INDEX IF NOT EXISTS idx_bookings_state ON bookings(state);
CREATE INDEX IF NOT EXISTS idx_bookings_pickup ON bookings(pickup_date, ref);
CREATE INDEX IF NOT EXISTS idx_booking_units_serial ON booking_units(serial);
CREATE INDEX IF NOT EXISTS idx_certificates_ref ON certificates(ref, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_ref ON photos(ref, phase);
CREATE INDEX IF NOT EXISTS idx_movements_serial ON movements(serial, at);
`;

const SEED = `
INSERT INTO staff (role, passcode) VALUES
  ('owner', 'northbar-owner-4417'),
  ('prep_tech', 'northbar-prep-2093')
ON CONFLICT (role) DO NOTHING;

INSERT INTO kits (id, name, category, position) VALUES
  ('kestrel-lf', 'Kestrel LF Camera Package', 'Camera', 1),
  ('wren-s35', 'Wren S35 Documentary Kit', 'Camera', 2),
  ('lantern-led', 'Lantern 4-Light LED Package', 'Lighting', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO unit_classes (id, kit_id, name, replacement_value_cents, position) VALUES
  ('kestrel-lf-body', 'kestrel-lf', 'Kestrel LF body', 4800000, 1),
  ('halden-primes', 'kestrel-lf', 'Halden Prime Set', 3200000, 2),
  ('field-monitor', 'kestrel-lf', 'Field monitor and power kit', 350000, 3),
  ('wren-s35-body', 'wren-s35', 'Wren S35 body', 1400000, 1),
  ('tor-zoom', 'wren-s35', 'Tor 18-80 zoom', 900000, 2),
  ('lantern-panels', 'lantern-led', 'Lantern panel set', 720000, 1),
  ('stand-grip-case', 'lantern-led', 'Stand and grip case', 130000, 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO serial_units (serial, class_id) VALUES
  ('KLF-001', 'kestrel-lf-body'),
  ('KLF-002', 'kestrel-lf-body'),
  ('HPS-01', 'halden-primes'),
  ('HPS-02', 'halden-primes'),
  ('HPS-03', 'halden-primes'),
  ('FMP-01', 'field-monitor'),
  ('FMP-02', 'field-monitor'),
  ('FMP-03', 'field-monitor'),
  ('WS35-01', 'wren-s35-body'),
  ('TZ-01', 'tor-zoom'),
  ('TZ-02', 'tor-zoom'),
  ('LP-01', 'lantern-panels'),
  ('LP-02', 'lantern-panels'),
  ('SG-01', 'stand-grip-case'),
  ('SG-02', 'stand-grip-case'),
  ('SG-03', 'stand-grip-case')
ON CONFLICT (serial) DO NOTHING;
`;

interface RateCardSeed {
  version: number;
  effectiveDate: string;
  rates: ReadonlyArray<readonly [kitId: string, dayRate: number, deposit: number]>;
}

const RATE_CARDS: ReadonlyArray<RateCardSeed> = [
  {
    version: 1,
    effectiveDate: '2026-01-01',
    rates: [
      ['kestrel-lf', 65000, 250000],
      ['wren-s35', 28000, 100000],
      ['lantern-led', 18000, 50000],
    ],
  },
];

interface OpeningMovement {
  serial: string;
  toRepair: boolean;
}

const OPENING: ReadonlyArray<OpeningMovement> = [
  { serial: 'KLF-001', toRepair: false },
  { serial: 'KLF-002', toRepair: false },
  { serial: 'HPS-01', toRepair: false },
  { serial: 'HPS-02', toRepair: false },
  { serial: 'HPS-03', toRepair: false },
  { serial: 'FMP-01', toRepair: false },
  { serial: 'FMP-02', toRepair: false },
  { serial: 'FMP-03', toRepair: false },
  { serial: 'WS35-01', toRepair: false },
  { serial: 'TZ-01', toRepair: false },
  { serial: 'TZ-02', toRepair: false },
  { serial: 'LP-01', toRepair: false },
  { serial: 'LP-02', toRepair: false },
  { serial: 'SG-01', toRepair: false },
  { serial: 'SG-02', toRepair: false },
  { serial: 'SG-03', toRepair: true },
];

export async function applySchema(): Promise<void> {
  await withRetry(async (client) => {
    await client.query(SCHEMA);
    await client.query(SEED);
    for (const card of RATE_CARDS) {
      await client.query(
        'INSERT INTO rate_cards (version, effective_date, published_at) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING',
        [card.version, card.effectiveDate, '2026-01-01T00:00:00Z'],
      );
      for (const [kitId, dayRate, deposit] of card.rates) {
        await client.query(
          'INSERT INTO rates (kit_id, version, day_rate_cents, deposit_cents) VALUES ($1, $2, $3, $4) ON CONFLICT (kit_id, version) DO NOTHING',
          [kitId, card.version, dayRate, deposit],
        );
      }
    }
    for (const opening of OPENING) {
      const existing = await client.query(
        'SELECT 1 FROM movements WHERE serial = $1 AND reason = $2 LIMIT 1',
        [opening.serial, 'opening'],
      );
      if (existing.rowCount === 0) {
        await insertMovement(client, opening.serial, 'opening', 'acquired', 'shelf', null);
      }
      if (opening.toRepair) {
        const repaired = await client.query(
          'SELECT 1 FROM movements WHERE serial = $1 AND reason = $2 LIMIT 1',
          [opening.serial, 'to_repair'],
        );
        if (repaired.rowCount === 0) {
          await insertMovement(client, opening.serial, 'to_repair', 'shelf', 'repair', null);
        }
      }
    }
  });
}


export async function insertMovement(
  client: PoolClient,
  serial: string,
  reason: MovementReason,
  fromLocation: string,
  toLocation: string,
  bookingRef: string | null,
): Promise<void> {
  const movement = await client.query<{ id: string }>(
    'INSERT INTO movements (serial, reason, from_location, to_location, booking_ref) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [serial, reason, fromLocation, toLocation, bookingRef],
  );
  const movementId = movement.rows[0].id;
  await client.query(
    'INSERT INTO movement_entries (movement_id, location, delta) VALUES ($1, $2, $3), ($1, $4, $5)',
    [movementId, fromLocation, -1, toLocation, 1],
  );
}

async function withRetry(fn: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize concurrent seed application across instances.
    await client.query("SELECT pg_advisory_xact_lock(930119)");
    await fn(client);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already broken
    }
    client.release();
    throw error;
  }
  client.release();
}
