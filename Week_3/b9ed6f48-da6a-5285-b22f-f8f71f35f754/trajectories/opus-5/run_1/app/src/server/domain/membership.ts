import { AppError } from '../errors.js';
import { config } from '../config.js';
import { pool, queryOne, withAdvisoryLock } from '../db/index.js';
import { compareDayKeys, lisbonDayKey } from '../../shared/lisbon.js';
import { TIER_NAMES, type TierKey } from '../../shared/copy.js';
import type { Currency } from '../../shared/money.js';
import type { Membership, Order, PendingChange, ReceiptEmailState, User } from '../../shared/types.js';
import type { CardClass } from './cards.js';
import { isCardClass } from './cards.js';
import { readPriceChanges, tierPriceOn } from './prices.js';
import * as orders from './orders.js';
import * as killbill from '../services/killbill.js';
import * as mail from '../services/mail.js';
import { TIER_PLANS } from '../services/killbill.js';

const TIER_RANK: Record<TierKey, number> = { reader: 1, fellow: 2, patron: 3 };
const PLAN_TIERS = new Map<string, TierKey>(
  (Object.entries(TIER_PLANS) as [TierKey, string][]).map(([tier, plan]) => [plan, tier]),
);
const INVOICE_POLL_ATTEMPTS = 30;
const INVOICE_POLL_INTERVAL_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface MembershipRow {
  user_id: string;
  kb_account_id: string;
  kb_subscription_id: string;
  tier: TierKey;
  currency: Currency;
  card_last4: string;
  card_class: string;
}

export interface DunningRow {
  user_id: string;
  invoice_id: string;
  order_kind: 'membership_join' | 'membership_upgrade';
  amount_minor: string;
  currency: Currency;
  failed_at: Date;
  attempts: number;
  next_retry_at: Date | null;
  state: string;
}

export async function readMembershipRow(userId: string): Promise<MembershipRow | null> {
  return queryOne<MembershipRow>(
    `SELECT user_id, kb_account_id, kb_subscription_id, tier, currency, card_last4, card_class
     FROM memberships WHERE user_id = $1`,
    [userId],
  );
}

async function readActiveDunning(userId: string): Promise<DunningRow | null> {
  return queryOne<DunningRow>(
    `SELECT user_id, invoice_id, order_kind, amount_minor::text, currency, failed_at, attempts, next_retry_at, state
     FROM dunning_state WHERE user_id = $1 AND state IN ('active', 'retrying')`,
    [userId],
  );
}

function tierOfPlan(planName: string): TierKey {
  return PLAN_TIERS.get(planName) ?? 'reader';
}

function dateOnly(isoDateTime: string): string {
  return lisbonDayKey(Date.parse(isoDateTime));
}

function pendingOf(subscription: killbill.SubscriptionState, todayKey: string): PendingChange | null {
  if (subscription.cancelledDate) {
    const effectiveOn = dateOnly(subscription.cancelledDate);
    if (compareDayKeys(effectiveOn, todayKey) > 0) return { kind: 'cancel', effective_on: effectiveOn };
  }
  for (const event of subscription.events) {
    if (event.eventType !== 'CHANGE' || !event.plan) continue;
    const effectiveOn = dateOnly(event.effectiveDate);
    if (compareDayKeys(effectiveOn, todayKey) > 0) {
      return { kind: 'downgrade', tier: tierOfPlan(event.plan), effective_on: effectiveOn };
    }
  }
  return null;
}

export interface MembershipState {
  row: MembershipRow;
  subscription: killbill.SubscriptionState;
  view: Membership;
  dunning: DunningRow | null;
}

/** The membership status comes only from Kill Bill-confirmed subscription state. */
export async function readMembershipState(userId: string, nowMs: number): Promise<MembershipState | null> {
  const row = await readMembershipRow(userId);
  if (!row) return null;
  const subscription = await killbill.readSubscription(row.kb_subscription_id);
  const todayKey = lisbonDayKey(nowMs);
  const changes = await readPriceChanges();
  const tier = tierOfPlan(subscription.planName);
  const dunning = await readActiveDunning(userId);
  let amountDueMinor: number | null = null;
  if (dunning) {
    const invoice = await killbill.readInvoice(dunning.invoice_id);
    if (invoice.balanceMinor > 0) amountDueMinor = invoice.balanceMinor;
  }
  const pending = pendingOf(subscription, todayKey);
  const cancelled = subscription.state === 'CANCELLED';
  const status: Membership['status'] = cancelled
    ? 'cancelled'
    : amountDueMinor !== null
      ? 'overdue'
      : pending
        ? 'pending_change'
        : 'active';

  const chargedThrough = subscription.chargedThroughDate;
  const nextChargeTier = pending?.kind === 'downgrade' ? pending.tier : tier;
  const nextCharge =
    (status === 'active' || status === 'pending_change') && chargedThrough && pending?.kind !== 'cancel'
      ? {
          on: chargedThrough,
          amount_minor: tierPriceOn(changes, nextChargeTier, row.currency, chargedThrough),
        }
      : null;

  return {
    row,
    subscription,
    dunning,
    view: {
      tier,
      tier_name: TIER_NAMES[tier],
      status,
      currency: row.currency,
      price_minor: tierPriceOn(changes, tier, row.currency, todayKey),
      charged_through: chargedThrough,
      pending: status === 'cancelled' ? null : pending,
      amount_due_minor: status === 'overdue' ? amountDueMinor : null,
      next_charge: nextCharge,
      card_last4: row.card_last4,
    },
  };
}

