// PostgreSQL is the system of record. Schema and seed are applied
// idempotently every time the server starts.

import pg from 'pg';
import type { PoolClient } from 'pg';
import { hashPassword } from './passwords.js';
import {
  DIAGRAM_HARBOR, DIAGRAM_KESTREL, PAGE_FLOWS, PAGE_KESTREL, PAGE_NETWORK, SEED_PAGES, SEED_SHARES,
} from './seedData.js';

const { Pool } = pg;

export interface PersonRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 });

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_failures (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signin_failures_lookup ON signin_failures (email, ip, at);
CREATE INDEX IF NOT EXISTS signin_failures_ip ON signin_failures (ip, at);

CREATE TABLE IF NOT EXISTS diagrams (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES people(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pages (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  doc jsonb NOT NULL,
  derived jsonb NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pages_diagram_position ON pages (diagram_id, position);

CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  status text NOT NULL CHECK (status IN ('invited', 'active', 'expired', 'revoked', 'withdrawn')),
  token_hash text UNIQUE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS shares_diagram ON shares (diagram_id);
CREATE UNIQUE INDEX IF NOT EXISTS shares_pending_email ON shares (diagram_id, lower(email)) WHERE status IN ('invited', 'expired');

CREATE TABLE IF NOT EXISTS mail_queue (
  id text PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'cancelled')),
  claimed_by text,
  claimed_at timestamptz,
  sent_at timestamptz,
  diagram_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_queue_queued ON mail_queue (status) WHERE status IN ('queued', 'sending');

CREATE TABLE IF NOT EXISTS downloads (
  token_hash text PRIMARY KEY,
  person_id text NOT NULL,
  diagram_id text NOT NULL,
  import_id text,
  export_id text,
  format text,
  file_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id text PRIMARY KEY,
  diagram_id text NOT NULL,
  page_id text NOT NULL,
  file_name text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imports_diagram ON imports (diagram_id);

CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  diagram_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  page_ids jsonb NOT NULL,
  files jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exports_diagram ON exports (diagram_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id text NOT NULL,
  diagram_id text NOT NULL,
  key text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress', 'stored')),
  response_body jsonb,
  export_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, diagram_id, key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL,
  diagram_id text,
  person_id text
);
CREATE INDEX IF NOT EXISTS audit_diagram ON audit_events (diagram_id, id);
CREATE INDEX IF NOT EXISTS audit_person ON audit_events (person_id, id);

CREATE TABLE IF NOT EXISTS invite_lookups (
  id bigserial PRIMARY KEY,
  ip text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invite_lookups_ip ON invite_lookups (ip, at);

CREATE TABLE IF NOT EXISTS schema_version (
  version integer NOT NULL
);
INSERT INTO schema_version (version) VALUES (1) ON CONFLICT DO NOTHING;
`;

interface SeedPerson {
  id: string;
  email: string;
  displayName: string;
  password: string;
}

const SEED_PEOPLE: SeedPerson[] = [
  { id: 'per-dana', email: 'dana.okafor@harborlane.test', displayName: 'Dana Okafor', password: 'Harbor-Lead-2026!' },
  { id: 'per-ravi', email: 'ravi.sato@harborlane.test', displayName: 'Ravi Sato', password: 'Harbor-Net-2026!a' },
  { id: 'per-jo', email: 'jo.mendes@harborlane.test', displayName: 'Jo Mendes', password: 'Harbor-Net-2026!b' },
  { id: 'per-lee', email: 'lee.varga@northgate-qsa.test', displayName: 'Lee Varga', password: 'Northgate-QSA-2026!' },
  { id: 'per-morgan', email: 'morgan.fell@harborlane.test', displayName: 'Morgan Fell', password: 'Harbor-Ops-2026!' },
  { id: 'per-sam', email: 'sam.whitlow@kestrelpay.test', displayName: 'Sam Whitlow', password: 'Kestrel-Owner-2026!' },
];

export async function applySchemaAndSeed(): Promise<void> {
  // Several instances may start at once against one database: an advisory
  // lock serialises schema and seed application so exactly one of them
  // creates each object and the rest find it already present.
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('scopewright-schema'))`);
    await client.query(SCHEMA);
    for (const person of SEED_PEOPLE) {
      const hash = await hashPassword(person.password);
      await client.query(
        `INSERT INTO people (id, email, display_name, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [person.id, person.email, person.displayName, hash],
      );
    }
    await seedDiagrams(client);
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext('scopewright-schema'))`);
    } finally {
      client.release();
    }
  }
}

async function seedDiagrams(client: PoolClient): Promise<void> {
  const dana = await client.query<{ id: string }>('SELECT id FROM people WHERE email = $1', ['dana.okafor@harborlane.test']);
  const sam = await client.query<{ id: string }>('SELECT id FROM people WHERE email = $1', ['sam.whitlow@kestrelpay.test']);
  if (dana.rowCount === 0 || sam.rowCount === 0) return;
  const danaId = dana.rows[0].id;
  const samId = sam.rows[0].id;
  await client.query(
    `INSERT INTO diagrams (id, owner_id, title) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [DIAGRAM_HARBOR, danaId, 'Harbor Lane CDE scope'],
  );
  await client.query(
    `INSERT INTO diagrams (id, owner_id, title) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [DIAGRAM_KESTREL, samId, 'Kestrel Pay processing scope'],
  );
  const existing = await client.query<{ id: string }>('SELECT id FROM pages WHERE diagram_id = ANY($1)', [[DIAGRAM_HARBOR, DIAGRAM_KESTREL]]);
  if (existing.rowCount !== 3) {
    for (const page of [PAGE_NETWORK, PAGE_FLOWS]) {
      const seed = SEED_PAGES[page];
      await client.query(
        `INSERT INTO pages (id, diagram_id, name, version, doc, derived, position)
         VALUES ($1, $2, $3, 1, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [page, DIAGRAM_HARBOR, seed.doc.name, JSON.stringify(seed.doc), JSON.stringify(seed.derived), page === PAGE_NETWORK ? 1 : 2],
      );
    }
    const kestrel = SEED_PAGES[PAGE_KESTREL];
    await client.query(
      `INSERT INTO pages (id, diagram_id, name, version, doc, derived, position)
       VALUES ($1, $2, $3, 1, $4, $5, 1)
       ON CONFLICT (id) DO NOTHING`,
      [PAGE_KESTREL, DIAGRAM_KESTREL, kestrel.doc.name, JSON.stringify(kestrel.doc), JSON.stringify(kestrel.derived)],
    );
  }
  const shareCount = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM shares WHERE diagram_id = $1', [DIAGRAM_HARBOR]);
  if (shareCount.rows[0].n === '0') {
    for (const share of SEED_SHARES[DIAGRAM_HARBOR]) {
      const person = await client.query<{ id: string; display_name: string }>('SELECT id, display_name FROM people WHERE email = $1', [share.email]);
      await client.query(
        `INSERT INTO shares (id, diagram_id, email, display_name, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [`shr-${share.email.split('@')[0]}`, DIAGRAM_HARBOR, share.email, person.rows[0]?.display_name ?? null, share.role],
      );
    }
  }
}
