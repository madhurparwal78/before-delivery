import pg from "pg";
import { config } from "./config.js";
import { storeUnavailable } from "./http.js";

// Calendar dates stay `YYYY-MM-DD` strings; bigint counts come back as numbers.
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(20, (value) => Number(value));

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30_000,
});
pool.on("error", () => {
  // An idle client lost its connection; the next query reconnects or reports the outage.
});

let ready = false;

/** True once the schema exists in this process's database. */
export const dbReady = (): boolean => ready;

export type Row = Record<string, unknown>;
export type Client = pg.PoolClient;

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "EPIPE", "57P01"]);

/** A lost or refused connection, as opposed to an error in the SQL itself. */
function unavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  if (code !== undefined && NETWORK_CODES.has(code)) return true;
  return /Connection terminated|timeout exceeded when trying to connect|connection error|Connection refused/i.test(
    error.message,
  );
}

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!ready) throw storeUnavailable();
  try {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  } catch (error) {
    if (unavailable(error)) throw storeUnavailable();
    throw error;
  }
}

export async function one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

const commitHooks = new WeakMap<Client, (() => void)[]>();

/** Runs `hook` once the surrounding transaction has committed (never on rollback). */
export function afterCommit(client: Client, hook: () => void): void {
  commitHooks.get(client)?.push(hook);
}

/** Runs `work` in one transaction; connection failures become 503 store_unavailable. */
export async function tx<T>(work: (client: Client) => Promise<T>): Promise<T> {
  if (!ready) throw storeUnavailable();
  let client: Client;
  try {
    client = await pool.connect();
  } catch {
    throw storeUnavailable();
  }
  const hooks: (() => void)[] = [];
  commitHooks.set(client, hooks);
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    for (const hook of hooks) hook();
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (unavailable(error)) throw storeUnavailable();
    throw error;
  } finally {
    commitHooks.delete(client);
    client.release();
  }
}

export async function rows<T extends Row = Row>(client: Client, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await client.query<T>(sql, params)).rows;
}

export async function probeDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS flavours (
  slug text PRIMARY KEY,
  name text NOT NULL,
  position int NOT NULL,
  can_price_cents int NOT NULL CHECK (can_price_cents > 0),
  limited boolean NOT NULL,
  released int CHECK (released >= 0)
);
CREATE TABLE IF NOT EXISTS provinces (
  code text PRIMARY KEY,
  name text NOT NULL,
  position int NOT NULL,
  deposit_cents_per_can int NOT NULL,
  shipping_cents int NOT NULL,
  free_shipping_threshold_cents int NOT NULL,
  postal_letters text NOT NULL
);
CREATE TABLE IF NOT EXISTS province_taxes (
  province text NOT NULL REFERENCES provinces,
  position int NOT NULL,
  name text NOT NULL,
  rate_milli int NOT NULL,
  PRIMARY KEY (province, position)
);
CREATE TABLE IF NOT EXISTS ledger (
  id bigserial PRIMARY KEY,
  flavour text NOT NULL REFERENCES flavours,
  kind text NOT NULL CHECK (kind IN ('received', 'reserved', 'released', 'sold', 'returned')),
  quantity int NOT NULL CHECK (quantity > 0),
  at timestamptz NOT NULL DEFAULT now(),
  ref text
);
CREATE INDEX IF NOT EXISTS ledger_flavour ON ledger (flavour, kind);
CREATE TABLE IF NOT EXISTS crates (
  id uuid PRIMARY KEY,
  user_id text,
  province text NOT NULL REFERENCES provinces,
  subscribe boolean NOT NULL DEFAULT false,
  cadence text NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('monthly', 'bimonthly')),
  hold_status text NOT NULL DEFAULT 'none' CHECK (hold_status IN ('none', 'active', 'expired')),
  hold_expires_at timestamptz,
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crates_user ON crates (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crates_active_hold ON crates (hold_expires_at) WHERE hold_status = 'active';
CREATE TABLE IF NOT EXISTS crate_slots (
  crate_id uuid NOT NULL REFERENCES crates ON DELETE CASCADE,
  slot int NOT NULL CHECK (slot BETWEEN 0 AND 11),
  flavour text NOT NULL REFERENCES flavours,
  PRIMARY KEY (crate_id, slot)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'done')),
  response_status int,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 100001;
