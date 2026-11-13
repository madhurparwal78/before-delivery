import { createHmac, timingSafeEqual } from 'node:crypto';
import { announceBox, checkStockThresholds, moveBox, syncSearch } from './boxes.js';
import { realNow } from './clock.js';
import { config } from './config.js';
import { inTransaction, query } from './db.js';
import { finishAuthorisation, transferClockNow } from './checkout.js';
import { paymentTransitionAllowed } from './domain.js';
import { fail } from './errors.js';
import { loadOrder, refundedSoFar, updateOrder, type OrderRow } from './orders.js';
import type { PaymentState } from '../shared/types.js';
import {
  completeCaptureIfConfirmed,
  lapseTransfer,
  markCaptureFailed,
  reserveRefund,
  settleRefundIfConfirmed,
  settleTransfer,
} from './payments.js';
import { sendRefundNotice } from './emails.js';
import * as gateway from './services/gateway.js';

export type CallbackType =
  | 'payment.authorised'
  | 'payment.declined'
  | 'payment.captured'
  | 'payment.capture_failed'
  | 'payment.voided'
  | 'payment.refunded'
  | 'transfer.received';

export interface CallbackBody {
  eventId: string;
  sequence: number;
  type: CallbackType;
  paymentId: string | null;
  transferId: string | null;
  reference: string;
  refundId: string | null;
  amountOre: number | null;
  declineCode: string | null;
  occurredAt: string;
}

const STALE_SECONDS = 300;

/** Verified on the raw body, with the published signature scheme. */
export function signatureAccepted(header: string | undefined, rawBody: Buffer): boolean {
  if (header === undefined) return false;
  const parts = new Map(
    header.split(',').map((piece) => {
      const index = piece.indexOf('=');
      return [piece.slice(0, index).trim(), piece.slice(index + 1).trim()] as [string, string];
    }),
  );
  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (timestamp === undefined || signature === undefined) return false;
  const seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(Math.floor(realNow().getTime() / 1000) - seconds) > STALE_SECONDS) return false;
  const expected = createHmac('sha256', config.gatewayCallbackSecret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const given = Buffer.from(signature, 'utf8');
  const mine = Buffer.from(expected, 'utf8');
  return given.length === mine.length && timingSafeEqual(given, mine);
}

export type CallbackOutcome = 'applied' | 'duplicate' | 'ignored' | 'waiting';

