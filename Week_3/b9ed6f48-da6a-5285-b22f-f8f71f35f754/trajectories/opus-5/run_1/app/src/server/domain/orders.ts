import { AppError } from '../errors.js';
import { newId, nextReceiptNumber, pool, query, queryOne, withAdvisoryLock } from '../db/index.js';
import { toLisbonIso } from '../../shared/lisbon.js';
import type { Currency } from '../../shared/money.js';
import type { ManagerOrder, Order, OrderKind, OrderStatus, ReceiptEmailState, User } from '../../shared/types.js';
import { attemptCharge, type CardClass } from './cards.js';
import { receiptObjectKey, renderReceipt, type ReceiptFacts } from './receipts.js';
import * as killbill from '../services/killbill.js';
import * as storage from '../services/storage.js';
import * as mail from '../services/mail.js';
import type { OutboundMessage } from '../services/smtp.js';

export interface OrderRow {
  id: string;
  receipt_number: string;
  user_id: string;
  user_email: string;
  user_name: string;
  kind: OrderKind;
  description: string;
  currency: Currency;
  amount_minor: string;
  settled_at: Date;
  card_last4: string;
  killbill_invoice_id: string;
  killbill_payment_id: string;
  booking_id: string | null;
}

const ORDER_COLUMNS = `id, receipt_number, user_id, user_email, user_name, kind, description, currency,
                       amount_minor::text, settled_at, card_last4, killbill_invoice_id, killbill_payment_id, booking_id`;

export function orderStatus(amountMinor: number, refundedMinor: number): OrderStatus {
  if (refundedMinor <= 0) return 'settled';
  return refundedMinor >= amountMinor ? 'refunded' : 'partially_refunded';
}

export async function refundedTotal(orderId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM refunds WHERE order_id = $1`,
    [orderId],
  );
  return Number(row?.total ?? '0');
}

export async function toOrderView(row: OrderRow): Promise<Order> {
  const amountMinor = Number(row.amount_minor);
  const refunded = await refundedTotal(row.id);
  return {
    id: row.id,
    receipt_number: row.receipt_number,
    kind: row.kind,
    description: row.description,
    currency: row.currency,
    amount_minor: amountMinor,
    refunded_minor: refunded,
    status: orderStatus(amountMinor, refunded),
    settled_at: toLisbonIso(row.settled_at.getTime()),
    card_last4: row.card_last4,
    receipt_url: `/api/orders/${row.id}/receipt`,
  };
}

export async function listUserOrders(userId: string): Promise<Order[]> {
  const rows = await query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE user_id = $1 ORDER BY settled_at DESC, receipt_number DESC`,
    [userId],
  );
  return Promise.all(rows.map(toOrderView));
}

export async function loadOrder(id: string): Promise<OrderRow | null> {
  return queryOne<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [id]);
}

interface RefundRow {
  id: string;
  amount_minor: string;
  reason: string;
  at: Date;
}

interface NoteRow {
  id: string;
  text: string;
  author_email: string;
  at: Date;
}

