import { randomUUID } from 'node:crypto';
import { formatKroner } from '../shared/money.js';
import type { PaymentState } from '../shared/types.js';
import { announceBox, checkStockThresholds, moveBox, syncSearch } from './boxes.js';
import { flushCharityEvent, keepCharityEvent } from './charityEvents.js';
import { businessNow, realNow } from './clock.js';
import { config } from './config.js';
import { copenhagenMonth } from './copenhagen.js';
import { inTransaction, query } from './db.js';
import { refundSplit, type Remainders, type Split } from './domain.js';
import { sendLapseNotice, sendRefundNotice } from './emails.js';
import { fail, failOutage } from './errors.js';
import { writeFulfilmentEvent, publishPendingEvents } from './fulfilment.js';
import { consumeHold } from './holds.js';
import { loadOrder, newEventId, refundedSoFar, updateOrder, type OrderRow } from './orders.js';
import { alertMaker } from './services/alerts.js';
import * as gateway from './services/gateway.js';
import * as killbill from './services/killbill.js';
import type { OutageSurface } from '../shared/copy.js';

/** The ledger replies apply before the gateway is called. */
export async function requireLedger(surface: OutageSurface): Promise<void> {
  if (!(await killbill.ledgerUp())) throw failOutage('ledger_unreachable', surface);
}

export async function ensureLedgerAccount(order: OrderRow): Promise<string> {
  if (order.killbill_account_id !== null) return order.killbill_account_id;
  const accountId = await killbill.accountFor(order.buyer_email, order.buyer_name);
  await query('UPDATE orders SET killbill_account_id = $2 WHERE reference = $1', [
    order.reference,
    accountId,
  ]);
  order.killbill_account_id = accountId;
  return accountId;
}

function invoiceAmounts(order: OrderRow): killbill.InvoiceAmounts {
  return {
    'maker share': order.maker_ore,
    'charity share': order.charity_ore,
    VAT: order.vat_ore,
    courier: order.courier_ore,
  };
}

/** One committed invoice and one AUTHORIZE for a card order. */
export async function recordLedgerAuthorisation(order: OrderRow): Promise<void> {
  if (order.ledger_authorised) return;
  const accountId = await ensureLedgerAccount(order);
  const invoiceId =
    order.killbill_invoice_id ?? (await killbill.createInvoice(accountId, invoiceAmounts(order)));
  await killbill.authorise(accountId, order.reference, order.total_ore, `${order.reference}-authorise`);
  await query(
    'UPDATE orders SET killbill_invoice_id = $2, ledger_authorised = true WHERE reference = $1',
    [order.reference, invoiceId],
  );
  order.killbill_invoice_id = invoiceId;
  order.ledger_authorised = true;
}

async function postSaleLine(
  executor: Pick<import('pg').PoolClient, 'query'>,
  order: OrderRow,
  postedAt: Date,
): Promise<void> {
  await executor.query(
    `INSERT INTO split_lines
       (reference, box_number, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_basis_points, posted_at, posted_month)
     VALUES ($1, $2, 'sale', $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING`,
    [
      order.reference,
      order.box_number,
      order.gross_ore,
      order.net_ore,
      order.vat_ore,
      order.charity_ore,
      order.maker_ore,
      order.rate_basis_points,
      postedAt,
      copenhagenMonth(postedAt),
    ],
  );
}

/** The box becomes a claim only while the hold is still live. */
export async function claimAuthorised(order: OrderRow, paymentId: string): Promise<void> {
  await inTransaction(async (client) => {
    await moveBox(client, order.box_number, 'held', 'claimed');
    await updateOrder(client, order.reference, {
      payment_state: 'authorised',
      payment_id: paymentId,
      authorised_at: businessNow(),
      auth_expires_at: new Date(realNow().getTime() + config.authSeconds * 1000),
      live_claim: true,
      challenge_id: null,
      challenge_expires_at: null,
    });
  });
  await consumeHold(order.box_number);
  order.payment_state = 'authorised';
  order.payment_id = paymentId;
  announceBox(order.box_number, 'claimed');
  await syncSearch([order.box_number]);
  await checkStockThresholds();
  await recordLedgerAuthorisation(order);
}

