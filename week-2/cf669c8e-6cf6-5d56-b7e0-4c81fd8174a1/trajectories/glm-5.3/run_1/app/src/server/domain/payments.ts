import type { Config } from '../config.js';
import { query, withClient } from '../db.js';
import { newId } from '../store.js';
import { shopNowMs, amsterdamDateOf, amsterdamInstant, amsterdamParts } from '../clock.js';
import { allocateToLines, levelAmounts, lineVatCents } from './money.js';
import {
  STAGES, STAGE_LABELS, loadAggregate, serialiseOrder, collectedCents, anyPendingPayment, anyPendingRefund,
  type Stage, type OrderAggregate, type ApiOrder, type OrderState,
} from './engine.js';
import { kitQuoteLines, type RoadClass } from './quote.js';
import { inspectionFeeCents } from './seed.js';
import { Killbill, KillbillError } from '../services/killbill.js';
import { Registry, RegistryError } from '../services/registry.js';
import { queueMail, recordMailFact } from '../mail.js';
import { formatCents } from './money.js';

// Payment decisions: requests, gates, confirmation, allocation and collection.

export class PaymentRefusal extends Error {
  constructor(public code: string, public status: number, public extra?: unknown) {
    super(code);
  }
}

export interface ProviderStatus {
  killbill: 'up' | 'down';
  registry: 'up' | 'down';
}

export function euros(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function ensureAccount(kb: Killbill, userId: string, name: string, email: string): Promise<string> {
  const externalKey = `rider-${userId}`;
  const existing = await kb.accountByExternalKey(externalKey);
  if (existing) return existing;
  try {
    const accountId = await kb.createAccount(externalKey, name, email);
    await kb.addExternalPaymentMethod(accountId);
    return accountId;
  } catch (e) {
    if (e instanceof KillbillError && e.kind === 'refused') {
      const found = await kb.accountByExternalKey(externalKey);
      if (found) {
        await kb.addExternalPaymentMethod(found).catch(() => undefined);
        return found;
      }
    }
    throw e;
  }
}

// The deposit gate for kit deposits, in the published order.
async function depositGate(
  config: Config, agg: OrderAggregate, providers: ProviderStatus, registry: Registry,
): Promise<void> {
  const o = agg.order;
  if (o.kind !== 'kit') return;
  // 1. hand-entered donor
  if (!o.donor?.confirmed) throw new PaymentRefusal('donor_unconfirmed', 409);
  // 2. stored verdict other than fits
  if (o.donor.fitVerdict !== 'fits') throw new PaymentRefusal('fit_not_passed', 409);
  // 3. Kill Bill unreachable
  if (providers.killbill === 'down') throw new PaymentRefusal('payments_paused', 503);
  // 4. fresh registry read
  try {
    const rec = await registry.lookup(o.donor.plate, o.donor.country);
    const stored = o.donor;
    if (
      rec.model !== stored.model ||
      rec.firstAdmissionYear !== stored.firstAdmissionYear ||
      rec.roadClass !== stored.roadClass ||
      rec.plateColour !== stored.plateColour ||
      Math.round(rec.registeredMassKg * 10) !== stored.registeredMassKg
    ) {
      throw new PaymentRefusal('donor_changed', 409);
    }
  } catch (e) {
    if (e instanceof PaymentRefusal) throw e;
    if (e instanceof RegistryError && e.kind === 'not_found') throw new PaymentRefusal('donor_changed', 409);
    throw new PaymentRefusal('registry_unreachable', 503);
  }
  // 5. fee no longer current
  if (o.feeCode) {
    const today = amsterdamDateOf(shopNowMs(config));
    const current = inspectionFeeCents(o.donor.country, today);
    if (current.code !== o.feeCode || current.cents !== o.feeCents) {
      await requoteOrder(config, agg.order.id);
      throw new PaymentRefusal('quote_changed', 409);
    }
  }
}

// Re-quote a quoted order with the current fee (no Kill Bill call).
export async function requoteOrder(config: Config, orderId: string): Promise<void> {
  const agg = await loadAggregate(config, orderId);
  if (!agg) return;
  const o = agg.order;
  if (o.kind !== 'kit' || o.config === null) return;
  const today = amsterdamDateOf(shopNowMs(config));
  const lines = kitQuoteLines({
    kind: 'kit',
    donorModel: o.donor?.model ?? 'K50',
    donorCountry: o.donor?.country ?? 'NL',
    donorClass: (o.donor?.roadClass ?? 25) as RoadClass,
    packId: o.config.packId,
    hubId: o.config.hubId,
    roadClass: o.config.roadClass,
    fulfilment: o.config.fulfilment,
    country: o.config.country,
  }, today);
  const totalCents = lines.reduce((s, l) => s + l.grossCents, 0);
  const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);
  const paid = agg.payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amountCents, 0);
  const returned = agg.refunds.flatMap((r) => r.draws).filter((d) => d.status === 'returned').reduce((s, d) => s + d.amountCents, 0);
  const collected = paid - returned;
  const unpaid = STAGES.filter((s) => {
    const p = agg.payments.find((x) => x.stage === s);
    return !p || p.status !== 'paid';
  });
  const balance = totalCents - collected;
  const amounts = levelAmounts(balance, unpaid.length);
  await withClient(config, async (client) => {
    await client.query(`update orders set lines = $2, total_cents = $3, vat_cents = $4, fee_code = $5, fee_cents = $6, quote_date = $7 where id = $1`, [
      orderId, JSON.stringify(lines), totalCents, vatCents,
      lines.find((l) => l.code.startsWith('INSPECT'))?.code ?? null,
      lines.find((l) => l.code.startsWith('INSPECT'))?.grossCents ?? null,
      today,
    ]);
    for (let i = 0; i < unpaid.length; i++) {
      await client.query(`update payments set amount_cents = $3 where order_id = $1 and stage = $2`, [orderId, unpaid[i], amounts[i]]);
    }
  });
}

