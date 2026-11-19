// The billing mirror: plan, term, renewal, pending change, invoices and payment state as Kill Bill reports them.
import { config } from "./config.js";
import { db, tx, type Db } from "./db.js";
import { ApiError, fail } from "./errors.js";
import * as kb from "./killbill.js";
import { record } from "./activity.js";
import { localDay } from "./zone.js";
import { centsToAmount } from "../shared/money.js";
import { ENTITLEMENTS, PLANS, TERMS, hasTerm, isImmediateChange, type Entitlements, type Plan, type Term } from "../shared/plans.js";

interface BillingRow {
  facilitator_id: string;
  kb_account_id: string | null;
  subscription_id: string | null;
  plan: Plan;
  term: Term;
  renews_on: string | null;
  pending_plan: Plan | null;
  pending_term: Term | null;
  pending_date: string | null;
  past_due_since: Date | null;
  synced_at: Date | null;
}

interface FacilitatorRow {
  id: string;
  email: string;
  name: string;
  time_zone: string;
  seed_plan: Plan;
  seed_term: Term;
}

type BillingState = "active" | "past_due" | "read_only";

function readOnlyAt(row: { past_due_since: Date | null }): Date | null {
  return row.past_due_since ? new Date(row.past_due_since.getTime() + config.paymentGraceSeconds * 1000) : null;
}

function stateOf(row: { past_due_since: Date | null }): BillingState {
  const lockAt = readOnlyAt(row);
  if (!lockAt) return "active";
  return Date.now() >= lockAt.getTime() ? "read_only" : "past_due";
}

async function billingRow(t: Db, facilitatorId: string, lock = false): Promise<BillingRow> {
  const row = await t.one<BillingRow>(`SELECT * FROM billing WHERE facilitator_id = $1${lock ? " FOR UPDATE" : ""}`, [facilitatorId]);
  if (!row) throw new Error(`no billing row for ${facilitatorId}`);
  return row;
}

export async function entitlementsOf(t: Db, facilitatorId: string): Promise<Entitlements> {
  return ENTITLEMENTS[(await billingRow(t, facilitatorId)).plan];
}

export async function planOf(t: Db, facilitatorId: string): Promise<Plan> {
  return (await billingRow(t, facilitatorId)).plan;
}

/** Step 7 of the error order: writes in a read-only workspace answer payment_required. */
export async function assertWritable(t: Db, facilitatorId: string): Promise<void> {
  if (stateOf(await billingRow(t, facilitatorId)) === "read_only") fail("payment_required");
}

function parsePlanCode(code: string | null | undefined): { plan: Plan; term: Term } | null {
  const [plan, term] = (code ?? "").split("-");
  return (PLANS as readonly string[]).includes(plan ?? "") && (TERMS as readonly string[]).includes(term ?? "")
    ? { plan: plan as Plan, term: term as Term }
    : null;
}

/** Makes sure the facilitator's Kill Bill account, payment method and subscription exist. */
async function ensureAccount(f: FacilitatorRow, row: BillingRow): Promise<{ accountId: string; subscription: kb.KbSubscription | null }> {
  const account = await kb.ensureAccount({ externalKey: `facilitator:${f.email}`, name: f.name, email: f.email, timeZone: f.time_zone });
  if (!account.paymentMethodId) await kb.addExternalPaymentMethod(account.accountId);
  let subscription = (await kb.subscriptions(account.accountId)).find((s) => s.state !== "CANCELLED") ?? null;
  if (!subscription && !row.subscription_id) {
    await kb.createSubscription(account.accountId, f.seed_plan, f.seed_term);
    subscription = (await kb.subscriptions(account.accountId)).find((s) => s.state !== "CANCELLED") ?? null;
  }
  return { accountId: account.accountId, subscription };
}

