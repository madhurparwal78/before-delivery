/** Payment legs, refund routing and the provider-confirmed statuses sellers see. */

import { config } from './config.js';
import { one, query } from './db.js';
import { newId } from './domain/identity.js';
import { proratedShare } from './domain/money.js';
import { returnSettlement, saleSettlement, type SettlementAmounts } from './domain/settlement.js';
import { indiaDate } from './domain/time.js';
import {
  ensureShopperAccount,
  recordPurchase,
  recordRefund,
} from './services/killbill.js';
import { netbankingStatus, upiStatus } from './services/provider.js';
import { storeShipmentDocuments } from './documents.js';
import type { LegMethod } from '../shared/types.js';

export type LegRow = {
  leg_id: string;
  payment_id: string;
  order_id: string;
  shipment_id: string | null;
  method: LegMethod;
  amount_paise: number;
  status: string;
  external_key: string;
  kb_payment_id: string | null;
  kb_recorded: boolean;
  refunded_paise: number;
  card_last4: string | null;
  card_network: string | null;
};

export async function kbAccountFor(accountId: string): Promise<string | null> {
  const account = await one<{ name: string }>(`SELECT name FROM accounts WHERE id = $1`, [accountId]);
  if (account === null) return null;
  return ensureShopperAccount(accountId, account.name);
}

/** Records one leg in Kill Bill. Returns false while Kill Bill is away. */
export async function recordLeg(leg: LegRow, accountId: string): Promise<boolean> {
  if (leg.kb_recorded) return true;
  const kbAccountId = await kbAccountFor(accountId);
  if (kbAccountId === null) return false;
  const kbPaymentId = await recordPurchase({
    kbAccountId,
    externalKey: leg.external_key,
    amountPaise: leg.amount_paise,
  });
  if (kbPaymentId === null) return false;
  await query(
    `UPDATE payment_legs SET kb_payment_id = $2, kb_recorded = true, status = 'confirmed'
      WHERE leg_id = $1`,
    [leg.leg_id, kbPaymentId],
  );
  return true;
}

export async function legsOfOrder(orderId: string): Promise<LegRow[]> {
  return query<LegRow>(
    `SELECT leg_id, payment_id, order_id, shipment_id, method, amount_paise, status, external_key,
            kb_payment_id, kb_recorded, refunded_paise, card_last4, card_network
       FROM payment_legs WHERE order_id = $1 ORDER BY created_seq`,
    [orderId],
  );
}

/** A shipment's payment is paid only when every leg covering it is recorded in Kill Bill. */
export async function shipmentPaymentStatus(
  shipmentId: string,
): Promise<'pending' | 'paid' | 'partially_refunded' | 'refunded'> {
  const row = await one<{
    order_id: string;
    payment_kind: string;
  }>(`SELECT order_id, payment_kind FROM shipments WHERE id = $1`, [shipmentId]);
  if (row === null) return 'pending';
  const legs = (await legsOfOrder(row.order_id)).filter(
    (leg) => leg.shipment_id === null || leg.shipment_id === shipmentId,
  );
  if (legs.length === 0 || legs.some((leg) => !leg.kb_recorded)) return 'pending';
  const total = legs.reduce((sum, leg) => sum + leg.amount_paise, 0);
  const refunded = legs.reduce((sum, leg) => sum + leg.refunded_paise, 0);
  if (refunded >= total && refunded > 0) return 'refunded';
  if (refunded > 0) return 'partially_refunded';
  return 'paid';
}

export type RefundRequest = {
  orderId: string;
  shipmentId: string;
  shipmentLineId: string | null;
  quantity: number | null;
  amountPaise: number;
  kind: 'return' | 'cancel' | 'support';
  reason: string;
};

export type RefundView = {
  refundId: string;
  amountPaise: number;
  legs: { method: LegMethod; amount_paise: number; status: string }[];
};