export async function readMembershipView(userId: string, nowMs: number): Promise<Membership | null> {
  const state = await readMembershipState(userId, nowMs);
  return state ? state.view : null;
}

/** Waits for the invoice Kill Bill raises for a subscription action. */
async function awaitNewUnpaidInvoice(accountId: string, known: Set<string>): Promise<killbill.InvoiceSummary | null> {
  for (let attempt = 0; attempt < INVOICE_POLL_ATTEMPTS; attempt += 1) {
    const unpaid = await killbill.unpaidInvoices(accountId);
    const fresh = unpaid.find((invoice) => !known.has(invoice.invoiceId) && invoice.balanceMinor > 0);
    if (fresh) return fresh;
    await sleep(INVOICE_POLL_INTERVAL_MS);
  }
  return null;
}

function cardClassOf(row: MembershipRow): CardClass {
  return isCardClass(row.card_class) ? row.card_class : 'approved';
}

function joinDescription(tier: TierKey): string {
  return `${TIER_NAMES[tier]} supporter, monthly`;
}

function upgradeDescription(tier: TierKey): string {
  return `${TIER_NAMES[tier]} supporter, change of plan`;
}

/* -------------------------------------------------------------- dunning */

async function startDunning(input: {
  user: User;
  invoiceId: string;
  amountMinor: number;
  currency: Currency;
  kind: 'membership_join' | 'membership_upgrade';
  tier: TierKey;
  nowMs: number;
}): Promise<void> {
  const nextRetry = new Date(input.nowMs + config.dunningRetrySeconds * 1000);
  await pool.query(
    `INSERT INTO dunning_state (user_id, invoice_id, order_kind, amount_minor, currency, failed_at, attempts, next_retry_at, state)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'active')
     ON CONFLICT (user_id) DO UPDATE SET invoice_id = $2, order_kind = $3, amount_minor = $4, currency = $5,
       failed_at = $6, attempts = 1, next_retry_at = $7, state = 'active'`,
    [
      input.user.id,
      input.invoiceId,
      input.kind,
      input.amountMinor,
      input.currency,
      new Date(input.nowMs),
      nextRetry,
    ],
  );
  await mail.send(
    mail.dunningFirstMessage({
      recipientName: input.user.name,
      recipientEmail: input.user.email,
      tierName: TIER_NAMES[input.tier],
      amountMinor: input.amountMinor,
      currency: input.currency,
    }),
  );
}

export async function stopDunning(userId: string, state: 'settled' | 'cancelled'): Promise<void> {
  await pool.query(`UPDATE dunning_state SET state = $2, next_retry_at = NULL WHERE user_id = $1`, [userId, state]);
}

function settledMessage(
  kind: 'membership_join' | 'membership_upgrade',
  tier: TierKey,
): (facts: Parameters<typeof mail.upgradeMessage>[0]) => ReturnType<typeof mail.upgradeMessage> {
  return kind === 'membership_join' ? (facts) => mail.joinMessage(facts, TIER_NAMES[tier]) : mail.upgradeMessage;
}

/* ---------------------------------------------------------------- actions */

export interface MembershipResult {
  membership: Membership;
  order: Order | null;
  receiptEmail: ReceiptEmailState | null;
}

