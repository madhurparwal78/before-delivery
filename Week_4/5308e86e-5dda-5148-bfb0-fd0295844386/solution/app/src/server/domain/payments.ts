/** Payments: creation, holds, approvals, rejection, cancellation, expiry and effective-date posting. */
import type { Tx } from "../db.js";
import { APPROVAL_THRESHOLD_CENTS, DUAL_APPROVAL_THRESHOLD_CENTS, PAYMENT_METHODS, SYSTEM_ACTOR, type PaymentMethod } from "../../shared/rules.js";
import { newYorkDate, newYorkMidnight } from "../clock.js";
import { Fields, forbidden, notFound, refusal } from "../http/errors.js";
import type { SessionUser } from "../http/context.js";
import { isId, newId } from "../ids.js";
import { approvalDeadline, scheduledEffectiveDate, settlementDate } from "../settlement.js";
import { findAccount } from "./accounts.js";
import { appendAudit } from "./audit.js";
import { lockQuote } from "./fx.js";
import { recordTransaction } from "./ledger.js";
import { findRecipientForSend } from "./recipients.js";
import { SCHEDULED_CAP } from "../../shared/messages.js";
import { isCalendarDate, readAmountCents, readMemo } from "./validate.js";

import type { Row } from "./row.js";

const PAYMENT_SELECT = `
  SELECT p.*,
         COALESCE((SELECT json_agg(json_build_object('user_id', a.user_id, 'name', a.name, 'at', a.approved_at) ORDER BY a.approved_at, a.user_id)
                   FROM payment_approvals a WHERE a.payment_id = p.id), '[]'::json) AS approvals
  FROM payments p`;

interface PaymentView {
  id: string;
  source_account_id: string;
  recipient_id: string;
  recipient_name: string;
  method: PaymentMethod;
  amount_cents: number;
  memo: string | null;
  status: string;
  scheduled_for: string | null;
  effective_date: string | null;
  expires_at: string | null;
  approve_by: string | null;
  fx_quote_id: string | null;
  total_debit_cents: number;
  approvals_required: number;
  approvals: Array<{ user_id: string; name: string; at: string }>;
  created_by: string;
  created_at: string;
}

function paymentView(row: Row): PaymentView {
  return {
    id: row.id,
    source_account_id: row.source_account_id,
    recipient_id: row.recipient_id,
    recipient_name: row.recipient_name,
    method: row.method,
    amount_cents: row.amount_cents,
    memo: row.memo,
    status: row.status,
    scheduled_for: row.scheduled_for,
    effective_date: row.effective_date,
    expires_at: row.expires_at ? (row.expires_at as Date).toISOString() : null,
    approve_by: row.approve_by,
    fx_quote_id: row.fx_quote_id,
    total_debit_cents: row.total_debit_cents,
    approvals_required: row.approvals_required,
    approvals: (row.approvals as Array<{ user_id: string; name: string; at: string }>).map((entry) => ({
      user_id: entry.user_id,
      name: entry.name,
      at: new Date(entry.at).toISOString(),
    })),
    created_by: row.created_by,
    created_at: (row.created_at as Date).toISOString(),
  };
}

async function readPayment(tx: Tx, id: string): Promise<PaymentView> {
  const found = await tx.query(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);
  return paymentView(found.rows[0]);
}

