import crypto from 'node:crypto';
import type { App, User } from './app.ts';
import { requireUser } from './platform.ts';
import type { RouteContext } from './http.ts';
import { ApiError, sendJson, validationFailed } from './http.ts';
import { readJson, asString } from './params.ts';
import { validKey, begin, finish, release } from '../core/idempotency.ts';
import { normalizeCard, decideCharge, storeCardOnFile, decideChargeWithStoredClass, getCardState } from '../core/cards.ts';
import { ensureAccount, planForTier, tierOfPlan, orderById, recordSettlement } from './commerce.ts';
import { issueReceiptArtifacts, type ReceiptOrder } from '../core/commerce.ts';
import { minorToMajorString, type Currency } from '../core/money.ts';
import { FIELDS } from '../core/copy.ts';
import { toDateIso } from '../core/time.ts';

const TIERS = ['reader', 'fellow', 'patron'] as const;
type Tier = (typeof TIERS)[number];

function rank(tier: string): number {
  return TIERS.indexOf(tier as Tier);
}

export interface MembershipView {
  tier: string;
  tier_name: string;
  status: 'active' | 'pending_change' | 'overdue' | 'cancelled';
  currency: string;
  price_minor: number;
  charged_through: string | null;
  pending: { kind: 'downgrade'; tier: string; effective_on: string } | { kind: 'cancel'; effective_on: string } | null;
  amount_due_minor: number | null;
  next_charge: { on: string; amount_minor: number } | null;
  card_last4: string | null;
}

interface SubscriptionState {
  subscriptionId: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  events: Array<{ eventType: string; effectiveDate: string; plan: string | null }>;
}

export function registerMembershipRoutes(app: App, route: (method: string, pattern: string, handler: (ctx: RouteContext) => Promise<void>) => void): void {
  route('GET', '/api/me/membership', async (ctx) => {
    const user = await requireUser(ctx, app);
    const membership = await buildMembershipView(app, user);
    sendJson(ctx.res, 200, { membership });
  });

  /** Every membership action is idempotent and serialized per supporter. */
  const withMembershipIdempotency = (
    pattern: string,
    run: (ctx: RouteContext, user: User) => Promise<{ status: number; body: string }>,
  ): void => {
    route('POST', pattern, async (ctx) => {
      const user = await requireUser(ctx, app);
      const headerValue = ctx.req.headers['idempotency-key'];
      const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (!validKey(key)) throw new ApiError(400, 'idempotency_key_required');
      const raw = await ctx.rawBody();
      const outcome = await begin(app.pool, user.id, key, 'POST', ctx.path, raw);
      if (outcome.kind === 'conflict') throw new ApiError(409, 'idempotency_conflict');
      if (outcome.kind === 'replay') {
        ctx.res.writeHead(outcome.status, { 'Content-Type': 'application/json; charset=utf-8', 'Idempotent-Replayed': 'true' });
        ctx.res.end(outcome.body);
        return;
      }
      try {
        // One membership action per supporter at a time, judged at commit.
        const lock = await acquireMembershipLock(app, user.id);
        try {
          const result = await run(ctx, user);
          await finish(app.pool, user.id, key, result.status, result.body);
          if (!ctx.res.headersSent) {
            ctx.res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
            ctx.res.end(result.body);
          }
        } finally {
          await lock();
        }
      } catch (e) {
        if (e instanceof ApiError) {
          const body = JSON.stringify(e.body());
          await finish(app.pool, user.id, key, e.status, body);
          if (!ctx.res.headersSent) {
            ctx.res.writeHead(e.status, { 'Content-Type': 'application/json; charset=utf-8' });
            ctx.res.end(body);
          }
          return;
        }
        await release(app.pool, user.id, key);
        throw e;
      }
    });
  };

  withMembershipIdempotency('/api/me/membership', async (ctx, user) => joinPlan(app, ctx, user));
  withMembershipIdempotency('/api/me/membership/change', async (ctx, user) => changePlan(app, ctx, user));
  withMembershipIdempotency('/api/me/membership/cancel', async (_ctx, user) => cancelPlan(app, user));
  withMembershipIdempotency('/api/me/membership/undo', async (_ctx, user) => undoChange(app, user));
  withMembershipIdempotency('/api/me/membership/retry', async (_ctx, user) => retryPayment(app, user));

  route('PUT', '/api/me/membership/card', async (ctx) => {
    const user = await requireUser(ctx, app);
    const body = await readJson(ctx);
    const cardInput = asString(body['card_number']);
    const cardDigits = cardInput === null ? null : normalizeCard(cardInput);
    if (cardDigits === null) throw validationFailed({ card_number: FIELDS.card });
    const state = await membershipState(app, user);
    if (!state) throw new ApiError(409, 'not_a_member');
    await storeCardOnFile(app.pool, user.id, cardDigits);
    const membership = await buildMembershipView(app, user);
    sendJson(ctx.res, 200, { membership });
  });
}

