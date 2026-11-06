/**
 * Order creation and the transitions along the published order machine.
 *
 * Every state move is decided here, and anything the machine does not allow
 * answers its published rejection.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import {
  CLASS_MOVE_PLATE_COLOUR,
  FIXED_LINES,
  ROAD_CLASS_NAMES,
  VAT_RATE_PCT,
  bikeById,
  hubById,
  packById,
} from '../../shared/seed.js';
import { STAGE_LABELS } from '../../shared/seed.js';
import type {
  Config,
  DeliveryCountry,
  Fulfilment,
  Order,
  OrderState,
  PlanInput,
  RoadClass,
  Units,
  User,
} from '../../shared/types.js';
import { amsterdamDate, isIsoDate, shopNow } from '../domain/clock.js';
import { checkFit } from '../domain/fit.js';
import { extractVat, reverseVatForDraw } from '../domain/money.js';
import {
  bikeLines,
  buildBikeQuote,
  buildKitQuote,
  isClassMove,
  kitLines,
  kitNotices,
} from '../domain/quote.js';
import { isLockedStatus } from '../domain/schedule.js';
import { isWithdrawalOpen, withdrawalDeadline } from '../domain/withdrawal.js';
import { poolQueryable, transact } from '../db/pool.js';
import { killbillStatus } from '../providers/killbill.js';
import { lookupPlate } from '../providers/registry.js';
import { claimMail, flushMail, inspectionRecordMail, vatCorrectionMail } from '../providers/mail.js';
import {
  assembleLines,
  assembleOrder,
  assembleStages,
  insertOrder,
  loadOrder,
  loadOrderForUpdate,
  recomputeOrder,
  requoteOrder,
  type LoadedOrder,
} from '../store/orders.js';
import { ApiError, conflict, notFound, paymentsPaused, registryUnreachable, ValidationError } from '../http/errors.js';
import { resolveDonor } from './donors.js';
import { sendDraws, type SendableDraw } from './refunds.js';
import type { Answer } from './idempotency.js';

const MAX_NOTE_LENGTH = 500;
const DELIVERY_COUNTRIES: DeliveryCountry[] = ['NL', 'BE', 'DE', 'LU'];
const CLASS_DOWN_MESSAGE = 'A kit cannot move a scooter down a road class.';

export function validatePlan(plan: unknown): PlanInput {
  if (plan === null || typeof plan !== 'object') throw new ValidationError({ plan: 'Required.' });
  const input = plan as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const text = (field: string): string => {
    const value = input[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors[field] = 'Required.';
      return '';
    }
    return value.trim();
  };

  const name = text('name');
  const street = text('street');
  const postcode = text('postcode');
  const city = text('city');

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') errors.note = `Keep the note to ${MAX_NOTE_LENGTH} characters.`;
    else if (input.note.length > MAX_NOTE_LENGTH) {
      errors.note = `Keep the note to ${MAX_NOTE_LENGTH} characters.`;
    } else note = input.note;
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { name, street, postcode, city, note };
}

export function validateConfig(raw: unknown): Config {
  if (raw === null || typeof raw !== 'object') throw new ValidationError({ config: 'Required.' });
  const input = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const packId = typeof input.packId === 'string' ? input.packId : '';
  if (!packById(packId)) errors.packId = 'Pick a pack from the catalogue.';

  const hubId = typeof input.hubId === 'string' ? input.hubId : '';
  if (!hubById(hubId)) errors.hubId = 'Pick a hub from the catalogue.';

  const roadClass = Number(input.roadClass);
  if (roadClass !== 25 && roadClass !== 45) errors.roadClass = 'Enter 25 or 45.';

  const fulfilment = input.fulfilment as Fulfilment;
  if (fulfilment !== 'posted' && fulfilment !== 'workshop') {
    errors.fulfilment = 'Enter posted or workshop.';
  }

  const country = input.country as DeliveryCountry;
  if (!DELIVERY_COUNTRIES.includes(country)) errors.country = 'Enter NL, BE, DE or LU.';

  const units = input.units === 'imperial' ? 'imperial' : 'metric';

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  return {
    donor: input.donor as Config['donor'],
    packId,
    hubId,
    roadClass: roadClass as RoadClass,
    fulfilment,
    country,
    units: units as Units,
  };
}

/** A kit cannot move a scooter down a road class. */
function guardClassDirection(donorClass: RoadClass, targetClass: RoadClass): void {
  if (targetClass < donorClass) throw new ValidationError({ roadClass: CLASS_DOWN_MESSAGE });
}

