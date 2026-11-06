import type pg from 'pg';
import type { Config } from '../config.js';
import { query, withClient } from '../db.js';
import { newId } from '../store.js';
import { shopNowMs } from '../clock.js';
import { lineVatCents, levelAmounts } from './money.js';
import {
  STAGES, loadAggregate, serialiseOrder, collectedCents, pendingDrawsCents, anyPendingPayment,
  type ApiOrder, type OrderAggregate, type Stage,
} from './engine.js';
import { Killbill, KillbillError } from '../services/killbill.js';
import { queueMail, recordMailFact } from '../mail.js';
import { formatCents } from './money.js';

// Partial refunds: one line, drawn from the latest confirmed payment first,
// one Kill Bill refund per payment drawn on, believed per draw under the
// notification rules.

export class RefundRefusal extends Error {
  constructor(public code: string, public status: number, public field?: string) {
    super(code);
  }
}

export interface RefundOutcome {
  status: number;
  body: ApiOrder;
}

// The refund's draws, decided under the order lock so parallel refunds can
// never jointly exceed what the line has collected.
export async function refundLine(
  config: Config, kb: Killbill, killbillUp: boolean,
  orderId: string, lineId: string, amountCents: number, idempotencyKey: string, userId: string,
): Promise<RefundOutcome> {
  const nowMs = shopNowMs(config);

  interface DrawPlan { paymentId: string; stage: Stage; amount: number; vat: number }
  let draws: DrawPlan[] = [];
  let refundId = '';

  await withClient(config, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`order:${orderId}`]);
    const agg = await loadAggregate(config, orderId);
    if (!agg) throw new RefundRefusal('not_found', 404);
    const o = agg.order;
    const line = o.lines.find((l) => l.id === lineId);
    if (!line) throw new RefundRefusal('not_found', 404);

    if (o.state === 'quoted') throw new RefundRefusal('illegal_transition', 409);
    if (o.state === 'withdrawn' && moneyFailedDrawLeft(agg, lineId) === 0) {
      throw new RefundRefusal('illegal_transition', 409);
    }
    if (anyPendingPayment(agg)) throw new RefundRefusal('payment_in_flight', 409);
    if (agg.refunds.some((r) => r.status === 'pending')) throw new RefundRefusal('refund_in_flight', 409);
    if (o.state === 'inspection passed' && line.code.startsWith('INSPECT')) {
      throw new RefundRefusal('fee_already_spent', 409);
    }
    if (amountCents < 1 || amountCents > collectedCents(agg, lineId) - pendingDrawsCents(agg, lineId)) {
      throw new RefundRefusal('amount_exceeds', 422, 'amountCents');
    }
    if (!killbillUp) throw new RefundRefusal('payments_paused', 503);

    // Draw from the latest confirmed payment on this line first. Each payment
    // holds at most one allocation per line.
    const paidStages = [...STAGES].reverse().filter((s) => agg.payments.find((p) => p.stage === s)?.status === 'paid');
    let remaining = amountCents;
    for (const stage of paidStages) {
      if (remaining <= 0) break;
      const payment = agg.payments.find((p) => p.stage === stage)!;
      const alloc = agg.allocations.find((a) => a.paymentId === payment.id && a.lineId === lineId);
      if (!alloc) continue;
      // The allocation's remaining gross and VAT exclude its pending and returned draws.
      const settledDraws = agg.refunds
        .flatMap((r) => (r.lineId === lineId ? r.draws : []))
        .filter((d) => d.paymentId === payment.id && d.status !== 'failed');
      const remainingGross = alloc.grossCents - settledDraws.reduce((s, d) => s + d.amountCents, 0);
      const remainingVat = alloc.vatCents - settledDraws.reduce((s, d) => s + d.vatCents, 0);
      if (remainingGross <= 0) continue;
      const take = Math.min(remaining, remainingGross);
      const vat = take >= remainingGross ? remainingVat : Math.min(lineVatCents(take, line.vatRatePct), remainingVat);
      draws.push({ paymentId: payment.id, stage, amount: take, vat });
      remaining -= take;
    }
    if (remaining > 0) throw new RefundRefusal('amount_exceeds', 422, 'amountCents');

    refundId = newId('refund');
    await client.query(
      `insert into refunds (id, order_id, line_id, amount_cents, status, idempotency_key) values ($1, $2, $3, $4, 'pending', $5)`,
      [refundId, orderId, lineId, amountCents, idempotencyKey],
    );
    for (let i = 0; i < draws.length; i++) {
      const d = draws[i]!;
      await client.query(
        `insert into refund_draws (id, refund_id, payment_id, stage, amount_cents, vat_cents, status, external_key)
         values ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
        [newId('draw'), refundId, d.paymentId, d.stage, d.amount, d.vat, `${userId}:${idempotencyKey}:${i + 1}`],
      );
    }
  });

  // Send each draw. A Kill Bill 4xx marks only that draw failed; if Kill Bill
  // becomes unreachable partway, unsent draws stay pending with their same
  // external keys and go out when it returns.
  const agg0 = await loadAggregate(config, orderId);
  for (let i = 0; i < draws.length; i++) {
    const draw = draws[i]!;
    const payment = agg0!.payments.find((p) => p.id === draw.paymentId);
    if (!payment?.killbillPaymentId) continue;
    try {
      await kb.refundPayment(payment.killbillPaymentId, (draw.amount / 100).toFixed(2), `${userId}:${idempotencyKey}:${i + 1}`);
    } catch (e) {
      if (e instanceof KillbillError && e.kind === 'refused') {
        await query(config, `update refund_draws set status = 'failed' where refund_id = $1 and stage = $2 and amount_cents = $3`, [refundId, draw.stage, draw.amount]);
      }
    }
  }

  await settleRefund(config, refundId);
  const updated = await loadAggregate(config, orderId);
  return { status: 202, body: serialiseOrder(updated!, nowMs) };
}

function moneyFailedDrawLeft(agg: OrderAggregate, lineId: string): number {
  let sum = 0;
  for (const rf of agg.refunds) {
    for (const d of rf.draws) {
      if (rf.lineId === lineId && d.status === 'failed') sum += d.amountCents;
    }
  }
  return sum;
}

// Settle a refund once every draw has been decided. Idempotent.
export async function settleRefund(config: Config, refundId: string): Promise<void> {
  const r = await query<{ order_id: string; line_id: string; amount_cents: number; status: string }>(
    config, 'select order_id, line_id, amount_cents, status from refunds where id = $1', [refundId]);
  if (r.rows.length === 0) return;
  const refund = r.rows[0]!;
  const draws = await query<{ status: string; amount_cents: number; vat_cents: number }>(
    config, 'select status, amount_cents, vat_cents from refund_draws where refund_id = $1', [refundId]);
  if (draws.rows.some((d) => d.status === 'pending')) return;
  if (refund.status !== 'pending') return;

  const returned = draws.rows.filter((d) => d.status === 'returned');
  const returnedCents = returned.reduce((s, d) => s + d.amount_cents, 0);
  const returnedVat = returned.reduce((s, d) => s + d.vat_cents, 0);
  let status: 'returned' | 'partly returned' | 'failed';
  if (returned.length === draws.rows.length) status = 'returned';
  else if (returned.length > 0) status = 'partly returned';
  else status = 'failed';

  await withClient(config, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`refund:${refundId}`]);
    const cur = await client.query<{ status: string }>(`select status from refunds where id = $1 for update`, [refundId]);
    if (cur.rows[0]?.status !== 'pending') return;
    await client.query(`update refunds set status = $2 where id = $1`, [refundId, status]);

    if (returnedCents > 0) {
      const orderRow = await client.query<{ lines: { id: string; grossCents: number; vatCents: number }[]; state: string; partly_refunded: boolean }>(
        `select lines, state, partly_refunded from orders where id = $1 for update`, [refund.order_id]);
      const order = orderRow.rows[0]!;
      const lines = order.lines.map((l) => {
        if (l.id !== refund.line_id) return l;
        return { ...l, grossCents: l.grossCents - returnedCents, vatCents: l.vatCents - returnedVat };
      });
      const paidStates = ['deposit confirmed', 'instalments running', 'in arrears', 'paid in full', 'kit dispatched', 'fitted', 'inspection passed'];
      const partly = order.partly_refunded || paidStates.includes(order.state);
      await client.query(
        `update orders set lines = $2, total_cents = total_cents - $3, vat_cents = vat_cents - $4, partly_refunded = $5 where id = $1`,
        [refund.order_id, JSON.stringify(lines), returnedCents, returnedVat, partly],
      );
      await respread(config, client, refund.order_id);
    }
  });

  if (returnedCents > 0) {
    const factKey = `credit:${refundId}`;
    if (await recordMailFact(config, factKey)) {
      const agg = await loadAggregate(config, refund.order_id);
      const user = await query<{ email: string }>(config, 'select email from users where id = $1', [agg!.order.userId]);
      const lineName = agg!.order.lines.find((l) => l.id === refund.line_id)?.name ?? '';
      await queueMail(config, {
        id: newId('mail'),
        toEmail: user.rows[0]!.email,
        subject: `Credit note for order ${agg!.order.number}: ${formatCents(returnedCents)}`,
        body: [
          lineName,
          `Returned amount: ${formatCents(returnedCents)} returned`,
          `VAT reversed: ${formatCents(returnedVat)} returned`,
        ].join('\n'),
      });
    }
  }
}

// Re-spread the unpaid balance over the unpaid stages.
async function respread(config: Config, client: pg.PoolClient, orderId: string): Promise<void> {
  const orderRow = await client.query<{ total_cents: number; state: string }>(`select total_cents, state from orders where id = $1`, [orderId]);
  const order = orderRow.rows[0]!;
  if (order.state === 'withdrawn') return;
  const payments = await client.query<{ stage: Stage; status: string }>(`select stage, status from payments where order_id = $1`, [orderId]);
  const ordered = STAGES.filter((s) => payments.rows.some((p) => p.stage === s));
  const paid = ordered
    .map((s) => payments.rows.find((p) => p.stage === s))
    .filter((p): p is { stage: Stage; status: string } => !!p && p.status === 'paid');
  const paidCents = (await query<{ amount_cents: number }>(config, `select sum(amount_cents)::int as amount_cents from payments where order_id = $1 and status = 'paid'`, [orderId])).rows[0]!.amount_cents;
  void paid;
  const unpaid = ordered.filter((s) => payments.rows.find((p) => p.stage === s)?.status !== 'paid');
  if (unpaid.length === 0) return;
  const balance = order.total_cents - paidCents;
  const amounts = levelAmounts(balance, unpaid.length);
  for (let i = 0; i < unpaid.length; i++) {
    await client.query(`update payments set amount_cents = $3 where order_id = $1 and stage = $2`, [orderId, unpaid[i], amounts[i]]);
  }
}
