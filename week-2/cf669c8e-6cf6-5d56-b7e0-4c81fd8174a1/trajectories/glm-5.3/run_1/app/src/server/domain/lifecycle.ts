import type { Config } from '../config.js';
import { query, withClient } from '../db.js';
import { newId } from '../store.js';
import { shopNowMs, amsterdamDateOf } from '../clock.js';
import { scheduleAmounts, lineVatCents, levelAmounts } from './money.js';
import {
  STAGES, loadAggregate, serialiseOrder, collectedCents, anyPendingPayment, anyPendingRefund, everReturned,
  withdrawalDeadlineFor,
  type ApiOrder, type OrderLine, type OrderState, type Stage,
} from './engine.js';
import { kitQuoteLines, bikeQuoteLines, type Fulfilment, type RoadClass, type KitConfig } from './quote.js';
import { parseDonorBody, DonorError, type ParsedDonor } from './donors.js';
import { VAT_RATES, classNameFor, FIXED_LINES, PACKS, HUBS } from './seed.js';
import { Killbill, KillbillError } from '../services/killbill.js';
import { Registry } from '../services/registry.js';
import { queueMail, recordMailFact } from '../mail.js';
import { runFitCheck } from './fit.js';
import { formatCents } from './money.js';

// Order lifecycle: creation, plan and config PATCH, withdrawal, the switch to
// workshop fitting, desk transitions, delivery and inspection.

export class LifecycleError extends Error {
  constructor(public code: string, public status: number, public field?: string) {
    super(code);
  }
}

export interface CreateKitRequest {
  rawConfig: Record<string, unknown>;
  plan: { name: string; street: string; postcode: string; city: string; note?: string };
  expectedTotalCents: number;
}

