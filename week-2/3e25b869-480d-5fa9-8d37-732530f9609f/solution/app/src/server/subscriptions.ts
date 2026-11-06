// Trio subscriptions: one per customer, the bill-date series, the lock window and the state machine,
// each change mirrored in Kill Bill as a blocking state or a dated plan event.
import type pg from 'pg';
import { CADENCE_MONTHS, CADENCES, type Cadence, CORE_SCENTS, type Locale } from '../shared/catalog.js';
import { centsFromDecimal, money, trioPrice } from '../shared/money.js';
import { addMonths, longDate, torontoDate, torontoMidnight } from '../shared/toronto.js';
import { type Customer, requireCustomer } from './auth.js';
import { object, oneOf, optional, read, shippingAddress } from './body.js';
import { customerAccount } from './checkout.js';
import { config } from './config.js';
import { type Db, pool, takeSequenceNumber, tx } from './db.js';
import { subscriptionNotice } from './emails.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { type Ctx, type Reply, route } from './http.js';
import { idempotent } from './idempotency.js';
import * as kb from './killbill.js';
import type { Shipping } from './orders.js';
import { drain, enqueue } from './outbox.js';

type SubState = 'active' | 'paused' | 'cancelled';

interface SubRow {
  number: string;
  customer_id: number;
  state: SubState;
  scent: string;
  cadence: Cadence;
  pending_cadence: Cadence | null;
  started_on: string;
  anchor_date: string;
  next_bill_date: string | null;
  skipped_bill_date: string | null;
  paused_from: string | null;
  shipping: Shipping;
  locale: Locale;
  version: number;
  kb_subscription_id: string;
}

/** The first date of the bill-date series (anchored on `anchor`, stepping by `cadence`) strictly after `after`. */
function nextBillAfter(anchor: string, cadence: Cadence, after: string): string {
  const day = Number(anchor.slice(8, 10));
  for (let step = 1; ; step += 1) {
    const date = addMonths(anchor, step * CADENCE_MONTHS[cadence], day);
    if (date > after) return date;
  }
}

/** A bill date locks SUBSCRIPTION_LOCK_HOURS elapsed hours before its 00:00 Toronto. */
function locksAt(billDate: string): Date {
  return new Date(torontoMidnight(billDate).getTime() - config.subscriptionLockHours * 3_600_000);
}
const isLocked = (billDate: string, now: Date) => now >= locksAt(billDate);

export function subscriptionJson(sub: SubRow, now: Date) {
  const lock = sub.next_bill_date ? locksAt(sub.next_bill_date) : null;
  return {
    number: sub.number,
    state: sub.state,
    scent: sub.scent,
    cadence: sub.cadence,
    pending_cadence: sub.pending_cadence,
    started_on: sub.started_on,
    next_bill_date: sub.next_bill_date,
    skipped_bill_date: sub.skipped_bill_date,
    paused_from: sub.paused_from,
    locks_at: lock ? lock.toISOString() : null,
    locked: sub.next_bill_date ? isLocked(sub.next_bill_date, now) : false,
    shipping: sub.shipping,
    price: trioPrice(sub.shipping.province),
    version: sub.version,
  };
}

export async function findSubscription(db: Db | pg.Pool, number: string, lock = false): Promise<SubRow | undefined> {
  return db.query<SubRow>(`SELECT * FROM subscriptions WHERE number = $1${lock ? ' FOR UPDATE' : ''}`, [number]).then((r) => r.rows[0]);
}

const billingDown = (ctx: Ctx) => new ApiError(503, 'billing_unavailable', ctx.m.bannerSubscriptions);

