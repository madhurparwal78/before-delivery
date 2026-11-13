import { query, withTransaction } from './db.js';
import { config, businessClock } from './config.js';
import * as kb from './killbill.js';
import * as gw from './gateway.js';
import { moveBox, getOrder, OrderRow } from './orders.js';
import { publishBox } from './shelfHub.js';
import { reindexBox } from './indexer.js';
import { stockAfterChange } from './stock.js';
import { alert, recordPendingEvent } from './fulfilment.js';
import { sendAuthorisationNotice } from './checkout.js';
import { formatOre } from '../shared/money.js';
import { refundParts, remainingParts } from './edition.js';
import { verifySignature as verifyShared } from './pure.js';

export function verifySignature(raw: string, header: string | undefined): boolean {
  return verifyShared(raw, header, config.gatewayCallbackSecret);
}

export interface CallbackBody {
  eventId: string;
  sequence: number;
  type: 'payment.authorised' | 'payment.declined' | 'payment.captured' | 'payment.capture_failed'
    | 'payment.voided' | 'payment.refunded' | 'transfer.received';
  paymentId: string | null;
  transferId: string | null;
  reference: string;
  refundId: string | null;
  amountOre: number | null;
  declineCode: string | null;
  occurredAt: string;
}

type CallbackStatus = 'applied' | 'duplicate' | 'ignored' | 'waiting' | 'not_found';

export async function applyCallback(body: CallbackBody): Promise<CallbackStatus> {
  const order = await getOrder(body.reference);
  if (!order) return 'not_found';

  // Deduplicate by eventId, including concurrent deliveries.
  const inserted = await query<{ event_id: string }>(
    'INSERT INTO payment_events (event_id, reference, sequence, type, refund_id, amount_ore, decline_code, applied_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
    [body.eventId, body.reference, body.sequence, body.type, body.refundId, body.amountOre, body.declineCode],
  );
  if (inserted.length === 0) return 'duplicate';

  const outcome = await route(body, order);
  if (outcome === 'ignored' || outcome === 'waiting') {
    await query('UPDATE payment_events SET applied_at = NULL WHERE event_id = $1', [body.eventId]);
  }
  return outcome;
}

async function route(body: CallbackBody, order: OrderRow): Promise<CallbackStatus> {
  switch (body.type) {
    case 'payment.authorised':
      return applyAuthorised(body, order);
    case 'payment.declined':
      return applyDeclined(body, order);
    case 'payment.captured':
      return applyCapture(body, order);
    case 'payment.capture_failed':
      return applyCaptureFailed(body, order);
    case 'payment.voided':
      return applyVoided(body, order);
    case 'payment.refunded':
      return applyRefunded(body, order);
    case 'transfer.received':
      return applyTransferReceived(body, order);
  }
}

async function applyAuthorised(body: CallbackBody, order: OrderRow): Promise<CallbackStatus> {
  // A late authorised never moves a payment backwards.
  if (!['started', 'challenge', 'declined'].includes(order.payment_state)) return 'ignored';
  // An authorisation landing after its hold ended is voided automatically.
  const holdAlive = await query<{ reference: string }>(
    "SELECT reference FROM orders WHERE number = $1 AND box_state = 'held' LIMIT 1", [order.number],
  );
  if (order.box_state === 'claimed' || holdAlive.length === 0) {
    if (body.paymentId) {
      await gw.voidPayment(body.paymentId, `void-cb-${body.eventId}`).catch(() => {});
      await kb.voidTransaction(order.kb_payment_id ?? '', `void-cb-${body.eventId}`).catch(() => {});
    }
    await withTransaction(async (client) => {
      await client.query("UPDATE orders SET payment_state = 'voided' WHERE reference = $1", [order.reference]);
    });
    try {
      await sendAuthorisationNotice(order.number, order.reference, order.buyer_email);
    } catch { /* retried */ }
    return 'applied';
  }
  await withTransaction(async (client) => {
    await client.query("UPDATE orders SET payment_state = 'authorised', gateway_payment_id = COALESCE($1, gateway_payment_id), authorised_at = now() WHERE reference = $2",
      [body.paymentId, order.reference]);
    await moveBox(client, order.number, "held", "claimed", order.reference);
  });
  publishBox(order.number, 'taken');
  await stockAfterChange('held', 'claimed', order.number);
  void reindexBox(order.number, order.plate, 'claimed').catch(() => {});
  try {
    await sendAuthorisationNotice(order.number, order.reference, order.buyer_email);
  } catch { /* retried */ }
  return 'applied';
}

