import { query, withTransaction } from './db.js';
import { apiError } from './errors.js';
import { getOrder, moveBox, OrderRow } from './orders.js';
import * as gw from './gateway.js';
import * as kb from './killbill.js';
import { businessClock } from './config.js';
import { publishBox } from './shelfHub.js';
import { reindexBox } from './indexer.js';
import { stockAfterChange } from './stock.js';
import { alert, recordPendingEvent } from './fulfilment.js';
import { refundParts, remainingParts, gatewayFeeOre } from './edition.js';
import { formatOre } from '../shared/money.js';

/** Pack applies to a box in claimed. Capture, then packed and shipped. */
export async function pack(reference: string): Promise<{ reference: string; boxState: string; paymentState: string; packing: 'pending' | 'done' }> {
  const order = await getOrder(reference);
  if (!order) throw apiError(404, 'not_found');

  if (order.box_state === 'packed') {
    // A repeat Pack while a capture is pending answers the same 202.
    return { reference, boxState: order.box_state, paymentState: order.payment_state, packing: order.payment_state === 'captured' ? 'done' : 'pending' };
  }
  if (order.box_state !== 'claimed') throw apiError(409, 'illegal_transition');
  if (order.payment_state === 'authorisation_expired') throw apiError(409, 'authorisation_expired');

  // A settled bank order needs no capture.
  if (order.method === 'bank' && order.payment_state === 'settled') {
    await withTransaction(async (client) => {
      await moveBox(client, order.number, 'claimed', 'packed', reference);
    });
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO pending_events (event_id, type, reference, box_number, occurred_at, published)
         VALUES ($1,'box.packed',$2,$3,$4,FALSE) ON CONFLICT (event_id) DO NOTHING`,
        [`evt-${reference}-packed`, reference, order.number, businessClock.now().toISOString()],
      );
    });
    await recordPendingEvent(`evt-${reference}-packed`, 'box.packed', reference, order.number, businessClock.now());
    return { reference, boxState: 'packed', paymentState: order.payment_state, packing: 'done' };
  }

  if (order.payment_state !== 'authorised' && order.payment_state !== 'capture_failed' && order.payment_state !== 'captured') {
    throw apiError(409, 'illegal_transition');
  }
  if (order.payment_state === 'authorised' && order.auth_expires_at && order.auth_expires_at.getTime() < Date.now()) {
    throw apiError(409, 'authorisation_expired');
  }

  // Already captured (for example by the signed callback): only the packed
  // move and the courier booking remain.
  if (order.payment_state === 'captured') {
    await withTransaction(async (client) => {
      await moveBox(client, order.number, 'claimed', 'packed', reference);
    });
    await recordPendingEvent(`evt-${reference}-packed`, 'box.packed', reference, order.number, businessClock.now());
    return { reference, boxState: 'packed', paymentState: 'captured', packing: 'done' };
  }

  // Request the capture.
  if (!order.gateway_payment_id) throw apiError(409, 'illegal_transition');
  let reply: { status: number; body: any };
  try {
    reply = await gw.capture(order.gateway_payment_id, order.total_ore, `capture-${reference}`);
  } catch {
    throw apiError(503, 'gateway_unreachable');
  }

  if (reply.status === 402) {
    await withTransaction(async (client) => {
      await client.query("UPDATE orders SET payment_state = 'capture_failed' WHERE reference = $1", [reference]);
    });
    await alert('Capture failed', `Box ${order.number}: capture of DKK ${formatOre(order.total_ore)} failed.`);
    throw apiError(402, 'capture_refused', { reference, boxState: 'claimed', paymentState: 'capture_failed' });
  }

  if (reply.status === 202 && reply.body?.status === 'pending') {
    // Waiting on the signed callback.
    return { reference, boxState: 'claimed', paymentState: 'authorised', packing: 'pending' };
  }
  if (reply.status !== 200) {
    throw apiError(503, 'gateway_unreachable');
  }

  // Immediate capture: Kill Bill record must exist too.
  let kbOk = true;
  if (order.kb_payment_id) {
    kbOk = await kb.captureTransaction(order.kb_payment_id, order.total_ore / 100, `capture-${reference}`).catch(() => false);
    if (!kbOk) throw apiError(503, 'ledger_unreachable');
  }

  const now = businessClock.now();
  const fee = gatewayFeeOre('card');
  await withTransaction(async (client) => {
    await client.query("UPDATE orders SET payment_state = 'captured', paid_at = $1, gateway_fee_ore = $2 WHERE reference = $3", [now.toISOString(), fee, reference]);
    await moveBox(client, order.number, 'claimed', 'packed', reference);
    await client.query(
      `INSERT INTO split_lines (reference, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_bps, posted_at)
       VALUES ($1,'sale',$2,$3,$4,$5,$6,$7,$8)`,
      [reference, order.gross_ore, order.net_ore, order.vat_ore, order.charity_ore, order.maker_ore, order.rate_bps, now.toISOString()],
    );
    await client.query(
      `INSERT INTO pending_events (event_id, type, reference, box_number, occurred_at, published)
       VALUES ($1,'order.paid',$2,$3,$4,FALSE), ($5,'box.packed',$6,$7,$8,FALSE)
       ON CONFLICT (event_id) DO NOTHING`,
      [`evt-${reference}-paid`, reference, order.number, now.toISOString(),
       `evt-${reference}-packed`, reference, order.number, now.toISOString()],
    );
  });
  await recordPendingEvent(`evt-${reference}-paid`, 'order.paid', reference, order.number, now);
  await recordPendingEvent(`evt-${reference}-packed`, 'box.packed', reference, order.number, now);
  return { reference, boxState: 'packed', paymentState: 'captured', packing: 'done' };
}

/** Back on the shelf: returned to available, by the packer. */
export async function backOnShelf(number: number): Promise<{ number: number; state: string }> {
  const rows = await query<{ box_state: string }>('SELECT box_state FROM boxes WHERE number = $1', [number]);
  if (rows.length === 0) throw apiError(404, 'not_found');
  if (rows[0].box_state !== 'returned') throw apiError(409, 'illegal_transition');
  await withTransaction(async (client) => {
    await moveBox(client, number, 'returned', 'available');
  });
  publishBox(number, 'available');
  await stockAfterChange('returned', 'available', number);
  await reindexBox(number, plateOf(number), 'available');
  return { number, state: 'available' };
}

function plateOf(number: number): string {
  return ['stove', 'goose', 'tree', 'star', 'grandmother'][(number - 1) % 5];
}

/** Refunds: partial then full, settled only when confirmed twice. */
export async function refund(reference: string, amountOre: number, idempotencyKey: string, bodyHash: string): Promise<{
  refundId: string; reference: string; state: 'pending' | 'settled'; amountOre: number;
  netOre: number; vatOre: number; charityOre: number; makerOre: number;
}> {
  const stored = await query<{ kind: string; reference: string; status: number; body: string }>(
    'SELECT kind, reference, status, body FROM idempotency_keys WHERE key = $1', [idempotencyKey],
  );
  if (stored.length > 0) {
    if (stored[0].kind !== 'refund') throw apiError(409, 'idempotency_conflict');
    const saved = JSON.parse(stored[0].body) as { body: Record<string, unknown> & { bodyHash?: string } };
    if (saved.body?.bodyHash && saved.body.bodyHash !== bodyHash) {
      throw apiError(409, 'idempotency_conflict');
    }
    const reply = { ...saved.body };
    delete reply.bodyHash;
    return reply as unknown as {
      refundId: string; reference: string; state: 'pending' | 'settled'; amountOre: number;
      netOre: number; vatOre: number; charityOre: number; makerOre: number;
    };
  }

  const order = await getOrder(reference);
  if (!order) throw apiError(404, 'not_found');
  if (order.payment_state !== 'captured' && order.payment_state !== 'partially_refunded' && order.payment_state !== 'settled') {
    throw apiError(409, 'not_captured');
  }
  if (!Number.isInteger(amountOre) || amountOre <= 0) throw apiError(422, 'refund_invalid');

  // Refunds in progress count against the remainder.
  const sale = { netOre: order.net_ore, vatOre: order.vat_ore, charityOre: order.charity_ore, makerOre: order.maker_ore };
  const allRefunds = await query<{ amount_ore: number; net_ore: number; vat_ore: number; charity_ore: number; maker_ore: number }>(
    'SELECT amount_ore, net_ore, vat_ore, charity_ore, maker_ore FROM refunds WHERE reference = $1',
    [reference],
  );
  const remaining = remainingParts(sale, allRefunds.map((r) => ({ netOre: r.net_ore, vatOre: r.vat_ore, charityOre: r.charity_ore, makerOre: r.maker_ore })));
  const grossRemaining = allRefunds.reduce((s, r) => s + r.amount_ore, 0);
  const grossRemainder = order.gross_ore - grossRemaining;
  if (amountOre > grossRemainder) throw apiError(422, 'refund_exceeds_remainder');

  const parts = refundParts(amountOre, order.rate_bps, remaining);

  const refundId = `ref-${crypto.randomUUID().slice(0, 8)}`;
  const gatewayState = await gatewayRefund(order, amountOre, refundId);

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO refunds (refund_id, reference, state, amount_ore, net_ore, vat_ore, charity_ore, maker_ore, gateway_refund_id)
       VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8)`,
      [refundId, reference, amountOre, parts.netOre, parts.vatOre, parts.charityOre, parts.makerOre, refundId],
    );
  });

  // The courier fee is never refunded; the gateway only sees the box part.
  if (gatewayState === 'immediate') {
    const settled = await settleRefund(order, refundId, amountOre, parts);
    const result = {
      refundId, reference, state: settled ? 'settled' as const : 'pending' as const,
      amountOre, netOre: parts.netOre, vatOre: parts.vatOre, charityOre: parts.charityOre, makerOre: parts.makerOre,
    };
    await storeIdempotent(idempotencyKey, 'refund', reference, 202, { ...result, bodyHash });
    return result;
  }

  const result = {
    refundId, reference, state: 'pending' as const,
    amountOre, netOre: parts.netOre, vatOre: parts.vatOre, charityOre: parts.charityOre, makerOre: parts.makerOre,
  };
  await storeIdempotent(idempotencyKey, 'refund', reference, 202, { ...result, bodyHash });
  return result;
}

