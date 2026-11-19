'use strict';

// Tenant scoping, the available-balance computation, balance movements and the
// serialisers. Each of these is defined once and read everywhere.

const db = require('./db');
const clock = require('./clock');
const errors = require('./errors');
const validate = require('./validate');
const audit = require('./audit');

// An account's available balance is its balance minus the total debits of its
// payments waiting for approval.
const ACCOUNT_COLUMNS = `
  SELECT a.id, a.name, a.kind, a.balance_cents, a.position, a.company_id,
         a.balance_cents - COALESCE(h.held, 0) AS available_cents
    FROM accounts a
    LEFT JOIN (
      SELECT source_account_id, SUM(total_debit_cents) AS held
        FROM payments
       WHERE status = 'pending_approval'
       GROUP BY source_account_id
    ) h ON h.source_account_id = a.id
`;

function runner(client) {
  return client ? (text, params) => client.query(text, params) : (text, params) => db.query(text, params);
}

// An id of another company, or one that is not of the form the server issues,
// is treated exactly like an id that does not exist.
function requireWellFormedId(value) {
  if (!validate.isWellFormedId(value)) throw errors.notFound();
  return value;
}

async function getAccount(client, companyId, accountId) {
  requireWellFormedId(accountId);
  const result = await runner(client)(`${ACCOUNT_COLUMNS} WHERE a.id = $1 AND a.company_id = $2`, [
    accountId,
    companyId,
  ]);
  if (result.rows.length === 0) throw errors.notFound();
  return result.rows[0];
}

async function getAccountForUpdate(client, companyId, accountId) {
  requireWellFormedId(accountId);
  const owned = await client.query(
    'SELECT id FROM accounts WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [accountId, companyId]
  );
  if (owned.rows.length === 0) throw errors.notFound();
  return getAccount(client, companyId, accountId);
}

async function listAccounts(client, companyId) {
  const result = await runner(client)(
    `${ACCOUNT_COLUMNS} WHERE a.company_id = $1 ORDER BY a.position, a.created_at, a.id`,
    [companyId]
  );
  return result.rows;
}

async function getRecipient(client, companyId, recipientId, { includeRemoved = false } = {}) {
  requireWellFormedId(recipientId);
  const result = await runner(client)(
    `SELECT * FROM recipients WHERE id = $1 AND company_id = $2${
      includeRemoved ? '' : " AND status <> 'removed'"
    }`,
    [recipientId, companyId]
  );
  if (result.rows.length === 0) throw errors.notFound();
  return result.rows[0];
}

async function getPayment(client, companyId, paymentId) {
  requireWellFormedId(paymentId);
  const result = await runner(client)(
    'SELECT * FROM payments WHERE id = $1 AND company_id = $2',
    [paymentId, companyId]
  );
  if (result.rows.length === 0) throw errors.notFound();
  return result.rows[0];
}

async function getInvoice(client, companyId, invoiceId) {
  requireWellFormedId(invoiceId);
  const result = await runner(client)(
    'SELECT * FROM invoices WHERE id = $1 AND company_id = $2',
    [invoiceId, companyId]
  );
  if (result.rows.length === 0) throw errors.notFound();
  return result.rows[0];
}

async function getLoan(client, companyId, loanId) {
  requireWellFormedId(loanId);
  const result = await runner(client)('SELECT * FROM loans WHERE id = $1 AND company_id = $2', [
    loanId,
    companyId,
  ]);
  if (result.rows.length === 0) throw errors.notFound();
  return result.rows[0];
}

// One balance change, its feed row and its balance update, in the caller's
// transaction.
async function writeMovement(client, row) {
  const id = db.newId();
  const createdAt = row.createdAt || clock.now();
  await client.query(
    `INSERT INTO transactions
       (id, company_id, account_id, direction, amount_cents, method, counterparty, memo, transfer_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      row.companyId,
      row.accountId,
      row.direction,
      row.amountCents,
      row.method,
      row.counterparty,
      row.memo === undefined ? null : row.memo,
      row.transferId || null,
      createdAt,
    ]
  );
  const delta = row.direction === 'credit' ? row.amountCents : -row.amountCents;
  await client.query('UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id = $2', [
    delta,
    row.accountId,
  ]);
  return { id, createdAt };
}

function serializeAccount(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    balance_cents: Number(row.balance_cents),
    available_cents: Number(row.available_cents),
    currency: 'USD',
  };
}

function serializeTransaction(row) {
  return {
    id: row.id,
    account_id: row.account_id,
    direction: row.direction,
    amount_cents: Number(row.amount_cents),
    method: row.method,
    counterparty: row.counterparty,
    memo: row.memo === null || row.memo === undefined ? null : row.memo,
    status: 'posted',
    transfer_id: row.transfer_id || null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

function isoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function paymentApprovals(client, paymentId) {
  const result = await runner(client)(
    'SELECT user_id, user_name, approved_at FROM payment_approvals WHERE payment_id = $1 ORDER BY approved_at, id',
    [paymentId]
  );
  return result.rows.map((row) => ({
    user_id: row.user_id,
    name: row.user_name,
    at: new Date(row.approved_at).toISOString(),
  }));
}

async function serializePayment(client, row) {
  return {
    id: row.id,
    source_account_id: row.source_account_id,
    recipient_id: row.recipient_id,
    recipient_name: row.recipient_name,
    method: row.method,
    amount_cents: Number(row.amount_cents),
    memo: row.memo === null || row.memo === undefined ? null : row.memo,
    status: row.status,
    scheduled_for: isoDate(row.scheduled_for),
    effective_date: isoDate(row.effective_date),
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    approve_by: isoDate(row.approve_by),
    fx_quote_id: row.fx_quote_id || null,
    total_debit_cents: Number(row.total_debit_cents),
    approvals_required: Number(row.approvals_required),
    approvals: await paymentApprovals(client, row.id),
    created_by: row.created_by,
    created_at: new Date(row.created_at).toISOString(),
  };
}

function serializeRecipient(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    kind: row.kind || null,
    method: row.method || null,
    status: row.status,
    account_last4: row.account_last4 || null,
    email: row.email || null,
  };
}

function serializeInvoice(row) {
  return {
    id: row.id,
    number: row.number,
    customer_name: row.customer_name,
    total_cents: Number(row.total_cents),
    status: row.status,
    paid_into_account_id: row.paid_into_account_id || null,
  };
}

function serializeLoan(row) {
  const principal = Number(row.principal_cents);
  const drawn = Number(row.drawn_cents);
  return {
    id: row.id,
    name: row.name,
    principal_cents: principal,
    drawn_cents: drawn,
    remaining_cents: principal - drawn,
    funding_account_id: row.funding_account_id,
  };
}

module.exports = {
  ACCOUNT_COLUMNS,
  requireWellFormedId,
  getAccount,
  getAccountForUpdate,
  listAccounts,
  getRecipient,
  getPayment,
  getInvoice,
  getLoan,
  writeMovement,
  paymentApprovals,
  serializeAccount,
  serializeTransaction,
  serializePayment,
  serializeRecipient,
  serializeInvoice,
  serializeLoan,
  isoDate,
  audit,
};
