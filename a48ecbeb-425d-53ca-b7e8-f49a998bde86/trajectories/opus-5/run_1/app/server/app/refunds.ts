import crypto from 'node:crypto';
import { refundCopy } from '../../shared/copy.js';
import { canRefund, restocksOnFullRefund } from '../../shared/orderStatus.js';
import { splitRefund } from '../../shared/refundSplit.js';
import { writeLedgerEvent } from '../db/ledger.js';
import {
  claimPendingRefunds,
  findOrder,
  insertRefundIfItFits,
  releaseRefundClaim,
  remainingRefundable,
  setOrderStatus,
  setRefundStatus,
  setRefundStatusOnOrder,
  type OrderRecord,
  type RefundRecord,
} from '../db/orders.js';
import { queueMail } from '../db/outbox.js';
import { transaction } from '../db/pool.js';
import { conflict, validationError } from '../http/errors.js';
import { findPayment, paymentKey, refundConfirmed, refundPayment } from '../services/killbill.js';
import { refundAppliedMail } from './emails.js';
import { publishStockLevels } from './live.js';

export interface RefundRequest {
  amountCents: number;
  reason: string;
}

export function readRefundRequest(body: unknown): RefundRequest {
  const payload = (body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const amount = payload.amount_cents;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) {
    fields.amount_cents = 'Enter a refund of at least one cent.';
  }
  const reason = payload.reason;
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 500) {
    fields.reason = 'Give a reason of up to 500 characters.';
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { amountCents: amount as number, reason: reason as string };
}

/** Records a refund and sends it to Kill Bill. It shows as pending until confirmed. */
export async function requestRefund(
  order: OrderRecord,
  request: RefundRequest,
): Promise<{ refund: RefundRecord; order: OrderRecord }> {
  if (!canRefund(order.status) || order.refundable_cents <= 0) {
    throw conflict('not_refundable', refundCopy.notRefundable);
  }
  if (request.amountCents > order.refundable_cents) {
    throw validationError({
      amount_cents: refundCopy.overLimit(order.refundable_cents),
    });
  }

  const split = splitRefund(request.amountCents, remainingRefundable(order));
  const recorded = await insertRefundIfItFits({
    orderNumber: order.number,
    amountCents: request.amountCents,
    reason: request.reason,
    split,
    transactionKey: `${paymentKey(order.number)}/refund-${crypto.randomUUID()}`,
  });
  if (recorded === 'over_limit') {
    const fresh = (await findOrder(order.number))!;
    throw validationError({ amount_cents: refundCopy.overLimit(fresh.refundable_cents) });
  }

  const payment = await findPayment(paymentKey(order.number));
  if (payment === null) {
    await setRefundStatus(recorded.refund.id, 'rejected');
    throw conflict('not_refundable', refundCopy.notRefundable);
  }
  try {
    await refundPayment({
      paymentId: payment.paymentId,
      amountCents: request.amountCents,
      transactionExternalKey: recorded.refund.transaction_key,
    });
  } catch (error) {
    await setRefundStatus(recorded.refund.id, 'rejected');
    throw error;
  }
  return recorded;
}

/** Puts a fully refunded, unshipped order's cans back on the shelf. */
async function restock(order: OrderRecord): Promise<void> {
  await transaction(async (tx) => {
    for (const line of order.lines) {
      await writeLedgerEvent(tx, line.flavour, 'returned', line.quantity);
    }
  });
  void publishStockLevels();
}

const REJECT_AFTER_MS = 30_000;

/**
 * Confirms claimed refunds against Kill Bill. Only a confirmed refund changes the
 * order's refund status, restocks a full refund and sends the refund email.
 */
export async function confirmPendingRefunds(): Promise<void> {
  for (const claim of await claimPendingRefunds()) {
    const order = await findOrder(claim.orderNumber);
    if (order === null) continue;
    const refund = order.refunds.find((candidate) => candidate.id === claim.refundId);
    if (refund === undefined) continue;

    let confirmed: boolean;
    try {
      confirmed = await refundConfirmed(paymentKey(order.number), refund.transaction_key);
    } catch (error) {
      await releaseRefundClaim(claim.refundId);
      throw error;
    }

    if (!confirmed) {
      if (Date.now() - new Date(refund.created_at).getTime() > REJECT_AFTER_MS) {
        await setRefundStatus(claim.refundId, 'rejected');
      } else {
        await releaseRefundClaim(claim.refundId);
      }
      continue;
    }

    await setRefundStatus(claim.refundId, 'applied');
    const applied = (await findOrder(order.number))!;
    const fully = applied.refunded_cents === applied.total_cents;
    await setRefundStatusOnOrder(order.number, fully ? 'refunded' : 'partially_refunded');
    if (fully) {
      if (restocksOnFullRefund(applied.status)) await restock(applied);
      await setOrderStatus(order.number, 'refunded');
    }
    await queueMail(refundAppliedMail((await findOrder(order.number))!, refund));
  }
}