export interface KitQuoteResult {
  quote: ReturnType<typeof buildKitQuote>;
  feeQuoteDate: string;
}

/** Build a kit quote, reading the registry fresh for a plate donor. */
export async function quoteKit(config: Config, units: Units): Promise<KitQuoteResult> {
  const donor = await resolveDonor(config.donor);
  guardClassDirection(donor.roadClass, config.roadClass);
  const feeQuoteDate = amsterdamDate();
  const fit = checkFit({
    donor,
    packId: config.packId,
    hubId: config.hubId,
    roadClass: config.roadClass,
    units,
  });
  return {
    quote: buildKitQuote({
      donor,
      packId: config.packId,
      hubId: config.hubId,
      roadClass: config.roadClass,
      fulfilment: config.fulfilment,
      country: config.country,
      amsterdamDate: feeQuoteDate,
      fit,
    }),
    feeQuoteDate,
  };
}

export interface CreateOrderRequest {
  user: User;
  kind: unknown;
  config: unknown;
  bikeId: unknown;
  plan: unknown;
  expectedTotalCents: unknown;
}

export async function createOrder(request: CreateOrderRequest): Promise<Order> {
  const plan = validatePlan(request.plan);

  if (request.expectedTotalCents === undefined || request.expectedTotalCents === null) {
    throw new ValidationError({ expectedTotalCents: 'Required.' });
  }
  const expected = Number(request.expectedTotalCents);
  if (!Number.isInteger(expected)) throw new ValidationError({ expectedTotalCents: 'Required.' });

  if (request.kind === 'bike') {
    const bikeId = typeof request.bikeId === 'string' ? request.bikeId : '';
    if (!bikeById(bikeId)) throw new ValidationError({ bikeId: 'Pick a bike from the catalogue.' });

    const quote = buildBikeQuote(bikeId);
    if (quote.totalCents !== expected) throw conflict('quote_changed');

    const orderId = await transact((client) =>
      insertOrder(client, {
        userId: request.user.id,
        kind: 'bike',
        drafts: bikeLines(bikeId),
        plan,
        donor: null,
        config: null,
        bikeId,
        notices: [],
        feeQuoteDate: null,
        fitVerdict: null,
      }),
    );
    return readOrder(orderId);
  }

  if (request.kind !== 'kit') throw new ValidationError({ kind: 'Enter kit or bike.' });

  const config = validateConfig(request.config);
  const donor = await resolveDonor(config.donor);
  guardClassDirection(donor.roadClass, config.roadClass);

  const feeQuoteDate = amsterdamDate();
  const fit = checkFit({
    donor,
    packId: config.packId,
    hubId: config.hubId,
    roadClass: config.roadClass,
    units: config.units ?? 'metric',
  });
  const quote = buildKitQuote({
    donor,
    packId: config.packId,
    hubId: config.hubId,
    roadClass: config.roadClass,
    fulfilment: config.fulfilment,
    country: config.country,
    amsterdamDate: feeQuoteDate,
    fit,
  });

  // A differing total at order creation is refused and creates nothing.
  if (quote.totalCents !== expected) throw conflict('quote_changed');

  const orderId = await transact((client) =>
    insertOrder(client, {
      userId: request.user.id,
      kind: 'kit',
      drafts: kitLines(
        config.packId,
        config.hubId,
        donor.roadClass,
        config.roadClass,
        donor.country,
        config.fulfilment,
        config.country,
        feeQuoteDate,
      ),
      plan,
      donor,
      config,
      bikeId: null,
      notices: kitNotices(donor.roadClass, config.roadClass),
      feeQuoteDate,
      fitVerdict: fit.verdict,
    }),
  );
  return readOrder(orderId);
}