/** An authorisation landing after its hold ended is voided automatically. */
export async function voidTooLate(order: OrderRow, paymentId: string): Promise<void> {
  await gateway.voidPayment(paymentId, `${order.reference}-void-too-late`);
  await query(
    `UPDATE orders SET payment_state = 'voided', payment_id = $2, authorised_too_late = true,
       challenge_id = NULL, challenge_expires_at = NULL, updated_at = now() WHERE reference = $1`,
    [order.reference, paymentId],
  );
  order.payment_state = 'voided';
  order.authorised_too_late = true;
}

async function zeroInvoice(order: OrderRow): Promise<void> {
  if (order.killbill_invoice_id === null || order.killbill_account_id === null) return;
  const amounts = invoiceAmounts(order);
  for (const description of killbill.itemDescriptions) {
    await killbill.adjustItem(
      order.killbill_invoice_id,
      order.killbill_account_id,
      description,
      amounts[description],
    );
  }
}

/** A void or an expiry releases the box and leaves zero split totals. */
export async function voidAuthorisation(
  order: OrderRow,
  outcome: 'voided' | 'authorisation_expired',
): Promise<void> {
  if (order.payment_id !== null) {
    await gateway.voidPayment(order.payment_id, `${order.reference}-void`);
  }
  await inTransaction(async (client) => {
    await moveBox(client, order.box_number, 'claimed', 'available');
    await updateOrder(client, order.reference, { payment_state: outcome, live_claim: false });
  });
  order.payment_state = outcome;
  announceBox(order.box_number, 'available');
  await syncSearch([order.box_number]);
  await checkStockThresholds();
  if (order.ledger_authorised) {
    await killbill.voidPayment(order.reference).catch(() => undefined);
    await zeroInvoice(order).catch(() => undefined);
  }
  if (outcome === 'authorisation_expired') {
    await alertMaker(
      'Authorisation expired',
      `Box ${order.box_number}: authorisation of DKK ${formatKroner(order.total_ore)} expired and was voided.`,
    );
  }
}

/** Reported captured only once the gateway and the ledger both say so. */
export async function completeCaptureIfConfirmed(order: OrderRow): Promise<boolean> {
  const fresh = await loadOrder(order.reference);
  if (fresh === null) return false;
  if (!fresh.gateway_captured) return false;
  if (fresh.payment_state === 'captured' || fresh.paid_at !== null) return true;
  if (!fresh.ledger_captured) {
    await killbill.capture(
      await ledgerPaymentId(fresh),
      fresh.total_ore,
      `${fresh.reference}-capture`,
    );
    await query('UPDATE orders SET ledger_captured = true WHERE reference = $1', [fresh.reference]);
    fresh.ledger_captured = true;
  }
  const paidAt = businessNow();
  await inTransaction(async (client) => {
    await moveBox(client, fresh.box_number, 'claimed', 'packed');
    await updateOrder(client, fresh.reference, {
      payment_state: 'captured',
      paid_at: paidAt,
      certificate_state: 'pending',
    });
    await postSaleLine(client, fresh, paidAt);
    await writeFulfilmentEvent(client, 'order.paid', fresh.reference, fresh.box_number, paidAt);
    await writeFulfilmentEvent(client, 'box.packed', fresh.reference, fresh.box_number, paidAt);
  });
  announceBox(fresh.box_number, 'packed');
  await syncSearch([fresh.box_number]);
  await publishPendingEvents();
  return true;
}

async function ledgerPaymentId(order: OrderRow): Promise<string> {
  const reply = await killbill.paymentIdFor(order.reference);
  if (reply === null) {
    await recordLedgerAuthorisation(order);
    const retry = await killbill.paymentIdFor(order.reference);
    if (retry === null) throw new killbill.LedgerUnreachable('ledger has no payment');
    return retry;
  }
  return reply;
}

