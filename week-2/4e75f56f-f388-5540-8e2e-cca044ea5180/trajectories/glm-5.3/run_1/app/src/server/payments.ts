import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import { COURSE } from "./config.js";
import { newId } from "./ids.js";
import { query, withTransaction } from "./db.js";
import { queueMail } from "./mail.js";
import type { KillBill } from "./killbill.js";
import type { S3 } from "./s3.js";
import { conflict } from "./errors.js";
import type { ReceiptKind } from "./pdfs.js";
import { renderReceiptPdf, renderGroupInvoicePdf } from "./pdfs.js";
import { fetchReservationClient } from "./reservations.js";
import { tierName } from "./format.js";

export interface PaymentContext {
  cfg: Config;
  kb: KillBill;
  s3: S3;
}

export function bodyHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export function validIdempotencyKey(key: unknown): boolean {
  return typeof key === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(key);
}

/**
 * A completed request stores its response; a replay with the same key,
 * endpoint and body returns that response unchanged. 202/409/422/503 answers
 * are not stored, so a retry runs again.
 */
export async function idempotentWrap<T>(
  accountId: string,
  key: string,
  endpoint: string,
  body: unknown,
  run: () => Promise<{ status: number; response: T }>
): Promise<{ status: number; response: T }> {
  const hash = bodyHash(body);
  const { rows } = await query<{ endpoint: string; body_hash: string; status: number; response: unknown }>(
    "SELECT endpoint, body_hash, status, response FROM idempotency WHERE account_id = $1 AND key = $2",
    [accountId, key]
  );
  const existing = rows[0];
  if (existing && existing.status >= 200 && existing.status < 300) {
    if (existing.endpoint !== endpoint || existing.body_hash !== hash) {
      throw conflict("idempotency_conflict", "This key was used for a different request.");
    }
    return { status: existing.status, response: existing.response as T };
  }
  const result = await run();
  if (result.status >= 200 && result.status < 300) {
    await query(
      `INSERT INTO idempotency (account_id, key, endpoint, body_hash, status, response)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, key) DO UPDATE SET endpoint = $3, body_hash = $4, status = $5, response = $6`,
      [accountId, key, endpoint, hash, result.status, JSON.stringify(result.response)]
    );
  }
  return result;
}

export interface BuyerRef {
  id: string;
  name: string;
  email: string;
}

/** Ensures the buyer's Kill Bill account and its built-in external payment method. */
async function ensureKbAccount(ctx: PaymentContext, buyer: BuyerRef): Promise<{ kbAccountId: string; paymentMethodId: string }> {
  const kbAccountId = await ctx.kb.ensureAccount(`ob-${buyer.id}`, buyer.name, buyer.email);
  const paymentMethodId = await ctx.kb.ensureExternalPaymentMethod(kbAccountId);
  return { kbAccountId, paymentMethodId };
}

interface ChargeItem {
  description: string;
  amountCents: number;
}

/**
 * Creates the invoice for a payment external key and the PURCHASE against it.
 * The invoice is recorded before the purchase, so a retry with any
 * Idempotency-Key can never create a second invoice or a second charge.
 */
async function chargeExternalKey(
  ctx: PaymentContext,
  buyer: BuyerRef,
  externalKey: string,
  items: ChargeItem[]
): Promise<{ invoiceId: string; itemIds: string[]; paymentId: string }> {
  const total = items.reduce((s, i) => s + i.amountCents, 0);
  const { rows: prior } = await query<{ invoice_id: string; item_ids: string[]; payment_id: string | null }>(
    "SELECT invoice_id, item_ids, payment_id FROM kb_invoices WHERE external_key = $1",
    [externalKey]
  );
  let invoiceId: string;
  let itemIds: string[];
  if (prior[0]) {
    invoiceId = prior[0].invoice_id;
    itemIds = prior[0].item_ids;
  } else {
    const { kbAccountId } = await ensureKbAccount(ctx, buyer);
    const created = await ctx.kb.createInvoice(kbAccountId, items.map((i) => ({ description: i.description, amountCents: i.amountCents })));
    invoiceId = created.invoiceId;
    itemIds = created.itemIds;
    await query(
      "INSERT INTO kb_invoices (external_key, invoice_id, item_ids, total_cents) VALUES ($1, $2, $3, $4) ON CONFLICT (external_key) DO NOTHING",
      [externalKey, invoiceId, JSON.stringify(itemIds), total]
    );
  }
  // The PURCHASE, idempotent on its transaction external key in Kill Bill.
  let paymentId = prior[0]?.payment_id ?? null;
  if (!paymentId) {
    const found = await ctx.kb.lookupTransaction(externalKey);
    if (found) {
      paymentId = found.paymentId;
    } else {
      const { kbAccountId, paymentMethodId } = await ensureKbAccount(ctx, buyer);
      const purchased = await ctx.kb.purchase(kbAccountId, paymentMethodId, invoiceId, total, externalKey);
      paymentId = purchased.paymentId;
    }
    await query("UPDATE kb_invoices SET payment_id = $1, confirmed_at = now() WHERE external_key = $2 AND payment_id IS NULL", [paymentId, externalKey]);
  }
  return { invoiceId, itemIds, paymentId };
}