// Rider requests a payment for a stage.
export async function requestPayment(
  config: Config, kb: Killbill, registry: Registry, providers: ProviderStatus,
  userId: string, orderId: string, stage: Stage, idempotencyKey: string,
  user: { name: string; email: string },
): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  await withClient(config, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`order:${orderId}`]);
    await requestPaymentLocked(config, kb, registry, providers, userId, orderId, stage, idempotencyKey, user);
  }).catch((e) => {
    if (e instanceof PaymentRefusal) throw e;
    throw e;
  });
  const updated = await loadAggregate(config, orderId);
  return { status: 202, body: serialiseOrder(updated!, nowMs) };
}

async function requestPaymentLocked(
  config: Config, kb: Killbill, registry: Registry, providers: ProviderStatus,
  userId: string, orderId: string, stage: Stage, idempotencyKey: string,
  user: { name: string; email: string },
): Promise<void> {
  const agg = await loadAggregate(config, orderId);
  if (!agg) throw new PaymentRefusal('not_found', 404);
  const o = agg.order;

  // Refusal order: illegal_transition, stage_already_paid, stage_out_of_order,
  // payment_in_flight, refund_in_flight, gate, payment_refused.
  const noPaymentStates: OrderState[] = ['withdrawn', 'paid in full', 'kit dispatched', 'fitted', 'inspection passed'];
  if ((o.state === 'quoted' && stage !== 'deposit') || noPaymentStates.includes(o.state)) {
    throw new PaymentRefusal('illegal_transition', 409);
  }
  const stageRow = agg.payments.find((p) => p.stage === stage);
  if (stageRow?.status === 'paid') throw new PaymentRefusal('stage_already_paid', 409);
  const idx = STAGES.indexOf(stage);
  for (let i = 0; i < idx; i++) {
    const earlier = agg.payments.find((p) => p.stage === STAGES[i]);
    if (!earlier || earlier.status !== 'paid') throw new PaymentRefusal('stage_out_of_order', 409);
  }
  if (anyPendingPayment(agg)) throw new PaymentRefusal('payment_in_flight', 409);
  if (anyPendingRefund(agg)) throw new PaymentRefusal('refund_in_flight', 409);
  if (stage === 'deposit') {
    await depositGate(config, agg, providers, registry);
  } else if (providers.killbill === 'down') {
    throw new PaymentRefusal('payments_paused', 503);
  }

  // Accept: transition and make the Kill Bill purchase.
  const amount = stageRow?.amountCents ?? 0;
  if (amount <= 0) throw new PaymentRefusal('illegal_transition', 409);
  const externalKey = `${userId}:${idempotencyKey}`;
  let nextState: OrderState = o.state;
  if (stage === 'deposit' && o.state === 'quoted') nextState = 'deposit pending';
  if (stage !== 'deposit' && o.state === 'deposit confirmed') nextState = 'instalments running';

  let kbResult: { paymentId: string; transactionId: string; status: string } | null = null;
  try {
    const accountId = await ensureAccount(kb, userId, user.name, user.email);
    kbResult = await kb.purchase(accountId, euros(amount), externalKey);
  } catch (e) {
    if (e instanceof KillbillError && e.kind === 'unreachable') {
      throw new PaymentRefusal('payments_paused', 503);
    }
    if (!(e instanceof KillbillError)) {
      console.error('purchase path error', e);
      throw new PaymentRefusal('payments_paused', 503);
    }
    // Kill Bill refused the request.
    await withClient(config, async (client) => {
      await client.query(`update payments set status = 'failed', attempt = attempt + 1, idempotency_key = $2, external_key = $3 where order_id = $1 and stage = $4`, [orderId, idempotencyKey, externalKey, stage]);
      await client.query(`update orders set state = $2 where id = $1`, [orderId, nextState]);
    });
    throw new PaymentRefusal('payment_refused', 402);
  }

  await withClient(config, async (client) => {
    await client.query(
      `update payments set status = 'pending', attempt = attempt + 1, killbill_payment_id = $2, killbill_transaction_id = $3, idempotency_key = $4, external_key = $5 where order_id = $1 and stage = $6`,
      [orderId, kbResult!.paymentId, kbResult!.transactionId, idempotencyKey, externalKey, stage],
    );
    await client.query(`update orders set state = $2 where id = $1`, [orderId, nextState]);
  });
}

