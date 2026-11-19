'use strict';
const { pool, query, one } = require('./db');
const { SCHEMA_SQL } = require('./schema');
const { hashPassword, businessDay, iso } = require('./util');

const SEED_VERSION = 'keystone-2026-11-04-1';

const DEMO_PASSWORD = 'deku-demo-pw-2026';

const DEPARTMENTS = [
  { slug: 'claims', name: 'claims', tier: 'starter' },
  { slug: 'underwriting', name: 'underwriting', tier: 'team' },
  { slug: 'actuarial', name: 'actuarial', tier: 'scale' },
];

const TIERS = [
  {
    name: 'starter',
    grant_order: 1,
    audience: 'One department closing a single reporting line',
    row_allowance: 3000,
    stored_megabytes: 2048,
    content_allowance_kilobytes: 192,
    view_allowance: 2,
    retention: 'one period',
    most_chosen: false,
  },
  {
    name: 'team',
    grant_order: 2,
    audience: 'A reporting team sharing views across a department',
    row_allowance: 50000,
    stored_megabytes: 20480,
    content_allowance_kilobytes: 2048,
    view_allowance: 10,
    retention: 'four periods',
    most_chosen: true,
  },
  {
    name: 'scale',
    grant_order: 3,
    audience: 'Several departments closing periods side by side',
    row_allowance: 250000,
    stored_megabytes: 102400,
    content_allowance_kilobytes: 10240,
    view_allowance: 40,
    retention: 'twelve periods',
    most_chosen: false,
  },
  {
    name: 'regulated',
    grant_order: 4,
    audience: 'An insurance group under statutory reporting duty',
    row_allowance: 1000000,
    stored_megabytes: 512000,
    content_allowance_kilobytes: 102400,
    view_allowance: 200,
    retention: 'every period',
    most_chosen: false,
  },
];

const ACCOUNTS = [
  { email: 'steward.claims@example.com', display_name: 'Priya Raman', department: 'claims', role: 'steward', tier: 'starter' },
  { email: 'editor.claims@example.com', display_name: 'Devon Clarke', department: 'claims', role: 'editor', tier: 'starter' },
  { email: 'analyst.claims@example.com', display_name: 'Marisol Vega', department: 'claims', role: 'analyst', tier: 'starter' },
  { email: 'viewer.claims@example.com', display_name: 'Ibrahim Noor', department: 'claims', role: 'viewer', tier: 'starter' },
  { email: 'steward.underwriting@example.com', display_name: 'Hanne Lund', department: 'underwriting', role: 'steward', tier: 'team' },
  { email: 'editor.underwriting@example.com', display_name: 'Omar Haddad', department: 'underwriting', role: 'editor', tier: 'team' },
  { email: 'steward.actuarial@example.com', display_name: 'Nadia Petrov', department: 'actuarial', role: 'steward', tier: 'scale' },
  { email: 'analyst.actuarial@example.com', display_name: 'Tomas Berg', department: 'actuarial', role: 'analyst', tier: 'scale' },
];

const DEPARTMENT_GRANTS = [
  { department: 'claims', tier: 'starter', effective_at: '2026-01-01T00:00:00Z' },
  { department: 'underwriting', tier: 'team', effective_at: '2026-01-01T00:00:00Z' },
  { department: 'actuarial', tier: 'scale', effective_at: '2026-01-01T00:00:00Z' },
  { department: 'claims', tier: 'regulated', effective_at: '2099-01-01T00:00:00Z' },
];

