import { query, withTransaction, isUnreachable } from './db.js';
import { now, isoAt } from './clock.js';
import { nyDateStr, nyParts, nyMidnightUtcMs, dateFromStr, dateStr, addCalendarDays, endOfDayNy, zonedParts } from './calendar.js';
import { issueId, isWellFormedId, token, sha256Hex } from './ids.js';
import { readAmountCents, roundHalfUp } from './money.js';
import { baseStringRefusal, singleLineRefusal, multiLineRefusal, codePoints, normalizeNfc } from './text.js';
import { effectiveDateForPost, effectiveDateForSchedule, approvalExpiry, approvalsRequiredFor, APPROVAL_THRESHOLD_CENTS } from './domain.js';
import {
  ApiError, errUnauthorized, errForbidden, errNotFound, errValidation, errInvalidJson,
  errServiceUnavailable, errInternal, sendJson,
} from './http.js';
import { hashPassword, verifyPassword } from './password.js';
import { ready } from './bootstrap.js';
import {
  LOCKOUT_MAX_FAILURES, LOGIN_LOCKOUT_WINDOW_SECONDS, INQUIRY_RATE_WINDOW_SECONDS,
  INQUIRY_MAX_IN_WINDOW, FX_QUOTE_TTL_SECONDS, MAX_BODY_BYTES,
} from './config.js';
import { emitTransaction } from './stream-bus.js';

const MAX_SAFE = 9007199254740991;

// ---------- session ----------

export async function requireSession(req) {
  const header = String(req.headers.authorization || '');
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) throw errUnauthorized();
  const tok = m[1];
  const res = await query(
    `SELECT s.token, u.id, u.email, u.name, m.company_id, m.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = u.id
     WHERE s.token = $1`,
    [tok]
  );
  if (res.rowCount === 0) throw errUnauthorized();
  return res.rows[0];
}

export async function findSessionByToken(tok) {
  if (!tok) return null;
  const res = await query(
    `SELECT s.token, u.id, u.email, u.name, m.company_id, m.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = u.id
     WHERE s.token = $1`,
    [tok]
  );
  return res.rowCount === 0 ? null : res.rows[0];
}

export function isOwnerOrAdmin(sess) {
  return sess.role === 'owner' || sess.role === 'admin';
}

// ---------- audit ----------

export async function writeAudit(client, companyId, action, paymentId, amountCents, actorEmail, atMs) {
  const seqRes = await client.query(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM audit_events WHERE company_id = $1',
    [companyId]
  );
  const seq = Number(seqRes.rows[0].seq);
  const prevRes = await client.query(
    'SELECT hash FROM audit_events WHERE company_id = $1 ORDER BY seq DESC LIMIT 1',
    [companyId]
  );
  const prevHash = prevRes.rowCount === 0 ? '0'.repeat(64) : prevRes.rows[0].hash;
  const hash = sha256Hex(`${prevHash}|${seq}|${action}|${paymentId || ''}|${amountCents}|${actorEmail}`);
  await client.query(
    'INSERT INTO audit_events (company_id, seq, action, payment_id, amount_cents, actor_email, prev_hash, hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [companyId, seq, action, paymentId, amountCents, actorEmail, prevHash, hash, new Date(atMs)]
  );
}

// ---------- serialization helpers ----------

export function accountOut(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    balance_cents: Number(row.balance_cents),
    available_cents: Number(row.available_cents ?? row.balance_cents),
    currency: 'USD',
  };
}

export function transactionOut(row) {
  return {
    id: row.id,
    account_id: row.account_id,
    direction: row.direction,
    amount_cents: Number(row.amount_cents),
    method: row.method,
    counterparty: row.counterparty,
    memo: row.memo === undefined ? null : row.memo,
    status: 'posted',
    transfer_id: row.transfer_id,
    created_at: isoAt(new Date(row.created_at).getTime()),
  };
}

export function recipientOut(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    kind: row.kind,
    method: row.method,
    status: row.status,
    account_last4: row.account_last4,
    email: row.email,
  };
}