export async function join(
  user: User,
  tier: TierKey,
  currency: Currency,
  card: { class: CardClass; last4: string },
  nowMs: number,
): Promise<MembershipResult> {
  return withAdvisoryLock(`membership:${user.id}`, async () => {
    const current = await readMembershipState(user.id, nowMs);
    if (current && current.view.status !== 'cancelled') throw new AppError('already_member');
    const account = await orders.accountForPayment(user, currency);
    await orders.requireProvidersReady();
    const known = new Set((await killbill.unpaidInvoices(account.accountId)).map((invoice) => invoice.invoiceId));
    const subscriptionId = await killbill.createSubscription(account.accountId, TIER_PLANS[tier]);
    const invoice = await awaitNewUnpaidInvoice(account.accountId, known);
    if (!invoice) {
      await killbill.cancelSubscription(subscriptionId, 'IMMEDIATE');
      throw new AppError('billing_unavailable');
    }
    const settlement = await orders.settlePayment({
      user,
      accountId: account.accountId,
      invoiceId: invoice.invoiceId,
      amountMinor: invoice.balanceMinor,
      currency,
      kind: 'membership_join',
      description: joinDescription(tier),
      cardClass: card.class,
      cardLast4: card.last4,
      message: (facts) => mail.joinMessage(facts, TIER_NAMES[tier]),
    });
    if (settlement === 'declined') {
      await killbill.cancelSubscription(subscriptionId, 'IMMEDIATE');
      throw new AppError('card_declined');
    }
    await pool.query(
      `INSERT INTO memberships (user_id, kb_account_id, kb_subscription_id, tier, currency, card_last4, card_class)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET kb_account_id = $2, kb_subscription_id = $3, tier = $4,
         currency = $5, card_last4 = $6, card_class = $7, updated_at = now()`,
      [user.id, account.accountId, subscriptionId, tier, currency, card.last4, card.class],
    );
    const membership = await readMembershipView(user.id, nowMs);
    return { membership: membership as Membership, order: settlement.order, receiptEmail: settlement.receiptEmail };
  });
}

export async function change(user: User, tier: TierKey, nowMs: number): Promise<MembershipResult> {
  return withAdvisoryLock(`membership:${user.id}`, async () => {
    const state = await readMembershipState(user.id, nowMs);
    if (!state || state.view.status === 'cancelled') throw new AppError('not_a_member');
    if (state.view.status === 'overdue') throw new AppError('payment_overdue');
    if (state.view.pending) throw new AppError('change_pending');
    if (state.view.tier === tier) throw new AppError('same_tier', { context: { tierName: TIER_NAMES[tier] } });

    const upgrading = TIER_RANK[tier] > TIER_RANK[state.view.tier];
    if (!upgrading) {
      await killbill.changePlan(state.row.kb_subscription_id, TIER_PLANS[tier], 'END_OF_TERM');
      const membership = await readMembershipView(user.id, nowMs);
      return { membership: membership as Membership, order: null, receiptEmail: null };
    }

    await orders.requireProvidersReady();
    const accountId = state.row.kb_account_id;
    const known = new Set((await killbill.unpaidInvoices(accountId)).map((invoice) => invoice.invoiceId));
    await killbill.changePlan(state.row.kb_subscription_id, TIER_PLANS[tier], 'IMMEDIATE');
    await pool.query(`UPDATE memberships SET tier = $2, updated_at = now() WHERE user_id = $1`, [user.id, tier]);
    const invoice = await awaitNewUnpaidInvoice(accountId, known);
    if (!invoice) {
      const membership = await readMembershipView(user.id, nowMs);
      return { membership: membership as Membership, order: null, receiptEmail: null };
    }
    const settlement = await orders.settlePayment({
      user,
      accountId,
      invoiceId: invoice.invoiceId,
      amountMinor: invoice.balanceMinor,
      currency: state.row.currency,
      kind: 'membership_upgrade',
      description: upgradeDescription(tier),
      cardClass: cardClassOf(state.row),
      cardLast4: state.row.card_last4,
      message: mail.upgradeMessage,
    });
    if (settlement === 'declined') {
      await startDunning({
        user,
        invoiceId: invoice.invoiceId,
        amountMinor: invoice.balanceMinor,
        currency: state.row.currency,
        kind: 'membership_upgrade',
        tier,
        nowMs,
      });
      throw new AppError('card_declined');
    }
    const membership = await readMembershipView(user.id, nowMs);
    return { membership: membership as Membership, order: settlement.order, receiptEmail: settlement.receiptEmail };
  });
}

export async function cancel(user: User, nowMs: number): Promise<Membership> {
  return withAdvisoryLock(`membership:${user.id}`, async () => {
    const state = await readMembershipState(user.id, nowMs);
    if (!state || state.view.status === 'cancelled') throw new AppError('not_a_member');
    if (state.view.pending) throw new AppError('change_pending');
    if (state.view.status === 'overdue') {
      await killbill.cancelSubscription(state.row.kb_subscription_id, 'IMMEDIATE');
      await stopDunning(user.id, 'cancelled');
    } else {
      await killbill.cancelSubscription(state.row.kb_subscription_id, 'END_OF_TERM');
    }
    return (await readMembershipView(user.id, nowMs)) as Membership;
  });
}