// Believed confirmation of a stage: allocate, transition, receipt.
export async function confirmStage(config: Config, orderId: string, stage: Stage): Promise<void> {
  await withClient(config, async (client) => {
    // Serialize on the order to avoid double confirmation races.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`confirm:${orderId}`]);
    const paymentRow = await client.query(`select id, amount_cents, status from payments where order_id = $1 and stage = $2 for update`, [orderId, stage]);
    if (paymentRow.rows.length === 0) return;
    const payment = paymentRow.rows[0];
    if (payment.status !== 'pending') return;
    const orderRow = await client.query(`select * from orders where id = $1 for update`, [orderId]);
    const order = orderRow.rows[0];
    const lines: OrderLine[] = order.lines;
    const paymentId = payment.id;

    // Allocations: the final stage takes the residual per line.
    const existingAllocs = await client.query(`select line_id, gross_cents, vat_cents from allocations where payment_id = $1`, [paymentId]);
    if (existingAllocs.rows.length === 0) {
      const allocRows: { lineId: string; gross: number; vat: number }[] = [];
      if (stage === 'instalment-3') {
        const agg = await loadAggregate(config, orderId);
        for (const line of lines) {
          const collected = collectedCents(agg!, line.id);
          const residual = line.grossCents - collected;
          const residualVat = line.vatCents - vatCollected(agg!, line.id);
          if (residual > 0 || residualVat > 0) {
            allocRows.push({ lineId: line.id, gross: residual, vat: residualVat });
          }
        }
      } else {
        const share = allocateToLines(payment.amount_cents, lines.map((l) => ({ id: l.id, grossCents: l.grossCents })));
        for (const line of lines) {
          const gross = share.get(line.id) ?? 0;
          const vat = lineVatCents(gross, line.vatRatePct);
          allocRows.push({ lineId: line.id, gross, vat });
        }
      }
      for (const a of allocRows) {
        await client.query(
          `insert into allocations (payment_id, line_id, gross_cents, vat_cents, net_cents) values ($1, $2, $3, $4, $5)`,
          [paymentId, a.lineId, a.gross, a.vat, a.gross - a.vat],
        );
      }
    }

    await client.query(`update payments set status = 'paid', confirmed_at = now() where id = $1`, [paymentId]);

    // State transition.
    let nextState: OrderState = order.state;
    if (order.state === 'deposit pending' && stage === 'deposit') {
      nextState = 'deposit confirmed';
    } else if (order.state === 'deposit confirmed' && stage !== 'deposit') {
      nextState = 'instalments running';
    }
    const remaining = await client.query(
      `select stage, status from payments where order_id = $1`,
      [orderId],
    );
    const allPaid = remaining.rows.every((r) => r.status === 'paid');
    if (allPaid) nextState = 'paid in full';
    else if (order.state === 'in arrears') nextState = 'instalments running';
    await client.query(`update orders set state = $2 where id = $1`, [orderId, nextState]);

    // Instalment due dates anchored on the deposit confirmation date.
    if (stage === 'deposit') {
      const confirmedAt = new Date();
      const dueDates = instalmentDueDates(confirmedAt);
      for (let i = 0; i < 3; i++) {
        await client.query(`update payments set due_at = $3 where order_id = $1 and stage = $2`, [orderId, STAGES[i + 1], new Date(dueDates[i])]);
      }
    }
  });

  // One VAT receipt per confirmed payment, recorded in the database.
  const factKey = `receipt:${orderId}:${stage}`;
  const fresh = await recordMailFact(config, factKey);
  if (fresh) {
    const agg = await loadAggregate(config, orderId);
    if (agg) {
      const user = await query<{ email: string; name: string }>(config, 'select email, name from users where id = $1', [agg.order.userId]);
      const payment = agg.payments.find((p) => p.stage === stage)!;
      const allocs = agg.allocations.filter((a) => a.paymentId === payment.id);
      const vat = allocs.reduce((s, a) => s + a.vatCents, 0);
      const net = allocs.reduce((s, a) => s + a.netCents, 0);
      const lineSplits = allocs.map((a) => {
        const line = agg.order.lines.find((l) => l.id === a.lineId)!;
        return `${line.name}: ${formatCents(a.grossCents)} paid`;
      }).join('\n');
      await queueMail(config, {
        id: newId('mail'),
        toEmail: user.rows[0]!.email,
        subject: `VAT receipt: ${STAGE_LABELS[stage]} for order ${agg.order.number}`,
        body: [
          `Paid amount: ${formatCents(payment.amountCents)} paid`,
          `VAT: ${formatCents(vat)} paid`,
          `Net: ${formatCents(net)} paid`,
          lineSplits,
        ].join('\n'),
      });
    }
  }
}

