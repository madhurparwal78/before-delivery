import crypto from 'node:crypto';
import type { PgPool, Tx, Value } from '../db/pg.ts';
import { DatabaseError } from '../db/pg.ts';
import type { Currency } from '../core/money.ts';
import { formatPrice, minorToMajorString } from '../core/money.ts';
import { toDisplayDate, toDisplayDatetime } from './time.ts';
import { buildReceiptPdf, buildTicketPdf } from '../services/pdf.ts';
import type { Storage } from '../services/storage.ts';
import { StorageUnavailable } from '../services/storage.ts';
import type { KillBillApi } from '../services/killbill.ts';
import { KillBillUnavailable } from '../services/killbill.ts';
import type { MailQueue } from '../services/mail.ts';
import type { Config } from '../config.ts';

export type OrderKind = 'ticket' | 'donation' | 'membership_join' | 'membership_upgrade';
export type OrderStatus = 'settled' | 'partially_refunded' | 'refunded';

export interface OrderRow {
  id: string;
  receipt_number: string;
  kind: OrderKind;
  user_id: string;
  description: string;
  currency: string;
  amount_minor: number;
  refunded_minor: number;
  status: OrderStatus;
  settled_at: Date;
  card_last4: string;
  session_id: string | null;
  ticket_code: string | null;
  killbill_invoice_id: string | null;
  killbill_payment_id: string | null;
  killbill_account_id: string | null;
}

export function receiptNumber(seq: number): string {
  return `HRR-${String(seq).padStart(6, '0')}`;
}

export function ticketCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return `T-${out}`;
}

/** The next receipt sequence number, allocated atomically. */
export async function nextReceiptSequence(tx: Tx): Promise<number> {
  await tx.query(`CREATE TABLE IF NOT EXISTS receipt_sequence (id integer PRIMARY KEY DEFAULT 1, value integer NOT NULL)`);
  await tx.query(`INSERT INTO receipt_sequence (id, value) VALUES (1, 1) ON CONFLICT (id) DO NOTHING`);
  const res = await tx.query(`UPDATE receipt_sequence SET value = value + 1 WHERE id = 1 RETURNING value - 1 AS seq`);
  return Number(res.rows[0]!['seq']);
}

export interface SettleInput {
  userId: string;
  userName: string;
  userEmail: string;
  kind: OrderKind;
  description: string;
  currency: Currency;
  amountMinor: number;
  cardLast4: string;
  sessionId?: string | null;
  ticketCode?: string | null;
  kbAccountId: string;
  kbInvoice: { invoiceId: string; amount: number; balance: number };
  kbPaymentId: string;
  sessionTitle?: string;
  sessionStartsAtMs?: number;
  seats?: number;
}

export interface SettleOutcome {
  order: OrderRow;
  receiptEmail: 'sent' | 'delayed';
}

/**
 * Settlement: one ledger row, one Kill Bill invoice+payment, one email, one PDF.
 * Called only after the Kill Bill payment has succeeded and the PDF has been
 * stored; the caller holds the transaction.
 */
export async function settle(tx: Tx, input: SettleInput): Promise<{ orderId: string; receipt: string }> {
  const seq = await nextReceiptSequence(tx);
  const receipt = receiptNumber(seq);
  const id = crypto.randomUUID();
  await tx.query(
    `INSERT INTO orders (id, receipt_number, kind, user_id, description, currency, amount_minor, refunded_minor,
       status, settled_at, card_last4, session_id, ticket_code, killbill_invoice_id, killbill_payment_id, killbill_account_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,0,'settled',now(),$8,$9,$10,$11,$12,$13)`,
    [
      id, receipt, input.kind, input.userId, input.description, input.currency, input.amountMinor,
      input.cardLast4, input.sessionId ?? null, input.ticketCode ?? null,
      input.kbInvoice.invoiceId, input.kbPaymentId, input.kbAccountId,
    ],
  );
  return { orderId: id, receipt };
}

export interface ReceiptOrder {
  description: string;
  currency: string;
  amount_minor: number;
  card_last4: string;
  settled_at: Date;
}

export interface ReceiptContent {
  title: string;
  recipientName: string;
  receiptNumber: string;
  itemDescription: string;
  amount: string;
  currency: string;
  date: string;
  cardLast4: string;
  accountUrl: string;
  sessionDatetime?: string | undefined;
  seats?: number | undefined;
  ticketCode?: string | undefined;
}

