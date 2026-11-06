import { randomUUID } from "node:crypto";
import { type PoolClient } from "pg";
import { config } from "./config.js";
import { query } from "./db.js";
import { formatLongDate } from "../shared/copy.js";
import { formatMoney, type Money } from "../shared/money.js";
import { type PaymentKind } from "./domain/orders.js";

export interface QueuedMessage {
  dedupeKey: string;
  to: string;
  subject: string;
  body: string;
}

export async function queueMessage(client: PoolClient | null, message: QueuedMessage): Promise<void> {
  const sql = `insert into mail_queue (id, dedupe_key, to_email, subject, body)
               values ($1, $2, $3, $4, $5) on conflict (dedupe_key) do nothing`;
  const values = [randomUUID(), message.dedupeKey, message.to, message.subject, message.body];
  if (client) {
    await client.query(sql, values);
    return;
  }
  await query(sql, values);
}

const PAYMENT_LABELS: Record<PaymentKind, string> = {
  deposit: "Deposit",
  balance: "Launch balance",
  care: "Care plan",
  change: "Plan change",
  renewal: "Renewal",
};

export function receiptMessage(input: {
  to: string;
  orderId: string;
  orderNumber: string;
  kind: PaymentKind;
  amount: Money;
  paymentId: string;
}): QueuedMessage {
  const amount = formatMoney(input.amount);
  return {
    dedupeKey: `receipt:${input.paymentId}`,
    to: input.to,
    subject: `Receipt ${input.orderNumber}: ${amount}`,
    body: [
      `Thank you — we have your payment.`,
      ``,
      `Order: ${input.orderNumber}`,
      `Payment: ${PAYMENT_LABELS[input.kind]}`,
      `Amount: ${amount}`,
      ``,
      `Receipt: ${config.publicUrl}/orders/${input.orderId}/receipt`,
      ``,
      `Pampero Build Co.`,
    ].join("\n"),
  };
}

export function invoiceNoticeMessage(input: {
  to: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: Money;
  due: Money;
}): QueuedMessage {
  const amount = formatMoney(input.amount);
  return {
    dedupeKey: `invoice-notice:${input.invoiceId}`,
    to: input.to,
    subject: `Invoice ${input.invoiceNumber} from Pampero Build Co.: ${amount}`,
    body: [
      `Invoice ${input.invoiceNumber} is ready.`,
      ``,
      `Amount: ${amount}`,
      `Due now: ${formatMoney(input.due)}`,
      ``,
      `Your invoices: ${config.publicUrl}/portal/invoices`,
      ``,
      `Pampero Build Co.`,
    ].join("\n"),
  };
}

export function dunningMessage(input: {
  to: string;
  invoiceId: string;
  attempt: number;
  amount: Money;
  nextRetryDate: string | null;
}): QueuedMessage {
  const amount = formatMoney(input.amount);
  const outcome = input.nextRetryDate
    ? `We will try again on ${formatLongDate(input.nextRetryDate)}.`
    : `Your care plan is cancelled after this third failed attempt.`;
  return {
    dedupeKey: `dunning:${input.invoiceId}:${input.attempt}`,
    to: input.to,
    subject: `Care plan payment failed (attempt ${input.attempt} of 3)`,
    body: [
      `We could not take your care-plan payment.`,
      ``,
      `Amount: ${amount}`,
      outcome,
      ``,
      `Update your card: ${config.publicUrl}/portal/plan`,
      ``,
      `Pampero Build Co.`,
    ].join("\n"),
  };
}

export function refundMessage(input: {
  to: string;
  refundId: string;
  orderNumber: string;
  amount: Money;
  remaining: Money;
}): QueuedMessage {
  const amount = formatMoney(input.amount);
  return {
    dedupeKey: `refund:${input.refundId}`,
    to: input.to,
    subject: `Refund of ${amount} on ${input.orderNumber}`,
    body: [
      `We refunded part of your payment.`,
      ``,
      `Order: ${input.orderNumber}`,
      `Refunded: ${amount}`,
      `Left on that payment: ${formatMoney(input.remaining)}`,
      ``,
      `Pampero Build Co.`,
    ].join("\n"),
  };
}

export function creditMessage(input: {
  to: string;
  creditId: string;
  amount: Money;
  reason: string;
}): QueuedMessage {
  const amount = formatMoney(input.amount);
  return {
    dedupeKey: `credit:${input.creditId}`,
    to: input.to,
    subject: `Account credit of ${amount}`,
    body: [
      `We added a credit to your account.`,
      ``,
      `Credit: ${amount}`,
      `Reason: ${input.reason}`,
      ``,
      `Pampero Build Co.`,
    ].join("\n"),
  };
}

export function inviteMessage(input: {
  to: string;
  inviteId: string;
  businessName: string;
  projectName: string;
  token: string;
}): QueuedMessage {
  return {
    dedupeKey: `invite:${input.inviteId}`,
    to: input.to,
    subject: `Join ${input.businessName} on Pampero Ledger`,
    body: [
      `You are invited to the ${input.projectName} project on Pampero Ledger.`,
      ``,
      `Set your password: ${config.publicUrl}/invite/${input.token}`,
      ``,
      `Pampero Build Co.`,
    ].join("\n"),
  };
}
