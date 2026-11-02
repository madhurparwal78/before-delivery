import { config } from "../config.js";
import { allow, crateId, CUSTOMER, FULFILMENT_TEAM, signedIn, type Ctx, type Reply } from "../context.js";
import { query, rows, tx } from "../db.js";
import { invoiceKey, storeDocuments } from "../documents.js";
import { boxCharges, cardDeclined, firstInvoice, sellOrder } from "../domain/billing.js";
import { approves, parseCard } from "../domain/card.js";
import { counts, CRATE_SIZE, lockCrate } from "../domain/crate.js";
import { abandonAttempt, beginAttempt, finishAttempt, fingerprint } from "../domain/idempotency.js";
import { insertOrder, loadOrders, orderJson, paymentKey, type FullOrder } from "../domain/orders.js";
import { buildQuote, loadPricing } from "../domain/quote.js";
import { orderConfirmed } from "../emails.js";
import { getObject } from "../files.js";
import { ApiError, bool, errorBody, notFound, str, validation } from "../http.js";
import {
  paymentMethodFor,
  completeBoxInvoice,
  createSubscription,
  ensureAccount,
  payInvoice,
  planForCrate,
  purchase,
} from "../killbill.js";
import { address } from "../pocketbase.js";

const BILLING_PAUSED = "Payments are paused for a moment. Your crate is still held, so try again shortly.";
const RECEIPTS_DOWN = "Receipts can't be saved right now, so we haven't charged you. Try again shortly.";

/** Kill Bill or MinIO outages inside checkout answer with the checkout's own outage copy. */
function outageCopy(error: unknown): unknown {
  if (error instanceof ApiError && error.code === "billing_unavailable") return new ApiError(503, error.code, BILLING_PAUSED);
  if (error instanceof ApiError && error.code === "files_unavailable") return new ApiError(503, error.code, RECEIPTS_DOWN);
  return error;
}

export async function checkout(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  allow(user, CUSTOMER);
  const key = ctx.req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8 || key.length > 128) {
    throw validation({ idempotency_key: "Send an Idempotency-Key header of 8 to 128 characters." });
  }
  const scope = `checkout:${user.id}`;
  const attempt = await beginAttempt(scope, key, fingerprint("POST", "/api/checkout", ctx.body));
  if (attempt.kind === "replay") return { status: attempt.status, body: attempt.body };
  try {
    const reply = await placeOrder(ctx, user.id, user.email, user.name);
    await finishAttempt(scope, key, reply.status, reply.body);
    return reply;
  } catch (error) {
    if (error instanceof ApiError && [402, 409, 422].includes(error.status)) {
      const body = errorBody(error);
      await finishAttempt(scope, key, error.status, body);
      return { status: error.status, body };
    }
    await abandonAttempt(scope, key);
    throw outageCopy(error);
  }
}

