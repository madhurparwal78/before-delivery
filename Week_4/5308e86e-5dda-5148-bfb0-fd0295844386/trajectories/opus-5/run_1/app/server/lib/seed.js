'use strict';

// The starting data, written at the first moment the database is reachable and
// holds none. Every seeded transaction is dated from the first-start date.

const crypto = require('crypto');
const db = require('./db');
const clock = require('./clock');
const nytime = require('./nytime');
const passwords = require('./passwords');

const SEED_PASSWORD = 'deku-demo-pw-2026';

const PLANS = [
  { name: 'base', monthly_cents: 0, annual_cents: 0, features: ['Free checking and savings', 'Free ACH and USD wires', 'Virtual Lift Cards'] },
  { name: 'plus', monthly_cents: 2390, annual_cents: 29590, features: ['Streamlined invoicing', 'Auto-transfer rules', 'Approval rules'] },
  { name: 'pro', monthly_cents: 34990, annual_cents: 239990, features: ['Relationship manager', 'Custom approval chains', 'Priority support'] },
];

function accountFingerprint(routingNumber, accountNumber) {
  return crypto.createHash('sha256').update(`${routingNumber}:${accountNumber}`, 'utf8').digest('hex');
}

// Noon New York time on the calendar date N days before the first-start date.
function seededInstant(firstStartDate, daysBefore) {
  const date = nytime.addDays(firstStartDate, -daysBefore);
  return new Date(nytime.nyWallToUtc(date, 12, 0, 0, 0));
}

async function insertUser(client, { email, name, passwordHash, createdAt }) {
  const id = db.newId();
  await client.query(
    'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, email, name, passwordHash, createdAt]
  );
  return id;
}

async function insertCompany(client, name, createdAt) {
  const id = db.newId();
  await client.query('INSERT INTO companies (id, name, created_at) VALUES ($1, $2, $3)', [
    id,
    name,
    createdAt,
  ]);
  return id;
}

async function insertMembership(client, userId, companyId, role, createdAt) {
  await client.query(
    'INSERT INTO memberships (id, user_id, company_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
    [db.newId(), userId, companyId, role, createdAt]
  );
}

