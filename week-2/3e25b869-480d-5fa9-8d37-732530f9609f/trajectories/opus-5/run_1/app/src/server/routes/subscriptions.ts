import { longDateText } from '../../shared/bilingual.js';
import { ACCOUNT, BANNERS, FIELD_MESSAGES } from '../../shared/copy.js';
import { CADENCES, TRIO_SCENTS } from '../../shared/catalog.js';
import { money, trioPrice } from '../../shared/money.js';
import { startOfTorontoDay, torontoDate } from '../../shared/toronto.js';
import type { ShippingAddress } from '../../shared/types.js';
import { takeNumber } from '../db/numbers.js';
import { db, withTransaction, type Queryable } from '../db/pool.js';
import { subscriptionStartedMail } from '../email/templates.js';
import {
  billDateAfterAnchor,
  firstBillDate,
  isLocked,
  lockInstant,
  nextBillDateInSeries,
} from '../domain/subscriptions.js';
import { optional, parseBody, readLiteral, readShape } from '../http/body.js';
import type { ApiResponse, RequestContext } from '../http/context.js';
import { errors } from '../http/errors.js';
import { runIdempotent } from '../http/idempotency.js';
import { ensureKillbillAccount } from '../repo/customers.js';
import {
  loadLiveSubscriptionOf,
  loadSubscription,
  serializeSubscription,
  type SubscriptionRow,
} from '../repo/subscriptions.js';
import { noteBillingFailure } from '../services/billing-status.js';
import { BillingUnavailableError, killbill } from '../services/killbill.js';
import { enqueueNotice, wakeOutbox } from '../services/outbox.js';
import {
  recordSubscriptionInvoice,
  settleSubscriptionInvoice,
  waitForDraftInvoice,
} from '../services/subscription-billing.js';
import { SHIPPING_SHAPE } from './checkout.js';
import { requireCustomer } from './sessions.js';

const SCENT_SLUGS = TRIO_SCENTS.map((scent) => scent.slug);

const START_SHAPE = {
  scent: readLiteral(SCENT_SLUGS, FIELD_MESSAGES.scent),
  cadence: readLiteral(CADENCES, FIELD_MESSAGES.cadence_missing),
  shipping: readShape(SHIPPING_SHAPE),
} as const;

const PATCH_SHAPE = {
  scent: optional(readLiteral(SCENT_SLUGS, FIELD_MESSAGES.scent)),
  cadence: optional(readLiteral(CADENCES, FIELD_MESSAGES.cadence_missing)),
} as const;

const NO_BODY_SHAPE = {} as const;

function billingDown(error: unknown): never {
  if (error instanceof BillingUnavailableError) {
    noteBillingFailure();
    throw errors.billingUnavailable(BANNERS.subscription);
  }
  throw error;
}

function cycleLocked(date: string): never {
  throw errors.conflict('cycle_locked', ACCOUNT.cycleLocked(longDateText(date)));
}

function invalidTransition(): never {
  throw errors.conflict('invalid_transition', ACCOUNT.invalidTransition);
}

