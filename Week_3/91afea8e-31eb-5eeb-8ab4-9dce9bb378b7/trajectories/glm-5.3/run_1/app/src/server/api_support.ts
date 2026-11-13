import { Router, type Ctx } from "./http.js";
import { ApiError, copy, notFound, validationFailed, invalidTransition } from "./errors.js";
import { one, query, withTransaction } from "./db.js";
import { id } from "./crypto.js";
import { codePoints, readBody, requireAccount, requireFields, str } from "./api_catalog.js";
import { sellerShipmentView, shipmentViewsForOrder } from "./api_orders.js";
import { startRefund } from "./api_seller.js";
import { proratedRefund } from "./domain.js";
import { istDateString } from "./time.js";

const router = new Router();
export default router;

router.add("GET", "/api/support/orders/:order_id", async (ctx) => {
  requireAccount(ctx, ["support"]);
  const order = await one<{ order_id: string; account_id: string; placed_at: string; payable_paise: string }>(
    "SELECT * FROM orders WHERE order_id = $1", [ctx.params.order_id]);
  if (!order) throw notFound();
  const shopper = await one<{ name: string; phone: string }>("SELECT name, phone FROM shoppers WHERE account_id = $1", [order.account_id]);
  const payment = await one<{ payment_id: string; method: string }>("SELECT * FROM payments WHERE order_id = $1", [order.order_id]);
  const legs = payment ? await query<{ method: string; amount_paise: string; kb_payment_id: string | null }>(
    "SELECT method, amount_paise, kb_payment_id FROM payment_legs WHERE payment_id = $1", [payment.payment_id]) : [];
  const cardByMethod = await one<{ method: string }>("SELECT method FROM payments WHERE order_id = $1", [order.order_id]);
  const cardInfo = cardByMethod?.method === "card" || cardByMethod?.method === "emi"
    ? await one<{ last4: string; network: string }>(`
        SELECT sc.last4, sc.network FROM saved_cards sc WHERE sc.account_id = $1
        ORDER BY sc.created_seq LIMIT 1`, [order.account_id])
    : null;
  const shopperViews = await shipmentViewsForOrder(order.order_id) as Array<{ shipment_id: string }>;
  const shipments = [];
  for (const view of shopperViews) {
    const sellerView = await sellerShipmentView(view.shipment_id);
    const shipmentRow = await one<{ shipment_id: string; seller_id: string }>("SELECT * FROM shipments WHERE shipment_id = $1", [view.shipment_id]);
    const seller = await one<{ name: string }>("SELECT name FROM sellers WHERE seller_id = $1", [shipmentRow!.seller_id]);
    shipments.push({
      shipment_id: view.shipment_id, seller_name: seller?.name ?? "",
      state: (sellerView as { state: string }).state,
      shopper_view: view, seller_view: sellerView,
    });
  }
  const returnRows = await query<{ return_id: string }>("SELECT return_id FROM returns WHERE order_id = $1", [order.order_id]);
  const returns = [];
  for (const r of returnRows) {
    const ret = await one<{ return_id: string; state: string; quantity: number; refund_estimate_paise: string; decline_reason: string }>(
      "SELECT * FROM returns WHERE return_id = $1", [r.return_id]);
    returns.push({
      return_id: ret!.return_id, state: ret!.state, quantity: ret!.quantity,
      refund_paise: Number(ret!.refund_estimate_paise), decline_reason: ret!.decline_reason,
    });
  }
  return {
    order_id: order.order_id,
    shopper: { name: shopper?.name ?? "", phone_masked: maskPhone(shopper?.phone ?? "") },
    payment: {
      legs: legs.map((l) => ({
        method: l.method, amount_paise: Number(l.amount_paise),
        refunded_paise: 0, card_last4: cardInfo?.last4 ?? null, card_network: cardInfo?.network ?? null,
      })),
    },
    shipments,
    returns,
  };
});

function maskPhone(phone: string): string {
  return phone.length >= 4 ? `+91 ${"*".repeat(Math.max(phone.length - 7, 0))}${phone.slice(-4)}` : phone;
}

