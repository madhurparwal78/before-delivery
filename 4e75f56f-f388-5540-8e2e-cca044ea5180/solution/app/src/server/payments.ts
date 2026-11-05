// Every payment and refund goes through Kill Bill exactly once (its external key is looked up
// before charging), and a seat moves only after Kill Bill confirms, the receipt PDF is stored
// and the receipt email is queued.
import { offerFreedBenches } from "./ledger.js";
import { lockLedger, many, one, oneRow, pool, tx, type Db } from "./db.js";
import { receiptPdf } from "./documents.js";
import { ApiError } from "./http.js";
import * as killbill from "./killbill.js";
import { enqueueMail } from "./mail.js";
import { formatDollars } from "./money.js";
import { buyerName, newId, reservationsWhere, transition, type ReservationRow } from "./reservations.js";
import { TIER_NAME, tierOf } from "./rules.js";
import { putObject } from "./s3.js";

export type PaymentKind = "deposit" | "balance" | "full" | "upgrade" | "group";

const ITEM_WORD: Record<PaymentKind, string> = {
  deposit: "deposit",
  balance: "balance",
  full: "full price",
  upgrade: "upgrade",
  group: "full price",
};

interface PaymentRow {
  id: string;
  external_key: string;
  kind: PaymentKind;
  owner_id: string;
  amount_cents: number;
  billing_name: string;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
}

interface Charge {
  kind: PaymentKind;
  /** The reservation id, or the group id for a group checkout. */
  ownerId: string;
  buyer: { id: string; name: string; email: string };
  billingName: string;
  items: readonly { reservationId: string; bench: string; amountCents: number }[];
}

/** The PURCHASE external key: ob-<deposit|balance|full|upgrade>-<reservation id> or ob-group-<group id>. */
export function externalKey(kind: PaymentKind, ownerId: string): string {
  return `ob-${kind}-${ownerId}`;
}

/** The REFUND transaction external key prefix for a seat (n counts from 1, newest payment first). */
export function refundKeyPrefix(reservationId: string): string {
  return `ob-refund-${reservationId}-`;
}

/** The Kill Bill buyer of a seat: the clinic (by clinic name) or the practitioner. */
export function kbBuyer(row: ReservationRow): Charge["buyer"] {
  return { id: row.buyer_id, name: buyerName(row), email: row.buyer_email };
}

/** Records the payment (outside the seat's transaction, so a created invoice is never forgotten). */
async function paymentRecord(charge: Charge): Promise<PaymentRow> {
  const total = charge.items.reduce((sum, item) => sum + item.amountCents, 0);
  const payment = await oneRow<PaymentRow>(
    pool,
    `INSERT INTO payments (id, external_key, kind, owner_id, amount_cents, billing_name) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (external_key) DO UPDATE SET billing_name = EXCLUDED.billing_name RETURNING *`,
    [newId("pay"), externalKey(charge.kind, charge.ownerId), charge.kind, charge.ownerId, total, charge.billingName],
  );
  for (const item of charge.items) {
    await pool.query(
      `INSERT INTO payment_items (payment_id, reservation_id, bench, amount_cents) VALUES ($1, $2, $3, $4)
       ON CONFLICT (payment_id, reservation_id) DO NOTHING`,
      [payment.id, item.reservationId, item.bench, item.amountCents],
    );
  }
  return payment;
}

/** Charges once in Kill Bill (reusing a confirmed PURCHASE with the same key) and marks the payment confirmed. */
export async function charge(db: Db, request: Charge): Promise<PaymentRow> {
  const payment = await paymentRecord(request);
  const accountId = await killbill.ensureAccount(request.buyer);
  let confirmed = await killbill.paymentByKey(payment.external_key);
  if (!confirmed || !killbill.succeeded(confirmed, "PURCHASE", payment.external_key)) {
    let invoiceId = payment.kb_invoice_id;
    if (!invoiceId) {
      const invoice = await killbill.createInvoice(
        accountId,
        request.items.map((item) => ({
          amountCents: item.amountCents,
          description: `Bench ${item.bench} ${TIER_NAME[tierOf(item.bench)]} ${ITEM_WORD[request.kind]}`,
        })),
      );
      invoiceId = invoice.invoiceId;
      await pool.query("UPDATE payments SET kb_account_id = $2, kb_invoice_id = $3 WHERE id = $1", [payment.id, accountId, invoiceId]);
      for (const [index, item] of request.items.entries()) {
        await pool.query("UPDATE payment_items SET kb_invoice_item_id = $3 WHERE payment_id = $1 AND reservation_id = $2", [
          payment.id,
          item.reservationId,
          invoice.itemIds[index],
        ]);
      }
    }
    confirmed = await killbill.purchase(accountId, invoiceId, payment.amount_cents, payment.external_key);
  }
  return oneRow<PaymentRow>(db, "UPDATE payments SET confirmed_at = COALESCE(confirmed_at, now()), kb_payment_id = $2 WHERE id = $1 RETURNING *", [
    payment.id,
    confirmed.paymentId,
  ]);
}

