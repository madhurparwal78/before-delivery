// One PostgreSQL pool for the whole server, plus the schema and the deterministic seed.
// Every record lives in these tables; nothing is cached anywhere else.
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tier TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL,
  row_allowance INTEGER NOT NULL,
  stored_megabytes INTEGER NOT NULL,
  content_allowance_kilobytes INTEGER NOT NULL,
  view_allowance INTEGER NOT NULL,
  retention TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  department TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS role_grants (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  department TEXT NOT NULL,
  role TEXT NOT NULL,
  authorises_from TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (account, department)
);
CREATE TABLE IF NOT EXISTS department_grants (
  id TEXT PRIMARY KEY,
  department TEXT NOT NULL,
  tier TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  UNIQUE (department, effective_at)
);
CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  tier TEXT NOT NULL,
  locked_period TEXT
);
CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  caption TEXT NOT NULL,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  options JSONB,
  UNIQUE (table_id, caption)
);
CREATE TABLE IF NOT EXISTS rows (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  values JSONB NOT NULL,
  inserted_at BIGINT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  visibility TEXT NOT NULL,
  filters JSONB NOT NULL,
  sorts JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY,
  table_slug TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  action TEXT NOT NULL,
  account TEXT NOT NULL,
  subject TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  business_day TEXT NOT NULL,
  column_caption TEXT,
  before JSONB,
  after JSONB,
  previous_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  UNIQUE (table_slug, ordinal)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  table_slug TEXT NOT NULL,
  period TEXT NOT NULL,
  account TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  business_day TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  tier TEXT NOT NULL,
  row_allowance INTEGER NOT NULL,
  content_allowance_kilobytes INTEGER NOT NULL,
  retention TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  content_bytes INTEGER NOT NULL,
  rows JSONB NOT NULL,
  UNIQUE (table_slug, period)
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  department TEXT NOT NULL,
  role TEXT NOT NULL,
  state TEXT NOT NULL,
  reason TEXT,
  raised_at TIMESTAMPTZ NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL UNIQUE,
  account TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  work_email TEXT NOT NULL,
  phone TEXT,
  company TEXT NOT NULL,
  role TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS form_tokens (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  table_slug TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL
);
`;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function hashPassword(password) {
  return sha256('keystone-password:' + password);
}

const uid = (prefix) => prefix + '-' + crypto.randomUUID();

// ---------- seed data ----------

const DEPARTMENTS = [
  { slug: 'claims', name: 'Claims', tier: 'starter' },
  { slug: 'underwriting', name: 'Underwriting', tier: 'team' },
  { slug: 'actuarial', name: 'Actuarial', tier: 'scale' },
];

const TIERS = [
  { name: 'starter', position: 1, row_allowance: 3000, stored_megabytes: 2048, content_allowance_kilobytes: 192, view_allowance: 2, retention: 'one period' },
  { name: 'team', position: 2, row_allowance: 50000, stored_megabytes: 20480, content_allowance_kilobytes: 2048, view_allowance: 10, retention: 'four periods' },
  { name: 'scale', position: 3, row_allowance: 250000, stored_megabytes: 102400, content_allowance_kilobytes: 10240, view_allowance: 40, retention: 'twelve periods' },
  { name: 'regulated', position: 4, row_allowance: 1000000, stored_megabytes: 512000, content_allowance_kilobytes: 102400, view_allowance: 200, retention: 'every period' },
];

const DEPARTMENT_GRANTS = [
  { department: 'claims', tier: 'starter', effective_at: '2026-01-01T00:00:00Z' },
  { department: 'underwriting', tier: 'team', effective_at: '2026-01-01T00:00:00Z' },
  { department: 'actuarial', tier: 'scale', effective_at: '2026-01-01T00:00:00Z' },
  { department: 'claims', tier: 'regulated', effective_at: '2099-01-01T00:00:00Z' },
];

const ACCOUNTS = [
  { email: 'steward.claims@example.com', display_name: 'Ava Steward', department: 'claims', role: 'steward' },
  { email: 'editor.claims@example.com', display_name: 'Ben Editor', department: 'claims', role: 'editor' },
  { email: 'analyst.claims@example.com', display_name: 'Cai Analyst', department: 'claims', role: 'analyst' },
  { email: 'viewer.claims@example.com', display_name: 'Dara Viewer', department: 'claims', role: 'viewer' },
  { email: 'steward.underwriting@example.com', display_name: 'Eli Steward', department: 'underwriting', role: 'steward' },
  { email: 'editor.underwriting@example.com', display_name: 'Farah Editor', department: 'underwriting', role: 'editor' },
  { email: 'steward.actuarial@example.com', display_name: 'Gina Steward', department: 'actuarial', role: 'steward' },
  { email: 'analyst.actuarial@example.com', display_name: 'Hugo Analyst', department: 'actuarial', role: 'analyst' },
];

const EXTRA_GRANT = { account: 'editor.underwriting@example.com', department: 'actuarial', role: 'viewer' };

const TABLES = [
  { slug: 'claims-intake', name: 'Claims intake', department: 'claims', tier: 'starter', locked_period: null },
  { slug: 'claims-reserves', name: 'Claims reserves', department: 'claims', tier: 'starter', locked_period: '2026-Q2' },
  { slug: 'underwriting-risk', name: 'Underwriting risk', department: 'underwriting', tier: 'team', locked_period: null },
  { slug: 'actuarial-triangles', name: 'Actuarial triangles', department: 'actuarial', tier: 'scale', locked_period: null },
  { slug: 'actuarial-exposure', name: 'Actuarial exposure', department: 'actuarial', tier: 'scale', locked_period: null },
];

const COLUMNS = {
  'claims-intake': [
    { caption: 'Reference', type: 'text', options: null },
    { caption: 'Claim count', type: 'integer', options: null },
    { caption: 'Reserve amount', type: 'decimal', options: null },
    { caption: 'Opened on', type: 'date', options: null },
    { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
    { caption: 'Settled', type: 'flag', options: null },
  ],
  'claims-reserves': [
    { caption: 'Reference', type: 'text', options: null },
    { caption: 'Reserve amount', type: 'decimal', options: null },
    { caption: 'Opened on', type: 'date', options: null },
    { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
    { caption: 'Settled', type: 'flag', options: null },
  ],
  'underwriting-risk': [
    { caption: 'Reference', type: 'text', options: null },
    { caption: 'Sum insured', type: 'decimal', options: null },
    { caption: 'Opened on', type: 'date', options: null },
    { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
    { caption: 'Approved', type: 'flag', options: null },
  ],
  'actuarial-triangles': [
    { caption: 'Reference', type: 'text', options: null },
    { caption: 'Loss ratio', type: 'decimal', options: null },
    { caption: 'Opened on', type: 'date', options: null },
    { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
    { caption: 'Finalised', type: 'flag', options: null },
  ],
  'actuarial-exposure': [
    { caption: 'Reference', type: 'text', options: null },
    { caption: 'Exposure count', type: 'integer', options: null },
    { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
    { caption: 'Settled', type: 'flag', options: null },
  ],
};

const SNAPSHOTS = [
  {
    table_slug: 'claims-reserves', period: '2026-Q1', account: 'steward.claims@example.com',
    published_at: '2026-02-10T10:00:00Z', sequence: 1, first_rows: 36,
  },
  {
    table_slug: 'claims-reserves', period: '2026-Q2', account: 'steward.claims@example.com',
    published_at: '2026-03-10T10:00:00Z', sequence: 2, first_rows: 40,
  },
  {
    table_slug: 'actuarial-triangles', period: '2026-B1', account: 'steward.actuarial@example.com',
    published_at: '2026-03-31T18:29:59Z', sequence: 1,
  },
  {
    table_slug: 'actuarial-triangles', period: '2026-B2', account: 'steward.actuarial@example.com',
    published_at: '2026-03-31T18:30:00Z', sequence: 2,
  },
];

const REQUESTS = [
  { account: 'steward.underwriting@example.com', department: 'claims', role: 'analyst', state: 'open', reason: null },
  { account: 'editor.underwriting@example.com', department: 'actuarial', role: 'viewer', state: 'approved', reason: 'Read access for the exposure model.', decided_by: 'steward.actuarial@example.com', decided_at: '2026-02-01T09:30:00Z' },
  { account: 'analyst.actuarial@example.com', department: 'underwriting', role: 'analyst', state: 'declined', reason: 'The underwriting book is not shared with actuarial yet.', decided_by: 'steward.underwriting@example.com', decided_at: '2026-02-05T15:00:00Z' },
];

// Seeded row values. Every text, date or choice value is at most 24 characters long.
function seededRowValues(tableSlug, n) {
  const pad = (v, w) => String(v).padStart(w, '0');
  if (tableSlug === 'claims-intake') {
    return {
      Reference: `CI-${pad(n, 4)}`,
      'Claim count': ((n - 1) % 9) + 1,
      'Reserve amount': Math.round(((n * 137) % 9000 + 250) * 100) / 100,
      'Opened on': `2026-01-${pad(((n - 1) % 28) + 1)}`,
      Band: ['low', 'moderate', 'high'][(n - 1) % 3],
      Settled: n % 2 === 0,
    };
  }
  if (tableSlug === 'claims-reserves') {
    return {
      Reference: `CR-${pad(n, 4)}`,
      'Reserve amount': Math.round(((n * 211) % 7500 + 500) * 100) / 100,
      'Opened on': `2026-02-${pad(((n - 1) % 28) + 1)}`,
      Band: ['low', 'moderate', 'high'][(n - 1) % 3],
      Settled: n % 2 === 0,
    };
  }
  if (tableSlug === 'underwriting-risk') {
    return {
      Reference: `UR-${pad(n, 3)}`,
      'Sum insured': Math.round(((n * 313) % 50000 + 1000) * 100) / 100,
      'Opened on': `2026-03-${pad(((n - 1) % 28) + 1)}`,
      Band: ['low', 'moderate', 'high'][(n - 1) % 3],
      Approved: n % 2 === 0,
    };
  }
  if (tableSlug === 'actuarial-triangles') {
    return {
      Reference: `AT-${pad(n, 3)}`,
      'Loss ratio': Math.round(((n * 7) % 140 + 60) * 100) / 100,
      'Opened on': `2026-03-${pad(((n - 1) % 28) + 1)}`,
      Band: ['low', 'moderate', 'high'][(n - 1) % 3],
      Finalised: n % 2 === 0,
    };
  }
  if (tableSlug === 'actuarial-exposure') {
    const r = n % 3;
    return {
      Reference: `EXP-${pad(n, 4)}`,
      'Exposure count': n,
      Band: r === 1 ? 'low' : (r === 2 ? 'moderate' : 'high'),
      Settled: n % 2 === 0,
    };
  }
  throw new Error('unknown table ' + tableSlug);
}

const ROW_COUNTS = {
  'claims-intake': 2400,
  'claims-reserves': 40,
  'underwriting-risk': 36,
  'actuarial-triangles': 44,
  'actuarial-exposure': 4000,
};

async function initStore() {
  await pool.query(SCHEMA);
  await seed();
}

async function seed() {
  const counts = await pool.query(`SELECT
    (SELECT count(*) FROM departments) AS d,
    (SELECT count(*) FROM tiers) AS t,
    (SELECT count(*) FROM accounts) AS a,
    (SELECT count(*) FROM role_grants) AS g,
    (SELECT count(*) FROM department_grants) AS dg,
    (SELECT count(*) FROM tables) AS tb,
    (SELECT count(*) FROM columns) AS c,
    (SELECT count(*) FROM rows) AS r,
    (SELECT count(*) FROM views) AS v,
    (SELECT count(*) FROM log_entries) AS le,
    (SELECT count(*) FROM snapshots) AS s,
    (SELECT count(*) FROM requests) AS rq,
    (SELECT count(*) FROM sessions) AS se,
    (SELECT count(*) FROM subscribers) AS sub,
    (SELECT count(*) FROM enquiries) AS enq,
    (SELECT count(*) FROM login_attempts) AS la`);
  const c = counts.rows[0];
  const seeded = Number(c.d) > 0;
  if (seeded) {
    // Already seeded: apply the idempotent corrections and return without duplicating a row.
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const d of DEPARTMENTS) {
      await client.query(
        'INSERT INTO departments (id, slug, name, tier) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING',
        [uid('dept'), d.slug, d.name, d.tier]);
    }
    for (const t of TIERS) {
      await client.query(
        'INSERT INTO tiers (id, name, position, row_allowance, stored_megabytes, content_allowance_kilobytes, view_allowance, retention) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (name) DO NOTHING',
        [uid('tier'), t.name, t.position, t.row_allowance, t.stored_megabytes, t.content_allowance_kilobytes, t.view_allowance, t.retention]);
    }
    for (const g of DEPARTMENT_GRANTS) {
      await client.query(
        'INSERT INTO department_grants (id, department, tier, effective_at) VALUES ($1,$2,$3,$4) ON CONFLICT (department, effective_at) DO NOTHING',
        [uid('dg'), g.department, g.tier, g.effective_at]);
    }
    const pwHash = hashPassword('deku-demo-pw-2026');
    for (const a of ACCOUNTS) {
      await client.query(
        'INSERT INTO accounts (id, email, display_name, department, password_hash, tier, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email) DO NOTHING',
        [uid('acct'), a.email, a.display_name, a.department, pwHash, DEPARTMENTS.find(d => d.slug === a.department).tier, '2026-01-15T09:00:00Z']);
      await client.query(
        'INSERT INTO role_grants (id, account, department, role, authorises_from, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (account, department) DO NOTHING',
        [uid('rg'), a.email, a.department, a.role, '2026-01-15T09:00:00Z', '2026-01-15T09:00:00Z']);
    }
    await client.query(
      'INSERT INTO role_grants (id, account, department, role, authorises_from, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (account, department) DO NOTHING',
      [uid('rg'), EXTRA_GRANT.account, EXTRA_GRANT.department, EXTRA_GRANT.role, '2026-02-01T09:30:00Z', '2026-02-01T09:30:00Z']);
    const tableIds = {};
    for (const t of TABLES) {
      const id = uid('tbl');
      tableIds[t.slug] = id;
      await client.query(
        'INSERT INTO tables (id, slug, name, department, tier, locked_period) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING',
        [id, t.slug, t.name, t.department, t.tier, t.locked_period]);
    }
    const columnIds = {};
    for (const [slug, cols] of Object.entries(COLUMNS)) {
      for (let p = 0; p < cols.length; p++) {
        const col = cols[p];
        const id = uid('col');
        columnIds[slug + ':' + col.caption] = id;
        await client.query(
          'INSERT INTO columns (id, table_id, caption, position, type, options) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, tableIds[slug], col.caption, p + 1, col.type, col.options ? JSON.stringify(col.options) : null]);
      }
    }
    const rowIds = {};
    for (const t of TABLES) {
      const n = ROW_COUNTS[t.slug];
      for (let i = 1; i <= n; i++) {
        const id = uid('row');
        rowIds[t.slug + '#' + i] = id;
        await client.query(
          'INSERT INTO rows (id, table_id, values, inserted_at, version) VALUES ($1,$2,$3,$4,$5)',
          [id, tableIds[t.slug], JSON.stringify(seededRowValues(t.slug, i)), i, 1]);
      }
    }
    for (const s of SNAPSHOTS) {
      const table = TABLES.find(t => t.slug === s.table_slug);
      const tier = TIERS.find(t => t.name === table.tier);
      const total = ROW_COUNTS[s.table_slug];
      const n = s.first_rows != null ? s.first_rows : total;
      const rows = [];
      for (let i = 1; i <= n; i++) {
        rows.push({ id: rowIds[s.table_slug + '#' + i], values: seededRowValues(s.table_slug, i) });
      }
      await client.query(
        `INSERT INTO snapshots (id, table_slug, period, account, published_at, business_day, sequence, tier, row_allowance, content_allowance_kilobytes, retention, row_count, content_bytes, rows)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (table_slug, period) DO NOTHING`,
        [uid('snap'), s.table_slug, s.period, s.account, s.published_at, businessDay(s.published_at), s.sequence,
         tier.name, tier.row_allowance, tier.content_allowance_kilobytes, tier.retention, rows.length, rowsContentBytes(COLUMNS[s.table_slug], rows), JSON.stringify(rows)]);
    }
    for (const r of REQUESTS) {
      await client.query(
        'INSERT INTO requests (id, account, department, role, state, reason, raised_at, decided_by, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [uid('req'), r.account, r.department, r.role, r.state, r.reason,
         r.state === 'open' ? '2026-03-01T10:00:00Z' : '2026-01-28T08:00:00Z',
         r.decided_by || null, r.decided_at || null]);
    }
    await client.query(
      'INSERT INTO sessions (id, value, account, created_at, expires_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (value) DO NOTHING',
      [uid('sess'), 'keystone-stale-session-2026', 'viewer.claims@example.com', '2024-01-02T09:00:00Z', '2024-01-02T21:00:00Z']);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// The business time zone is Asia/Kolkata: +05:30, never UTC. The turnover moment belongs to the
// later day, so 18:30:00Z is the next calendar date.
function businessDay(iso) {
  const d = new Date(iso);
  const kolkata = new Date(d.getTime() + (5 * 60 + 30) * 60000);
  return kolkata.toISOString().slice(0, 10);
}

// Per-column content contributions: text/date/choice by characters, integer 4, decimal 8, flag 1.
function columnContribution(type, value) {
  if (value === undefined || value === null || value === '') return 0;
  if (type === 'integer') return 4;
  if (type === 'decimal') return 8;
  if (type === 'flag') return 1;
  return String(value).length;
}

function rowsContentBytes(columns, rows) {
  let bytes = 0;
  for (const row of rows) {
    for (const col of columns) {
      bytes += columnContribution(col.type, row.values[col.caption]);
    }
  }
  return bytes;
}

module.exports = {
  pool, SCHEMA, initStore, seed, sha256, hashPassword, uid, businessDay,
  columnContribution, rowsContentBytes, TIERS, DEPARTMENTS, COLUMNS,
  ACCOUNTS, TABLES, ROW_COUNTS,
};