const TABLES = [
  {
    slug: 'claims-intake',
    name: 'Claims intake',
    department: 'claims',
    tier: 'starter',
    locked_period: null,
    columns: [
      { caption: 'Reference', type: 'text', options: null },
      { caption: 'Claim count', type: 'integer', options: null },
      { caption: 'Reserve amount', type: 'decimal', options: null },
      { caption: 'Opened on', type: 'date', options: null },
      { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
      { caption: 'Settled', type: 'flag', options: null },
    ],
  },
  {
    slug: 'claims-reserves',
    name: 'Claims reserves',
    department: 'claims',
    tier: 'starter',
    locked_period: '2026-Q2',
    columns: [
      { caption: 'Reference', type: 'text', options: null },
      { caption: 'Reserve amount', type: 'decimal', options: null },
      { caption: 'Opened on', type: 'date', options: null },
      { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
      { caption: 'Settled', type: 'flag', options: null },
    ],
  },
  {
    slug: 'underwriting-risk',
    name: 'Underwriting risk',
    department: 'underwriting',
    tier: 'team',
    locked_period: null,
    columns: [
      { caption: 'Reference', type: 'text', options: null },
      { caption: 'Risk score', type: 'integer', options: null },
      { caption: 'Premium', type: 'decimal', options: null },
      { caption: 'Opened on', type: 'date', options: null },
      { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
      { caption: 'Settled', type: 'flag', options: null },
    ],
  },
  {
    slug: 'actuarial-triangles',
    name: 'Actuarial triangles',
    department: 'actuarial',
    tier: 'scale',
    locked_period: null,
    columns: [
      { caption: 'Reference', type: 'text', options: null },
      { caption: 'Development month', type: 'integer', options: null },
      { caption: 'Paid amount', type: 'decimal', options: null },
      { caption: 'Opened on', type: 'date', options: null },
    ],
  },
  {
    slug: 'actuarial-exposure',
    name: 'Actuarial exposure',
    department: 'actuarial',
    tier: 'scale',
    locked_period: null,
    columns: [
      { caption: 'Reference', type: 'text', options: null },
      { caption: 'Exposure count', type: 'integer', options: null },
      { caption: 'Band', type: 'choice', options: ['low', 'moderate', 'high'] },
      { caption: 'Settled', type: 'flag', options: null },
    ],
  },
];

const BANDS = ['low', 'moderate', 'high'];

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function seedDate(n) {
  const base = Date.UTC(2026, 0, 1);
  const d = new Date(base + ((n * 86400000 * 3) % (330 * 86400000)));
  return d.toISOString().slice(0, 10);
}

function claimsIntakeRow(n) {
  return {
    Reference: 'CLM-' + pad(n, 4),
    'Claim count': ((n - 1) % 40) + 1,
    'Reserve amount': Number((((n * 137) % 90000) / 100 + 0.25).toFixed(2)),
    'Opened on': seedDate(n),
    Band: BANDS[(n - 1) % 3],
    Settled: n % 2 === 0,
  };
}

function claimsReservesRow(n) {
  return {
    Reference: 'RSV-' + pad(n, 4),
    'Reserve amount': Number((((n * 911) % 70000) / 100 + 0.5).toFixed(2)),
    'Opened on': seedDate(n * 2),
    Band: BANDS[n % 3],
    Settled: n % 3 === 0,
  };
}

function underwritingRiskRow(n) {
  return {
    Reference: 'UWR-' + pad(n, 4),
    'Risk score': ((n * 7) % 95) + 1,
    Premium: Number((((n * 523) % 50000) / 100 + 1.75).toFixed(2)),
    'Opened on': seedDate(n * 3),
    Band: BANDS[(n + 1) % 3],
    Settled: n % 4 === 0,
  };
}

function actuarialTrianglesRow(n) {
  return {
    Reference: 'TRI-' + pad(n, 4),
    'Development month': ((n - 1) % 36) + 1,
    'Paid amount': Number((((n * 1301) % 80000) / 100 + 3.5).toFixed(2)),
    'Opened on': seedDate(n * 5),
  };
}

function actuarialExposureRow(n) {
  const r = n % 3;
  return {
    Reference: 'EXP-' + pad(n, 4),
    'Exposure count': n,
    Band: r === 1 ? 'low' : r === 2 ? 'moderate' : 'high',
    Settled: n % 2 === 0,
  };
}

const ROW_BUILDERS = {
  'claims-intake': { count: 2400, build: claimsIntakeRow },
  'claims-reserves': { count: 40, build: claimsReservesRow },
  'underwriting-risk': { count: 42, build: underwritingRiskRow },
  'actuarial-triangles': { count: 30, build: actuarialTrianglesRow },
  'actuarial-exposure': { count: 4000, build: actuarialExposureRow },
};

const CONTENT_WEIGHT = { integer: 4, decimal: 8, flag: 1 };

function rowContentBytes(cols, values) {
  let total = 0;
  for (const col of cols) {
    const v = values[col.caption];
    if (v === null || v === undefined) continue;
    if (col.type === 'integer') total += 4;
    else if (col.type === 'decimal') total += 8;
    else if (col.type === 'flag') total += 1;
    else total += String(v).length;
  }
  return total;
}

async function insertRows(client, slug, builder, count) {
  const chunk = 500;
  for (let start = 1; start <= count; start += chunk) {
    const end = Math.min(count, start + chunk - 1);
    const text = [];
    const params = [];
    let p = 1;
    for (let n = start; n <= end; n++) {
      text.push(`($${p++}, $${p++}, $${p++}, 1, $${p++})`);
      params.push(slug, JSON.stringify(builder(n)), n, '2026-01-01T00:00:00.000Z');
    }
    await client.query(
      `INSERT INTO rows (table_slug, values, inserted_position, version, created_at) VALUES ${text.join(',')}`,
      params
    );
  }
}

async function runSeed() {
  await query(SCHEMA_SQL);

  const state = await one('SELECT version FROM seed_state WHERE id = 1');
  if (state && state.version === SEED_VERSION) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE departments, accounts, role_grants, tiers, department_grants, tables, columns,
       rows, views, log_entries, snapshots, requests, sessions, login_attempts, subscribers,
       enquiries, idempotency_keys, form_tokens RESTART IDENTITY`
    );

    for (const d of DEPARTMENTS) {
      await client.query('INSERT INTO departments (slug, name, tier) VALUES ($1,$2,$3)', [d.slug, d.name, d.tier]);
    }

    for (const t of TIERS) {
      await client.query(
        `INSERT INTO tiers (name, grant_order, audience, row_allowance, stored_megabytes,
          content_allowance_kilobytes, view_allowance, retention, most_chosen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          t.name,
          t.grant_order,
          t.audience,
          t.row_allowance,
          t.stored_megabytes,
          t.content_allowance_kilobytes,
          t.view_allowance,
          t.retention,
          t.most_chosen,
        ]
      );
    }

    const pwHash = hashPassword(DEMO_PASSWORD);
    for (const a of ACCOUNTS) {
      await client.query(
        `INSERT INTO accounts (email, display_name, department, tier, password_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [a.email, a.display_name, a.department, a.tier, pwHash, '2026-01-01T00:00:00.000Z']
      );
      await client.query(
        `INSERT INTO role_grants (account, department, role, authorises_from, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [a.email, a.department, a.role, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
      );
    }
    // The approved seeded request left this grant behind.
    await client.query(
      `INSERT INTO role_grants (account, department, role, authorises_from, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      ['editor.underwriting@example.com', 'actuarial', 'viewer', '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z']
    );

    for (const g of DEPARTMENT_GRANTS) {
      await client.query(
        'INSERT INTO department_grants (department, tier, effective_at) VALUES ($1,$2,$3)',
        [g.department, g.tier, iso(g.effective_at)]
      );
    }

    for (const t of TABLES) {
      await client.query(
        'INSERT INTO tables (slug, name, department, tier, locked_period) VALUES ($1,$2,$3,$4,$5)',
        [t.slug, t.name, t.department, t.tier, t.locked_period]
      );
      let position = 1;
      for (const c of t.columns) {
        await client.query(
          'INSERT INTO columns (table_slug, caption, position, type, options) VALUES ($1,$2,$3,$4,$5)',
          [t.slug, c.caption, position++, c.type, c.options ? JSON.stringify(c.options) : null]
        );
      }
      const spec = ROW_BUILDERS[t.slug];
      await insertRows(client, t.slug, spec.build, spec.count);
    }

    // Four published snapshots over two tables.
    const reserveCols = TABLES.find((t) => t.slug === 'claims-reserves').columns;
    const q1Rows = [];
    for (let n = 1; n <= 36; n++) q1Rows.push({ id: n, version: 1, values: claimsReservesRow(n) });
    const q2Rows = [];
    for (let n = 1; n <= 40; n++) q2Rows.push({ id: n, version: 1, values: claimsReservesRow(n) });
    const triCols = TABLES.find((t) => t.slug === 'actuarial-triangles').columns;
    const triRows = [];
    for (let n = 1; n <= 30; n++) triRows.push({ id: n, version: 1, values: actuarialTrianglesRow(n) });

    const starter = TIERS.find((t) => t.name === 'starter');
    const scale = TIERS.find((t) => t.name === 'scale');

    const snapshots = [
      {
        table_slug: 'claims-reserves',
        department: 'claims',
        period: '2026-Q1',
        account: 'steward.claims@example.com',
        published_at: '2026-04-01T06:00:00Z',
        sequence: 1,
        tier: starter,
        rows: q1Rows,
        cols: reserveCols,
      },
      {
        table_slug: 'claims-reserves',
        department: 'claims',
        period: '2026-Q2',
        account: 'steward.claims@example.com',
        published_at: '2026-07-01T06:00:00Z',
        sequence: 2,
        tier: starter,
        rows: q2Rows,
        cols: reserveCols,
      },
      {
        table_slug: 'actuarial-triangles',
        department: 'actuarial',
        period: '2026-B1',
        account: 'steward.actuarial@example.com',
        published_at: '2026-03-31T18:29:59Z',
        sequence: 1,
        tier: scale,
        rows: triRows,
        cols: triCols,
      },
      {
        table_slug: 'actuarial-triangles',
        department: 'actuarial',
        period: '2026-B2',
        account: 'steward.actuarial@example.com',
        published_at: '2026-03-31T18:30:00Z',
        sequence: 2,
        tier: scale,
        rows: triRows,
        cols: triCols,
      },
    ];

    for (const s of snapshots) {
      const publishedAt = iso(s.published_at);
      let contentBytes = 0;
      for (const r of s.rows) contentBytes += rowContentBytes(s.cols, r.values);
      await client.query(
        `INSERT INTO snapshots (table_slug, department, period, account, published_at, business_day,
          sequence, tier, row_allowance, content_allowance_kilobytes, retention, row_count,
          content_bytes, rows)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          s.table_slug,
          s.department,
          s.period,
          s.account,
          publishedAt,
          businessDay(publishedAt),
          s.sequence,
          s.tier.name,
          s.tier.row_allowance,
          s.tier.content_allowance_kilobytes,
          s.tier.retention,
          s.rows.length,
          contentBytes,
          JSON.stringify(s.rows),
        ]
      );
    }

    const requests = [
      {
        account: 'steward.underwriting@example.com',
        department: 'claims',
        role: 'analyst',
        state: 'open',
        reason: null,
        raised_at: '2026-02-01T09:00:00Z',
        decided_at: null,
        decided_by: null,
      },
      {
        account: 'editor.underwriting@example.com',
        department: 'actuarial',
        role: 'viewer',
        state: 'approved',
        reason: 'Needed for the quarterly reconciliation.',
        raised_at: '2026-01-04T09:00:00Z',
        decided_at: '2026-01-05T00:00:00Z',
        decided_by: 'steward.actuarial@example.com',
      },
      {
        account: 'analyst.actuarial@example.com',
        department: 'underwriting',
        role: 'analyst',
        state: 'declined',
        reason: 'No reporting duty on underwriting this period.',
        raised_at: '2026-01-10T09:00:00Z',
        decided_at: '2026-01-11T00:00:00Z',
        decided_by: 'steward.underwriting@example.com',
      },
    ];
    for (const r of requests) {
      await client.query(
        `INSERT INTO requests (account, department, role, state, reason, raised_at, decided_at, decided_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          r.account,
          r.department,
          r.role,
          r.state,
          r.reason,
          iso(r.raised_at),
          r.decided_at ? iso(r.decided_at) : null,
          r.decided_by,
        ]
      );
    }

    await client.query(
      'INSERT INTO sessions (value, account, created_at, expires_at) VALUES ($1,$2,$3,$4)',
      [
        'keystone-stale-session-2026',
        'viewer.claims@example.com',
        iso('2024-01-02T09:00:00Z'),
        iso('2024-01-02T21:00:00Z'),
      ]
    );

    await client.query(
      `INSERT INTO seed_state (id, version) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version`,
      [SEED_VERSION]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runSeed, DEMO_PASSWORD, ACCOUNTS, TIERS, SEED_VERSION };
