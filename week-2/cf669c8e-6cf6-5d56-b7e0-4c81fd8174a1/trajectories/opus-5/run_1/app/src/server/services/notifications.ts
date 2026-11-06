/**
 * Believing Kill Bill notifications.
 *
 * A delivery is believed only if its path secret matches and a fresh read of
 * the payment agrees: the transaction carrying the shop's external key must
 * have matching type, amount and currency, and it decides the outcome.
 * `eventType` and `metaData` are never trusted.
 *
 * A transaction's outcome is applied once, so repeats, concurrent duplicates
 * on any instance and Kill Bill's timed retries change nothing and send
 * nothing. Because the re-read decides, any arrival order ends in the state
 * Kill Bill holds.
 */

import type { PoolClient } from 'pg';

import { STAGE_LABELS } from '../../shared/seed.js';
import type { StageName } from '../../shared/types.js';
import { amsterdamDate, monthlyDueDates, shopNow } from '../domain/clock.js';
import { STAGE_ORDER } from '../domain/money.js';
import { transact } from '../db/pool.js';
import {
  eurosMatchCents,
  getPayment,
  isSuccess,
  isUndecided,
  KillbillUnreachable,
  type KillbillTransaction,
} from '../providers/killbill.js';
import { claimMail, flushMail, vatReceiptMail } from '../providers/mail.js';
import { assembleStages, loadOrderForUpdate, recomputeOrder } from '../store/orders.js';
import { settleRefundIfComplete } from './refunds.js';

/** The number of provider attempts after which a stage goes overdue. */
export const MAX_COLLECTION_ATTEMPTS = 3;

export type NotificationOutcome = 'ok' | 'unreachable' | 'bad_body';

interface Delivery {
  objectType?: unknown;
  objectId?: unknown;
}

/**
 * Handle one delivery. Returns `unreachable` when the re-read cannot reach
 * Kill Bill, so Kill Bill retries.
 */
export async function handleNotification(body: unknown): Promise<NotificationOutcome> {
  if (body === null || typeof body !== 'object') return 'bad_body';

  const delivery = body as Delivery;
  if (delivery.objectType !== 'PAYMENT') return 'ok';
  if (typeof delivery.objectId !== 'string' || delivery.objectId.length === 0) return 'ok';

  let payment;
  try {
    payment = await getPayment(delivery.objectId);
  } catch (error) {
    if (error instanceof KillbillUnreachable) return 'unreachable';
    throw error;
  }

  // An unknown payment, including one about a database this shop does not
  // share, changes nothing.
  if (!payment) return 'ok';

  let sentMail = false;
  for (const transaction of payment.transactions) {
    if (await applyTransaction(payment.paymentId, transaction)) sentMail = true;
  }
  if (sentMail) void flushMail().catch(() => undefined);
  return 'ok';
}

/** Returns true when a mail was claimed and should be flushed. */
async function applyTransaction(
  killbillPaymentId: string,
  transaction: KillbillTransaction,
): Promise<boolean> {
  if (isUndecided(transaction.status)) return false;
  if (transaction.currency !== 'EUR') return false;

  const success = isSuccess(transaction.status);

  return transact(async (client) => {
    const stageRow = await client.query<{ order_id: string; stage: StageName; amount_cents: number; status: string }>(
      'SELECT order_id, stage, amount_cents, status FROM payments WHERE external_key = $1',
      [transaction.transactionExternalKey],
    );
    const payment = stageRow.rows[0];
    if (payment) {
      if (transaction.transactionType !== 'PURCHASE') return false;
      if (!eurosMatchCents(transaction.amount, payment.amount_cents)) return false;
      if (!(await claimTransaction(client, transaction.transactionId, success))) return false;
      return applyStageOutcome(client, payment.order_id, payment.stage, killbillPaymentId, transaction, success);
    }

    const drawRow = await client.query<{ id: string; refund_id: string; order_id: string; amount_cents: number }>(
      'SELECT id, refund_id, order_id, amount_cents FROM refund_draws WHERE external_key = $1',
      [transaction.transactionExternalKey],
    );
    const draw = drawRow.rows[0];
    if (!draw) return false;
    if (transaction.transactionType !== 'REFUND') return false;
    if (!eurosMatchCents(transaction.amount, draw.amount_cents)) return false;
    if (!(await claimTransaction(client, transaction.transactionId, success))) return false;

    await client.query('UPDATE refund_draws SET status = $2, killbill_transaction_id = $3 WHERE id = $1', [
      draw.id,
      success ? 'returned' : 'failed',
      transaction.transactionId,
    ]);
    return settleRefundIfComplete(client, draw.order_id, draw.refund_id);
  });
}

/** The applied-transaction row is the claim: one instance applies the outcome. */
async function claimTransaction(
  client: PoolClient,
  transactionId: string,
  success: boolean,
): Promise<boolean> {
  const claimed = await client.query(
    `INSERT INTO applied_transactions(transaction_id, outcome)
     VALUES ($1, $2)
     ON CONFLICT (transaction_id) DO NOTHING
     RETURNING transaction_id`,
    [transactionId, success ? 'success' : 'failure'],
  );
  return claimed.rowCount === 1;
}

