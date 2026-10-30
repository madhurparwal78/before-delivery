import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { query } from "../db";
import { errors, requireAuth, seatsUsed, formatMoney, HttpError } from "../http";
import { audit, auditSystem } from "../audit";
import { storage, killbill, mailer } from "../services";
import {
  callerWsShared, parseCard, cardIsCurrent, cardIsDeclined, PLAN_CATALOG, planKey, isUpgrade,
} from "./billing-shared";

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const billingRouter = Router();
billingRouter.use(requireAuth);

interface SubRow {
  state: string;
  plan: string;
  period: string;
  seats_purchased: number;
  extra_seats: number;
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
  dunning_failed_at: Date | null;
  kb_account_id: string | null;
  kb_base_sub_id: string | null;
  kb_seat_sub_ids: string[];
  pending_change: { plan: string; period: string; extraSeats: number; effectiveAt: string } | null;
  card_last4: string | null;
}

export async function subRow(workspaceId: string): Promise<SubRow> {
  const res = await query("SELECT * FROM subscriptions WHERE workspace_id = $1", [workspaceId]);
  return res.rows[0] as unknown as SubRow;
}

export function subscriptionJson(s: SubRow): Record<string, unknown> {
  return {
    state: s.state,
    plan: s.plan,
    period: s.period,
    seatsPurchased: s.seats_purchased,
    extraSeats: s.extra_seats,
    trialEndsAt: s.trial_ends_at ? iso(s.trial_ends_at) : null,
    graceEndsAt: s.grace_ends_at ? iso(s.grace_ends_at) : null,
    pendingChange: s.pending_change,
  };
}

function canBill(role: string): boolean {
  return role === "owner" || role === "billing_manager";
}

/** Provider failures map to the outage answers. */
function isProviderError(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("KillBill");
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

function idemKey(req: Request): string {
  const key = req.headers["idempotency-key"];
  if (typeof key === "string" && key.length >= 1 && key.length <= 200 && /^[\x20-\x7e]+$/.test(key)) return key;
  throw errors.validation({ "Idempotency-Key": "Required" });
}

async function withIdempotency(
  req: Request,
  res: Response,
  run: (key: string) => Promise<{ status: number; body: Record<string, unknown> }>,
): Promise<void> {
  const { ws } = await callerWsShared(req);
  const key = idemKey(req);
  const bodyHash = createHash("sha256").update(JSON.stringify(req.body ?? {})).digest("hex");
  const existing = await query("SELECT * FROM idempotency WHERE workspace_id = $1 AND key = $2", [ws, key]);
  const row = existing.rows[0] as { body_hash: string; status: number; body: Record<string, unknown>; in_progress: boolean } | undefined;
  if (row) {
    if (row.in_progress) throw errors.conflict("request_in_progress");
    if (row.body_hash !== bodyHash) throw errors.conflict("idempotency_key_reused");
    res.setHeader("Idempotent-Replayed", "true");
    res.status(row.status).json(row.body);
    return;
  }
  await query(
    "INSERT INTO idempotency (workspace_id, key, method, path, body_hash, status, body, in_progress) VALUES ($1,$2,$3,$4,$5,200,'{}',TRUE)",
    [ws, key, req.method, req.path, bodyHash],
  );
  let outcome: { status: number; body: Record<string, unknown> };
  try {
    outcome = await run(key);
  } catch (e) {
    // A 503 is not stored, so a retry after recovery runs afresh; other errors are kept for replay.
    if (e instanceof HttpError && e.status === 503) {
      await query("DELETE FROM idempotency WHERE workspace_id = $1 AND key = $2", [ws, key]);
    } else if (e instanceof HttpError) {
      await query(
        "UPDATE idempotency SET status = $3, body = $4, in_progress = FALSE WHERE workspace_id = $1 AND key = $2",
        [ws, key, e.status, JSON.stringify(e.body)],
      );
    } else {
      await query("DELETE FROM idempotency WHERE workspace_id = $1 AND key = $2", [ws, key]);
    }
    throw e;
  }
  await query(
    "UPDATE idempotency SET status = $3, body = $4, in_progress = FALSE WHERE workspace_id = $1 AND key = $2",
    [ws, key, outcome.status, JSON.stringify(outcome.body)],
  );
  res.status(outcome.status).json(outcome.body);
}

// ---------------------------------------------------------------------------
// Invoice helpers
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id: string;
  workspace_id: string;
  number: string;
  date: Date;
  amount_cents: number;
  balance_cents: number;
  status: string;
  pdf_stored: boolean;
}