/** Reads Kill Bill and writes the mirror. Throws BillingDown when Kill Bill cannot be reached. */
async function syncLocked(t: Db, facilitatorId: string): Promise<BillingRow> {
  const f = await t.one<FacilitatorRow>("SELECT id, email, name, time_zone, seed_plan, seed_term FROM facilitators WHERE id = $1", [facilitatorId]);
  if (!f) throw new Error(`unknown facilitator ${facilitatorId}`);
  const row = await billingRow(t, facilitatorId, true);
  const { accountId, subscription } = await ensureAccount(f, row);
  const current = subscription ? parsePlanCode(subscription.planName) : null;
  const now = Date.now();
  const pending = subscription?.events
    .filter((e) => e.eventType === "CHANGE" && Date.parse(e.effectiveDate) > now)
    .map((e) => ({ code: parsePlanCode(e.plan), at: new Date(e.effectiveDate) }))
    .find((e) => e.code !== null);
  const list = await kb.invoices(accountId);
  for (const inv of list) {
    await t.run(
      `INSERT INTO facilitator_invoices (id, facilitator_id, number, date, amount_cents, balance_cents) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET number = $3, date = $4, amount_cents = $5, balance_cents = $6`,
      [inv.id, facilitatorId, inv.number, inv.date, inv.amountCents, inv.balanceCents],
    );
  }
  const owing = list.some((inv) => inv.balanceCents > 0);
  const updated = await t.one<BillingRow>(
    `UPDATE billing SET kb_account_id = $2, subscription_id = $3, plan = $4, term = $5, renews_on = $6,
       pending_plan = $7, pending_term = $8, pending_date = $9,
       past_due_since = CASE WHEN $10::boolean THEN coalesce(past_due_since, now()) ELSE NULL END, synced_at = now()
     WHERE facilitator_id = $1 RETURNING *`,
    [
      facilitatorId,
      accountId,
      subscription?.subscriptionId ?? null,
      current?.plan ?? "free",
      current?.term ?? "monthly",
      subscription?.chargedThroughDate ?? subscription?.billingStartDate.slice(0, 10) ?? null,
      pending?.code?.plan ?? null,
      pending?.code?.term ?? null,
      pending ? localDay(pending.at, f.time_zone) : null,
      owing,
    ],
  );
  if (!updated) throw new Error("billing row vanished");
  return updated;
}

/** Refreshes the mirror; returns false when Kill Bill was unreachable and the mirror is stale. */
export async function refresh(facilitatorId: string): Promise<boolean> {
  try {
    await tx((t) => syncLocked(t, facilitatorId));
    return true;
  } catch (error) {
    if (error instanceof kb.BillingDown) return false;
    throw error;
  }
}

export async function refreshAll(): Promise<void> {
  for (const f of await db.rows<{ id: string }>("SELECT id FROM facilitators")) await refresh(f.id);
}

let catalogReady = false;

/** Uploads the catalog once across instances. */
export async function ensureCatalog(): Promise<void> {
  if (catalogReady) return;
  try {
    await tx(async (t) => {
      await t.run("SELECT pg_advisory_xact_lock(4173002)");
      if ((await kb.catalogVersions()).length === 0) await kb.uploadCatalog();
    });
    catalogReady = true;
  } catch (error) {
    if (!(error instanceof kb.BillingDown)) throw error;
  }
}

interface InvoiceRow {
  id: string;
  number: string;
  date: string;
  amount_cents: number;
  balance_cents: number;
}

function invoiceJson(i: InvoiceRow) {
  return {
    id: i.id,
    number: i.number,
    date: i.date,
    amount: centsToAmount(i.amount_cents),
    balance: centsToAmount(i.balance_cents),
    currency: "EUR",
    status: i.balance_cents > 0 ? "unpaid" : "paid",
  };
}

export async function billingObject(t: Db, facilitatorId: string, stale: boolean) {
  const row = await billingRow(t, facilitatorId);
  const f = await t.one<{ time_zone: string }>("SELECT time_zone FROM facilitators WHERE id = $1", [facilitatorId]);
  const invoices = await t.rows<InvoiceRow>(
    "SELECT id, number, date, amount_cents, balance_cents FROM facilitator_invoices WHERE facilitator_id = $1 ORDER BY date DESC, length(number) DESC, number DESC",
    [facilitatorId],
  );
  const usage = await t.one<{ active: number; invites: number }>(
    `SELECT (SELECT count(*) FROM workshops WHERE facilitator_id = $1 AND status <> 'archived') AS active,
            coalesce((SELECT count FROM invite_counts WHERE facilitator_id = $1 AND day = $2), 0) AS invites`,
    [facilitatorId, localDay(new Date(), f?.time_zone ?? "UTC")],
  );
  const lockAt = readOnlyAt(row);
  return {
    plan: row.plan,
    term: row.term,
    state: stateOf(row),
    pastDueSince: row.past_due_since?.toISOString() ?? null,
    readOnlyAt: lockAt?.toISOString() ?? null,
    renewsOn: row.renews_on,
    pendingChange: row.pending_plan && row.pending_term ? { plan: row.pending_plan, term: row.pending_term, effectiveDate: row.pending_date } : null,
    entitlements: ENTITLEMENTS[row.plan],
    usage: { activeWorkshops: usage?.active ?? 0, invitesToday: usage?.invites ?? 0 },
    invoices: invoices.map(invoiceJson),
    stale,
    syncedAt: row.synced_at?.toISOString() ?? null,
  };
}

export function validatePlanRequest(body: Record<string, unknown>): { plan: Plan; term: Term } {
  const fields: Record<string, string> = {};
  const plan = body.plan;
  const term = body.term;
  if (typeof plan !== "string" || !(PLANS as readonly string[]).includes(plan)) fields.plan = "Check this value";
  if (typeof term !== "string" || !(TERMS as readonly string[]).includes(term)) fields.term = "Check this value";
  else if (plan === "free" && !hasTerm("free", term as Term)) fields.term = "Free has no annual term";
  if (Object.keys(fields).length) throw new ApiError("validation", { fields });
  return { plan: plan as Plan, term: term as Term };
}

