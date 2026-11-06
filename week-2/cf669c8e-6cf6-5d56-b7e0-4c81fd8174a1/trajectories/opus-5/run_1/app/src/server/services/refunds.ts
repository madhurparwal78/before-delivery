/**
 * Partial refunds.
 *
 * A refund names one line and draws from that line's allocation on the latest
 * confirmed payment first, then earlier ones, making one Kill Bill refund per
 * payment drawn on. Each draw is believed independently; the refund stays
 * `pending` until Kill Bill has settled every one.
 *
 * `planDraws` is the single authority on how much a line can give back, so
 * parallel refunds can never jointly exceed it: the plan is built under the
 * order's row lock and draws already in flight count against the allocation.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { RefundStatus, StageName } from '../../shared/types.js';
import { reverseVatForDraw } from '../domain/money.js';
import { isLockedStatus } from '../domain/schedule.js';
import { poolQueryable, transact } from '../db/pool.js';
import {
  KillbillRefused,
  KillbillUnreachable,
  killbillStatus,
  refund as killbillRefund,
} from '../providers/killbill.js';
import { claimMail, creditNoteMail, flushMail } from '../providers/mail.js';
import {
  assembleLines,
  assembleOrder,
  assembleStages,
  loadOrder,
  loadOrderForUpdate,
  recomputeOrder,
  type DrawRow,
  type LoadedOrder,
} from '../store/orders.js';
import { conflict, notFound, paymentsPaused, ValidationError } from '../http/errors.js';
import type { Answer } from './idempotency.js';

export const OVER_COLLECTED_MESSAGE = 'That is more than this line has collected.';
export const BAD_AMOUNT_MESSAGE = 'Enter an amount like 12.50.';

export interface PlannedDraw {
  stage: StageName;
  amountCents: number;
  vatCents: number;
}

export interface SendableDraw {
  id: string;
  killbillPaymentId: string;
  amountCents: number;
  externalKey: string;
}

/**
 * What a line still has available to refund: money confirmed on it, less
 * returned draws and less draws already in flight.
 */
export function availableOnLine(loaded: LoadedOrder, lineId: string): number {
  const stages = assembleStages(loaded);
  const lines = assembleLines(loaded, stages);
  const line = lines.find((row) => row.id === lineId);
  if (!line) throw notFound();
  const inFlight = loaded.draws
    .filter((draw) => draw.line_id === lineId && draw.status === 'pending')
    .reduce((sum, draw) => sum + draw.amount_cents, 0);
  return line.collectedCents - inFlight;
}

/**
 * Gross and VAT already drawn from one stage's allocation on a line. A failed
 * draw's money counts as undrawn again, so it is left out.
 */
function drawnFromAllocation(
  draws: readonly DrawRow[],
  stage: StageName,
  lineId: string,
): { grossCents: number; vatCents: number } {
  return draws
    .filter((draw) => draw.stage === stage && draw.line_id === lineId && draw.status !== 'failed')
    .reduce(
      (total, draw) => ({
        grossCents: total.grossCents + draw.amount_cents,
        vatCents: total.vatCents + draw.vat_cents,
      }),
      { grossCents: 0, vatCents: 0 },
    );
}

/**
 * Plan the draws, latest confirmed payment first.
 *
 * Throws the published amount refusal when the line's allocations cannot cover
 * the amount, which is what caps parallel refunds.
 */
export function planDraws(loaded: LoadedOrder, lineId: string, amountCents: number): PlannedDraw[] {
  const line = loaded.lines.find((row) => row.id === lineId);
  if (!line) throw notFound();

  const stages = assembleStages(loaded);
  const confirmed = loaded.stages
    .filter((stage) => isLockedStatus(stage.status))
    .sort((a, b) => b.position - a.position);

  const planned: PlannedDraw[] = [];
  let outstanding = amountCents;

  for (const stage of confirmed) {
    if (outstanding <= 0) break;
    const allocation = stages
      .find((row) => row.stage === stage.stage)
      ?.allocations.find((row) => row.lineId === lineId);
    if (!allocation) continue;

    const drawn = drawnFromAllocation(loaded.draws, stage.stage, lineId);
    const remainingGross = allocation.grossCents - drawn.grossCents;
    const remainingVat = allocation.vatCents - drawn.vatCents;
    if (remainingGross <= 0) continue;

    const take = Math.min(remainingGross, outstanding);
    planned.push({
      stage: stage.stage,
      amountCents: take,
      vatCents: reverseVatForDraw(take, remainingGross, remainingVat, line.vat_rate_pct),
    });
    outstanding -= take;
  }

  if (outstanding > 0) throw new ValidationError({ amountCents: OVER_COLLECTED_MESSAGE });
  return planned;
}