async function applyStageOutcome(
  client: PoolClient,
  orderId: string,
  stage: StageName,
  killbillPaymentId: string,
  transaction: KillbillTransaction,
  success: boolean,
): Promise<boolean> {
  const loaded = await loadOrderForUpdate(client, orderId);
  if (!loaded) return false;

  await client.query(
    'UPDATE payments SET status = $2, killbill_payment_id = $3, killbill_transaction_id = $4 WHERE external_key = $1',
    [
      transaction.transactionExternalKey,
      success ? 'paid' : 'failed',
      killbillPaymentId,
      transaction.transactionId,
    ],
  );

  const row = loaded.stages.find((s) => s.stage === stage);
  if (!row) return false;
  // A delayed failure after success leaves the success in place.
  if (row.status === 'paid') return false;

  if (!success) {
    await applyFailure(client, loaded.order.id, stage, row.attempts);
    return false;
  }

  const confirmedAt = shopNow();
  await client.query(
    `UPDATE order_stages SET status = 'paid', confirmed_at = $3 WHERE order_id = $1 AND stage = $2`,
    [orderId, stage, confirmedAt.toISOString()],
  );

  if (stage === 'deposit') await setDueDates(client, orderId, confirmedAt);
  await advanceState(client, orderId);

  return claimReceipt(client, orderId, stage);
}

async function applyFailure(
  client: PoolClient,
  orderId: string,
  stage: StageName,
  attempts: number,
): Promise<void> {
  // A failed deposit keeps `deposit pending` with the stage `failed`.
  if (stage === 'deposit') {
    await client.query("UPDATE order_stages SET status = 'failed' WHERE order_id = $1 AND stage = $2", [
      orderId,
      stage,
    ]);
    return;
  }

  if (attempts >= MAX_COLLECTION_ATTEMPTS) {
    await client.query("UPDATE order_stages SET status = 'overdue' WHERE order_id = $1 AND stage = $2", [
      orderId,
      stage,
    ]);
    await client.query(
      `UPDATE orders SET state = 'in arrears'
       WHERE id = $1 AND state IN ('instalments running', 'deposit confirmed')`,
      [orderId],
    );
    return;
  }

  await client.query("UPDATE order_stages SET status = 'failed' WHERE order_id = $1 AND stage = $2", [
    orderId,
    stage,
  ]);
}

/** Due dates are monthly, anchored on the deposit's confirmation date. */
async function setDueDates(client: PoolClient, orderId: string, confirmedAt: Date): Promise<void> {
  const dates = monthlyDueDates(amsterdamDate(confirmedAt), 3);
  const instalments = STAGE_ORDER.slice(1);
  for (const [index, stage] of instalments.entries()) {
    await client.query('UPDATE order_stages SET due_date = $3 WHERE order_id = $1 AND stage = $2', [
      orderId,
      stage,
      dates[index],
    ]);
  }
}

async function advanceState(client: PoolClient, orderId: string): Promise<void> {
  const loaded = await loadOrderForUpdate(client, orderId);
  if (!loaded) return;

  const allPaid = loaded.stages.every((stage) => stage.status === 'paid');
  if (allPaid) {
    await client.query("UPDATE orders SET state = 'paid in full' WHERE id = $1", [orderId]);
    return;
  }

  if (loaded.order.state === 'deposit pending') {
    await client.query("UPDATE orders SET state = 'deposit confirmed' WHERE id = $1", [orderId]);
    return;
  }

  // `in arrears` returns to running once no overdue stage is left.
  if (loaded.order.state === 'in arrears' && !loaded.stages.some((s) => s.status === 'overdue')) {
    await client.query("UPDATE orders SET state = 'instalments running' WHERE id = $1", [orderId]);
  }
}

/** One VAT receipt per confirmed payment, only after confirmation. */
async function claimReceipt(client: PoolClient, orderId: string, stage: StageName): Promise<boolean> {
  const loaded = await loadOrderForUpdate(client, orderId);
  if (!loaded) return false;

  const recipient = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
    loaded.order.user_id,
  ]);
  const email = recipient.rows[0]?.email;
  if (!email) return false;

  const stages = assembleStages(loaded);
  const confirmed = stages.find((s) => s.stage === stage);
  if (!confirmed) return false;

  const byLine = new Map(loaded.lines.map((line) => [line.id, line]));
  return claimMail(
    client,
    vatReceiptMail({
      orderNumber: loaded.order.number,
      stageLabel: STAGE_LABELS[stage],
      recipient: email,
      orderId,
      stage,
      amountCents: confirmed.amountCents,
      vatCents: confirmed.vatCents,
      netCents: confirmed.amountCents - confirmed.vatCents,
      lines: confirmed.allocations.map((allocation) => ({
        name: byLine.get(allocation.lineId)?.name ?? 'Line',
        grossCents: allocation.grossCents,
        vatCents: allocation.vatCents,
        netCents: allocation.netCents,
      })),
    }),
  );
}

export { recomputeOrder };
