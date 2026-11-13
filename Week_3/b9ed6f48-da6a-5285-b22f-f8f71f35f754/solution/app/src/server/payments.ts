// Payments: the sandbox card outcome, the Kill Bill account and its fixed currency, and the
// settlement of a successful charge into one ledger row, one receipt PDF and one email
// (brief: Business rules › Sandbox cards, Money › Account currency, Settlement).

import { randomUUID } from "node:crypto";
import { one, pool, type Db } from "./db.js";
import { ApiError, fail } from "./http.js";
import { createAccount, findAccount, refundPayment, successfulPurchase, type KbPayment } from "./killbill.js";
import { queueMail } from "./mail.js";
import { receiptEmail, receiptPdf, type ReceiptContent } from "./receipts.js";
import { putObject, StorageUnreachable } from "./storage.js";
import { COPY, copyFor } from "../shared/copy.js";
import { lisbonDate } from "../shared/lisbon.js";
import { majorToMinor, minorToMajor, type Currency } from "../shared/money.js";

export type OutcomeClass = "always_declined" | "first_charge_only" | "approved";

/** The sandbox class of a full 16-digit number, matched on all 16 digits. */
export function outcomeClass(digits: string): OutcomeClass {
  if (digits === "4000000000000002") return "always_declined";
  if (digits === "4000000000000341") return "first_charge_only";
  return "approved";
}

/**
 * Decides one charge attempt; the only place a sandbox outcome is decided. A first-charge-only
 * card is approved on the person's first charge with it and declined on every later one,
 * counted in PostgreSQL so every instance shares the count.
 */
export async function chargeApproved(userId: string, outcome: OutcomeClass): Promise<boolean> {
  if (outcome !== "first_charge_only") return outcome === "approved";
  const counted = await one<{ charges: number }>(
    pool,
    `INSERT INTO card_charge_counts (user_id, charges) VALUES ($1, 1)
     ON CONFLICT (user_id) DO UPDATE SET charges = card_charge_counts.charges + 1 RETURNING charges`,
    [userId],
  );
  return counted?.charges === 1;
}

export const declined = () => new ApiError(402, "card_declined", COPY.cardDeclined);

export interface Payer {
  id: string;
  name: string;
  email: string;
}

/** The currency fixed on the person's Kill Bill account, or null before their first attempt. */
export async function accountCurrency(userId: string): Promise<Currency | null> {
  return (await one<{ currency: Currency }>(pool, "SELECT currency FROM killbill_accounts WHERE user_id = $1", [userId]))?.currency ?? null;
}

export async function accountIdOf(userId: string): Promise<string | null> {
  return (await one<{ account_id: string }>(pool, "SELECT account_id FROM killbill_accounts WHERE user_id = $1", [userId]))?.account_id ?? null;
}

export function currencyLocked(currency: Currency): ApiError {
  return fail.conflict("currency_locked", copyFor.currencyLocked(currency));
}

/** The person's account, created at their first payment attempt in that attempt's currency. */
export async function ensureAccount(payer: Payer, currency: Currency): Promise<string> {
  const known = await one<{ account_id: string; currency: Currency }>(pool, "SELECT account_id, currency FROM killbill_accounts WHERE user_id = $1", [payer.id]);
  const account = known
    ? { accountId: known.account_id, currency: known.currency }
    : ((await findAccount(payer.id)) ?? { accountId: await createAccount(payer.id, payer.name, payer.email, currency), currency });
  await pool.query("INSERT INTO killbill_accounts (user_id, account_id, currency) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING", [
    payer.id,
    account.accountId,
    account.currency,
  ]);
  if (account.currency !== currency) throw currencyLocked(account.currency);
  return account.accountId;
}

export async function nextReceiptNumber(): Promise<string> {
  const row = await one<{ n: number }>(pool, "SELECT nextval('receipt_numbers') AS n");
  return `HRR-${String(row?.n).padStart(6, "0")}`;
}

export type OrderKind = "ticket" | "donation" | "membership_join" | "membership_upgrade";

interface Settlement {
  orderId: string;
  receiptNumber: string;
  payer: Payer;
  kind: OrderKind;
  description: string;
  currency: Currency;
  amountMinor: number;
  last4: string;
  invoiceId: string;
  payment: KbPayment;
  settledAt: Date;
  ticket?: ReceiptContent["ticket"];
}

