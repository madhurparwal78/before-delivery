/**
 * Puts the development stack back to the state Seed data describes: no orders, holds, invoices or
 * Kill Bill records, and no reconciliation mismatch. The app schema is recreated and reseeded the
 * next time the server starts.
 *
 * Usage: node scripts/reset-data.mjs [--killbill-only|--app-only]
 */
import pg from 'pg';

const mode = process.argv[2] ?? '--all';

const KILLBILL_DB = {
  host: process.env.KILLBILL_DB_HOST ?? 'killbill-db',
  port: Number(process.env.KILLBILL_DB_PORT ?? '3306'),
  user: process.env.KILLBILL_DB_USER ?? 'root',
  password: process.env.KILLBILL_DB_PASSWORD ?? 'killbill',
  database: process.env.KILLBILL_DB_NAME ?? 'killbill',
};

async function resetApp() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  console.log('app schema dropped; restart the server to reapply the schema and seed');
}

async function resetKillBill() {
  const { default: mysql } = await import('mysql2/promise');
  const connection = await mysql.createConnection(KILLBILL_DB);
  const [accounts] = await connection.query(
    "SELECT id, record_id, external_key FROM accounts WHERE external_key LIKE 'kerf-%'",
  );
  if (accounts.length === 0) {
    console.log('no kerf- accounts in kill bill');
    await connection.end();
    return;
  }
  const ids = accounts.map((row) => row.id);
  const recordIds = accounts.map((row) => row.record_id);
  const [tables] = await connection.query(
    `SELECT DISTINCT table_name AS t, column_name AS c FROM information_schema.columns
     WHERE table_schema = ? AND column_name IN ('account_id', 'account_record_id')`,
    [KILLBILL_DB.database],
  );
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { t, c } of tables) {
    const values = c === 'account_id' ? ids : recordIds;
    await connection.query(`DELETE FROM \`${t}\` WHERE \`${c}\` IN (?)`, [values]);
  }
  await connection.query('DELETE FROM accounts WHERE id IN (?)', [ids]);
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  await connection.end();
  console.log(`removed ${ids.length} kerf- accounts from kill bill:`, accounts.map((a) => a.external_key).join(', '));
}

async function resetMailpit() {
  const base = (process.env.MAILPIT_URL ?? 'http://mailpit:8025').replace(/\/+$/, '');
  const response = await fetch(`${base}/api/v1/messages`, { method: 'DELETE' });
  console.log(`mailpit cleared: ${response.status}`);
}

if (mode === '--all' || mode === '--app-only') await resetApp();
if (mode === '--all' || mode === '--killbill-only') await resetKillBill();
if (mode === '--all' || mode === '--app-only') await resetMailpit();