/** Commits a subscription's draft invoice with its tax items and pays the rest, keyed `<sub>-<date>`. */
async function billDraft(db: Db, sub: SubRow, accountId: string, date: string): Promise<{ total: number; charged: number }> {
  const draft = await kb.draftInvoiceFor(accountId, sub.kb_subscription_id);
  if (!draft) throw new kb.BillingUnavailable(`no draft invoice for ${sub.number}`);
  const price = trioPrice(sub.shipping.province);
  const committed = await kb.finishInvoice(
    accountId,
    draft.invoiceId,
    price.taxes.map((t) => ({ code: t.code, cents: t.amount.cents })),
  );
  const charged = centsFromDecimal(committed.balance);
  const key = `${sub.number}-${date}`;
  const paymentId = charged > 0 ? await kb.payInvoice(accountId, committed.invoiceId, charged, key) : null;
  await db.query(
    `INSERT INTO subscription_charges (payment_key, subscription, bill_date, kb_invoice_id, kb_payment_id, total_cents)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [key, sub.number, date, committed.invoiceId, paymentId, price.total.cents],
  );
  return { total: price.total.cents, charged };
}

const startBody = object({
  scent: oneOf(
    CORE_SCENTS.map((s) => s.slug),
    (m) => m.fields.scent,
  ),
  cadence: oneOf(CADENCES, (m) => m.fields.cadence),
  shipping: shippingAddress,
});

const CUSTOMER_LOCK = 7340200;

route('POST', '/api/subscriptions', async (ctx) => {
  const customer = await requireCustomer(ctx);
  return idempotent(ctx, `subscribe:${customer.id}`, async () => {
    const reply = await tx(async (db): Promise<Reply> => {
      await db.query('SELECT pg_advisory_xact_lock($1, $2)', [CUSTOMER_LOCK, customer.id]);
      const existing = (await db.query(`SELECT 1 FROM subscriptions WHERE customer_id = $1 AND state IN ('active','paused')`, [customer.id])).rows[0];
      if (existing) throw conflict('subscription_exists', ctx.m.subscription_exists);
      const body = read(startBody, ctx.body, ctx.m);
      const number = await takeSequenceNumber('SUB');
      const startedOn = torontoDate(ctx.now);
      const nextBill = nextBillAfter(startedOn, body.cadence, startedOn);
      let billed: { total: number; charged: number };
      let kbSubscriptionId: string;
      try {
        const accountId = await customerAccount(customer, body.shipping);
        kbSubscriptionId = await kb.createSubscription(accountId, body.cadence, number);
        await db.query(
          `INSERT INTO subscriptions (number, customer_id, state, scent, cadence, started_on, anchor_date, next_bill_date, shipping,
             locale, version, kb_subscription_id)
           VALUES ($1,$2,'active',$3,$4,$5,$5,$6,$7,$8,1,$9)`,
          [number, customer.id, body.scent, body.cadence, startedOn, nextBill, JSON.stringify(body.shipping), ctx.locale, kbSubscriptionId],
        );
        const sub = (await findSubscription(db, number)) as SubRow;
        billed = await billDraft(db, sub, accountId, startedOn);
      } catch (error) {
        if (error instanceof kb.BillingUnavailable) throw billingDown(ctx);
        throw error;
      }
      const sub = (await findSubscription(db, number)) as SubRow;
      const price = trioPrice(body.shipping.province);
      await enqueue(
        db,
        subscriptionNotice({
          number,
          email: customer.email,
          locale: ctx.locale,
          scent: body.scent,
          cadence: body.cadence,
          subtotal: price.subtotal.cents,
          discount: price.discount.cents,
          taxes: price.taxes,
          total: price.total.cents,
          chargedToday: billed.charged,
          nextBillDate: nextBill,
        }),
        ctx.now,
      );
      return {
        status: 201,
        body: {
          subscription: subscriptionJson(sub, ctx.now),
          charged_today: money(billed.charged),
          credit_applied: money(billed.total - billed.charged),
        },
      };
    });
    void drain();
    return reply;
  });
});

async function ownSubscription(ctx: Ctx, db: Db | pg.Pool, customer: Customer, lock: boolean): Promise<SubRow> {
  const sub = await findSubscription(db, ctx.params.number ?? '', lock);
  if (!sub || sub.customer_id !== customer.id) throw notFound(ctx.m);
  return sub;
}

route('GET', '/api/account/subscriptions/{number}', async (ctx) => {
  const customer = await requireCustomer(ctx);
  return { status: 200, body: subscriptionJson(await ownSubscription(ctx, pool, customer, false), ctx.now) };
});

const invalidTransition = (ctx: Ctx) => conflict('invalid_transition', ctx.m.invalid_transition_sub);
const cycleLocked = (ctx: Ctx, billDate: string) => conflict('cycle_locked', ctx.m.cycle_locked(longDate(billDate, ctx.locale)));

interface Change {
  /** 409 checks: the state machine, then the lock window. */
  guard(ctx: Ctx, sub: SubRow): void;
  /** Mirrors the change in Kill Bill and returns the new columns. */
  apply(ctx: Ctx, db: Db, sub: SubRow, customer: Customer): Promise<Partial<SubRow>>;
}

function guardLock(ctx: Ctx, billDate: string | null): void {
  if (billDate && isLocked(billDate, ctx.now)) throw cycleLocked(ctx, billDate);
}

const changes: Record<'skip' | 'unskip' | 'pause' | 'resume' | 'cancel', Change> = {
  skip: {
    guard(ctx, sub) {
      if (sub.state !== 'active') throw invalidTransition(ctx);
      guardLock(ctx, sub.next_bill_date);
      if (sub.skipped_bill_date) throw conflict('already_skipped', ctx.m.alreadySkipped);
    },
    async apply(_ctx, _db, sub) {
      const skipped = sub.next_bill_date as string;
      const next = nextBillAfter(sub.anchor_date, sub.cadence, skipped);
      await kb.block(sub.kb_subscription_id, 'TRIO_SKIP', torontoMidnight(skipped));
      await kb.block(sub.kb_subscription_id, 'TRIO_CLEAR', torontoMidnight(next));
      return { skipped_bill_date: skipped, next_bill_date: next };
    },
  },
  unskip: {
    guard(ctx, sub) {
      if (sub.state !== 'active') throw invalidTransition(ctx);
      if (!sub.skipped_bill_date) throw conflict('not_skipped', ctx.m.notSkipped);
      guardLock(ctx, sub.skipped_bill_date);
    },
    async apply(_ctx, _db, sub) {
      const skipped = sub.skipped_bill_date as string;
      await kb.block(sub.kb_subscription_id, 'TRIO_CLEAR', torontoMidnight(skipped));
      return { skipped_bill_date: null, next_bill_date: skipped };
    },
  },
  pause: {
    guard(ctx, sub) {
      if (sub.state !== 'active' || sub.skipped_bill_date) throw invalidTransition(ctx);
      guardLock(ctx, sub.next_bill_date);
    },
    async apply(_ctx, _db, sub) {
      const from = sub.next_bill_date as string;
      await kb.block(sub.kb_subscription_id, 'TRIO_PAUSE', torontoMidnight(from));
      return { state: 'paused', paused_from: from, next_bill_date: null };
    },
  },
  resume: {
    guard(ctx, sub) {
      if (sub.state !== 'paused') throw invalidTransition(ctx);
    },
    async apply(ctx, db, sub, customer) {
      const from = sub.paused_from as string;
      const today = torontoDate(ctx.now);
      if (today < from) {
        await kb.block(sub.kb_subscription_id, 'TRIO_CLEAR', torontoMidnight(from));
        return { state: 'active', paused_from: null, next_bill_date: from };
      }
      await kb.block(sub.kb_subscription_id, 'TRIO_CLEAR', ctx.now);
      await billDraft(db, sub, customer.kb_account_id as string, today);
      return { state: 'active', paused_from: null, anchor_date: today, next_bill_date: nextBillAfter(today, sub.cadence, today) };
    },
  },
  cancel: {
    guard(ctx, sub) {
      if (sub.state !== 'active') throw invalidTransition(ctx);
      guardLock(ctx, sub.next_bill_date);
    },
    async apply(_ctx, _db, sub) {
      await kb.cancel(sub.kb_subscription_id, sub.next_bill_date as string);
      return { state: 'cancelled', next_bill_date: null, skipped_bill_date: null, pending_cadence: null };
    },
  },
};

const UPDATABLE = ['state', 'cadence', 'pending_cadence', 'scent', 'anchor_date', 'next_bill_date', 'skipped_bill_date', 'paused_from'] as const;

async function update(db: Db, number: string, columns: Partial<SubRow>): Promise<SubRow> {
  const names = UPDATABLE.filter((name) => name in columns);
  const sets = names.map((name, i) => `${name} = $${i + 2}`);
  const values = names.map((name) => columns[name]);
  const updated = await db.query(
    `UPDATE subscriptions SET ${[...sets, 'version = version + 1'].join(', ')} WHERE number = $1 RETURNING *`,
    [number, ...values],
  );
  return updated.rows[0] as SubRow;
}

const emptyBody = object({});

for (const [action, change] of Object.entries(changes)) {
  route('POST', `/api/account/subscriptions/{number}/${action}`, async (ctx) => {
    const customer = await requireCustomer(ctx);
    const sub = await tx(async (db) => {
      const current = await ownSubscription(ctx, db, customer, true);
      change.guard(ctx, current);
      read(emptyBody, ctx.body, ctx.m);
      try {
        return await update(db, current.number, await change.apply(ctx, db, current, customer));
      } catch (error) {
        if (error instanceof kb.BillingUnavailable) throw billingDown(ctx);
        throw error;
      }
    });
    return { status: 200, body: { subscription: subscriptionJson(sub, ctx.now) } };
  });
}

const patchBody = object({
  scent: optional(
    oneOf(
      CORE_SCENTS.map((s) => s.slug),
      (m) => m.fields.scent,
    ),
  ),
  cadence: optional(oneOf(CADENCES, (m) => m.fields.cadence)),
});

route('PATCH', '/api/account/subscriptions/{number}', async (ctx) => {
  const customer = await requireCustomer(ctx);
  const sub = await tx(async (db) => {
    const current = await ownSubscription(ctx, db, customer, true);
    if (current.state !== 'active') throw invalidTransition(ctx);
    guardLock(ctx, current.next_bill_date);
    const body = read(patchBody, ctx.body, ctx.m);
    if (body.scent === undefined && body.cadence === undefined) throw invalid(ctx.m, { scent: ctx.m.fields.scent });
    if (body.cadence === current.cadence) throw invalid(ctx.m, { cadence: ctx.m.fields.cadenceSame });
    const columns: Partial<SubRow> = {};
    if (body.scent !== undefined) columns.scent = body.scent;
    if (body.cadence !== undefined) {
      try {
        await kb.changePlan(current.kb_subscription_id, body.cadence, current.next_bill_date as string, current.pending_cadence !== null);
      } catch (error) {
        if (error instanceof kb.BillingUnavailable) throw billingDown(ctx);
        throw error;
      }
      columns.pending_cadence = body.cadence;
    }
    return update(db, current.number, columns);
  });
  return { status: 200, body: { subscription: subscriptionJson(sub, ctx.now) } };
});

const RENEWAL_LOCK = 7340003;

/** Bills every active Trio whose bill date has come, one subscription per transaction, applying a pending cadence. */
async function renew(): Promise<void> {
  const today = torontoDate(new Date());
  await pool.query(`UPDATE subscriptions SET skipped_bill_date = NULL WHERE skipped_bill_date <= $1`, [today]);
  const due = (await pool.query<{ number: string }>(`SELECT number FROM subscriptions WHERE state = 'active' AND next_bill_date <= $1`, [today])).rows;
  for (const { number } of due) {
    await tx(async (db) => {
      const lock = (await db.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS ok', [RENEWAL_LOCK, number])).rows[0];
      const sub = lock?.ok ? await findSubscription(db, number, true) : undefined;
      if (!sub || sub.state !== 'active' || !sub.next_bill_date || sub.next_bill_date > today) return;
      const account = (await db.query<{ kb_account_id: string }>('SELECT kb_account_id FROM customers WHERE id = $1', [sub.customer_id])).rows[0];
      const billDate = sub.next_bill_date;
      const cadence = sub.pending_cadence ?? sub.cadence;
      const anchor = sub.pending_cadence ? billDate : sub.anchor_date;
      await billDraft(db, sub, account?.kb_account_id as string, billDate);
      await update(db, sub.number, { cadence, pending_cadence: null, anchor_date: anchor, next_bill_date: nextBillAfter(anchor, cadence, billDate) });
    }).catch((error: Error) => console.error(`renewal ${number}: ${error.message}`));
  }
}

export function startRenewals(): void {
  setInterval(() => void renew(), 60_000).unref();
}