export async function createKitOrder(
  config: Config, registry: Registry, registryUp: boolean,
  userId: string, req: CreateKitRequest,
): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  const today = amsterdamDateOf(nowMs);

  // Config validation, then the registry read, then the quote comparison.
  const packId = String(req.rawConfig['packId'] ?? '');
  const hubId = String(req.rawConfig['hubId'] ?? '');
  const roadClass = Number(req.rawConfig['roadClass'] ?? 0);
  const fulfilment = String(req.rawConfig['fulfilment'] ?? 'posted');
  const country = String(req.rawConfig['country'] ?? 'NL');
  const errors: Record<string, string> = {};
  if (!PACKS.some((p) => p.id === packId)) errors['packId'] = 'Pick a pack.';
  if (!HUBS.some((h) => h.id === hubId)) errors['hubId'] = 'Pick a hub.';
  if (roadClass !== 25 && roadClass !== 45) errors['roadClass'] = 'Pick the road class.';
  if (fulfilment !== 'posted' && fulfilment !== 'workshop') errors['fulfilment'] = 'Pick the fulfilment.';
  if (!['NL', 'BE', 'DE', 'LU'].includes(country)) errors['country'] = 'Enter NL, BE, DE or LU.';
  if (Object.keys(errors).length > 0) throw new LifecycleError('validation_fields', 422, JSON.stringify(errors));

  const donorBody = (req.rawConfig['donor'] as Record<string, unknown> | undefined) ?? {};
  let parsed: ParsedDonor;
  try {
    parsed = await parseDonorBody(donorBody, registry);
  } catch (e) {
    if (e instanceof DonorError) {
      if (e.status === 404) throw new LifecycleError('plate_not_found', 404);
      if (e.status === 503) throw new LifecycleError('registry_unreachable', 503);
      throw new LifecycleError('validation_fields', 422, e.message ?? '{}');
    }
    throw e;
  }
  if (parsed.donor.roadClass > roadClass) {
    throw new LifecycleError('validation_fields', 422, JSON.stringify({ roadClass: 'A kit cannot move a scooter down a road class.' }));
  }
  if (!registryUp && !parsed.manual) throw new LifecycleError('registry_unreachable', 503);

  const kitConfig: KitConfig = {
    kind: 'kit',
    donorModel: parsed.donor.model,
    donorCountry: parsed.donor.country,
    donorClass: parsed.donor.roadClass,
    packId, hubId, roadClass: roadClass as RoadClass,
    fulfilment: fulfilment as Fulfilment, country,
  };
  const lines = kitQuoteLines(kitConfig, today);
  const totalCents = lines.reduce((sum, l) => sum + l.grossCents, 0);
  if (req.expectedTotalCents !== totalCents) throw new LifecycleError('quote_changed', 409);

  const fit = runFitCheck({ donor: parsed.donor, packId, hubId, roadClass: roadClass as RoadClass, units: 'metric' }, !parsed.manual);
  const notices = ['Insurance: the scooter is uninsured on public roads once the work has begun, until it passes inspection.'];
  if (parsed.donor.roadClass !== roadClass) {
    notices.push('Plate: a new plate is needed for the new class.', 'Helmet: a helmet is required in the 45 km/h class.', 'Licence: check the licence your class requires before riding.');
  }
  const vatCents = lines.reduce((sum, l) => sum + l.vatCents, 0);
  const amounts = scheduleAmounts(totalCents);
  const orderId = newId('order');
  const number = await nextNumber(config);
  const donorJson = {
    plate: parsed.plate, country: parsed.country, model: parsed.donor.model,
    confirmed: !parsed.manual,
    firstAdmissionYear: parsed.donor.firstAdmissionYear, roadClass: parsed.donor.roadClass,
    plateColour: parsed.donor.plateColour, registeredMassKg: parsed.donor.registeredMassKg,
    fitVerdict: fit.verdict,
  };

  await withClient(config, async (client) => {
    await client.query(
      `insert into orders (id, number, user_id, kind, state, plan_version, plan, donor, config, lines, total_cents, vat_cents, notices, fee_code, fee_cents, quote_date)
       values ($1, $2, $3, 'kit', 'quoted', 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [orderId, number, userId, JSON.stringify(req.plan), JSON.stringify(donorJson), JSON.stringify({
        packId, hubId, roadClass, fulfilment, country,
      }), JSON.stringify(lines), totalCents, vatCents, JSON.stringify(notices),
      lines.find((l) => l.code.startsWith('INSPECT'))?.code ?? null,
      lines.find((l) => l.code.startsWith('INSPECT'))?.grossCents ?? null,
      today],
    );
    for (let i = 0; i < STAGES.length; i++) {
      await client.query(
        `insert into payments (id, order_id, user_id, stage, amount_cents, status, external_key)
         values ($1, $2, $3, $4, $5, 'scheduled', $6)`,
        [newId('pay'), orderId, userId, STAGES[i], amounts[i], `unused:${orderId}:${STAGES[i]}`],
      );
    }
  });
  const agg = await loadAggregate(config, orderId);
  return { status: 201, body: serialiseOrder(agg!, nowMs) };
}

export async function createBikeOrder(
  config: Config, userId: string, bikeId: string,
  plan: { name: string; street: string; postcode: string; city: string; note?: string },
  expectedTotalCents: number,
): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  const today = amsterdamDateOf(nowMs);
  const lines = bikeQuoteLines(bikeId);
  const totalCents = lines.reduce((s, l) => s + l.grossCents, 0);
  if (expectedTotalCents !== totalCents) throw new LifecycleError('quote_changed', 409);
  const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);
  const amounts = scheduleAmounts(totalCents);
  const orderId = newId('order');
  const number = await nextNumber(config);
  await withClient(config, async (client) => {
    await client.query(
      `insert into orders (id, number, user_id, kind, state, plan_version, plan, bike_id, lines, total_cents, vat_cents, notices, quote_date)
       values ($1, $2, $3, 'bike', 'quoted', 1, $4, $5, $6, $7, $8, $9, $10)`,
      [orderId, number, userId, JSON.stringify(plan), bikeId, JSON.stringify(lines), totalCents, vatCents,
        JSON.stringify([]), today],
    );
    for (let i = 0; i < STAGES.length; i++) {
      await client.query(
        `insert into payments (id, order_id, user_id, stage, amount_cents, status, external_key)
         values ($1, $2, $3, $4, $5, 'scheduled', $6)`,
        [newId('pay'), orderId, userId, STAGES[i], amounts[i], `unused:${orderId}:${STAGES[i]}`],
      );
    }
  });
  const agg = await loadAggregate(config, orderId);
  return { status: 201, body: serialiseOrder(agg!, nowMs) };
}

async function nextNumber(config: Config): Promise<string> {
  const r = await query<{ n: number }>(config, 'select count(*)::int as n from orders');
  return `OM-${10001 + r.rows[0]!.n}`;
}

// PATCH: plan updates with version checks; config changes re-quote a quoted order.
export async function patchOrder(
  config: Config, orderId: string, userId: string,
  body: { planVersion?: number; plan?: Record<string, unknown>; config?: { fulfilment?: string; country?: string } },
): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  const agg = await loadAggregate(config, orderId);
  if (!agg) throw new LifecycleError('not_found', 404);
  if (agg.order.userId !== userId) throw new LifecycleError('not_found', 404);
  if (typeof body.planVersion !== 'number') throw new LifecycleError('plan_version_required', 422);
  if (body.planVersion !== agg.order.planVersion) throw new LifecycleError('stale_version', 412);

  if (body.config) {
    if (agg.order.state !== 'quoted') throw new LifecycleError('quote_locked', 409);
    const fulfilment = body.config.fulfilment ?? agg.order.config?.fulfilment;
    const country = body.config.country ?? agg.order.config?.country;
    await requoteOrderConfig(config, agg, fulfilment as Fulfilment, country as string);
  }

  if (body.plan) {
    const name = String(body.plan['name'] ?? '');
    const street = String(body.plan['street'] ?? '');
    const postcode = String(body.plan['postcode'] ?? '');
    const city = String(body.plan['city'] ?? '');
    const note = body.plan['note'] === undefined ? undefined : String(body.plan['note']);
    if (note !== undefined && note.length > 500) throw new LifecycleError('note_too_long', 422, 'note');
    await query(
      config,
      `update orders set plan = $2, plan_version = plan_version + 1 where id = $1`,
      [orderId, JSON.stringify({ name, street, postcode, city, ...(note !== undefined ? { note } : {}) })],
    );
  } else {
    await query(config, `update orders set plan_version = plan_version + 1 where id = $1`, [orderId]);
  }
  const updated = await loadAggregate(config, orderId);
  return { status: 200, body: serialiseOrder(updated!, nowMs) };
}

async function requoteOrderConfig(config: Config, agg: NonNullable<Awaited<ReturnType<typeof loadAggregate>>>, fulfilment: Fulfilment, country: string): Promise<void> {
  const o = agg!.order;
  if (o.kind !== 'kit' || !o.config || !o.donor) return;
  const today = amsterdamDateOf(shopNowMs(config));
  const lines = kitQuoteLines({
    kind: 'kit',
    donorModel: o.donor.model ?? 'K50',
    donorCountry: o.donor.country ?? 'NL',
    donorClass: (o.donor.roadClass ?? 25) as RoadClass,
    packId: o.config.packId, hubId: o.config.hubId,
    roadClass: o.config.roadClass, fulfilment, country,
  }, today);
  const totalCents = lines.reduce((s, l) => s + l.grossCents, 0);
  const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);
  const amounts = scheduleAmounts(totalCents);
  const unpaid = STAGES.filter((s) => agg!.payments.find((p) => p.stage === s)?.status !== 'paid');
  await withClient(config, async (client) => {
    await client.query(
      `update orders set lines = $2, total_cents = $3, vat_cents = $4, config = $5, fee_code = $6, fee_cents = $7, quote_date = $8 where id = $1`,
      [o.id, JSON.stringify(lines), totalCents, vatCents,
        JSON.stringify({ ...o.config, fulfilment, country }),
        lines.find((l) => l.code.startsWith('INSPECT'))?.code ?? null,
        lines.find((l) => l.code.startsWith('INSPECT'))?.grossCents ?? null,
        today],
    );
    for (let i = 0; i < unpaid.length; i++) {
      const p = agg!.payments.find((x) => x.stage === unpaid[i])!;
      await client.query(`update payments set amount_cents = $2 where id = $1`, [p.id, amounts[STAGES.indexOf(unpaid[i])!]]);
    }
  });
}

// Withdrawal: allowed before fitting and inspection passed, deadline for delivered kits.
export async function withdrawOrder(
  config: Config, kb: Killbill, killbillUp: boolean,
  orderId: string, userId: string, idempotencyKey: string,
): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  const agg = await loadAggregate(config, orderId);
  if (!agg) throw new LifecycleError('not_found', 404);
  if (agg.order.userId !== userId) throw new LifecycleError('not_found', 404);
  const o = agg.order;

  if (['fitted', 'inspection passed', 'withdrawn'].includes(o.state)) throw new LifecycleError('illegal_transition', 409);
  if (o.withdrawalDeadline !== null && nowMs > o.withdrawalDeadline) throw new LifecycleError('withdrawal_closed', 409);
  if (anyPendingPayment(agg)) throw new LifecycleError('payment_in_flight', 409);
  if (anyPendingRefund(agg)) throw new LifecycleError('payment_in_flight', 409);

  // One refund per line with collected money, drawn from that line's confirmed payments.
  const linesWithMoney = o.lines.filter((l) => collectedCents(agg, l.id) > 0);
  if (linesWithMoney.length > 0 && !killbillUp) throw new LifecycleError('payments_paused', 503);

  await withClient(config, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`order:${orderId}`]);
    await client.query(`update orders set state = 'withdrawn' where id = $1`, [orderId]);
    let drawIndex = 0;
    for (const line of linesWithMoney) {
      const refundId = newId('refund');
      const amount = collectedCents(agg, line.id);
      await client.query(
        `insert into refunds (id, order_id, line_id, amount_cents, status, idempotency_key) values ($1, $2, $3, $4, 'pending', $5)`,
        [refundId, orderId, line.id, amount, idempotencyKey],
      );
      // Draw from each confirmed payment's allocation on this line.
      for (const stage of STAGES) {
        const payment = agg.payments.find((p) => p.stage === stage && p.status === 'paid');
        if (!payment) continue;
        const alloc = agg.allocations.find((a) => a.paymentId === payment.id && a.lineId === line.id);
        if (!alloc || alloc.grossCents <= 0) continue;
        drawIndex += 1;
        const vat = alloc.vatCents;
        await client.query(
          `insert into refund_draws (id, refund_id, payment_id, stage, amount_cents, vat_cents, status, external_key)
           values ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
          [newId('draw'), refundId, payment.id, stage, alloc.grossCents, vat, `${userId}:${idempotencyKey}:w${drawIndex}`],
        );
      }
    }
  });

  // Send each draw to Kill Bill.
  const fresh = await loadAggregate(config, orderId);
  for (const rf of fresh!.refunds.filter((r) => r.status === 'pending')) {
    for (const draw of rf.draws) {
      const payment = fresh!.payments.find((p) => p.id === draw.paymentId);
      if (!payment?.killbillPaymentId) continue;
      try {
        await kb.refundPayment(payment.killbillPaymentId, (draw.amountCents / 100).toFixed(2), draw.externalKey);
      } catch (e) {
        if (e instanceof KillbillError && e.kind === 'refused') {
          await query(config, `update refund_draws set status = 'failed' where id = $1`, [draw.id]);
        }
      }
    }
    const { settleRefund } = await import('./refunds.js');
    await settleRefund(config, rf.id);
  }

  const updated = await loadAggregate(config, orderId);
  return { status: 200, body: serialiseOrder(updated!, nowMs) };
}