CREATE TABLE IF NOT EXISTS orders (
  number text PRIMARY KEY,
  user_id text NOT NULL,
  email text NOT NULL,
  customer_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('checkout', 'renewal')),
  status text NOT NULL CHECK (status IN ('pending_payment', 'paid', 'picking', 'packed', 'shipped', 'refunded')),
  refund_status text NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'partially_refunded', 'refunded')),
  placed_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  province text NOT NULL,
  subscribe boolean NOT NULL,
  subscription_id text,
  goods_cents int NOT NULL,
  discount_cents int NOT NULL,
  discounted_goods_cents int NOT NULL,
  shipping_cents int NOT NULL,
  deposit_cents int NOT NULL,
  total_cents int NOT NULL,
  threshold_cents int NOT NULL,
  ship_to jsonb NOT NULL,
  kb_payment_id text,
  renewal_invoice_id text UNIQUE,
  documents_stored boolean NOT NULL DEFAULT false,
  claimed_until timestamptz
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS orders_queue ON orders (paid_at) WHERE status IN ('paid', 'picking', 'packed');
CREATE TABLE IF NOT EXISTS order_lines (
  order_number text NOT NULL REFERENCES orders,
  position int NOT NULL,
  flavour text NOT NULL REFERENCES flavours,
  quantity int NOT NULL,
  unit_price_cents int NOT NULL,
  goods_cents int NOT NULL,
  discount_cents int NOT NULL,
  deposit_cents int NOT NULL,
  PRIMARY KEY (order_number, position)
);
CREATE TABLE IF NOT EXISTS order_taxes (
  order_number text NOT NULL REFERENCES orders,
  position int NOT NULL,
  name text NOT NULL,
  rate_milli int NOT NULL,
  cents int NOT NULL,
  PRIMARY KEY (order_number, position)
);
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY,
  order_number text NOT NULL REFERENCES orders,
  status text NOT NULL CHECK (status IN ('pending_provider', 'applied', 'rejected')),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  full_refund boolean NOT NULL,
  split jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  claimed_until timestamptz
);
CREATE INDEX IF NOT EXISTS refunds_order ON refunds (order_number, created_at);
CREATE TABLE IF NOT EXISTS kb_accounts (
  user_id text PRIMARY KEY,
  account_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  email text NOT NULL,
  customer_name text NOT NULL,
  account_id text NOT NULL,
  province text NOT NULL,
  ship_to jsonb NOT NULL,
  card_brand text NOT NULL,
  card_last4 text NOT NULL,
  card_exp_month int NOT NULL,
  card_exp_year int NOT NULL,
  card_behaviour text NOT NULL CHECK (card_behaviour IN ('approve', 'decline', 'first_only')),
  payment_method_id text NOT NULL,
  first_invoice_id text NOT NULL,
  ended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS change_requests (
  id uuid PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES subscriptions,
  kind text NOT NULL CHECK (kind IN ('pause', 'resume', 'skip', 'swap', 'cancel')),
  cycles int,
  plan text,
  status text NOT NULL CHECK (status IN ('pending_provider', 'applied', 'rejected')),
  effective_date date NOT NULL,
  written boolean NOT NULL DEFAULT false,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  claimed_until timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_change ON change_requests (subscription_id) WHERE status = 'pending_provider';
CREATE TABLE IF NOT EXISTS renewals (
  invoice_id text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES subscriptions,
  status text NOT NULL CHECK (status IN ('claimed', 'paid', 'failed')),
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dunning (
  id uuid PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES subscriptions,
  invoice_id text NOT NULL,
  failed_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'recovered', 'cancelled')),
  ended_by text CHECK (ended_by IN ('payment', 'schedule', 'customer')),
  step_day int NOT NULL DEFAULT 0,
  shipments_held boolean NOT NULL DEFAULT false,
  ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_dunning ON dunning (subscription_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS dunning_steps (
  dunning_id uuid NOT NULL REFERENCES dunning,
  day int NOT NULL,
  due_at timestamptz NOT NULL,
  done_at timestamptz,
  dropped boolean NOT NULL DEFAULT false,
  claimed_until timestamptz,
  PRIMARY KEY (dunning_id, day)
);
CREATE TABLE IF NOT EXISTS upcoming_notices (
  subscription_id text NOT NULL REFERENCES subscriptions,
  renewal_date date NOT NULL,
  PRIMARY KEY (subscription_id, renewal_date)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  claimed_until timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (created_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY,
  business_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  province text NOT NULL,
  status text NOT NULL CHECK (status IN ('submitted', 'approved', 'declined')),
  licence_key text NOT NULL,
  licence_type text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE TABLE IF NOT EXISTS leases (
  name text PRIMARY KEY,
  holder text NOT NULL,
  until timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS stockists (
  name text PRIMARY KEY,
  address text NOT NULL,
  city text NOT NULL,
  province text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL
);
`;

const FLAVOUR_SEED: [string, string, number, boolean, number, number | null][] = [
  ["guava-lime", "Guava & Lime", 333, false, 600, null],
  ["yuzu-ginger", "Yuzu Ginger", 333, false, 600, null],
  ["passionfruit-basil", "Passionfruit Basil", 333, false, 600, null],
  ["cacao-orange", "Cacao Orange", 375, true, 120, 48],
];

const PROVINCE_SEED: [string, string, number, number, number, string, [string, number][]][] = [
  ["AB", "Alberta", 10, 1495, 4500, "T", [["GST", 5000]]],
  ["BC", "British Columbia", 10, 1495, 4500, "V", [["GST", 5000], ["PST", 7000]]],
  ["NS", "Nova Scotia", 10, 1695, 5000, "B", [["HST", 14000]]],
  ["ON", "Ontario", 0, 1295, 3500, "KLMNP", [["HST", 13000]]],
  ["QC", "Quebec", 10, 1295, 3500, "GHJ", [["GST", 5000], ["QST", 9975]]],
];

const STOCKIST_SEED: [string, string, string, string, number, number][] = [
  ["Epicerie Feuille Verte", "210 avenue du Parc, Montreal QC", "Montreal", "QC", 45.5231, -73.5817],
  ["Marche du Fleuve", "15 rue du Quai, Quebec City QC", "Quebec City", "QC", 46.8123, -71.2145],
  ["Canopy Grocer", "300 Queen Street West, Toronto ON", "Toronto", "ON", 43.6532, -79.3832],
  ["Riverbend Pantry", "88 Bank Street, Ottawa ON", "Ottawa", "ON", 45.4215, -75.6972],
  ["Orchard Row Market", "1500 Barrington Street, Halifax NS", "Halifax", "NS", 44.6488, -63.5752],
  ["Night Sky Provisions", "120 Stephen Avenue, Calgary AB", "Calgary", "AB", 51.0447, -114.0719],
  ["Cedar & Salt", "455 Main Street, Vancouver BC", "Vancouver", "BC", 49.2827, -123.1207],
];

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(417301)");
    await client.query(SCHEMA);
    for (const [i, [slug, name, price, limited, received, released]] of FLAVOUR_SEED.entries()) {
      const inserted = await client.query(
        `INSERT INTO flavours (slug, name, position, can_price_cents, limited, released)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (slug) DO NOTHING`,
        [slug, name, i, price, limited, released],
      );
      if (inserted.rowCount === 1) {
        await client.query(`INSERT INTO ledger (flavour, kind, quantity, ref) VALUES ($1, 'received', $2, 'seed')`, [
          slug,
          received,
        ]);
      }
    }
    for (const [i, [code, name, deposit, shipping, threshold, letters, taxes]] of PROVINCE_SEED.entries()) {
      const inserted = await client.query(
        `INSERT INTO provinces (code, name, position, deposit_cents_per_can, shipping_cents, free_shipping_threshold_cents, postal_letters)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (code) DO NOTHING`,
        [code, name, i, deposit, shipping, threshold, letters],
      );
      if (inserted.rowCount === 1) {
        for (const [j, [taxName, rate]] of taxes.entries()) {
          await client.query(`INSERT INTO province_taxes (province, position, name, rate_milli) VALUES ($1, $2, $3, $4)`, [
            code,
            j,
            taxName,
            rate,
          ]);
        }
      }
    }
    for (const [name, address, city, province, lat, lng] of STOCKIST_SEED) {
      await client.query(
        `INSERT INTO stockists (name, address, city, province, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO NOTHING`,
        [name, address, city, province, lat, lng],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Creates the schema and seed rows, retrying in the background until Postgres answers. */
export async function startDb(onReady: () => void): Promise<void> {
  for (;;) {
    try {
      await migrate();
      ready = true;
      onReady();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
