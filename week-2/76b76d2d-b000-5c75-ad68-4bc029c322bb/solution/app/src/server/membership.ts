import type pg from "pg";
import { randomUUID } from "node:crypto";
import { CADENCES, TIERS, type Cadence, type Tier } from "../shared/domain.ts";
import { creditBalance, recordMovement } from "./credit.ts";
import { one, query, transaction, type Db } from "./db.ts";
import { membershipChanged, membershipStarted } from "./emails.ts";
import { ApiError } from "./errors.ts";
import { cancelSubscription, changePlan, ensureAccount, requireBilling, subscribe, undoCharge, type BilledInvoice, type KbSubscription } from "./killbill.ts";
import { enqueue, nextMailNumber, wakeOutbox } from "./outbox.ts";
import type { AccountRow, Session } from "./sessions.ts";
import { requireStepup } from "./stepup.ts";
import { torontoDate } from "./time.ts";
import { Fields } from "./validate.ts";

type MembershipRow = {
  account_id: number; tier: Tier; cadence: Cadence | "gift"; started_on: string; charged_through: string; ends_on: string | null;
  pending_tier: Tier | null; pending_cadence: Cadence | null; pending_effective: string | null; kb_subscription_id: string;
};

type MembershipView = {
  tier: Tier; cadence: Cadence | "gift"; plan: string; state: "active"; started_on: string; charged_through: string; ends_on: string | null;
  pending_change: null | { tier: Tier; cadence: Cadence; effective_date: string };
};

const RANK: Record<Tier, number> = { friend: 0, cinephile: 1, projectionist: 2 };

/** The membership as of `today`: inactive once a gift term has ended; a pending change applies from its date. */
function present(row: MembershipRow, today: string): MembershipView | null {
  if (row.ends_on && today >= row.ends_on) return null;
  const switched = row.pending_effective !== null && today >= row.pending_effective;
  const tier = switched && row.pending_tier ? row.pending_tier : row.tier;
  const cadence = switched && row.pending_cadence ? row.pending_cadence : row.cadence;
  return {
    tier, cadence, plan: `${tier}-${cadence}`, state: "active", started_on: row.started_on, charged_through: row.charged_through, ends_on: row.ends_on,
    pending_change: !switched && row.pending_tier && row.pending_cadence && row.pending_effective
      ? { tier: row.pending_tier, cadence: row.pending_cadence, effective_date: row.pending_effective } : null,
  };
}

async function membershipRow(accountId: number, db?: Db): Promise<MembershipRow | undefined> {
  return one<MembershipRow>("SELECT * FROM memberships WHERE account_id = $1", [accountId], db);
}

export async function activeMembership(accountId: number, now: Date, db?: Db): Promise<MembershipView | null> {
  const row = await membershipRow(accountId, db);
  return row ? present(row, torontoDate(now)) : null;
}

function invoiceView(invoice: BilledInvoice): Record<string, unknown> {
  return { amount_cents: invoice.amountCents, credit_applied_cents: invoice.creditAppliedCents, paid_cents: invoice.paidCents, items: invoice.items };
}

/** Serialises membership starts and changes per account, so two at once cannot both reach Kill Bill. */
export async function lockAccount(tx: pg.PoolClient, accountId: number): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(724102, $1)", [accountId]);
}

/** Undoes a subscription start whose local commit failed. */
export async function undoMembershipStart(started: { subscriptionId: string; invoice: BilledInvoice }): Promise<void> {
  await cancelSubscription(started.subscriptionId);
  if (started.invoice.paymentId) await undoCharge(started.invoice);
}

export async function kbAccountFor(account: AccountRow): Promise<string> {
  if (account.kb_account_id) return account.kb_account_id;
  const id = await ensureAccount({ externalKey: account.number ?? "", name: account.name, email: account.email, locale: account.locale });
  await query("UPDATE accounts SET kb_account_id = $2 WHERE id = $1", [account.id, id]);
  return id;
}

/** Records a membership invoice, its credit spend, and returns nothing to the caller. */
async function recordInvoice(tx: pg.PoolClient, account: AccountRow, invoice: BilledInvoice, reference: string): Promise<void> {
  await tx.query(
    "INSERT INTO membership_invoices (account_id, kb_invoice_id, amount_cents, credit_applied_cents, paid_cents, created_at) VALUES ($1, $2, $3, $4, $5, now())",
    [account.id, invoice.invoiceId, invoice.amountCents, invoice.creditAppliedCents, invoice.paidCents],
  );
  if (invoice.creditAppliedCents > 0 && account.number) await recordMovement(tx, account.number, "spend", invoice.creditAppliedCents, reference);
}