/** The settled purchase transaction of a Kill Bill payment, checked against the expected amount. */
export function settledAt(payment: KbPayment, amountMinor: number, currency: Currency): Date {
  const purchase = successfulPurchase(payment);
  if (!purchase || majorToMinor(purchase.amount, currency) !== amountMinor) throw new Error(`payment ${payment.paymentId} did not settle`);
  return new Date(purchase.effectiveDate);
}

function receiptContent(s: Settlement): ReceiptContent {
  return {
    name: s.payer.name,
    receiptNumber: s.receiptNumber,
    description: s.description,
    amountMinor: s.amountMinor,
    currency: s.currency,
    date: lisbonDate(s.settledAt.getTime()),
    last4: s.last4,
    ticket: s.ticket,
  };
}

/**
 * Stores the receipt PDF; when storage fails after the charge, refunds the payment in full and
 * answers 503 with nothing recorded (brief: Settlement › Order of checks).
 */
export async function storeReceipt(s: Settlement): Promise<void> {
  try {
    await putObject(`receipts/${s.receiptNumber}.pdf`, await receiptPdf(receiptContent(s)), "application/pdf");
  } catch (error) {
    if (!(error instanceof StorageUnreachable)) throw error;
    await refundPayment(s.payment.paymentId, minorToMajor(s.amountMinor, s.currency), s.currency, `undo-${s.orderId}`);
    throw fail.storage(COPY.storagePurchase);
  }
}

const SUBJECTS: Record<OrderKind, (s: Settlement, extra: string) => string> = {
  ticket: (s, title) => `Your ticket for ${title} — receipt ${s.receiptNumber}`,
  donation: (s) => `Thank you for your donation — receipt ${s.receiptNumber}`,
  membership_join: (s, tierName) => `Welcome, ${tierName} supporter — receipt ${s.receiptNumber}`,
  membership_upgrade: (s) => `Your supporter upgrade — receipt ${s.receiptNumber}`,
};

/** Writes the ledger row and queues the receipt email, inside the caller's transaction. */
export async function recordOrder(db: Db, s: Settlement, subjectDetail: string): Promise<number> {
  await db.query(
    `INSERT INTO orders (id, receipt_number, user_id, user_email, user_name, kind, description, currency, amount_minor, card_last4,
       killbill_invoice_id, killbill_payment_id, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [s.orderId, s.receiptNumber, s.payer.id, s.payer.email, s.payer.name, s.kind, s.description, s.currency, s.amountMinor, s.last4, s.invoiceId, s.payment.paymentId, s.settledAt],
  );
  return queueMail(db, s.payer, SUBJECTS[s.kind](s, subjectDetail), receiptEmail(receiptContent(s)));
}

export const newOrderId = () => randomUUID();

export interface OrderRow {
  id: string;
  receipt_number: string;
  user_id: string;
  user_email: string;
  user_name: string;
  kind: OrderKind;
  description: string;
  currency: Currency;
  amount_minor: number;
  card_last4: string;
  killbill_invoice_id: string;
  killbill_payment_id: string;
  settled_at: Date;
  refunded_minor: number;
}

/** settled, partially_refunded or refunded, from the order's refunds. */
function orderStatus(amountMinor: number, refundedMinor: number): "settled" | "partially_refunded" | "refunded" {
  if (refundedMinor === 0) return "settled";
  return refundedMinor < amountMinor ? "partially_refunded" : "refunded";
}

export function orderJson(o: OrderRow) {
  return {
    id: o.id,
    receipt_number: o.receipt_number,
    kind: o.kind,
    description: o.description,
    currency: o.currency,
    amount_minor: o.amount_minor,
    refunded_minor: o.refunded_minor,
    status: orderStatus(o.amount_minor, o.refunded_minor),
    settled_at: o.settled_at.toISOString(),
    card_last4: o.card_last4,
    receipt_url: `/api/orders/${o.id}/receipt`,
  };
}

/** Orders with their refunded totals summed from their refunds. */
export const ORDER_SELECT = `SELECT o.*, COALESCE((SELECT SUM(r.amount_minor) FROM refunds r WHERE r.order_id = o.id), 0)::bigint AS refunded_minor FROM orders o`;

export async function orderById(db: Db, id: string): Promise<OrderRow | undefined> {
  return one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = $1`, [id]);
}