/** Membership actions for one supporter are handled one at a time. */
async function acquireMembershipLock(app: App, userId: string): Promise<() => Promise<void>> {
  const conn = await app.pool.acquire();
  await conn.query('SELECT pg_advisory_lock(hashtext($1))', [userId]);
  return async () => {
    try {
      await conn.query('SELECT pg_advisory_unlock(hashtext($1))', [userId]);
    } finally {
      app.pool.release(conn);
    }
  };
}

async function membershipState(app: App, user: User): Promise<{ tier: string; subscriptionId: string } | null> {
  const res = await app.pool.query(`SELECT tier, subscription_id FROM memberships WHERE user_id = $1`, [user.id]);
  const row = res.rows[0];
  return row ? { tier: String(row['tier']), subscriptionId: String(row['subscription_id']) } : null;
}

async function kbSubscription(app: App, user: User): Promise<SubscriptionState | null> {
  const state = await membershipState(app, user);
  if (!state) return null;
  const sub = await app.kb.getSubscription(state.subscriptionId);
  return {
    subscriptionId: sub.subscriptionId,
    planName: sub.planName,
    state: sub.state,
    chargedThroughDate: sub.chargedThroughDate,
    events: sub.events.map((e) => ({ eventType: e.eventType, effectiveDate: e.effectiveDate, plan: e.plan ?? null })),
  };
}

export async function buildMembershipView(app: App, user: User): Promise<MembershipView | null> {
  const sub = await kbSubscription(app, user);
  if (!sub) return null;
  const tier = tierOfPlan(sub.planName);
  const account = await accountCurrency(app, user);
  const card = await getCardState(app.pool, user.id);
  const overdue = await overdueFor(app, user);
  const pending = pendingChangeFromEvents(sub.events, sub.state);
  const chargedThrough = sub.chargedThroughDate;

  if (sub.state === 'CANCELLED') {
    return {
      tier,
      tier_name: tierName(tier),
      status: 'cancelled',
      currency: account,
      price_minor: await effectiveTierPrice(app, tier, account),
      charged_through: chargedThrough,
      pending: null,
      amount_due_minor: null,
      next_charge: null,
      card_last4: card.last4,
    };
  }
  if (overdue) {
    return {
      tier,
      tier_name: tierName(tier),
      status: 'overdue',
      currency: account,
      price_minor: await effectiveTierPrice(app, tier, account),
      charged_through: chargedThrough,
      pending: pending && pending.kind === 'downgrade' ? pending : null,
      amount_due_minor: overdue.amountMinor,
      next_charge: null,
      card_last4: card.last4,
    };
  }
  if (pending) {
    const nextTier = pending.kind === 'downgrade' ? pending.tier : tier;
    return {
      tier,
      tier_name: tierName(tier),
      status: 'pending_change',
      currency: account,
      price_minor: await effectiveTierPrice(app, tier, account),
      charged_through: chargedThrough,
      pending,
      amount_due_minor: null,
      next_charge: chargedThrough
        ? { on: chargedThrough, amount_minor: await effectiveTierPrice(app, nextTier, account, chargedThrough) }
        : null,
      card_last4: card.last4,
    };
  }
  return {
    tier,
    tier_name: tierName(tier),
    status: 'active',
    currency: account,
    price_minor: await effectiveTierPrice(app, tier, account),
    charged_through: chargedThrough,
    pending: null,
    amount_due_minor: null,
    next_charge: chargedThrough
      ? { on: chargedThrough, amount_minor: await effectiveTierPrice(app, tier, account, chargedThrough) }
      : null,
    card_last4: card.last4,
  };
}