/** Refunds go to the other method first and the balance last, in whole paise. */
export async function createRefund(request: RefundRequest): Promise<RefundView> {
  const refundId = newId('RF-');
  await query(
    `INSERT INTO refunds (id, kind, order_id, shipment_id, shipment_line_id, quantity, amount_paise, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      refundId,
      request.kind,
      request.orderId,
      request.shipmentId,
      request.shipmentLineId,
      request.quantity,
      request.amountPaise,
      request.reason,
    ],
  );
  const legs = await legsOfOrder(request.orderId);
  const ordered = [
    ...legs.filter((leg) => leg.method !== 'balance'),
    ...legs.filter((leg) => leg.method === 'balance'),
  ];
  let remaining = request.amountPaise;
  for (const leg of ordered) {
    if (remaining <= 0) break;
    const pendingOnLeg = await one<{ pending: number }>(
      `SELECT COALESCE(sum(amount_paise), 0)::bigint AS pending FROM refund_legs
        WHERE leg_id = $1 AND status = 'pending'`,
      [leg.leg_id],
    );
    const available = leg.amount_paise - leg.refunded_paise - (pendingOnLeg?.pending ?? 0);
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    await query(
      `INSERT INTO refund_legs (id, refund_id, leg_id, method, amount_paise, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [newId('RL-'), refundId, leg.leg_id, leg.method, take],
    );
    remaining -= take;
  }
  if (request.shipmentLineId !== null) {
    await query(
      `UPDATE shipment_lines SET refunded_paise = refunded_paise + $2,
              refunded_quantity = refunded_quantity + $3
        WHERE line_id = $1`,
      [request.shipmentLineId, request.amountPaise, request.quantity ?? 0],
    );
  }
  await settleRefundLegs(refundId);
  return readRefund(refundId);
}

export async function readRefund(refundId: string): Promise<RefundView> {
  const refund = await one<{ amount_paise: number }>(
    `SELECT amount_paise FROM refunds WHERE id = $1`,
    [refundId],
  );
  const legs = await query<{ method: LegMethod; amount_paise: number; status: string }>(
    `SELECT method, amount_paise, status FROM refund_legs WHERE refund_id = $1 ORDER BY created_seq`,
    [refundId],
  );
  return {
    refundId,
    amountPaise: refund?.amount_paise ?? 0,
    legs,
  };
}

/** Sends pending refund legs to Kill Bill; a refund counts only once it records. */
export async function settleRefundLegs(refundId: string): Promise<void> {
  const rows = await query<{
    id: string;
    leg_id: string;
    method: LegMethod;
    amount_paise: number;
    kb_payment_id: string | null;
    kb_recorded: boolean;
    account_id: string;
    balance_credited: boolean;
  }>(
    `SELECT rl.id, rl.leg_id, rl.method, rl.amount_paise, pl.kb_payment_id, pl.kb_recorded,
            o.account_id, rl.balance_credited
       FROM refund_legs rl
       JOIN payment_legs pl ON pl.leg_id = rl.leg_id
       JOIN orders o ON o.id = pl.order_id
      WHERE rl.refund_id = $1 AND rl.status = 'pending'`,
    [refundId],
  );
  for (const row of rows) {
    if (!row.kb_recorded || row.kb_payment_id === null) continue;
    const recorded = await recordRefund({
      kbPaymentId: row.kb_payment_id,
      transactionExternalKey: `${refundId}-${row.id}`,
      amountPaise: row.amount_paise,
    });
    if (!recorded) continue;
    await query(`UPDATE refund_legs SET status = 'confirmed' WHERE id = $1`, [row.id]);
    await query(
      `UPDATE payment_legs SET refunded_paise = refunded_paise + $2 WHERE leg_id = $1`,
      [row.leg_id, row.amount_paise],
    );
    if ((row.method === 'balance' || row.method === 'cod') && !row.balance_credited) {
      await query(`UPDATE accounts SET balance_paise = balance_paise + $2 WHERE id = $1`, [
        row.account_id,
        row.amount_paise,
      ]);
      await query(`UPDATE refund_legs SET balance_credited = true WHERE id = $1`, [row.id]);
    }
  }
}

export async function settleAllPendingRefunds(): Promise<void> {
  const rows = await query<{ refund_id: string }>(
    `SELECT DISTINCT refund_id FROM refund_legs WHERE status = 'pending'`,
  );
  for (const row of rows) await settleRefundLegs(row.refund_id);
}

