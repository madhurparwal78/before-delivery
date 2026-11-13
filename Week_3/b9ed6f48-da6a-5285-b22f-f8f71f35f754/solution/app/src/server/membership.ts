// Supporter memberships (brief: Business rules › Membership, Overdue charges and dunning).
// Every action for one supporter runs under that supporter's advisory lock, so actions from any
// instance are judged one at a time against the state Kill Bill confirms at that moment.

import type pg from "pg";
import { config } from "./config.js";
import { locked, one, pool, rows, tx } from "./db.js";
import { fail, type Fields } from "./http.js";
import {
  accountInvoices,
  accountSubscriptions,
  assertBillingReachable,
  cancelAtEndOfTerm,
  cancelImmediately,
  changePlan,
  createSubscription,
  payInvoice,
  uncancel,
  undoChangePlan,
  type KbInvoice,
  type KbSubscription,
} from "./killbill.js";
import { assertStorageReachable } from "./storage.js";
import { catalogVersions, isUpgrade, planName, tierOfPlan, tierPriceAt, tierPriceOn, type CatalogVersion } from "./catalog.js";
import { deliverNow, queueMail } from "./mail.js";
import {
  accountCurrency,
  accountIdOf,
  chargeApproved,
  currencyLocked,
  declined,
  ensureAccount,
  newOrderId,
  nextReceiptNumber,
  orderById,
  orderJson,
  outcomeClass,
  recordOrder,
  settledAt,
  storeReceipt,
  type OrderKind,
  type OrderRow,
  type OutcomeClass,
  type Payer,
} from "./payments.js";
import { COPY, TIER_NAMES, TIERS, copyFor, type MembershipStatus, type Tier } from "../shared/copy.js";
import { isCurrency, majorToMinor, minorToMajor, type Currency } from "../shared/money.js";
import { cardDigits } from "../shared/cards.js";

const isTier = (value: unknown): value is Tier => typeof value === "string" && (TIERS as readonly string[]).includes(value);
const SUPPORTER_PLANS = new Set(TIERS.map(planName));
const kbToday = () => new Date().toISOString().slice(0, 10);

interface KbMembership {
  accountId: string;
  currency: Currency;
  subscription: KbSubscription;
  unpaid: KbInvoice[];
}

type Pending = { kind: "downgrade"; tier: Tier; effective_on: string } | { kind: "cancel"; effective_on: string } | null;