/** A future plan change or cancellation that Kill Bill has accepted. */
function pendingChangeFromEvents(events: Array<{ eventType: string; effectiveDate: string; plan: string | null }>, state: string): MembershipView['pending'] {
  const now = Date.now();
  let futureChange: { effectiveDate: number; plan: string | null } | null = null;
  for (const e of events) {
    const at = Date.parse(e.effectiveDate);
    if (e.eventType === 'CHANGE' && at > now) futureChange = { effectiveDate: at, plan: e.plan };
  }
  if (futureChange?.plan) {
    return { kind: 'downgrade', tier: tierOfPlan(futureChange.plan), effective_on: toDateIso(futureChange.effectiveDate) };
  }
  const futureStop = events.find((e) => (e.eventType === 'STOP_ENTITLEMENT' || e.eventType === 'STOP_BILLING') && Date.parse(e.effectiveDate) > now);
  if (futureStop && state === 'ACTIVE') {
    return { kind: 'cancel', effective_on: toDateIso(Date.parse(futureStop.effectiveDate)) };
  }
  return null;
}

async function accountCurrency(app: App, user: User): Promise<Currency> {
  const res = await app.pool.query(`SELECT currency FROM kb_accounts WHERE user_id = $1`, [user.id]);
  const row = res.rows[0];
  return row ? (row['currency'] as Currency) : 'EUR';
}

function tierName(tier: string): string {
  const map: Record<string, string> = { reader: 'Reader', fellow: 'Fellow', patron: 'Patron' };
  return map[tier] ?? tier;
}

/** Base catalog price for a tier and currency. */
export function tierPrice(tier: string, currency: Currency): number {
  const base: Record<string, Record<string, number>> = {
    reader: { EUR: 500, GBP: 400, USD: 600, JPY: 800 },
    fellow: { EUR: 1200, GBP: 1000, USD: 1400, JPY: 2000 },
    patron: { EUR: 3000, GBP: 2600, USD: 3500, JPY: 5000 },
  };
  return base[tier]?.[currency] ?? 0;
}

/** Price in force on a date, under the scheduled price changes. */
export async function effectiveTierPrice(app: App, tier: string, currency: Currency, onDate?: string): Promise<number> {
  const date = onDate ?? toDateIso(app.now());
  const res = await app.pool.query(
    `SELECT amount_minor FROM price_changes WHERE tier = $1 AND currency = $2 AND effective_on <= $3
     ORDER BY effective_on DESC LIMIT 1`,
    [tier, currency, date],
  );
  const row = res.rows[0];
  return row ? Number(row['amount_minor']) : tierPrice(tier, currency);
}

export async function overdueFor(app: App, user: User): Promise<{ amountMinor: number; id: string } | null> {
  const res = await app.pool.query(
    `SELECT id, amount_minor FROM dunning WHERE user_id = $1 AND cancelled = false AND settled_order_id IS NULL`,
    [user.id],
  );
  const row = res.rows[0];
  return row ? { amountMinor: Number(row['amount_minor']), id: String(row['id']) } : null;
}