async function applyDeclined(_body: CallbackBody, order: OrderRow): Promise<CallbackStatus> {
  if (!['started', 'challenge'].includes(order.payment_state)) return 'ignored';
  await withTransaction(async (client) => {
    await client.query("UPDATE orders SET payment_state = 'declined' WHERE reference = $1", [order.reference]);
  });
  return 'applied';
}

async function applyCaptureFailed(_body: CallbackBody, order: OrderRow): Promise<CallbackStatus> {
  if (order.payment_state !== 'authorised' && order.payment_state !== 'capture_failed') return 'ignored';
  await withTransaction(async (client) => {
    await client.query("UPDATE orders SET payment_state = 'capture_failed' WHERE reference = $1", [order.reference]);
  });
  await alert('Capture failed', `Box ${order.number}: capture of DKK ${formatOre(order.total_ore)} failed.`);
  return 'applied';
}

async function applyVoided(_body: CallbackBody, order: OrderRow): Promise<CallbackStatus> {
  if (order.payment_state !== 'authorised') return 'ignored';
  await withTransaction(async (client) => {
    await client.query("UPDATE orders SET payment_state = 'voided' WHERE reference = $1", [order.reference]);
    await moveBox(client, order.number, "claimed", "available", order.reference);
  });
  publishBox(order.number, 'available');
  await stockAfterChange('claimed', 'available', order.number);
  void reindexBox(order.number, order.plate, 'available').catch(() => {});
  // Invoice items adjust to zero.
  if (order.kb_invoice_id) {
    const ids = await kb.invoiceItemIds(order.kb_invoice_id);
    if (ids) {
      await kb.adjustInvoiceItems(order.kb_invoice_id, ids,
        { makerOre: order.maker_ore, charityOre: order.charity_ore, vatOre: order.vat_ore }).catch(() => {});
    }
  }
  return 'applied';
}

/** Charged only when confirmed twice: the gateway's callback and the Kill Bill
 * capture both exist before paymentState becomes captured. */
async function applyCapture(body: CallbackBody, order: OrderRow): Promise<CallbackStatus> {
  if (order.payment_state === 'authorised' || order.payment_state === 'capture_failed' || order.payment_state === 'pending') {
    if (order.payment_state === 'pending') return 'ignored';
    // The Kill Bill capture must exist as well.
    if (order.kb_payment_id) {
      const ok = await kb.captureTransaction(order.kb_payment_id, order.total_ore / 100, `cap-cb-${body.eventId}`).catch(() => false);
      if (!ok) return 'waiting';
    }
    const now = businessClock.now();
    const fee = order.method === 'card' ? Math.round(order.total_ore * 0.0125) + 100 : 400;
    await withTransaction(async (client) => {
      await client.query("UPDATE orders SET payment_state = 'captured', paid_at = $1, gateway_fee_ore = $2 WHERE reference = $3", [now.toISOString(), fee, order.reference]);
      await client.query(
        `INSERT INTO split_lines (reference, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_bps, posted_at)
         VALUES ($1,'sale',$2,$3,$4,$5,$6,$7,$8)`,
        [order.reference, order.gross_ore, order.net_ore, order.vat_ore, order.charity_ore, order.maker_ore, order.rate_bps, now.toISOString()],
      );
      // The order.paid event is written in the same transaction as the paid
      // state, and published afterwards.
      await client.query(
        `INSERT INTO pending_events (event_id, type, reference, box_number, occurred_at, published)
         VALUES ($1,'order.paid',$2,$3,$4,FALSE) ON CONFLICT (event_id) DO NOTHING`,
        [`evt-${order.reference}-paid`, order.reference, order.number, now.toISOString()],
      );
    });
    await recordPendingEvent(`evt-${order.reference}-paid`, 'order.paid', order.reference, order.number, now);
    return 'applied';
  }
  if (order.payment_state === 'captured' || order.payment_state === 'partially_refunded' || order.payment_state === 'refunded') {
    return 'ignored';
  }
  return 'ignored';
}

