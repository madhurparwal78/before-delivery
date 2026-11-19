import { setTimeout as sleep } from "node:timers/promises";
import { PLAN_LABEL, PLAN_RATE, PLANS, type Plan, type PlanState } from "../shared/rules.js";
import { config } from "./config.js";
import { one, pool, rows, tx } from "./db.js";
import { conflict, ProviderDown } from "./errors.js";
import * as killbill from "./killbill.js";
import { enqueueEmail } from "./outbox.js";
import { setRates } from "./valkey.js";
import { memberById, venueById, type MemberRow, type VenueRow } from "./views.js";

const CLEAR = "__KILLBILL__CLEAR__OVERDUE_STATE__";

/** The builder plan state follows Kill Bill's overdue state, never a click. */
function planStateOf(overdueState: string): PlanState {
  if (overdueState === "DOWNGRADED") return "downgraded";
  if (overdueState === "WARNING") return "payment_failed";
  return "active";
}

export function effectivePlan(plan: Plan, state: PlanState): Plan {
  return state === "downgraded" ? "sandbox" : plan;
}

const planName = (plan: Plan): string => `${plan}-monthly`;
const planOf = (name: string | null | undefined): Plan => PLANS.find((plan) => planName(plan) === name) ?? "sandbox";
const bundleKey = (memberId: string): string => `plan-${memberId}`;
const accountKey = (venueSlug: string, memberId: string): string => `${venueSlug}:${memberId}`;

interface InvoiceView {
  id: string;
  number: string;
  invoice_date: string;
  amount_cents: number;
  balance_cents: number;
  items: { description: string; amount_cents: number; start_date: string | null; end_date: string | null }[];
}

interface BillingRow {
  member_id: string;
  plan: Plan;
  state: PlanState;
  overdue_state: string;
  pending_plan: Plan | null;
  pending_effective_date: string | null;
  invoices: InvoiceView[];
}

function billingView(row: BillingRow, provider: "ok" | "unavailable") {
  const effective = effectivePlan(row.plan, row.state);
  return {
    plan: row.plan,
    effective_plan: effective,
    state: row.state,
    overdue_state: row.overdue_state,
    rate_per_second: PLAN_RATE[effective],
    pending_plan: row.pending_plan,
    pending_effective_date: row.pending_effective_date,
    provider,
    invoices: row.invoices,
  };
}

async function storedBilling(memberId: string): Promise<BillingRow> {
  await pool.query("INSERT INTO builder_billing (member_id, plan, state, overdue_state) VALUES ($1, 'sandbox', 'active', $2) ON CONFLICT DO NOTHING", [memberId, CLEAR]);
  return (await one<BillingRow>(pool, "SELECT * FROM builder_billing WHERE member_id = $1", [memberId])) as BillingRow;
}

/** The member's Kill Bill account, created on first need with the external payment method. */
export async function accountFor(member: MemberRow, venue: VenueRow): Promise<string> {
  if (member.killbill_account_id) return member.killbill_account_id;
  const id = await killbill.ensureAccount(accountKey(venue.slug, member.id), member.display_name, member.email);
  await pool.query("UPDATE members SET killbill_account_id = $2 WHERE id = $1", [member.id, id]);
  return id;
}

interface Snapshot {
  plan: Plan;
  overdueState: string;
  pendingPlan: Plan | null;
  pendingDate: string | null;
  invoices: InvoiceView[];
  subscriptionId: string | null;
  accountId: string | null;
}