// Switch a posted kit to workshop fitting.
export async function switchToWorkshop(
  config: Config, orderId: string, userId: string,
): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  const agg = await loadAggregate(config, orderId);
  if (!agg) throw new LifecycleError('not_found', 404);
  if (agg.order.userId !== userId) throw new LifecycleError('not_found', 404);
  const o = agg.order;

  if (o.kind !== 'kit' || o.config?.fulfilment !== 'posted' || !['deposit confirmed', 'instalments running'].includes(o.state)) {
    throw new LifecycleError('illegal_transition', 409);
  }
  if (everReturned(agg)) throw new LifecycleError('illegal_transition', 409);
  if (anyPendingPayment(agg)) throw new LifecycleError('payment_in_flight', 409);
  if (anyPendingRefund(agg)) throw new LifecycleError('payment_in_flight', 409);

  await withClient(config, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`order:${orderId}`]);
    const orderRow = await client.query<{ lines: OrderLine[]; config: { fulfilment: string; country: string }; total_cents: number; vat_cents: number }>(
      `select lines, config, total_cents, vat_cents from orders where id = $1 for update`, [orderId]);
    const order = orderRow.rows[0]!;
    const fitPrice = FIXED_LINES['FIT']!.grossCents;
    const nlRate = VAT_RATES['NL']!;
    const lines: OrderLine[] = order.lines.map((l) => {
      if (l.code === 'POST') {
        const vat = lineVatCents(fitPrice, nlRate);
        return { ...l, code: 'FIT', name: 'Workshop fitting', grossCents: fitPrice, vatRatePct: nlRate, vatCents: vat, netCents: fitPrice - vat };
      }
      if (l.vatRatePct !== nlRate && l.vatRatePct !== 0) {
        const vat = lineVatCents(l.grossCents, nlRate);
        return { ...l, vatRatePct: nlRate, vatCents: vat, netCents: l.grossCents - vat };
      }
      return l;
    });
    const totalCents = lines.reduce((s, l) => s + l.grossCents, 0);
    const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);

    // Confirmed stage amounts never change; each confirmed allocation's VAT is
    // recomputed from its gross at the new rate.
    const stageCorrections: Record<string, number> = {};
    for (const payment of agg.payments.filter((p) => p.status === 'paid')) {
      let correction = 0;
      for (const alloc of agg.allocations.filter((a) => a.paymentId === payment.id)) {
        const line = lines.find((l) => l.id === alloc.lineId);
        if (!line) continue;
        const newVat = alloc.grossCents === 0 ? 0 : lineVatCents(alloc.grossCents, line.vatRatePct);
        correction += newVat - alloc.vatCents;
        await client.query(`update allocations set vat_cents = $2, net_cents = $3 where payment_id = $1 and line_id = $4`, [alloc.paymentId, newVat, alloc.grossCents - newVat, alloc.lineId]);
      }
      stageCorrections[payment.stage] = correction;
    }
    await client.query(
      `update orders set lines = $2, total_cents = $3, vat_cents = $4, config = $5, stage_corrections = $6 where id = $1`,
      [orderId, JSON.stringify(lines), totalCents, vatCents, JSON.stringify({ ...order.config, fulfilment: 'workshop' }), JSON.stringify(stageCorrections)],
    );

    // Re-spread the unpaid balance over the unpaid stages.
    const paymentsRow = await client.query<{ stage: Stage; status: string }>(`select stage, status from payments where order_id = $1`, [orderId]);
    const unpaid = STAGES.filter((s) => paymentsRow.rows.find((p) => p.stage === s)?.status !== 'paid');
    const paidCents = (await client.query<{ s: number }>(`select sum(amount_cents)::int as s from payments where order_id = $1 and status = 'paid'`, [orderId])).rows[0]!.s;
    if (unpaid.length > 0) {
      const balance = totalCents - paidCents;
      const amounts = levelAmounts(balance, unpaid.length);
      for (let i = 0; i < unpaid.length; i++) {
        await client.query(`update payments set amount_cents = $3 where order_id = $1 and stage = $2`, [orderId, unpaid[i], amounts[i]]);
      }
    }
  });

  // One VAT correction mail only when the correction is not zero.
  const updated = await loadAggregate(config, orderId);
  const corrections = (updated!.order as OrderRecordWithCorrections).stageCorrections ?? {};
  const totalCorrection = Object.values(corrections).reduce((s, v) => s + v, 0);
  if (totalCorrection !== 0) {
    const factKey = `vatcorrection:${orderId}`;
    if (await recordMailFact(config, factKey)) {
      const user = await query<{ email: string }>(config, 'select email from users where id = $1', [o.userId]);
      const beforeVat = new Map<string, number>();
      for (const p of updated!.payments.filter((x) => x.status === 'paid')) {
        const allocs = updated!.allocations.filter((a) => a.paymentId === p.id);
        beforeVat.set(p.stage, allocs.reduce((sum, a) => sum + (a.vatCents - (corrections[p.stage] ?? 0)), 0));
      }
      const perStage = updated!.payments
        .filter((p) => p.status === 'paid')
        .map((p) => `${STAGE_LABEL[p.stage]}: VAT before ${formatCents(beforeVat.get(p.stage) ?? 0)} paid, after ${formatCents((beforeVat.get(p.stage) ?? 0) + (corrections[p.stage] ?? 0))} paid`)
        .join('\n');
      await queueMail(config, {
        id: newId('mail'),
        toEmail: user.rows[0]!.email,
        subject: `VAT correction for order ${o.number}: ${formatCents(totalCorrection)}`,
        body: [perStage, `Correction: ${formatCents(totalCorrection)} corrected`].join('\n'),
      });
    }
  }
  const final = await loadAggregate(config, orderId);
  return { status: 200, body: serialiseOrder(final!, nowMs) };
}

