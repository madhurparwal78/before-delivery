// PostgreSQL: the system of record. Schema and seed are applied on every serve, under an advisory lock so
// several instances starting together against one database apply them once.

import pg from "pg";
import { config } from "./config.js";
import { hashPassword } from "./passwords.js";

pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));

export type Db = pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool:", error.message));

let ready = false;

export function isReady(): boolean {
  return ready;
}

/** Registers how to reverse an effect outside PostgreSQL (a stored object, an invoice) if the transaction fails. */
type Undo = (reverse: () => Promise<unknown>) => void;

/** One transaction; on any failure, including COMMIT, it rolls back and reverses the registered outside effects. */
export async function tx<T>(work: (db: Db, undo: Undo) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const reversals: (() => Promise<unknown>)[] = [];
  try {
    await client.query("BEGIN");
    const result = await work(client, (reverse) => reversals.unshift(reverse));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    for (const reverse of reversals) await reverse().catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rows<T>(db: Db | pg.Pool, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Db | pg.Pool, sql: string, params: unknown[] = []): Promise<T | null> {
  return ((await db.query(sql, params)).rows[0] as T | undefined) ?? null;
}

export async function audit(db: Db, actor: string, action: string, entity: string, entityId: string, detail: object = {}): Promise<void> {
  await db.query("INSERT INTO audit (actor, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5)", [
    actor,
    action,
    entity,
    entityId,
    JSON.stringify(detail),
  ]);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('broker', 'beekeeper', 'grower')),
  name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  kb_account_id text
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rule_sets (
  id text PRIMARY KEY,
  name text NOT NULL,
  effective_from date NOT NULL UNIQUE,
  reduced_tenths integer NOT NULL,
  standard_tenths integer NOT NULL,
  bonus_tenths integer NOT NULL,
  price_none_cents integer NOT NULL,
  price_reduced_cents integer NOT NULL,
  price_standard_cents integer NOT NULL,
  price_bonus_cents integer NOT NULL,
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  deposit_per_hive_cents integer NOT NULL
);
CREATE TABLE IF NOT EXISTS orchards (
  id text PRIMARY KEY,
  grower_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  county text NOT NULL,
  seq bigserial NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
  id text PRIMARY KEY,
  orchard_id text NOT NULL REFERENCES orchards(id),
  name text NOT NULL,
  acres_tenths integer NOT NULL CHECK (acres_tenths BETWEEN 10 AND 5000),
  position integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS blocks_unique_name ON blocks (orchard_id, lower(name));
CREATE SEQUENCE IF NOT EXISTS order_ref_seq START 1001;
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  orchard_id text NOT NULL REFERENCES orchards(id),
  rule_set_id text NOT NULL REFERENCES rule_sets(id),
  status text NOT NULL CHECK (status IN ('draft', 'open', 'filled', 'placed', 'inspected', 'settled', 'cancelled')),
  bloom_start date NOT NULL,
  bloom_end date NOT NULL,
  delivery_deadline date NOT NULL,
  deposit_invoice_id text,
  balance_invoice_id text,
  report_key text,
  inspector_name text,
  signed_at timestamptz,
  seq bigserial NOT NULL
);
CREATE TABLE IF NOT EXISTS order_blocks (
  order_id text NOT NULL REFERENCES orders(id),
  block_id text NOT NULL REFERENCES blocks(id),
  hives integer NOT NULL CHECK (hives BETWEEN 1 AND 2000),
  position integer NOT NULL,
  PRIMARY KEY (order_id, block_id)
);
CREATE TABLE IF NOT EXISTS drops (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  beekeeper_id text NOT NULL REFERENCES users(id),
  yard_name text NOT NULL,
  hives integer NOT NULL CHECK (hives BETWEEN 1 AND 1000),
  status text NOT NULL CHECK (status IN ('committed', 'delivered', 'inspected', 'disputed', 'accepted')),
  block_id text REFERENCES blocks(id),
  delivered_at timestamptz,
  delivered_on date,
  dispute_reason text,
  resolution_note text,
  seq bigserial NOT NULL
);
CREATE INDEX IF NOT EXISTS drops_order ON drops (order_id);
CREATE TABLE IF NOT EXISTS samples (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  block_id text NOT NULL REFERENCES blocks(id),
  drop_id text NOT NULL REFERENCES drops(id),
  colony_label text NOT NULL,
  frames_tenths integer NOT NULL CHECK (frames_tenths BETWEEN 0 AND 200),
  seq bigserial NOT NULL,
  UNIQUE (order_id, block_id, colony_label)
);
CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  sample_id text NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  order_id text NOT NULL REFERENCES orders(id),
  object_key text NOT NULL,
  content_type text NOT NULL,
  seq bigserial NOT NULL
);
CREATE TABLE IF NOT EXISTS inspection_links (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  token_hash text NOT NULL UNIQUE,
  inspector_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('issued', 'used', 'signed', 'expired')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  seq bigserial NOT NULL
);
CREATE TABLE IF NOT EXISTS file_links (
  token_hash text PRIMARY KEY,
  object_key text NOT NULL,
  content_type text NOT NULL,
  filename text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS settlements (
  order_id text PRIMARY KEY REFERENCES orders(id),
  status text NOT NULL CHECK (status IN ('queued', 'settled')),
  payment_received_on date NOT NULL,
  payable_cents bigint NOT NULL,
  commission_bps integer NOT NULL,
  commission_cents bigint NOT NULL,
  shares jsonb NOT NULL,
  kb_payment_id text,
  settled_at timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  detail jsonb NOT NULL
);
`;

const SEED_PASSWORD = "bloom-desk-2027";

const USERS: [string, string, string, string, string][] = [
  ["usr_broker", "broker", "Dana Okafor", "Dana Okafor", "dana@kettleman-pollination.example"],
  ["bk_coulee", "beekeeper", "Coulee Gold Bees", "Sam Delacroix", "sam@couleegold.example"],
  ["bk_prairie", "beekeeper", "Prairie Lantern Honey", "Ruth Ammons", "ruth@prairielantern.example"],
  ["bk_ridge", "beekeeper", "Ridgeback Apiaries", "Teo Lindqvist", "teo@ridgeback-apiaries.example"],
  ["grw_harlan", "grower", "Harlan Ridge Almonds", "Priya Harlan", "priya@harlanridge.example"],
  ["grw_mendota", "grower", "Mendota Flats Orchards", "Luis Arreola", "luis@mendotaflats.example"],
];

const ORCHARDS: [string, string, string, string, [string, string, number][]][] = [
  ["orc_harlan_north", "Harlan North Ranch", "Madera", "grw_harlan", [["blk_hn_1", "Block 1", 200], ["blk_hn_2", "Block 2", 250], ["blk_hn_3", "Block 3", 150], ["blk_hn_4", "Block 4", 300]]],
  ["orc_harlan_south", "Harlan South Ranch", "Madera", "grw_harlan", [["blk_hs_1", "Block 1", 400], ["blk_hs_2", "Block 2", 400], ["blk_hs_3", "Block 3", 400]]],
  ["orc_mendota_west", "Mendota Flats West", "Fresno", "grw_mendota", [["blk_mw_a", "Block A", 180], ["blk_mw_b", "Block B", 220]]],
];

const ORDERS: [string, string, string, string, string, string, string, string, [string, number][]][] = [
  ["ord_hn27", "HN-2027", "orc_harlan_north", "open", "2027-02-08", "2027-03-01", "2027-02-05", "rs_2027", [["blk_hn_1", 40], ["blk_hn_2", 50], ["blk_hn_3", 30], ["blk_hn_4", 60]]],
  ["ord_hs27", "HS-2027", "orc_harlan_south", "open", "2027-02-10", "2027-03-03", "2027-02-06", "rs_2027", [["blk_hs_1", 80], ["blk_hs_2", 80], ["blk_hs_3", 80]]],
  ["ord_mw26", "MW-2026", "orc_mendota_west", "placed", "2026-02-12", "2026-03-04", "2026-02-09", "rs_2026", [["blk_mw_a", 36], ["blk_mw_b", 44]]],
];

// Seeded deliveries carry no clock time in the brief; noon Pacific keeps the stated delivered_on date.
const DROPS: [string, string, string, string, number, string, string | null, string | null][] = [
  ["drp_r1", "ord_hn27", "bk_ridge", "Bitterroot Yard", 40, "committed", null, null],
  ["drp_p1", "ord_mw26", "bk_prairie", "Sheyenne Yard", 36, "delivered", "blk_mw_a", "2026-02-07"],
  ["drp_c1", "ord_mw26", "bk_coulee", "Snake River Yard", 44, "delivered", "blk_mw_b", "2026-02-08"],
];

async function seed(db: Db): Promise<void> {
  const existing = await one<{ count: number }>(db, "SELECT count(*)::int AS count FROM users");
  if (existing && existing.count > 0) return;
  for (const [id, role, name, contact, email] of USERS) {
    await db.query("INSERT INTO users (id, role, name, contact_name, email, password_hash) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      role,
      name,
      contact,
      email,
      await hashPassword(SEED_PASSWORD),
    ]);
  }
  await db.query(
    `INSERT INTO rule_sets VALUES
      ('rs_2026', '2026 season', '2025-11-01', 60, 80, 100, 0, 13950, 19950, 21995, 1250, 5000),
      ('rs_2027', '2027 season', '2026-11-01', 60, 80, 100, 0, 14875, 21450, 23995, 1175, 6000)`,
  );
  for (const [id, name, county, grower, blocks] of ORCHARDS) {
    await db.query("INSERT INTO orchards (id, grower_id, name, county) VALUES ($1, $2, $3, $4)", [id, grower, name, county]);
    for (const [index, [blockId, blockName, acres]] of blocks.entries()) {
      await db.query("INSERT INTO blocks (id, orchard_id, name, acres_tenths, position) VALUES ($1, $2, $3, $4, $5)", [blockId, id, blockName, acres, index]);
    }
  }
  for (const [id, ref, orchard, status, start, end, deadline, rule, blocks] of ORDERS) {
    await db.query(
      "INSERT INTO orders (id, ref, orchard_id, rule_set_id, status, bloom_start, bloom_end, delivery_deadline) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, ref, orchard, rule, status, start, end, deadline],
    );
    for (const [index, [blockId, hives]] of blocks.entries()) {
      await db.query("INSERT INTO order_blocks (order_id, block_id, hives, position) VALUES ($1, $2, $3, $4)", [id, blockId, hives, index]);
    }
  }
  for (const [id, order, beekeeper, yard, hives, status, block, deliveredOn] of DROPS) {
    await db.query(
      `INSERT INTO drops (id, order_id, beekeeper_id, yard_name, hives, status, block_id, delivered_on, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, ($8::date + time '12:00') AT TIME ZONE 'America/Los_Angeles')`,
      [id, order, beekeeper, yard, hives, status, block, deliveredOn],
    );
  }
  await audit(db, "system", "seed", "database", "seed");
}

async function migrateAndSeed(): Promise<void> {
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(727027)");
    await db.query(SCHEMA);
    await seed(db);
  });
}

/** Retries the connection until PostgreSQL answers, then applies schema and seed. */
export async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      await migrateAndSeed();
      ready = true;
      return;
    } catch (error) {
      console.error("waiting for postgres:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