/** Re-reads plan, pending change, overdue state and invoices from Kill Bill. */
async function readKillBill(member: MemberRow, venue: VenueRow): Promise<Snapshot> {
  const accountId = member.killbill_account_id ?? (await killbill.accountIdByKey(accountKey(venue.slug, member.id)));
  if (!accountId) return { plan: "sandbox", overdueState: CLEAR, pendingPlan: null, pendingDate: null, invoices: [], subscriptionId: null, accountId: null };
  const [subscription, overdueState, invoices] = await Promise.all([
    killbill.planSubscription(accountId, bundleKey(member.id)),
    killbill.overdueState(accountId),
    killbill.invoices(accountId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const pending = (subscription?.events ?? []).find((event) => event.eventType === "CHANGE" && event.effectiveDate.slice(0, 10) > today && event.plan);
  return {
    plan: planOf(subscription?.planName),
    overdueState,
    pendingPlan: pending ? planOf(pending.plan) : null,
    pendingDate: pending ? pending.effectiveDate.slice(0, 10) : null,
    subscriptionId: subscription?.subscriptionId ?? null,
    accountId,
    invoices: invoices.map((invoice) => ({
      id: invoice.invoiceId,
      number: String(invoice.invoiceNumber),
      invoice_date: invoice.invoiceDate,
      amount_cents: killbill.toCents(invoice.amount),
      balance_cents: killbill.toCents(invoice.balance),
      items: (invoice.items ?? []).map((item) => ({
        description: item.description ?? "",
        amount_cents: killbill.toCents(item.amount),
        start_date: item.startDate ?? null,
        end_date: item.endDate ?? null,
      })),
    })),
  };
}

/**
 * Records a snapshot. A state change sends its email in the same transaction, and a change of the
 * effective plan rewrites every key's rate in Valkey before the new state is committed, so no reader
 * ever sees the new state with the old rate.
 */
async function record(member: MemberRow, venue: VenueRow, snapshot: Snapshot): Promise<BillingRow> {
  const state = planStateOf(snapshot.overdueState);
  return tx(async (client) => {
    const previous = (await one<BillingRow>(client, "SELECT * FROM builder_billing WHERE member_id = $1 FOR UPDATE", [member.id])) as BillingRow;
    const updated = (await one<BillingRow>(
      client,
      `UPDATE builder_billing SET plan = $2, state = $3, overdue_state = $4, pending_plan = $5, pending_effective_date = $6, invoices = $7,
              payment_failed_at = CASE WHEN $3 = 'payment_failed' THEN coalesce(payment_failed_at, now()) ELSE NULL END,
              final_notice_sent = CASE WHEN $3 = 'payment_failed' THEN final_notice_sent ELSE false END
        WHERE member_id = $1 RETURNING *`,
      [member.id, snapshot.plan, state, snapshot.overdueState, snapshot.pendingPlan, snapshot.pendingDate, JSON.stringify(snapshot.invoices)],
    )) as BillingRow;
    if (previous.state !== state) {
      const label = PLAN_LABEL[snapshot.plan];
      const subject = { payment_failed: `Payment failed — your ${label} plan`, downgraded: "Your plan is now Sandbox", active: `Your ${label} plan is active again` }[state];
      const text = {
        payment_failed: `Your last ${label} plan payment failed. Pay the outstanding balance on the Builder screen to keep your rate.\n\n${config.publicUrl}/builder\n`,
        downgraded: `Your plan is downgraded to Sandbox until the outstanding invoice is paid. Your API keys now run at the Sandbox rate.\n\n${config.publicUrl}/builder\n`,
        active: `Your account is clear and your ${label} plan is active again. Your API keys are back at the ${label} rate.\n`,
      }[state];
      await enqueueEmail(client, venue.id, { to: member.email, subject, text });
    }
    const effective = effectivePlan(updated.plan, updated.state);
    if (effectivePlan(previous.plan, previous.state) !== effective) {
      const keys = await rows<{ id: string }>(client, "SELECT id FROM api_keys WHERE member_id = $1 AND revoked_at IS NULL", [member.id]);
      await setRates(keys.map((key) => key.id), PLAN_RATE[effective]);
    }
    return updated;
  });
}

async function refresh(member: MemberRow, venue: VenueRow): Promise<{ row: BillingRow; snapshot: Snapshot }> {
  await storedBilling(member.id);
  const snapshot = await readKillBill(member, venue);
  return { row: await record(member, venue, snapshot), snapshot };
}

/** GET /api/billing: re-read from Kill Bill, or the last recorded state while Kill Bill is down. */
export async function readBilling(memberId: string) {
  const member = await memberById(pool, memberId);
  const venue = await venueById(pool, member.venue_id ?? "");
  try {
    return billingView((await refresh(member, venue)).row, "ok");
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    return billingView(await storedBilling(memberId), "unavailable");
  }
}

export async function currentRate(memberId: string): Promise<number> {
  const row = await storedBilling(memberId);
  return PLAN_RATE[effectivePlan(row.plan, row.state)];
}

const RANK: Record<Plan, number> = { sandbox: 0, builder: 1, desk: 2 };

/**
 * Kill Bill invoices an immediate plan change and pays it asynchronously after confirming the
 * change; wait (up to 20 s) until the new invoice exists and carries no balance before reading back.
 */
async function awaitInvoicing(accountId: string, invoicesBefore: number): Promise<void> {
  for (let waited = 0; waited < 20_000; waited += 250) {
    const current = await killbill.invoices(accountId);
    if (current.length > invoicesBefore && current.every((invoice) => killbill.toCents(invoice.balance) === 0)) return;
    await sleep(250);
  }
}

/** Upgrades take effect at once with Kill Bill's proration; downgrades at the end of the term. */
export async function changePlan(memberId: string, target: Plan) {
  const member = await memberById(pool, memberId);
  const venue = await venueById(pool, member.venue_id ?? "");
  let { row, snapshot } = await refresh(member, venue);
  // Kill Bill re-evaluates the overdue state asynchronously after it pays an invoice, so a read right after a
  // paid upgrade can still carry the earlier state; with nothing due, let it settle before refusing the change.
  for (let waited = 0; row.state !== "active" && snapshot.invoices.every((i) => i.balance_cents === 0) && waited < 10_000; waited += 500) {
    await sleep(500);
    ({ row, snapshot } = await refresh(member, venue));
  }
  if (row.state !== "active") throw conflict("plan_locked");
  if (row.plan === target) throw conflict("already_on_plan");
  const accountId = await accountFor(member, venue);
  if (RANK[target] > RANK[row.plan]) {
    if (snapshot.subscriptionId) await killbill.changeSubscription(snapshot.subscriptionId, planName(target), "IMMEDIATE");
    else await killbill.createSubscription(accountId, bundleKey(member.id), planName(target));
    await awaitInvoicing(accountId, snapshot.invoices.length);
  } else if (snapshot.subscriptionId) {
    await killbill.changeSubscription(snapshot.subscriptionId, planName(target), "END_OF_TERM");
  }
  return billingView((await refresh(await memberById(pool, memberId), venue)).row, "ok");
}

export async function payOutstanding(memberId: string) {
  const member = await memberById(pool, memberId);
  const venue = await venueById(pool, member.venue_id ?? "");
  const { row, snapshot } = await refresh(member, venue);
  const due = row.invoices.reduce((total, invoice) => total + invoice.balance_cents, 0);
  if (due <= 0 || !snapshot.accountId) throw conflict("nothing_due");
  await killbill.payAll(snapshot.accountId, due);
  return billingView((await refresh(member, venue)).row, "ok");
}

/** Overdue check for every builder with a Kill Bill account, plus the one-time final notice. */
export async function pollOverdue(): Promise<void> {
  const builders = await rows<{ id: string }>(pool, "SELECT id FROM members WHERE 'builder' = ANY(roles) AND killbill_account_id IS NOT NULL");
  for (const { id } of builders) {
    const member = await memberById(pool, id);
    await refresh(member, await venueById(pool, member.venue_id ?? "")).catch((error: unknown) =>
      console.error(`overdue check for ${id}:`, error instanceof Error ? error.message : error),
    );
  }
  await tx(async (client) => {
    const due = await rows<{ member_id: string; plan: Plan; email: string; venue_id: string }>(
      client,
      `UPDATE builder_billing b SET final_notice_sent = true FROM members m
        WHERE m.id = b.member_id AND b.state = 'payment_failed' AND NOT b.final_notice_sent
          AND b.payment_failed_at <= now() - make_interval(secs => $1)
        RETURNING b.member_id, b.plan, m.email, m.venue_id`,
      [config.finalNoticeSeconds],
    );
    for (const notice of due) {
      const label = PLAN_LABEL[notice.plan];
      await enqueueEmail(client, notice.venue_id, {
        to: notice.email,
        subject: `Final notice — your ${label} plan`,
        text: `Your ${label} plan payment is still outstanding. Pay it on the Builder screen to keep your rate.\n\n${config.publicUrl}/builder\n`,
      });
    }
  });
}

/** Puts a builder on a paid plan through Kill Bill (seed: Ines on Builder). */
export async function subscribe(member: MemberRow, venue: VenueRow, plan: Plan): Promise<void> {
  const accountId = await accountFor(member, venue);
  await storedBilling(member.id);
  if (!(await killbill.planSubscription(accountId, bundleKey(member.id)))) {
    const before = (await killbill.invoices(accountId)).length;
    await killbill.createSubscription(accountId, bundleKey(member.id), planName(plan));
    await awaitInvoicing(accountId, before);
  }
  await refresh(await memberById(pool, member.id), venue);
}
