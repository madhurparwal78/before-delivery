'use strict';

// Snapshots, sparklines and statement opening balances all read the one
// New York end-of-day rule: a day's balance counts every transaction created
// at or before 23:59:59.999 New York time on that date.

const db = require('./db');
const clock = require('./clock');
const nytime = require('./nytime');
const domain = require('./domain');

const SPARKLINE_DAYS = 30;

function sparklineDates(todayDate) {
  const dates = [];
  for (let i = SPARKLINE_DAYS - 1; i >= 0; i -= 1) dates.push(nytime.addDays(todayDate, -i));
  return dates;
}

async function signedSumsByAccountAndDate(client, companyId, fromMs) {
  const result = await client.query(
    `SELECT account_id, direction, amount_cents, created_at
       FROM transactions
      WHERE company_id = $1 AND created_at >= $2`,
    [companyId, new Date(fromMs)]
  );
  const sums = new Map();
  for (const row of result.rows) {
    const date = nytime.nyDate(new Date(row.created_at).getTime());
    const key = `${row.account_id}|${date}`;
    const signed = (row.direction === 'credit' ? 1 : -1) * Number(row.amount_cents);
    sums.set(key, (sums.get(key) || 0) + signed);
  }
  return sums;
}

function sparklineFor(accountId, balanceCents, dates, sums) {
  const values = new Array(dates.length);
  values[dates.length - 1] = balanceCents;
  for (let i = dates.length - 2; i >= 0; i -= 1) {
    const dayAfter = sums.get(`${accountId}|${dates[i + 1]}`) || 0;
    values[i] = values[i + 1] - dayAfter;
  }
  return values;
}

// Read from one database snapshot, so balances, holds and totals agree.
async function companySnapshot(companyId) {
  return db.readSnapshot(async (client) => {
    const accounts = await domain.listAccounts(client, companyId);
    const today = nytime.nyDate(clock.nowMs());
    const dates = sparklineDates(today);
    const sums = await signedSumsByAccountAndDate(
      client,
      companyId,
      nytime.nyMidnightUtc(dates[0])
    );
    let totalCash = 0;
    let totalAvailable = 0;
    const perAccount = accounts.map((row) => {
      const balance = Number(row.balance_cents);
      const available = Number(row.available_cents);
      totalCash += balance;
      totalAvailable += available;
      return {
        account_id: row.id,
        balance_cents: balance,
        available_cents: available,
        sparkline: sparklineFor(row.id, balance, dates, sums),
      };
    });
    return {
      total_cash_cents: totalCash,
      total_available_cents: totalAvailable,
      per_account: perAccount,
    };
  });
}

// The account's balance at 23:59:59.999 New York time on the day before `date`.
async function openingBalance(client, accountId, dateStr) {
  const boundary = nytime.nyMidnightUtc(dateStr);
  const result = await client.query(
    `SELECT
       (SELECT balance_cents FROM accounts WHERE id = $1) AS balance,
       COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) AS after
     FROM transactions
     WHERE account_id = $1 AND created_at >= $2`,
    [accountId, new Date(boundary)]
  );
  const row = result.rows[0];
  return Number(row.balance) - Number(row.after);
}

module.exports = { SPARKLINE_DAYS, companySnapshot, openingBalance, sparklineDates };