/** The Kill Bill payment each confirmed stage was collected on. */
async function paymentIdsByStage(client: PoolClient, orderId: string): Promise<Map<StageName, string>> {
  const rows = await client.query<{ stage: StageName; killbill_payment_id: string }>(
    `SELECT stage, killbill_payment_id FROM payments
     WHERE order_id = $1 AND status = 'paid' AND killbill_payment_id IS NOT NULL`,
    [orderId],
  );
  return new Map(rows.rows.map((row) => [row.stage, row.killbill_payment_id]));
}

/** State refusals, which come before the amount refusal in the published order. */
function guardRefundState(loaded: LoadedOrder, lineId: string): void {
  const { order, lines, stages } = loaded;

  const line = lines.find((row) => row.id === lineId);
  if (!line) throw notFound();

  if (order.state === 'quoted') throw conflict('illegal_transition');

  // On a withdrawn order only money a failed draw left on the line can go back.
  if (order.state === 'withdrawn' && availableOnLine(loaded, lineId) <= 0) {
    throw conflict('illegal_transition');
  }

  if (stages.some((stage) => stage.status === 'pending')) throw conflict('payment_in_flight');

  if (order.state === 'inspection passed' && line.code.startsWith('INSPECT-')) {
    throw conflict('fee_already_spent');
  }
}

export interface RefundRequest {
  orderId: string;
  lineId: string;
  amountCents: number;
  /** `<user id>:<idempotency key>`, which each draw suffixes with its number. */
  externalKeyPrefix: string;
}

export async function requestRefund(
  request: RefundRequest,
  markProviderCalled: () => void,
): Promise<Answer> {
  const { orderId, lineId, amountCents, externalKeyPrefix } = request;

  const claimed = await transact(async (client) => {
    const loaded = await loadOrderForUpdate(client, orderId);
    if (!loaded) throw notFound();

    guardRefundState(loaded, lineId);

    if (!Number.isInteger(amountCents) || amountCents < 1) {
      throw new ValidationError({ amountCents: BAD_AMOUNT_MESSAGE });
    }
    const planned = planDraws(loaded, lineId, amountCents);

    if (killbillStatus() === 'down') throw paymentsPaused();

    const paymentIds = await paymentIdsByStage(client, orderId);
    const refundId = randomUUID();
    await client.query(
      `INSERT INTO refunds(id, order_id, line_id, amount_cents, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [refundId, orderId, lineId, amountCents],
    );

    const sendable: SendableDraw[] = [];
    for (const [index, draw] of planned.entries()) {
      const drawId = randomUUID();
      const externalKey = `${externalKeyPrefix}:${index + 1}`;
      const killbillPaymentId = paymentIds.get(draw.stage) ?? null;
      await client.query(
        `INSERT INTO refund_draws(id, refund_id, order_id, stage, line_id, killbill_payment_id, external_key, amount_cents, vat_cents, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
        [drawId, refundId, orderId, draw.stage, lineId, killbillPaymentId, externalKey, draw.amountCents, draw.vatCents],
      );
      if (killbillPaymentId) {
        sendable.push({ id: drawId, killbillPaymentId, amountCents: draw.amountCents, externalKey });
      }
    }

    return sendable;
  });

  markProviderCalled();
  await sendDraws(claimed);

  const loaded = await loadOrder(poolQueryable, orderId);
  if (!loaded) throw notFound();
  return { status: 202, body: assembleOrder(loaded) };
}

/**
 * Send each planned draw. A Kill Bill 4xx marks only that draw failed and the
 * others proceed; if Kill Bill becomes unreachable partway, the unsent draws
 * stay pending and go out with their same external keys when it returns.
 */