export function receiptContent(publicUrl: string, userName: string, receipt: string, order: ReceiptOrder, kind: OrderKind, extra?: { sessionStartsAtMs?: number | undefined; seats?: number | undefined; ticketCode?: string | undefined }): ReceiptContent {
  const title =
    kind === 'ticket' ? 'Your ticket' :
    kind === 'donation' ? 'Your donation' :
    kind === 'membership_join' ? 'Your supporter membership' :
    'Your supporter upgrade';
  return {
    title,
    recipientName: userName,
    receiptNumber: receipt,
    itemDescription: order.description,
    amount: formatPrice(order.amount_minor, order.currency as Currency),
    currency: order.currency,
    date: toDisplayDate(typeof order.settled_at === 'string' ? Date.parse(order.settled_at) : order.settled_at.getTime()),
    cardLast4: order.card_last4,
    accountUrl: `${publicUrl}/account`,
    sessionDatetime: extra?.sessionStartsAtMs !== undefined ? toDisplayDatetime(extra.sessionStartsAtMs) : undefined,
    seats: extra?.seats,
    ticketCode: extra?.ticketCode,
  };
}

/** Store the receipt PDF and enqueue the receipt email. */
export async function issueReceiptArtifacts(
  app: { pool: PgPool; storage: Storage; mail: MailQueue; config: Config },
  opts: {
    userName: string;
    userEmail: string;
    receipt: string;
    order: ReceiptOrder;
    kind: OrderKind;
    sessionStartsAtMs?: number | undefined;
    seats?: number | undefined;
    ticketCode?: string | undefined;
    subject: string;
    emailExtra?: string[];
  },
): Promise<'sent' | 'delayed'> {
  const content = receiptContent(app.config.publicUrl, opts.userName, opts.receipt, opts.order as ReceiptOrder, opts.kind, {
    sessionStartsAtMs: opts.sessionStartsAtMs,
    seats: opts.seats,
    ticketCode: opts.ticketCode,
  });
  let pdf: Buffer;
  if (opts.kind === 'ticket') {
    pdf = buildTicketPdf({
      title: content.title,
      recipientName: content.recipientName,
      receiptNumber: content.receiptNumber,
      itemDescription: content.itemDescription,
      amount: content.amount,
      currency: content.currency,
      date: content.date,
      cardLast4: content.cardLast4,
      accountUrl: content.accountUrl,
      sessionDatetime: content.sessionDatetime ?? '',
      seats: opts.seats ?? 1,
      ticketCode: opts.ticketCode ?? '',
    });
  } else {
    pdf = buildReceiptPdf({
      title: content.title,
      recipientName: content.recipientName,
      receiptNumber: content.receiptNumber,
      itemDescription: content.itemDescription,
      amount: content.amount,
      currency: content.currency,
      date: content.date,
      cardLast4: content.cardLast4,
      accountUrl: content.accountUrl,
    });
  }
  await app.storage.put(`receipts/${opts.receipt}.pdf`, pdf, 'application/pdf');

  const bodyLines: string[] = [
    `Hello ${opts.userName},`,
    '',
    opts.kind === 'ticket'
      ? `Your ticket: ${content.ticketCode}`
      : `Receipt ${content.receiptNumber}`,
    content.itemDescription,
    `${content.amount} ${content.currency}`,
    content.date,
    `Card ending ${content.cardLast4}`,
  ];
  if (opts.kind === 'ticket' && content.sessionDatetime) {
    bodyLines.push('', `Session: ${content.sessionDatetime}`, `Seats: ${String(opts.seats ?? 1)}`);
  }
  bodyLines.push('', `View your receipts at ${content.accountUrl}`, '', 'Halden Reading Room');
  await app.mail.enqueue({
    toEmail: opts.userEmail,
    toName: opts.userName,
    subject: opts.subject,
    body: bodyLines.join('\n'),
    dedupeKey: `receipt:${opts.receipt}`,
  });
  return 'sent';
}

/** One external-charge invoice + payment in Kill Bill. Throws on provider failure. */
export async function chargeKillBill(
  kb: KillBillApi,
  accountId: string,
  amountMinor: number,
  currency: Currency,
  description: string,
): Promise<{ invoiceId: string; paymentId: string; amount: number; balance: number }> {
  const major = minorToMajorString(amountMinor, currency);
  const invoice = await kb.createExternalChargeInvoice(accountId, major, currency, description);
  const payment = await kb.payInvoice(accountId, invoice.invoiceId, major, currency);
  const purchase = payment.transactions.find((t) => t.transactionType === 'PURCHASE' && t.status === 'SUCCESS');
  if (!purchase) throw new KillBillUnavailable('payment did not settle');
  return {
    invoiceId: invoice.invoiceId,
    paymentId: payment.paymentId,
    amount: purchase.processedAmount,
    balance: 0,
  };
}

/** Refund a Kill Bill payment. The amount is in minor units. */
export async function refundKillBill(
  kb: KillBillApi,
  paymentId: string,
  amountMinor: number,
  currency: Currency,
): Promise<void> {
  const major = minorToMajorString(amountMinor, currency);
  await kb.refundPayment(paymentId, major, currency);
}

export { StorageUnavailable, KillBillUnavailable, DatabaseError };
export type { Value };