export async function startSubscription(ctx: RequestContext): Promise<ApiResponse> {
  const customer = requireCustomer(ctx);
  return runIdempotent(ctx, 'subscriptions', customer.id, async () => {
    const existing = await loadLiveSubscriptionOf(db, customer.id);
    if (existing) throw errors.conflict('subscription_exists', ACCOUNT.subscriptionExists);
    const parsed = parseBody(ctx.body, START_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    const { scent, cadence } = parsed.value;
    const shipping: ShippingAddress = parsed.value.shipping;

    try {
      const started = await withTransaction(async (client) => {
        // Starts for one customer are decided one at a time.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`trio:${customer.id}`]);
        const live = await loadLiveSubscriptionOf(client, customer.id);
        if (live) throw errors.conflict('subscription_exists', ACCOUNT.subscriptionExists);

        const number = await takeNumber(client, 'subscription');
        const accountId = await ensureKillbillAccount(client, customer, shipping.name, 'loafline');
        const subscriptionId = await killbill.createSubscription({
          accountId,
          externalKey: number,
          cadence,
          actor: 'loafline',
        });
        const draft = await waitForDraftInvoice(accountId, subscriptionId, 'loafline');
        if (!draft) throw new BillingUnavailableError('no draft invoice for the new subscription');
        const settled = await settleSubscriptionInvoice({
          accountId,
          subscriptionNumber: number,
          invoice: draft,
          province: shipping.province,
          actor: 'loafline',
        });

        const startedOn = torontoDate(new Date());
        const nextBillDate = firstBillDate(startedOn, cadence);
        await client.query(
          `INSERT INTO subscriptions (number, customer_id, locale, state, scent, cadence,
              pending_cadence, started_on, next_bill_date, skipped_bill_date, paused_from,
              bill_anchor, shipping, version, killbill_subscription_id)
           VALUES ($1, $2, $3, 'active', $4, $5, NULL, $6, $7, NULL, NULL, $6, $8, 1, $9)`,
          [
            number,
            customer.id,
            customer.locale,
            scent,
            cadence,
            startedOn,
            nextBillDate,
            JSON.stringify(shipping),
            subscriptionId,
          ],
        );
        await recordSubscriptionInvoice(client, number, settled);

        const price = trioPrice(shipping.province);
        const mail = subscriptionStartedMail(
          {
            number,
            scent,
            cadence,
            subtotal: price.subtotal,
            discount: price.discount,
            taxes: price.taxes,
            total: price.total,
            chargedToday: money(settled.chargedCents),
            nextBillDate,
          },
          customer.locale,
        );
        await enqueueNotice(client, {
          key: `subscription.${number}`,
          kind: 'subscription_started',
          recipient: customer.email,
          locale: customer.locale,
          subject: mail.subject,
          body: mail.body,
        });
        return { number, chargedCents: settled.chargedCents, totalCents: price.total.cents };
      });

      const row = await loadSubscription(db, started.number);
      if (!row) throw errors.notFound();
      wakeOutbox();
      return {
        status: 201,
        body: {
          subscription: serializeSubscription(row, new Date()),
          charged_today: money(started.chargedCents),
          credit_applied: money(started.totalCents - started.chargedCents),
        },
      };
    } catch (error) {
      billingDown(error);
    }
  });
}

async function withOwnSubscription(
  ctx: RequestContext,
  run: (client: Queryable, row: SubscriptionRow, now: Date) => Promise<SubscriptionRow>,
): Promise<ApiResponse> {
  const customer = requireCustomer(ctx);
  const number = ctx.params['number'] ?? '';
  const owned = await loadSubscription(db, number);
  if (!owned || owned.customer_id !== customer.id) throw errors.notFound();
  try {
    const updated = await withTransaction(async (client) => {
      const row = await loadSubscription(client, number, { forUpdate: true });
      if (!row || row.customer_id !== customer.id) throw errors.notFound();
      return run(client, row, new Date());
    });
    return { status: 200, body: { subscription: serializeSubscription(updated, new Date()) } };
  } catch (error) {
    billingDown(error);
  }
}

async function bumpVersion(
  client: Queryable,
  number: string,
  patch: Partial<
    Pick<
      SubscriptionRow,
      | 'state'
      | 'scent'
      | 'cadence'
      | 'pending_cadence'
      | 'next_bill_date'
      | 'skipped_bill_date'
      | 'paused_from'
      | 'bill_anchor'
    >
  >,
): Promise<SubscriptionRow> {
  const assignments: string[] = [];
  const values: unknown[] = [number];
  for (const [column, value] of Object.entries(patch)) {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }
  assignments.push('version = version + 1');
  await client.query(`UPDATE subscriptions SET ${assignments.join(', ')} WHERE number = $1`, values);
  const row = await loadSubscription(client, number);
  if (!row) throw errors.notFound();
  return row;
}

export function skipSubscription(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, NO_BODY_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  return withOwnSubscription(ctx, async (client, row, now) => {
    if (row.state !== 'active' || row.next_bill_date === null) invalidTransition();
    if (isLocked(row.next_bill_date, now)) cycleLocked(row.next_bill_date);
    if (row.skipped_bill_date !== null) {
      throw errors.conflict('already_skipped', ACCOUNT.invalidTransition);
    }
    const skipped = row.next_bill_date;
    const next = nextBillDateInSeries(row.bill_anchor, row.cadence, skipped);
    await killbill.blockSubscription({
      subscriptionId: row.killbill_subscription_id,
      stateName: 'TRIO_SKIP',
      effectiveAt: startOfTorontoDay(skipped),
      actor: 'loafline',
    });
    await killbill.blockSubscription({
      subscriptionId: row.killbill_subscription_id,
      stateName: 'TRIO_CLEAR',
      effectiveAt: startOfTorontoDay(next),
      actor: 'loafline',
    });
    return bumpVersion(client, row.number, { skipped_bill_date: skipped, next_bill_date: next });
  });
}

export function unskipSubscription(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, NO_BODY_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  return withOwnSubscription(ctx, async (client, row, now) => {
    if (row.state !== 'active') invalidTransition();
    const skipped = row.skipped_bill_date;
    if (skipped === null) throw errors.conflict('not_skipped', ACCOUNT.invalidTransition);
    if (now.getTime() >= lockInstant(skipped).getTime()) cycleLocked(skipped);
    await killbill.blockSubscription({
      subscriptionId: row.killbill_subscription_id,
      stateName: 'TRIO_CLEAR',
      effectiveAt: startOfTorontoDay(skipped),
      actor: 'loafline',
    });
    return bumpVersion(client, row.number, { skipped_bill_date: null, next_bill_date: skipped });
  });
}

export function pauseSubscription(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, NO_BODY_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  return withOwnSubscription(ctx, async (client, row, now) => {
    if (row.state !== 'active' || row.next_bill_date === null) invalidTransition();
    if (row.skipped_bill_date !== null) invalidTransition();
    if (isLocked(row.next_bill_date, now)) cycleLocked(row.next_bill_date);
    const pausedFrom = row.next_bill_date;
    await killbill.blockSubscription({
      subscriptionId: row.killbill_subscription_id,
      stateName: 'TRIO_PAUSE',
      effectiveAt: startOfTorontoDay(pausedFrom),
      actor: 'loafline',
    });
    return bumpVersion(client, row.number, {
      state: 'paused',
      paused_from: pausedFrom,
      next_bill_date: null,
    });
  });
}

export function resumeSubscription(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, NO_BODY_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  return withOwnSubscription(ctx, async (client, row, now) => {
    if (row.state !== 'paused' || row.paused_from === null) invalidTransition();
    const today = torontoDate(now);
    const pausedFrom = row.paused_from;
    const resumesEarly = today < pausedFrom;
    const clearAt = resumesEarly ? startOfTorontoDay(pausedFrom) : now;
    await killbill.blockSubscription({
      subscriptionId: row.killbill_subscription_id,
      stateName: 'TRIO_CLEAR',
      effectiveAt: clearAt,
      actor: 'loafline',
    });
    if (resumesEarly) {
      return bumpVersion(client, row.number, {
        state: 'active',
        paused_from: null,
        next_bill_date: pausedFrom,
      });
    }
    return bumpVersion(client, row.number, {
      state: 'active',
      paused_from: null,
      bill_anchor: today,
      next_bill_date: billDateAfterAnchor(today, row.cadence, 1),
    });
  });
}

export function cancelSubscription(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, NO_BODY_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  return withOwnSubscription(ctx, async (client, row, now) => {
    if (row.state !== 'active' || row.next_bill_date === null) invalidTransition();
    if (isLocked(row.next_bill_date, now)) cycleLocked(row.next_bill_date);
    await killbill.cancelSubscription({
      subscriptionId: row.killbill_subscription_id,
      requestedDate: row.next_bill_date,
      actor: 'loafline',
    });
    return bumpVersion(client, row.number, {
      state: 'cancelled',
      next_bill_date: null,
      skipped_bill_date: null,
      paused_from: null,
      pending_cadence: null,
    });
  });
}

export function patchSubscription(ctx: RequestContext): Promise<ApiResponse> {
  return withOwnSubscription(ctx, async (client, row, now) => {
    if (row.state !== 'active' || row.next_bill_date === null) invalidTransition();
    if (isLocked(row.next_bill_date, now)) cycleLocked(row.next_bill_date);
    const parsed = parseBody(ctx.body, PATCH_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    const { scent, cadence } = parsed.value;
    if (scent === undefined && cadence === undefined) {
      throw errors.invalid({ scent: FIELD_MESSAGES.scent });
    }
    if (cadence !== undefined && cadence === row.cadence) {
      throw errors.invalid({ cadence: FIELD_MESSAGES.cadence_same });
    }
    const patch: Parameters<typeof bumpVersion>[2] = {};
    if (scent !== undefined) patch.scent = scent;
    if (cadence !== undefined) {
      if (row.pending_cadence !== null) {
        await killbill.undoChangePlan(row.killbill_subscription_id, 'loafline');
      }
      await killbill.changePlan({
        subscriptionId: row.killbill_subscription_id,
        cadence,
        requestedDate: row.next_bill_date,
        actor: 'loafline',
      });
      patch.pending_cadence = cadence;
    }
    return bumpVersion(client, row.number, patch);
  });
}