/** transfer.received: settling a bank order, or sending back a late or wrong transfer. */
async function applyTransferReceived(body: CallbackBody, order: OrderRow): Promise<CallbackStatus> {
  if (order.method !== 'bank') return 'ignored';
  const amount = body.amountOre ?? 0;
  const deadline = order.transfer_deadline_at ? new Date(order.transfer_deadline_at) : null;
  const now = businessClock.now();
  const late = deadline !== null && now > deadline;
  const exact = amount === order.total_ore;

  if (order.payment_state !== 'pending') {
    return 'ignored';
  }

  if (!late && exact) {
    // Settle: claim the box, purchase record, paid state and event together.
    if (order.kb_account_id) {
      const ok = await kb.purchaseTransaction(order.kb_account_id, order.total_ore / 100, order.reference, `pur-${order.reference}`).catch(() => false);
      if (!ok) return 'waiting';
    }
    const fee = 400;
    await withTransaction(async (client) => {
      await client.query("UPDATE orders SET payment_state = 'settled', paid_at = $1, gateway_fee_ore = $2 WHERE reference = $3", [now.toISOString(), fee, order.reference]);
      await moveBox(client, order.number, "awaiting_transfer", "claimed", order.reference);
      await client.query(
        `INSERT INTO split_lines (reference, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_bps, posted_at)
         VALUES ($1,'sale',$2,$3,$4,$5,$6,$7,$8)`,
        [order.reference, order.gross_ore, order.net_ore, order.vat_ore, order.charity_ore, order.maker_ore, order.rate_bps, now.toISOString()],
      );
      await client.query(
        `INSERT INTO pending_events (event_id, type, reference, box_number, occurred_at, published)
         VALUES ($1,'order.paid',$2,$3,$4,FALSE) ON CONFLICT (event_id) DO NOTHING`,
        [`evt-${order.reference}-paid`, order.reference, order.number, now.toISOString()],
      );
    });
    await recordPendingEvent(`evt-${order.reference}-paid`, 'order.paid', order.reference, order.number, now);
    return 'applied';
  }

  if (late) {
    // Full gateway refund, order stays lapsed, never reattached.
    if (order.gateway_transfer_id) {
      await gw.refundTransfer(order.gateway_transfer_id, amount, `trf-refund-${body.eventId}`).catch(() => {});
    }
    await withTransaction(async (client) => {
      await client.query("UPDATE orders SET payment_state = 'lapsed' WHERE reference = $1", [order.reference]);
      await moveBox(client, order.number, "awaiting_transfer", "available", order.reference);
    });
    publishBox(order.number, 'available');
    await stockAfterChange('awaiting_transfer', 'available', order.number);
    void reindexBox(order.number, order.plate, 'available').catch(() => {});
    try {
      await sendAuthorisationNotice(order.number, order.reference, order.buyer_email);
    } catch { /* retried */ }
    return 'applied';
  }

  // Wrong amount: send back with the gateway's return call, deadline running.
  if (order.gateway_transfer_id) {
    await gw.returnTransfer(order.gateway_transfer_id, amount, `trf-return-${body.eventId}`).catch(() => {});
  }
  try {
    await sendAuthorisationNotice(order.number, order.reference, order.buyer_email);
  } catch { /* retried */ }
  return 'applied';
}