export async function readOrder(orderId: string): Promise<Order> {
  const loaded = await loadOrder(poolQueryable, orderId);
  if (!loaded) throw notFound();
  return assembleOrder(loaded);
}

export async function loadOwned(userId: string, orderId: string): Promise<LoadedOrder> {
  const loaded = await loadOrder(poolQueryable, orderId);
  if (!loaded || loaded.order.user_id !== userId) throw notFound();
  return loaded;
}

export interface PatchOrderRequest {
  userId: string;
  orderId: string;
  planVersion: unknown;
  plan?: unknown;
  config?: unknown;
}

/** `config` may change fulfilment and country only, and only while `quoted`. */
export async function patchOrder(request: PatchOrderRequest): Promise<Order> {
  return transact(async (client) => {
    const loaded = await loadOrderForUpdate(client, request.orderId);
    if (!loaded || loaded.order.user_id !== request.userId) throw notFound();

    if (Number(request.planVersion) !== loaded.order.plan_version) {
      throw new ApiError(412, 'stale_version');
    }
    if (request.config !== undefined && loaded.order.state !== 'quoted') {
      throw conflict('quote_locked');
    }

    if (request.plan !== undefined) {
      const plan = validatePlan(request.plan);
      await client.query('UPDATE orders SET plan = $2 WHERE id = $1', [request.orderId, JSON.stringify(plan)]);
    }

    if (request.config !== undefined) {
      await applyConfigChange(client, loaded, request.config);
    }

    await client.query('UPDATE orders SET plan_version = plan_version + 1 WHERE id = $1', [request.orderId]);

    const after = await loadOrder(client, request.orderId);
    if (!after) throw notFound();
    return assembleOrder(after);
  });
}

async function applyConfigChange(client: PoolClient, loaded: LoadedOrder, raw: unknown): Promise<void> {
  const current = loaded.order.config;
  const donor = loaded.order.donor;
  if (!current || !donor) throw conflict('quote_locked');

  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const fulfilment = input.fulfilment === undefined ? current.fulfilment : (input.fulfilment as Fulfilment);
  if (fulfilment !== 'posted' && fulfilment !== 'workshop') errors.fulfilment = 'Enter posted or workshop.';

  const country = input.country === undefined ? current.country : (input.country as DeliveryCountry);
  if (!DELIVERY_COUNTRIES.includes(country)) errors.country = 'Enter NL, BE, DE or LU.';

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const next: Config = { ...current, fulfilment, country };
  const today = amsterdamDate();
  await requoteOrder(
    client,
    loaded.order.id,
    kitLines(
      next.packId,
      next.hubId,
      donor.roadClass,
      next.roadClass,
      donor.country,
      next.fulfilment,
      next.country,
      today,
    ),
    { config: next, notices: kitNotices(donor.roadClass, next.roadClass), feeQuoteDate: today },
  );
}

/**
 * Withdrawal. Allowed from any state before `fitted` or `inspection passed`,
 * and for a delivered posted kit until the rolled-forward deadline. Every line
 * with collected money gets one refund of that money.
 */