type OrderRecordWithCorrections = { stageCorrections?: Record<string, number> };
const STAGE_LABEL: Record<Stage, string> = { 'deposit': 'Deposit', 'instalment-1': 'Instalment 1', 'instalment-2': 'Instalment 2', 'instalment-3': 'Instalment 3' };

// Desk transitions.
export async function deskTransition(config: Config, orderId: string, to: string): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  const agg = await loadAggregate(config, orderId);
  if (!agg) throw new LifecycleError('not_found', 404);
  const o = agg.order;
  if (o.state === 'in arrears') throw new LifecycleError('in_arrears', 409);
  if (o.state !== 'paid in full') throw new LifecycleError('illegal_transition', 409);
  if (to === 'kit dispatched' && (o.kind !== 'kit' || o.config?.fulfilment !== 'posted')) throw new LifecycleError('illegal_transition', 409);
  if (to === 'fitted' && o.kind === 'kit' && o.config?.fulfilment !== 'workshop') throw new LifecycleError('illegal_transition', 409);
  await query(config, `update orders set state = $2 where id = $1`, [orderId, to as OrderState]);
  const updated = await loadAggregate(config, orderId);
  return { status: 200, body: serialiseOrder(updated!, nowMs) };
}

export async function markDelivered(config: Config, orderId: string, deliveredOn: string, orderCountry: string): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  const agg = await loadAggregate(config, orderId);
  if (!agg) throw new LifecycleError('not_found', 404);
  if (agg.order.state !== 'kit dispatched') throw new LifecycleError('illegal_transition', 409);
  if (agg.order.deliveredOn !== null) throw new LifecycleError('illegal_transition', 409);
  const deadline = withdrawalDeadlineFor(deliveredOn, orderCountry);
  await query(config, `update orders set delivered_on = $2, withdrawal_deadline = $3 where id = $1`, [orderId, deliveredOn, new Date(deadline).toISOString()]);
  const updated = await loadAggregate(config, orderId);
  return { status: 200, body: serialiseOrder(updated!, nowMs) };
}

