import { SCHEMA_SQL } from './schema.js';
import { query, withTransaction } from './db.js';
import { now } from './clock.js';
import { nyDateStr, nyMidnightUtcMs, dateFromStr } from './calendar.js';
import { hashPassword } from './password.js';
import { issueId } from './ids.js';

export let ready = false;

export async function ensureSchema() {
  await query(SCHEMA_SQL);
}

// Seeds run only when the database holds none, at the first moment it is
// reachable. Every business time comes from the business clock.
export async function ensureSeed() {
  const existing = await query('SELECT 1 FROM companies LIMIT 1');
  if (existing.rowCount > 0) return;
  const seedAt = new Date(now());

  await withTransaction(async (client) => {
    const users = [
      [issueId('user'), 'owner@example.com', 'Rowan Pike'],
      [issueId('user'), 'admin@example.com', 'Imani Cole'],
      [issueId('user'), 'member@example.com', 'Theo Marsh'],
      [issueId('user'), 'outsider@example.com', 'Sasha Reyes'],
    ];
    for (const [id, email, name] of users) {
      await client.query(
        'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)',
        [id, email, name, hashPassword('deku-demo-pw-2026'), seedAt]
      );
    }

    const lark = issueId('comp');
    const outpost = issueId('comp');
    await client.query('INSERT INTO companies (id, name, created_at) VALUES ($1,$2,$3)', [lark, 'Larkspur Studio', seedAt]);
    await client.query('INSERT INTO companies (id, name, created_at) VALUES ($1,$2,$3)', [outpost, 'Outpost Goods', seedAt]);

    await client.query('INSERT INTO memberships (user_id, company_id, role) VALUES ($1,$2,$3)', [users[0][0], lark, 'owner']);
    await client.query('INSERT INTO memberships (user_id, company_id, role) VALUES ($1,$2,$3)', [users[1][0], lark, 'admin']);
    await client.query('INSERT INTO memberships (user_id, company_id, role) VALUES ($1,$2,$3)', [users[2][0], lark, 'member']);
    await client.query('INSERT INTO memberships (user_id, company_id, role) VALUES ($1,$2,$3)', [users[3][0], outpost, 'owner']);

    const checking = issueId('acct');
    const savings = issueId('acct');
    const outpostChecking = issueId('acct');
    await client.query('INSERT INTO accounts (id, company_id, name, kind, balance_cents, created_at, seq) VALUES ($1,$2,$3,$4,$5,$6,1)', [checking, lark, 'Checking', 'checking', 1842050, seedAt]);
    await client.query('INSERT INTO accounts (id, company_id, name, kind, balance_cents, created_at, seq) VALUES ($1,$2,$3,$4,$5,$6,2)', [savings, lark, 'Savings', 'savings', 6000000, seedAt]);
    await client.query('INSERT INTO accounts (id, company_id, name, kind, balance_cents, created_at, seq) VALUES ($1,$2,$3,$4,$5,$6,1)', [outpostChecking, outpost, 'Outpost Checking', 'checking', 250000, seedAt]);

    // Transactions are created at 12:00 New York noon on the date N days
    // before the first-start date, stepping by calendar dates.
    const atNoon = (daysBefore) => {
      const base = nyDateStr(now());
      const [y, m, d] = base.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1, d - daysBefore));
      const midnight = nyMidnightUtcMs(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
      if (midnight === null) return new Date(now());
      return new Date(midnight + 12 * 3600 * 1000);
    };

    const rows = [
      [issueId('txn'), checking, 'credit', 1555690, 'Larkspur Studio', 'ach', 20],
      [issueId('txn'), checking, 'credit', 420000, 'Brightline Media', 'ach', 12],
      [issueId('txn'), checking, 'debit', 125000, 'Northwind Supply', 'ach', 6],
      [issueId('txn'), checking, 'debit', 8640, 'Corner Print Shop', 'card', 2],
      [issueId('txn'), savings, 'credit', 6000000, 'Larkspur Studio', 'ach', 25],
      [issueId('txn'), outpostChecking, 'credit', 250000, 'Outpost Goods', 'ach', 10],
    ];
    let seq = 1;
    for (const [id, accountId, direction, amount, counterparty, method, daysBefore] of rows) {
      await client.query(
        'INSERT INTO transactions (id, account_id, direction, amount_cents, method, counterparty, memo, status, transfer_id, created_at, seq) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,NULL,$8,$9)',
        [id, accountId, direction, amount, method, counterparty, 'posted', atNoon(daysBefore), seq++]
      );
    }

    await client.query(
      "INSERT INTO recipients (id, company_id, display_name, kind, method, status, account_last4, routing_number, account_number_enc, email, created_at) VALUES ($1,$2,$3,'business','ach','active','6612',$4,$5,NULL,$6)",
      [issueId('rcpt'), lark, 'Northwind Supply', '021000021', Buffer.from('000123456612', 'utf8'), seedAt]
    );
    await client.query(
      "INSERT INTO recipients (id, company_id, display_name, kind, method, status, account_last4, routing_number, account_number_enc, email, created_at) VALUES ($1,$2,$3,'business','ach','active','4321',$4,$5,NULL,$6)",
      [issueId('rcpt'), outpost, 'Cedar Freight', '021000021', Buffer.from('000987654321', 'utf8'), seedAt]
    );

    const invoices = [
      [issueId('invc'), lark, 'INV-1002', 'Brightline Media', 275000, 'sent'],
      [issueId('invc'), lark, 'INV-1003', 'Brightline Media', 90000, 'draft'],
      [issueId('invc'), lark, 'INV-1004', 'Fieldstone', 61875, 'sent'],
      [issueId('invc'), lark, 'INV-1005', 'Harbor Row Cafe', 12500, 'sent'],
    ];
    for (const [id, companyId, number, customer, total, status] of invoices) {
      await client.query(
        'INSERT INTO invoices (id, company_id, number, customer_name, total_cents, status, paid_into_account_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7)',
        [id, companyId, number, customer, total, status, seedAt]
      );
    }

    await client.query(
      'INSERT INTO loans (id, company_id, name, principal_cents, drawn_cents, funding_account_id, created_at) VALUES ($1,$2,$3,$4,0,$5,$6)',
      [issueId('loan'), lark, 'Larkspur Venture Line', 25000000, checking, seedAt]
    );

    const plans = [
      ['plan_base', 'base', 0, 0, 'Core banking'],
      ['plan_plus', 'plus', 2390, 29590, 'More efficiencies'],
      ['plan_pro', 'pro', 34990, 239990, 'Complex operations'],
    ];
    for (const [id, name, monthly, annual, features] of plans) {
      await client.query('INSERT INTO plans (id, name, monthly_cents, annual_cents, features) VALUES ($1,$2,$3,$4,$5)', [id, name, monthly, annual, features]);
    }
  });
  ready = true;
}

export async function initWhenReachable() {
  try {
    await ensureSchema();
    await ensureSeed();
    ready = true;
    return true;
  } catch (err) {
    ready = false;
    return false;
  }
}