export async function withdrawOrder(
  userId: string,
  orderId: string,
  externalKeyPrefix: string,
  markProviderCalled: () => void,
): Promise<Answer> {
  const planned = await transact(async (client) => {
    const loaded = await loadOrderForUpdate(client, orderId);
    if (!loaded || loaded.order.user_id !== userId) throw notFound();

    const { order } = loaded;
    if (order.state === 'fitted' || order.state === 'inspection passed' || order.state === 'withdrawn') {
      throw conflict('illegal_transition');
    }

    const deadline = withdrawalDeadline(order.delivered_on, order.config?.country ?? 'NL');
    if (!isWithdrawalOpen(order.state, deadline, shopNow())) throw conflict('withdrawal_closed');

    if (loaded.stages.some((stage) => stage.status === 'pending')) throw conflict('payment_in_flight');
    if (loaded.refunds.some((refund) => refund.status === 'pending')) throw conflict('payment_in_flight');

    const stages = assembleStages(loaded);
    const lines = assembleLines(loaded, stages);
    const owed = lines.filter((line) => line.collectedCents > 0);

    // Money must go back, so Kill Bill has to be there.
    if (owed.length > 0 && killbillStatus() === 'down') throw paymentsPaused();

    await client.query("UPDATE orders SET state = 'withdrawn' WHERE id = $1", [orderId]);

    const paymentIds = await client.query<{ stage: string; killbill_payment_id: string }>(
      `SELECT stage, killbill_payment_id FROM payments
       WHERE order_id = $1 AND status = 'paid' AND killbill_payment_id IS NOT NULL`,
      [orderId],
    );
    const byStage = new Map(paymentIds.rows.map((row) => [row.stage, row.killbill_payment_id]));

    const sendable: SendableDraw[] = [];
    let drawNumber = 0;

    for (const line of owed) {
      const refundId = randomUUID();
      await client.query(
        `INSERT INTO refunds(id, order_id, line_id, amount_cents, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [refundId, orderId, line.id, line.collectedCents],
      );

      const confirmed = [...loaded.stages]
        .filter((stage) => isLockedStatus(stage.status))
        .sort((a, b) => b.position - a.position);

      let outstanding = line.collectedCents;
      for (const stage of confirmed) {
        if (outstanding <= 0) break;
        const allocation = stages
          .find((row) => row.stage === stage.stage)
          ?.allocations.find((row) => row.lineId === line.id);
        if (!allocation || allocation.grossCents <= 0) continue;

        const take = Math.min(allocation.grossCents, outstanding);
        drawNumber += 1;
        const externalKey = `${externalKeyPrefix}:${drawNumber}`;
        const drawId = randomUUID();
        const killbillPaymentId = byStage.get(stage.stage) ?? null;
        await client.query(
          `INSERT INTO refund_draws(id, refund_id, order_id, stage, line_id, killbill_payment_id, external_key, amount_cents, vat_cents, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
          [
            drawId,
            refundId,
            orderId,
            stage.stage,
            line.id,
            killbillPaymentId,
            externalKey,
            take,
            reverseVatForDraw(take, allocation.grossCents, allocation.vatCents, line.vatRatePct),
          ],
        );
        if (killbillPaymentId) {
          sendable.push({ id: drawId, killbillPaymentId, amountCents: take, externalKey });
        }
        outstanding -= take;
      }
    }

    return sendable;
  });

  if (planned.length > 0) {
    markProviderCalled();
    await sendDraws(planned);
  }

  return { status: 200, body: await readOrder(orderId) };
}

/**
 * Switching a posted kit to workshop fitting. Makes no Kill Bill transaction,
 * so it works while Kill Bill is down.
 */
