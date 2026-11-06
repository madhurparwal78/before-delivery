// Refunds of chosen bars with the published allocation, and goodwill credits within the cap.
// Both name the record version the staff member saw.
import { province } from '../shared/catalog.js';
import { applyRate, money, type TaxLine } from '../shared/money.js';
import { writeAudit } from './audit.js';
import { allow, requireStaff, type Staff } from './auth.js';
import { settleSoldOut } from './batches.js';
import { boolean, integer, list, object, read, text } from './body.js';
import { type Db, nextNumber, pool, tx } from './db.js';
import { creditNotice, refundNotice } from './emails.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { type Ctx, route } from './http.js';
import { idempotent } from './idempotency.js';
import * as kb from './killbill.js';
import { barKey, type LoadedOrder, loadOrder, orderJson, refundedBars, type RefundRow } from './orders.js';
import { drain, enqueue } from './outbox.js';
import { creditJson, refundJson } from './staff.js';
import { findSubscription } from './subscriptions.js';

/** 428 without If-Match, 412 unless it names the record's current version. */
function checkVersion(ctx: Ctx, version: number): void {
  const header = ctx.req.headers['if-match'];
  if (header === undefined) throw new ApiError(428, 'precondition_required', ctx.m.preconditionRequired);
  if (header.replace(/^W\//, '').replace(/"/g, '').trim() !== String(version)) {
    throw new ApiError(412, 'stale_version', ctx.m.stale_version);
  }
}

interface Allocation {
  bars: number;
  shipping: number;
  taxes: TaxLine[];
}

/**
 * The refund allocation. A final refund (covering the order's last unrefunded bars) returns the shipping
 * and each tax line minus every earlier issued refund's share; any other refund applies each tax rate to its bars.
 */
function allocate(loaded: LoadedOrder, barCents: number, final: boolean): Allocation {
  const { order, refunds } = loaded;
  const issued = refunds.filter((r) => r.status === 'issued');
  const rates = province(order.shipping.province)?.taxes ?? [];
  const taxes = order.taxes.map((line) => {
    const cents = final
      ? line.amount.cents - issued.reduce((sum, r) => sum + (r.allocation.taxes.find((t) => t.code === line.code)?.amount.cents ?? 0), 0)
      : applyRate(barCents, rates.find((r) => r.code === line.code)?.rate ?? 0);
    return { code: line.code, rate: line.rate, amount: money(cents) };
  });
  return { bars: barCents, shipping: final ? order.shipping_cents : 0, taxes };
}

const sumAllocation = (a: Allocation) => a.bars + a.shipping + a.taxes.reduce((sum, t) => sum + t.amount.cents, 0);

const refundBody = object({
  bars: list(
    object({ batch: text((m) => m.fields.refundBars, 1, 20), bar: integer(1, 24, (m) => m.fields.refundBars) }),
    (m) => m.fields.refundBars,
  ),
  restock: boolean((m) => m.fields.cantSet),
  reason: text((m) => m.fields.reason, 3, 500),
});

route('POST', '/api/staff/orders/{number}/refunds', async (ctx) => {
  const staff = await requireStaff(ctx);
  const number = ctx.params.number ?? '';
  if (!((await pool.query('SELECT 1 FROM orders WHERE number = $1', [number])).rows[0])) throw notFound(ctx.m);
  allow(ctx, staff, 'money');
  return idempotent(ctx, `refund:${staff.id}:${number}`, async () => {
    const outcome = await tx(async (db) => {
      const loaded = (await loadOrder(db, number, true)) as LoadedOrder;
      checkVersion(ctx, loaded.order.version);
      const done = refundedBars(loaded.refunds);
      const raw = (ctx.body as { bars?: unknown } | null)?.bars;
      const named = Array.isArray(raw) ? (raw as { batch?: unknown; bar?: unknown }[]) : [];
      if (named.some((b) => done.has(barKey(String(b?.batch), Number(b?.bar))))) throw conflict('already_refunded', ctx.m.alreadyRefunded);
      const body = read(refundBody, ctx.body, ctx.m);
      const owned = new Set(loaded.lines.map((l) => barKey(l.batch_code, l.bar)));
      const keys = new Set(body.bars.map((b) => barKey(b.batch, b.bar)));
      if (keys.size !== body.bars.length || [...keys].some((k) => !owned.has(k))) throw invalid(ctx.m, { bars: ctx.m.fields.refundBars });
      if (body.restock) {
        const withdrawn = (await db.query(`SELECT 1 FROM batches WHERE code = ANY($1) AND state = 'withdrawn'`, [body.bars.map((b) => b.batch)])).rows[0];
        if (withdrawn) throw invalid(ctx.m, { restock: ctx.m.fields.restock });
      }
      const lines = loaded.lines.filter((l) => keys.has(barKey(l.batch_code, l.bar)));
      const final = done.size + keys.size === loaded.lines.length;
      const allocation = allocate(loaded, lines.reduce((sum, l) => sum + l.unit_cents, 0), final);
      const amount = sumAllocation(allocation);
      const rf = await nextNumber(db, 'RF');
      const items = loaded.order.kb_items;
      let ref: string | null = null;
      try {
        ref = await kb.refundInvoicePayment(
          loaded.order.kb_payment_id,
          amount,
          [
            ...lines.map((l) => ({ invoiceItemId: items.bars[barKey(l.batch_code, l.bar)] ?? '', cents: l.unit_cents })),
            ...(final ? [{ invoiceItemId: items.shipping, cents: allocation.shipping }] : []),
            ...allocation.taxes.map((t) => ({ invoiceItemId: items.taxes[t.code] ?? '', cents: t.amount.cents })),
          ].filter((a) => a.cents > 0),
          rf,
          staff.email,
        );
      } catch (error) {
        if (!(error instanceof kb.BillingUnavailable)) throw error;
      }
      const issued = ref !== null;
      const recorded = issued ? allocation : { bars: 0, shipping: 0, taxes: allocation.taxes.map((t) => ({ ...t, amount: money(0) })) };
      const refunded = await db.query(
        `INSERT INTO refunds (number, order_number, status, bars, restock, amount_cents, allocation, reason, killbill_ref, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [rf, number, issued ? 'issued' : 'failed', JSON.stringify(body.bars), body.restock, issued ? amount : 0, JSON.stringify(recorded), body.reason, ref, ctx.now],
      );
      const refund = refunded.rows[0] as RefundRow;
      const status = !issued ? loaded.order.status : final ? 'refunded' : 'partially_refunded';
      await db.query('UPDATE orders SET status = $2, version = version + 1 WHERE number = $1', [number, status]);
      const audit = { action: 'refund' as const, target: number, reason: body.reason, amount_cents: refund.amount_cents, killbill_ref: ref };
      await writeAudit(db, staff, { ...audit, outcome: issued ? 'issued' : 'failed' }, ctx.now);
      if (!issued) return { failed: rf };
      if (body.restock) {
        for (const code of [...new Set(lines.map((l) => l.batch_code))]) {
          const bars = lines.filter((l) => l.batch_code === code).map((l) => l.bar);
          await db.query(`INSERT INTO movements (batch_code, kind, bars, ref, at) VALUES ($1,'restock',$2,$3,$4)`, [code, bars, rf, ctx.now]);
          await settleSoldOut(db, code, ctx.now);
        }
      }
      await enqueue(
        db,
        refundNotice(
          { number: rf, order: number, bars: lines.map((l) => ({ batch: l.batch_code, scent: l.scent, bar: l.bar })), amount },
          loaded.order.email,
          loaded.order.locale,
        ),
        ctx.now,
      );
      return { refund: refundJson(refund), order: orderJson((await loadOrder(db, number)) as LoadedOrder) };
    });
    if ('failed' in outcome) throw new ApiError(503, 'billing_unavailable', ctx.m.refundFailed(outcome.failed as string));
    void drain();
    return { status: 201, body: outcome };
  });
});

const creditBody = object({
  target: text((m) => m.fields.cantSet, 1, 20),
  amount_cents: integer(100, 2500, (m) => m.fields.amount_cents),
  reason: text((m) => m.fields.reason, 3, 500),
});

interface CreditTarget {
  customerId: number;
  version: number;
  locale: string;
}

async function lockTarget(db: Db, target: string): Promise<CreditTarget | undefined> {
  if (target.startsWith('PDL-')) {
    const order = (await db.query<{ customer_id: number; version: number; locale: string }>('SELECT customer_id, version, locale FROM orders WHERE number = $1 FOR UPDATE',
      [target],
    )).rows[0];
    return order && { customerId: order.customer_id, version: order.version, locale: order.locale };
  }
  const sub = await findSubscription(db, target, true);
  return sub && { customerId: sub.customer_id, version: sub.version, locale: sub.locale };
}

route('POST', '/api/staff/credits', async (ctx) => {
  const staff: Staff = await requireStaff(ctx);
  const target = String((ctx.body as { target?: unknown } | null)?.target ?? '');
  const exists = await tx((db) => lockTarget(db, target));
  if (!exists) throw notFound(ctx.m);
  allow(ctx, staff, 'money');
  return idempotent(ctx, `credit:${staff.id}`, async () => {
    const outcome = await tx(async (db) => {
      const locked = (await lockTarget(db, target)) as CreditTarget;
      checkVersion(ctx, locked.version);
      const body = read(creditBody, ctx.body, ctx.m);
      const customer = (await db.query<{ email: string; kb_account_id: string }>('SELECT email, kb_account_id FROM customers WHERE id = $1', [
        locked.customerId,
      ])).rows[0];
      const cr = await nextNumber(db, 'CR');
      let ref: string | null = null;
      try {
        ref = await kb.addCredit(customer?.kb_account_id ?? '', body.amount_cents, cr, staff.email);
      } catch (error) {
        if (!(error instanceof kb.BillingUnavailable)) throw error;
      }
      const issued = ref !== null;
      const created = await db.query(
        `INSERT INTO credits (number, target, customer_id, status, amount_cents, reason, killbill_ref, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [cr, target, locked.customerId, issued ? 'issued' : 'failed', body.amount_cents, body.reason, ref, ctx.now],
      );
      await db.query(`UPDATE ${target.startsWith('PDL-') ? 'orders' : 'subscriptions'} SET version = version + 1 WHERE number = $1`, [target]);
      await writeAudit(
        db,
        staff,
        { action: 'credit', target, reason: body.reason, amount_cents: body.amount_cents, killbill_ref: ref, outcome: issued ? 'issued' : 'failed' },
        ctx.now,
      );
      if (!issued) return { failed: cr };
      await enqueue(db, creditNotice(cr, body.amount_cents, customer?.email ?? '', locked.locale === 'fr-CA' ? 'fr-CA' : 'en-CA'), ctx.now);
      return { credit: creditJson(created.rows[0]) };
    });
    if ('failed' in outcome) throw new ApiError(503, 'billing_unavailable', ctx.m.creditFailed(outcome.failed as string));
    void drain();
    return { status: 201, body: outcome };
  });
});