function receiptKey(payment: PaymentRow): { kind: string; key: string } {
  return payment.kind === "group"
    ? { kind: "invoice", key: `receipts/groups/${payment.owner_id}/invoice.pdf` }
    : { kind: `${payment.kind}-receipt`, key: `receipts/${payment.owner_id}/${payment.kind}.pdf` };
}

/**
 * Stores the receipt, queues its email and moves the seats. Returns false (seats marked
 * payment_pending, retried later) when the receipt cannot be stored yet.
 */
export async function settle(db: Db, payment: PaymentRow, now: Date): Promise<boolean> {
  const items = await many<{ reservation_id: string; bench: string; amount_cents: number }>(
    db,
    "SELECT reservation_id, bench, amount_cents FROM payment_items WHERE payment_id = $1 ORDER BY bench",
    [payment.id],
  );
  const seats = await reservationsWhere(db, "r.id = ANY($1)", [items.map((item) => item.reservation_id)]);
  const receipt = receiptKey(payment);
  try {
    const pdf = receiptPdf(
      payment.kind,
      payment.billing_name,
      items.map((item) => ({
        bench: item.bench,
        amountCents: item.amount_cents,
        attendee: seats.find((seat) => seat.id === item.reservation_id)?.attendee_name ?? null,
      })),
      now,
    );
    await putObject(receipt.key, pdf, "application/pdf");
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "storage_unavailable") throw error;
    await db.query("UPDATE reservations SET payment_pending = $2 WHERE id = ANY($1)", [seats.map((seat) => seat.id), payment.kind]);
    await db.query("UPDATE payments SET retry_after = now() + random() * interval '4 seconds' WHERE id = $1", [payment.id]);
    return false;
  }
  await db.query("INSERT INTO documents (owner_id, kind, object_key) VALUES ($1, $2, $3) ON CONFLICT (owner_id, kind) DO NOTHING", [
    payment.owner_id,
    receipt.kind,
    receipt.key,
  ]);
  const buyer = await oneRow<{ email: string }>(
    db,
    `SELECT a.email FROM payment_items pi JOIN reservations r ON r.id = pi.reservation_id JOIN accounts a ON a.id = r.buyer_id
     WHERE pi.payment_id = $1 LIMIT 1`,
    [payment.id],
  );
  await enqueueMail(db, `receipt:${payment.id}`, receiptMail(payment, buyer.email, seats, items.map((item) => item.bench)));
  await finalize(db, payment, seats, now);
  await db.query("UPDATE payments SET finalized_at = now() WHERE id = $1", [payment.id]);
  return true;
}

function receiptMail(payment: PaymentRow, to: string, seats: readonly ReservationRow[], benches: readonly string[]) {
  const bench = benches.join(", ");
  const footer = "\n\nYour receipt and seat details are in your account: /account\n\nOpaline Bench Days";
  switch (payment.kind) {
    case "deposit":
      return { to, subject: `Deposit received: Bench ${bench} is yours`, body: `We received your deposit of $${formatDollars(payment.amount_cents)} for Bench ${bench}.${footer}` };
    case "balance":
    case "full":
      return { to, subject: `Paid in full: Bench ${bench}`, body: `Bench ${bench} is paid in full. Thank you.${footer}` };
    case "upgrade":
      return { to, subject: `Upgrade confirmed: Bench ${bench} is Atelier`, body: `Your seat is now Bench ${bench}, an Atelier bench. We charged $${formatDollars(payment.amount_cents)}.${footer}` };
    case "group": {
      const lines = seats.map((seat) => `Bench ${seat.bench}: ${seat.attendee_name ?? "Unassigned"}`);
      return {
        to,
        subject: `Group invoice paid: ${seats.length} seats`,
        body: `Your group invoice of $${formatDollars(payment.amount_cents)} is paid.\n\n${lines.join("\n")}${footer}`,
      };
    }
  }
}

