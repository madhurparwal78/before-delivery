// Billing flows over Kill Bill. Every charge is the amount on the invoice Kill Bill generated; paying an
// invoice stores its document, records the payment and queues the receipt together or not at all.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import type { Author, Invoice, Payment, Period, Plan } from "../shared/api-types.js";
import { dollars, isoSecond, localTime } from "../shared/format.js";
import { isRecord, type FieldErrors } from "../shared/graph.js";
import { SCHEDULER, type Caller } from "./auth.js";
import { config } from "./config.js";
import { audit } from "./audit.js";
import { one, pool, rows, transaction, withAdvisoryLock, type Db } from "./db.js";
import { cardDeclined, conflict, invalid, invalidSignature, notFound } from "./errors.js";
import { json, type Reply } from "./http.js";
import * as killbill from "./services/killbill.js";
import { enqueueMail } from "./services/mail.js";
import { assertStorageReachable, deleteObject, keys, putObject } from "./services/storage.js";
import { seatsUsed } from "./domain/seats.js";
import { PERIODS, PLAN_IDS, assertActive, assertCancelAllowed, assertCheckoutAllowed, assertSeatsFit, changeTiming, effectiveState, killbillPlan, killbillSeatPlan, loadSubscription, suspensionCause, toSubscription, type SubscriptionRow, currentSubscription } from "./domain/subscription.js";
import { invoicePdf } from "./pdf.js";
import { PLAN_CATALOG as PLANS } from "../shared/plans.js";
import { billingContacts, loadWorkspace, ownerEmail, type WorkspaceRow } from "./workspace.js";

/** Billing changes for one workspace apply one at a time, in arrival order, on every serve instance. */
export const serially = <T>(workspaceId: string, work: () => Promise<T>) => withAdvisoryLock(`billing:${workspaceId}`, work);

interface Card { number: string; expMonth: number; expYear: number; cvc: string }
const DECLINED_CARD = "4000000000000002";