export async function markCaptureFailed(order: OrderRow): Promise<void> {
  await query(
    "UPDATE orders SET payment_state = 'capture_failed', capture_requested = false, updated_at = now() WHERE reference = $1",
    [order.reference],
  );
  order.payment_state = 'capture_failed';
  await alertMaker(
    'Capture failed',
    `Box ${order.box_number}: capture of DKK ${formatKroner(order.total_ore)} failed.`,
  );
}

/** A settled transfer claims the box and is the bank order's paid moment. */
export async function settleTransfer(order: OrderRow): Promise<void> {
  const accountId = await ensureLedgerAccount(order);
  const invoiceId =
    order.killbill_invoice_id ?? (await killbill.createInvoice(accountId, invoiceAmounts(order)));
  await killbill.purchase(accountId, order.reference, order.total_ore, `${order.reference}-purchase`);
  const paidAt = businessNow();
  await inTransaction(async (client) => {
    await moveBox(client, order.box_number, 'awaiting_transfer', 'claimed');
    await updateOrder(client, order.reference, {
      payment_state: 'settled',
      paid_at: paidAt,
      certificate_state: 'pending',
      killbill_invoice_id: invoiceId,
      ledger_authorised: true,
      gateway_captured: true,
      ledger_captured: true,
    });
    await postSaleLine(client, order, paidAt);
    await writeFulfilmentEvent(client, 'order.paid', order.reference, order.box_number, paidAt);
  });
  order.payment_state = 'settled';
  order.killbill_invoice_id = invoiceId;
  announceBox(order.box_number, 'claimed');
  await syncSearch([order.box_number]);
  await publishPendingEvents();
}

export async function lapseTransfer(order: OrderRow): Promise<void> {
  await inTransaction(async (client) => {
    await moveBox(client, order.box_number, 'awaiting_transfer', 'available');
    await updateOrder(client, order.reference, { payment_state: 'lapsed', live_claim: false });
  });
  order.payment_state = 'lapsed';
  announceBox(order.box_number, 'available');
  await syncSearch([order.box_number]);
  await checkStockThresholds();
  await sendLapseNotice(order).catch(() => undefined);
}

export interface RefundRow {
  refund_id: string;
  reference: string;
  state: 'pending' | 'settled';
  amount_ore: number;
  net_ore: number;
  vat_ore: number;
  charity_ore: number;
  maker_ore: number;
  gateway_refund_id: string | null;
  gateway_confirmed: boolean;
  ledger_recorded: boolean;
}

/** Refunds in progress count against the remainder. */
export async function reserveRefund(order: OrderRow, amountOre: number): Promise<RefundRow> {
  return inTransaction(async (client) => {
    await client.query('SELECT 1 FROM orders WHERE reference = $1 FOR UPDATE', [order.reference]);
    const drawn = await client.query<{
      gross: string;
      net: string;
      vat: string;
      charity: string;
      maker: string;
    }>(
      `SELECT coalesce(sum(amount_ore),0)::text AS gross,
              coalesce(sum(net_ore),0)::text AS net,
              coalesce(sum(vat_ore),0)::text AS vat,
              coalesce(sum(charity_ore),0)::text AS charity,
              coalesce(sum(maker_ore),0)::text AS maker
         FROM refunds WHERE reference = $1 AND state IN ('pending','settled')`,
      [order.reference],
    );
    const used = drawn.rows[0] as { gross: string; net: string; vat: string; charity: string; maker: string };
    const left: Remainders = {
      grossOre: order.gross_ore - Number(used.gross),
      netOre: order.net_ore - Number(used.net),
      vatOre: order.vat_ore - Number(used.vat),
      charityOre: order.charity_ore - Number(used.charity),
      makerOre: order.maker_ore - Number(used.maker),
    };
    if (amountOre > left.grossOre) throw fail(422, 'refund_exceeds_remainder');
    const split: Split = refundSplit(amountOre, order.rate_basis_points, left);
    const refundId = `ref_${randomUUID()}`;
    await client.query(
      `INSERT INTO refunds (refund_id, reference, state, amount_ore, net_ore, vat_ore, charity_ore, maker_ore)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7)`,
      [refundId, order.reference, amountOre, split.netOre, split.vatOre, split.charityOre, split.makerOre],
    );
    return {
      refund_id: refundId,
      reference: order.reference,
      state: 'pending',
      amount_ore: amountOre,
      net_ore: split.netOre,
      vat_ore: split.vatOre,
      charity_ore: split.charityOre,
      maker_ore: split.makerOre,
      gateway_refund_id: null,
      gateway_confirmed: false,
      ledger_recorded: false,
    };
  });
}