/** Records legs that confirm at once but could not reach Kill Bill earlier. */
export async function recordPendingLegs(): Promise<void> {
  const rows = await query<LegRow & { account_id: string }>(
    `SELECT pl.leg_id, pl.payment_id, pl.order_id, pl.shipment_id, pl.method, pl.amount_paise,
            pl.status, pl.external_key, pl.kb_payment_id, pl.kb_recorded, pl.refunded_paise,
            pl.card_last4, pl.card_network, o.account_id
       FROM payment_legs pl
       JOIN orders o ON o.id = pl.order_id
       JOIN payments p ON p.payment_id = pl.payment_id
      WHERE pl.kb_recorded = false AND pl.status = 'confirmed'`,
  );
  for (const row of rows) {
    const recorded = await recordLeg(row, row.account_id);
    if (recorded) await storeShipmentDocumentsForOrder(row.order_id);
  }
}

async function storeShipmentDocumentsForOrder(orderId: string): Promise<void> {
  const shipments = await query<{ id: string }>(`SELECT id FROM shipments WHERE order_id = $1`, [
    orderId,
  ]);
  for (const shipment of shipments) await storeShipmentDocuments(shipment.id);
}

/** Asks the provider about a UPI or net-banking payment and moves it on. */
export async function pollProviderPayment(paymentId: string): Promise<void> {
  const payment = await one<{
    payment_id: string;
    order_id: string;
    account_id: string;
    method: string;
    status: string;
    expired: boolean;
  }>(
    `SELECT payment_id, order_id, account_id, method, status,
            (initiated_at + ($2 || ' seconds')::interval <= now()) AS expired
       FROM payments WHERE payment_id = $1`,
    [paymentId, String(config.upiExpirySeconds)],
  );
  if (payment === null || payment.status !== 'awaiting_customer') return;
  const status =
    payment.method === 'upi' ? await upiStatus(paymentId) : await netbankingStatus(paymentId);
  if (status === 'SUCCESS') {
    const legs = await legsOfOrder(payment.order_id);
    let allRecorded = true;
    for (const leg of legs) {
      if (leg.method === 'cod') continue;
      const recorded = await recordLeg({ ...leg, status: 'confirmed' }, payment.account_id);
      if (!recorded) allRecorded = false;
    }
    if (!allRecorded) return;
    await query(`UPDATE payments SET status = 'confirmed' WHERE payment_id = $1`, [paymentId]);
    await query(`UPDATE orders SET status = 'placed' WHERE id = $1`, [payment.order_id]);
    await storeShipmentDocumentsForOrder(payment.order_id);
    return;
  }
  if (status === 'FAILED' || payment.expired) {
    await failPayment(paymentId, status === 'FAILED' ? 'failed' : 'expired');
  }
}

export async function failPayment(paymentId: string, state: 'failed' | 'expired'): Promise<void> {
  const payment = await one<{ order_id: string; account_id: string }>(
    `SELECT order_id, account_id FROM payments WHERE payment_id = $1 AND status = 'awaiting_customer'`,
    [paymentId],
  );
  if (payment === null) return;
  await query(`UPDATE payments SET status = $2 WHERE payment_id = $1`, [paymentId, state]);
  await query(`UPDATE orders SET status = 'failed' WHERE id = $1`, [payment.order_id]);
  const shipments = await query<{ id: string; state: string }>(
    `SELECT id, state FROM shipments WHERE order_id = $1`,
    [payment.order_id],
  );
  for (const shipment of shipments) {
    if (shipment.state === 'cancelled') continue;
    await releaseShipmentStock(shipment.id);
    await query(`UPDATE shipments SET state = 'cancelled' WHERE id = $1`, [shipment.id]);
    await query(`INSERT INTO shipment_timeline (shipment_id, state) VALUES ($1, 'cancelled')`, [
      shipment.id,
    ]);
  }
  const balanceLeg = await one<{ amount_paise: number; leg_id: string }>(
    `SELECT leg_id, amount_paise FROM payment_legs
      WHERE order_id = $1 AND method = 'balance' AND status <> 'released'`,
    [payment.order_id],
  );
  if (balanceLeg !== null) {
    await query(`UPDATE accounts SET balance_paise = balance_paise + $2 WHERE id = $1`, [
      payment.account_id,
      balanceLeg.amount_paise,
    ]);
    await query(`UPDATE payment_legs SET status = 'released' WHERE leg_id = $1`, [balanceLeg.leg_id]);
  }
}