function luhn(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

function parseCard(value: unknown, now: Date): Card {
  if (!isRecord(value)) throw invalid({ card: "Enter a card" });
  const errors: FieldErrors = {};
  const { number, expMonth, expYear, cvc } = value;
  if (typeof number !== "string" || !/^\d{13,19}$/.test(number) || !luhn(number)) errors["card.number"] = "Enter a valid card number";
  if (typeof expMonth !== "number" || !Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) errors["card.expMonth"] = "Use a month from 1 to 12";
  if (typeof expYear !== "number" || !Number.isInteger(expYear) || expYear < 1000 || expYear > 9999) errors["card.expYear"] = "Use a four-digit year";
  if (typeof cvc !== "string" || !/^\d{3,4}$/.test(cvc)) errors["card.cvc"] = "Use 3 or 4 digits";
  if (!errors["card.expMonth"] && !errors["card.expYear"] && typeof expMonth === "number" && typeof expYear === "number") {
    if (expYear * 12 + expMonth < now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) errors["card.expMonth"] = "The card has expired";
  }
  if (Object.keys(errors).length > 0) throw invalid(errors);
  return { number: String(number), expMonth: Number(expMonth), expYear: Number(expYear), cvc: String(cvc) };
}

/** The test card is declined by the gateway; nothing is recorded anywhere. */
function charge(card: Card): void {
  if (card.number === DECLINED_CARD) throw cardDeclined();
}

const invoiceOut = (inv: killbill.KbInvoice, pdfAvailable: boolean): Invoice => ({
  id: inv.invoiceId, number: inv.invoiceNumber, date: inv.invoiceDate, amountCents: inv.amountCents,
  balanceCents: inv.balanceCents, status: inv.balanceCents > 0 ? "unpaid" : "paid", pdfAvailable,
});

interface PaymentRow { id: string; invoice_id: string; invoice_number: string; amount_cents: number; refunded_cents: number; charged_back: boolean; created_at: Date }

const paymentOut = (p: PaymentRow): Payment => ({
  id: p.id, invoiceId: p.invoice_id, amountCents: p.amount_cents, refundedCents: p.refunded_cents, createdAt: isoSecond(p.created_at),
});

/**
 * Pays an invoice for its balance: the document first, then the Kill Bill PURCHASE (the document is taken back if
 * that fails), then one transaction records the payment, runs the caller's bookkeeping and queues the receipt.
 */
async function settle(ws: WorkspaceRow, acct: killbill.KbAccount, inv: killbill.KbInvoice, externalKey: string,
  bookkeeping: (client: pg.PoolClient) => Promise<void>): Promise<{ invoice: Invoice; payment: Payment }> {
  const key = keys.invoice(ws.id, inv.invoiceId);
  const hadDocument = (await one(pool, "SELECT 1 FROM invoice_documents WHERE invoice_id = $1", [inv.invoiceId])) !== undefined;
  const amount = inv.balanceCents;
  await putObject(key, invoicePdf({
    workspaceName: ws.name, invoiceNumber: inv.invoiceNumber, date: inv.invoiceDate, items: inv.items, totalCents: inv.amountCents, paidCents: amount,
  }), "application/pdf");
  let paymentId: string;
  try {
    paymentId = await killbill.purchase(acct, inv.invoiceId, amount, externalKey);
  } catch (error) {
    if (!hadDocument) await deleteObject(key).catch(() => undefined);
    throw error;
  }
  const payment = await transaction(async (client) => {
    const [row] = await rows<PaymentRow>(client,
      `INSERT INTO payments (id, workspace_id, invoice_id, invoice_number, amount_cents, created_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
      [paymentId, ws.id, inv.invoiceId, inv.invoiceNumber, amount]);
    await client.query("INSERT INTO invoice_documents (invoice_id, workspace_id, created_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING", [inv.invoiceId, ws.id]);
    await bookkeeping(client);
    await enqueueMail(client, {
      to: await billingContacts(client, ws.id),
      subject: `Receipt for invoice ${inv.invoiceNumber}: ${dollars(amount)}`,
      body: `Thank you. We received ${dollars(amount)} for invoice ${inv.invoiceNumber} of ${ws.name}.\n\nInvoice date: ${inv.invoiceDate}\nTotal: ${dollars(inv.amountCents)}\nPaid: ${dollars(amount)}\n\nOrrery Studio`,
    });
    return row;
  });
  return { invoice: invoiceOut({ ...inv, balanceCents: 0 }, true), payment: paymentOut(payment) };
}

async function accountFor(ws: WorkspaceRow): Promise<killbill.KbAccount> {
  await killbill.ensureCatalog();
  return killbill.openAccount(ws.id, ws.name, await ownerEmail(pool, ws.id));
}

const knownInvoices = async (acct: killbill.KbAccount) => new Set((await killbill.accountInvoices(acct.accountId)).map((i) => i.invoiceId));

const isPlan = (value: unknown): value is Plan => PLAN_IDS.some((p) => p === value);
const isPeriod = (value: unknown): value is Period => PERIODS.some((p) => p === value);

function readPlanChoice(body: Record<string, unknown>): { plan: Plan; period: Period } {
  const { plan, period } = body;
  if (isPlan(plan) && isPeriod(period)) return { plan, period };
  const errors: FieldErrors = {};
  if (!isPlan(plan)) errors.plan = "Choose Team or Business";
  if (!isPeriod(period)) errors.period = "Choose monthly or annual";
  throw invalid(errors);
}

function readExtraSeats(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 500) throw invalid({ extraSeats: "Use a whole number from 0 to 500" });
  return value;
}

const subscriptionNow = async (db: Db, workspaceId: string) => toSubscription(await loadSubscription(db, workspaceId), new Date());

export async function checkout(caller: Caller, body: unknown, key: string): Promise<Reply> {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const now = new Date();
  const sub = await currentSubscription(ws.id);
  assertCheckoutAllowed(sub, now);
  const fields = isRecord(body) ? body : {};
  const { plan, period } = readPlanChoice(fields);
  const extraSeats = readExtraSeats(fields.extraSeats);
  assertSeatsFit(await seatsUsed(pool, ws.id, now), PLANS[plan].includedSeats + extraSeats);
  const card = parseCard(fields.card, now);
  charge(card);
  await assertStorageReachable();
  const acct = await accountFor(ws);
  const known = await knownInvoices(acct);
  await killbill.startSubscription(acct.accountId, plan, period, extraSeats);
  const inv = await killbill.newInvoice(acct.accountId, known);
  const paid = await settle(ws, acct, inv, `${ws.id}:${key}`, async (client) => {
    await client.query(
      `UPDATE subscriptions SET state = 'active', plan = $2, period = $3, extra_seats = $4, suspended_by = NULL,
       kb_account_id = $5, card_last4 = $6, pending_change = NULL WHERE workspace_id = $1`,
      [ws.id, plan, period, extraSeats, acct.accountId, card.number.slice(-4)]);
    await audit(client, ws.id, caller, "subscription.started", { type: "subscription", id: ws.id });
  });
  return json(201, { subscription: await subscriptionNow(pool, ws.id), ...paid });
}

function samePlan(sub: SubscriptionRow, choice: { plan: Plan; period: Period }): void {
  if (sub.plan === choice.plan && sub.period === choice.period) throw invalid({ plan: "Already on this plan" });
}

async function currentSubscriptions(acct: killbill.KbAccount) {
  const subs = await killbill.activeSubscriptions(acct.accountId);
  const base = subs.find((s) => s.category === "BASE");
  if (!base) throw conflict("subscription_not_active");
  return { base, seats: subs.filter((s) => s.category === "ADD_ON") };
}

export async function previewPlan(caller: Caller, query: URLSearchParams): Promise<Reply> {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const sub = await currentSubscription(ws.id);
  assertActive(sub, new Date());
  const choice = readPlanChoice({ plan: query.get("plan"), period: query.get("period") });
  samePlan(sub, choice);
  const acct = await accountFor(ws);
  const { base, seats } = await currentSubscriptions(acct);
  if (changeTiming(sub, choice) === "end_of_term") {
    return json(200, { change: "end_of_term", amountCents: 0, effectiveAt: isoSecond(killbill.endOfTerm(acct, base)) });
  }
  let amountCents = await killbill.previewChange(acct.accountId, base, killbillPlan(choice.plan, choice.period));
  for (const seat of seats) amountCents += await killbill.previewChange(acct.accountId, seat, killbillSeatPlan(choice.plan, choice.period));
  return json(200, { change: "immediate", amountCents, effectiveAt: isoSecond(new Date()) });
}

export async function changePlan(caller: Caller, body: unknown, key: string): Promise<Reply> {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const now = new Date();
  const sub = await currentSubscription(ws.id);
  assertActive(sub, now);
  const choice = readPlanChoice(isRecord(body) ? body : {});
  assertSeatsFit(await seatsUsed(pool, ws.id, now), PLANS[choice.plan].includedSeats + sub.extra_seats);
  samePlan(sub, choice);
  const timing = changeTiming(sub, choice);
  if (timing === "immediate") await assertStorageReachable();
  const acct = await accountFor(ws);
  const { base, seats } = await currentSubscriptions(acct);
  const record = (client: Db) => audit(client, ws.id, caller, "subscription.plan_changed", { type: "subscription", id: ws.id });
  if (timing === "end_of_term") {
    await killbill.changePlan(base, killbillPlan(choice.plan, choice.period), "END_OF_TERM");
    for (const seat of seats) await killbill.changePlan(seat, killbillSeatPlan(choice.plan, choice.period), "END_OF_TERM");
    const effectiveAt = isoSecond(killbill.endOfTerm(acct, base));
    await transaction(async (client) => {
      await client.query("UPDATE subscriptions SET pending_change = $2 WHERE workspace_id = $1",
        [ws.id, JSON.stringify({ plan: choice.plan, period: choice.period, extraSeats: sub.extra_seats, effectiveAt })]);
      await record(client);
    });
    return json(200, { change: "end_of_term", subscription: await subscriptionNow(pool, ws.id), effectiveAt });
  }
  const known = await knownInvoices(acct);
  await killbill.asOneInvoice(acct.accountId, async () => {
    await killbill.changePlan(base, killbillPlan(choice.plan, choice.period), "IMMEDIATE");
    for (const seat of seats) await killbill.changePlan(seat, killbillSeatPlan(choice.plan, choice.period), "IMMEDIATE");
  });
  const inv = await killbill.newInvoice(acct.accountId, known);
  const apply = async (client: Db) => {
    await client.query("UPDATE subscriptions SET plan = $2, period = $3, pending_change = NULL WHERE workspace_id = $1", [ws.id, choice.plan, choice.period]);
    await record(client);
  };
  if (inv.balanceCents <= 0) {
    await transaction(apply);
    return json(200, { change: "immediate", subscription: await subscriptionNow(pool, ws.id), invoice: invoiceOut(inv, false), payment: null });
  }
  const paid = await settle(ws, acct, inv, `${ws.id}:${key}`, apply);
  return json(200, { change: "immediate", subscription: await subscriptionNow(pool, ws.id), ...paid });
}

export async function changeSeats(caller: Caller, body: unknown, key: string): Promise<Reply> {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const now = new Date();
  const sub = await currentSubscription(ws.id);
  assertActive(sub, now);
  const extraSeats = readExtraSeats(isRecord(body) ? body.extraSeats : undefined);
  assertSeatsFit(await seatsUsed(pool, ws.id, now), PLANS[sub.plan].includedSeats + extraSeats);
  if (extraSeats === sub.extra_seats) throw invalid({ extraSeats: "No change" });
  const seatPlan = killbillSeatPlan(sub.plan, sub.period);
  const record = (client: Db) => audit(client, ws.id, caller, "subscription.seats_changed", { type: "subscription", id: ws.id });
  if (extraSeats > sub.extra_seats) await assertStorageReachable();
  const acct = await accountFor(ws);
  const { base, seats } = await currentSubscriptions(acct);
  if (extraSeats < sub.extra_seats) {
    for (const seat of seats) await killbill.cancel(seat, "END_OF_TERM");
    if (extraSeats > 0) await killbill.addSeats(acct.accountId, base.bundleId, seatPlan, extraSeats, base.chargedThroughDate);
    const effectiveAt = isoSecond(killbill.endOfTerm(acct, base));
    await transaction(async (client) => {
      await client.query("UPDATE subscriptions SET pending_change = $2 WHERE workspace_id = $1",
        [ws.id, JSON.stringify({ plan: sub.plan, period: sub.period, extraSeats, effectiveAt })]);
      await record(client);
    });
    return json(200, { change: "end_of_term", subscription: await subscriptionNow(pool, ws.id), effectiveAt });
  }
  const known = await knownInvoices(acct);
  await killbill.addSeats(acct.accountId, base.bundleId, seatPlan, extraSeats - sub.extra_seats);
  const inv = await killbill.newInvoice(acct.accountId, known);
  const paid = await settle(ws, acct, inv, `${ws.id}:${key}`, async (client) => {
    await client.query("UPDATE subscriptions SET extra_seats = $2, pending_change = NULL WHERE workspace_id = $1", [ws.id, extraSeats]);
    await record(client);
  });
  return json(200, { change: "immediate", subscription: await subscriptionNow(pool, ws.id), ...paid });
}

/** Writes invoice.paid; a past-due or dunning-suspended workspace with nothing left unpaid becomes active again. */
async function recordInvoicePaid(client: Db, ws: WorkspaceRow, invoiceId: string, unpaidElsewhere: boolean, payer: Author): Promise<void> {
  await audit(client, ws.id, payer, "invoice.paid", { type: "invoice", id: invoiceId });
  const sub = await loadSubscription(client, ws.id, true);
  const now = new Date();
  const recovering = effectiveState(sub, now) === "past_due" || suspensionCause(sub, now) === "dunning";
  if (!recovering || unpaidElsewhere) return;
  await client.query(
    `UPDATE subscriptions SET state = 'active', suspended_by = NULL, failed_at = NULL, dunning_day3_at = NULL,
     dunning_day3_sent = false, grace_ends_at = NULL WHERE workspace_id = $1`, [ws.id]);
  await audit(client, ws.id, SCHEDULER, "subscription.reactivated", { type: "subscription", id: ws.id });
}

/** The invoice, when it belongs to the workspace's own Kill Bill account; any other ID is not found. */
export async function ownInvoice(ws: WorkspaceRow, invoiceId: string): Promise<{ acct: killbill.KbAccount; inv: killbill.KbInvoice }> {
  const acct = await killbill.findAccount(ws.id);
  const inv = acct ? await killbill.invoice(invoiceId) : null;
  if (!acct || !inv || inv.accountId !== acct.accountId) throw notFound();
  return { acct, inv };
}

async function unpaidBesides(acct: killbill.KbAccount, invoiceId: string): Promise<boolean> {
  return (await killbill.accountInvoices(acct.accountId)).some((i) => i.invoiceId !== invoiceId && i.balanceCents > 0);
}

export async function payInvoice(caller: Caller, invoiceId: string, body: unknown, key: string): Promise<Reply> {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const { acct, inv } = await ownInvoice(ws, invoiceId);
  if (inv.balanceCents <= 0) throw conflict("invoice_already_paid");
  charge(parseCard(isRecord(body) ? body.card : undefined, new Date()));
  await assertStorageReachable();
  const unpaid = await unpaidBesides(acct, inv.invoiceId);
  const paid = await settle(ws, acct, inv, `${ws.id}:${key}`, (client) => recordInvoicePaid(client, ws, inv.invoiceId, unpaid, caller));
  return json(200, { ...paid, subscription: await subscriptionNow(pool, ws.id) });
}

export async function refund(caller: Caller, paymentId: string, body: unknown, key: string): Promise<Reply> {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  const payment = await one<PaymentRow>(pool, "SELECT * FROM payments WHERE id = $1 AND workspace_id = $2", [paymentId, ws.id]);
  if (!payment) throw notFound();
  const refundable = payment.amount_cents - payment.refunded_cents;
  const requested = isRecord(body) && body.amountCents !== undefined ? body.amountCents : refundable;
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested < 1) throw invalid({ amountCents: "Use a whole number of cents from 1" });
  if (requested > refundable) throw invalid({ amountCents: "More than the refundable balance" });
  await killbill.refund(payment.id, requested, `${ws.id}:${key}`);
  const updated = await transaction(async (client) => {
    const [row] = await rows<PaymentRow>(client, "UPDATE payments SET refunded_cents = refunded_cents + $2 WHERE id = $1 RETURNING *", [payment.id, requested]);
    await audit(client, ws.id, caller, "payment.refunded", { type: "payment", id: payment.id });
    await enqueueMail(client, {
      to: await billingContacts(client, ws.id),
      subject: `Refund for invoice ${payment.invoice_number}: ${dollars(requested)}`,
      body: `We refunded ${dollars(requested)} of your payment for invoice ${payment.invoice_number} of ${ws.name}.\n\nOrrery Studio`,
    });
    return row;
  });
  return json(200, { payment: paymentOut(updated) });
}

export async function cancelSubscription(caller: Caller): Promise<Reply> {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  assertCancelAllowed(await currentSubscription(ws.id));
  const acct = await killbill.findAccount(ws.id);
  if (acct) {
    const base = (await killbill.activeSubscriptions(acct.accountId)).find((s) => s.category === "BASE");
    if (base) await killbill.cancel(base, "IMMEDIATE");
  }
  await transaction(async (client) => {
    await client.query("UPDATE subscriptions SET state = 'cancelled', pending_change = NULL WHERE workspace_id = $1", [ws.id]);
    await audit(client, ws.id, caller, "subscription.cancelled", { type: "subscription", id: ws.id });
  });
  return json(200, { subscription: await subscriptionNow(pool, ws.id) });
}

export async function listInvoices(caller: Caller): Promise<Reply> {
  const acct = await killbill.findAccount(caller.workspaceId);
  if (!acct) return json(200, { invoices: [], payments: [] });
  const documents = new Set((await rows<{ invoice_id: string }>(pool, "SELECT invoice_id FROM invoice_documents WHERE workspace_id = $1", [caller.workspaceId])).map((r) => r.invoice_id));
  const invoices = (await killbill.accountInvoices(acct.accountId))
    .filter((i) => i.amountCents !== 0)
    .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || Number(b.invoiceNumber) - Number(a.invoiceNumber))
    .map((i) => invoiceOut(i, documents.has(i.invoiceId)));
  const payments = (await rows<PaymentRow>(pool, "SELECT * FROM payments WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC", [caller.workspaceId])).map(paymentOut);
  return json(200, { invoices, payments });
}

// --- Gateway webhook -------------------------------------------------------------------------------------------

function verifySignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, Buffer.from(expected));
}

async function recordEvent(client: Db, workspaceId: string, eventId: string, bodyHash: string): Promise<void> {
  await client.query("INSERT INTO webhook_events (workspace_id, event_id, body_hash, created_at) VALUES ($1, $2, $3, now())", [workspaceId, eventId, bodyHash]);
}

/** Signed gateway events, processed once per event ID; an event that ends in an outage is not recorded. */
export async function webhook(raw: Buffer, signature: string | undefined): Promise<Reply> {
  let event: unknown;
  try { event = JSON.parse(raw.toString("utf8")) as unknown; } catch { throw invalidSignature(); }
  if (!isRecord(event) || typeof event.workspaceId !== "string") throw invalidSignature();
  const ws = await one<WorkspaceRow>(pool, "SELECT * FROM workspaces WHERE id = $1", [event.workspaceId]);
  if (!ws || !verifySignature(ws.signing_secret, raw, signature)) throw invalidSignature();
  if (typeof event.id !== "string" || event.id === "") throw invalid({ id: "Required" });
  const eventId = event.id;
  const bodyHash = createHash("sha256").update(raw).digest("hex");
  return serially(ws.id, async () => {
    const seen = await one<{ body_hash: string }>(pool, "SELECT body_hash FROM webhook_events WHERE workspace_id = $1 AND event_id = $2", [ws.id, eventId]);
    if (seen) {
      if (seen.body_hash !== bodyHash) throw conflict("idempotency_key_reused");
      return json(200, { received: true, duplicate: true });
    }
    if (event.type === "payment.succeeded") await paymentSucceeded(ws, eventId, bodyHash, event);
    else if (event.type === "payment.failed") await paymentFailed(ws, eventId, bodyHash, event);
    else throw invalid({ type: "Unknown event type" });
    return json(200, { received: true, duplicate: false });
  });
}

async function paymentSucceeded(ws: WorkspaceRow, eventId: string, bodyHash: string, event: Record<string, unknown>): Promise<void> {
  if (typeof event.invoiceId !== "string") throw invalid({ invoiceId: "Required" });
  const { acct, inv } = await ownInvoice(ws, event.invoiceId);
  if (inv.balanceCents <= 0) {
    await recordEvent(pool, ws.id, eventId, bodyHash);
    return;
  }
  if (event.amountCents !== inv.balanceCents) throw invalid({ amountCents: "Must equal the invoice balance" });
  await assertStorageReachable();
  const unpaid = await unpaidBesides(acct, inv.invoiceId);
  await settle(ws, acct, inv, `${ws.id}:${eventId}`, async (client) => {
    await recordInvoicePaid(client, ws, inv.invoiceId, unpaid, SCHEDULER);
    await recordEvent(client, ws.id, eventId, bodyHash);
  });
}

async function paymentFailed(ws: WorkspaceRow, eventId: string, bodyHash: string, event: Record<string, unknown>): Promise<void> {
  if (typeof event.paymentId !== "string") throw invalid({ paymentId: "Required" });
  const payment = await one<PaymentRow>(pool, "SELECT * FROM payments WHERE id = $1 AND workspace_id = $2", [event.paymentId, ws.id]);
  if (!payment) throw notFound();
  if (payment.charged_back) {
    await recordEvent(pool, ws.id, eventId, bodyHash);
    return;
  }
  await killbill.chargeback(payment.id, payment.amount_cents);
  const day = config.dunningDaySeconds * 1000;
  await transaction(async (client) => {
    await client.query("UPDATE payments SET charged_back = true WHERE id = $1", [payment.id]);
    await recordEvent(client, ws.id, eventId, bodyHash);
    const sub = await loadSubscription(client, ws.id, true);
    const now = new Date();
    if (effectiveState(sub, now) !== "active") return;
    const graceEndsAt = new Date(now.getTime() + 7 * day);
    await client.query(
      `UPDATE subscriptions SET state = 'past_due', failed_at = $2, dunning_day3_at = $3, dunning_day3_sent = false, grace_ends_at = $4
       WHERE workspace_id = $1`, [ws.id, now, new Date(now.getTime() + 3 * day), graceEndsAt]);
    await audit(client, ws.id, SCHEDULER, "subscription.past_due", { type: "subscription", id: ws.id });
    await enqueueMail(client, {
      to: await billingContacts(client, ws.id),
      subject: `Payment failed for ${ws.name}`,
      body: `A payment for invoice ${payment.invoice_number} of ${ws.name} did not go through.\n\nPay invoice ${payment.invoice_number} by ${localTime(isoSecond(graceEndsAt), ws.time_zone)} to keep publishing.\n\nOrrery Studio`,
    });
  });
}