/** The gateway refund; its state decides whether settlement waits. */
async function gatewayRefund(order: OrderRow, amountOre: number, refundId: string): Promise<'immediate' | 'callback' | 'down'> {
  try {
    let reply: { status: number; body: any };
    if (order.method === 'card' && order.gateway_payment_id) {
      reply = await gw.refundPayment(order.gateway_payment_id, amountOre, `refund-${refundId}`);
    } else if (order.gateway_transfer_id) {
      reply = await gw.refundTransfer(order.gateway_transfer_id, amountOre, `refund-${refundId}`);
    } else {
      throw new Error('no payment to refund');
    }
    if (reply.status === 202) return 'callback';
    if (reply.status === 200) return 'immediate';
    return 'down';
  } catch {
    throw apiError(503, 'gateway_unreachable');
  }
}

async function settleRefund(order: OrderRow, refundId: string, amountOre: number, parts: { netOre: number; vatOre: number; charityOre: number; makerOre: number }): Promise<boolean> {
  // The Kill Bill refund must exist before the refund is settled.
  let kbOk = true;
  if (order.kb_payment_id) {
    kbOk = await kb.refundTransaction(order.kb_payment_id, amountOre / 100, `ref-${refundId}`).catch(() => false);
    if (!kbOk) return false;
  }
  if (order.kb_invoice_id) {
    const ids = await kb.invoiceItemIds(order.kb_invoice_id);
    if (ids) {
      await kb.adjustInvoiceItems(order.kb_invoice_id, ids, { makerOre: parts.makerOre, charityOre: parts.charityOre, vatOre: parts.vatOre }).catch(() => {});
    }
  }
  const totals = await query<{ gross: number }>(
    'SELECT COALESCE(SUM(gross_ore),0) AS gross FROM split_lines WHERE reference = $1', [order.reference],
  );
  const grossAfter = (totals[0]?.gross ?? 0) - amountOre;
  const fully = grossAfter <= 0;
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
  return true;
}

async function storeIdempotent(key: string, kind: string, reference: string, status: number, body: unknown): Promise<void> {
  await query(
    `INSERT INTO idempotency_keys (key, kind, reference, status, body) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (key) DO NOTHING`,
    [key, kind, reference, status, JSON.stringify({ body })],
  );
}

/** The exact remainder for `Refund the rest`. */
export async function refundRemainder(reference: string): Promise<number> {
  const order = await getOrder(reference);
  if (!order) throw apiError(404, 'not_found');
  const rows = await query<{ total: number }>('SELECT COALESCE(SUM(amount_ore),0) AS total FROM refunds WHERE reference = $1', [reference]);
  return order.gross_ore - (rows[0]?.total ?? 0);
}
