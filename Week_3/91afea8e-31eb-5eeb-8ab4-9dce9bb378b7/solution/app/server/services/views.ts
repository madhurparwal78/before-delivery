import { pool, query, type Executor } from "../db.js";
import { addDays } from "../domain/promise.js";
import type { LegRow } from "./ledger.js";

interface ShipmentRow {
  id: string;
  order_id: string;
  seller_id: string;
  seller_name: string;
  state: string;
  promise_date: string | null;
  delivery_fee_paise: number;
  cod_fee_paise: number;
  gift_wrap_paise: number;
  emi_discount_paise: number;
  delivered_on: string | null;
  invoice_stored: boolean;
  label_stored: boolean;
  address: { name: string; city: string; pincode: string };
  payment_method: string | null;
}

interface LineRow {
  id: string;
  shipment_id: string;
  listing_id: string;
  title: string;
  category: string;
  quantity: number;
  unit_price_paise: number;
  coupon_share_paise: number;
  line_total_paise: number;
  gst_rate: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

interface Loaded {
  shipments: ShipmentRow[];
  lines: LineRow[];
  legs: LegRow[];
  events: { shipment_id: string; state: string; at: number }[];
  refundTotals: { shipment_id: string; shipment_line_id: string | null; status: string; total: number }[];
  returnDays: Map<string, number>;
}

async function load(ids: readonly string[], executor: Executor): Promise<Loaded> {
  const shipments = await query<ShipmentRow & Record<string, unknown>>(
    `SELECT s.*, sel.name AS seller_name, o.address, p.method AS payment_method
       FROM shipments s JOIN orders o ON o.id = s.order_id JOIN payments p ON p.id = o.payment_id JOIN sellers sel ON sel.id = s.seller_id
      WHERE s.id = ANY($1) ORDER BY s.seq`,
    [ids],
    executor,
  );
  const orderIds = [...new Set(shipments.map((s) => s.order_id))];
  const [lines, legs, events, refundTotals, categories] = await Promise.all([
    query<LineRow & Record<string, unknown>>("SELECT * FROM shipment_lines WHERE shipment_id = ANY($1) ORDER BY seq", [ids], executor),
    query<LegRow & Record<string, unknown>>("SELECT * FROM payment_legs WHERE order_id = ANY($1) ORDER BY seq", [orderIds], executor),
    query<{ shipment_id: string; state: string; at: number }>("SELECT shipment_id, state, at FROM shipment_events WHERE shipment_id = ANY($1) ORDER BY id", [ids], executor),
    query<{ shipment_id: string; shipment_line_id: string | null; status: string; total: number }>(
      `SELECT r.shipment_id, r.shipment_line_id, rl.status, sum(rl.amount_paise)::bigint AS total
         FROM refunds r JOIN refund_legs rl ON rl.refund_id = r.id WHERE r.shipment_id = ANY($1) GROUP BY r.shipment_id, r.shipment_line_id, rl.status`,
      [ids],
      executor,
    ),
    query<{ slug: string; return_days: number }>("SELECT slug, return_days FROM categories", [], executor),
  ]);
  return { shipments, lines, legs, events, refundTotals, returnDays: new Map(categories.map((c) => [c.slug, c.return_days])) };
}

function shipmentPayablePaise(shipment: ShipmentRow, lines: readonly LineRow[]): number {
  const lineTotals = lines.filter((line) => line.shipment_id === shipment.id).reduce((sum, line) => sum + line.line_total_paise, 0);
  return lineTotals + shipment.gift_wrap_paise + shipment.delivery_fee_paise + shipment.cod_fee_paise - shipment.emi_discount_paise;
}

type PaymentStatus = "pending" | "paid" | "partially_refunded" | "refunded";

/** A shipment is paid only once every leg covering it has a successful PURCHASE in Kill Bill. */
export function legsRecorded(shipmentId: string, legs: readonly LegRow[]): boolean {
  const covering = legs.filter((leg) => leg.shipment_id === null || leg.shipment_id === shipmentId);
  return covering.length > 0 && covering.every((leg) => leg.kb_recorded);
}

function paymentStatus(shipment: ShipmentRow, loaded: Loaded): PaymentStatus {
  if (!legsRecorded(shipment.id, loaded.legs)) return "pending";
  const refunded = loaded.refundTotals.filter((r) => r.shipment_id === shipment.id && r.status === "recorded").reduce((sum, r) => sum + r.total, 0);
  if (refunded <= 0) return "paid";
  return refunded >= shipmentPayablePaise(shipment, loaded.lines) ? "refunded" : "partially_refunded";
}

export async function shopperViews(ids: readonly string[], executor: Executor = pool): Promise<Map<string, Record<string, unknown>>> {
  const loaded = await load(ids, executor);
  const views = new Map<string, Record<string, unknown>>();
  for (const shipment of loaded.shipments) {
    const days = (category: string): number => loaded.returnDays.get(category) ?? 0;
    views.set(shipment.id, {
      shipment_id: shipment.id,
      order_id: shipment.order_id,
      seller_name: shipment.seller_name,
      state: shipment.state,
      promise_date: shipment.promise_date,
      timeline: loaded.events.filter((e) => e.shipment_id === shipment.id).map((e) => ({ state: e.state, at: new Date(e.at).toISOString() })),
      delivery_fee_paise: shipment.delivery_fee_paise,
      cod_fee_paise: shipment.cod_fee_paise,
      gift_wrap_paise: shipment.gift_wrap_paise,
      invoice_status: shipment.invoice_stored ? "ready" : "pending",
      lines: loaded.lines
        .filter((line) => line.shipment_id === shipment.id)
        .map((line) => {
          const sum = (status: string): number =>
            loaded.refundTotals.filter((r) => r.shipment_line_id === line.id && r.status === status).reduce((total, r) => total + r.total, 0);
          return {
            line_id: line.id,
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
            returnable_until: shipment.delivered_on && days(line.category) > 0 ? addDays(shipment.delivered_on, days(line.category)) : null,
            refunded_paise: sum("recorded"),
            refund_pending_paise: sum("pending"),
          };
        }),
    });
  }
  return views;
}

export async function sellerViews(ids: readonly string[], executor: Executor = pool): Promise<Map<string, Record<string, unknown>>> {
  const loaded = await load(ids, executor);
  const views = new Map<string, Record<string, unknown>>();
  for (const shipment of loaded.shipments) {
    views.set(shipment.id, {
      shipment_id: shipment.id,
      order_id: shipment.order_id,
      state: shipment.state,
      promise_date: shipment.promise_date,
      ship_to: { name: shipment.address.name, city: shipment.address.city, pincode: shipment.address.pincode },
      payment_kind: shipment.payment_method === "cod" ? "cod" : "prepaid",
      payment_status: paymentStatus(shipment, loaded),
      invoice_status: shipment.invoice_stored ? "ready" : "pending",
      label_status: shipment.label_stored ? "ready" : "pending",
      lines: loaded.lines
        .filter((line) => line.shipment_id === shipment.id)
        .map((line) => ({
          line_id: line.id,
          listing_id: line.listing_id,
          title: line.title,
          quantity: line.quantity,
          unit_price_paise: line.unit_price_paise,
          gross_paise: line.unit_price_paise * line.quantity,
        })),
    });
  }
  return views;
}

/** Whether a shipment's payment is paid in the settlement sense: every covering leg recorded. */
export async function paymentRecorded(shipmentId: string, executor: Executor = pool): Promise<boolean> {
  const legs = await query<LegRow & Record<string, unknown>>(
    "SELECT l.* FROM payment_legs l JOIN shipments s ON s.order_id = l.order_id WHERE s.id = $1",
    [shipmentId],
    executor,
  );
  return legsRecorded(shipmentId, legs);
}

interface LineAccounting {
  quantity: number;
  lineTotalPaise: number;
  settledUnits: number;
  reservedUnits: number;
  refundedPaise: number;
}

export async function lineAccounting(lineId: string, executor: Executor = pool): Promise<LineAccounting> {
  const [row] = await query<{ quantity: number; line_total_paise: number; settled: number; reserved: number; refunded: number }>(
    `SELECT sl.quantity, sl.line_total_paise,
            COALESCE((SELECT sum(r.quantity) FROM refunds r WHERE r.shipment_line_id = sl.id), 0)::int AS settled,
            COALESCE((SELECT sum(rt.quantity) FROM returns rt WHERE rt.shipment_line_id = sl.id AND rt.state = 'requested'), 0)::int AS reserved,
            COALESCE((SELECT sum(r.amount_paise) FROM refunds r WHERE r.shipment_line_id = sl.id), 0)::bigint AS refunded
       FROM shipment_lines sl WHERE sl.id = $1`,
    [lineId],
    executor,
  );
  const found = row as NonNullable<typeof row>;
  return { quantity: found.quantity, lineTotalPaise: found.line_total_paise, settledUnits: found.settled, reservedUnits: found.reserved, refundedPaise: found.refunded };
}