/** A payment of the company by id, or 404; optionally locking its row. */
async function findPayment(tx: Tx, companyId: string, id: unknown, lock: boolean): Promise<Row> {
  if (!isId(id)) throw notFound();
  const found = await tx.query(`SELECT * FROM payments WHERE id = $1 AND company_id = $2 ${lock ? "FOR UPDATE" : ""}`, [id, companyId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

export async function getPayment(tx: Tx, companyId: string, id: unknown): Promise<PaymentView> {
  const row = await findPayment(tx, companyId, id, false);
  return readPayment(tx, row.id);
}

export async function listPayments(tx: Tx, companyId: string): Promise<PaymentView[]> {
  const found = await tx.query(`${PAYMENT_SELECT} WHERE p.company_id = $1 ORDER BY p.created_at DESC, p.id DESC`, [companyId]);
  return found.rows.map(paymentView);
}

export async function listApprovals(tx: Tx, companyId: string): Promise<Array<PaymentView & { creator_name: string; source_account_name: string }>> {
  const found = await tx.query(
    `SELECT p.*, u.name AS creator_name, a.name AS source_account_name,
            COALESCE((SELECT json_agg(json_build_object('user_id', x.user_id, 'name', x.name, 'at', x.approved_at) ORDER BY x.approved_at, x.user_id)
                      FROM payment_approvals x WHERE x.payment_id = p.id), '[]'::json) AS approvals
     FROM payments p
     JOIN users u ON u.id = p.created_by
     JOIN accounts a ON a.id = p.source_account_id
     WHERE p.company_id = $1 AND p.status = 'pending_approval'
     ORDER BY p.created_at, p.id`,
    [companyId],
  );
  return found.rows.map((row) => ({ ...paymentView(row), creator_name: row.creator_name, source_account_name: row.source_account_name }));
}

/** Debits the source and writes the feed row. The account row is locked. */
async function debitSource(tx: Tx, payment: Row, now: Date): Promise<void> {
  await recordTransaction(tx, {
    companyId: payment.company_id,
    accountId: payment.source_account_id,
    direction: "debit",
    amountCents: payment.total_debit_cents,
    method: payment.method,
    counterparty: payment.recipient_name,
    memo: payment.memo,
    transferId: null,
    createdAt: now,
  });
}

/** Posts a payment that already exists: debit, status, effective date and audit event. Payment and account rows are locked. */
async function postExisting(tx: Tx, payment: Row, effectiveDate: string, actorEmail: string, now: Date): Promise<void> {
  await debitSource(tx, payment, now);
  await tx.query("UPDATE payments SET status = 'posted', effective_date = $2 WHERE id = $1", [payment.id, effectiveDate]);
  await appendAudit(tx, payment.company_id, "payment.posted", payment.id, payment.total_debit_cents, actorEmail);
}

interface PaymentInput {
  source_account_id?: unknown;
  recipient_id?: unknown;
  method?: unknown;
  amount_cents?: unknown;
  memo?: unknown;
  scheduled_for?: unknown;
  fx_quote_id?: unknown;
}

/** The body keys this endpoint reads, in one list. */
export function readPaymentKeys(body: Record<string, unknown>): PaymentInput {
  return {
    source_account_id: body.source_account_id,
    recipient_id: body.recipient_id,
    method: body.method,
    amount_cents: body.amount_cents,
    memo: body.memo,
    scheduled_for: body.scheduled_for,
    fx_quote_id: body.fx_quote_id,
  };
}

function requiredApprovals(amountCents: number): number {
  if (amountCents > DUAL_APPROVAL_THRESHOLD_CENTS) return 2;
  return amountCents > APPROVAL_THRESHOLD_CENTS ? 1 : 0;
}

export async function createPayment(tx: Tx, user: SessionUser, input: PaymentInput, now: Date): Promise<PaymentView> {
  const fields = new Fields();
  const has = (key: keyof PaymentInput) => input[key] !== undefined;

  const recipient = has("recipient_id") ? await findRecipientForSend(tx, user.companyId, input.recipient_id) : null;
  if (!recipient && !has("recipient_id")) fields.fail("recipient_id", "Choose a recipient");
  const source = has("source_account_id") ? await findAccount(tx, user.companyId, input.source_account_id, true) : null;
  if (!source && !has("source_account_id")) fields.fail("source_account_id", "Choose a source account");
  const quote = input.fx_quote_id === undefined || input.fx_quote_id === null ? null : await lockQuote(tx, user.companyId, input.fx_quote_id);

  const method = PAYMENT_METHODS.find((candidate) => candidate === input.method);
  if (!method) fields.fail("method", "Choose ACH, wire, real-time or check");
  const amount = readAmountCents(input.amount_cents, fields, "amount_cents");
  const memo = readMemo(input.memo, fields);
  if (recipient && recipient.status !== "active") fields.fail("recipient_id", "Choose a saved recipient");

  const today = newYorkDate(now);
  let scheduledFor: string | null = null;
  if (input.scheduled_for !== undefined && input.scheduled_for !== null) {
    if (typeof input.scheduled_for !== "string" || !isCalendarDate(input.scheduled_for) || input.scheduled_for <= today) {
      fields.fail("scheduled_for", "Choose a date after today");
    } else {
      scheduledFor = input.scheduled_for;
      if (amount !== null && amount > APPROVAL_THRESHOLD_CENTS) fields.fail("amount_cents", SCHEDULED_CAP);
    }
  }
  if (quote && (method !== "wire" || scheduledFor !== null || amount !== quote.amount_cents)) {
    fields.fail("fx_quote_id", "This quote does not match the payment");
  }
  fields.raise();
  if (!recipient || !source || !method || amount === null) throw new Error("unreachable: validated payment");

  if (quote) {
    if (quote.used_by_payment) throw refusal(409, "quote_used");
    if (now.getTime() >= (quote.expires_at as Date).getTime()) throw refusal(409, "quote_expired");
  }

  const id = newId();
  const totalDebit = quote ? quote.total_debit_cents : amount;
  const insert = (status: string, effective: string | null, scheduled: string | null, expiresAt: Date | null, approveBy: string | null, approvalsRequired: number) =>
    tx.query(
      `INSERT INTO payments (id, company_id, source_account_id, recipient_id, recipient_name, method, amount_cents, total_debit_cents, memo,
                             status, scheduled_for, effective_date, expires_at, approve_by, fx_quote_id, approvals_required, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [id, user.companyId, source.id, recipient.id, recipient.display_name, method, amount, totalDebit, memo,
        status, scheduled, effective, expiresAt, approveBy, quote ? quote.id : null, approvalsRequired, user.id, now],
    );

  if (scheduledFor !== null) {
    await insert("scheduled", scheduledEffectiveDate(method, scheduledFor), scheduledFor, null, null, 0);
    await appendAudit(tx, user.companyId, "payment.created", id, amount, user.email);
    return readPayment(tx, id);
  }

  if (source.available_cents < totalDebit) throw refusal(400, "insufficient_funds");
  if (quote) await tx.query("UPDATE fx_quotes SET used_by_payment = $2 WHERE id = $1", [quote.id, id]);

  const required = requiredApprovals(amount);
  if (required > 0) {
    const deadline = approvalDeadline(now);
    await insert("pending_approval", null, null, deadline.expiresAt, deadline.approveBy, required);
    await appendAudit(tx, user.companyId, "payment.created", id, amount, user.email);
    return readPayment(tx, id);
  }

  const effective = settlementDate(method, now);
  await insert("posted", effective, null, null, null, 0);
  await appendAudit(tx, user.companyId, "payment.created", id, amount, user.email);
  await debitSource(tx, { id, company_id: user.companyId, source_account_id: source.id, recipient_name: recipient.display_name, method, total_debit_cents: totalDebit, memo }, now);
  await appendAudit(tx, user.companyId, "payment.posted", id, totalDebit, user.email);
  return readPayment(tx, id);
}

/** What a decision on a held payment can answer without moving it. */
type Decision = { payment: PaymentView } | { refused: "payment_not_pending" | "already_approved" };

/** A held payment whose deadline passed is expired now, in the caller's transaction. */
async function expireIfDue(tx: Tx, payment: Row, now: Date): Promise<boolean> {
  if (payment.status !== "pending_approval" || now.getTime() < (payment.expires_at as Date).getTime()) return false;
  await expirePayment(tx, payment);
  return true;
}

export async function expirePayment(tx: Tx, payment: Row): Promise<void> {
  await tx.query("UPDATE payments SET status = 'expired' WHERE id = $1", [payment.id]);
  await appendAudit(tx, payment.company_id, "payment.expired", payment.id, payment.amount_cents, SYSTEM_ACTOR);
}

function requireApprover(user: SessionUser): void {
  if (user.role === "member") throw forbidden();
}

export async function approvePayment(tx: Tx, user: SessionUser, id: unknown, now: Date): Promise<Decision> {
  const payment = await findPayment(tx, user.companyId, id, true);
  requireApprover(user);
  if (payment.created_by === user.id) throw forbidden();
  if (await expireIfDue(tx, payment, now)) return { refused: "payment_not_pending" };
  if (payment.status !== "pending_approval") return { refused: "payment_not_pending" };
  const given = await tx.query<{ user_id: string }>("SELECT user_id FROM payment_approvals WHERE payment_id = $1", [payment.id]);
  if (given.rows.some((row) => row.user_id === user.id)) return { refused: "already_approved" };
  const final = given.rows.length + 1 >= payment.approvals_required;
  if (final) await findAccount(tx, user.companyId, payment.source_account_id, true);
  await tx.query("INSERT INTO payment_approvals (payment_id, user_id, name, approved_at) VALUES ($1, $2, $3, $4)", [payment.id, user.id, user.name, now]);
  await appendAudit(tx, user.companyId, "payment.approved", payment.id, payment.amount_cents, user.email);
  if (final) {
    await postExisting(tx, payment, settlementDate(payment.method, now), user.email, now);
  }
  return { payment: await readPayment(tx, payment.id) };
}

export async function rejectPayment(tx: Tx, user: SessionUser, id: unknown, now: Date): Promise<Decision> {
  const payment = await findPayment(tx, user.companyId, id, true);
  requireApprover(user);
  if (await expireIfDue(tx, payment, now)) return { refused: "payment_not_pending" };
  if (payment.status !== "pending_approval") return { refused: "payment_not_pending" };
  await tx.query("UPDATE payments SET status = 'rejected' WHERE id = $1", [payment.id]);
  await appendAudit(tx, user.companyId, "payment.rejected", payment.id, payment.amount_cents, user.email);
  return { payment: await readPayment(tx, payment.id) };
}

/** Cancels a scheduled payment: its creator, an owner or an admin may. */
export async function cancelPayment(tx: Tx, user: SessionUser, id: unknown): Promise<PaymentView | { refused: "payment_not_scheduled" }> {
  const payment = await findPayment(tx, user.companyId, id, true);
  if (user.role === "member" && payment.created_by !== user.id) throw forbidden();
  if (payment.status !== "scheduled") return { refused: "payment_not_scheduled" };
  await cancelScheduled(tx, payment, user.email);
  return readPayment(tx, payment.id);
}

export async function cancelScheduled(tx: Tx, payment: Row, actorEmail: string): Promise<void> {
  await tx.query("UPDATE payments SET status = 'cancelled' WHERE id = $1", [payment.id]);
  await appendAudit(tx, payment.company_id, "payment.cancelled", payment.id, payment.amount_cents, actorEmail);
}

interface DueWork {
  kind: "expiry" | "posting";
  id: string;
  dueAt: Date;
  createdAt: Date;
}

/** Held payments past their deadline and scheduled payments whose effective-date midnight has passed, in due order. */
export async function findDueWork(tx: Tx, now: Date): Promise<DueWork[]> {
  const expiring = await tx.query("SELECT id, expires_at, created_at FROM payments WHERE status = 'pending_approval' AND expires_at <= $1", [now]);
  const posting = await tx.query("SELECT id, effective_date, created_at FROM payments WHERE status = 'scheduled' AND effective_date <= $1", [newYorkDate(now)]);
  const work: DueWork[] = [
    ...expiring.rows.map((row): DueWork => ({ kind: "expiry", id: row.id, dueAt: row.expires_at, createdAt: row.created_at })),
    ...posting.rows.map((row): DueWork => ({ kind: "posting", id: row.id, dueAt: newYorkMidnight(row.effective_date), createdAt: row.created_at })),
  ];
  return work.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
}

/** Processes one due payment exactly once: re-reads it under its lock and skips it when it is no longer due. */
export async function processDue(tx: Tx, work: DueWork, now: Date): Promise<void> {
  const found = await tx.query("SELECT * FROM payments WHERE id = $1 FOR UPDATE", [work.id]);
  const payment = found.rows[0];
  if (!payment) return;
  if (work.kind === "expiry") {
    await expireIfDue(tx, payment, now);
    return;
  }
  if (payment.status !== "scheduled") return;
  const source = await findAccount(tx, payment.company_id, payment.source_account_id, true);
  if (source.available_cents < payment.total_debit_cents) {
    await tx.query("UPDATE payments SET status = 'failed' WHERE id = $1", [payment.id]);
    await appendAudit(tx, payment.company_id, "payment.failed", payment.id, payment.amount_cents, SYSTEM_ACTOR);
    return;
  }
  await postExisting(tx, payment, payment.effective_date, SYSTEM_ACTOR, now);
}
