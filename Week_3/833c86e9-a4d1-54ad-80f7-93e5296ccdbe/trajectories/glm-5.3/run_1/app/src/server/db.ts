import { Pool, type PoolClient } from "pg";

export type Db = Pool;

export function makeDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  pool.on("error", () => { /* keep serving; queries surface their own errors */ });
  return pool;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  username text PRIMARY KEY,
  password_hash text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  username text NOT NULL,
  lang text NOT NULL DEFAULT 'en',
  cur text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS visitors (
  id text PRIMARY KEY,
  lang text NOT NULL DEFAULT 'en',
  cur text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS visitor_bookings (
  visitor_id text NOT NULL,
  booking_id bigint NOT NULL,
  PRIMARY KEY (visitor_id, booking_id)
);
CREATE TABLE IF NOT EXISTS finder_bookings (
  visitor_id text NOT NULL,
  booking_id bigint NOT NULL,
  PRIMARY KEY (visitor_id, booking_id)
);
CREATE TABLE IF NOT EXISTS destinations (
  code text PRIMARY KEY,
  name text NOT NULL,
  zone text NOT NULL,
  cx double precision NOT NULL,
  cy double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS properties (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  destination text NOT NULL,
  name text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  stars int NOT NULL,
  amenities text[] NOT NULL DEFAULT '{}',
  vat_pct int NOT NULL,
  city_minor int NOT NULL,
  levy_pct int NOT NULL,
  breakfast_minor int NOT NULL,
  single_pct int NOT NULL,
  policy jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS room_types (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  property_id bigint NOT NULL REFERENCES properties(id),
  name text NOT NULL,
  included_adults int NOT NULL,
  max_adults int NOT NULL,
  max_guests int NOT NULL,
  extra_adult_minor int NOT NULL,
  child_minor int NOT NULL,
  base_rate_minor int NOT NULL,
  rooms int NOT NULL
);
CREATE TABLE IF NOT EXISTS nights (
  property_id bigint NOT NULL,
  room_type_id bigint NOT NULL,
  date date NOT NULL,
  rate_minor int NOT NULL,
  allotment int NOT NULL,
  min_stay int NOT NULL,
  max_stay int NOT NULL,
  closed_to_arrival boolean NOT NULL,
  closed_to_departure boolean NOT NULL,
  stop_sell boolean NOT NULL,
  release_days int NOT NULL,
  PRIMARY KEY (room_type_id, date)
);
CREATE TABLE IF NOT EXISTS seasons (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id bigint NOT NULL,
  name text NOT NULL,
  room_type_ids bigint[] NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  weekdays int[] NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id text PRIMARY KEY,
  visitor_id text NOT NULL,
  username text,
  property_id bigint NOT NULL,
  currency text NOT NULL,
  tier text NOT NULL,
  tier_pct int NOT NULL,
  rates_ppm jsonb NOT NULL,
  in_date date NOT NULL,
  out_date date NOT NULL,
  adults int NOT NULL,
  ages jsonb NOT NULL,
  rooms jsonb NOT NULL,
  total_minor bigint NOT NULL,
  taxable_minor bigint NOT NULL,
  nights jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  hold_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  quote_id text NOT NULL,
  visitor_id text NOT NULL,
  username text,
  property_id bigint NOT NULL,
  rooms jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  version int NOT NULL DEFAULT 1,
  state text NOT NULL,
  property_id bigint NOT NULL,
  in_date date NOT NULL,
  out_date date NOT NULL,
  given_name text NOT NULL,
  surname text NOT NULL,
  card_last4 text NOT NULL,
  quote_currency text NOT NULL,
  visitor_id text,
  username text,
  total_minor bigint NOT NULL,
  paid_minor bigint NOT NULL,
  refunded_minor bigint NOT NULL,
  nights jsonb NOT NULL,
  rooms jsonb NOT NULL,
  cancellation jsonb NOT NULL,
  review_token text,
  completion_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pair int NOT NULL,
  kind text NOT NULL,
  account text NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency (
  key text PRIMARY KEY,
  status int NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id bigint NOT NULL,
  booking_id bigint NOT NULL,
  cleanliness int NOT NULL,
  comfort int NOT NULL,
  location int NOT NULL,
  staff int NOT NULL,
  value int NOT NULL,
  comment text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS inbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text,
  visitor_id text,
  kind text NOT NULL,
  property text NOT NULL,
  link text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS currency (
  code text PRIMARY KEY,
  ppm bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  k text PRIMARY KEY,
  v text NOT NULL
);
CREATE TABLE IF NOT EXISTS manager_properties (
  username text NOT NULL,
  property_id bigint NOT NULL,
  PRIMARY KEY (username, property_id)
);
CREATE TABLE IF NOT EXISTS imports (
  sha256 text PRIMARY KEY,
  property_id bigint NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nights_property ON nights(property_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_property ON bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_ledger_booking ON ledger(id);
`;

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
}

export async function insertBaseSeed(db: Db): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const have = await c.query("SELECT count(*)::int AS n FROM properties");
    if (have.rows[0].n === 0) {
      await c.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await seedBase(c);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function seedBase(c: PoolClient): Promise<void> {
  await c.query(
    `INSERT INTO users (username, password_hash, role) VALUES
     ('founder', crypt($1, gen_salt('bf')), 'operator'),
     ('mara', crypt($2, gen_salt('bf')), 'manager'),
     ('tomas', crypt($3, gen_salt('bf')), 'manager'),
     ('ada', crypt($4, gen_salt('bf')), 'guest')`,
    ["kipwell-founder-01", "kipwell-mara-01", "kipwell-tomas-01", "kipwell-ada-01"]
  );
  await c.query(
    `INSERT INTO destinations (code, name, zone, cx, cy) VALUES
     ('harrowmere', 'Harrowmere Bay', 'Europe/Lisbon', 300.0, 400.0),
     ('vellicombe', 'Vellicombe Heights', 'Europe/Berlin', 650.0, 250.0),
     ('qasrayn', 'Qasr Ayn Oasis', 'Asia/Kuwait', 700.0, 750.0)`
  );
  const dests: Record<string, { vat: number; city: number; levy: number; policy: unknown[] }> = {
    harrowmere: { vat: 6, city: 200, levy: 10, policy: [{ days_before: 3, hour: 18, refund_pct: 100 }, { days_before: 1, hour: 18, refund_pct: 50 }] },
    vellicombe: { vat: 7, city: 300, levy: 10, policy: [{ days_before: 7, hour: 12, refund_pct: 100 }, { days_before: 2, hour: 12, refund_pct: 30 }] },
    qasrayn: { vat: 5, city: 400, levy: 5, policy: [{ days_before: 1, hour: 14, refund_pct: 100 }] }
  };
  interface P { code: string; name: string; dest: string; x: number; y: number; stars: number; amen: string[]; dbl: [number, number]; fam: [number, number]; bf: number; }
  const props: P[] = [
    { code: "HRB-QUAY", name: "Quayside Lantern House", dest: "harrowmere", x: 306, y: 404, stars: 4, amen: ["wifi", "parking"], dbl: [12000, 15000], fam: [18000, 21000], bf: 1200 },
    { code: "HRB-GULL", name: "The Gullrest Inn", dest: "harrowmere", x: 290, y: 395, stars: 3, amen: ["wifi", "pets"], dbl: [8500, 9900], fam: [13000, 15000], bf: 900 },
    { code: "HRB-NETT", name: "Netmender's Rooms", dest: "harrowmere", x: 312, y: 410, stars: 3, amen: ["wifi"], dbl: [7900, 8900], fam: [12500, 14000], bf: 800 },
    { code: "HRB-TIDE", name: "Tidewrack Hotel", dest: "harrowmere", x: 320, y: 380, stars: 5, amen: ["pool", "spa", "wifi", "parking"], dbl: [21000, 26000], fam: [30000, 36000], bf: 1800 },
    { code: "HRB-SALT", name: "Saltgrass Guesthouse", dest: "harrowmere", x: 280, y: 420, stars: 4, amen: ["wifi", "pets", "parking"], dbl: [11000, 12500], fam: [16500, 18500], bf: 1000 },
    { code: "HRB-BEAC", name: "Beaconfold Lodge", dest: "harrowmere", x: 340, y: 430, stars: 4, amen: ["pool", "wifi"], dbl: [13500, 16000], fam: [19500, 23000], bf: 1100 },
    { code: "HRB-OYST", name: "Oyster Lane Rooms", dest: "harrowmere", x: 296, y: 412, stars: 3, amen: ["wifi"], dbl: [7200, 8400], fam: [11500, 13000], bf: 800 },
    { code: "VLC-PINE", name: "Pinecrest Hall", dest: "vellicombe", x: 655, y: 245, stars: 4, amen: ["spa", "wifi", "parking"], dbl: [14000, 17000], fam: [20000, 24000], bf: 1300 },
    { code: "VLC-LARK", name: "Larkspur Chalet", dest: "vellicombe", x: 640, y: 262, stars: 3, amen: ["pets", "wifi"], dbl: [9000, 10500], fam: [14000, 16000], bf: 1000 },
    { code: "VLC-FERN", name: "Fernhollow House", dest: "vellicombe", x: 668, y: 238, stars: 5, amen: ["pool", "spa"], dbl: [24000, 29000], fam: [33000, 39000], bf: 2000 },
    { code: "QSA-PALM", name: "Palmshade Courtyard", dest: "qasrayn", x: 705, y: 748, stars: 4, amen: ["pool", "wifi"], dbl: [15000, 16500], fam: [22000, 24000], bf: 1200 },
    { code: "QSA-DUNE", name: "Dunewatch Rooms", dest: "qasrayn", x: 690, y: 760, stars: 3, amen: ["parking", "wifi"], dbl: [8000, 8800], fam: [12500, 13500], bf: 700 }
  ];
  for (const p of props) {
    const d = dests[p.dest];
    const r = await c.query(
      `INSERT INTO properties (code, destination, name, x, y, stars, amenities, vat_pct, city_minor, levy_pct, breakfast_minor, single_pct, policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,10,$12) RETURNING id`,
      [p.code, p.dest, p.name, p.x, p.y, p.stars, p.amen, d.vat, d.city, d.levy, p.bf, JSON.stringify(d.policy)]
    );
    const pid = r.rows[0].id;
    for (const [suffix, name, inc, ma, mg, base, rooms] of [
      ["DBL", "Double", 2, 2, 3, p.dbl, 5],
      ["FAM", "Family", 2, 4, 5, p.fam, 2]
    ] as [string, string, number, number, number, [number, number], number][]) {
      const rt = await c.query(
        `INSERT INTO room_types (code, property_id, name, included_adults, max_adults, max_guests, extra_adult_minor, child_minor, base_rate_minor, rooms)
         VALUES ($1,$2,$3,$4,$5,$6,2500,1500,$7,$8) RETURNING id`,
        [`${p.code}-${suffix}`, pid, name, inc, ma, mg, base[0], rooms]
      );
      await c.query(
        `INSERT INTO nights (property_id, room_type_id, date, rate_minor, allotment, min_stay, max_stay, closed_to_arrival, closed_to_departure, stop_sell, release_days)
         SELECT $1::bigint, $2::bigint, d::date,
           CASE WHEN EXTRACT(DOW FROM d) IN (5,6) THEN $4::int ELSE $3::int END,
           $5::int, 1, 30, false, false, false, 0
         FROM generate_series($6::date, $7::date, '1 day') AS d`,
        [pid, rt.rows[0].id, base[0], base[1], rooms, "2026-01-01", "2028-12-31"]
      );
    }
  }
  await c.query(
    `INSERT INTO currency (code, ppm) VALUES ('EUR',1000000),('USD',1080000),('JPY',161500000),('KWD',332000)
     ON CONFLICT (code) DO NOTHING`
  );
  await c.query(`INSERT INTO kv (k, v) VALUES ('clock_offset_ms', '0') ON CONFLICT (k) DO NOTHING`);
  // Link seeded managers to their properties.
  const links: [string, string][] = [["mara", "HRB-QUAY"], ["mara", "HRB-GULL"], ["tomas", "VLC-PINE"]];
  for (const [username, code] of links) {
    await c.query(
      `INSERT INTO manager_properties (username, property_id)
       SELECT $1, id FROM properties WHERE code = $2
       ON CONFLICT DO NOTHING`,
      [username, code]
    );
  }
}