async function placeOrder(ctx: Ctx, userId: string, email: string, name: string): Promise<Reply> {
  const crate = await crateId(ctx);
  const held = await tx((client) => lockCrate(client, crate));
  if (held.hold_status === "expired") throw new ApiError(409, "hold_expired", "Your hold ended and the cans went back on the shelf.");
  if (held.slots.filter(Boolean).length < CRATE_SIZE) {
    throw new ApiError(409, "crate_not_full", "Fill all 12 slots before checking out.");
  }
  const cans = counts(held.slots);
  const subscribe = bool(ctx.body, "subscribe");
  const cadence = ctx.body.cadence;
  if (subscribe && !planForCrate(cans, "monthly")) {
    throw new ApiError(409, "not_subscribable", "Subscriptions come as 12 of one flavour or 4 of each.");
  }

  const fields: Record<string, string> = {};
  if (subscribe === undefined) fields.subscribe = "Say whether to subscribe and save.";
  if (subscribe && cadence !== "monthly" && cadence !== "bimonthly") fields.cadence = "Deliver every month or every two months.";
  const addressId = str(ctx.body, "address_id") ?? "";
  const shipTo = addressId ? await address(userId, addressId) : undefined;
  if (!shipTo) fields.address_id = "Pick a saved address.";
  const { card, errors } = parseCard(ctx.body.card, "card.");
  Object.assign(fields, errors);
  if (Object.keys(fields).length > 0 || !card || !shipTo) throw validation(fields);
  if (!approves(card.behaviour, true)) throw cardDeclined();

  const plan = subscribe ? planForCrate(cans, cadence === "bimonthly" ? "bimonthly" : "monthly") : undefined;
  const quote = buildQuote(
    await loadPricing(),
    shipTo.province,
    Boolean(subscribe),
    [...cans].map(([flavour, quantity]) => ({ flavour, quantity })),
  );
  const accountId = await ensureAccount(userId, email, name);
  const paymentMethodId = await paymentMethodFor(accountId);
  const number = await tx((client) =>
    insertOrder(client, {
      userId,
      email,
      customerName: name,
      kind: "checkout",
      subscriptionId: null,
      quote,
      shipTo: { name: shipTo.name, line1: shipTo.line1, line2: shipTo.line2, city: shipTo.city, province: shipTo.province, postal_code: shipTo.postal_code },
      renewalInvoiceId: null,
    }),
  );
  const [pending] = await loadOrders([number]);
  await storeDocuments(pending);

  const payKey = paymentKey(config.database, number);
  let paymentId: string;
  let subscriptionId: string | null = null;
  let firstInvoiceId = "";
  if (plan) {
    subscriptionId = await createSubscription(accountId, plan.name);
    const first = await firstInvoice(accountId, subscriptionId);
    firstInvoiceId = first.invoiceId;
    await completeBoxInvoice(accountId, first.invoiceId, boxCharges(quote));
    paymentId = await payInvoice(accountId, first.invoiceId, paymentMethodId, quote.totalCents, payKey);
  } else {
    paymentId = await purchase(accountId, paymentMethodId, quote.totalCents, payKey);
  }

  const paid = await tx(async (client) => {
    await lockCrate(client, crate);
    await rows(client, "DELETE FROM crate_slots WHERE crate_id = $1", [crate]);
    await rows(client, "UPDATE crates SET hold_status = 'none', hold_expires_at = NULL, subscribe = false WHERE id = $1", [crate]);
    await rows(
      client,
      `UPDATE orders SET status = 'paid', paid_at = now(), kb_payment_id = $2, subscription_id = $3, documents_stored = true
       WHERE number = $1`,
      [number, paymentId, subscriptionId],
    );
    if (subscriptionId) {
      await rows(
        client,
        `INSERT INTO subscriptions (id, user_id, email, customer_name, account_id, province, ship_to, card_brand, card_last4,
           card_exp_month, card_exp_year, card_behaviour, payment_method_id, first_invoice_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          subscriptionId,
          userId,
          email,
          name,
          accountId,
          shipTo.province,
          JSON.stringify(pending.order.ship_to),
          card.brand,
          card.last4,
          card.expiryMonth,
          card.expiryYear,
          card.behaviour,
          paymentMethodId,
          firstInvoiceId,
        ],
      );
      await rows(client, "INSERT INTO renewals (invoice_id, subscription_id, status) VALUES ($1, $2, 'paid')", [firstInvoiceId, subscriptionId]);
    }
    const [full] = await loadOrders([number], client);
    await sellOrder(client, full);
    await orderConfirmed(client, full);
    return full;
  });
  return { status: 201, body: subscriptionId ? { order: orderJson(paid), subscription_id: subscriptionId } : { order: orderJson(paid) } };
}

// ---- orders -------------------------------------------------------------------------------

/** A checkout that never got paid is not an order the customer has. */
const visible = (full: FullOrder): boolean => !(full.order.kind === "checkout" && full.order.status === "pending_payment");

export async function listOrders(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  allow(user, CUSTOMER);
  const numbers = await query<{ number: string }>("SELECT number FROM orders WHERE user_id = $1 ORDER BY placed_at DESC, number DESC", [
    user.id,
  ]);
  const orders = (await loadOrders(numbers.map((n) => n.number))).filter(visible);
  return { status: 200, body: { orders: orders.map(orderJson) } };
}

async function ownOrder(ctx: Ctx, number: string): Promise<FullOrder> {
  const user = await signedIn(ctx);
  const [full] = await loadOrders([number]);
  if (!full || full.order.user_id !== user.id || !visible(full)) throw notFound();
  allow(user, CUSTOMER);
  return full;
}

export async function getOrder(ctx: Ctx): Promise<Reply> {
  return { status: 200, body: { order: orderJson(await ownOrder(ctx, ctx.params[0])) } };
}

export async function invoicePdf(ctx: Ctx): Promise<Reply> {
  const user = await signedIn(ctx);
  const [full] = await loadOrders([ctx.params[0]]);
  const staff = FULFILMENT_TEAM.includes(user.role);
  if (!full || full.order.status === "pending_payment" || (!staff && full.order.user_id !== user.id)) throw notFound();
  const file = await getObject(invoiceKey(full.order.number));
  return { status: 200, file: { data: file.body, type: "application/pdf", name: `invoice-${full.order.number}.pdf` } };
}