function vatCollected(agg: OrderAggregate, lineId: string): number {
  const paidIds = new Set(agg.payments.filter((p) => p.status === 'paid').map((p) => p.id));
  let sum = 0;
  for (const a of agg.allocations) {
    if (a.lineId === lineId && paidIds.has(a.paymentId)) sum += a.vatCents;
  }
  for (const rf of agg.refunds) {
    for (const d of rf.draws) {
      if (rf.lineId === lineId && d.status === 'returned') sum -= d.vatCents;
    }
  }
  return sum;
}

interface OrderLine {
  id: string;
  code: string;
  name: string;
  grossCents: number;
  vatRatePct: number;
  vatCents: number;
  netCents: number;
}

// Due dates: monthly from the deposit confirmation, anchored on that date's
// day of month, or the last day of a shorter month.
export function instalmentDueDates(from: Date): number[] {
  const parts = amsterdamParts(from.getTime());
  const [y, m, d] = parts.date.split('-').map(Number);
  const dates: number[] = [];
  for (let i = 1; i <= 3; i++) {
    let month = m + i;
    let year = y;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(d, lastDay);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    dates.push(amsterdamInstant(dateStr, '00:00:00').instant);
  }
  return dates;
}

// Believed failure of a stage.
export async function failStage(config: Config, orderId: string, stage: Stage): Promise<void> {
  await withClient(config, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`confirm:${orderId}`]);
    const r = await client.query(`select id, status, attempt from payments where order_id = $1 and stage = $2 for update`, [orderId, stage]);
    if (r.rows.length === 0) return;
    const p = r.rows[0];
    if (p.status !== 'pending') return;
    await client.query(`update payments set status = 'failed' where id = $1`, [p.id]);
  });
}