export async function applyCallback(body: CallbackBody): Promise<CallbackOutcome> {
  const order = await loadOrder(body.reference);
  if (order === null) throw fail(404, 'not_found');

  const inserted = await query(
    `INSERT INTO payment_callbacks (event_id, reference, sequence, type, payload, outcome)
       VALUES ($1, $2, $3, $4, $5, 'processing')
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [body.eventId, body.reference, body.sequence, body.type, JSON.stringify(body)],
  );
  if (inserted.length === 0) return 'duplicate';

  const outcome = await route(order, body);
  await query('UPDATE payment_callbacks SET outcome = $2 WHERE event_id = $1', [body.eventId, outcome]);
  if (outcome === 'applied' && body.sequence > order.last_sequence) {
    await query('UPDATE orders SET last_sequence = $2 WHERE reference = $1', [
      order.reference,
      body.sequence,
    ]);
  }
  return outcome;
}

async function route(order: OrderRow, body: CallbackBody): Promise<CallbackOutcome> {
  if (body.type === 'transfer.received') return applyTransferReceived(order, body);
  if (body.type === 'payment.refunded') return applyRefunded(order, body);
  if (body.sequence <= order.last_sequence) return 'ignored';

  const wanted = movesTo[body.type];
  if (!paymentTransitionAllowed(order.payment_state, wanted)) return 'ignored';

  switch (body.type) {
    case 'payment.authorised':
      return applyAuthorised(order, body);
    case 'payment.declined':
      await query(
        "UPDATE orders SET payment_state = 'declined', updated_at = now() WHERE reference = $1",
        [order.reference],
      );
      return 'applied';
    case 'payment.captured':
      await query('UPDATE orders SET gateway_captured = true WHERE reference = $1', [order.reference]);
      await completeCaptureIfConfirmed(order);
      await replayWaiting(order.reference);
      return 'applied';
    case 'payment.capture_failed':
      await markCaptureFailed(order);
      return 'applied';
    case 'payment.voided':
      return applyVoided(order);
  }
}

/** The payment state each callback type moves an order to. */
const movesTo: Record<
  Exclude<CallbackType, 'transfer.received' | 'payment.refunded'>,
  PaymentState
> = {
  'payment.authorised': 'authorised',
  'payment.declined': 'declined',
  'payment.captured': 'captured',
  'payment.capture_failed': 'capture_failed',
  'payment.voided': 'voided',
};

async function applyAuthorised(order: OrderRow, body: CallbackBody): Promise<CallbackOutcome> {
  const paymentId = body.paymentId ?? order.payment_id;
  if (paymentId === null) return 'ignored';
  try {
    await finishAuthorisation(order, paymentId);
  } catch {
    /* an authorisation after the hold ended is voided inside finishAuthorisation */
  }
  return 'applied';
}

async function applyVoided(order: OrderRow): Promise<CallbackOutcome> {
  await inTransaction(async (client) => {
    await moveBox(client, order.box_number, 'claimed', 'available');
    await updateOrder(client, order.reference, { payment_state: 'voided', live_claim: false });
  });
  announceBox(order.box_number, 'available');
  await syncSearch([order.box_number]);
  await checkStockThresholds();
  return 'applied';
}

/** A refund arriving before its capture waits for it. */
async function applyRefunded(order: OrderRow, body: CallbackBody): Promise<CallbackOutcome> {
  const known =
    body.refundId === null
      ? []
      : await query<{ refund_id: string }>(
          'SELECT refund_id FROM refunds WHERE gateway_refund_id = $1',
          [body.refundId],
        );
  const local = known[0];
  if (local !== undefined) {
    await query('UPDATE refunds SET gateway_confirmed = true WHERE refund_id = $1', [local.refund_id]);
    await settleRefundIfConfirmed(local.refund_id);
    return 'applied';
  }
  if (order.paid_at === null) return 'waiting';
  const amountOre = body.amountOre ?? 0;
  if (amountOre <= 0) return 'ignored';
  const left = order.gross_ore - (await refundedSoFar(order.reference)).grossOre;
  if (amountOre > left) return 'ignored';
  const reserved = await reserveRefund(order, amountOre);
  await query('UPDATE refunds SET gateway_refund_id = $2, gateway_confirmed = true WHERE refund_id = $1', [
    reserved.refund_id,
    body.refundId,
  ]);
  await settleRefundIfConfirmed(reserved.refund_id);
  return 'applied';
}

async function applyTransferReceived(order: OrderRow, body: CallbackBody): Promise<CallbackOutcome> {
  if (order.method !== 'bank') return 'ignored';
  const amountOre = body.amountOre ?? 0;
  const transferId = order.transfer_id;
  const deadline = order.transfer_deadline_at;

  if (order.payment_state === 'lapsed' || (deadline !== null && transferClockNow().getTime() > deadline.getTime())) {
    if (order.payment_state === 'pending') await lapseTransfer(order);
    if (transferId !== null) {
      await gateway.refundTransfer(transferId, amountOre, `${order.reference}-late-refund`);
    }
    await sendRefundNotice(order, amountOre).catch(() => undefined);
    return 'applied';
  }
  if (order.payment_state !== 'pending') return 'ignored';
  if (amountOre !== order.total_ore) {
    if (transferId !== null) {
      await gateway.returnTransfer(transferId, amountOre, `${order.reference}-return-${body.eventId}`);
    }
    await sendRefundNotice(order, amountOre).catch(() => undefined);
    return 'applied';
  }
  await settleTransfer(order);
  await replayWaiting(order.reference);
  return 'applied';
}

/** A refund that waited for its capture is applied once the capture lands. */
export async function replayWaiting(reference: string): Promise<void> {
  const rows = await query<{ event_id: string; payload: CallbackBody }>(
    "SELECT event_id, payload FROM payment_callbacks WHERE reference = $1 AND outcome = 'waiting'",
    [reference],
  );
  for (const row of rows) {
    const order = await loadOrder(reference);
    if (order === null) return;
    const outcome = await applyRefunded(order, row.payload);
    await query('UPDATE payment_callbacks SET outcome = $2 WHERE event_id = $1', [
      row.event_id,
      outcome,
    ]);
  }
}