/** A refund arriving before its capture waits for it. */
async function applyRefunded(body: CallbackBody, order: OrderRow): Promise<CallbackStatus> {
  if (order.payment_state === 'authorised' || order.payment_state === 'started' || order.payment_state === 'challenge') {
    return 'waiting';
  }
  if (order.payment_state !== 'captured' && order.payment_state !== 'partially_refunded' && order.payment_state !== 'refunded') {
    return 'ignored';
  }
  const sale = { netOre: order.net_ore, vatOre: order.vat_ore, charityOre: order.charity_ore, makerOre: order.maker_ore };
  let refundId = body.refundId;
  let amountOre = body.amountOre ?? 0;
  let parts: { netOre: number; vatOre: number; charityOre: number; makerOre: number };
  const pending = refundId
    ? await query<{ refund_id: string; amount_ore: number; net_ore: number; vat_ore: number; charity_ore: number; maker_ore: number; state: string }>(
        'SELECT refund_id, amount_ore, net_ore, vat_ore, charity_ore, maker_ore, state FROM refunds WHERE gateway_refund_id = $1', [refundId])
    : [];
  if (pending.length > 0) {
    parts = { netOre: pending[0].net_ore, vatOre: pending[0].vat_ore, charityOre: pending[0].charity_ore, makerOre: pending[0].maker_ore };
    amountOre = pending[0].amount_ore;
    refundId = pending[0].refund_id;
  } else {
    const refunds = await query<{ net_ore: number; vat_ore: number; charity_ore: number; maker_ore: number }>(
      'SELECT net_ore, vat_ore, charity_ore, maker_ore FROM refunds WHERE reference = $1',
      [order.reference],
    );
    parts = refundParts(amountOre, order.rate_bps, remainingParts(sale, refunds.map((r) => ({ netOre: r.net_ore, vatOre: r.vat_ore, charityOre: r.charity_ore, makerOre: r.maker_ore }))));
    refundId = `ref-${body.eventId}`;
    await query(
      `INSERT INTO refunds (refund_id, reference, state, amount_ore, net_ore, vat_ore, charity_ore, maker_ore, gateway_refund_id, settled_at)
       VALUES ($1,$2,'settled',$3,$4,$5,$6,$7,$8,now()) ON CONFLICT (refund_id) DO NOTHING`,
      [refundId, order.reference, amountOre, parts.netOre, parts.vatOre, parts.charityOre, parts.makerOre, body.refundId],
    );
  }

  // The Kill Bill refund must exist before the refund is settled.
  if (order.kb_payment_id) {
    const okKb = await kb.refundTransaction(order.kb_payment_id, amountOre / 100, `ref-cb-${body.eventId}`).catch(() => false);
    if (!okKb) return 'waiting';
  }
  if (order.kb_invoice_id) {
    const ids = await kb.invoiceItemIds(order.kb_invoice_id);
    if (ids) {
      await kb.adjustInvoiceItems(order.kb_invoice_id, ids,
        { makerOre: parts.makerOre, charityOre: parts.charityOre, vatOre: parts.vatOre }).catch(() => {});
    }
  }

  const totals = await settledTotals(order);
  const fully = totals.gross + amountOre <= 0;
  const settledAt = businessClock.now();
  await withTransaction(async (client) => {
    await client.query("UPDATE refunds SET state = 'settled', settled_at = $1 WHERE refund_id = $2", [settledAt.toISOString(), refundId]);
    await client.query(
      `INSERT INTO split_lines (reference, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_bps, posted_at)
       VALUES ($1,'refund',$2,$3,$4,$5,$6,$7,$8)`,
      [order.reference, -amountOre, -parts.netOre, -parts.vatOre, -parts.charityOre, -parts.makerOre, order.rate_bps, settledAt.toISOString()],
    );
    await client.query('UPDATE orders SET payment_state = $1 WHERE reference = $2', [fully ? 'refunded' : 'partially_refunded', order.reference]);
    if (fully) {
      await client.query("UPDATE orders SET certificate_state = 'cancelled' WHERE reference = $1 AND certificate_state = 'issued'", [order.reference]);
      const current = await client.query<{ box_state: string }>('SELECT box_state FROM boxes WHERE number = $1', [order.number]);
      const from = current.rows[0]?.box_state ?? order.box_state;
      await moveBox(client, order.number, from, 'returned', order.reference);
    }
  });
  // The signed refund.settled event reaches the charity.
  const { sendMessage } = await import('./webhooks.js');
  await sendMessage(`evt-${order.reference}-${refundId}`, 'refund.settled', {
    eventId: `evt-${order.reference}-${refundId}`,
    reference: order.reference,
    boxNumber: order.number,
    refundId,
    refundOre: amountOre,
    netOre: parts.netOre,
    vatOre: parts.vatOre,
    charityOre: parts.charityOre,
    makerOre: parts.makerOre,
    settledAt: settledAt.toISOString(),
  }).catch(() => { /* kept and retried under its own policy */ });
  return 'applied';
}

async function settledTotals(order: OrderRow): Promise<{ gross: number }> {
  const rows = await query<{ gross: number }>(
    'SELECT COALESCE(SUM(gross_ore),0) AS gross FROM split_lines WHERE reference = $1',
    [order.reference],
  );
  return { gross: rows[0]?.gross ?? 0 };
}