async function waitForNewInvoice(accountId: string, before: Set<string>): Promise<kb.KbInvoice | null> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const fresh = (await kb.invoiceIds(accountId)).filter((id) => !before.has(id));
    if (fresh.length) {
      const all = await Promise.all(fresh.map(kb.invoice));
      const newest = all.sort((a, b) => Number(b.number) - Number(a.number))[0];
      return newest ? settled(accountId, newest) : null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * Unless the account carries the automatic-payment-off tag, the new invoice is paid with the account's default
 * payment method as soon as Kill Bill reports it, rather than after Kill Bill's own bus picks it up seconds later.
 * Kill Bill's invoice-payment control refuses any second attempt once the balance is zero.
 */
async function settled(accountId: string, invoice: kb.KbInvoice): Promise<kb.KbInvoice> {
  if (invoice.balanceCents <= 0 || (await kb.autoPayOff(accountId))) return invoice;
  try {
    await kb.payInvoice(accountId, invoice);
  } catch (error) {
    if (!(error instanceof kb.BillingDown)) throw error;
  }
  return kb.invoice(invoice.id);
}

type PlanChangeOutcome =
  | { kind: "immediate"; invoice: ReturnType<typeof invoiceJson> | null }
  | { kind: "scheduled" }
  | { kind: "cancelled" };

/** POST /api/billing/plan, inside the operation's transaction. Serialised per facilitator by the row lock. */
export async function changePlan(t: Db, facilitatorId: string, target: { plan: Plan; term: Term }): Promise<PlanChangeOutcome> {
  const row = await billingRow(t, facilitatorId, true);
  const same = row.plan === target.plan && row.term === target.term;
  if (same && !row.pending_plan) fail("plan_unchanged");
  try {
    const synced = await syncLocked(t, facilitatorId);
    const accountId = synced.kb_account_id;
    const subscriptionId = synced.subscription_id;
    if (!accountId || !subscriptionId) throw new kb.BillingDown("no subscription yet");
    if (synced.pending_plan) await kb.undoChangePlan(subscriptionId);
    if (same) {
      await syncLocked(t, facilitatorId);
      return { kind: "cancelled" };
    }
    const immediate = isImmediateChange({ plan: synced.plan, term: synced.term }, target);
    const before = new Set(await kb.invoiceIds(accountId));
    await kb.changePlan(subscriptionId, target.plan, target.term, immediate);
    if (!immediate) {
      await syncLocked(t, facilitatorId);
      await record(t, facilitatorId, "plan.change_scheduled", null);
      return { kind: "scheduled" };
    }
    const created = await waitForNewInvoice(accountId, before);
    await syncLocked(t, facilitatorId);
    await record(t, facilitatorId, "plan.changed", null);
    const stored = created
      ? await t.one<InvoiceRow>("SELECT id, number, date, amount_cents, balance_cents FROM facilitator_invoices WHERE id = $1", [created.id])
      : undefined;
    return { kind: "immediate", invoice: stored ? invoiceJson(stored) : null };
  } catch (error) {
    if (error instanceof kb.BillingDown) throw new ApiError("billing_unavailable");
    throw error;
  }
}

/** POST /api/billing/payments: pays every unpaid invoice with the default payment method. */
export async function retryPayment(t: Db, facilitatorId: string): Promise<void> {
  try {
    const synced = await syncLocked(t, facilitatorId);
    const accountId = synced.kb_account_id;
    if (!accountId) throw new kb.BillingDown("no account yet");
    const unpaid = (await kb.invoices(accountId)).filter((i) => i.balanceCents > 0);
    if (unpaid.length === 0) fail("nothing_due");
    for (const inv of unpaid) await kb.payInvoice(accountId, inv);
    await syncLocked(t, facilitatorId);
    await record(t, facilitatorId, "payment.retried", null);
  } catch (error) {
    if (error instanceof kb.BillingDown) throw new ApiError("billing_unavailable");
    throw error;
  }
}

export async function sponsorInvoice(sponsorEmail: string, workshopId: string, title: string, feeCents: number): Promise<kb.KbInvoice> {
  const key = `sponsor:${sponsorEmail.toLowerCase()}`;
  const account = await tx(async (t) => {
    await t.run("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    return kb.ensureAccount({ externalKey: key, name: sponsorEmail.toLowerCase(), email: sponsorEmail.toLowerCase() });
  });
  const description = `Workshop ${workshopId} — ${title}`;
  const existing = (await kb.invoices(account.accountId)).find((inv) => inv.descriptions.includes(description));
  return existing ?? kb.externalCharge(account.accountId, feeCents, description);
}

