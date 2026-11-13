import type { Hono } from "hono";
import { one, query } from "../db.js";
import { FIELD, notFound, validationFailed } from "../errors.js";
import { ok, route, type Reply, type Request } from "../http.js";
import { lineFacts, loadReturn, reopen, returnView, supportRefund } from "../services/returns.js";
import { sellerViews, shopperViews } from "../services/views.js";
import { Body } from "../validate.js";

async function orderLookup(req: Request): Promise<Reply> {
  const order = await one<{ id: string; account_id: string }>("SELECT id, account_id FROM orders WHERE id = $1", [req.params.id]);
  if (!order) throw notFound();
  const shopper = await one<{ name: string; phone: string }>("SELECT name, phone FROM accounts WHERE id = $1", [order.account_id]);
  const legs = await query<{ id: string; method: string; amount_paise: number; card_last4: string | null; card_network: string | null; refunded: number }>(
    `SELECT l.id, l.method, l.amount_paise, l.card_last4, l.card_network,
            COALESCE((SELECT sum(rl.amount_paise) FROM refund_legs rl WHERE rl.leg_id = l.id AND rl.status = 'recorded'), 0)::bigint AS refunded
       FROM payment_legs l WHERE l.order_id = $1 ORDER BY l.seq`,
    [order.id],
  );
  const shipments = await query<{ id: string; seller_name: string; state: string }>(
    "SELECT s.id, sel.name AS seller_name, s.state FROM shipments s JOIN sellers sel ON sel.id = s.seller_id WHERE s.order_id = $1 ORDER BY s.seq",
    [order.id],
  );
  const ids = shipments.map((shipment) => shipment.id);
  const [shopperView, sellerView] = await Promise.all([shopperViews(ids), sellerViews(ids)]);
  const returns = await query<{ id: string }>(
    `SELECT r.id FROM returns r JOIN shipment_lines sl ON sl.id = r.shipment_line_id WHERE sl.shipment_id = ANY($1) ORDER BY r.seq`,
    [ids],
  );
  const phone = shopper?.phone ?? "";
  return ok({
    order_id: order.id,
    shopper: { name: shopper?.name, phone_masked: `${"*".repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}` },
    payment: {
      legs: legs.map((leg) => ({ method: leg.method, amount_paise: leg.amount_paise, refunded_paise: leg.refunded, card_last4: leg.card_last4, card_network: leg.card_network })),
    },
    shipments: shipments.map((shipment) => ({
      shipment_id: shipment.id,
      seller_name: shipment.seller_name,
      state: shipment.state,
      shopper_view: shopperView.get(shipment.id),
      seller_view: sellerView.get(shipment.id),
    })),
    returns: await Promise.all(returns.map(async (row) => returnView(await loadReturn(row.id)))),
  });
}

async function refundLine(req: Request): Promise<Reply> {
  await lineFacts(req.params.id as string);
  const body = new Body(req.json(), ["quantity", "reason"]);
  const quantity = body.int("quantity", { min: 1, max: 10_000, message: FIELD.needsWholeNumber });
  body.text("reason", { label: "Reason", min: 10, max: 500 });
  body.done();
  if (quantity === undefined) throw validationFailed({});
  const refund = await supportRefund(req.params.id as string, quantity, req.nowMs);
  return ok(
    {
      refund_id: refund.refundId,
      amount_paise: refund.amountPaise,
      legs: refund.legs.map((leg) => ({ method: leg.method, amount_paise: leg.amountPaise, status: leg.status })),
      status: "pending",
    },
    201,
  );
}

async function reopenReturn(req: Request): Promise<Reply> {
  const record = await loadReturn(req.params.id as string);
  const body = new Body(req.json(), ["note"]);
  body.text("note", { label: "Reason", min: 10, max: 500 });
  body.done();
  return ok(await returnView(await reopen(record.id)));
}

export function registerSupport(app: Hono): void {
  const support = { access: ["support"] } as const;
  route(app, ["GET"], "/api/support/orders/:id", support, orderLookup);
  route(app, ["POST"], "/api/support/shipment-lines/:id/refunds", support, refundLine);
  route(app, ["POST"], "/api/support/returns/:id/reopen", support, reopenReturn);
}
