// Resets the store to the exact seeded state, so a test run starts from the baseline the
// brief names. Seeding itself is idempotent; this clears the mutable collections and the
// records the test suite creates.
// Usage: node tests/reset.js
const { pool } = require('../src/store');

async function main() {
  // sign-in attempts, sessions beyond the stale one, form tokens and idempotency keys are
  // runtime records; clear them so throttle and replay tests read clean.
  await pool.query('DELETE FROM login_attempts');
  await pool.query('DELETE FROM sessions WHERE value <> $1', ['keystone-stale-session-2026']);
  await pool.query('DELETE FROM form_tokens');
  await pool.query('DELETE FROM idempotency_keys');

  // change log entries are created by amendments, which are test records
  await pool.query('DELETE FROM log_entries');

  // views and requests and snapshots created by the test suite
  await pool.query('DELETE FROM views');
  await pool.query('DELETE FROM requests');
  await pool.query('DELETE FROM snapshots');
  await pool.query('DELETE FROM subscribers');
  await pool.query('DELETE FROM enquiries');

  // role grants beyond the seeded nine, and accounts beyond the seeded eight
  await pool.query(`DELETE FROM role_grants WHERE (account, department) NOT IN (
    SELECT a.email, a.department FROM accounts a WHERE a.email IN (
      'steward.claims@example.com','editor.claims@example.com','analyst.claims@example.com','viewer.claims@example.com',
      'steward.underwriting@example.com','editor.underwriting@example.com','steward.actuarial@example.com','analyst.actuarial@example.com')
    UNION SELECT 'editor.underwriting@example.com', 'actuarial')`);
  await pool.query(`DELETE FROM accounts WHERE email NOT IN (
    'steward.claims@example.com','editor.claims@example.com','analyst.claims@example.com','viewer.claims@example.com',
    'steward.underwriting@example.com','editor.underwriting@example.com','steward.actuarial@example.com','analyst.actuarial@example.com')`);

  // rows beyond the seeded sets, and the tables' lock state
  await pool.query(`DELETE FROM rows WHERE id NOT IN (
    SELECT r.id FROM rows r JOIN tables t ON t.id = r.table_id
    WHERE (t.slug, r.inserted_at) IN (
      SELECT slug, generate_series(1, n) FROM (VALUES ('claims-intake', 2400), ('claims-reserves', 40), ('underwriting-risk', 36), ('actuarial-triangles', 44), ('actuarial-exposure', 4000)) AS v(slug, n)
    ))`);
  await pool.query("UPDATE tables SET locked_period = NULL WHERE slug <> 'claims-reserves'");
  await pool.query("UPDATE tables SET locked_period = '2026-Q2' WHERE slug = 'claims-reserves'");

  // the departments' tier column reads the grant in force
  await pool.query(`UPDATE departments d SET tier = g.tier FROM department_grants g
    WHERE g.department = d.slug AND g.effective_at <= now()
    AND g.effective_at = (SELECT max(effective_at) FROM department_grants WHERE department = d.slug AND effective_at <= now())`);

  // re-seed the deleted baseline records exactly as the brief names them
  const { seed } = require('../src/store');
  const counts = await pool.query('SELECT count(*) AS c FROM requests');
  if (Number(counts.rows[0].c) === 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO requests (id, account, department, role, state, reason, raised_at, decided_by, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['req-seeded-open', 'steward.underwriting@example.com', 'claims', 'analyst', 'open', null, '2026-03-01T10:00:00Z', null, null]);
      await client.query(
        'INSERT INTO requests (id, account, department, role, state, reason, raised_at, decided_by, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['req-seeded-approved', 'editor.underwriting@example.com', 'actuarial', 'viewer', 'approved', 'Read access for the exposure model.', '2026-01-28T08:00:00Z', 'steward.actuarial@example.com', '2026-02-01T09:30:00Z']);
      await client.query(
        'INSERT INTO requests (id, account, department, role, state, reason, raised_at, decided_by, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['req-seeded-declined', 'analyst.actuarial@example.com', 'underwriting', 'analyst', 'declined', 'The underwriting book is not shared with actuarial yet.', '2026-01-28T08:00:00Z', 'steward.underwriting@example.com', '2026-02-05T15:00:00Z']);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // re-seed the four snapshots exactly as the brief names them
  const snapCount = await pool.query('SELECT count(*) AS c FROM snapshots');
  if (Number(snapCount.rows[0].c) === 0) {
    const { businessDay, rowsContentBytes, COLUMNS, ROW_COUNTS, TABLES, TIERS } = require('../src/store');
    const crypto = require('crypto');
    const uid = (p) => p + '-' + crypto.randomUUID();
    const SNAPS = [
      { table_slug: 'claims-reserves', period: '2026-Q1', account: 'steward.claims@example.com', published_at: '2026-02-10T10:00:00Z', sequence: 1, first_rows: 36 },
      { table_slug: 'claims-reserves', period: '2026-Q2', account: 'steward.claims@example.com', published_at: '2026-03-10T10:00:00Z', sequence: 2, first_rows: 40 },
      { table_slug: 'actuarial-triangles', period: '2026-B1', account: 'steward.actuarial@example.com', published_at: '2026-03-31T18:29:59Z', sequence: 1 },
      { table_slug: 'actuarial-triangles', period: '2026-B2', account: 'steward.actuarial@example.com', published_at: '2026-03-31T18:30:00Z', sequence: 2 },
    ];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of SNAPS) {
        const table = TABLES.find(t => t.slug === s.table_slug);
        const tier = TIERS.find(t => t.name === table.tier);
        const total = ROW_COUNTS[s.table_slug];
        const n = s.first_rows != null ? s.first_rows : total;
        const rowsR = await client.query(
          'SELECT id, values FROM rows WHERE table_id = (SELECT id FROM tables WHERE slug = $1) ORDER BY inserted_at ASC LIMIT $2',
          [s.table_slug, n]);
        const frozen = rowsR.rows.map(r => ({ id: r.id, values: r.values }));
        await client.query(
          `INSERT INTO snapshots (id, table_slug, period, account, published_at, business_day, sequence, tier, row_allowance, content_allowance_kilobytes, retention, row_count, content_bytes, rows)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (table_slug, period) DO NOTHING`,
          [uid('snap'), s.table_slug, s.period, s.account, s.published_at, businessDay(s.published_at), s.sequence,
           tier.name, tier.row_allowance, tier.content_allowance_kilobytes, tier.retention,
           frozen.length, rowsContentBytes(COLUMNS[s.table_slug], frozen), JSON.stringify(frozen)]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // report the counts the brief names
  const r = await pool.query(`SELECT
    (SELECT count(*) FROM departments) AS departments,
    (SELECT count(*) FROM tiers) AS tiers,
    (SELECT count(*) FROM accounts) AS accounts,
    (SELECT count(*) FROM role_grants) AS role_grants,
    (SELECT count(*) FROM department_grants) AS department_grants,
    (SELECT count(*) FROM tables) AS tables,
    (SELECT count(*) FROM columns) AS columns,
    (SELECT count(*) FROM rows) AS rows,
    (SELECT count(*) FROM views) AS views,
    (SELECT count(*) FROM log_entries) AS log_entries,
    (SELECT count(*) FROM snapshots) AS snapshots,
    (SELECT count(*) FROM requests) AS requests,
    (SELECT count(*) FROM sessions) AS sessions,
    (SELECT count(*) FROM subscribers) AS subscribers,
    (SELECT count(*) FROM enquiries) AS enquiries,
    (SELECT count(*) FROM login_attempts) AS login_attempts`);
  const c = r.rows[0];
  const expect = { departments: 3, tiers: 4, accounts: 8, role_grants: 9, department_grants: 4, tables: 5, rows: 6520, views: 0, log_entries: 0, snapshots: 4, requests: 3, sessions: 1, subscribers: 0, enquiries: 0, login_attempts: 0 };
  let ok = true;
  for (const [k, v] of Object.entries(expect)) {
    if (Number(c[k]) !== v) { ok = false; console.log('  MISMATCH ' + k + ': ' + c[k] + ' expected ' + v); }
  }
  console.log(ok ? 'Store reset to the seeded baseline: all counts match.' : 'Store reset with mismatches above.');
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
