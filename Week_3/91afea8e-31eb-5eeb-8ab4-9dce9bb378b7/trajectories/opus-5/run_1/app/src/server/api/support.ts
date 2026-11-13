/** Support: one order across its shipments, a line refund and a reopened return. */

import { one, query } from '../db.js';
import { returnMoveAllowed } from '../domain/transitions.js';
import { invalidTransition, notFound, validationFailed } from '../http/errors.js';
import { json, route } from '../http/router.js';
import { Validator } from '../http/validate.js';
import {
  createRefund,
  lineRefundAmount,
  postReturnSettlement,
} from '../payments.js';
import { returnView, sellerShipmentView, shopperShipmentView } from '../views.js';
import { FIELD } from '../../shared/messages.js';
import type { LegMethod, ShipmentState } from '../../shared/types.js';

export function registerSupportRoutes(): void {
  route('GET', '/api/support/orders/:orderId', 'support', async (ctx) => {
    const order = await one<{ id: string; shopper_name: string; phone: string }>(
      `SELECT o.id, a.name AS shopper_name, a.phone
         FROM orders o JOIN accounts a ON a.id = o.account_id WHERE o.id = $1`,
      [ctx.params.orderId],
    );
    if (order === null) throw notFound();
    const legs = await query<{
      method: LegMethod;
      amount_paise: number;
      refunded_paise: number;
      card_last4: string | null;
      card_network: string | null;
    }>(
      `SELECT method, amount_paise, refunded_paise, card_last4, card_network
         FROM payment_legs WHERE order_id = $1 ORDER BY created_seq`,
      [order.id],
    );
    const shipmentRows = await query<{ id: string; seller_name: string; state: ShipmentState }>(
      `SELECT s.id, se.display_name AS seller_name, s.state
         FROM shipments s JOIN sellers se ON se.id = s.seller_id
        WHERE s.order_id = $1 ORDER BY s.created_seq`,
      [order.id],
    );
    const shipments = [];
    for (const row of shipmentRows) {
      const shopperView = await shopperShipmentView(row.id);
      const sellerView = await sellerShipmentView(row.id);
      if (shopperView === null || sellerView === null) continue;
      shipments.push({
        shipment_id: row.id,
        seller_name: row.seller_name,
        state: row.state,
        shopper_view: shopperView,
        seller_view: sellerView,
      });
    }
    const returnRows = await query<{ id: string }>(
      `SELECT r.id FROM returns r JOIN shipments s ON s.id = r.shipment_id
        WHERE s.order_id = $1 ORDER BY r.created_at`,
      [order.id],
    );
    const returns = [];
    for (const row of returnRows) {
      const view = await returnView(row.id);
      if (view !== null) returns.push(view);
    }
    return json({
      order_id: order.id,
      shopper: {
        name: order.shopper_name,
        phone_masked: `******${order.phone.slice(-4)}`,
      },
      payment: { legs },
      shipments,
      returns,
    });
  });

  route('POST', '/api/support/shipment-lines/:lineId/refunds', 'support', async (ctx) => {
    const validator = new Validator(ctx.body, ['quantity', 'reason']);
    const quantity = validator.integer('quantity', {
      min: 1,
      max: 10,
      message: FIELD.quantityOverTen,
    });
    const reason = validator.text('reason', { label: 'Reason', min: 10, max: 500 });
    validator.done();

    const line = await one<{
      line_id: string;
      shipment_id: string;
      order_id: string;
      quantity: number;
      refunded_quantity: number;
      state: ShipmentState;
    }>(
      `SELECT sl.line_id, sl.shipment_id, s.order_id, sl.quantity, sl.refunded_quantity, s.state
         FROM shipment_lines sl JOIN shipments s ON s.id = sl.shipment_id
        WHERE sl.line_id = $1`,
      [ctx.params.lineId],
    );
    if (line === null) throw notFound();
    if (line.state !== 'delivered') throw invalidTransition(line.state, 'refunded');
    const openReturn = await one<{ id: string }>(
      `SELECT id FROM returns WHERE shipment_line_id = $1 AND state = 'requested'`,
      [line.line_id],
    );
    if (openReturn !== null) throw invalidTransition('requested', 'refunded');
    const remaining = line.quantity - line.refunded_quantity;
    if (quantity > remaining) {
      throw validationFailed({ quantity: FIELD.refundTooLarge(Math.max(remaining, 0)) });
    }
    const amount = await lineRefundAmount(line.line_id, quantity);
    const refund = await createRefund({
      orderId: line.order_id,
      shipmentId: line.shipment_id,
      shipmentLineId: line.line_id,
      quantity,
      amountPaise: amount,
      kind: 'support',
      reason,
    });
    await postReturnSettlement({
      shipmentId: line.shipment_id,
      lineId: line.line_id,
      quantity,
      refundId: refund.refundId,
    });
    const pending = refund.legs.some((leg) => leg.status === 'pending');
    return json(
      {
        refund_id: refund.refundId,
        amount_paise: refund.amountPaise,
        legs: refund.legs,
        status: pending ? 'pending' : 'confirmed',
      },
      201,
    );
  });

  route('POST', '/api/support/returns/:returnId/reopen', 'support', async (ctx) => {
    const validator = new Validator(ctx.body, ['note']);
    validator.text('note', { label: 'Reason', min: 10, max: 500 });
    validator.done();
    const row = await one<{ id: string; state: 'requested' | 'picked' | 'declined' | 'refunded' }>(
      `SELECT id, state FROM returns WHERE id = $1`,
      [ctx.params.returnId],
    );
    if (row === null) throw notFound();
    if (!returnMoveAllowed(row.state, 'requested')) throw invalidTransition(row.state, 'requested');
    await query(
      `UPDATE returns SET state = 'requested', decline_reason = NULL WHERE id = $1`,
      [row.id],
    );
    const view = await returnView(row.id);
    if (view === null) throw notFound();
    return json(view);
  });
}
