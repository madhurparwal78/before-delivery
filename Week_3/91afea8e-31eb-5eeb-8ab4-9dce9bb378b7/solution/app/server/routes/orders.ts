import type { Hono } from "hono";
import { detach } from "../background.js";
import { one, query, transaction } from "../db.js";
import { nextShipmentState } from "../domain/state.js";
import { ApiError, FIELD, notFound, validationFailed } from "../errors.js";
import { ok, route, type Reply, type Request } from "../http.js";
import { getObject } from "../services/s3.js";
import { invoiceKey, tryStoreDocuments } from "../services/documents.js";
import { parseCheckout, placeOrder, storeOrderDocuments } from "../services/checkout.js";
import { withIdempotency } from "../services/idempotency.js";
import { settleRefund } from "../services/ledger.js";
import { refreshPayment } from "../services/payments.js";
import { createRefund } from "../services/refunds.js";
import { ProviderUnavailable } from "../services/provider.js";
import { queueListing } from "../services/search.js";
import { loadReturn, requestReturn, returnView } from "../services/returns.js";
import { sellerViews, shopperViews } from "../services/views.js";
import { noFields } from "../validate.js";

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;

function actorOf(req: Request): NonNullable<Request["actor"]> {
  return req.actor as NonNullable<Request["actor"]>;
}

async function checkout(req: Request): Promise<Reply> {
  const account = actorOf(req).accountId;
  const key = req.header("idempotency-key");
  if (key === undefined || key === "") throw new ApiError(428, "idempotency_key_required");
  if (!KEY_FORMAT.test(key)) throw validationFailed({ idempotency_key: FIELD.badIdempotencyKey });
  const raw = req.json();
  const outcome = await withIdempotency(account, key, raw, req.nowMs, async () => {
    const placed = await placeOrder(account, parseCheckout(raw), req.nowMs);
    detach(storeOrderDocuments(placed.orderId));
    return { status: 201, body: { ...placed.body, server_time: new Date(req.nowMs).toISOString() } };
  });
  return { status: outcome.status, json: outcome.body, exact: true, headers: outcome.replayed ? { "Idempotent-Replayed": "true" } : undefined };
}

interface PaymentFacts {
  id: string;
  order_id: string;
  method: string | null;
  status: string;
  expires_at: number | null;
}

async function paymentLegs(paymentId: string): Promise<Record<string, unknown>[]> {
  const legs = await query<{ method: string; amount_paise: number; status: string; card_last4: string | null; card_network: string | null }>(
    "SELECT method, amount_paise, status, card_last4, card_network FROM payment_legs WHERE payment_id = $1 ORDER BY seq",
    [paymentId],
  );
  const merged = new Map<string, Record<string, unknown>>();
  for (const leg of legs) {
    const earlier = merged.get(leg.method);
    merged.set(leg.method, {
      method: leg.method,
      amount_paise: ((earlier?.amount_paise as number | undefined) ?? 0) + leg.amount_paise,
      status: leg.status,
      card_last4: leg.card_last4,
      card_network: leg.card_network,
    });
  }
  return [...merged.values()];
}

async function paymentView(req: Request): Promise<Reply> {
  const payment = await one<PaymentFacts & { account_id: string }>(
    "SELECT p.id, p.order_id, p.method, p.status, p.expires_at, o.account_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1",
    [req.params.id],
  );
  if (!payment || payment.account_id !== actorOf(req).accountId) throw notFound();
  await refreshPayment(payment.id, req.nowMs);
  const fresh = (await one<PaymentFacts>("SELECT id, order_id, method, status, expires_at FROM payments WHERE id = $1", [payment.id])) as PaymentFacts;
  const legs = (await paymentLegs(payment.id)).map((leg) => ({ method: leg.method, amount_paise: leg.amount_paise, status: leg.status }));
  return ok({
    payment_id: fresh.id,
    method: fresh.method,
    status: fresh.status,
    expires_at: fresh.expires_at === null ? null : new Date(fresh.expires_at).toISOString(),
    legs,
  });
}

function pageCursor(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(parsed) && typeof parsed[0] === "number" ? parsed[0] : null;
  } catch {
    return null;
  }
}