export async function dropRefund(refundId: string): Promise<void> {
  await query("DELETE FROM refunds WHERE refund_id = $1 AND state = 'pending'", [refundId]);
}

/** Reported settled only once the gateway and the ledger both say so. */
export async function settleRefundIfConfirmed(refundId: string): Promise<RefundRow | null> {
  const rows = await query<RefundRow>('SELECT * FROM refunds WHERE refund_id = $1', [refundId]);
  const refund = rows[0];
  if (refund === undefined) return null;
  if (refund.state === 'settled') return refund;
  if (!refund.gateway_confirmed) return refund;
  const order = await loadOrder(refund.reference);
  if (order === null) return refund;

  if (!refund.ledger_recorded) {
    await killbill.refund(
      await ledgerPaymentId(order),
      refund.amount_ore,
      `${order.reference}-${refundId}`,
    );
    await query('UPDATE refunds SET ledger_recorded = true WHERE refund_id = $1', [refundId]);
    refund.ledger_recorded = true;
  }

  const settledAt = businessNow();
  const drawn = await refundedSoFar(order.reference);
  const emptied = drawn.grossOre >= order.gross_ore;
  const nextState: PaymentState = emptied ? 'refunded' : 'partially_refunded';

  await inTransaction(async (client) => {
    await client.query(
      "UPDATE refunds SET state = 'settled', settled_at = $2 WHERE refund_id = $1",
      [refundId, settledAt],
    );
    await client.query(
      `INSERT INTO split_lines
         (reference, box_number, kind, refund_id, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, rate_basis_points, posted_at, posted_month)
       VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING`,
      [
        order.reference,
        order.box_number,
        refundId,
        -refund.amount_ore,
        -refund.net_ore,
        -refund.vat_ore,
        -refund.charity_ore,
        -refund.maker_ore,
        order.rate_basis_points,
        settledAt,
        copenhagenMonth(settledAt),
      ],
    );
    await updateOrder(client, order.reference, {
      payment_state: nextState,
      ...(emptied ? { certificate_state: 'cancelled' } : {}),
    });
    if (emptied) {
      const boxState = await client.query<{ state: string }>(
        'SELECT state FROM boxes WHERE number = $1',
        [order.box_number],
      );
      const current = boxState.rows[0]?.state;
      if (current === 'claimed' || current === 'packed' || current === 'shipped') {
        await moveBox(client, order.box_number, current, 'returned');
      }
    }
  });

  if (order.killbill_invoice_id !== null && order.killbill_account_id !== null) {
    await killbill.adjustItem(
      order.killbill_invoice_id,
      order.killbill_account_id,
      'maker share',
      refund.maker_ore,
    );
    await killbill.adjustItem(
      order.killbill_invoice_id,
      order.killbill_account_id,
      'charity share',
      refund.charity_ore,
    );
    await killbill.adjustItem(order.killbill_invoice_id, order.killbill_account_id, 'VAT', refund.vat_ore);
  }

  if (emptied) {
    announceBox(order.box_number, 'returned');
    await syncSearch([order.box_number]);
  }

  const eventId = newEventId();
  await keepCharityEvent(eventId, 'refund.settled', {
    eventId,
    reference: order.reference,
    boxNumber: order.box_number,
    refundId,
    refundOre: refund.amount_ore,
    netOre: refund.net_ore,
    vatOre: refund.vat_ore,
    charityOre: refund.charity_ore,
    makerOre: refund.maker_ore,
    settledAt: settledAt.toISOString(),
  });
  await flushCharityEvent(eventId).catch(() => undefined);
  await sendRefundNotice(order, refund.amount_ore).catch(() => undefined);

  return { ...refund, state: 'settled' };
}