async function insertAccount(client, { companyId, name, kind, balanceCents, position, createdAt }) {
  const id = db.newId();
  await client.query(
    `INSERT INTO accounts (id, company_id, name, kind, balance_cents, position, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, companyId, name, kind, balanceCents, position, createdAt]
  );
  return id;
}

async function insertTransaction(client, row) {
  await client.query(
    `INSERT INTO transactions
       (id, company_id, account_id, direction, amount_cents, method, counterparty, memo, transfer_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8)`,
    [db.newId(), row.companyId, row.accountId, row.direction, row.amountCents, row.method, row.counterparty, row.createdAt]
  );
}

async function insertRecipient(client, row) {
  await client.query(
    `INSERT INTO recipients
       (id, company_id, display_name, kind, method, status, account_last4, account_fingerprint, routing_number, email, created_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, NULL, $9)`,
    [
      db.newId(),
      row.companyId,
      row.displayName,
      row.kind,
      row.method,
      row.accountNumber.slice(-4),
      accountFingerprint(row.routingNumber, row.accountNumber),
      row.routingNumber,
      row.createdAt,
    ]
  );
}

async function seedIfEmpty() {
  return db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tallwind-seed']);
    const existing = await client.query('SELECT 1 FROM companies LIMIT 1');
    if (existing.rows.length > 0) {
      await client.query(
        `INSERT INTO app_state (key, value) VALUES ('seeded', 'true')
         ON CONFLICT (key) DO NOTHING`
      );
      return false;
    }

    const now = clock.now();
    const firstStartDate = nytime.nyDate(now);
    const passwordHash = await passwords.hashPassword(SEED_PASSWORD);

    for (const plan of PLANS) {
      await client.query(
        `INSERT INTO plans (id, name, monthly_cents, annual_cents, features, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO NOTHING`,
        [db.newId(), plan.name, plan.monthly_cents, plan.annual_cents, JSON.stringify(plan.features), PLANS.indexOf(plan)]
      );
    }

    // Larkspur Studio
    const larkspur = await insertCompany(client, 'Larkspur Studio', now);
    const owner = await insertUser(client, { email: 'owner@example.com', name: 'Rowan Pike', passwordHash, createdAt: now });
    const admin = await insertUser(client, { email: 'admin@example.com', name: 'Imani Cole', passwordHash, createdAt: now });
    const member = await insertUser(client, { email: 'member@example.com', name: 'Theo Marsh', passwordHash, createdAt: now });
    await insertMembership(client, owner, larkspur, 'owner', now);
    await insertMembership(client, admin, larkspur, 'admin', now);
    await insertMembership(client, member, larkspur, 'member', now);

    const checking = await insertAccount(client, {
      companyId: larkspur, name: 'Checking', kind: 'checking', balanceCents: 1842050, position: 0, createdAt: now,
    });
    const savings = await insertAccount(client, {
      companyId: larkspur, name: 'Savings', kind: 'savings', balanceCents: 6000000, position: 1, createdAt: now,
    });

    const checkingRows = [
      { daysBefore: 20, direction: 'credit', amountCents: 1555690, counterparty: 'Larkspur Studio', method: 'ach' },
      { daysBefore: 12, direction: 'credit', amountCents: 420000, counterparty: 'Brightline Media', method: 'ach' },
      { daysBefore: 6, direction: 'debit', amountCents: 125000, counterparty: 'Northwind Supply', method: 'ach' },
      { daysBefore: 2, direction: 'debit', amountCents: 8640, counterparty: 'Corner Print Shop', method: 'card' },
    ];
    for (const row of checkingRows) {
      await insertTransaction(client, {
        companyId: larkspur,
        accountId: checking,
        direction: row.direction,
        amountCents: row.amountCents,
        method: row.method,
        counterparty: row.counterparty,
        createdAt: seededInstant(firstStartDate, row.daysBefore),
      });
    }
    await insertTransaction(client, {
      companyId: larkspur,
      accountId: savings,
      direction: 'credit',
      amountCents: 6000000,
      method: 'ach',
      counterparty: 'Larkspur Studio',
      createdAt: seededInstant(firstStartDate, 25),
    });

    await insertRecipient(client, {
      companyId: larkspur,
      displayName: 'Northwind Supply',
      kind: 'business',
      method: 'ach',
      accountNumber: '000123456612',
      routingNumber: '021000021',
      createdAt: now,
    });

    const invoices = [
      { number: 'INV-1002', customer: 'Brightline Media', total: 275000, status: 'sent' },
      { number: 'INV-1003', customer: 'Brightline Media', total: 90000, status: 'draft' },
      { number: 'INV-1004', customer: 'Fieldstone', total: 61875, status: 'sent' },
      { number: 'INV-1005', customer: 'Harbor Row Cafe', total: 12500, status: 'sent' },
    ];
    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i];
      await client.query(
        `INSERT INTO invoices (id, company_id, number, customer_name, total_cents, status, paid_into_account_id, position, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
        [db.newId(), larkspur, invoice.number, invoice.customer, invoice.total, invoice.status, i, now]
      );
    }

    await client.query(
      `INSERT INTO loans (id, company_id, name, principal_cents, drawn_cents, funding_account_id, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6)`,
      [db.newId(), larkspur, 'Larkspur Venture Line', 25000000, checking, now]
    );

    // Outpost Goods
    const outpost = await insertCompany(client, 'Outpost Goods', now);
    const outsider = await insertUser(client, { email: 'outsider@example.com', name: 'Sasha Reyes', passwordHash, createdAt: now });
    await insertMembership(client, outsider, outpost, 'owner', now);
    const outpostChecking = await insertAccount(client, {
      companyId: outpost, name: 'Outpost Checking', kind: 'checking', balanceCents: 250000, position: 0, createdAt: now,
    });
    await insertTransaction(client, {
      companyId: outpost,
      accountId: outpostChecking,
      direction: 'credit',
      amountCents: 250000,
      method: 'ach',
      counterparty: 'Outpost Goods',
      createdAt: seededInstant(firstStartDate, 10),
    });
    await insertRecipient(client, {
      companyId: outpost,
      displayName: 'Cedar Freight',
      kind: 'business',
      method: 'ach',
      accountNumber: '000987654321',
      routingNumber: '021000021',
      createdAt: now,
    });

    await client.query(
      `INSERT INTO app_state (key, value) VALUES ('seeded', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [firstStartDate]
    );
    return true;
  });
}

module.exports = { seedIfEmpty, accountFingerprint, SEED_PASSWORD, PLANS };