export async function loadPayment(client, companyId, paymentId) {
  if (!isWellFormedId(paymentId)) return null;
  const res = await client.query('SELECT * FROM payments WHERE id = $1 AND company_id = $2', [paymentId, companyId]);
  return res.rowCount === 0 ? null : res.rows[0];
}

export async function loadPaymentFromPool(queryFn, companyId, paymentId) {
  return loadPayment({ query: queryFn }, companyId, paymentId);
}

export async function approvalsForPayment(client, paymentId) {
  const res = await client.query(
    `SELECT a.user_id, a.at, u.name FROM payment_approvals a JOIN users u ON u.id = a.user_id
     WHERE a.payment_id = $1 ORDER BY a.at, a.user_id`,
    [paymentId]
  );
  return res.rows.map((r) => ({ user_id: r.user_id, name: r.name, at: isoAt(new Date(r.at).getTime()) }));
}

export async function approvalsForPaymentFromPool(queryFn, paymentId) {
  return approvalsForPayment({ query: queryFn }, paymentId);
}

export function paymentOut(row, approvals) {
  return {
    id: row.id,
    source_account_id: row.source_account_id,
    recipient_id: row.recipient_id,
    recipient_name: row.recipient_name,
    method: row.method,
    amount_cents: Number(row.amount_cents),
    memo: row.memo,
    status: row.status,
    scheduled_for: row.scheduled_for ? row.scheduled_for.toISOString().slice(0, 10) : null,
    effective_date: row.effective_date ? row.effective_date.toISOString().slice(0, 10) : null,
    expires_at: row.expires_at ? isoAt(new Date(row.expires_at).getTime()) : null,
    approve_by: row.approve_by ? row.approve_by.toISOString().slice(0, 10) : null,
    fx_quote_id: row.fx_quote_id,
    total_debit_cents: Number(row.total_debit_cents),
    approvals_required: row.approvals_required,
    approvals: approvals || [],
    created_by: row.created_by,
    created_at: isoAt(new Date(row.created_at).getTime()),
  };
}

// ---------- available balance ----------

// The pool is a connection provider, not a client; these wrappers give it the
// same query interface a transaction client has.
export async function accountWithAvailableFor(queryFn, companyId, accountId) {
  return accountWithAvailable({ query: queryFn }, companyId, accountId);
}

export async function accountWithAvailable(client, companyId, accountId) {
  const res = await client.query(
    `SELECT a.*, COALESCE(
       (SELECT SUM(p.total_debit_cents) FROM payments p
        WHERE p.source_account_id = a.id AND p.status = 'pending_approval'), 0) AS held_cents
     FROM accounts a WHERE a.id = $1 AND a.company_id = $2`,
    [accountId, companyId]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return { ...row, available_cents: Number(row.balance_cents) - Number(row.held_cents) };
}

// ---------- debit/credit writes ----------

export async function applyDebit(client, accountId, amountCents, counterparty, method, memo, transferId, atMs, txId) {
  const upd = await client.query(
    'UPDATE accounts SET balance_cents = balance_cents - $1 WHERE id = $2 RETURNING balance_cents',
    [amountCents, accountId]
  );
  await client.query(
    `INSERT INTO transactions (id, account_id, direction, amount_cents, method, counterparty, memo, status, transfer_id, created_at)
     VALUES ($1,$2,'debit',$3,$4,$5,$6,'posted',$7,$8)`,
    [txId || issueId('txn'), accountId, amountCents, method, counterparty, memo ?? null, transferId ?? null, new Date(atMs)]
  );
  return Number(upd.rows[0].balance_cents);
}

export async function applyCredit(client, accountId, amountCents, counterparty, method, memo, transferId, atMs, txId) {
  const upd = await client.query(
    'UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id = $2 RETURNING balance_cents',
    [amountCents, accountId]
  );
  await client.query(
    `INSERT INTO transactions (id, account_id, direction, amount_cents, method, counterparty, memo, status, transfer_id, created_at)
     VALUES ($1,$2,'credit',$3,$4,$5,$6,'posted',$7,$8)`,
    [txId || issueId('txn'), accountId, amountCents, method, counterparty, memo ?? null, transferId ?? null, new Date(atMs)]
  );
  return Number(upd.rows[0].balance_cents);
}

export { emitTransaction };