export function invoiceJson(row: InvoiceRow): Record<string, unknown> {
  return {
    id: row.id,
    number: row.number,
    date: iso(row.date),
    amountCents: row.amount_cents,
    balanceCents: row.balance_cents,
    status: row.status,
    pdfAvailable: row.pdf_stored,
  };
}

function paymentJson(row: { id: string; invoice_id: string; amount_cents: number; refunded_cents: number; created_at: Date }): Record<string, unknown> {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    amountCents: row.amount_cents,
    refundedCents: row.refunded_cents,
    createdAt: iso(row.created_at),
  };
}

/**
 * Kill Bill generates subscription invoices asynchronously, so a checkout or an
 * immediate change polls briefly for the new invoice before paying it.
 */
async function awaitNewInvoices(
  workspaceId: string,
  accountId: string,
  knownBefore: Set<string>,
): Promise<{ id: string; number: string; balanceCents: number; amountCents: number }[]> {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const kbInvoices = await killbill().listInvoices(accountId);
    const fresh = kbInvoices.filter((inv) => !knownBefore.has(inv.invoiceId));
    if (fresh.length > 0) {
      return recordInvoices(workspaceId, accountId).then((recorded) => recorded.filter((r) => !knownBefore.has(r.id)));
    }
    if (Date.now() >= deadline) return [];
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function knownInvoiceIds(accountId: string): Promise<Set<string>> {
  const invoices = await killbill().listInvoices(accountId);
  return new Set(invoices.map((i) => i.invoiceId));
}

/** Records in the app's ledger every Kill Bill invoice not yet known here, and returns them. */
async function recordInvoices(workspaceId: string, accountId: string): Promise<{ id: string; number: string; balanceCents: number; amountCents: number }[]> {
  const kbInvoices = await killbill().listInvoices(accountId);
  const known = new Set((await query("SELECT id FROM invoices WHERE workspace_id = $1", [workspaceId])).rows.map((r) => (r as { id: string }).id));
  const recorded: { id: string; number: string; balanceCents: number; amountCents: number }[] = [];
  for (const inv of kbInvoices) {
    if (known.has(inv.invoiceId)) continue;
    const detail = await killbill().getInvoice(inv.invoiceId);
    known.add(inv.invoiceId);
    const cents = Math.round(detail.amount * 100);
    if (cents === 0) continue;
    await query(
      "INSERT INTO invoices (id, workspace_id, number, date, amount_cents, balance_cents, status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [inv.invoiceId, workspaceId, String(inv.invoiceNumber), new Date(), cents, Math.round(detail.balance * 100), detail.balance <= 0.001 ? "paid" : "unpaid"],
    );
    recorded.push({ id: inv.invoiceId, number: String(inv.invoiceNumber), balanceCents: Math.round(detail.balance * 100), amountCents: cents });
  }
  return recorded;
}

async function refreshBalances(workspaceId: string): Promise<void> {
  const rows = await query("SELECT id FROM invoices WHERE workspace_id = $1", [workspaceId]);
  for (const r of rows.rows as { id: string }[]) {
    const detail = await killbill().getInvoice(r.id);
    const balance = Math.round(detail.balance * 100);
    await query("UPDATE invoices SET balance_cents = $2, status = $3 WHERE id = $1", [r.id, balance, balance <= 0 ? "paid" : "unpaid"]);
  }
}

export function makeInvoicePdf(opts: { workspaceName: string; invoiceNumber: string; date: string; items: { description: string; amountCents: number }[]; totalCents: number; paidCents: number }): Buffer {
  const lines: string[] = [];
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  lines.push("BT /F1 16 Tf 50 780 Td (Invoice " + esc(opts.invoiceNumber) + ") Tj ET");
  lines.push("BT /F1 10 Tf 50 762 Td (" + esc(opts.workspaceName) + ") Tj ET");
  lines.push("BT /F1 10 Tf 50 750 Td (Date: " + esc(opts.date) + ") Tj ET");
  let y = 720;
  for (const item of opts.items) {
    lines.push("BT /F1 10 Tf 50 " + y + " Td (" + esc(item.description) + ") Tj ET");
    lines.push("BT /F1 10 Tf 450 " + y + " Td (" + esc(formatMoney(item.amountCents)) + ") Tj ET");
    y -= 16;
  }
  y -= 8;
  lines.push("BT /F1 10 Tf 50 " + y + " Td (Total: " + esc(formatMoney(opts.totalCents)) + ") Tj ET");
  y -= 16;
  lines.push("BT /F1 10 Tf 50 " + y + " Td (Amount paid: " + esc(formatMoney(opts.paidCents)) + ") Tj ET");
  const content = lines.join("\n");
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  objects.push("<< /Length " + Buffer.byteLength(content) + " >>\nstream\n" + content + "\nendstream");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += off.toString().padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

export async function billingContacts(workspaceId: string): Promise<string[]> {
  const res = await query(
    "SELECT email FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND role IN ('owner','billing_manager')",
    [workspaceId],
  );
  return (res.rows as { email: string }[]).map((r) => r.email);
}

export async function workspaceTimeZone(workspaceId: string): Promise<string> {
  const res = await query("SELECT time_zone FROM workspaces WHERE id = $1", [workspaceId]);
  return (res.rows[0] as { time_zone: string }).time_zone;
}

export async function workspaceName(workspaceId: string): Promise<string> {
  const res = await query("SELECT name FROM workspaces WHERE id = $1", [workspaceId]);
  return (res.rows[0] as { name: string }).name;
}

// ---------------------------------------------------------------------------
// All-or-nothing invoice payment
// ---------------------------------------------------------------------------

export async function payInvoiceAllOrNothing(opts: {
  workspaceId: string;
  accountId: string;
  invoiceId: string;
  amountCents: number;
  transactionExternalKey: string;
}): Promise<string> {
  // Both providers must be reachable before anything is charged.
  if (!(await storage().check())) throw errors.serviceUnavailable("file_storage");
  await killbill().payInvoice(opts.accountId, opts.invoiceId, opts.amountCents / 100, opts.transactionExternalKey);
  const payment = await killbill().findPaymentByExternalKey(opts.accountId, `${opts.transactionExternalKey}-payment`);
  if (!payment) throw errors.serviceUnavailable("billing");
  const kbInvoice = await killbill().getInvoice(opts.invoiceId);
  const invoiceRow = (await query("SELECT * FROM invoices WHERE workspace_id = $1 AND id = $2", [opts.workspaceId, opts.invoiceId])).rows[0] as InvoiceRow | undefined;
  const workspace = await workspaceName(opts.workspaceId);
  const pdf = makeInvoicePdf({
    workspaceName: workspace,
    invoiceNumber: invoiceRow?.number ?? String(kbInvoice.invoiceNumber),
    date: kbInvoice.invoiceDate,
    items: (kbInvoice.items ?? []).map((i) => ({ description: i.prettyPlanName ?? i.description ?? i.planName ?? "Item", amountCents: Math.round(i.amount * 100) })),
    totalCents: Math.round(kbInvoice.amount * 100),
    paidCents: Math.round((kbInvoice.amount - kbInvoice.balance) * 100),
  });
  await storage().put(storage().invoiceKey(opts.workspaceId, opts.invoiceId), pdf, "application/pdf");
  await query(
    "UPDATE invoices SET balance_cents = $2, status = 'paid', pdf_stored = TRUE WHERE workspace_id = $1 AND id = $3",
    [opts.workspaceId, Math.round(kbInvoice.balance * 100), opts.invoiceId],
  );
  await query(
    "INSERT INTO payments (id, workspace_id, invoice_id, amount_cents, refunded_cents) VALUES ($1,$2,$3,$4,0) ON CONFLICT DO NOTHING",
    [payment.paymentId, opts.workspaceId, opts.invoiceId, opts.amountCents],
  );
  const number = invoiceRow?.number ?? String(kbInvoice.invoiceNumber);
  const contacts = await billingContacts(opts.workspaceId);
  if (contacts.length > 0) {
    mailer().send({
      to: contacts,
      subject: `Receipt for invoice ${number}: ${formatMoney(opts.amountCents)}`,
      text: `Payment of ${formatMoney(opts.amountCents)} recorded for invoice ${number}.\n\nWorkspace: ${workspace}\nInvoice total: ${formatMoney(Math.round(kbInvoice.amount * 100))}\n`,
    });
  }
  return payment.paymentId;
}

async function ensureAccount(workspaceId: string): Promise<string> {
  const s = await subRow(workspaceId);
  if (s.kb_account_id) return s.kb_account_id;
  const accountId = await killbill().createAccount(workspaceId, await workspaceName(workspaceId));
  await query("UPDATE subscriptions SET kb_account_id = $1 WHERE workspace_id = $2", [accountId, workspaceId]);
  return accountId;
}

async function seatsInUseCheck(workspaceId: string, seatsAfter: number): Promise<void> {
  const used = await seatsUsed(workspaceId);
  if (used > seatsAfter) {
    throw errors.conflict("seats_in_use", { seatsUsed: used, seatsAfter });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

billingRouter.get("/", async (req, res, next) => {
  try {
    const { ws, role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    const s = await subRow(ws);
    res.json({ subscription: subscriptionJson(s), card: s.card_last4 ? { last4: s.card_last4 } : null });
  } catch (e) {
    next(e);
  }
});

billingRouter.get("/gateway", async (req, res, next) => {
  try {
    const { ws, role } = await callerWsShared(req);
    if (role !== "owner") throw errors.forbidden();
    const res2 = await query("SELECT gateway_secret FROM workspaces WHERE id = $1", [ws]);
    res.json({ signingSecret: (res2.rows[0] as { gateway_secret: string }).gateway_secret });
  } catch (e) {
    next(e);
  }
});

billingRouter.get("/plan/preview", async (req, res, next) => {
  try {
    const { ws, role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    const plan = String(req.query.plan ?? "");
    const period = String(req.query.period ?? "");
    const catalog = PLAN_CATALOG[planKey(plan, period)];
    if (!catalog) throw errors.validation({ plan: "Unknown plan" });
    const s = await subRow(ws);
    if (s.state !== "active") {
      res.json({ change: "immediate", amountCents: catalog.priceCents, effectiveAt: iso(new Date()) });
      return;
    }
    const accountId = await ensureAccount(ws);
    const baseSub = await killbill().getSubscription(`sub-base-${ws}`);
    if (!baseSub) throw errors.serviceUnavailable("billing");
    if (isUpgrade(s.plan, s.period, plan, period)) {
      const preview = await killbill().dryRunChange(accountId, baseSub.subscriptionId, baseSub.bundleId, catalog.kbPlan, "IMMEDIATE");
      res.json({ change: "immediate", amountCents: preview ? Math.round(preview.amount * 100) : 0, effectiveAt: iso(new Date()) });
    } else {
      res.json({ change: "end_of_term", amountCents: 0, effectiveAt: baseSub.chargedThroughDate ?? iso(new Date()) });
    }
  } catch (e) {
    if (isProviderError(e)) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});

billingRouter.post("/checkout", async (req, res, next) => {
  try {
    const { role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    await withIdempotency(req, res, async (key) => {
      const { ws } = await callerWsShared(req);
      const s = await subRow(ws);
      if (s.state !== "trial" && !(s.state === "suspended" && s.dunning_failed_at === null)) {
        throw errors.conflict("invalid_transition", { from: s.state, to: "active" });
      }
      const body = req.body ?? {};
      const plan = body.plan;
      const period = body.period;
      const extraSeats = body.extraSeats;
      const catalog = PLAN_CATALOG[planKey(plan, period)];
      if (!catalog) throw errors.validation({ plan: "Unknown plan" });
      if (typeof extraSeats !== "number" || !Number.isInteger(extraSeats) || extraSeats < 0 || extraSeats > 500) {
        throw errors.validation({ extraSeats: "Extra seats must be 0-500" });
      }
      const seatsPurchased = catalog.includedSeats + extraSeats;
      await seatsInUseCheck(ws, seatsPurchased);
      const cardResult = parseCard(body.card);
      if (Object.keys(cardResult.errors).length > 0) throw errors.validation(cardResult.errors);
      const card = cardResult.card!;
      if (!cardIsCurrent(card, new Date())) throw errors.validation({ "card.expiry": "Card is expired" });
      if (cardIsDeclined(card)) throw errors.cardDeclined();

      const accountId = await ensureAccount(ws);
      const knownBefore = await knownInvoiceIds(accountId);
      const baseSub = await killbill().createSubscription(accountId, catalog.kbPlan, `sub-base-${ws}`);
      const seatSubIds: string[] = [];
      for (let i = 0; i < extraSeats; i++) {
        const seatSub = await killbill().createSubscription(accountId, catalog.kbSeatPlan, `sub-seat-${ws}-${i}`, baseSub.bundleId);
        seatSubIds.push(seatSub.subscriptionId);
      }
      const recorded = await awaitNewInvoices(ws, accountId, knownBefore);
      const due = recorded.filter((i) => i.balanceCents > 0);
      let invoiceRow: InvoiceRow | null = null;
      for (const inv of due) {
        await payInvoiceAllOrNothing({
          workspaceId: ws, accountId, invoiceId: inv.id,
          amountCents: inv.balanceCents, transactionExternalKey: `${ws}:${key}`,
        });
        if (!invoiceRow) {
          invoiceRow = (await query("SELECT * FROM invoices WHERE workspace_id = $1 AND id = $2", [ws, inv.id])).rows[0] as unknown as InvoiceRow;
        }
      }
      await query(
        `UPDATE subscriptions SET state = 'active', plan = $2, period = $3, seats_purchased = $4, extra_seats = $5,
         trial_ends_at = NULL, grace_ends_at = NULL, dunning_failed_at = NULL, kb_base_sub_id = $6, kb_seat_sub_ids = $7,
         card_last4 = $8, pending_change = NULL, cancelled_at = NULL WHERE workspace_id = $1`,
        [ws, plan, period, seatsPurchased, extraSeats, baseSub.subscriptionId, JSON.stringify(seatSubIds), card.number.slice(-4)],
      );
      audit(req.caller!, "subscription.started", { type: "workspace", id: ws });
      const freshSub = await subRow(ws);
      const paymentRow = invoiceRow
        ? (await query("SELECT * FROM payments WHERE workspace_id = $1 AND invoice_id = $2", [ws, invoiceRow.id])).rows[0]
        : null;
      return {
        status: 201,
        body: {
          subscription: subscriptionJson(freshSub),
          ...(invoiceRow ? { invoice: invoiceJson(invoiceRow) } : {}),
          ...(paymentRow ? { payment: paymentJson(paymentRow as never) } : {}),
        },
      };
    });
  } catch (e) {
    if (isProviderError(e)) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});

billingRouter.post("/plan", async (req, res, next) => {
  try {
    const { role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    await withIdempotency(req, res, async (key) => {
      const { ws } = await callerWsShared(req);
      const s = await subRow(ws);
      if (s.state !== "active") throw errors.conflict("subscription_not_active");
      const body = req.body ?? {};
      const plan = body.plan;
      const period = body.period;
      const catalog = PLAN_CATALOG[planKey(plan, period)];
      if (!catalog) throw errors.validation({ plan: "Unknown plan" });
      if (plan === s.plan && period === s.period) throw errors.validation({ plan: "Already on this plan" });
      const seatsPurchased = catalog.includedSeats + s.extra_seats;
      await seatsInUseCheck(ws, seatsPurchased);
      const upgrade = isUpgrade(s.plan, s.period, plan, period);
      const accountId = await ensureAccount(ws);
      const baseSub = await killbill().getSubscription(`sub-base-${ws}`);
      if (!baseSub) throw errors.serviceUnavailable("billing");
      const billingPeriod = period === "monthly" ? "MONTHLY" : "ANNUAL";
      const seatSubs = s.kb_seat_sub_ids ?? [];
      const knownBeforePlan = await knownInvoiceIds(accountId);
      if (upgrade) {
        await killbill().changePlan(baseSub.subscriptionId, catalog.kbPlan, catalog.name, billingPeriod, "IMMEDIATE");
        for (const seatId of seatSubs) {
          await killbill().changePlan(seatId, catalog.kbSeatPlan, "Seat", billingPeriod, "IMMEDIATE");
        }
        await query(
          "UPDATE subscriptions SET plan = $2, period = $3, seats_purchased = $4, pending_change = NULL WHERE workspace_id = $1",
          [ws, plan, period, seatsPurchased],
        );
        const recorded = await awaitNewInvoices(ws, accountId, knownBeforePlan);
        const toPay = recorded.filter((i) => i.balanceCents > 0);
        let invoiceRow: InvoiceRow | null = null;
        for (const inv of toPay) {
          await payInvoiceAllOrNothing({ workspaceId: ws, accountId, invoiceId: inv.id, amountCents: inv.balanceCents, transactionExternalKey: `${ws}:${key}` });
          invoiceRow = (await query("SELECT * FROM invoices WHERE workspace_id = $1 AND id = $2", [ws, inv.id])).rows[0] as unknown as InvoiceRow;
        }
        audit(req.caller!, "subscription.plan_changed", { type: "workspace", id: ws });
        const fresh = await subRow(ws);
        const paid = invoiceRow ? (await query("SELECT * FROM payments WHERE workspace_id = $1 AND invoice_id = $2", [ws, invoiceRow.id])).rows[0] : null;
        return {
          status: 200,
          body: {
            change: "immediate",
            subscription: subscriptionJson(fresh),
            ...(invoiceRow ? { invoice: invoiceJson(invoiceRow) } : {}),
            ...(paid ? { payment: paymentJson(paid as never) } : {}),
          },
        };
      }
      await killbill().changePlan(baseSub.subscriptionId, catalog.kbPlan, catalog.name, billingPeriod, "END_OF_TERM");
      for (const seatId of seatSubs) {
        await killbill().changePlan(seatId, catalog.kbSeatPlan, "Seat", billingPeriod, "END_OF_TERM");
      }
      const effectiveAt = baseSub.chargedThroughDate ?? iso(new Date());
      await query(
        "UPDATE subscriptions SET pending_change = $2 WHERE workspace_id = $1",
        [ws, JSON.stringify({ plan, period, extraSeats: s.extra_seats, effectiveAt })],
      );
      audit(req.caller!, "subscription.plan_changed", { type: "workspace", id: ws });
      const fresh = await subRow(ws);
      return { status: 200, body: { change: "end_of_term", subscription: subscriptionJson(fresh), effectiveAt } };
    });
  } catch (e) {
    if (isProviderError(e)) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});

billingRouter.post("/seats", async (req, res, next) => {
  try {
    const { role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    await withIdempotency(req, res, async (key) => {
      const { ws } = await callerWsShared(req);
      const s = await subRow(ws);
      if (s.state !== "active") throw errors.conflict("subscription_not_active");
      const body = req.body ?? {};
      const extraSeats = body.extraSeats;
      if (typeof extraSeats !== "number" || !Number.isInteger(extraSeats) || extraSeats < 0 || extraSeats > 500) {
        throw errors.validation({ extraSeats: "Extra seats must be 0-500" });
      }
      if (extraSeats === s.extra_seats) throw errors.validation({ extraSeats: "No change" });
      const catalog = PLAN_CATALOG[planKey(s.plan, s.period)]!;
      const seatsPurchased = catalog.includedSeats + extraSeats;
      await seatsInUseCheck(ws, seatsPurchased);
      const accountId = await ensureAccount(ws);
      const baseSub = await killbill().getSubscription(`sub-base-${ws}`);
      if (!baseSub) throw errors.serviceUnavailable("billing");
      const seatSubs = s.kb_seat_sub_ids ?? [];
      if (extraSeats > s.extra_seats) {
        const knownBeforeSeats = await knownInvoiceIds(accountId);
        const add = extraSeats - s.extra_seats;
        const newSeatSubs: string[] = [];
        for (let i = 0; i < add; i++) {
          const sub = await killbill().createSubscription(accountId, catalog.kbSeatPlan, `sub-seat-${ws}-${seatSubs.length + i}`, baseSub.bundleId);
          newSeatSubs.push(sub.subscriptionId);
        }
        const allSubs = [...seatSubs, ...newSeatSubs];
        await query(
          "UPDATE subscriptions SET extra_seats = $2, seats_purchased = $3, kb_seat_sub_ids = $4 WHERE workspace_id = $1",
          [ws, extraSeats, seatsPurchased, JSON.stringify(allSubs)],
        );
        const recorded = await awaitNewInvoices(ws, accountId, knownBeforeSeats);
        const toPay = recorded.filter((i) => i.balanceCents > 0);
        let invoiceRow: InvoiceRow | null = null;
        for (const inv of toPay) {
          await payInvoiceAllOrNothing({ workspaceId: ws, accountId, invoiceId: inv.id, amountCents: inv.balanceCents, transactionExternalKey: `${ws}:${key}` });
          invoiceRow = (await query("SELECT * FROM invoices WHERE workspace_id = $1 AND id = $2", [ws, inv.id])).rows[0] as unknown as InvoiceRow;
        }
        audit(req.caller!, "subscription.seats_changed", { type: "workspace", id: ws });
        const fresh = await subRow(ws);
        const paid = invoiceRow ? (await query("SELECT * FROM payments WHERE workspace_id = $1 AND invoice_id = $2", [ws, invoiceRow.id])).rows[0] : null;
        return {
          status: 200,
          body: {
            change: "immediate",
            subscription: subscriptionJson(fresh),
            ...(invoiceRow ? { invoice: invoiceJson(invoiceRow) } : {}),
            ...(paid ? { payment: paymentJson(paid as never) } : {}),
          },
        };
      }
      const removeCount = s.extra_seats - extraSeats;
      for (let i = 0; i < removeCount; i++) {
        const subId = seatSubs[seatSubs.length - 1 - i];
        if (subId) await killbill().cancelSubscription(subId, "END_OF_TERM");
      }
      const kept = seatSubs.slice(0, extraSeats);
      const effectiveAt = baseSub.chargedThroughDate ?? iso(new Date());
      await query(
        "UPDATE subscriptions SET pending_change = $2, kb_seat_sub_ids = $3 WHERE workspace_id = $1",
        [ws, JSON.stringify({ plan: s.plan, period: s.period, extraSeats, effectiveAt }), JSON.stringify(kept)],
      );
      audit(req.caller!, "subscription.seats_changed", { type: "workspace", id: ws });
      const fresh = await subRow(ws);
      return { status: 200, body: { change: "end_of_term", subscription: subscriptionJson(fresh), effectiveAt } };
    });
  } catch (e) {
    if (isProviderError(e)) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});

billingRouter.get("/invoices", async (req, res, next) => {
  try {
    const { ws, role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    const s = await subRow(ws);
    if (s.kb_account_id) {
      await recordInvoices(ws, s.kb_account_id);
      await refreshBalances(ws);
    }
    const invoiceRows = (await query("SELECT * FROM invoices WHERE workspace_id = $1 ORDER BY date DESC", [ws])).rows as unknown as InvoiceRow[];
    const paymentRows = (await query("SELECT * FROM payments WHERE workspace_id = $1 ORDER BY created_at DESC", [ws])).rows as unknown as { id: string; invoice_id: string; amount_cents: number; refunded_cents: number; created_at: Date }[];
    res.json({ invoices: invoiceRows.map(invoiceJson), payments: paymentRows.map(paymentJson) });
  } catch (e) {
    if (isProviderError(e)) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});

billingRouter.get("/invoices/:invoiceId/pdf", async (req, res, next) => {
  try {
    const { ws, role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    const row = (await query("SELECT * FROM invoices WHERE workspace_id = $1 AND id = $2", [ws, req.params.invoiceId])).rows[0] as InvoiceRow | undefined;
    if (!row) throw errors.notFound();
    const pdf = await storage().get(storage().invoiceKey(ws, req.params.invoiceId));
    if (!pdf) throw errors.notFound();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${row.number}.pdf"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

billingRouter.post("/invoices/:invoiceId/pay", async (req, res, next) => {
  try {
    const { role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    await withIdempotency(req, res, async (key) => {
      const { ws } = await callerWsShared(req);
      const s = await subRow(ws);
      const row = (await query("SELECT * FROM invoices WHERE workspace_id = $1 AND id = $2", [ws, req.params.invoiceId])).rows[0] as InvoiceRow | undefined;
      if (!row) throw errors.notFound();
      if (row.status === "paid") throw errors.conflict("invoice_already_paid");
      const cardResult = parseCard(req.body?.card);
      if (Object.keys(cardResult.errors).length > 0) throw errors.validation(cardResult.errors);
      const card = cardResult.card!;
      if (!cardIsCurrent(card, new Date())) throw errors.validation({ "card.expiry": "Card is expired" });
      if (cardIsDeclined(card)) throw errors.cardDeclined();
      if (!s.kb_account_id) throw errors.serviceUnavailable("billing");
      const kbInvoice = await killbill().getInvoice(row.id);
      const amountCents = Math.round(kbInvoice.balance * 100);
      if (amountCents <= 0) throw errors.conflict("invoice_already_paid");
      await payInvoiceAllOrNothing({ workspaceId: ws, accountId: s.kb_account_id, invoiceId: row.id, amountCents, transactionExternalKey: `${ws}:${key}` });
      await query("UPDATE subscriptions SET card_last4 = $2 WHERE workspace_id = $1", [ws, card.number.slice(-4)]);
      audit(req.caller!, "invoice.paid", { type: "invoice", id: row.id });
      // Reactivation when this payment cleared the last unpaid invoice
      const fresh = await subRow(ws);
      if (fresh.state === "past_due" || (fresh.state === "suspended" && fresh.dunning_failed_at !== null)) {
        const unpaid = await query("SELECT count(*) AS c FROM invoices WHERE workspace_id = $1 AND status = 'unpaid'", [ws]);
        if (Number((unpaid.rows[0] as { c: string }).c) === 0) {
          await query("UPDATE subscriptions SET state = 'active', grace_ends_at = NULL, dunning_failed_at = NULL WHERE workspace_id = $1", [ws]);
          auditSystem(ws, "subscription.reactivated", { type: "workspace", id: ws });
        }
      }
      const invoiceRow = (await query("SELECT * FROM invoices WHERE workspace_id = $1 AND id = $2", [ws, row.id])).rows[0] as unknown as InvoiceRow;
      const paymentRow = (await query("SELECT * FROM payments WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY created_at DESC", [ws, row.id])).rows[0] as unknown as { id: string; invoice_id: string; amount_cents: number; refunded_cents: number; created_at: Date };
      return { status: 200, body: { invoice: invoiceJson(invoiceRow), payment: paymentJson(paymentRow), subscription: subscriptionJson(await subRow(ws)) } };
    });
  } catch (e) {
    if (isProviderError(e)) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});

billingRouter.post("/payments/:paymentId/refund", async (req, res, next) => {
  try {
    const { role } = await callerWsShared(req);
    if (!canBill(role)) throw errors.forbidden();
    await withIdempotency(req, res, async (key) => {
      const { ws } = await callerWsShared(req);
      const paymentRow = (await query("SELECT * FROM payments WHERE workspace_id = $1 AND id = $2", [ws, req.params.paymentId])).rows[0] as { id: string; invoice_id: string; amount_cents: number; refunded_cents: number } | undefined;
      if (!paymentRow) throw errors.notFound();
      const s = await subRow(ws);
      if (!s.kb_account_id) throw errors.serviceUnavailable("billing");
      const refundable = paymentRow.amount_cents - paymentRow.refunded_cents;
      let amountCents = refundable;
      if (req.body?.amountCents !== undefined && req.body.amountCents !== null) {
        if (typeof req.body.amountCents !== "number" || !Number.isInteger(req.body.amountCents) || req.body.amountCents < 0) {
          throw errors.validation({ amountCents: "Invalid amount" });
        }
        if (req.body.amountCents > refundable) {
          throw errors.validation({ amountCents: "More than the refundable balance" });
        }
        amountCents = req.body.amountCents;
      }
      const payments = await killbill().listInvoicePayments(s.kb_account_id);
      if (!payments.some((p) => p.paymentId === paymentRow.id)) throw errors.notFound();
      await killbill().refundPayment(paymentRow.id, amountCents / 100, `${ws}:${key}`);
      await query("UPDATE payments SET refunded_cents = refunded_cents + $2 WHERE workspace_id = $1 AND id = $3", [ws, amountCents, paymentRow.id]);
      const kbInvoice = await killbill().getInvoice(paymentRow.invoice_id);
      await query("UPDATE invoices SET balance_cents = $2, status = $3 WHERE workspace_id = $1 AND id = $4", [ws, Math.round(kbInvoice.balance * 100), kbInvoice.balance > 0.001 ? "unpaid" : "paid", paymentRow.invoice_id]);
      audit(req.caller!, "payment.refunded", { type: "payment", id: paymentRow.id });
      const invoiceRowNumber = (await query("SELECT number FROM invoices WHERE workspace_id = $1 AND id = $2", [ws, paymentRow.invoice_id])).rows[0] as { number: string };
      const contacts = await billingContacts(ws);
      if (contacts.length > 0) {
        mailer().send({
          to: contacts,
          subject: `Refund for invoice ${invoiceRowNumber.number}: ${formatMoney(amountCents)}`,
          text: `A refund of ${formatMoney(amountCents)} was recorded for invoice ${invoiceRowNumber.number}.\n`,
        });
      }
      const fresh = (await query("SELECT * FROM payments WHERE workspace_id = $1 AND id = $2", [ws, paymentRow.id])).rows[0] as unknown as { id: string; invoice_id: string; amount_cents: number; refunded_cents: number; created_at: Date };
      return { status: 200, body: { payment: paymentJson(fresh) } };
    });
  } catch (e) {
    if (isProviderError(e)) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});

billingRouter.post("/cancel", async (req, res, next) => {
  try {
    const { role } = await callerWsShared(req);
    if (role !== "owner") throw errors.forbidden();
    await withIdempotency(req, res, async () => {
      const { ws } = await callerWsShared(req);
      const s = await subRow(ws);
      if (s.state === "cancelled") throw errors.conflict("invalid_transition", { from: "cancelled", to: "cancelled" });
      if (s.kb_account_id && s.kb_base_sub_id) {
        await killbill().cancelSubscription(s.kb_base_sub_id, "IMMEDIATE");
        for (const seatId of s.kb_seat_sub_ids ?? []) {
          await killbill().cancelSubscription(seatId, "IMMEDIATE");
        }
      }
      await query("UPDATE subscriptions SET state = 'cancelled', cancelled_at = now(), pending_change = NULL WHERE workspace_id = $1", [ws]);
      audit(req.caller!, "subscription.cancelled", { type: "workspace", id: ws });
      const fresh = await subRow(ws);
      return { status: 200, body: { subscription: subscriptionJson(fresh) } };
    });
  } catch (e) {
    if (isProviderError(e)) return next(errors.serviceUnavailable("billing"));
    next(e);
  }
});


