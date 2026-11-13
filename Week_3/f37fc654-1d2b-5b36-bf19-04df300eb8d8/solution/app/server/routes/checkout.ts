// Checkout: signing the agreement and paying milestones and sponsor shares
// (brief: API › Checkout and payments, Business rules › Payments, Milestones and due dates).
import { createHash, randomUUID } from "node:crypto";
import { INSTALLATIONS, MILESTONE_SCHEDULE } from "../../shared/catalog.js";
import { formatDay, percent, usd } from "../../shared/format.js";
import { queueCrewAlert } from "../alerts.js";
import { requireCaller, type Caller } from "../auth.js";
import {
  activeFunders, clientPart, commissionFor, currentQuote, endLapsedHolds, funderAmounts, invoiceMilestone, latestHold, loadCommission,
  applyMove, storedMilestones, userById, type Commission, type Payer,
} from "../commissions.js";
import { queueCrmEvent } from "../crm.js";
import { isUniqueViolation, notify, one, pool, query, tx, type Db } from "../db.js";
import { fail, invalid, jsonBody, ok, record, UUID, type Reply, type Request, type Router } from "../http.js";
import { enqueue } from "../jobs.js";
import { ensureAccount, getInvoice, paymentByKey, purchase, voidInvoice } from "../providers/killbill.js";
import { ProviderRefused, ServiceDown } from "../providers/reach.js";
import { holdActive, isoInZone, loadInAlertAt, quoteUsable } from "../rules/calendar.js";
import { milestoneParts } from "../rules/money.js";
import { BANNERS } from "../../shared/copy.js";

const QUOTE_EXPIRED = "This quote has expired. Refresh the quote to continue.";

async function sign(req: Request) {
  const caller = await requireCaller(req);
  const body = record(jsonBody(req));
  return tx(async (db) => {
    const now = Date.now();
    const c = await commissionFor(db, caller, req.params.id, ["owner", "producer"], true);
    if (c.clientId !== caller.id) fail(403, "forbidden");
    await endLapsedHolds(db, now, { commissionId: c.id });
    const hold = await latestHold(db, c.id);
    if (c.state !== "held" || !hold || hold.status !== "held") fail(409, c.state === "placed" ? "hold_expired" : "illegal_state");
    const quote = await currentQuote(db, c);
    if (!quote || !quoteUsable(quote.validUntil, now)) fail(409, "quote_expired", { message: QUOTE_EXPIRED });
    const signatureName = typeof body.signatureName === "string" ? body.signatureName.trim() : "";
    const errors: Record<string, string> = {};
    if (signatureName.length < 2 || signatureName.length > 80) errors.signatureName = "Type your full name, 2 to 80 characters.";
    if (body.acceptTerms !== true) errors.acceptTerms = "Tick the box to agree.";
    if (Object.keys(errors).length) invalid(errors);

    const funders = await activeFunders(db, c.id);
    const parts = milestoneParts(clientPart(funders, quote));
    const existing = await storedMilestones(db, c.id, true);
    if (!existing.length) {
      for (const [i, m] of MILESTONE_SCHEDULE.entries()) {
        await db.query(
          "INSERT INTO milestones (id, commission_id, position, label, schedule_bp, subtotal_cents, tax_cents, amount_cents, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')",
          [randomUUID(), c.id, i, m.label, m.bp, parts[i].subtotalCents, parts[i].taxCents, parts[i].amountCents],
        );
      }
    }
    const deposit = existing[0];
    const unchanged = deposit && deposit.killbillInvoiceId && deposit.amountCents === parts[0].amountCents
      && deposit.subtotalCents === parts[0].subtotalCents && deposit.taxCents === parts[0].taxCents;
    if (deposit?.killbillInvoiceId && !unchanged) await voidInvoice(deposit.killbillInvoiceId);
    for (const [i, part] of parts.entries()) {
      if (i === 0 && unchanged) continue;
      await db.query("UPDATE milestones SET subtotal_cents = $3, tax_cents = $4, amount_cents = $5, state = 'scheduled', killbill_invoice_id = NULL WHERE commission_id = $1 AND position = $2",
        [c.id, i, part.subtotalCents, part.taxCents, part.amountCents]);
    }
    const milestones = await storedMilestones(db, c.id, true);
    if (!unchanged) await invoiceMilestone(db, c, milestones[0], now);
    const contract = await queueContract(db, c, funders, quote, milestones.map((m) => ({ label: m.label, amountCents: m.amountCents })), hold.date, signatureName, now);
    return ok({ contractDocumentId: contract.id, contractVersion: contract.version, depositMilestoneId: milestones[0].id }, 201);
  });
}