export async function listManagerOrders(filters: {
  currency: Currency | null;
  kind: OrderKind | null;
}): Promise<ManagerOrder[]> {
  const rows = await query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders
     WHERE ($1::text IS NULL OR currency = $1) AND ($2::text IS NULL OR kind = $2)
     ORDER BY settled_at DESC, receipt_number DESC`,
    [filters.currency, filters.kind],
  );
  const out: ManagerOrder[] = [];
  for (const row of rows) {
    const view = await toOrderView(row);
    const refunds = await query<RefundRow>(
      `SELECT id, amount_minor::text, reason, at FROM refunds WHERE order_id = $1 ORDER BY at, id`,
      [row.id],
    );
    const notes = await query<NoteRow>(
      `SELECT id, text, author_email, at FROM order_notes WHERE order_id = $1 ORDER BY at, id`,
      [row.id],
    );
    out.push({
      ...view,
      user_email: row.user_email,
      killbill_invoice_id: row.killbill_invoice_id,
      killbill_payment_id: row.killbill_payment_id,
      refunds: refunds.map((refund) => ({
        id: refund.id,
        amount_minor: Number(refund.amount_minor),
        reason: refund.reason,
        at: toLisbonIso(refund.at.getTime()),
      })),
      notes: notes.map((note) => ({
        id: note.id,
        text: note.text,
        author_email: note.author_email,
        at: toLisbonIso(note.at.getTime()),
      })),
    });
  }
  return out;
}

/* ------------------------------------------------- the Kill Bill account */

export interface RecordedAccount {
  accountId: string;
  currency: Currency;
}

export async function readAccount(userId: string): Promise<RecordedAccount | null> {
  const row = await queryOne<{ kb_account_id: string; currency: Currency }>(
    'SELECT kb_account_id, currency FROM killbill_accounts WHERE user_id = $1',
    [userId],
  );
  return row ? { accountId: row.kb_account_id, currency: row.currency } : null;
}

/**
 * The account is created at the first payment attempt in that attempt's currency, and its
 * currency is fixed from then on.
 */
export async function accountForPayment(user: User, currency: Currency): Promise<RecordedAccount> {
  const existing = await readAccount(user.id);
  if (existing) {
    if (existing.currency !== currency) {
      throw new AppError('currency_locked', { context: { accountCurrency: existing.currency } });
    }
    return existing;
  }
  return withAdvisoryLock(`killbill-account:${user.id}`, async () => {
    const latest = await readAccount(user.id);
    if (latest) {
      if (latest.currency !== currency) {
        throw new AppError('currency_locked', { context: { accountCurrency: latest.currency } });
      }
      return latest;
    }
    const accountId = await killbill.createAccount({
      externalKey: user.id,
      name: user.name,
      email: user.email,
      currency,
    });
    await pool.query(
      `INSERT INTO killbill_accounts (user_id, kb_account_id, currency, email, name)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO NOTHING`,
      [user.id, accountId, currency, user.email, user.name],
    );
    return { accountId, currency };
  });
}

export async function listRecordedAccounts(): Promise<string[]> {
  const rows = await query<{ kb_account_id: string }>('SELECT kb_account_id FROM killbill_accounts');
  return rows.map((row) => row.kb_account_id);
}

/* ---------------------------------------------------------- settlement */

export interface SettlementInput {
  user: User;
  accountId: string;
  invoiceId: string;
  amountMinor: number;
  currency: Currency;
  kind: OrderKind;
  description: string;
  cardClass: CardClass;
  cardLast4: string;
  bookingId?: string;
  receiptExtraLines?: string[];
  message: (facts: ReceiptFacts) => OutboundMessage;
}

export interface Settlement {
  order: Order;
  row: OrderRow;
  receiptEmail: ReceiptEmailState;
}

/**
 * One settled payment leaves exactly one ledger row, one receipt email and one PDF. A PDF
 * that cannot be stored after a successful charge is refunded in full and nothing is kept.
 */
export async function settlePayment(input: SettlementInput): Promise<Settlement | 'declined'> {
  if (!(await attemptCharge(input.user.id, input.cardClass))) return 'declined';
  const payment = await killbill.payInvoice(input.accountId, input.invoiceId, input.amountMinor, input.currency);
  const receiptNumber = await nextReceiptNumber();
  const facts: ReceiptFacts = {
    recipientName: input.user.name,
    recipientEmail: input.user.email,
    receiptNumber,
    description: input.description,
    amountMinor: input.amountMinor,
    currency: input.currency,
    settledAtMs: payment.effectiveDateMs,
    cardLast4: input.cardLast4,
  };
  try {
    await storage.putObject(
      receiptObjectKey(receiptNumber),
      renderReceipt(facts, input.receiptExtraLines ?? []),
      'application/pdf',
    );
  } catch (error) {
    await killbill.refundPayment(payment.paymentId, input.amountMinor, input.currency);
    if (error instanceof AppError && error.code === 'storage_unavailable') {
      throw new AppError('storage_unavailable', { context: { storageContext: 'purchase' } });
    }
    throw error;
  }
  const id = newId('ord');
  await pool.query(
    `INSERT INTO orders (id, receipt_number, user_id, user_email, user_name, kind, description, currency,
                         amount_minor, settled_at, card_last4, killbill_invoice_id, killbill_payment_id, booking_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      receiptNumber,
      input.user.id,
      input.user.email,
      input.user.name,
      input.kind,
      input.description,
      input.currency,
      input.amountMinor,
      new Date(payment.effectiveDateMs),
      input.cardLast4,
      input.invoiceId,
      payment.paymentId,
      input.bookingId ?? null,
    ],
  );
  const row = (await loadOrder(id)) as OrderRow;
  const delivered = await mail.send(input.message(facts));
  return { order: await toOrderView(row), row, receiptEmail: delivered ? 'sent' : 'delayed' };
}

/** Storage and billing are checked before any charge is made. */
export async function requireProvidersReady(): Promise<void> {
  if (!(await storage.reachable())) {
    throw new AppError('storage_unavailable', { context: { storageContext: 'purchase' } });
  }
}

/* -------------------------------------------------------------- refunds */

export interface RefundOutcome {
  refundId: string;
  amountMinor: number;
  atMs: number;
}

/** A refund enters the ledger only after Kill Bill confirms the refund transaction. */
export async function recordRefund(
  row: OrderRow,
  amountMinor: number,
  reason: string,
): Promise<RefundOutcome> {
  const confirmed = await killbill.refundPayment(row.killbill_payment_id, amountMinor, row.currency);
  const id = newId('ref');
  await pool.query(
    `INSERT INTO refunds (id, order_id, amount_minor, reason, at, killbill_refund_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, row.id, amountMinor, reason, new Date(confirmed.effectiveDateMs), confirmed.refundId],
  );
  return { refundId: id, amountMinor, atMs: confirmed.effectiveDateMs };
}

export function refundFacts(row: OrderRow, amountMinor: number, atMs: number, receiptNumber: string): ReceiptFacts {
  return {
    recipientName: row.user_name,
    recipientEmail: row.user_email,
    receiptNumber,
    description: row.description,
    amountMinor,
    currency: row.currency,
    settledAtMs: atMs,
    cardLast4: row.card_last4,
  };
}
