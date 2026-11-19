'use strict';

// Effective-date posting and approval expiry, inside the served app. Each New
// York midnight is resolved on its own date, and a start that is already past a
// due instant catches up in order of due instant, then created_at.

const db = require('./db');
const clock = require('./clock');
const nytime = require('./nytime');
const domain = require('./domain');
const holds = require('./holds');
const core = require('./payments_core');

const TICK_MS = 5000;

async function processScheduled(row) {
  await db.transaction(async (client) => {
    await db.lockCompany(client, row.company_id);
    const found = await client.query(
      "SELECT * FROM payments WHERE id = $1 AND status = 'scheduled' FOR UPDATE",
      [row.id]
    );
    if (found.rows.length === 0) return;
    const payment = found.rows[0];
    const account = await domain.getAccount(client, row.company_id, payment.source_account_id);
    if (Number(account.available_cents) < Number(payment.total_debit_cents)) {
      await core.failPayment(client, { companyId: row.company_id, payment });
      return;
    }
    await core.postPayment(client, {
      companyId: row.company_id,
      payment,
      actorEmail: require('./audit').SYSTEM_ACTOR,
      effectiveDate: domain.isoDate(payment.effective_date),
    });
  });
}

async function processExpiry(row) {
  await db.transaction(async (client) => {
    await db.lockCompany(client, row.company_id);
    const found = await client.query(
      "SELECT * FROM payments WHERE id = $1 AND status = 'pending_approval' FOR UPDATE",
      [row.id]
    );
    if (found.rows.length === 0) return;
    await holds.expirePayment(client, row.company_id, found.rows[0]);
  });
}

async function runOnce() {
  const nowMs = clock.nowMs();
  const due = [];

  const scheduled = await db.query(
    "SELECT id, company_id, effective_date, created_at FROM payments WHERE status = 'scheduled'"
  );
  for (const row of scheduled.rows) {
    const date = domain.isoDate(row.effective_date);
    if (!date) continue;
    const dueMs = nytime.nyMidnightUtc(date);
    if (dueMs <= nowMs) due.push({ kind: 'scheduled', row, dueMs, createdAt: new Date(row.created_at).getTime() });
  }

  const held = await db.query(
    `SELECT id, company_id, expires_at, created_at FROM payments
      WHERE status = 'pending_approval' AND expires_at <= $1`,
    [new Date(nowMs)]
  );
  for (const row of held.rows) {
    due.push({
      kind: 'expiry',
      row,
      dueMs: new Date(row.expires_at).getTime(),
      createdAt: new Date(row.created_at).getTime(),
    });
  }

  due.sort((a, b) => a.dueMs - b.dueMs || a.createdAt - b.createdAt);
  for (const item of due) {
    if (item.kind === 'scheduled') await processScheduled(item.row);
    else await processExpiry(item.row);
  }
}

let running = false;

function tick() {
  if (running) return;
  running = true;
  runOnce()
    .catch(() => {})
    .finally(() => {
      running = false;
    });
}

function start() {
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
}

module.exports = { start, tick, runOnce };