async function orderList(req: Request): Promise<Reply> {
  const limitRaw = req.query.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? 24 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw validationFailed({ limit: FIELD.searchPageSize });
  const after = pageCursor(req.query.get("cursor"));
  const rows = await query<{ id: string; seq: number; placed_at: number; payable_paise: number; states: string[] }>(
    `SELECT o.id, o.seq, o.placed_at, o.payable_paise, array_agg(s.state ORDER BY s.seq) AS states
       FROM orders o JOIN shipments s ON s.order_id = o.id
      WHERE o.account_id = $1 AND ($2::bigint IS NULL OR o.seq < $2) GROUP BY o.id ORDER BY o.seq DESC LIMIT $3`,
    [actorOf(req).accountId, after, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return ok({
    orders: page.map((row) => ({
      order_id: row.id,
      placed_at: new Date(row.placed_at).toISOString(),
      payable_paise: row.payable_paise,
      shipment_count: row.states.length,
      shipment_states: row.states,
    })),
    next_cursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.seq])).toString("base64url") : null,
  });
}

async function orderDetail(req: Request): Promise<Reply> {
  const order = await one<{ id: string; account_id: string; address: Record<string, unknown>; payable_paise: number; placed_at: number; payment_id: string }>(
    "SELECT * FROM orders WHERE id = $1",
    [req.params.id],
  );
  if (!order || order.account_id !== actorOf(req).accountId) throw notFound();
  const payment = (await one<PaymentFacts>("SELECT id, order_id, method, status, expires_at FROM payments WHERE id = $1", [order.payment_id])) as PaymentFacts;
  const ids = (await query<{ id: string }>("SELECT id FROM shipments WHERE order_id = $1 ORDER BY seq", [order.id])).map((row) => row.id);
  const views = await shopperViews(ids);
  const refunds = await query<{ shipment_id: string; shipment_line_id: string | null; amount_paise: number; status: string; method: string; card_last4: string | null }>(
    `SELECT f.shipment_id, f.shipment_line_id, rl.amount_paise, rl.status, pl.method, pl.card_last4
       FROM refunds f JOIN refund_legs rl ON rl.refund_id = f.id JOIN payment_legs pl ON pl.id = rl.leg_id
      WHERE pl.order_id = $1 ORDER BY rl.id`,
    [order.id],
  );
  return ok({
    order_id: order.id,
    placed_at: new Date(order.placed_at).toISOString(),
    address: order.address,
    payment: {
      payment_id: payment.id,
      method: payment.method,
      status: payment.status,
      expires_at: payment.expires_at === null ? null : new Date(payment.expires_at).toISOString(),
      legs: await paymentLegs(payment.id),
    },
    shipments: ids.map((id) => views.get(id) as Record<string, unknown>),
    payable_paise: order.payable_paise,
    refunds: refunds.map((refund) => ({
      shipment_id: refund.shipment_id,
      line_id: refund.shipment_line_id,
      amount_paise: refund.amount_paise,
      status: refund.status,
      method: refund.method,
      card_last4: refund.card_last4,
    })),
  });
}

interface ShipmentOwner {
  id: string;
  order_id: string;
  seller_id: string;
  account_id: string;
  state: "placed" | "packed" | "shipped" | "delivered" | "cancelled";
  invoice_stored: boolean;
}

async function shipmentOf(id: string): Promise<ShipmentOwner> {
  const shipment = await one<ShipmentOwner & Record<string, unknown>>(
    "SELECT s.id, s.order_id, s.seller_id, s.state, s.invoice_stored, o.account_id FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id = $1",
    [id],
  );
  if (!shipment) throw notFound();
  return shipment;
}

async function shipmentView(req: Request): Promise<Reply> {
  const actor = actorOf(req);
  const shipment = await shipmentOf(req.params.id as string);
  if (actor.role === "shopper") {
    if (shipment.account_id !== actor.accountId) throw notFound();
    return ok((await shopperViews([shipment.id])).get(shipment.id) as Record<string, unknown>);
  }
  if (shipment.seller_id !== actor.sellerId) throw notFound();
  return ok((await sellerViews([shipment.id])).get(shipment.id) as Record<string, unknown>);
}