export async function releaseShipmentStock(shipmentId: string): Promise<void> {
  const lines = await query<{ listing_id: string; quantity: number }>(
    `SELECT listing_id, quantity FROM shipment_lines WHERE shipment_id = $1`,
    [shipmentId],
  );
  for (const line of lines) {
    await query(`UPDATE listings SET stock = stock + $2, updated_at = now() WHERE id = $1`, [
      line.listing_id,
      line.quantity,
    ]);
  }
}

export async function pollAllProviderPayments(): Promise<void> {
  const rows = await query<{ payment_id: string }>(
    `SELECT payment_id FROM payments
      WHERE status = 'awaiting_customer' AND method IN ('upi','netbanking')`,
  );
  for (const row of rows) await pollProviderPayment(row.payment_id);
}

/** Cash collected on delivery is recorded in Kill Bill when the shipment is delivered. */
export async function recordCodCollection(shipmentId: string): Promise<void> {
  const legs = await query<LegRow & { account_id: string }>(
    `SELECT pl.leg_id, pl.payment_id, pl.order_id, pl.shipment_id, pl.method, pl.amount_paise,
            pl.status, pl.external_key, pl.kb_payment_id, pl.kb_recorded, pl.refunded_paise,
            pl.card_last4, pl.card_network, o.account_id
       FROM payment_legs pl JOIN orders o ON o.id = pl.order_id
      WHERE pl.shipment_id = $1 AND pl.method = 'cod' AND pl.kb_recorded = false`,
    [shipmentId],
  );
  for (const leg of legs) {
    const recorded = await recordLeg(leg, leg.account_id);
    if (recorded) {
      await query(`UPDATE shipments SET cod_recorded = true WHERE id = $1`, [shipmentId]);
    }
  }
}

