// Hour packs: figures (one SQL view), purchase through Kill Bill with a recorded attempt, the
// recovery of paid-but-unrecorded and abandoned attempts, and the owner's refund.

import type { EmailStatus, Pack, PackDetail, PackHours } from "../shared/api.js";
import { clockText, dateLabel, localDate, localMinute } from "../shared/clock.js";
import { dollars } from "../shared/format.js";
import { db } from "./db.js";
import { ApiError, conflict } from "./errors.js";
import { storeResponse, type KeyClaim } from "./idempotency.js";
import { BillingUnavailable, chargeInvoice, ensureAccount, findAccount, paidPayment, payInvoice, refundPayment, unpaidInvoices, voidInvoice } from "./killbill.js";
import { iso, zone } from "./kitchen.js";
import { packEntries, writeMovement } from "./ledger.js";
import { queueEmail } from "./mail.js";
import { col, type Queryable, type Row } from "./postgres.js";
import { findTenant } from "./tenants.js";

const PACK_PRICE_CENTS: Readonly<Record<PackHours, number>> = { 10: 26_000, 20: 48_000, 40: 88_000 };
const ATTEMPT_LEASE_SECONDS = 45;

const billingDown = (): ApiError =>
  new ApiError(503, "billing_unavailable", "Billing is unreachable. Nothing was charged.");

/** The receipt's delivery status: queued until the mail server acknowledged it. */
function receiptStatus(row: Row): EmailStatus {
  const delivered = row.receipt_delivered_at;
  return delivered instanceof Date ? { status: "sent", sentAt: iso(delivered) } : { status: "queued", sentAt: null };
}

function packView(row: Row): Pack {
  return {
    id: col.text(row, "id"),
    hours: col.int(row, "hours"),
    purchasedMinutes: col.int(row, "purchased_minutes"),
    balanceMinutes: col.int(row, "balance_minutes"),
    heldMinutes: col.int(row, "held_minutes"),
    availableMinutes: col.int(row, "available_minutes"),
    priceCents: col.int(row, "price_cents"),
    status: col.text(row, "status") === "refunded" ? "refunded" : "active",
    invoiceId: col.text(row, "invoice_id"),
    purchasedAt: iso(col.time(row, "purchased_at")),
    receiptEmail: receiptStatus(row),
  };
}

/** The prorated refund of a pack's unused hours, in whole cents with the remainder dropped. */
function refundCents(pack: Pack): number {
  return Math.floor((pack.priceCents * pack.balanceMinutes) / pack.purchasedMinutes);
}

export async function listPacks(q: Queryable, tenantId: string): Promise<Pack[]> {
  return (await q.query("SELECT * FROM pack_figures WHERE tenant_id = $1 ORDER BY purchased_at, id", [tenantId])).map(packView);
}

export async function packOwner(id: string): Promise<string | null> {
  const [row] = await db.query("SELECT tenant_id FROM packs WHERE id = $1", [id]);
  return row ? col.text(row, "tenant_id") : null;
}

export async function packDetail(q: Queryable, id: string): Promise<PackDetail> {
  const [row] = await q.query("SELECT * FROM pack_figures WHERE id = $1", [id]);
  if (!row) throw new Error(`pack ${id} vanished`);
  const pack = packView(row);
  return { ...pack, refundableCents: pack.status === "refunded" ? 0 : refundCents(pack), refundedCents: col.intOrNull(row, "refunded_cents"), entries: await packEntries(q, id) };
}

interface Attempt {
  id: string;
  userId: string;
  tenantId: string;
  endpoint: string;
  key: string;
  fingerprint: string;
  hours: PackHours;
  state: string;
  invoiceId: string | null;
  invoiceItemId: string | null;
  paymentId: string | null;
}

function attemptRecord(row: Row): Attempt {
  const hours = col.int(row, "hours");
  return {
    id: col.text(row, "id"),
    userId: col.text(row, "user_id"),
    tenantId: col.text(row, "tenant_id"),
    endpoint: col.text(row, "endpoint"),
    key: col.text(row, "idempotency_key"),
    fingerprint: col.text(row, "fingerprint"),
    hours: hours === 20 || hours === 40 ? hours : 10,
    state: col.text(row, "state"),
    invoiceId: col.textOrNull(row, "invoice_id"),
    invoiceItemId: col.textOrNull(row, "invoice_item_id"),
    paymentId: col.textOrNull(row, "payment_id"),
  };
}

async function setAttempt(id: string, changes: Record<string, string>): Promise<void> {
  const names = Object.keys(changes);
  await db.query(
    `UPDATE purchase_attempts SET ${names.map((n, i) => `${n} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
    [id, ...names.map((n) => changes[n] ?? null)],
  );
}

/**
 * Writes the pack, its purchase movement and its receipt in one step, using the paid invoice,
 * and stores the 201 response under the attempt's key. Running it twice writes nothing twice.
 */