async function cancelShipment(req: Request): Promise<Reply> {
  noFields(req.json());
  const shipment = await shipmentOf(req.params.id as string);
  if (shipment.account_id !== actorOf(req).accountId) throw notFound();
  const refundId = await transaction(async (client) => {
    const locked = (await client.query("SELECT state FROM shipments WHERE id = $1 FOR UPDATE", [shipment.id])).rows[0] as { state: ShipmentOwner["state"] };
    const next = nextShipmentState(locked.state, "cancel");
    await client.query("UPDATE shipments SET state = $2 WHERE id = $1", [shipment.id, next]);
    await client.query("INSERT INTO shipment_events (shipment_id, state, at) VALUES ($1, $2, $3)", [shipment.id, next, req.nowMs]);
    const lines = await query<{ listing_id: string; quantity: number }>("SELECT listing_id, quantity FROM shipment_lines WHERE shipment_id = $1", [shipment.id], client);
    for (const line of lines) {
      await client.query("UPDATE listings SET stock = stock + $2 WHERE id = $1", [line.listing_id, line.quantity]);
      await queueListing(line.listing_id, req.nowMs, client);
    }
    const money = await one<{ prepaid: number }>(
      `SELECT (CASE WHEN p.method = 'cod' OR p.method IS NULL
                    THEN s.balance_share_paise
                    ELSE (SELECT COALESCE(sum(line_total_paise), 0) FROM shipment_lines WHERE shipment_id = s.id) + s.gift_wrap_paise + s.delivery_fee_paise - s.emi_discount_paise END)::bigint AS prepaid
         FROM shipments s JOIN orders o ON o.id = s.order_id JOIN payments p ON p.id = o.payment_id WHERE s.id = $1`,
      [shipment.id],
      client,
    );
    const amount = money?.prepaid ?? 0;
    if (amount === 0) return null;
    return (await createRefund({ orderId: shipment.order_id, shipmentId: shipment.id, lineId: null, returnId: null, source: "cancel", quantity: 0, amountPaise: amount }, client)).refundId;
  });
  if (refundId) await settleRefund(refundId);
  return ok((await shopperViews([shipment.id])).get(shipment.id) as Record<string, unknown>);
}

async function invoice(req: Request): Promise<Reply> {
  const actor = actorOf(req);
  const shipment = await shipmentOf(req.params.id as string);
  if (actor.role === "shopper" && shipment.account_id !== actor.accountId) throw notFound();
  if (actor.role === "seller" && shipment.seller_id !== actor.sellerId) throw notFound();
  if (!shipment.invoice_stored) {
    detach(tryStoreDocuments(shipment.id));
    throw new ApiError(409, "document_pending");
  }
  try {
    const data = await getObject(invoiceKey(shipment.order_id, shipment.id));
    if (data) return { status: 200, file: { data, contentType: "application/pdf" } };
  } catch (error) {
    if (!(error instanceof ProviderUnavailable)) throw error;
  }
  throw new ApiError(409, "document_pending");
}

async function requestReturnRoute(req: Request): Promise<Reply> {
  return ok(await requestReturn(actorOf(req).accountId, req.json(), req.nowMs), 201);
}

async function returnDetail(req: Request): Promise<Reply> {
  const actor = actorOf(req);
  const record = await loadReturn(req.params.id as string);
  if (actor.role === "shopper" ? record.account_id !== actor.accountId : record.seller_id !== actor.sellerId) throw notFound();
  return ok(await returnView(record));
}

export function registerOrders(app: Hono): void {
  const shopper = { access: ["shopper"] } as const;
  route(app, ["POST"], "/api/checkout", shopper, checkout);
  route(app, ["GET"], "/api/payments/:id", shopper, paymentView);
  route(app, ["GET"], "/api/orders", shopper, orderList);
  route(app, ["GET"], "/api/orders/:id", shopper, orderDetail);
  route(app, ["GET"], "/api/shipments/:id", { access: ["shopper", "seller"] }, shipmentView);
  route(app, ["POST"], "/api/shipments/:id/cancel", shopper, cancelShipment);
  route(app, ["GET"], "/api/shipments/:id/invoice", { access: ["shopper", "seller", "support"] }, invoice);
  route(app, ["POST"], "/api/returns", shopper, requestReturnRoute);
  route(app, ["GET"], "/api/returns/:id", { access: ["shopper", "seller"] }, returnDetail);
}
