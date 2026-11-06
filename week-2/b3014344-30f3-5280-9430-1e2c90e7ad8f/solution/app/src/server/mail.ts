import { randomUUID } from "node:crypto";
import { config } from "./config";
import { tx, type Db } from "./db";
import { send } from "./smtp";
import { longDate } from "../shared/domain";
import { formatMoney, type Currency } from "../shared/money";

// Every message is written to the ledger's queue inside the action's own transaction, keyed so a
// retried action never queues a second copy, and delivered once by whichever process reaches mail.

interface Outgoing {
  dedupeKey: string;
  to: string;
  subject: string;
  text: string;
}

export async function enqueue(db: Db, message: Outgoing): Promise<void> {
  await db.query(
    "INSERT INTO mail_queue (id, dedupe_key, recipient, subject, body) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING",
    [randomUUID(), message.dedupeKey, message.to, message.subject, message.text],
  );
}

const link = (path: string) => `${config.publicUrl}${path}`;
const signOff = "\n\nPampero Build Co.\nBuenos Aires";

export type ReceiptKind = "Deposit" | "Launch balance" | "Care plan" | "Plan change" | "Renewal";

export const messages = {
  receipt(p: { key: string; to: string; orderId: string; orderNumber: string; kind: ReceiptKind; amount: bigint; currency: Currency }): Outgoing {
    const amount = formatMoney(p.amount, p.currency);
    return {
      dedupeKey: `receipt:${p.key}`,
      to: p.to,
      subject: `Receipt ${p.orderNumber}: ${amount}`,
      text:
        `Payment received. Thank you.\n\nOrder: ${p.orderNumber}\nPayment: ${p.kind}\nAmount: ${amount}\n\n` +
        `Your receipt: ${link(`/orders/${p.orderId}/receipt`)}${signOff}`,
    };
  },
  invoiceNotice(p: { invoiceId: string; to: string; invoiceNumber: string; amount: bigint; due: bigint; currency: Currency }): Outgoing {
    const amount = formatMoney(p.amount, p.currency);
    return {
      dedupeKey: `invoice:${p.invoiceId}`,
      to: p.to,
      subject: `Invoice ${p.invoiceNumber} from Pampero Build Co.: ${amount}`,
      text:
        `A new invoice is ready.\n\nInvoice: ${p.invoiceNumber}\nAmount: ${amount}\nDue now: ${formatMoney(p.due, p.currency)}\n\n` +
        `See and pay it in your portal: ${link("/portal/invoices")}${signOff}`,
    };
  },
  dunning(p: { invoiceId: string; to: string; attempt: number; amount: bigint; currency: Currency; nextRetry: string | null }): Outgoing {
    const next = p.nextRetry
      ? `We'll try your card again on ${longDate(p.nextRetry)}. Update your card before then to keep your plan.`
      : "This was the last attempt, so your care plan is now cancelled.";
    return {
      dedupeKey: `dunning:${p.invoiceId}:${p.attempt}`,
      to: p.to,
      subject: `Care plan payment failed (attempt ${p.attempt} of 3)`,
      text:
        `We couldn't charge your card for your care plan renewal.\n\nAmount: ${formatMoney(p.amount, p.currency)}\n${next}\n\n` +
        `Your plan: ${link("/portal/plan")}${signOff}`,
    };
  },
  refund(p: { refundId: string; to: string; orderNumber: string; amount: bigint; left: bigint; currency: Currency }): Outgoing {
    const amount = formatMoney(p.amount, p.currency);
    return {
      dedupeKey: `refund:${p.refundId}`,
      to: p.to,
      subject: `Refund of ${amount} on ${p.orderNumber}`,
      text:
        `We've refunded part of a payment on ${p.orderNumber}.\n\nRefunded: ${amount}\n` +
        `Left on that payment: ${formatMoney(p.left, p.currency)}${signOff}`,
    };
  },
  credit(p: { creditId: string; to: string; amount: bigint; currency: Currency; reason: string }): Outgoing {
    const amount = formatMoney(p.amount, p.currency);
    return {
      dedupeKey: `credit:${p.creditId}`,
      to: p.to,
      subject: `Account credit of ${amount}`,
      text: `We've added ${amount} of credit to your account. It applies to your next invoice.\n\nReason: ${p.reason}${signOff}`,
    };
  },
  invite(p: { inviteId: string; to: string; businessName: string; projectName: string; token: string }): Outgoing {
    return {
      dedupeKey: `invite:${p.inviteId}`,
      to: p.to,
      subject: `Join ${p.businessName} on Pampero Ledger`,
      text:
        `You've been invited to ${p.businessName}'s project ${p.projectName} on Pampero Ledger.\n\n` +
        `Set your name and password here: ${link(`/invite/${p.token}`)}${signOff}`,
    };
  },
};

/** Delivers queued messages one at a time; a row stays locked while one process sends it. */
export async function deliverQueued(): Promise<void> {
  for (let sent = true; sent; ) {
    sent = await tx(async (db) => {
      const row = (
        await db.query<{ id: string; recipient: string; subject: string; body: string }>(
          `SELECT id, recipient, subject, body FROM mail_queue WHERE sent_at IS NULL
           ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
      ).rows[0];
      if (!row) return false;
      await send({ to: row.recipient, subject: row.subject, text: row.body });
      await db.query("UPDATE mail_queue SET sent_at = now() WHERE id = $1", [row.id]);
      return true;
    });
  }
}