async function finishAttempt(attemptId: string, paymentId: string): Promise<Pack> {
  return db.transaction(async (tx) => {
    const [row] = await tx.query("SELECT * FROM purchase_attempts WHERE id = $1 FOR UPDATE", [attemptId]);
    if (!row) throw new Error(`attempt ${attemptId} vanished`);
    const attempt = attemptRecord(row);
    const [existing] = await tx.query("SELECT * FROM pack_figures WHERE attempt_id = $1", [attemptId]);
    if (existing) return packView(existing);
    const tenant = await findTenant(tx, attempt.tenantId);
    if (!tenant || !attempt.invoiceId || !attempt.invoiceItemId) throw new Error(`attempt ${attemptId} is not invoiced`);
    const cents = PACK_PRICE_CENTS[attempt.hours];
    const minutes = attempt.hours * 60;
    const [inserted] = await tx.query(
      `INSERT INTO packs (tenant_id, hours, purchased_minutes, price_cents, invoice_id, invoice_item_id, payment_id, attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, purchased_at`,
      [attempt.tenantId, attempt.hours, minutes, cents, attempt.invoiceId, attempt.invoiceItemId, paymentId, attemptId],
    );
    if (!inserted) throw new Error("pack insert returned nothing");
    const packId = col.text(inserted, "id");
    const bought = col.time(inserted, "purchased_at").getTime();
    await writeMovement(tx, "purchase", packId, minutes, null);
    await queueEmail(tx, {
      action: "pack_receipt", recordId: packId, toName: tenant.contactName, to: tenant.email,
      subject: `Receipt: ${attempt.hours}-hour pack`,
      lines: [`Hours added: ${attempt.hours} h`, `Amount: $${dollars(cents)}`, `Invoice: ${attempt.invoiceId}`,
        `Purchased: ${dateLabel(localDate(bought, zone))} ${clockText(localMinute(bought, zone))} ${zone}`],
    });
    await tx.query("UPDATE purchase_attempts SET state = 'finished', payment_id = $2, updated_at = now() WHERE id = $1", [attemptId, paymentId]);
    const [figures] = await tx.query("SELECT * FROM pack_figures WHERE id = $1", [packId]);
    if (!figures) throw new Error("pack vanished");
    const pack = packView(figures);
    const claim: KeyClaim = { userId: attempt.userId, endpoint: attempt.endpoint, key: attempt.key };
    await storeResponse(tx, claim, attempt.fingerprint, 201, JSON.stringify(pack));
    return pack;
  });
}

/**
 * The invoices an unpaid attempt left behind: the one it recorded, or, when it stopped before
 * recording it, whatever is unpaid on the account. Each purchase pays at once, so with no other
 * attempt of this tenant running an unpaid invoice can only be this attempt's.
 */
async function strandedInvoices(attempt: Attempt): Promise<string[]> {
  if (attempt.invoiceId) return [attempt.invoiceId];
  const [running] = await db.query(
    "SELECT 1 FROM purchase_attempts WHERE tenant_id = $1 AND id <> $2 AND state IN ('started', 'invoiced') AND lease_until >= now() LIMIT 1",
    [attempt.tenantId, attempt.id],
  );
  if (running) return [];
  const accountId = await findAccount(`stationhouse-${attempt.tenantId}`);
  return accountId ? unpaidInvoices(accountId) : [];
}

/** Settles an attempt left behind: finish it when Kill Bill holds its payment, otherwise void its invoice. */
async function settleAttempt(attempt: Attempt): Promise<Pack | null> {
  const paymentId = attempt.paymentId ?? await paidPayment(`stationhouse-attempt-${attempt.id}`);
  if (paymentId) return finishAttempt(attempt.id, paymentId);
  for (const invoiceId of await strandedInvoices(attempt)) await voidInvoice(invoiceId);
  await setAttempt(attempt.id, { state: "voided" });
  return null;
}

export async function purchase(claim: KeyClaim, print: string, tenantId: string, hours: PackHours): Promise<Pack> {
  const [prior] = await db.query(
    `SELECT * FROM purchase_attempts WHERE user_id = $1 AND endpoint = $2 AND idempotency_key = $3
      ORDER BY created_at DESC LIMIT 1`,
    [claim.userId, claim.endpoint, claim.key],
  );
  try {
    if (prior && ["started", "invoiced", "paid"].includes(col.text(prior, "state"))) {
      const earlier = attemptRecord(prior);
      if (earlier.fingerprint !== print) throw conflict("idempotency_conflict", "This Idempotency-Key was already used with a different request.");
      const finished = await settleAttempt(earlier);
      if (finished) return finished;
    }
    return await freshPurchase(claim, print, tenantId, hours);
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    console.error(`pack purchase for tenant ${tenantId}:`, error.message);
    throw billingDown();
  }
}