/** The membership status and pending change, derived only from Kill Bill-confirmed state. */
function membershipFromKillBill(m: KbMembership, today: string): { status: MembershipStatus; pending: Pending } {
  const sub = m.subscription;
  const ended = sub.state === "CANCELLED" || (sub.billingEndDate !== null && sub.billingEndDate.slice(0, 10) <= today);
  if (ended) return { status: "cancelled", pending: null };
  if (m.unpaid.length) return { status: "overdue", pending: null };
  const change = sub.events.find((e) => e.eventType === "CHANGE" && e.effectiveDate > today && e.plan !== null && e.plan !== sub.planName);
  if (change) return { status: "pending_change", pending: { kind: "downgrade", tier: tierOfPlan(change.plan as string), effective_on: change.effectiveDate.slice(0, 10) } };
  if (sub.billingEndDate) return { status: "pending_change", pending: { kind: "cancel", effective_on: sub.billingEndDate.slice(0, 10) } };
  return { status: "active", pending: null };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kill Bill raises the invoice for a new subscription or an immediate change just after the call
 * returns; waits (up to 20 s) for an invoice that is not in `known`.
 */
async function newInvoice(accountId: string, known: Set<string>): Promise<KbInvoice | undefined> {
  for (let waited = 0; waited < 20_000; waited += 250) {
    const fresh = (await accountInvoices(accountId)).find((i) => !known.has(i.invoiceId) && (i.items ?? []).length > 0);
    if (fresh) return fresh;
    await sleep(250);
  }
  return undefined;
}

const invoiceIds = async (accountId: string) => new Set((await accountInvoices(accountId)).map((i) => i.invoiceId));

async function readKillBill(userId: string): Promise<KbMembership | null> {
  const accountId = await accountIdOf(userId);
  if (!accountId) return null;
  const voided = new Set((await rows<{ subscription_id: string }>(pool, "SELECT subscription_id FROM voided_subscriptions")).map((r) => r.subscription_id));
  const subscriptions = (await accountSubscriptions(accountId)).filter((s) => SUPPORTER_PLANS.has(s.planName) && !voided.has(s.subscriptionId));
  if (!subscriptions.length) return null;
  subscriptions.sort((a, b) => Number(a.state !== "CANCELLED") - Number(b.state !== "CANCELLED") || a.startDate.localeCompare(b.startDate));
  const subscription = subscriptions[subscriptions.length - 1];
  const unpaid = (await accountInvoices(accountId)).filter((i) => i.balance > 0 && (i.items ?? []).some((item) => item.subscriptionId === subscription.subscriptionId));
  return { accountId, currency: (await accountCurrency(userId)) as Currency, subscription, unpaid };
}

const amountDue = (m: KbMembership) => m.unpaid.reduce((sum, i) => sum + majorToMinor(i.balance, m.currency), 0);

function membershipJson(m: KbMembership, versions: CatalogVersion[], last4: string | null) {
  const tier = tierOfPlan(m.subscription.planName);
  const { status, pending } = membershipFromKillBill(m, kbToday());
  const chargedThrough = m.subscription.chargedThroughDate?.slice(0, 10) ?? null;
  const nextTier = pending?.kind === "downgrade" ? pending.tier : tier;
  const charging = (status === "active" || status === "pending_change") && pending?.kind !== "cancel" && chargedThrough !== null;
  return {
    tier,
    tier_name: TIER_NAMES[tier],
    status,
    currency: m.currency,
    price_minor: tierPriceAt(versions, tier, m.currency, Date.now()),
    charged_through: chargedThrough,
    pending,
    amount_due_minor: status === "overdue" ? amountDue(m) : null,
    next_charge: charging ? { on: chargedThrough, amount_minor: tierPriceOn(versions, nextTier, m.currency, chargedThrough as string) } : null,
    card_last4: last4,
  };
}

interface CardOnFile {
  last4: string;
  outcome_class: OutcomeClass;
}

async function cardOnFile(userId: string): Promise<CardOnFile | undefined> {
  return one<CardOnFile>(pool, "SELECT last4, outcome_class FROM cards_on_file WHERE user_id = $1", [userId]);
}

async function storeCard(db: pg.PoolClient | pg.Pool, userId: string, digits: string): Promise<void> {
  await db.query(
    `INSERT INTO cards_on_file (user_id, last4, outcome_class) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET last4 = EXCLUDED.last4, outcome_class = EXCLUDED.outcome_class`,
    [userId, digits.slice(-4), outcomeClass(digits)],
  );
}

export async function membershipView(userId: string) {
  const m = await readKillBill(userId);
  return m ? membershipJson(m, await catalogVersions(), (await cardOnFile(userId))?.last4 ?? null) : null;
}

async function reachable(): Promise<void> {
  await assertStorageReachable().catch(() => {
    throw fail.storage(COPY.storagePurchase);
  });
  await assertBillingReachable().catch(() => {
    throw fail.billing();
  });
}

const isMember = (m: KbMembership | null): m is KbMembership => m !== null && membershipFromKillBill(m, kbToday()).status !== "cancelled";

/** Pays a membership invoice and records it as one order with its receipt and email. */
async function settleInvoice(payer: Payer, m: KbMembership, invoice: KbInvoice, kind: OrderKind, last4: string, tier: Tier): Promise<{ order: OrderRow; mailId: number }> {
  const amountMinor = majorToMinor(invoice.balance, m.currency);
  const orderId = newOrderId();
  const payment = await payInvoice(m.accountId, invoice.invoiceId, minorToMajor(amountMinor, m.currency), `pay-${orderId}`);
  const settlement = {
    orderId,
    receiptNumber: await nextReceiptNumber(),
    payer,
    kind,
    description: `${TIER_NAMES[tier]} supporter, monthly${kind === "membership_upgrade" ? " (upgrade)" : ""}`,
    currency: m.currency,
    amountMinor,
    last4,
    invoiceId: invoice.invoiceId,
    payment,
    settledAt: settledAt(payment, amountMinor, m.currency),
  };
  await storeReceipt(settlement);
  const mailId = await tx(async (db) => {
    await db.query("DELETE FROM dunning WHERE user_id = $1", [payer.id]);
    return recordOrder(db, settlement, TIER_NAMES[tier]);
  });
  return { order: (await orderById(pool, orderId)) as OrderRow, mailId };
}

async function reply(status: number, userId: string, extra: Record<string, unknown> = {}) {
  return { status, body: { membership: await membershipView(userId), ...extra } };
}

const DUNNING_SUBJECTS = {
  first: "Your supporter payment didn't go through",
  reminder: "Reminder: your supporter payment is still due",
  cancelled: "Your supporter membership has been cancelled",
};

function dunningText(payer: Payer, line: string): string {
  return `${payer.name}\n${line}\nUpdate your card and retry the payment from your account: ${config.publicUrl}/account\n`;
}

/** A join that did not settle leaves the membership as it was: its subscription ends at once. */
async function voidJoin(subscriptionId: string): Promise<void> {
  await pool.query("INSERT INTO voided_subscriptions (subscription_id) VALUES ($1) ON CONFLICT DO NOTHING", [subscriptionId]);
  await cancelImmediately(subscriptionId);
}

export async function join(payer: Payer, input: Record<string, unknown>) {
  return locked(`membership:${payer.id}`, async () => {
    const current = await readKillBill(payer.id);
    if (isMember(current)) throw fail.conflict("already_member", COPY.alreadyMember);
    const fixed = await accountCurrency(payer.id);
    if (fixed && isCurrency(input.currency) && input.currency !== fixed) throw currencyLocked(fixed);
    const fields: Fields = {};
    if (!isTier(input.tier)) fields.tier = "Choose Reader, Fellow or Patron.";
    if (!isCurrency(input.currency)) fields.currency = "Choose EUR, GBP, USD or JPY.";
    const digits = typeof input.card_number === "string" ? cardDigits(input.card_number) : null;
    if (!digits) fields.card_number = COPY.cardField;
    if (Object.keys(fields).length) throw fail.validation(fields);
    await reachable();
    const tier = input.tier as Tier;
    const accountId = await ensureAccount(payer, input.currency as Currency);
    const known = await invoiceIds(accountId);
    const subscriptionId = await createSubscription(accountId, planName(tier));
    if (!(await chargeApproved(payer.id, outcomeClass(digits as string)))) {
      await voidJoin(subscriptionId);
      throw declined();
    }
    const invoice = (await newInvoice(accountId, known)) as KbInvoice;
    const m = (await readKillBill(payer.id)) as KbMembership;
    try {
      const { order, mailId } = await settleInvoice(payer, m, invoice, "membership_join", (digits as string).slice(-4), tier);
      await storeCard(pool, payer.id, digits as string);
      return reply(201, payer.id, { order: orderJson(order), receipt_email: await deliverNow([mailId]) });
    } catch (error) {
      await voidJoin(subscriptionId);
      throw error;
    }
  });
}

export async function changeTier(payer: Payer, input: Record<string, unknown>) {
  return locked(`membership:${payer.id}`, async () => {
    const current = await readKillBill(payer.id);
    if (!isMember(current)) throw fail.conflict("not_a_member", COPY.notAMember);
    const { status } = membershipFromKillBill(current, kbToday());
    if (status === "overdue") throw fail.conflict("payment_overdue", COPY.paymentOverdue);
    if (status === "pending_change") throw fail.conflict("change_pending", COPY.changePending);
    const from = tierOfPlan(current.subscription.planName);
    if (isTier(input.tier) && input.tier === from) throw fail.conflict("same_tier", copyFor.sameTier(TIER_NAMES[from]));
    if (!isTier(input.tier)) throw fail.validation({ tier: "Choose Reader, Fellow or Patron." });
    await reachable();
    const to = input.tier;
    const known = await invoiceIds(current.accountId);
    await changePlan(current.subscription.subscriptionId, planName(to));
    if (!isUpgrade(from, to)) return reply(200, payer.id, { order: null, receipt_email: null });
    const invoice = await newInvoice(current.accountId, known);
    if (!invoice || invoice.balance <= 0) return reply(200, payer.id, { order: null, receipt_email: null });
    const after = (await readKillBill(payer.id)) as KbMembership;
    const card = (await cardOnFile(payer.id)) as CardOnFile;
    if (!(await chargeApproved(payer.id, card.outcome_class))) {
      const mailId = await tx(async (db) => {
        await db.query(
          `INSERT INTO dunning (user_id, user_email, user_name, subscription_id, invoice_id, order_kind, tier, currency, amount_due_minor, failed_at, attempts, auto_retries, next_retry_at)
           VALUES ($1, $2, $3, $4, $5, 'membership_upgrade', $6, $7, $8, now(), 1, 0, now() + make_interval(secs => $9))
           ON CONFLICT (user_id) DO NOTHING`,
          [payer.id, payer.email, payer.name, after.subscription.subscriptionId, invoice.invoiceId, to, after.currency, amountDue(after), config.dunningRetrySeconds],
        );
        return queueMail(db, payer, DUNNING_SUBJECTS.first, dunningText(payer, `Your ${TIER_NAMES[to]} supporter payment was declined. Your membership is overdue.`));
      });
      await deliverNow([mailId]);
      throw declined();
    }
    const { order, mailId } = await settleInvoice(payer, after, invoice, "membership_upgrade", card.last4, to);
    return reply(200, payer.id, { order: orderJson(order), receipt_email: await deliverNow([mailId]) });
  });
}

export async function cancelMembership(payer: Payer) {
  return locked(`membership:${payer.id}`, async () => {
    const current = await readKillBill(payer.id);
    if (!isMember(current)) throw fail.conflict("not_a_member", COPY.notAMember);
    const { status } = membershipFromKillBill(current, kbToday());
    if (status === "pending_change") throw fail.conflict("change_pending", COPY.changePending);
    await assertBillingReachable();
    if (status === "overdue") {
      await cancelImmediately(current.subscription.subscriptionId);
      await pool.query("DELETE FROM dunning WHERE user_id = $1", [payer.id]);
    } else {
      await cancelAtEndOfTerm(current.subscription.subscriptionId);
    }
    return reply(200, payer.id);
  });
}

export async function undoPending(payer: Payer) {
  return locked(`membership:${payer.id}`, async () => {
    const current = await readKillBill(payer.id);
    if (!isMember(current)) throw fail.conflict("not_a_member", COPY.notAMember);
    const { pending } = membershipFromKillBill(current, kbToday());
    if (!pending) throw fail.conflict("nothing_pending", COPY.nothingPending);
    if (pending.kind === "downgrade") await undoChangePlan(current.subscription.subscriptionId);
    else await uncancel(current.subscription.subscriptionId);
    return reply(200, payer.id);
  });
}

export async function updateCard(payer: Payer, input: Record<string, unknown>) {
  return locked(`membership:${payer.id}`, async () => {
    const current = await readKillBill(payer.id);
    if (!isMember(current)) throw fail.conflict("not_a_member", COPY.notAMember);
    const digits = typeof input.card_number === "string" ? cardDigits(input.card_number) : null;
    if (!digits) throw fail.validation({ card_number: COPY.cardField });
    await storeCard(pool, payer.id, digits);
    return reply(200, payer.id);
  });
}

interface DunningRow {
  user_id: string;
  user_email: string;
  user_name: string;
  tier: Tier;
  order_kind: OrderKind;
  failed_at: Date;
  attempts: number;
  auto_retries: number;
}

/** One charge of the overdue invoice with the card on file; shared by manual and automatic retries. */
async function chargeOverdue(payer: Payer, m: KbMembership, dunning: DunningRow | undefined) {
  const card = (await cardOnFile(payer.id)) as CardOnFile;
  if (!(await chargeApproved(payer.id, card.outcome_class))) return null;
  const tier = dunning?.tier ?? tierOfPlan(m.subscription.planName);
  return settleInvoice(payer, m, m.unpaid[0], dunning?.order_kind ?? "membership_upgrade", card.last4, tier);
}

export async function retryPayment(payer: Payer) {
  return locked(`membership:${payer.id}`, async () => {
    const current = await readKillBill(payer.id);
    if (!isMember(current)) throw fail.conflict("not_a_member", COPY.notAMember);
    if (!current.unpaid.length) throw fail.conflict("nothing_due", COPY.nothingDue);
    await reachable();
    const dunning = await one<DunningRow>(pool, "SELECT * FROM dunning WHERE user_id = $1", [payer.id]);
    const settled = await chargeOverdue(payer, current, dunning);
    if (!settled) {
      await pool.query("UPDATE dunning SET attempts = attempts + 1 WHERE user_id = $1", [payer.id]);
      throw declined();
    }
    return reply(200, payer.id, { order: orderJson(settled.order), receipt_email: await deliverNow([settled.mailId]) });
  });
}

/** Automatic retries at 1, 2 and 3 × DUNNING_RETRY_SECONDS after the decline; a reminder after
 *  each failed retry before the last; cancellation in Kill Bill after the third failure. */
export async function runDunning(): Promise<void> {
  const due = await rows<{ user_id: string }>(pool, "SELECT user_id FROM dunning WHERE next_retry_at <= now() ORDER BY next_retry_at");
  for (const { user_id } of due) {
    await tx(async (db) => {
      const got = await one<{ ok: boolean }>(db, "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok", [`membership:${user_id}`]);
      if (!got?.ok) return;
      const row = await one<DunningRow>(db, "SELECT * FROM dunning WHERE user_id = $1 AND next_retry_at <= now()", [user_id]);
      if (!row) return;
      const payer = { id: row.user_id, email: row.user_email, name: row.user_name };
      const current = await readKillBill(payer.id);
      if (!isMember(current) || !current.unpaid.length) {
        await db.query("DELETE FROM dunning WHERE user_id = $1", [user_id]);
        return;
      }
      const settled = await chargeOverdue(payer, current, row);
      if (settled) {
        await deliverNow([settled.mailId]);
        return;
      }
      const retries = row.auto_retries + 1;
      let mailId: number;
      if (retries < 3) {
        await db.query(
          "UPDATE dunning SET attempts = attempts + 1, auto_retries = $2, next_retry_at = failed_at + make_interval(secs => $3) WHERE user_id = $1",
          [user_id, retries, (retries + 1) * config.dunningRetrySeconds],
        );
        mailId = await queueMail(db, payer, DUNNING_SUBJECTS.reminder, dunningText(payer, `Your ${TIER_NAMES[row.tier]} supporter payment is still due.`));
      } else {
        await cancelImmediately(current.subscription.subscriptionId);
        await db.query("DELETE FROM dunning WHERE user_id = $1", [user_id]);
        mailId = await queueMail(db, payer, DUNNING_SUBJECTS.cancelled, `${payer.name}\nWe could not collect your ${TIER_NAMES[row.tier]} supporter payment after three attempts, so your membership has been cancelled.\nYou can join again at any time: ${config.publicUrl}/support\n`);
      }
      return mailId;
    }).then((mailId) => (mailId === undefined ? undefined : deliverNow([mailId])));
  }
}

export async function overdueSupporters() {
  const list = await rows<DunningRow & { currency: Currency; amount_due_minor: number; next_retry_at: Date | null }>(pool, "SELECT * FROM dunning ORDER BY failed_at");
  return list.map((r) => ({
    user_email: r.user_email,
    name: r.user_name,
    tier: r.tier,
    currency: r.currency,
    amount_due_minor: r.amount_due_minor,
    failed_at: r.failed_at.toISOString(),
    attempts: r.attempts,
    next_retry_at: r.next_retry_at ? r.next_retry_at.toISOString() : null,
  }));
}