export async function switchToWorkshop(userId: string, orderId: string): Promise<Order> {
  const claimedMail = await transact(async (client) => {
    const loaded = await loadOrderForUpdate(client, orderId);
    if (!loaded || loaded.order.user_id !== userId) throw notFound();

    const { order } = loaded;
    const allowed: OrderState[] = ['deposit confirmed', 'instalments running'];
    if (order.kind !== 'kit' || order.config?.fulfilment !== 'posted' || !allowed.includes(order.state)) {
      throw conflict('illegal_transition');
    }
    // No refund may ever have read returned or partly returned.
    if (loaded.refunds.some((refund) => refund.status === 'returned' || refund.status === 'partly returned')) {
      throw conflict('illegal_transition');
    }
    if (loaded.stages.some((stage) => stage.status === 'pending')) throw conflict('payment_in_flight');
    if (loaded.refunds.some((refund) => refund.status === 'pending')) throw conflict('payment_in_flight');

    const newRate = VAT_RATE_PCT.NL;

    // The POST line becomes FIT in place, keeping its id and position.
    const postLine = loaded.lines.find((line) => line.code === 'POST');
    if (!postLine) throw conflict('illegal_transition');
    await client.query(
      `UPDATE order_lines SET code = 'FIT', name = $2, gross_cents = $3 WHERE id = $1`,
      [postLine.id, FIXED_LINES.FIT.name, FIXED_LINES.FIT.grossCents],
    );

    // All VAT-bearing lines move to the new rate, with line VAT from gross.
    for (const line of loaded.lines) {
      if (line.vat_rate_pct === 0) continue;
      const grossCents = line.id === postLine.id ? FIXED_LINES.FIT.grossCents : line.gross_cents;
      await client.query('UPDATE order_lines SET vat_rate_pct = $2, vat_cents = $3 WHERE id = $1', [
        line.id,
        newRate,
        extractVat(grossCents, newRate),
      ]);
    }

    // Confirmed stage amounts never change; their allocation VAT is recomputed
    // from gross at the new rate, and each stage records its difference.
    const stages = assembleStages(loaded);
    const corrections: { label: string; oldVatCents: number; newVatCents: number }[] = [];
    let totalCorrection = 0;

    for (const stage of loaded.stages) {
      if (!isLockedStatus(stage.status)) continue;
      const allocations = stages.find((row) => row.stage === stage.stage)?.allocations ?? [];
      let oldVat = 0;
      let newVat = 0;
      for (const allocation of allocations) {
        const line = loaded.lines.find((row) => row.id === allocation.lineId);
        if (!line) continue;
        const rate = line.vat_rate_pct === 0 ? 0 : newRate;
        const recomputed = extractVat(allocation.grossCents, rate);
        oldVat += allocation.vatCents;
        newVat += recomputed;
        await client.query(
          'UPDATE stage_allocations SET vat_cents = $4 WHERE order_id = $1 AND stage = $2 AND line_id = $3',
          [orderId, stage.stage, allocation.lineId, recomputed],
        );
      }
      const correction = newVat - oldVat;
      totalCorrection += correction;
      corrections.push({ label: STAGE_LABELS[stage.stage], oldVatCents: oldVat, newVatCents: newVat });
      await client.query(
        'UPDATE order_stages SET vat_corrected_cents = $3 WHERE order_id = $1 AND stage = $2',
        [orderId, stage.stage, correction],
      );
    }

    const nextConfig: Config = { ...order.config, fulfilment: 'workshop' };
    await client.query('UPDATE orders SET config = $2 WHERE id = $1', [
      orderId,
      JSON.stringify(nextConfig),
    ]);

    // Due dates and attempts stay; only the unpaid balance is re-spread.
    await recomputeOrder(client, orderId);

    if (totalCorrection === 0) return false;

    const details = await client.query<{ number: string; email: string }>(
      `SELECT o.number, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [orderId],
    );
    const detail = details.rows[0];
    if (!detail) return false;

    return claimMail(
      client,
      vatCorrectionMail({
        orderNumber: detail.number,
        recipient: detail.email,
        orderId,
        correctionCents: totalCorrection,
        stages: corrections,
      }),
    );
  });

  if (claimedMail) void flushMail().catch(() => undefined);
  return readOrder(orderId);
}

/** Fitter transitions out of `paid in full`. */
export async function deskTransition(orderId: string, to: unknown): Promise<Order> {
  return transact(async (client) => {
    const loaded = await loadOrderForUpdate(client, orderId);
    if (!loaded) throw notFound();

    if (to !== 'kit dispatched' && to !== 'fitted') throw conflict('illegal_transition');
    if (loaded.order.state === 'in arrears') throw conflict('in_arrears');
    if (loaded.order.state !== 'paid in full') throw conflict('illegal_transition');

    const posted = loaded.order.config?.fulfilment !== 'workshop' && loaded.order.kind === 'kit';
    const expected: OrderState = posted ? 'kit dispatched' : 'fitted';
    if (to !== expected) throw conflict('illegal_transition');

    await client.query('UPDATE orders SET state = $2 WHERE id = $1', [orderId, to]);
    const after = await loadOrder(client, orderId);
    if (!after) throw notFound();
    return assembleOrder(after);
  });
}

/** Delivery is recorded only from `kit dispatched`, once. */
export async function recordDelivery(orderId: string, deliveredOn: unknown): Promise<Order> {
  return transact(async (client) => {
    const loaded = await loadOrderForUpdate(client, orderId);
    if (!loaded) throw notFound();

    if (loaded.order.state !== 'kit dispatched' || loaded.order.delivered_on !== null) {
      throw conflict('illegal_transition');
    }
    if (typeof deliveredOn !== 'string' || !isIsoDate(deliveredOn)) {
      throw new ValidationError({ deliveredOn: 'Enter a date as YYYY-MM-DD.' });
    }
    if (deliveredOn > amsterdamDate()) {
      throw new ValidationError({ deliveredOn: 'The delivery date cannot be in the future.' });
    }

    await client.query('UPDATE orders SET delivered_on = $2 WHERE id = $1', [orderId, deliveredOn]);
    const after = await loadOrder(client, orderId);
    if (!after) throw notFound();
    return assembleOrder(after);
  });
}

export interface InspectionResult {
  order: Order;
  outcome: 'recorded' | 'already';
}

/**
 * Inspection reads the plate fresh, with no stored or cached answer, and only
 * passes once the registry shows the new class and plate colour.
 */
export async function recordInspection(orderId: string): Promise<InspectionResult> {
  const loaded = await loadOrder(poolQueryable, orderId);
  if (!loaded) throw notFound();

  const { order } = loaded;
  const donor = order.donor;
  const config = order.config;
  if (order.kind !== 'kit' || !donor || !config || !isClassMove(donor.roadClass, config.roadClass)) {
    throw conflict('illegal_transition');
  }

  // Repeating on such an order returns the same with no new mail.
  if (order.state === 'inspection passed') {
    return { order: assembleOrder(loaded), outcome: 'already' };
  }
  if (order.state !== 'kit dispatched' && order.state !== 'fitted') {
    throw conflict('illegal_transition');
  }
  if (!donor.plate) throw conflict('illegal_transition');

  const fresh = await lookupPlate(donor.plate, donor.country);
  if (fresh.outcome === 'unreachable') throw registryUnreachable();
  if (fresh.outcome === 'not_found') throw conflict('registry_not_updated');
  if (
    fresh.record.roadClass !== 45 ||
    fresh.record.plateColour !== CLASS_MOVE_PLATE_COLOUR[donor.country]
  ) {
    throw conflict('registry_not_updated');
  }

  const claimedMail = await transact(async (client) => {
    const current = await loadOrderForUpdate(client, orderId);
    if (!current) throw notFound();
    // Simultaneous requests produce one state change and one mail.
    if (current.order.state === 'inspection passed') return false;

    await client.query("UPDATE orders SET state = 'inspection passed' WHERE id = $1", [orderId]);

    const feeLine = current.lines.find((line) => line.code.startsWith('INSPECT-'));
    const details = await client.query<{ number: string; email: string }>(
      `SELECT o.number, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [orderId],
    );
    const detail = details.rows[0];
    if (!detail) return false;

    return claimMail(
      client,
      inspectionRecordMail({
        orderNumber: detail.number,
        recipient: detail.email,
        orderId,
        plate: donor.plate ?? '',
        className: ROAD_CLASS_NAMES[donor.country][45],
        feeCents: feeLine?.gross_cents ?? 0,
      }),
    );
  });

  if (claimedMail) void flushMail().catch(() => undefined);
  return { order: await readOrder(orderId), outcome: 'recorded' };
}