router.add("POST", "/api/support/shipment-lines/:line_id/refunds", async (ctx) => {
  requireAccount(ctx, ["support"]);
  const body = await readBody(ctx);
  requireFields(body, ["quantity", "reason"]);
  const quantity = Number(body.quantity);
  const reason = str(body.reason);
  const fields: Record<string, string> = {};
  if (codePoints(reason) < 10 || codePoints(reason) > 500) fields.reason = copy.field.minLength("Reason", 10);
  if (!Number.isInteger(quantity) || quantity < 1) fields.quantity = "Refund at least 1 unit.";
  if (Object.keys(fields).length) throw validationFailed(fields);
  const line = await one<{ line_id: string; shipment_id: string; quantity: number; line_total_paise: string; title: string }>(
    "SELECT * FROM shipment_lines WHERE line_id = $1", [ctx.params.line_id]);
  if (!line) throw notFound();
  const shipment = await one<{ shipment_id: string; state: string; order_id: string }>(
    "SELECT * FROM shipments WHERE shipment_id = $1", [line.shipment_id]);
  if (!shipment || shipment.state !== "delivered") throw invalidTransition(shipment?.state ?? "unknown", "refund");
  const open = await one<{ n: string }>(
    "SELECT count(*) AS n FROM returns WHERE shipment_line_id = $1 AND state IN ('requested','picked')", [line.line_id]);
  if (Number(open?.n ?? 0) > 0) throw invalidTransition("refund", "refund");
  const refundedUnits = await query<{ quantity: number }>(
    "SELECT quantity FROM refunds WHERE shipment_line_id = $1 AND state = 'confirmed'", [line.line_id]);
  const remaining = line.quantity - refundedUnits.reduce((a, r) => a + r.quantity, 0);
  if (quantity > remaining) throw validationFailed({ quantity: copy.field.supportRefundTooLarge(remaining) });
  const already = refundedUnits.reduce(() => 0, 0);
  const refundAmount = proratedRefund(Number(line.line_total_paise), quantity, line.quantity, already);
  const refundId = id("REF");
  await query(
    `INSERT INTO refunds (refund_id, order_id, payment_id, kind, state, amount_paise, reason, shipment_line_id, quantity)
     VALUES ($1,(SELECT order_id FROM shipments WHERE shipment_id = $2),
       (SELECT payment_id FROM payments WHERE order_id = (SELECT order_id FROM shipments WHERE shipment_id = $2)),
       'support','pending',$3,$4,$5,$6)`,
    [refundId, line.shipment_id, refundAmount, reason, line.line_id, quantity],
  );
  await startSupportRefundLegs(refundId, line.line_id, quantity, refundAmount);
  ctx.res.statusCode = 201;
  const legs = await query<{ method: string; amount_paise: string; status: string }>(
    "SELECT method, amount_paise, status FROM refund_legs WHERE refund_id = $1", [refundId]);
  return {
    refund_id: refundId, amount_paise: refundAmount,
    legs: legs.map((l) => ({ method: l.method, amount_paise: Number(l.amount_paise), status: l.status })),
    status: "pending",
  };
});

async function startSupportRefundLegs(refundId: string, shipmentLineId: string, quantity: number, refundAmount: number): Promise<void> {
  const line = await one<{ line_id: string; shipment_id: string; order_id: string }>(`
    SELECT sl.line_id, sl.shipment_id, s.order_id FROM shipment_lines sl
    JOIN shipments s ON s.shipment_id = sl.shipment_id WHERE sl.line_id = $1`, [shipmentLineId]);
  const order = await one<{ account_id: string }>("SELECT account_id FROM orders WHERE order_id = $1", [line!.order_id]);
  const payment = await one<{ payment_id: string; method: string }>("SELECT * FROM payments WHERE order_id = $1", [line!.order_id]);
  const legs = await query<{ leg_id: string; method: string; amount_paise: string; kb_payment_id: string | null }>(
    "SELECT * FROM payment_legs WHERE payment_id = $1", [payment!.payment_id]);
  const cod = payment?.method === "cod";
  const targets: Array<{ method: string; amount: number; kbPaymentId: string | null }> = [];
  if (cod) {
    targets.push({ method: "balance", amount: refundAmount, kbPaymentId: null });
  } else {
    let remaining = refundAmount;
    for (const leg of legs.filter((l) => l.method !== "balance")) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(leg.amount_paise));
      targets.push({ method: leg.method, amount: take, kbPaymentId: leg.kb_payment_id });
      remaining -= take;
    }
    const balanceLeg = legs.find((l) => l.method === "balance");
    if (remaining > 0 && balanceLeg) targets.push({ method: "balance", amount: remaining, kbPaymentId: balanceLeg.kb_payment_id });
  }
  const { kbRecordRefund } = await import("./killbill.js");
  await withTransaction(async (client) => {
    for (const target of targets) {
      await client.query(
        `INSERT INTO refund_legs (refund_leg_id, refund_id, method, amount_paise, status, kb_payment_id, kb_txn_key)
         VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
        [id("RL"), refundId, target.method, target.amount, target.kbPaymentId, `${refundId}-${target.method}`],
      );
      if (target.kbPaymentId) {
        const ok = await kbRecordRefund(target.kbPaymentId, target.amount, `${refundId}-${target.method}`);
        if (ok) {
          await client.query("UPDATE refund_legs SET status = 'confirmed' WHERE refund_id = $1 AND method = $2", [refundId, target.method]);
        }
      } else {
        await client.query("UPDATE shoppers SET balance_paise = balance_paise + $2 WHERE account_id = $1", [order!.account_id, target.amount]);
        await client.query("UPDATE refund_legs SET status = 'confirmed' WHERE refund_id = $1 AND method = $2", [refundId, target.method]);
      }
    }
    const allConfirmed = (await client.query("SELECT count(*) AS n FROM refund_legs WHERE refund_id = $1 AND status <> 'confirmed'", [refundId])).rows[0].n === "0";
    if (allConfirmed) {
      await client.query("UPDATE refunds SET state = 'confirmed' WHERE refund_id = $1", [refundId]);
    }
  });
  void quantity;
}

router.add("POST", "/api/support/returns/:return_id/reopen", async (ctx) => {
  requireAccount(ctx, ["support"]);
  const body = await readBody(ctx);
  requireFields(body, ["note"]);
  const note = str(body.note);
  if (codePoints(note) < 10 || codePoints(note) > 500) throw validationFailed({ note: copy.field.minLength("Reason", 10) });
  const ret = await one<{ return_id: string; state: string }>("SELECT * FROM returns WHERE return_id = $1", [ctx.params.return_id]);
  if (!ret) throw notFound();
  if (ret.state !== "declined") throw invalidTransition(ret.state, "requested");
  await query("UPDATE returns SET state = 'requested', decline_reason = '', updated_at = now() WHERE return_id = $1", [ret.return_id]);
  return await one<{ return_id: string; state: string; quantity: number; refund_estimate_paise: string; decline_reason: string }>(
    "SELECT * FROM returns WHERE return_id = $1", [ret.return_id]);
});