async function joinPlan(app: App, ctx: RouteContext, user: User): Promise<{ status: number; body: string }> {
  const body = await readJson(ctx);
  const tier = asString(body['tier']);
  const currency = asString(body['currency']);
  const cardInput = asString(body['card_number']);
  const fields: Record<string, string> = {};
  if (tier === null || !TIERS.includes(tier as Tier)) fields['tier'] = 'Check the highlighted fields.';
  if (currency !== 'EUR' && currency !== 'GBP' && currency !== 'USD' && currency !== 'JPY') fields['currency'] = 'Check the highlighted fields.';
  const cardDigits = cardInput === null ? null : normalizeCard(cardInput);
  if (cardDigits === null) fields['card_number'] = FIELDS.card;
  if (Object.keys(fields).length) throw validationFailed(fields);
  const cur = currency as Currency;

  const existing = await membershipState(app, user);
  if (existing) {
    const sub = await kbSubscription(app, user);
    if (sub && sub.state !== 'CANCELLED') throw new ApiError(409, 'already_member');
  }

  const account = await ensureAccount(app, user, cur);
  if (account.currency !== cur) {
    throw new ApiError(409, 'currency_locked', undefined, `Your supporter account pays in ${account.currency}. Choose ${account.currency} to continue.`);
  }

  try {
    await app.kb.request('GET', '/1.0/kb/catalog');
  } catch {
    throw new ApiError(503, 'billing_unavailable');
  }
  await assertStorageReachable(app);

  const decision = await decideCharge(app.pool, user.id, cardDigits!);  if (!decision.approved) throw new ApiError(402, 'card_declined');

  const bundleKey = `membership-${user.id}-${crypto.randomUUID()}`;
  let subscription;
  try {
    subscription = await app.kb.createSubscription(account.accountId, planForTier(tier!), bundleKey);  } catch (e) {    throw new ApiError(503, 'billing_unavailable');
  }

  // The first month is invoiced by Kill Bill at the full tier price.
  let invoiceId = '';
  let invoiceBalance = 0;
  let payment;
  try {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const invoices = await app.kb.listAccountInvoices(account.accountId);      const open = invoices.find((inv) => inv.balance > 0.001);
      if (open) {
        invoiceId = open.invoiceId;
        invoiceBalance = open.balance;
        break;
      }
    }
    if (!invoiceId) throw new Error('no invoice');
    payment = await app.kb.payInvoice(account.accountId, invoiceId, minorToMajorString(invoiceBalance, cur), cur);
  } catch {
    // A declined join leaves no active subscription.
    try {
      await app.kb.cancelImmediate(subscription.subscriptionId);
    } catch {
      /* ignore */
    }
    throw new ApiError(503, 'billing_unavailable');
  }

  await app.pool.query(
    `INSERT INTO memberships (user_id, tier, subscription_id) VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET tier = $2, subscription_id = $3, updated_at = now()`,
    [user.id, tier, subscription.subscriptionId],
  );
  await storeCardOnFile(app.pool, user.id, cardDigits!);

  const orderId = crypto.randomUUID();
  const priceMinor = Math.round(invoiceBalance * (cur === 'JPY' ? 1 : 100));
  let receipt: string;
  try {
    receipt = await recordSettlement(app, {
      id: orderId,
      userId: user.id,
      kind: 'membership_join',
      description: `Supporter membership: ${tierName(tier!)}`,
      currency: cur,
      amountMinor: priceMinor,
      cardLast4: decision.last4,
      kbAccountId: account.accountId,
      kbInvoiceId: invoiceId,
      kbPaymentId: payment.paymentId,
    });
  } catch {
    try {
      await app.kb.cancelImmediate(subscription.subscriptionId);
    } catch {
      /* ignore */
    }
    try {
      await app.kb.refundPayment(payment.paymentId, minorToMajorString(priceMinor, cur), cur);
    } catch {
      /* retried by the sweep */
    }
    throw new ApiError(503, 'storage_unavailable');
  }

  const order = (await orderById(app, orderId)) as unknown as ReceiptOrder;
  const receiptEmail = await issueReceiptArtifacts(app, {
    userName: user.name,
    userEmail: user.email,
    receipt,
    order,
    kind: 'membership_join',
    subject: `Welcome, ${tierName(tier!)} supporter — receipt ${receipt}`,
  });

  const membership = await buildMembershipView(app, user);
  return { status: 201, body: JSON.stringify({ membership, order, receipt_email: receiptEmail }) };
}

