// Schema and seed data, applied idempotently at every start under an advisory lock so copies can start together.
import { createHash } from "node:crypto";
import { HALL_SEATS } from "../shared/hall.js";
import { transaction, type Tx } from "./db.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS buyers (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS performances (
  id text PRIMARY KEY,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS tiers (
  performance_id text NOT NULL REFERENCES performances (id),
  id text NOT NULL,
  name text NOT NULL,
  face_cents integer NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (performance_id, id)
);
CREATE TABLE IF NOT EXISTS seats (
  performance_id text NOT NULL REFERENCES performances (id),
  id text NOT NULL,
  ordinal integer NOT NULL,
  tier_id text,
  state text NOT NULL,
  buyer_id text,
  order_id text,
  ticket_id text,
  offer_token text,
  PRIMARY KEY (performance_id, id)
);
CREATE INDEX IF NOT EXISTS seats_by_buyer ON seats (buyer_id, performance_id) WHERE buyer_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS carts (
  buyer_id text NOT NULL,
  performance_id text NOT NULL REFERENCES performances (id),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (buyer_id, performance_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  buyer_id text NOT NULL,
  performance_id text NOT NULL REFERENCES performances (id),
  name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL,
  face_cents integer NOT NULL,
  seat_fees_cents integer NOT NULL,
  order_fee_cents integer NOT NULL,
  total_cents integer NOT NULL,
  killbill_account_id text,
  charged_exchanges integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS orders_by_buyer ON orders (buyer_id, created_at);
CREATE TABLE IF NOT EXISTS tickets (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders (id),
  seat_id text NOT NULL,
  tier_id text NOT NULL,
  face_cents integer NOT NULL,
  seat_fee_cents integer NOT NULL,
  status text NOT NULL
);
CREATE INDEX IF NOT EXISTS tickets_by_order ON tickets (order_id);
CREATE TABLE IF NOT EXISTS payments (
  killbill_payment_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders (id),
  external_key text NOT NULL,
  amount_cents integer NOT NULL,
  refunded_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id text PRIMARY KEY,
  seq bigserial,
  performance_id text NOT NULL REFERENCES performances (id),
  tier_id text NOT NULL,
  buyer_id text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_active_entry
  ON waitlist_entries (performance_id, tier_id, lower(email)) WHERE status IN ('waiting', 'offered');
CREATE TABLE IF NOT EXISTS offers (
  token text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES waitlist_entries (id),
  performance_id text NOT NULL REFERENCES performances (id),
  seat_id text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepting_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  order_id text,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS owner_passcode (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  sha256 text NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_sessions (
  token text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS killbill_accounts (
  external_key text PRIMARY KEY,
  account_id text NOT NULL
);
`;

const OWNER_PASSCODE = "brass-rail-1897";

interface SeedTier {
  id: string;
  name: string;
  faceCents: number;
  rows?: string[];
  seats?: string[];
}

const rowRange = (section: string, first: string, last: string): string[] =>
  Array.from({ length: last.charCodeAt(0) - first.charCodeAt(0) + 1 }, (_, i) =>
    `${section}-${String.fromCharCode(first.charCodeAt(0) + i)}`);

const STANDARD_TIERS: SeedTier[] = [
  { id: "a-reserve", name: "A Reserve", faceCents: 6800, rows: rowRange("ST", "A", "H") },
  { id: "b-reserve", name: "B Reserve", faceCents: 4500, rows: [...rowRange("ST", "I", "P"), ...rowRange("CI", "A", "D")] },
  { id: "c-reserve", name: "C Reserve", faceCents: 2900, rows: [...rowRange("CI", "E", "H"), ...rowRange("BA", "A", "F")] },
];

const SEED: { id: string; title: string; startsAt: string; tiers: SeedTier[] }[] = [
  { id: "lantern-and-tide", title: "Lantern & Tide", startsAt: "2027-02-13T02:00:00Z", tiers: STANDARD_TIERS },
  { id: "ostrava-strings", title: "Ostrava Strings", startsAt: "2027-03-15T00:30:00Z", tiers: STANDARD_TIERS },
  {
    id: "fen-and-lark",
    title: "Fen & Lark",
    startsAt: "2027-05-22T02:00:00Z",
    tiers: [
      { id: "front-pair", name: "Front Pair", faceCents: 9500, seats: ["ST-A-15", "ST-A-16"] },
      { id: "stalls", name: "Stalls", faceCents: 4500, rows: rowRange("ST", "B", "P") },
    ],
  },
  { id: "marrow-quartet-late-set", title: "Marrow Quartet: The Late Set", startsAt: "2027-11-07T06:30:00Z", tiers: STANDARD_TIERS },
];

export interface NewTier {
  id: string;
  name: string;
  faceCents: number;
  seatIds: Set<string>;
}

/** Inserts a performance with its tiers and all 900 seats; seats outside every tier are not on sale. */
export async function insertPerformance(tx: Tx, id: string, title: string, startsAt: Date, tiers: NewTier[]): Promise<boolean> {
  const inserted = await tx.query(
    "INSERT INTO performances (id, title, starts_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [id, title, startsAt],
  );
  if (inserted.rowCount === 0) return false;
  for (const [position, tier] of tiers.entries()) {
    await tx.query("INSERT INTO tiers (performance_id, id, name, face_cents, position) VALUES ($1, $2, $3, $4, $5)",
      [id, tier.id, tier.name, tier.faceCents, position]);
  }
  const tierOf = (seatId: string): string | null => tiers.find((t) => t.seatIds.has(seatId))?.id ?? null;
  await tx.query(
    `INSERT INTO seats (performance_id, id, ordinal, tier_id, state)
     SELECT $1, s.id, s.ordinal, s.tier_id, CASE WHEN s.tier_id IS NULL THEN 'not_on_sale' ELSE 'on_sale' END
     FROM unnest($2::text[], $3::int[], $4::text[]) AS s (id, ordinal, tier_id)`,
    [id, HALL_SEATS.map((s) => s.id), HALL_SEATS.map((s) => s.ordinal), HALL_SEATS.map((s) => tierOf(s.id))],
  );
  return true;
}

export function tierSeatIds(rows: readonly string[], seats: readonly string[]): Set<string> {
  const wanted = new Set(rows);
  return new Set([...HALL_SEATS.filter((s) => wanted.has(`${s.section}-${s.row}`)).map((s) => s.id), ...seats]);
}

export function passcodeDigest(passcode: string): string {
  return createHash("sha256").update(passcode).digest("hex");
}

export async function migrate(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(4173001)");
    await tx.query(SCHEMA);
    await tx.query("INSERT INTO owner_passcode (sha256) VALUES ($1) ON CONFLICT (singleton) DO NOTHING",
      [passcodeDigest(OWNER_PASSCODE)]);
    for (const show of SEED) {
      await insertPerformance(tx, show.id, show.title, new Date(show.startsAt), show.tiers.map((t) => ({
        id: t.id, name: t.name, faceCents: t.faceCents, seatIds: tierSeatIds(t.rows ?? [], t.seats ?? []),
      })));
    }
  });
}