async function freshPurchase(claim: KeyClaim, print: string, tenantId: string, hours: PackHours): Promise<Pack> {
  const tenant = await findTenant(db, tenantId);
  if (!tenant) throw new Error(`tenant ${tenantId} vanished`);
  const [row] = await db.query(
    `INSERT INTO purchase_attempts (user_id, tenant_id, endpoint, idempotency_key, fingerprint, hours, state, lease_until)
     VALUES ($1, $2, $3, $4, $5, $6, 'started', now() + make_interval(secs => $7)) RETURNING *`,
    [claim.userId, tenantId, claim.endpoint, claim.key, print, hours, ATTEMPT_LEASE_SECONDS],
  );
  if (!row) throw new Error("attempt insert returned nothing");
  const attempt = attemptRecord(row);
  const cents = PACK_PRICE_CENTS[hours];
  let invoice: { invoiceId: string; itemId: string } | null = null;
  try {
    const accountId = tenant.killbillAccountId ?? await ensureAccount(tenantId, tenant.businessName, tenant.email);
    if (!tenant.killbillAccountId) await db.query("UPDATE tenants SET killbill_account_id = $2 WHERE id = $1", [tenantId, accountId]);
    invoice = await chargeInvoice(accountId, `Stationhouse ${hours}-hour pack`, cents);
    await setAttempt(attempt.id, { state: "invoiced", account_id: accountId, invoice_id: invoice.invoiceId, invoice_item_id: invoice.itemId });
    const paymentId = await payInvoice(accountId, invoice.invoiceId, cents, `stationhouse-attempt-${attempt.id}`);
    try {
      await setAttempt(attempt.id, { state: "paid", payment_id: paymentId });
      return await finishAttempt(attempt.id, paymentId);
    } catch (error) {
      console.error(`purchase attempt ${attempt.id} paid but not recorded:`, error);
      throw new ApiError(503, "purchase_pending", "Payment taken, but your hours aren't on file yet. They'll be added automatically; you won't be charged again.");
    }
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    if (invoice && await paidPayment(`stationhouse-attempt-${attempt.id}`).catch(() => "unknown")) {
      throw new ApiError(503, "purchase_pending", "Payment taken, but your hours aren't on file yet. They'll be added automatically; you won't be charged again.");
    }
    if (invoice) await voidInvoice(invoice.invoiceId).catch(() => undefined);
    await setAttempt(attempt.id, { state: invoice ? "voided" : "failed" }).catch(() => undefined);
    throw error;
  }
}

/** Run by every process: settles attempts whose lease lapsed without finishing. */
export async function recoverAttempts(): Promise<void> {
  const rows = await db.query(
    `SELECT * FROM purchase_attempts WHERE state IN ('started', 'invoiced', 'paid') AND lease_until < now() ORDER BY created_at LIMIT 20`,
  );
  for (const row of rows) {
    const attempt = attemptRecord(row);
    await db.transaction(async (tx) => {
      const [locked] = await tx.query(
        "UPDATE purchase_attempts SET lease_until = now() + make_interval(secs => $2) WHERE id = $1 AND lease_until < now() RETURNING id",
        [attempt.id, ATTEMPT_LEASE_SECONDS],
      );
      return locked !== undefined;
    }).then((mine) => (mine ? settleAttempt(attempt) : null))
      .catch((error: unknown) => console.error(`recovering purchase attempt ${attempt.id}:`, error));
  }
}

/** active → refunded by the owner: refunds the unused hours of a pack with nothing booked or held on it. */
export async function refund(packId: string, expectedCents: number): Promise<PackDetail> {
  return db.transaction(async (tx) => {
    // Claims lock the tenant row, so taking it first keeps a new hold from landing mid-refund.
    await tx.query("SELECT 1 FROM tenants t JOIN packs p ON p.tenant_id = t.id WHERE p.id = $1 FOR UPDATE OF t", [packId]);
    await tx.query("SELECT 1 FROM packs WHERE id = $1 FOR UPDATE", [packId]);
    const [row] = await tx.query("SELECT * FROM pack_figures WHERE id = $1", [packId]);
    if (!row) throw new Error(`pack ${packId} vanished`);
    const figures = packView(row);
    if (figures.status === "refunded") throw conflict("invalid_transition", "This pack has already been refunded.");
    if (figures.balanceMinutes === 0) throw conflict("pack_empty", "This pack has no hours left to refund.");
    const [booked] = await tx.query(
      "SELECT 1 FROM bookings WHERE pack_id = $1 AND status IN ('confirmed', 'checked_in') LIMIT 1", [packId]);
    if (figures.heldMinutes > 0 || booked) {
      throw conflict("pack_in_use", "This pack has a booking or hold on it, so it can't be refunded.");
    }
    const cents = refundCents(figures);
    if (cents !== expectedCents) {
      throw new ApiError(412, "refund_amount_changed", "The refundable amount changed. Check it and press Refund again.");
    }
    try {
      await refundPayment(col.text(row, "payment_id"), col.text(row, "invoice_item_id"), cents, `stationhouse-refund-${packId}`);
    } catch (error) {
      if (error instanceof BillingUnavailable) {
        console.error(`refund of pack ${packId}:`, error.message);
        throw new ApiError(503, "billing_unavailable", "Billing is unreachable. No refund was issued.");
      }
      throw error;
    }
    await writeMovement(tx, "refund", packId, -figures.balanceMinutes, null);
    await tx.query("UPDATE packs SET status = 'refunded', refunded_cents = $2 WHERE id = $1", [packId, cents]);
    return packDetail(tx, packId);
  });
}