async function finalize(db: Db, payment: PaymentRow, seats: readonly ReservationRow[], now: Date): Promise<void> {
  const clearHold = { hold_expires_at: null, hold_duration: null, payment_pending: null };
  switch (payment.kind) {
    case "deposit":
      return transition(db, seats, "deposit_paid", clearHold);
    case "full":
    case "balance":
      return transition(db, seats, "paid_in_full", clearHold);
    case "group":
      await transition(db, seats, "paid_in_full", clearHold);
      for (const seat of seats) {
        if (seat.attendee_email) await queueAssignmentMail(db, seat, seat.attendee_email);
      }
      return;
    case "upgrade":
      await db.query("UPDATE reservations SET bench = upgrade_target, upgrade_target = NULL, payment_pending = NULL WHERE id = ANY($1)", [
        seats.map((seat) => seat.id),
      ]);
      await offerFreedBenches(db, now, seats.map((seat) => seat.bench));
  }
}

export async function queueAssignmentMail(db: Db, seat: ReservationRow, email: string): Promise<void> {
  const from = buyerName(seat);
  await enqueueMail(db, `assign:${seat.id}:${newId("mail")}`, {
    to: email,
    subject: `${from} assigned you Bench ${seat.bench} at Opaline Bench Days`,
    body: `${from} has given you a seat at the Layered Composite Masterclass on 16 and 17 April 2027 in Chicago.\n\nCreate an account or sign in with this email address, then accept the seat at /account.\n\nOpaline Bench Days`,
  });
}

/** After a failed receipt store this process steps back, so a process that can reach MinIO finishes it. */
let receiptBackoffUntil = 0;

/** Finishes payments Kill Bill confirmed but whose receipt could not be stored yet (claimed per row). */
export async function retryPendingReceipts(): Promise<void> {
  if (Date.now() < receiptBackoffUntil) return;
  const due = await many<{ id: string; kind: PaymentKind }>(
    pool,
    "SELECT id, kind FROM payments WHERE confirmed_at IS NOT NULL AND finalized_at IS NULL AND retry_after <= now() ORDER BY created_at LIMIT 20",
  );
  for (const candidate of due) {
    await tx(async (db) => {
      if (candidate.kind === "upgrade") await lockLedger(db);
      const payment = await one<PaymentRow>(db, "SELECT * FROM payments WHERE id = $1 AND finalized_at IS NULL FOR UPDATE SKIP LOCKED", [candidate.id]);
      if (!payment) return;
      const locked = await many<{ id: string }>(
        db,
        `SELECT r.id FROM reservations r JOIN payment_items pi ON pi.reservation_id = r.id
         WHERE pi.payment_id = $1 ORDER BY r.id FOR NO KEY UPDATE OF r SKIP LOCKED`,
        [payment.id],
      );
      const items = await oneRow<{ n: number }>(db, "SELECT count(*)::int AS n FROM payment_items WHERE payment_id = $1", [payment.id]);
      if (locked.length === items.n && !(await settle(db, payment, new Date()))) receiptBackoffUntil = Date.now() + 6_000;
    });
  }
}

/**
 * Sends a cancelled seat's refund due to Kill Bill: newest payment first, each refund no larger
 * than its payment, each adjusting that seat's item on that payment's invoice.
 */
export async function refundSeat(db: Db, seat: ReservationRow): Promise<{ amountCents: number; transactionKeys: string[] }> {
  const paid = await many<{ id: string; external_key: string; seat_cents: number; item_id: string }>(
    db,
    `SELECT p.id, p.external_key, pi.amount_cents AS seat_cents, pi.kb_invoice_item_id AS item_id
     FROM payment_items pi JOIN payments p ON p.id = pi.payment_id
     WHERE pi.reservation_id = $1 AND p.confirmed_at IS NOT NULL ORDER BY p.confirmed_at DESC, p.created_at DESC`,
    [seat.id],
  );
  const due = seat.refund_due_cents ?? 0;
  let left = due;
  const keys: string[] = [];
  for (const payment of paid) {
    const part = Math.min(left, payment.seat_cents);
    if (part <= 0) break;
    const n = keys.length + 1;
    const key = `${refundKeyPrefix(seat.id)}${n}`;
    const recorded = await killbill.paymentByKey(payment.external_key);
    if (!recorded) throw killbill.billingUnavailable();
    if (!killbill.succeeded(recorded, "REFUND", key)) await killbill.refund(recorded.paymentId, part, payment.item_id, key);
    await db.query(
      `INSERT INTO refunds (reservation_id, n, payment_id, amount_cents, external_key, confirmed_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (reservation_id, n) DO NOTHING`,
      [seat.id, n, payment.id, part, key],
    );
    keys.push(key);
    left -= part;
  }
  return { amountCents: due, transactionKeys: keys };
}