export async function recordPendingCodCollections(): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT s.id FROM shipments s
      WHERE s.state = 'delivered' AND s.payment_kind = 'cod' AND s.cod_recorded = false`,
  );
  for (const row of rows) await recordCodCollection(row.id);
}

/** One sale settlement line per shipment line, posted when the shipment is delivered. */
export async function postSaleSettlement(shipmentId: string): Promise<void> {
  const shipment = await one<{ seller_id: string; delivered_on: string | null }>(
    `SELECT seller_id, delivered_on::text FROM shipments WHERE id = $1`,
    [shipmentId],
  );
  if (shipment === null) return;
  const lines = await query<{
    line_id: string;
    quantity: number;
    unit_price_paise: number;
    gst_rate: number;
    emi_subvention_paise: number;
    commission_percent: number;
  }>(
    `SELECT sl.line_id, sl.quantity, sl.unit_price_paise, sl.gst_rate, sl.emi_subvention_paise,
            c.commission_percent
       FROM shipment_lines sl
       JOIN listings l ON l.id = sl.listing_id
       JOIN products p ON p.id = l.product_id
       JOIN categories c ON c.slug = p.category_slug
      WHERE sl.shipment_id = $1`,
    [shipmentId],
  );
  for (const line of lines) {
    const already = await one<{ id: string }>(
      `SELECT id FROM settlement_lines WHERE line_id = $1 AND kind = 'sale'`,
      [line.line_id],
    );
    if (already !== null) continue;
    const amounts = saleSettlement({
      grossPaise: line.unit_price_paise * line.quantity,
      gstRate: line.gst_rate,
      commissionPercent: line.commission_percent,
      emiSubventionPaise: line.emi_subvention_paise,
    });
    await insertSettlementLine({
      sellerId: shipment.seller_id,
      shipmentId,
      lineId: line.line_id,
      kind: 'sale',
      postedOn: shipment.delivered_on ?? indiaDate(),
      amounts,
      refundId: null,
    });
  }
}

export async function postReturnSettlement(input: {
  shipmentId: string;
  lineId: string;
  quantity: number;
  refundId: string;
}): Promise<void> {
  const shipment = await one<{ seller_id: string }>(`SELECT seller_id FROM shipments WHERE id = $1`, [
    input.shipmentId,
  ]);
  const sale = await one<{
    gross_paise: number;
    commission_percent: number;
    commission_paise: number;
    commission_gst_paise: number;
    tcs_paise: number;
    tds_paise: number;
    emi_subvention_paise: number;
    net_paise: number;
  }>(
    `SELECT gross_paise, commission_percent, commission_paise, commission_gst_paise, tcs_paise,
            tds_paise, emi_subvention_paise, net_paise
       FROM settlement_lines WHERE line_id = $1 AND kind = 'sale'`,
    [input.lineId],
  );
  if (shipment === null || sale === null) return;
  const line = await one<{ quantity: number }>(
    `SELECT quantity FROM shipment_lines WHERE line_id = $1`,
    [input.lineId],
  );
  if (line === null) return;
  const previous = await query<{
    gross_paise: number;
    commission_paise: number;
    commission_gst_paise: number;
    tcs_paise: number;
    tds_paise: number;
    emi_subvention_paise: number;
    net_paise: number;
    quantity: number;
  }>(
    `SELECT s.gross_paise, s.commission_paise, s.commission_gst_paise, s.tcs_paise, s.tds_paise,
            s.emi_subvention_paise, s.net_paise, COALESCE(r.quantity, 0) AS quantity
       FROM settlement_lines s LEFT JOIN refunds r ON r.id = s.refund_id
      WHERE s.line_id = $1 AND s.kind = 'return'`,
    [input.lineId],
  );
  const postedSoFar: SettlementAmounts = {
    gross_paise: previous.reduce((sum, row) => sum + row.gross_paise, 0),
    commission_percent: sale.commission_percent,
    commission_paise: previous.reduce((sum, row) => sum + row.commission_paise, 0),
    commission_gst_paise: previous.reduce((sum, row) => sum + row.commission_gst_paise, 0),
    tcs_paise: previous.reduce((sum, row) => sum + row.tcs_paise, 0),
    tds_paise: previous.reduce((sum, row) => sum + row.tds_paise, 0),
    emi_subvention_paise: previous.reduce((sum, row) => sum + row.emi_subvention_paise, 0),
    net_paise: previous.reduce((sum, row) => sum + row.net_paise, 0),
  };
  const returnedUnits = previous.reduce((sum, row) => sum + row.quantity, 0);
  const amounts = returnSettlement(
    {
      gross_paise: sale.gross_paise,
      commission_percent: sale.commission_percent,
      commission_paise: sale.commission_paise,
      commission_gst_paise: sale.commission_gst_paise,
      tcs_paise: sale.tcs_paise,
      tds_paise: sale.tds_paise,
      emi_subvention_paise: sale.emi_subvention_paise,
      net_paise: sale.net_paise,
    },
    line.quantity,
    input.quantity,
    returnedUnits,
    postedSoFar,
  );
  await insertSettlementLine({
    sellerId: shipment.seller_id,
    shipmentId: input.shipmentId,
    lineId: input.lineId,
    kind: 'return',
    postedOn: indiaDate(),
    amounts,
    refundId: input.refundId,
  });
}

async function insertSettlementLine(input: {
  sellerId: string;
  shipmentId: string;
  lineId: string;
  kind: 'sale' | 'return';
  postedOn: string;
  amounts: SettlementAmounts;
  refundId: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO settlement_lines (id, seller_id, shipment_id, line_id, kind, posted_on, gross_paise,
       commission_percent, commission_paise, commission_gst_paise, tcs_paise, tds_paise,
       emi_subvention_paise, net_paise, refund_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      newId('SET-'),
      input.sellerId,
      input.shipmentId,
      input.lineId,
      input.kind,
      input.postedOn,
      input.amounts.gross_paise,
      input.amounts.commission_percent,
      input.amounts.commission_paise,
      input.amounts.commission_gst_paise,
      input.amounts.tcs_paise,
      input.amounts.tds_paise,
      input.amounts.emi_subvention_paise,
      input.amounts.net_paise,
      input.refundId,
    ],
  );
}

/** The prorated refund for returning `units` of a shipment line. */
export async function lineRefundAmount(lineId: string, units: number): Promise<number> {
  const line = await one<{
    quantity: number;
    line_total_paise: number;
    refunded_paise: number;
    refunded_quantity: number;
  }>(
    `SELECT quantity, line_total_paise, refunded_paise, refunded_quantity
       FROM shipment_lines WHERE line_id = $1`,
    [lineId],
  );
  if (line === null) return 0;
  return proratedShare(
    line.line_total_paise,
    line.quantity,
    units,
    line.refunded_paise,
    line.refunded_quantity,
  );
}