async function queueContract(
  db: Db, c: Commission, funders: Awaited<ReturnType<typeof activeFunders>>, quote: NonNullable<Awaited<ReturnType<typeof currentQuote>>>,
  schedule: { label: string; amountCents: number }[], heldDate: string, signatureName: string, now: number,
): Promise<{ id: string; version: number }> {
  const last = await one<{ version: number }>("SELECT max(version) AS version FROM documents WHERE commission_id = $1 AND kind = 'contract'", [c.id], db);
  const version = (last?.version ?? 0) + 1;
  const client = await userById(db, c.clientId);
  const amounts = funderAmounts(funders, quote);
  const id = randomUUID();
  await db.query(
    "INSERT INTO documents (id, commission_id, kind, version, label, storage_key, snapshot, status) VALUES ($1, $2, 'contract', $3, $4, $5, $6, 'preparing')",
    [id, c.id, version, `Commission agreement v${version}`, `commissions/${c.id}/documents/contract-v${version}.pdf`, JSON.stringify({
      title: c.title, clientName: client.name, clientEmail: client.email, installation: INSTALLATIONS[c.installationType].label,
      venue: `${c.venue.name}, ${c.venue.address}, ${c.venue.city}`, heldDate: formatDay(heldDate),
      lines: quote.lines.map((l) => ({ label: l.label, amount: usd(l.amountCents) })), total: usd(quote.totalCents),
      schedule: schedule.map((s) => ({ label: s.label, amount: usd(s.amountCents) })),
      funders: funders.map((f, i) => ({ name: f.kind === "client" ? client.name : f.name, share: `${percent(f.bp)}%`, amount: usd(amounts[i].amountCents) })),
      signatureName, signedAt: isoInZone(now, c.venue.timeZone), signedAtText: `${formatDay(isoInZone(now, c.venue.timeZone).slice(0, 10))}, ${isoInZone(now, c.venue.timeZone).slice(11, 19)} (${c.venue.timeZone})`,
    })],
  );
  await enqueue(db, "pdf", c.id, { documentId: id });
  return { id, version };
}

// ---- Payments ------------------------------------------------------------------------------------

interface PayTarget {
  kind: "milestone" | "funder";
  id: string;
  commission: Commission;
  label: string;
  payer: Payer;
  state: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  subtotalCents: number;
  taxCents: number;
  amountCents: number;
}