async function changePlan(app: App, ctx: RouteContext, user: User): Promise<{ status: number; body: string }> {
  const body = await readJson(ctx);
  const tier = asString(body['tier']);
  if (tier === null || !TIERS.includes(tier as Tier)) throw validationFailed({ tier: 'Check the highlighted fields.' });

  const state = await membershipState(app, user);
  if (!state) throw new ApiError(409, 'not_a_member');
  const sub = await kbSubscription(app, user);
  if (!sub || sub.state === 'CANCELLED') throw new ApiError(409, 'not_a_member');
  const currentTier = tierOfPlan(sub.planName);
  const overdue = await overdueFor(app, user);
  if (overdue) throw new ApiError(409, 'payment_overdue');
  const pending = pendingChangeFromEvents(sub.events, sub.state);
  if (pending) throw new ApiError(409, 'change_pending');
  if (currentTier === tier) {
    throw new ApiError(409, 'same_tier', undefined, `You're already on the ${tierName(tier)} tier.`);
  }

  const acct = await accountCurrency(app, user);
  let orderJson: unknown = null;
  let receiptEmail: string | null = null;

  if (rank(tier) > rank(currentTier)) {
    // Upgrade: applies immediately; pay the positive balance Kill Bill invoices.
    await app.kb.changePlanImmediate(state.subscriptionId, planForTier(tier));
    let invoiceId = '';
    let balance = 0;
    const account = await accountRow(app, user);
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const invoices = await app.kb.listAccountInvoices(account.accountId);
      const open = invoices.find((inv) => inv.balance > 0.001);
      if (open) {
        invoiceId = open.invoiceId;
        balance = open.balance;
        break;
      }
    }
    const balanceMinor = Math.round(balance * (acct === 'JPY' ? 1 : 100));
    if (balanceMinor > 0 && invoiceId) {
      const card = await getCardState(app.pool, user.id);
      const decision = await decideChargeWithStoredClass(app.pool, user.id, card.outcomeClass ?? 'approved');
      if (!decision.approved) {
        // Kill Bill keeps the upgrade with its invoice unpaid: the membership is overdue.
        await startDunning(app, user, tier, acct, balanceMinor, invoiceId, 'membership_upgrade');
        const membership = await buildMembershipView(app, user);
        return {
          status: 402,
          body: JSON.stringify({ error: { code: 'card_declined', message: 'Your card was declined. You have not been charged.' }, membership }),
        };
      }
      const payment = await app.kb.payInvoice(account.accountId, invoiceId, minorToMajorString(balanceMinor, acct), acct);
      const orderId = crypto.randomUUID();
      const receipt = await recordSettlement(app, {
        id: orderId,
        userId: user.id,
        kind: 'membership_upgrade',
        description: `Supporter upgrade: ${tierName(tier)}`,
        currency: acct,
        amountMinor: balanceMinor,
        cardLast4: card.last4 ?? decision.last4,
        kbAccountId: account.accountId,
        kbInvoiceId: invoiceId,
        kbPaymentId: payment.paymentId,
      });
      const order = (await orderById(app, orderId)) as unknown as ReceiptOrder;
      receiptEmail = await issueReceiptArtifacts(app, {
        userName: user.name,
        userEmail: user.email,
        receipt,
        order,
        kind: 'membership_upgrade',
        subject: `Your supporter upgrade — receipt ${receipt}`,
      });
      orderJson = order;
    }
  } else {
    // Downgrade: scheduled at the end of the paid term.
    const chargedThrough = sub.chargedThroughDate ?? toDateIso(app.now());
    await app.kb.changePlanFuture(state.subscriptionId, planForTier(tier), chargedThrough);
  }

  const membership = await buildMembershipView(app, user);
  return { status: 200, body: JSON.stringify({ membership, order: orderJson, receipt_email: receiptEmail }) };
}

async function cancelPlan(app: App, user: User): Promise<{ status: number; body: string }> {
  const state = await membershipState(app, user);
  if (!state) throw new ApiError(409, 'not_a_member');
  const sub = await kbSubscription(app, user);
  if (!sub || sub.state === 'CANCELLED') throw new ApiError(409, 'not_a_member');
  const pending = pendingChangeFromEvents(sub.events, sub.state);
  if (pending && pending.kind === 'downgrade') throw new ApiError(409, 'change_pending');

  const overdue = await overdueFor(app, user);
  if (overdue) {
    // Cancel while overdue: immediate, and dunning stops.
    await app.kb.cancelImmediate(state.subscriptionId);
    await app.pool.query(`UPDATE dunning SET cancelled = true WHERE user_id = $1 AND settled_order_id IS NULL`, [user.id]);
  } else {
    const chargedThrough = sub.chargedThroughDate ?? toDateIso(app.now());
    await app.kb.cancelEndOfTerm(state.subscriptionId, chargedThrough);
  }
  const membership = await buildMembershipView(app, user);
  return { status: 200, body: JSON.stringify({ membership }) };
}

async function undoChange(app: App, user: User): Promise<{ status: number; body: string }> {
  const state = await membershipState(app, user);
  if (!state) throw new ApiError(409, 'not_a_member');
  const sub = await kbSubscription(app, user);
  if (!sub) throw new ApiError(409, 'not_a_member');
  const pending = pendingChangeFromEvents(sub.events, sub.state);
  if (!pending) throw new ApiError(409, 'nothing_pending');
  if (pending.kind === 'cancel') await app.kb.uncancel(state.subscriptionId);
  else await app.kb.undoChangePlan(state.subscriptionId);
  const membership = await buildMembershipView(app, user);
  return { status: 200, body: JSON.stringify({ membership }) };
}

