import type { Config } from '../config.js';
import { query, withClient } from '../db.js';
import { Killbill } from '../services/killbill.js';
import { confirmStage, failStage, euros } from './payments.js';
import { settleRefund } from './refunds.js';

// Notification belief: a delivery is believed only if its path secret matches
// and a fresh GET of the payment named by objectId agrees. The transaction
// carrying the shop's external key decides the outcome; eventType and
// metaData are never trusted.

export type NotificationResult = 'ok' | 'bad_notification' | 'not_found' | 'provider_unreachable';

export async function handleNotification(
  config: Config, kb: Killbill, secret: string, pathSecret: string, body: unknown,
): Promise<NotificationResult> {
  if (secret !== pathSecret) return 'not_found';
  if (typeof body !== 'object' || body === null) return 'bad_notification';
  const n = body as { objectType?: unknown; objectId?: unknown };
  if (typeof n.objectType !== 'string' || typeof n.objectId !== 'string') return 'bad_notification';
  if (n.objectType !== 'PAYMENT') return 'ok';

  const paymentId = n.objectId;
  let payment: Awaited<ReturnType<Killbill['getPayment']>>;
  try {
    payment = await kb.getPayment(paymentId);
    if (!payment) return 'ok';
  } catch {
    return 'provider_unreachable';
  }

  // Find the shop payment rows that know this Kill Bill payment.
  const rows = await query<{ id: string; order_id: string; stage: string; external_key: string; amount_cents: number; status: string }>(
    config,
    `select id, order_id, stage, external_key, amount_cents, status from payments where killbill_payment_id = $1`,
    [paymentId],
  );
  if (rows.rows.length === 0) return 'ok';

  // The purchase transaction carrying the shop's external key decides.
  const handled = await query<{ kind: string; outcome: string }>(
    config, `select kind, outcome from notifications where payment_id = $1`, [paymentId],
  );
  const handledKinds = new Set(handled.rows.map((r) => r.kind));

  for (const row of rows.rows) {
    const stage = row.stage as 'deposit' | 'instalment-1' | 'instalment-2' | 'instalment-3';
    const kind = `purchase:${row.id}`;
    const txn = payment.transactions.find((t) => t.transactionExternalKey === row.external_key && t.transactionType === 'PURCHASE');
    if (!txn) continue;
    if (Math.round((txn.amount ?? 0) * 100) !== row.amount_cents || (txn.currency ?? 'EUR') !== 'EUR') continue;
    if (handledKinds.has(kind)) continue;
    const outcome = txn.status === 'SUCCESS' ? 'success'
      : ['PENDING', 'UNKNOWN', 'PLUGIN_UNCERTAIN'].includes(txn.status ?? '') ? 'pending'
      : 'failure';
    const inserted = await query(
      config,
      `insert into notifications (payment_id, kind, outcome) values ($1, $2, $3) on conflict do nothing`,
      [paymentId, kind, outcome],
    );
    if ((inserted.rowCount ?? 0) === 0) continue;
    if (outcome === 'success') {
      await confirmStage(config, row.order_id, stage);
    } else if (outcome === 'failure') {
      await failStage(config, row.order_id, stage);
    }
  }

  // Refund draws on this payment: match REFUND transactions by external key.
  const drawRows = await query<{ id: string; refund_id: string; external_key: string; amount_cents: number }>(
    config,
    `select d.id, d.refund_id, d.external_key, d.amount_cents
     from refund_draws d join payments p on p.id = d.payment_id
     where p.killbill_payment_id = $1 and d.status = 'pending'`,
    [paymentId],
  );
  for (const d of drawRows.rows) {
    const txn = payment.transactions.find((t) => t.transactionExternalKey === d.external_key && t.transactionType === 'REFUND');
    if (!txn) continue;
    if (Math.round((txn.amount ?? 0) * 100) !== d.amount_cents || (txn.currency ?? 'EUR') !== 'EUR') continue;
    const outcome = txn.status === 'SUCCESS' ? 'returned' : 'failure';
    const inserted = await query(
      config,
      `insert into notifications (payment_id, kind, outcome) values ($1, $2, $3) on conflict do nothing`,
      [paymentId, `draw:${d.id}`, outcome],
    );
    if ((inserted.rowCount ?? 0) === 0) continue;
    if (outcome === 'returned') {
      await query(config, `update refund_draws set status = 'returned' where id = $1`, [d.id]);
    } else {
      await query(config, `update refund_draws set status = 'failed' where id = $1`, [d.id]);
    }
    await settleRefund(config, d.refund_id);
  }

  return 'ok';
}

// Send out refund draws that were deferred while Kill Bill was unreachable.
// Called by the recovery path when Kill Bill returns; uses each draw's same
// external key.
export async function sendPendingDraws(config: Config, kb: Killbill, userId: string): Promise<void> {
  const rows = await query<{ id: string; refund_id: string; external_key: string; amount_cents: number; stage: string; killbill_payment_id: string | null }>(
    config,
    `select d.id, d.refund_id, d.external_key, d.amount_cents, p.killbill_payment_id, p.user_id
     from refund_draws d join payments p on p.id = d.payment_id
     where d.status = 'pending'`,
  );
  for (const d of rows.rows) {
    if (!d.killbill_payment_id) continue;
    try {
      await kb.refundPayment(d.killbill_payment_id, (d.amount_cents / 100).toFixed(2), d.external_key);
      // Belief still runs through notifications; do not mark returned here.
    } catch {
      return;
    }
  }
  void userId;
  void euros;
  void withClient;
}