export const RECEIPT_SUBJECT: Record<ReceiptKind, (bench: string) => string> = {
  deposit: (b) => `Deposit received: Bench ${b} is yours`,
  balance: (b) => `Paid in full: Bench ${b}`,
  full: (b) => `Paid in full: Bench ${b}`,
  upgrade: (b) => `Upgrade confirmed: Bench ${b} is Atelier`,
};

/** The payment part of every single-seat payment: charge once, record once. */
export async function chargeSeat(
  ctx: PaymentContext,
  buyer: BuyerRef,
  reservation: { id: string; bench: string; tier: string },
  kind: ReceiptKind,
  amountCents: number,
  description: string
): Promise<{ invoiceId: string; invoiceItemId: string }> {
  const externalKey = `ob-${kind}-${reservation.id}`;
  const { invoiceId, itemIds, paymentId } = await chargeExternalKey(ctx, buyer, externalKey, [
    { description, amountCents },
  ]);
  const invoiceItemId = itemIds[0] ?? "";
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO kb_payments (id, reservation_id, kind, external_key, amount_cents, invoice_id, invoice_item_id, payment_id, ord, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, now())
       ON CONFLICT (external_key) DO NOTHING
       RETURNING id`,
      [newId("kbp"), reservation.id, kind, externalKey, amountCents, invoiceId, invoiceItemId, paymentId]
    );
    if (rows.length > 0) {
      await client.query("UPDATE reservations SET paid_cents = paid_cents + $2 WHERE id = $1", [reservation.id, amountCents]);
    }
  });
  return { invoiceId, invoiceItemId };
}

/**
 * Stores the receipt PDF, queues the receipt email and moves the reservation
 * to its paid state — the three things every payment needs. Returns false
 * when the receipt could not be stored; the reservation stays pending until
 * the retry job finishes it.
 */
export async function finishSeatReceipt(
  ctx: PaymentContext,
  reservationId: string,
  kind: ReceiptKind,
  chargedCents: number,
  buyer: BuyerRef,
  billingName: string
): Promise<boolean> {
  const { rows } = await query<{ bench: string; tier: string; attendee_name: string | null }>(
    "SELECT bench, tier, attendee_name FROM reservations WHERE id = $1",
    [reservationId]
  );
  const r = rows[0];
  if (!r) return false;
  const key = `receipts/${reservationId}/${kind}.pdf`;
  try {
    const pdf = await renderReceiptPdf({
      heading: kind === "deposit" ? "Deposit receipt" : kind === "upgrade" ? "Upgrade receipt" : "Paid-in-full receipt",
      sub: `${COURSE.title} — ${COURSE.dates}`,
      lines: [
        {
          bench: r.bench,
          tier: r.tier,
          amountCents: chargedCents,
          attendeeName: r.attendee_name,
          note: kind === "upgrade" ? "Atelier upgrade" : kind === "balance" ? "balance" : kind === "full" ? "full price" : "deposit",
        },
      ],
      totalCents: chargedCents,
      billingName,
    });
    await ctx.s3.put(key, pdf, "application/pdf");
  } catch {
    return false;
  }
  // The documents row is the email claim: only one writer queues the email.
  const { rows: docRows } = await query(
    "INSERT INTO documents (reservation_id, kind, object_key) VALUES ($1, $2, $3) ON CONFLICT (reservation_id, kind) DO NOTHING RETURNING reservation_id",
    [reservationId, `${kind}-receipt`, key]
  );
  if (docRows.length > 0) {
    await queueMail(buyer.email, RECEIPT_SUBJECT[kind](r.bench), receiptBody(kind, r.bench));
  }
  await applyPaidState(reservationId, kind);
  return true;
}

/**
 * The one place the payment state moves happen: held→deposit_paid (deposit),
 * held→paid_in_full (full), deposit_paid→paid_in_full (balance). An upgrade
 * keeps its state and is finished by the upgrade completion.
 */
async function applyPaidState(reservationId: string, kind: ReceiptKind): Promise<void> {
  await withTransaction(async (client) => {
    const r = await fetchReservationClient(client, reservationId);
    if (!r) return;
    let target: string | null = null;
    if (r.state === "held" && kind === "deposit") target = "deposit_paid";
    else if (r.state === "held" && kind === "full") target = "paid_in_full";
    else if (r.state === "deposit_paid" && kind === "balance") target = "paid_in_full";
    if (target) {
      await client.query("UPDATE reservations SET state = $2, payment_pending = NULL, payment_in_flight = FALSE WHERE id = $1", [reservationId, target]);
    } else {
      await client.query("UPDATE reservations SET payment_pending = NULL, payment_in_flight = FALSE WHERE id = $1", [reservationId]);
    }
  });
}

function receiptBody(kind: ReceiptKind, bench: string): string {
  return `Thank you for your payment for Bench ${bench} at Opaline Bench Days. Your receipt is in your account: /account\n\n${COURSE.title}, ${COURSE.dates}. ${COURSE.venue}.`;
}

export interface GroupSeat {
  reservationId: string;
  bench: string;
  tier: string;
  amountCents: number;
  attendeeName: string | null;
}

/**
 * Group checkout: one Kill Bill invoice with one item per seat and one
 * PURCHASE for the total. Each seat's item and its paid_cents are recorded
 * exactly once.
 */
export async function chargeGroup(
  ctx: PaymentContext,
  buyer: BuyerRef,
  groupId: string,
  seats: GroupSeat[]
): Promise<{ invoiceId: string; itemIds: string[] }> {
  const externalKey = `ob-group-${groupId}`;
  const items = seats.map((s) => ({
    description: `Bench ${s.bench} ${tierName(s.tier)} full price`,
    amountCents: s.amountCents,
  }));
  const { invoiceId, itemIds, paymentId } = await chargeExternalKey(ctx, buyer, externalKey, items);
  await withTransaction(async (client) => {
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i]!;
      const { rows } = await client.query(
        `INSERT INTO kb_payments (id, reservation_id, kind, external_key, payment_external_key, amount_cents, invoice_id, invoice_item_id, payment_id, ord, confirmed_at)
         VALUES ($1, $2, 'group', $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (external_key) DO NOTHING
         RETURNING id`,
        [newId("kbp"), s.reservationId, `ob-group-item-${groupId}-${s.reservationId}`, externalKey, s.amountCents, invoiceId, itemIds[i] ?? "", paymentId, i + 1]
      );
      if (rows.length > 0) {
        await client.query("UPDATE reservations SET paid_cents = paid_cents + $2 WHERE id = $1", [s.reservationId, s.amountCents]);
      }
    }
  });
  return { invoiceId, itemIds };
}

export async function finishGroupInvoice(
  ctx: PaymentContext,
  groupId: string,
  buyer: BuyerRef,
  seats: GroupSeat[],
  billingName: string
): Promise<boolean> {
  const key = `receipts/groups/${groupId}/invoice.pdf`;
  const total = seats.reduce((s, x) => s + x.amountCents, 0);
  try {
    const pdf = await renderGroupInvoicePdf({ groupSeats: seats, totalCents: total, billingName });
    await ctx.s3.put(key, pdf, "application/pdf");
  } catch {
    return false;
  }
  const { rows: docRows } = await query(
    "INSERT INTO documents (reservation_id, kind, object_key) VALUES ($1, 'invoice', $2) ON CONFLICT (reservation_id, kind) DO NOTHING RETURNING reservation_id",
    [groupId, key]
  );
  if (docRows.length > 0) {
    const lines = seats.map((s) => `Bench ${s.bench}: ${s.attendeeName ?? "Unassigned"}`).join("\n");
    await queueMail(buyer.email, `Group invoice paid: ${seats.length} seats`, `Your group invoice is paid.\n\n${lines}\n\nYour invoice PDF is in your account: /account`);
  }
  await withTransaction(async (client) => {
    await client.query("UPDATE groups SET state = 'paid_in_full' WHERE id = $1", [groupId]);
    await client.query(
      "UPDATE reservations SET state = 'paid_in_full', payment_pending = NULL, payment_in_flight = FALSE WHERE group_id = $1",
      [groupId]
    );
  });
  return true;
}