async function milestoneTarget(db: Db, caller: Caller, id: string, lock = false): Promise<PayTarget> {
  if (!UUID.test(id)) fail(404, "not_found");
  const row = await one<{ id: string; commission_id: string; label: string; state: string; killbill_invoice_id: string | null; killbill_invoice_number: string | null; subtotal_cents: number; tax_cents: number; amount_cents: number }>(
    `SELECT * FROM milestones WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], db,
  );
  if (!row) fail(404, "not_found");
  const c = await commissionFor(db, caller, row.commission_id, ["owner"]);
  return {
    kind: "milestone", id: row.id, commission: c, label: row.label, payer: await userById(db, c.clientId), state: row.state,
    invoiceId: row.killbill_invoice_id, invoiceNumber: row.killbill_invoice_number, subtotalCents: row.subtotal_cents, taxCents: row.tax_cents, amountCents: row.amount_cents,
  };
}

async function funderTarget(db: Db, caller: Caller, id: string, lock = false): Promise<PayTarget> {
  if (!UUID.test(id)) fail(404, "not_found");
  const row = await one<{ id: string; commission_id: string; user_id: string | null; state: string; killbill_invoice_id: string | null; killbill_invoice_number: string | null; subtotal_cents: number | null; tax_cents: number | null; amount_cents: number | null }>(
    `SELECT * FROM funders WHERE id = $1 AND kind = 'sponsor' AND removed_at IS NULL${lock ? " FOR UPDATE" : ""}`, [id], db,
  );
  if (!row || row.user_id !== caller.id) fail(404, "not_found");
  const c = (await loadCommission(db, row.commission_id)) ?? fail(404, "not_found");
  return {
    kind: "funder", id: row.id, commission: c, label: "Sponsor share", payer: await userById(db, caller.id), state: row.state,
    invoiceId: row.killbill_invoice_id, invoiceNumber: row.killbill_invoice_number, subtotalCents: row.subtotal_cents ?? 0, taxCents: row.tax_cents ?? 0, amountCents: row.amount_cents ?? 0,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

interface Attempt {
  id: string;
  fingerprint: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
  created_at: Date;
}

const stored = (a: Attempt): Reply => ({ status: a.response_status ?? 500, body: a.response_body });

async function findAttempt(userId: string, key: string): Promise<Attempt | null> {
  return one<Attempt & Record<string, unknown>>("SELECT * FROM payment_attempts WHERE user_id = $1 AND idempotency_key = $2", [userId, key]);
}

/**
 * Replays a finished attempt or waits (up to 10 s) for one still in flight. An attempt still pending after
 * that wait has an unclear outcome (its request never finished) and is resumed: the retry first asks Kill
 * Bill for a payment with the key, under the target's lock, so a charge is never made twice.
 */
async function replay(userId: string, key: string, fingerprint: string): Promise<Reply | { resume: string } | null> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const attempt = await findAttempt(userId, key);
    if (!attempt) return null;
    if (attempt.fingerprint !== fingerprint) fail(409, "idempotency_conflict");
    if (attempt.status !== "payment_pending") return stored(attempt);
    if (Date.now() > deadline) return { resume: attempt.id };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function finish(db: Db, attemptId: string, status: string, reply: Reply): Promise<Reply> {
  await db.query("UPDATE payment_attempts SET status = $2, response_status = $3, response_body = $4 WHERE id = $1",
    [attemptId, status, reply.status, JSON.stringify(reply.body)]);
  return reply;
}

async function payTarget(req: Request, load: (db: Db, caller: Caller, id: string, lock?: boolean) => Promise<PayTarget>): Promise<Reply> {
  const caller = await requireCaller(req);
  const target = await load(pool, caller, req.params.id);
  const body = record(jsonBody(req));
  const key = String(req.headers["idempotency-key"] ?? "");
  const keyValid = /^[A-Za-z0-9_-]{1,64}$/.test(key);
  const fingerprint = createHash("sha256").update(`POST\n${req.url.pathname}\n${canonical(body)}`).digest("hex");
  const previous = keyValid ? await replay(caller.id, key, fingerprint) : null;
  if (previous && !("resume" in previous)) return previous;
  const now = Date.now();
  const c = target.commission;
  if (c.state === "cancelled") fail(409, "commission_cancelled");
  if (target.state === "paid") fail(409, "already_paid");
  if (!target.invoiceId) fail(409, "illegal_state");
  if (target.kind === "milestone" && target.label === "Deposit") {
    await tx((db) => endLapsedHolds(db, now, { commissionId: c.id }));
    const hold = await latestHold(pool, c.id);
    if (!hold || hold.status !== "held" || !holdActive(hold.expires_at.getTime(), now)) fail(409, "hold_expired");
    const quote = await currentQuote(pool, c);
    if (!quote || !quoteUsable(quote.validUntil, now)) fail(409, "quote_expired", { message: QUOTE_EXPIRED });
  }
  const errors: Record<string, string> = {};
  const nameOnCard = typeof body.nameOnCard === "string" ? body.nameOnCard.trim() : "";
  const cardNumber = typeof body.cardNumber === "string" ? body.cardNumber.replace(/\s+/g, "") : "";
  if (!keyValid) errors.idempotencyKey = "Send an Idempotency-Key of 1 to 64 letters, digits, - or _.";
  if (nameOnCard.length < 1 || nameOnCard.length > 80) errors.nameOnCard = "Enter the name on the card.";
  if (!/^\d{13,19}$/.test(cardNumber) || !luhn(cardNumber)) errors.cardNumber = "Check the card number.";
  if (Object.keys(errors).length) invalid(errors);

  const attemptId = previous?.resume ?? randomUUID();
  if (!previous) {
    try {
      await query(
        "INSERT INTO payment_attempts (id, user_id, idempotency_key, fingerprint, target_kind, target_id, status) VALUES ($1, $2, $3, $4, $5, $6, 'payment_pending')",
        [attemptId, caller.id, key, fingerprint, target.kind, target.id],
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await replay(caller.id, key, fingerprint);
      if (raced && !("resume" in raced)) return raced;
      return fail(409, "idempotency_conflict");
    }
  }

  return tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [target.id]);
    const fresh = await load(db, caller, target.id, true);
    if (fresh.state === "paid") return finish(db, attemptId, "failed", { status: 409, body: { error: { code: "already_paid" } } });
    // The deposit's hold and quote are judged again under the hold's row lock, right before charging.
    const isDeposit = fresh.kind === "milestone" && fresh.label === "Deposit";
    const hold = isDeposit
      ? await one<{ id: string; expires_at: Date }>("SELECT id, expires_at FROM holds WHERE commission_id = $1 AND status = 'held' ORDER BY recorded_at DESC LIMIT 1 FOR UPDATE", [c.id], db)
      : null;
    if (isDeposit && (!hold || !holdActive(hold.expires_at.getTime(), Date.now()))) {
      return finish(db, attemptId, "failed", { status: 409, body: { error: { code: "hold_expired" } } });
    }
    const quote = isDeposit ? await currentQuote(db, c) : null;
    if (isDeposit && (!quote || !quoteUsable(quote.validUntil, Date.now()))) {
      return finish(db, attemptId, "failed", { status: 409, body: { error: { code: "quote_expired", message: QUOTE_EXPIRED } } });
    }
    const table = target.kind === "milestone" ? "milestones" : "funders";
    const pendingState = fresh.state === "failed" ? "retried" : "payment_pending";
    if (target.kind === "milestone") await db.query(`UPDATE ${table} SET state = $2 WHERE id = $1`, [target.id, pendingState]);
    let payment: { paymentId: string; succeeded: boolean };
    try {
      const accountId = await ensureAccount(fresh.payer);
      const externalKey = `${caller.id}:${key}`;
      payment = (await paymentByKey(externalKey))
        ?? (await purchase(accountId, fresh.invoiceId as string, (await getInvoice(fresh.invoiceId as string)).balanceCents, externalKey, key));
    } catch (error) {
      if (!(error instanceof ServiceDown) && !(error instanceof ProviderRefused)) throw error;
      payment = { paymentId: "", succeeded: false };
      if (error instanceof ServiceDown) {
        if (target.kind === "milestone") await db.query(`UPDATE ${table} SET state = 'failed' WHERE id = $1`, [target.id]);
        return finish(db, attemptId, "failed", { status: 503, body: { error: { code: "billing_unavailable", message: BANNERS.killbill } } });
      }
    }
    if (!payment.succeeded) {
      if (target.kind === "milestone") await db.query(`UPDATE ${table} SET state = 'failed' WHERE id = $1`, [target.id]);
      return finish(db, attemptId, "failed", { status: 502, body: { error: { code: "payment_failed", message: "The payment didn't go through. Nothing has been charged." } } });
    }
    const paidAt = new Date();
    await recordPaid(db, fresh, payment.paymentId, paidAt, hold?.id ?? null);
    return finish(db, attemptId, "paid", {
      status: 201,
      body: {
        paymentId: attemptId, amountCents: fresh.amountCents, subtotalCents: fresh.subtotalCents, taxCents: fresh.taxCents, status: "paid",
        killbillInvoiceId: fresh.invoiceId, killbillPaymentId: payment.paymentId, paidAt: paidAt.toISOString(),
      },
    });
  });
}

/** After Kill Bill confirms: paid state, one ledger entry, the emails, the CRM event and the board event, together. */
async function recordPaid(db: Db, t: PayTarget, killbillPaymentId: string, paidAt: Date, depositHoldId: string | null): Promise<void> {
  const c = t.commission;
  const table = t.kind === "milestone" ? "milestones" : "funders";
  await db.query(`UPDATE ${table} SET state = 'paid', killbill_payment_id = $2 WHERE id = $1`, [t.id, killbillPaymentId]);
  await db.query(
    "INSERT INTO ledger_entries (id, commission_id, payer_user_id, payer_name, label, amount_cents, killbill_payment_id, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [randomUUID(), c.id, t.payer.id, t.payer.name, t.label, t.amountCents, killbillPaymentId, paidAt],
  );
  await enqueue(db, "email", c.id, {
    to: [t.payer.email],
    subject: `Receipt — ${c.title} — ${t.label}`,
    text: [
      `Thank you. ${t.label} for ${c.title} at ${c.venue.name} is paid.`, "",
      `Amount paid: ${usd(t.amountCents)}`, `Work: ${usd(t.subtotalCents)}`, `Sales tax: ${usd(t.taxCents)}`,
      `Kill Bill invoice: ${t.invoiceNumber}`, `Payment reference: ${killbillPaymentId}`, "",
    ].join("\n"),
  });
  if (t.kind === "milestone") {
    await enqueue(db, "email", c.id, {
      to: [t.payer.email], toProducers: true, subject: `${t.label} is paid — ${c.title}`,
      text: `${t.label} for ${c.title} (${usd(t.amountCents)}) is paid.\nPayment reference: ${killbillPaymentId}\n`,
    });
    await queueCrmEvent(db, c, "milestone.paid", {
      milestoneId: t.id, label: t.label, subtotalCents: t.subtotalCents, taxCents: t.taxCents, amountCents: t.amountCents,
      killbillInvoiceId: t.invoiceId, killbillPaymentId,
    });
  }
  if (depositHoldId) await confirmDeposit(db, c, depositHoldId, killbillPaymentId);
  await notify(db, "payment.confirmed", { commissionId: c.id, payerName: t.payer.name, amountCents: t.amountCents, label: t.label });
}

/** The deposit is confirmed: contracted, the hold becomes the booked install day, crew alerts, contract.signed. */
async function confirmDeposit(db: Db, c: Commission, holdId: string, killbillPaymentId: string): Promise<void> {
  const hold = (await one<{ id: string; date: string }>("UPDATE holds SET status = 'booked' WHERE id = $1 AND status = 'held' RETURNING id, date", [holdId], db))
    ?? fail(409, "hold_expired");
  const dayId = randomUUID();
  await db.query(
    "INSERT INTO install_days (id, commission_id, hold_id, venue_id, date, load_in_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [dayId, c.id, hold.id, c.venue.id, hold.date, new Date(loadInAlertAt(hold.date, c.venue.timeZone))],
  );
  await applyMove(db, c, "contracted", "system");
  await queueCrewAlert(db, c, dayId, hold.date, "slot_confirmed");
  const contract = await one<{ id: string; snapshot: { signatureName: string; signedAt: string } }>(
    "SELECT id, snapshot FROM documents WHERE commission_id = $1 AND kind = 'contract' ORDER BY version DESC LIMIT 1", [c.id], db,
  );
  await queueCrmEvent(db, c, "contract.signed", {
    signedAt: contract?.snapshot.signedAt ?? null, signatureName: contract?.snapshot.signatureName ?? null,
    contractDocumentId: contract?.id ?? null, contractSha256: null, depositKillbillPaymentId: killbillPaymentId,
  });
  await notify(db, "hold.updated", { commissionId: c.id, status: "booked" });
}

export function registerCheckout(router: Router): void {
  router.add("POST", "/api/commissions/:id/sign", sign);
  router.add("POST", "/api/milestones/:id/payments", (req) => payTarget(req, milestoneTarget));
  router.add("POST", "/api/funders/:id/payments", (req) => payTarget(req, funderTarget));
}