export async function undo(user: User, nowMs: number): Promise<Membership> {
  return withAdvisoryLock(`membership:${user.id}`, async () => {
    const state = await readMembershipState(user.id, nowMs);
    if (!state || state.view.status === 'cancelled') throw new AppError('not_a_member');
    const pending = state.view.pending;
    if (!pending) throw new AppError('nothing_pending');
    if (pending.kind === 'cancel') await killbill.uncancelSubscription(state.row.kb_subscription_id);
    else await killbill.undoChangePlan(state.row.kb_subscription_id);
    return (await readMembershipView(user.id, nowMs)) as Membership;
  });
}

export async function updateCard(
  user: User,
  card: { class: CardClass; last4: string },
  nowMs: number,
): Promise<Membership> {
  return withAdvisoryLock(`membership:${user.id}`, async () => {
    const state = await readMembershipState(user.id, nowMs);
    if (!state || state.view.status === 'cancelled') throw new AppError('not_a_member');
    await pool.query(
      `UPDATE memberships SET card_last4 = $2, card_class = $3, updated_at = now() WHERE user_id = $1`,
      [user.id, card.last4, card.class],
    );
    return (await readMembershipView(user.id, nowMs)) as Membership;
  });
}

export async function retry(user: User, nowMs: number): Promise<MembershipResult> {
  return withAdvisoryLock(`membership:${user.id}`, async () => {
    const state = await readMembershipState(user.id, nowMs);
    if (!state || state.view.status === 'cancelled') throw new AppError('not_a_member');
    const dunning = state.dunning;
    if (!dunning || state.view.status !== 'overdue') throw new AppError('nothing_due');
    const invoice = await killbill.readInvoice(dunning.invoice_id);
    if (invoice.balanceMinor <= 0) throw new AppError('nothing_due');
    await orders.requireProvidersReady();
    const tier = state.view.tier;
    const settlement = await orders.settlePayment({
      user,
      accountId: state.row.kb_account_id,
      invoiceId: dunning.invoice_id,
      amountMinor: invoice.balanceMinor,
      currency: state.row.currency,
      kind: dunning.order_kind,
      description:
        dunning.order_kind === 'membership_join' ? joinDescription(tier) : upgradeDescription(tier),
      cardClass: cardClassOf(state.row),
      cardLast4: state.row.card_last4,
      message: settledMessage(dunning.order_kind, tier),
    });
    if (settlement === 'declined') throw new AppError('card_declined');
    await stopDunning(user.id, 'settled');
    const membership = await readMembershipView(user.id, nowMs);
    return { membership: membership as Membership, order: settlement.order, receiptEmail: settlement.receiptEmail };
  });
}

/* ----------------------------------------------- the automatic retry run */

export async function runDueRetry(row: DunningRow): Promise<void> {
  const membership = await readMembershipRow(row.user_id);
  if (!membership) {
    await stopDunning(row.user_id, 'cancelled');
    return;
  }
  const session = await queryOne<{ name: string; email: string }>(
    'SELECT name, email FROM killbill_accounts WHERE user_id = $1',
    [row.user_id],
  );
  const user: User = {
    id: row.user_id,
    name: session?.name ?? '',
    email: session?.email ?? '',
    role: 'visitor',
  };
  const invoice = await killbill.readInvoice(row.invoice_id);
  if (invoice.balanceMinor <= 0) {
    await stopDunning(row.user_id, 'settled');
    return;
  }
  const tier = membership.tier;
  const settlement = await orders.settlePayment({
    user,
    accountId: membership.kb_account_id,
    invoiceId: row.invoice_id,
    amountMinor: invoice.balanceMinor,
    currency: membership.currency,
    kind: row.order_kind,
    description: row.order_kind === 'membership_join' ? joinDescription(tier) : upgradeDescription(tier),
    cardClass: cardClassOf(membership),
    cardLast4: membership.card_last4,
    message: settledMessage(row.order_kind, tier),
  });
  if (settlement !== 'declined') {
    await stopDunning(row.user_id, 'settled');
    return;
  }
  const attempts = row.attempts + 1;
  const facts = {
    recipientName: user.name,
    recipientEmail: user.email,
    tierName: TIER_NAMES[tier],
    amountMinor: invoice.balanceMinor,
    currency: membership.currency,
  };
  if (attempts >= 4) {
    await killbill.cancelSubscription(membership.kb_subscription_id, 'IMMEDIATE');
    await pool.query(
      `UPDATE dunning_state SET attempts = $2, next_retry_at = NULL, state = 'cancelled' WHERE user_id = $1`,
      [row.user_id, attempts],
    );
    await mail.send(mail.dunningCancelledMessage(facts));
    return;
  }
  const nextRetry = new Date(row.failed_at.getTime() + attempts * config.dunningRetrySeconds * 1000);
  await pool.query(
    `UPDATE dunning_state SET attempts = $2, next_retry_at = $3, state = 'active' WHERE user_id = $1`,
    [row.user_id, attempts, nextRetry],
  );
  await mail.send(mail.dunningReminderMessage(facts));
}
