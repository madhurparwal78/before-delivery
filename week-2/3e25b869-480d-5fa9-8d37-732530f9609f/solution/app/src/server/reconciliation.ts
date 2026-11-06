// Reconciliation: each Toronto month's shop records against Kill Bill, with snapshots for outages.
import { centsFromDecimal, money, type Money } from '../shared/money.js';
import { monthEdges, torontoMonth } from '../shared/toronto.js';
import { writeAudit } from './audit.js';
import { allow, requireStaff } from './auth.js';
import { object, read, text } from './body.js';
import { type Db, pool, tx } from './db.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { type Ctx, route } from './http.js';
import * as kb from './killbill.js';

type LineKind = 'order' | 'subscription' | 'credit' | 'payment';
type LineStatus = 'match' | 'mismatch' | 'shop_only' | 'kb_only' | 'accepted' | 'refunded';

interface Line {
  key: string;
  kind: LineKind;
  shop: Money | null;
  killbill: Money | null;
  status: LineStatus;
}

/** A line with the Kill Bill object it was read from. */
interface ComputedLine extends Line {
  ref: string | null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

function compare(key: string, kind: LineKind, shop: number, kbCents: number | null, ref: string | null, accepted: Set<string>): ComputedLine {
  const status: LineStatus = kbCents === null ? 'shop_only' : shop !== kbCents ? 'mismatch' : accepted.has(key) ? 'accepted' : 'match';
  return { key, kind, shop: money(shop), killbill: kbCents === null ? null : money(kbCents), status, ref };
}

/** Every line of a Toronto month, read fresh from Kill Bill; throws BillingUnavailable when it cannot be reached. */
async function computeMonth(month: string): Promise<ComputedLine[]> {
  const [start, end] = monthEdges(month);
  const deltas = (await pool.query<{ key: string; delta: number }>('SELECT key, sum(delta_cents)::int AS delta FROM reconciliation_accepts GROUP BY key')).rows;
  const delta = (key: string) => deltas.find((d) => d.key === key)?.delta ?? 0;
  const accepted = new Set(deltas.map((d) => d.key));
  const payments = await kb.allPayments();
  const byKey = new Map(payments.map((p) => [p.paymentExternalKey, p]));
  const lines: ComputedLine[] = [];

  const orders = (await pool.query<{ number: string; total_cents: number; refunded: number }>(`SELECT o.number, o.total_cents, coalesce((SELECT sum(r.amount_cents) FROM refunds r WHERE r.order_number = o.number AND r.status = 'issued'), 0)::int AS refunded
     FROM orders o WHERE o.placed_at >= $1 AND o.placed_at < $2`,
    [start, end],
  )).rows;
  for (const o of orders) {
    const key = `order:${o.number}`;
    const paid = byKey.get(o.number);
    lines.push(compare(key, 'order', o.total_cents - o.refunded + delta(key), paid ? kb.netCents(paid) : null, paid?.paymentId ?? null, accepted));
  }

  const charges = (await pool.query<{ subscription: string; bill_date: string; kb_invoice_id: string; total_cents: number }>(`SELECT subscription, bill_date, kb_invoice_id, total_cents FROM subscription_charges WHERE bill_date >= $1 AND bill_date < $2`,
    [`${month}-01`, `${torontoMonth(end)}-01`],
  )).rows;
  const invoices = await inBatches(charges, 8, (c) => kb.invoice(c.kb_invoice_id));
  charges.forEach((c, i) => {
    const key = `subscription:${c.subscription}:${c.bill_date}`;
    const amount = invoices[i]?.amount;
    lines.push(compare(key, 'subscription', c.total_cents + delta(key), amount ? centsFromDecimal(amount) : null, c.kb_invoice_id, accepted));
  });

  const credits = (await pool.query<{ number: string; amount_cents: number; killbill_ref: string }>(`SELECT number, amount_cents, killbill_ref FROM credits WHERE status = 'issued' AND created_at >= $1 AND created_at < $2`,
    [start, end],
  )).rows;
  const creditAmounts = await inBatches(credits, 8, (c) => kb.creditCents(c.killbill_ref));
  credits.forEach((c, i) => {
    const key = `credit:${c.number}`;
    lines.push(compare(key, 'credit', c.amount_cents + delta(key), creditAmounts[i] ?? null, c.killbill_ref, accepted));
  });

  const accounts = new Set(((await pool.query<{ kb_account_id: string }>('SELECT kb_account_id FROM customers WHERE kb_account_id IS NOT NULL')).rows).map((a) => a.kb_account_id));
  const shopKeys = new Set([
    ...((await pool.query<{ number: string }>('SELECT number FROM orders')).rows).map((o) => o.number),
    ...((await pool.query<{ payment_key: string }>('SELECT payment_key FROM subscription_charges')).rows).map((c) => c.payment_key),
  ]);
  const refundedOrphans = new Set(((await pool.query<{ payment_id: string }>('SELECT payment_id FROM orphan_refunds')).rows).map((r) => r.payment_id));
  for (const p of payments) {
    const purchase = p.transactions.find((t) => t.transactionType === 'PURCHASE' && t.status === 'SUCCESS');
    if (!purchase || !accounts.has(p.accountId) || shopKeys.has(p.paymentExternalKey)) continue;
    if (torontoMonth(new Date(purchase.effectiveDate)) !== month) continue;
    lines.push({
      key: `payment:${p.paymentId}`,
      kind: 'payment',
      shop: null,
      killbill: money(kb.netCents(p)),
      status: refundedOrphans.has(p.paymentId) ? 'refunded' : 'kb_only',
      ref: p.paymentId,
    });
  }
  return lines.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const publicLine = ({ ref: _ref, ...line }: ComputedLine): Line => line;
const sum = (values: (Money | null)[]) => money(values.reduce((total, v) => total + (v?.cents ?? 0), 0));

function monthOf(ctx: Ctx, value: string | null): string {
  const month = value ?? torontoMonth(ctx.now);
  if (!MONTH.test(month)) throw invalid(ctx.m, { month: ctx.m.fields.month });
  return month;
}

route('GET', '/api/staff/reconciliation', async (ctx) => {
  allow(ctx, await requireStaff(ctx), 'books');
  const month = monthOf(ctx, ctx.query.get('month'));
  let lines: Line[];
  let checkedAt: Date | null;
  let stale = false;
  try {
    lines = (await computeMonth(month)).map(publicLine);
    checkedAt = new Date();
    await pool.query(
      `INSERT INTO reconciliation_snapshots (month, checked_at, lines) VALUES ($1,$2,$3)
       ON CONFLICT (month) DO UPDATE SET checked_at = EXCLUDED.checked_at, lines = EXCLUDED.lines`,
      [month, checkedAt, JSON.stringify(lines)],
    );
  } catch (error) {
    if (!(error instanceof kb.BillingUnavailable)) throw error;
    stale = true;
    const snapshot = (await pool.query<{ checked_at: Date; lines: Line[] }>('SELECT checked_at, lines FROM reconciliation_snapshots WHERE month = $1', [month])).rows[0];
    lines = snapshot?.lines ?? [];
    checkedAt = snapshot?.checked_at ?? null;
  }
  return {
    status: 200,
    body: {
      month,
      stale,
      checked_at: checkedAt ? checkedAt.toISOString() : null,
      lines,
      totals: { shop: sum(lines.map((l) => l.shop)), killbill: sum(lines.map((l) => l.killbill)) },
    },
  };
});

const actionBody = object({ month: text((m) => m.fields.month, 7, 7), key: text((m) => m.fields.cantSet, 1, 200) });

/** Reads the month fresh for an action; 503 while Kill Bill cannot be reached, 404 for an unknown key. */
async function freshLine(ctx: Ctx): Promise<{ line: ComputedLine; month: string }> {
  const body = read(actionBody, ctx.body, ctx.m);
  const month = monthOf(ctx, body.month);
  let lines: ComputedLine[];
  try {
    lines = await computeMonth(month);
  } catch (error) {
    if (error instanceof kb.BillingUnavailable) throw new ApiError(503, 'billing_unavailable', ctx.m.billingOther);
    throw error;
  }
  const line = lines.find((l) => l.key === body.key);
  if (!line) throw notFound(ctx.m);
  return { line, month };
}

route('POST', '/api/staff/reconciliation/accept', async (ctx) => {
  const staff = await requireStaff(ctx);
  allow(ctx, staff, 'books');
  const acceptedSoFar = async (db: Db | typeof pool, key: string) =>
    ((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM reconciliation_accepts WHERE key = $1', [key])).rows[0])?.n ?? 0;
  const key = String((ctx.body as { key?: unknown } | null)?.key ?? '');
  const before = await acceptedSoFar(pool, key);
  const { line } = await freshLine(ctx);
  if (line.status !== 'mismatch') throw conflict('line_not_mismatched', ctx.m.lineNotMismatched);
  const kbCents = line.killbill?.cents ?? 0;
  const deltaCents = kbCents - (line.shop?.cents ?? 0);
  const audit = await tx(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(7340300, hashtext($1))', [line.key]);
    if ((await acceptedSoFar(db, line.key)) !== before) throw conflict('line_not_mismatched', ctx.m.lineNotMismatched);
    await db.query('INSERT INTO reconciliation_accepts (key, delta_cents, at) VALUES ($1,$2,$3)', [line.key, deltaCents, ctx.now]);
    return writeAudit(
      db,
      staff,
      { action: 'reconciliation_accept', target: line.key, reason: 'Accepted Kill Bill figure', amount_cents: deltaCents, killbill_ref: line.ref, outcome: 'issued' },
      ctx.now,
    );
  });
  return { status: 200, body: { line: { ...publicLine(line), shop: money(kbCents), status: 'accepted' }, audit } };
});

route('POST', '/api/staff/reconciliation/refund-orphan', async (ctx) => {
  const staff = await requireStaff(ctx);
  allow(ctx, staff, 'books');
  const { line } = await freshLine(ctx);
  if (line.status !== 'kb_only') throw conflict('line_not_orphan', ctx.m.lineNotOrphan);
  const claimed = (await pool.query('INSERT INTO orphan_refunds (payment_id, amount_cents, killbill_ref, at) VALUES ($1,$2,NULL,$3) ON CONFLICT DO NOTHING RETURNING payment_id', [
    line.ref,
    line.killbill?.cents ?? 0,
    ctx.now,
  ])).rows[0];
  if (!claimed) throw conflict('line_not_orphan', ctx.m.lineNotOrphan);
  const paymentId = line.ref as string;
  const cents = line.killbill?.cents ?? 0;
  let ref: string;
  try {
    ref = await kb.refundInvoicePayment(paymentId, cents, [], `orphan-${paymentId}`, staff.email);
  } catch (error) {
    await pool.query('DELETE FROM orphan_refunds WHERE payment_id = $1', [paymentId]);
    if (error instanceof kb.BillingUnavailable) throw new ApiError(503, 'billing_unavailable', ctx.m.billingOther);
    throw error;
  }
  const audit = await tx(async (db) => {
    await db.query('UPDATE orphan_refunds SET killbill_ref = $2 WHERE payment_id = $1', [paymentId, ref]);
    return writeAudit(db, staff, { action: 'orphan_refund', target: paymentId, reason: 'Orphan payment', amount_cents: cents, killbill_ref: ref, outcome: 'issued' }, ctx.now);
  });
  return {
    status: 200,
    body: {
      line: { key: line.key, kind: line.kind, shop: null, killbill: money(0), status: 'refunded' },
      refund: { amount: money(cents), killbill_ref: ref },
      audit,
    },
  };
});
