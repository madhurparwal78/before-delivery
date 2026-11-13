import type { PoolClient } from "pg";
import { query } from "../db.js";
import { publicId } from "../id.js";
import type { LegRow } from "./ledger.js";

type RefundSource = "return" | "support" | "cancel" | "payment";

interface RefundRequest {
  orderId: string;
  shipmentId: string;
  lineId: string | null;
  returnId: string | null;
  source: RefundSource;
  quantity: number;
  amountPaise: number;
}

interface LegCapacity {
  leg: LegRow;
  remainingPaise: number;
}

/**
 * Refund routing: the non-balance leg first, up to its unrefunded amount, then the balance leg.
 * Refunds of the balance leg and of cash collected on delivery credit the shopper's balance.
 */
function route(capacities: readonly LegCapacity[], amountPaise: number): { leg: LegRow; amountPaise: number }[] {
  const ordered = [...capacities.filter((c) => c.leg.method !== "balance"), ...capacities.filter((c) => c.leg.method === "balance")];
  const routed: { leg: LegRow; amountPaise: number }[] = [];
  let left = amountPaise;
  for (const { leg, remainingPaise } of ordered) {
    const take = Math.min(left, remainingPaise);
    if (take > 0) routed.push({ leg, amountPaise: take });
    left -= take;
  }
  return routed;
}

export interface CreatedRefund {
  refundId: string;
  legs: { method: string; amountPaise: number; status: "pending" }[];
}

/** Records a refund and its legs as pending; Kill Bill confirms each leg later. */
export async function createRefund(request: RefundRequest, client: PoolClient): Promise<CreatedRefund> {
  const legs = await query<LegRow & { refunded: number } & Record<string, unknown>>(
    `SELECT l.*, COALESCE((SELECT sum(rl.amount_paise) FROM refund_legs rl WHERE rl.leg_id = l.id), 0)::bigint AS refunded
       FROM payment_legs l
      WHERE l.order_id = $1 AND (l.shipment_id IS NULL OR l.shipment_id = $2) AND l.status <> 'failed'
      ORDER BY l.seq`,
    [request.orderId, request.shipmentId],
    client,
  );
  const routed = route(
    legs.map((leg) => ({ leg, remainingPaise: leg.amount_paise - leg.refunded })),
    request.amountPaise,
  );
  const refundId = publicId("RF");
  await query(
    "INSERT INTO refunds (id, shipment_id, shipment_line_id, return_id, source, quantity, amount_paise, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [refundId, request.shipmentId, request.lineId, request.returnId, request.source, request.quantity, request.amountPaise, Date.now()],
    client,
  );
  const created: CreatedRefund["legs"] = [];
  for (const [index, part] of routed.entries()) {
    const legId = index === 0 ? refundId : `${refundId}-${part.leg.method}`;
    await query(
      "INSERT INTO refund_legs (id, refund_id, leg_id, amount_paise, status, credits_balance) VALUES ($1, $2, $3, $4, 'pending', $5)",
      [legId, refundId, part.leg.id, part.amountPaise, part.leg.method === "balance" || part.leg.method === "cod"],
      client,
    );
    created.push({ method: part.leg.method, amountPaise: part.amountPaise, status: "pending" });
  }
  return { refundId, legs: created };
}