export async function sendDraws(draws: readonly SendableDraw[]): Promise<void> {
  let claimedMail = false;

  for (const draw of draws) {
    try {
      const payment = await killbillRefund(draw.killbillPaymentId, draw.amountCents, draw.externalKey);
      const transaction = payment.transactions.find((row) => row.transactionExternalKey === draw.externalKey);
      await transact(async (client) => {
        await client.query('UPDATE refund_draws SET sent = true, killbill_transaction_id = $2 WHERE id = $1', [
          draw.id,
          transaction?.transactionId ?? null,
        ]);
      });
    } catch (error) {
      if (error instanceof KillbillUnreachable) return;
      if (!(error instanceof KillbillRefused)) throw error;
      const settled = await transact(async (client) => {
        const row = await client.query<{ order_id: string; refund_id: string }>(
          "UPDATE refund_draws SET status = 'failed', sent = true WHERE id = $1 RETURNING order_id, refund_id",
          [draw.id],
        );
        const found = row.rows[0];
        return found ? settleRefundIfComplete(client, found.order_id, found.refund_id) : false;
      });
      if (settled) claimedMail = true;
    }
  }

  if (claimedMail) void flushMail().catch(() => undefined);
}

/** Draws whose Kill Bill request has not gone out yet, for the retry worker. */
export async function unsentDraws(client: PoolClient): Promise<SendableDraw[]> {
  const rows = await client.query<{
    id: string;
    killbill_payment_id: string;
    amount_cents: number;
    external_key: string;
  }>(
    `SELECT id, killbill_payment_id, amount_cents, external_key FROM refund_draws
     WHERE sent = false AND status = 'pending' AND killbill_payment_id IS NOT NULL
     ORDER BY created_at`,
  );
  return rows.rows.map((row) => ({
    id: row.id,
    killbillPaymentId: row.killbill_payment_id,
    amountCents: row.amount_cents,
    externalKey: row.external_key,
  }));
}

function statusFor(returnedCents: number, failedCents: number): RefundStatus {
  if (failedCents === 0) return 'returned';
  return returnedCents === 0 ? 'failed' : 'partly returned';
}

/**
 * Settle a refund once Kill Bill has answered for every draw.
 *
 * Returns true when a credit note was claimed, so the caller flushes mail.
 */
export async function settleRefundIfComplete(
  client: PoolClient,
  orderId: string,
  refundId: string,
): Promise<boolean> {
  const draws = await client.query<{ amount_cents: number; vat_cents: number; status: string }>(
    'SELECT amount_cents, vat_cents, status FROM refund_draws WHERE refund_id = $1',
    [refundId],
  );
  if (draws.rows.length === 0) return false;
  if (draws.rows.some((draw) => draw.status === 'pending')) return false;

  const current = await client.query<{ status: RefundStatus; line_id: string }>(
    'SELECT status, line_id FROM refunds WHERE id = $1 FOR UPDATE',
    [refundId],
  );
  const refundRow = current.rows[0];
  if (!refundRow || refundRow.status !== 'pending') return false;

  const returned = draws.rows.filter((draw) => draw.status === 'returned');
  const returnedCents = returned.reduce((sum, draw) => sum + draw.amount_cents, 0);
  const returnedVatCents = returned.reduce((sum, draw) => sum + draw.vat_cents, 0);
  const failedCents = draws.rows
    .filter((draw) => draw.status === 'failed')
    .reduce((sum, draw) => sum + draw.amount_cents, 0);

  await client.query('UPDATE refunds SET status = $2 WHERE id = $1', [
    refundId,
    statusFor(returnedCents, failedCents),
  ]);

  // All failed: no change, no flag and no mail.
  if (returnedCents === 0) return false;

  await client.query(
    'UPDATE order_lines SET gross_cents = gross_cents - $2, vat_cents = vat_cents - $3 WHERE id = $1',
    [refundRow.line_id, returnedCents, returnedVatCents],
  );
  await client.query('UPDATE orders SET partly_refunded = true WHERE id = $1', [orderId]);
  await recomputeOrder(client, orderId);

  const details = await client.query<{ number: string; email: string; line_name: string }>(
    `SELECT o.number, u.email, l.name AS line_name
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN order_lines l ON l.id = $2
     WHERE o.id = $1`,
    [orderId, refundRow.line_id],
  );
  const detail = details.rows[0];
  if (!detail) return false;

  // One credit note for the returned amount.
  return claimMail(
    client,
    creditNoteMail({
      orderNumber: detail.number,
      recipient: detail.email,
      refundId,
      lineName: detail.line_name,
      returnedCents,
      vatReversedCents: returnedVatCents,
    }),
  );
}