/** A manual retry pays the unpaid invoice; exactly one attempt wins. */
async function retryPayment(app: App, user: User): Promise<{ status: number; body: string }> {
  const state = await membershipState(app, user);
  if (!state) throw new ApiError(409, 'not_a_member');

  const lockRes = await app.pool.query(
    `SELECT id, killbill_invoice_id, amount_minor, currency, tier, charge_kind FROM dunning
     WHERE user_id = $1 AND cancelled = false AND settled_order_id IS NULL LIMIT 1`,
    [user.id],
  );
  const row = lockRes.rows[0];
  if (!row) throw new ApiError(409, 'nothing_due');

  const card = await getCardState(app.pool, user.id);
  const decision = await decideChargeWithStoredClass(app.pool, user.id, card.outcomeClass ?? 'approved');
  if (!decision.approved) {
    const membership = await buildMembershipView(app, user);
    return {
      status: 402,
      body: JSON.stringify({ error: { code: 'card_declined', message: 'Your card was declined. You have not been charged.' }, membership }),
    };
  }
  const account = await accountRow(app, user);
  const invoiceId = String(row['killbill_invoice_id']);
  const amountMinor = Number(row['amount_minor']);
  const currency = String(row['currency']) as Currency;
  const tier = String(row['tier']);
  const chargeKind = String(row['charge_kind']);

  const invoices = await app.kb.listAccountInvoices(account.accountId);
  const invoice = invoices.find((i) => i.invoiceId === invoiceId);
  if (!invoice || invoice.balance <= 0.001) {
    // Another attempt already paid this invoice.
    await app.pool.query(`UPDATE dunning SET settled_order_id = COALESCE(settled_order_id, 'settled') WHERE id = $1`, [String(row['id'])]);
    const membership = await buildMembershipView(app, user);
    return {
      status: 409,
      body: JSON.stringify({ error: { code: 'nothing_due', message: "There's nothing to pay right now." }, membership }),
    };
  }
  const payment = await app.kb.payInvoice(account.accountId, invoiceId, minorToMajorString(invoice.balance, currency), currency);
  const orderId = crypto.randomUUID();
  const receipt = await recordSettlement(app, {
    id: orderId,
    userId: user.id,
    kind: chargeKind === 'membership_upgrade' ? 'membership_upgrade' : 'membership_join',
    description: chargeKind === 'membership_upgrade' ? `Supporter upgrade: ${tierName(tier)}` : `Supporter membership: ${tierName(tier)}`,
    currency,
    amountMinor,
    cardLast4: card.last4 ?? decision.last4,
    kbAccountId: account.accountId,
    kbInvoiceId: invoiceId,
    kbPaymentId: payment.paymentId,
  });
  const order = (await orderById(app, orderId)) as unknown as ReceiptOrder;
  const receiptEmail = await issueReceiptArtifacts(app, {
    userName: user.name,
    userEmail: user.email,
    receipt,
    order,
    kind: chargeKind === 'membership_upgrade' ? 'membership_upgrade' : 'membership_join',
    subject: `Your supporter upgrade — receipt ${receipt}`,
  });
  await app.pool.query(`UPDATE dunning SET settled_order_id = $2, cancelled = true WHERE id = $1`, [String(row['id']), orderId]);
  const membership = await buildMembershipView(app, user);
  return { status: 200, body: JSON.stringify({ membership, order, receipt_email: receiptEmail }) };
}

/** Start dunning after a declined charge: one row, first email, retry schedule. */
export async function startDunning(
  app: App,
  user: User,
  tier: string,
  currency: Currency,
  amountMinor: number,
  killbillInvoiceId: string,
  chargeKind: string,
): Promise<void> {
  const id = crypto.randomUUID();
  const retrySeconds = app.config.dunningRetrySeconds;
  await app.pool.query(
    `INSERT INTO dunning (id, user_id, order_id, killbill_invoice_id, killbill_payment_id, tier, currency, amount_minor,
       charge_kind, attempts, failed_at, next_retry_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,now(),now() + ($10 * interval '1 second'))`,
    [id, user.id, 'none', killbillInvoiceId, 'none', tier, currency, amountMinor, chargeKind, retrySeconds],
  );
  await app.mail.enqueue({
    toEmail: user.email,
    toName: user.name,
    subject: "Your supporter payment didn't go through",
    body: [
      `Hello ${user.name},`,
      '',
      "Your supporter payment didn't go through. Please update your card and retry the payment.",
      '',
      'Halden Reading Room',
    ].join('\n'),
    dedupeKey: `dunning:first:${user.id}:${killbillInvoiceId}`,
  });
}

async function accountRow(app: App, user: User): Promise<{ accountId: string; currency: string }> {
  const res = await app.pool.query(`SELECT account_id, currency FROM kb_accounts WHERE user_id = $1`, [user.id]);
  const row = res.rows[0];
  if (!row) throw new ApiError(503, 'billing_unavailable');
  return { accountId: String(row['account_id']), currency: String(row['currency']) };
}

async function assertStorageReachable(app: App): Promise<void> {
  await app.storage.head(`receipts/reachable-probe.txt`);
}
