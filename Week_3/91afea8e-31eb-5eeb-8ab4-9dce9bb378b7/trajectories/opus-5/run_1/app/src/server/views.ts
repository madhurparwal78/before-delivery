/** The shopper and seller shipment projections, each with exactly its published keys. */

import { one, query } from './db.js';
import { addDays } from './domain/time.js';
import { shipmentPaymentStatus } from './payments.js';
import type {
  ReturnView,
  SellerShipmentView,
  ShipmentState,
  ShopperShipmentView,
} from '../shared/types.js';

type ShipmentRow = {
  id: string;
  order_id: string;
  seller_id: string;
  seller_name: string;
  account_id: string;
  state: ShipmentState;
  promise_date: string;
  delivery_fee_paise: number;
  cod_fee_paise: number;
  gift_wrap_paise: number;
  payment_kind: 'prepaid' | 'cod';
  invoice_stored: boolean;
  label_stored: boolean;
  delivered_on: string | null;
  ship_to_name: string;
  ship_to_city: string;
  ship_to_pincode: string;
};

export async function shipmentRow(shipmentId: string): Promise<ShipmentRow | null> {
  return one<ShipmentRow>(
    `SELECT s.id, s.order_id, s.seller_id, se.display_name AS seller_name, s.account_id, s.state,
            s.promise_date::text AS promise_date, s.delivery_fee_paise, s.cod_fee_paise,
            s.gift_wrap_paise, s.payment_kind, s.invoice_stored, s.label_stored,
            s.delivered_on::text AS delivered_on,
            o.address->>'name' AS ship_to_name, o.address->>'city' AS ship_to_city,
            o.address->>'pincode' AS ship_to_pincode
       FROM shipments s
       JOIN sellers se ON se.id = s.seller_id
       JOIN orders o ON o.id = s.order_id
      WHERE s.id = $1`,
    [shipmentId],
  );
}

type LineRow = {
  line_id: string;
  listing_id: string;
  title: string;
  quantity: number;
  unit_price_paise: number;
  coupon_share_paise: number;
  line_total_paise: number;
  gst_rate: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  return_days: number;
  refunded_confirmed: number;
  refunded_pending: number;
};

async function lineRows(shipmentId: string): Promise<LineRow[]> {
  return query<LineRow>(
    `SELECT sl.line_id, sl.listing_id, sl.title, sl.quantity, sl.unit_price_paise,
            sl.coupon_share_paise, sl.line_total_paise, sl.gst_rate, sl.taxable_value_paise,
            sl.cgst_paise, sl.sgst_paise, sl.igst_paise, c.return_days,
            COALESCE((SELECT sum(rl.amount_paise) FROM refunds r
                        JOIN refund_legs rl ON rl.refund_id = r.id
                       WHERE r.shipment_line_id = sl.line_id AND rl.status = 'confirmed'), 0)::bigint
              AS refunded_confirmed,
            COALESCE((SELECT sum(rl.amount_paise) FROM refunds r
                        JOIN refund_legs rl ON rl.refund_id = r.id
                       WHERE r.shipment_line_id = sl.line_id AND rl.status = 'pending'), 0)::bigint
              AS refunded_pending
       FROM shipment_lines sl
       JOIN listings l ON l.id = sl.listing_id
       JOIN products p ON p.id = l.product_id
       JOIN categories c ON c.slug = p.category_slug
      WHERE sl.shipment_id = $1
      ORDER BY sl.created_seq`,
    [shipmentId],
  );
}

export function returnableUntil(deliveredOn: string | null, returnDays: number): string | null {
  return deliveredOn === null ? null : addDays(deliveredOn, returnDays);
}

export async function shopperShipmentView(shipmentId: string): Promise<ShopperShipmentView | null> {
  const shipment = await shipmentRow(shipmentId);
  if (shipment === null) return null;
  const timeline = await query<{ state: string; at: string }>(
    `SELECT state, at FROM shipment_timeline WHERE shipment_id = $1 ORDER BY id`,
    [shipmentId],
  );
  const lines = await lineRows(shipmentId);
  return {
    shipment_id: shipment.id,
    order_id: shipment.order_id,
    seller_name: shipment.seller_name,
    state: shipment.state,
    promise_date: shipment.promise_date,
    timeline: timeline.map((entry) => ({ state: entry.state, at: new Date(entry.at).toISOString() })),
    delivery_fee_paise: shipment.delivery_fee_paise,
    cod_fee_paise: shipment.cod_fee_paise,
    gift_wrap_paise: shipment.gift_wrap_paise,
    invoice_status: shipment.invoice_stored ? 'ready' : 'pending',
    lines: lines.map((line) => ({
      line_id: line.line_id,
      title: line.title,
      quantity: line.quantity,
      unit_price_paise: line.unit_price_paise,
      coupon_share_paise: line.coupon_share_paise,
      line_total_paise: line.line_total_paise,
      gst_rate: line.gst_rate,
      taxable_value_paise: line.taxable_value_paise,
      cgst_paise: line.cgst_paise,
      sgst_paise: line.sgst_paise,
      igst_paise: line.igst_paise,
      returnable_until: returnableUntil(shipment.delivered_on, line.return_days),
      refunded_paise: line.refunded_confirmed,
      refund_pending_paise: line.refunded_pending,
    })),
  };
}

export async function sellerShipmentView(shipmentId: string): Promise<SellerShipmentView | null> {
  const shipment = await shipmentRow(shipmentId);
  if (shipment === null) return null;
  const lines = await lineRows(shipmentId);
  return {
    shipment_id: shipment.id,
    order_id: shipment.order_id,
    state: shipment.state,
    promise_date: shipment.promise_date,
    ship_to: {
      name: shipment.ship_to_name,
      city: shipment.ship_to_city,
      pincode: shipment.ship_to_pincode,
    },
    payment_kind: shipment.payment_kind,
    payment_status: await shipmentPaymentStatus(shipmentId),
    invoice_status: shipment.invoice_stored ? 'ready' : 'pending',
    label_status: shipment.label_stored ? 'ready' : 'pending',
    lines: lines.map((line) => ({
      line_id: line.line_id,
      listing_id: line.listing_id,
      title: line.title,
      quantity: line.quantity,
      unit_price_paise: line.unit_price_paise,
      gross_paise: line.unit_price_paise * line.quantity,
    })),
  };
}

export async function returnView(returnId: string): Promise<ReturnView | null> {
  const row = await one<{
    id: string;
    state: ReturnView['state'];
    quantity: number;
    refund_id: string | null;
    decline_reason: string | null;
    shipment_line_id: string;
  }>(
    `SELECT id, state, quantity, refund_id, decline_reason, shipment_line_id
       FROM returns WHERE id = $1`,
    [returnId],
  );
  if (row === null) return null;
  const legs =
    row.refund_id === null
      ? []
      : await query<{ method: ReturnView['refund_legs'][number]['method']; amount_paise: number; status: string }>(
          `SELECT method, amount_paise, status FROM refund_legs WHERE refund_id = $1 ORDER BY created_seq`,
          [row.refund_id],
        );
  const refund =
    row.refund_id === null
      ? null
      : await one<{ amount_paise: number }>(`SELECT amount_paise FROM refunds WHERE id = $1`, [
          row.refund_id,
        ]);
  return {
    return_id: row.id,
    state: row.state,
    quantity: row.quantity,
    refund_paise: refund?.amount_paise ?? 0,
    refund_legs: legs,
    decline_reason: row.decline_reason,
  };
}