// Inspection: fresh registry read; only the new class and plate colour pass.
export async function recordInspection(
  config: Config, registry: Registry, registryUp: boolean, orderId: string,
): Promise<{ status: number; body: ApiOrder }> {
  const nowMs = shopNowMs(config);
  const agg = await loadAggregate(config, orderId);
  if (!agg) throw new LifecycleError('not_found', 404);
  const o = agg.order;
  const isClassMove = o.config !== null && o.donor !== null && o.donor.roadClass !== o.config.roadClass;
  if (!isClassMove || !['kit dispatched', 'fitted'].includes(o.state)) throw new LifecycleError('illegal_transition', 409);
  if (o.state === 'inspection passed') {
    const updated = await loadAggregate(config, orderId);
    return { status: 200, body: serialiseOrder(updated!, nowMs) };
  }
  if (!registryUp) throw new LifecycleError('registry_unreachable', 503);

  let record: Awaited<ReturnType<Registry['lookup']>>;
  try {
    record = await registry.lookup(o.donor!.plate, o.donor!.country);
  } catch {
    throw new LifecycleError('registry_unreachable', 503);
  }
  const requiredColour = o.donor!.country === 'NL' ? 'yellow' : 'white';
  if (record.roadClass !== 45 || record.plateColour !== requiredColour) {
    throw new LifecycleError('registry_not_updated', 409);
  }

  await query(config, `update orders set state = 'inspection passed' where id = $1`, [orderId]);

  const factKey = `inspection:${orderId}`;
  if (await recordMailFact(config, factKey)) {
    const user = await query<{ email: string }>(config, 'select email from users where id = $1', [o.userId]);
    const feeLine = o.lines.find((l) => l.code.startsWith('INSPECT'));
    await queueMail(config, {
      id: newId('mail'),
      toEmail: user.rows[0]!.email,
      subject: `Inspection recorded for order ${o.number}`,
      body: [
        `Plate: ${o.donor!.plate}`,
        `New class name: ${classNameFor(o.donor!.country, 45)}`,
        `Inspection fee: ${formatCents(feeLine?.grossCents ?? 0)} paid`,
      ].join('\n'),
    });
  }
  const updated = await loadAggregate(config, orderId);
  return { status: 200, body: serialiseOrder(updated!, nowMs) };
}