/** Starts a membership row from a Kill Bill subscription and enqueues the membership-started email. */
export async function startMembership(tx: pg.PoolClient, account: AccountRow, tier: Tier, cadence: Cadence | "gift", sub: KbSubscription, charged: number, giftRef: string | null): Promise<MembershipView> {
  const startedOn = sub.billingStartDate.slice(0, 10);
  const through = (sub.chargedThroughDate ?? startedOn).slice(0, 10);
  await tx.query(
    `INSERT INTO memberships (account_id, tier, cadence, started_on, charged_through, ends_on, kb_subscription_id, gift_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (account_id) DO UPDATE SET tier = $2, cadence = $3, started_on = $4, charged_through = $5, ends_on = $6,
       kb_subscription_id = $7, gift_ref = $8, pending_tier = NULL, pending_cadence = NULL, pending_effective = NULL`,
    [account.id, tier, cadence, startedOn, through, cadence === "gift" ? through : null, sub.subscriptionId, giftRef],
  );
  const locale = (await one<{ locale: "en" | "fr" }>("SELECT locale FROM accounts WHERE id = $1", [account.id], tx))?.locale ?? account.locale;
  const n = await nextMailNumber(tx, `membership-started:${account.number}`);
  const email = membershipStarted(locale, { number: account.number ?? "", tier, cadence, charged, nextDate: through });
  await enqueue(tx, { key: `membership-started:${account.number}:${n}`, kind: "membership-started", to: account.email, ...email });
  const row = await membershipRow(account.id, tx);
  const view = row ? present(row, torontoDate(new Date())) : null;
  if (!view) throw new Error("membership not active after start");
  return view;
}

function readPlan(body: Record<string, unknown>): { tier: Tier; cadence: Cadence; fields: Fields } {
  const fields = new Fields(body);
  return { tier: fields.choice("tier", TIERS), cadence: fields.choice("cadence", CADENCES), fields };
}

export async function joinMembership(session: Session, body: Record<string, unknown>): Promise<{ membership: MembershipView; invoice: Record<string, unknown> }> {
  const account = session.account;
  let started: { subscriptionId: string; invoice: BilledInvoice } | null = null;
  const result = await transaction(async (tx) => {
    await lockAccount(tx, account.id);
    const now = new Date();
    requireStepup(session, { creditApplied: await creditBalance(account.number, tx), tierChange: false }, now);
    if (await activeMembership(account.id, now, tx)) throw new ApiError("already_member");
    const { tier, cadence, fields } = readPlan(body);
    fields.done();
    requireBilling();
    const kbAccount = await kbAccountFor(account);
    const attempt = randomUUID().slice(0, 8);
    const { subscription: sub, invoice } = await subscribe(kbAccount, `${tier}-${cadence}`, `${account.number}-membership-${attempt}`, `${account.number}-join-${attempt}`);
    started = { subscriptionId: sub.subscriptionId, invoice };
    await recordInvoice(tx, account, invoice, `${tier}-${cadence}`);
    return { membership: await startMembership(tx, account, tier, cadence, sub, invoice.amountCents, null), invoice: invoiceView(invoice) };
  }).catch(async (error: unknown) => {
    if (started) await undoMembershipStart(started);
    throw error;
  });
  wakeOutbox();
  return result;
}

export async function changeMembership(session: Session, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const account = session.account;
  const now = new Date();
  requireStepup(session, { creditApplied: 0, tierChange: true }, now);
  const result = await transaction(async (tx) => {
    await lockAccount(tx, account.id);
    const row = await membershipRow(account.id, tx);
    const current = row ? present(row, torontoDate(now)) : null;
    if (!row || !current) throw new ApiError("not_member");
    if (current.cadence === "gift") throw new ApiError("gift_membership_locked");
    if (current.pending_change) throw new ApiError("change_pending", { date: current.pending_change.effective_date });
    const { tier, cadence, fields } = readPlan(body);
    if (!fields.has("tier") && !fields.has("cadence") && tier === current.tier && cadence === current.cadence) throw new ApiError("no_change");
    fields.done();
    requireBilling();
    const from: [Tier, Cadence] = [current.tier, current.cadence];
    const kbAccount = await kbAccountFor(account);
    const upgrade = RANK[tier] > RANK[current.tier];
    const attempt = randomUUID().slice(0, 8);
    const changed = await changePlan(kbAccount, row.kb_subscription_id, `${tier}-${cadence}`, upgrade ? "IMMEDIATE" : "END_OF_TERM", `${account.number}-change-${attempt}`);
    const today = torontoDate(now);
    const effectiveDate = upgrade ? today : current.charged_through;
    if (changed.invoice) {
      await recordInvoice(tx, account, changed.invoice, `${tier}-${cadence}`);
      await tx.query("UPDATE memberships SET tier = $2, cadence = $3, charged_through = $4 WHERE account_id = $1", [
        account.id, tier, cadence, (changed.subscription.chargedThroughDate ?? current.charged_through).slice(0, 10),
      ]);
    } else {
      await tx.query("UPDATE memberships SET pending_tier = $2, pending_cadence = $3, pending_effective = $4 WHERE account_id = $1", [account.id, tier, cadence, effectiveDate]);
    }
    const locale = (await one<{ locale: "en" | "fr" }>("SELECT locale FROM accounts WHERE id = $1", [account.id], tx))?.locale ?? account.locale;
    const n = await nextMailNumber(tx, `membership-changed:${account.number}`);
    const email = membershipChanged(locale, { from, to: [tier, cadence], effectiveDate, charged: changed.invoice?.amountCents ?? 0 });
    await enqueue(tx, { key: `membership-changed:${account.number}:${n}`, kind: "membership-changed", to: account.email, ...email });
    const updated = await membershipRow(account.id, tx);
    return {
      membership: updated ? present(updated, today) : null, effective: upgrade ? "immediate" : "end-of-term", effective_date: effectiveDate,
      invoice: changed.invoice ? invoiceView(changed.invoice) : null,
    };
  });
  wakeOutbox();
  return result;
}
