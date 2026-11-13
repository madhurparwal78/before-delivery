// Postgres holds every record and all shared state. The schema applies on
// every start, safely repeated. Seed data loads only when the catalogue is empty.
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { createHash } from 'node:crypto';
import type { DeskConfig } from './config.js';

function hashPassword(password: string): string {
  return createHash('sha256').update(`holmgarth:${password}`).digest('hex');
}

export interface SchemaDeps {
  pool: Pool;
  config: DeskConfig;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS claims (
  reference text PRIMARY KEY,
  state text NOT NULL DEFAULT 'started',
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  erased_at timestamptz,
  owner_name text,
  owner_email text,
  owner_postcode text,
  postcode_area text,
  purchase_date date,
  club_member boolean NOT NULL DEFAULT false,
  model_slug text,
  booklet_number int,
  quantity int,
  description text,
  language text NOT NULL DEFAULT 'en-GB',
  confirm_token text,
  confirm_by timestamptz,
  confirm_used_at timestamptz,
  dispatched_at timestamptz,
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS claims_owner_email_idx ON claims (owner_email);

CREATE TABLE IF NOT EXISTS claim_history (
  id bigserial PRIMARY KEY,
  reference text NOT NULL,
  state text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_history_ref_idx ON claim_history (reference, id);

CREATE TABLE IF NOT EXISTS claim_photos (
  reference text NOT NULL,
  index int NOT NULL,
  content_type text NOT NULL,
  bytes int NOT NULL,
  PRIMARY KEY (reference, index)
);

CREATE TABLE IF NOT EXISTS models (
  slug text PRIMARY KEY,
  name text NOT NULL,
  axis text,
  display_order int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS model_retired_names (
  slug text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (slug, name)
);
CREATE TABLE IF NOT EXISTS parts (
  model_slug text NOT NULL,
  booklet_number int NOT NULL,
  part_number text NOT NULL,
  name text NOT NULL,
  price_minor int NOT NULL,
  weight_g int NOT NULL,
  longest_side_mm int NOT NULL,
  bin_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  PRIMARY KEY (model_slug, booklet_number)
);
CREATE TABLE IF NOT EXISTS editions (
  code text PRIMARY KEY,
  title text NOT NULL,
  starts_on date NOT NULL UNIQUE,
  standard_months int NOT NULL,
  club_months int NOT NULL,
  owner_contribution_percent int NOT NULL
);
CREATE TABLE IF NOT EXISTS club_roster (
  email text PRIMARY KEY,
  joined_on date NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_holidays (
  date date PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS operator_account (
  email text PRIMARY KEY,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS rulings (
  reference text PRIMARY KEY,
  inside boolean NOT NULL,
  edition_code text NOT NULL,
  cover_ends_at timestamptz NOT NULL,
  cover_ends_on date NOT NULL,
  term_months int,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_revisions (
  reference text NOT NULL,
  revision int NOT NULL,
  status text NOT NULL DEFAULT 'current',
  source text NOT NULL,
  part_line_minor int NOT NULL,
  carriage_minor int NOT NULL,
  total_minor int NOT NULL,
  band text NOT NULL,
  carriage_valid_until timestamptz,
  promise_kind text NOT NULL,
  promise_date date NOT NULL,
  killbill_invoice_id text,
  killbill_invoice_number text,
  bin_returned boolean NOT NULL DEFAULT false,
  quoted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reference, revision)
);

CREATE TABLE IF NOT EXISTS payments (
  reference text PRIMARY KEY,
  paid_minor int NOT NULL,
  killbill_payment_id text,
  paid_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS declines (
  reference text PRIMARY KEY,
  reason text NOT NULL,
  charged_minor int NOT NULL,
  refunded_minor int NOT NULL,
  declined_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispatch_notes (
  reference text PRIMARY KEY,
  stored_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS share_tokens (
  token text PRIMARY KEY,
  reference text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS share_tokens_ref_idx ON share_tokens (reference);

CREATE TABLE IF NOT EXISTS idempotency_records (
  key text NOT NULL,
  reference text NOT NULL,
  action text NOT NULL,
  body_hash text NOT NULL,
  status int NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reference, key)
);

CREATE TABLE IF NOT EXISTS reference_locks (
  reference text PRIMARY KEY,
  wrong_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  first_try_at timestamptz
);

CREATE TABLE IF NOT EXISTS rate_windows (
  caller text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (caller, window_start)
);

CREATE TABLE IF NOT EXISTS notice_queue (
  id bigserial PRIMARY KEY,
  reference text NOT NULL,
  kind text NOT NULL,
  payload text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS decided_counts (
  id int PRIMARY KEY DEFAULT 1,
  decided_claims int NOT NULL DEFAULT 0,
  decided_inside int NOT NULL DEFAULT 0,
  decided_outside int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS import_reports (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created int NOT NULL,
  updated int NOT NULL,
  unchanged int NOT NULL,
  unmatched text NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_ready (
  id int PRIMARY KEY DEFAULT 1,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

const SEED_MODELS: ReadonlyArray<{
  slug: string; name: string; axis: string | null; order: number;
  retired: readonly string[];
  parts: ReadonlyArray<{ n: number; pn: string; name: string; price: number; weight: number; side: number; bin: number; status?: string }>;
}> = [
  {
    slug: 'aldra-wardrobe', name: 'Aldra Wardrobe', axis: 'y', order: 1,
    retired: ['Aldra Robe', 'Aldra 2-Door', 'Holm Classic'],
    parts: [
      { n: 1, pn: '40218831', name: 'Side panel', price: 4800, weight: 14200, side: 1990, bin: 0 },
      { n: 2, pn: '40218848', name: 'Top panel', price: 3600, weight: 6800, side: 980, bin: 0 },
      { n: 3, pn: '102944', name: 'Shelf', price: 1450, weight: 2100, side: 940, bin: 3 },
      { n: 4, pn: '118320', name: 'Hanging rail', price: 950, weight: 600, side: 900, bin: 6 },
      { n: 5, pn: '100823', name: 'Cam lock', price: 45, weight: 12, side: 15, bin: 400 },
      { n: 6, pn: '100824', name: 'Cam bolt', price: 35, weight: 9, side: 34, bin: 400 },
    ],
  },
  {
    slug: 'bramwell-sofa-frame', name: 'Bramwell Sofa Frame', axis: 'x', order: 2,
    retired: ['Bramwell 3-Seater', 'Holm Classic'],
    parts: [
      { n: 1, pn: '50331207', name: 'Back rail', price: 2250, weight: 3100, side: 1820, bin: 0 },
      { n: 2, pn: '503319', name: 'Seat slat', price: 690, weight: 700, side: 760, bin: 12 },
      { n: 3, pn: '112903', name: 'Front leg', price: 1125, weight: 450, side: 140, bin: 8 },
      { n: 4, pn: '112911', name: 'Corner block', price: 365, weight: 120, side: 90, bin: 30 },
      { n: 5, pn: '100190', name: 'Bolt M8 × 80', price: 85, weight: 40, side: 80, bin: 200 },
    ],
  },
  {
    slug: 'kestle-shelving-unit', name: 'Kestle Shelving Unit', axis: 'iso', order: 3,
    retired: ['Kestle Tall Shelf', 'Kestle 5-Tier'],
    parts: [
      { n: 1, pn: '60770016', name: 'Upright', price: 2900, weight: 3900, side: 1810, bin: 0 },
      { n: 2, pn: '607701', name: 'Shelf board', price: 1675, weight: 2600, side: 790, bin: 4 },
      { n: 3, pn: '101345', name: 'Shelf pin', price: 15, weight: 3, side: 16, bin: 1000 },
      { n: 4, pn: '120456', name: 'Wall bracket', price: 255, weight: 60, side: 70, bin: 25 },
      { n: 5, pn: '607744', name: 'Back brace', price: 740, weight: 800, side: 760, bin: 2, status: 'withdrawn' },
    ],
  },
  {
    slug: 'fenwick-bed-frame', name: 'Fenwick Bed Frame', axis: null, order: 4,
    retired: ['Fenwick Double'],
    parts: [
      { n: 1, pn: '70110025', name: 'Headboard', price: 5400, weight: 9800, side: 1420, bin: 0 },
      { n: 2, pn: '701102', name: 'Side rail', price: 1990, weight: 3300, side: 1960, bin: 2 },
      { n: 3, pn: '701109', name: 'Slat', price: 320, weight: 400, side: 1380, bin: 40 },
      { n: 4, pn: '120870', name: 'Centre leg', price: 410, weight: 300, side: 250, bin: 10 },
    ],
  },
];

const BANK_HOLIDAYS = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
];

const CLUB_ROSTER: ReadonlyArray<{ email: string; joined: string }> = [
  { email: 'ines.kowalczyk@example.org', joined: '2023-04-02' },
  { email: 'tom.ashby@example.net', joined: '2025-09-10' },
];

export async function applySchema(pool: Pool, config: DeskConfig): Promise<void> {
  await pool.query(SCHEMA_SQL);
  const ready = await pool.query<{ applied_at: string }>('SELECT applied_at FROM schema_ready WHERE id = 1');
  if (ready.rowCount === 0) {
    await pool.query('INSERT INTO schema_ready (id) VALUES (1)');
    return seed(pool, config);
  }
  // Even on a warm start, refresh edition months from the settings so seeded
  // copies match their AFTERCARE_*_MONTHS values.
  await pool.query(
    'UPDATE editions SET standard_months = $1, club_months = $2 WHERE code IN ($3, $4)',
    [config.aftercareStandardMonths, config.aftercareClubMonths, 'AC-2025', 'AC-2026'],
  );
}

async function seed(pool: Pool, config: DeskConfig): Promise<void> {
  const catalogueCount = await pool.query<{ c: string }>('SELECT count(*)::text AS c FROM models');
  if (catalogueCount.rows[0] && Number(catalogueCount.rows[0].c) > 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of SEED_MODELS) {
      await client.query(
        'INSERT INTO models (slug, name, axis, display_order) VALUES ($1, $2, $3, $4)',
        [m.slug, m.name, m.axis, m.order],
      );
      for (const r of m.retired) {
        await client.query('INSERT INTO model_retired_names (slug, name) VALUES ($1, $2)', [m.slug, r]);
      }
      for (const p of m.parts) {
        await client.query(
          `INSERT INTO parts (model_slug, booklet_number, part_number, name, price_minor, weight_g, longest_side_mm, bin_count, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [m.slug, p.n, p.pn, p.name, p.price, p.weight, p.side, p.bin, p.status ?? 'active'],
        );
      }
    }
    await client.query(
      `INSERT INTO editions (code, title, starts_on, standard_months, club_months, owner_contribution_percent) VALUES
       ('AC-2025','Aftercare 2025','2025-01-01',$1,$2,0),
       ('AC-2026','Aftercare 2026','2026-07-15',$1,$2,25)`,
      [config.aftercareStandardMonths, config.aftercareClubMonths],
    );
    for (const c of CLUB_ROSTER) {
      await client.query('INSERT INTO club_roster (email, joined_on) VALUES ($1, $2)', [c.email, c.joined]);
    }
    for (const h of BANK_HOLIDAYS) {
      await client.query('INSERT INTO bank_holidays (date) VALUES ($1)', [h]);
    }
    await client.query('INSERT INTO decided_counts (id, decided_claims, decided_inside, decided_outside) VALUES (1,0,0,0)');
    await client.query('DELETE FROM operator_account WHERE email = $1', ['operator@holmgarth.example']);
    await client.query('INSERT INTO operator_account (email, password_hash) VALUES ($1, $2)', [
      'operator@holmgarth.example', hashPassword('fan-out-2026-desk'),
    ]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
    throw e;
  } finally {
    client.release();
  }
}

export type Row = QueryResultRow;
