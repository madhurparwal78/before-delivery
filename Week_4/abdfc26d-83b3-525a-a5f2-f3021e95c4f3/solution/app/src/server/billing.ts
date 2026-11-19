import { randomUUID, timingSafeEqual } from "node:crypto";
import { requireRole, signedIn } from "./auth.js";
import { CREDIT_PACK, PLANS, type PlanCode } from "../shared/rules.js";
import { one, pool, rows, tx, UUID, type Db } from "./db.js";
import { conflict, during, invalidTransition, notFound, paymentsUnavailable, unauthenticated, validationFailed } from "./errors.js";
import { json, type Ctx, type Route } from "./http.js";
import { idempotent } from "./idempotency.js";
import * as killbill from "./killbill.js";
import { creatorCredits, lockCredits, move } from "./ledger.js";
import { confirmPaid, failPayment, payingOrders } from "./orders.js";

// Plans, credit packs and payment confirmation. Every money state is recorded only after a read of
// the Kill Bill API shows it, whether a verified callback or the 2-second poll prompted the read.

// Plan states: pending_payment → active (first confirmed subscription invoice) → cancelling (cancel) → ended (on ends_on).
type PlanState = "pending_payment" | "active" | "cancelling" | "ended";

interface PlanRow {
  id: string;
  creator_id: string;
  code: PlanCode;
  state: PlanState;
  ends_on: string | null;
  kb_account_id: string;
  subscription_id: string;
}

const OPEN_PLAN = "state IN ('pending_payment', 'active', 'cancelling')";

/** A cancelling plan has ended once its end date (UTC) is reached. */
async function endDuePlans(db: Db, userId: string): Promise<void> {
  await db.query(
    "UPDATE plans SET state = 'ended' WHERE creator_id = $1 AND state = 'cancelling' AND ends_on <= (now() AT TIME ZONE 'UTC')::date",
    [userId],
  );
}

const planView = (p: PlanRow | undefined) => (p ? { code: p.code, state: p.state, ends_on: p.ends_on } : null);

async function latestPlan(userId: string): Promise<PlanRow | undefined> {
  await endDuePlans(pool, userId);
  return one<PlanRow>(
    pool,
    "SELECT id, creator_id, code, state, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, kb_account_id, subscription_id FROM plans WHERE creator_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
}

async function creator(ctx: Ctx) {
  const user = await signedIn(ctx);
  requireRole(user, "creator");
  return user;
}

async function getCredits(ctx: Ctx) {
  const user = await creator(ctx);
  return json(200, await creatorCredits(pool, user.id));
}

async function getPlan(ctx: Ctx) {
  const user = await creator(ctx);
  return json(200, { plan: planView(await latestPlan(user.id)) });
}

async function choosePlan(ctx: Ctx) {
  const user = await creator(ctx);
  const plan = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`plan:${user.id}`]);
    await endDuePlans(client, user.id);
    if (await one(client, `SELECT 1 FROM plans WHERE creator_id = $1 AND ${OPEN_PLAN}`, [user.id])) {
      throw conflict("plan_exists", "You already have a plan.");
    }
    const code = ctx.body !== null && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>).plan : undefined;
    if (typeof code !== "string" || !Object.hasOwn(PLANS, code)) throw validationFailed({ plan: "Choose studio-monthly or pro-monthly." });
    const { account, subscription } = await during("killbill", paymentsUnavailable, async () => {
      const account = await killbill.ensureAccount(user.id, user.displayName, user.email);
      return { account, subscription: await killbill.createSubscription(account, code) };
    });
    const row: PlanRow = { id: randomUUID(), creator_id: user.id, code: code as PlanCode, state: "pending_payment", ends_on: null, kb_account_id: account, subscription_id: subscription };
    await client.query(
      "INSERT INTO plans (id, creator_id, code, state, kb_account_id, subscription_id) VALUES ($1, $2, $3, 'pending_payment', $4, $5)",
      [row.id, user.id, row.code, account, subscription],
    );
    return row;
  });
  return json(202, { plan: planView(plan) });
}

async function cancelPlan(ctx: Ctx) {
  const user = await creator(ctx);
  const plan = await latestPlan(user.id);
  if (plan?.state === "pending_payment") throw conflict("plan_not_confirmed", "Your plan can be cancelled once Kill Bill confirms it.");
  if (plan?.state !== "active") throw invalidTransition("There is no active plan to cancel.");
  const endsOn = await during("killbill", paymentsUnavailable, () => killbill.cancelEndOfTerm(plan.subscription_id));
  const updated = await one(pool, "UPDATE plans SET state = 'cancelling', ends_on = $2 WHERE id = $1 AND state = 'active' RETURNING id", [plan.id, endsOn]);
  if (!updated) throw invalidTransition("There is no active plan to cancel.");
  return json(200, { plan: planView(await latestPlan(user.id)) });
}

async function buyPack(ctx: Ctx) {
  const user = await creator(ctx);
  return idempotent(ctx, user, async () => {
    const code = ctx.body !== null && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>).pack : undefined;
    if (code !== CREDIT_PACK.code) throw validationFailed({ pack: `Choose ${CREDIT_PACK.code}.` });
    const pack = CREDIT_PACK;
    const invoiceId = await during("killbill", paymentsUnavailable, async () => {
      const account = await killbill.ensureAccount(user.id, user.displayName, user.email);
      return killbill.externalCharge(account, pack.priceCents, pack.description);
    });
    const id = randomUUID();
    await pool.query(
      "INSERT INTO credit_purchases (id, creator_id, state, credits, price_cents, kb_invoice_id) VALUES ($1, $2, 'paying', $3, $4, $5)",
      [id, user.id, pack.credits, pack.priceCents, invoiceId],
    );
    return json(202, { purchase: { id, state: "paying", credits: pack.credits, price_cents: pack.priceCents } });
  });
}

async function getPack(ctx: Ctx) {
  const user = await signedIn(ctx);
  const id = ctx.params.id ?? "";
  const purchase = UUID.test(id)
    ? await one<{ id: string; creator_id: string; state: string; credits: number; price_cents: number }>(pool, "SELECT * FROM credit_purchases WHERE id = $1", [id])
    : undefined;
  if (!purchase || purchase.creator_id !== user.id) throw notFound();
  requireRole(user, "creator");
  return json(200, { purchase: { id: purchase.id, state: purchase.state, credits: purchase.credits, price_cents: purchase.price_cents } });
}

// ---- confirmation ----

async function settlePurchase(id: string, outcome: killbill.PaymentOutcome): Promise<void> {
  if (outcome.kind === "none") return;
  await tx(async (client) => {
    const purchase = await one<{ creator_id: string; credits: number; state: string }>(client, "SELECT creator_id, credits, state FROM credit_purchases WHERE id = $1 FOR UPDATE", [id]);
    if (purchase?.state !== "paying") return;
    if (outcome.kind === "failed") {
      await client.query("UPDATE credit_purchases SET state = 'failed' WHERE id = $1", [id]);
      return;
    }
    await lockCredits(client, purchase.creator_id);
    const entry = await move(client, "pack", purchase.creator_id, purchase.credits);
    await client.query("UPDATE credit_purchases SET state = 'paid', ledger_entry_id = $2 WHERE id = $1", [id, entry]);
  });
}

/** Grants a plan's credits once per paid subscription invoice; the first one makes a pending plan active. */
async function settlePlanInvoice(plan: PlanRow, invoiceId: string): Promise<void> {
  if ((await killbill.invoiceOutcome(invoiceId)).kind !== "paid") return;
  await tx(async (client) => {
    await client.query("SELECT 1 FROM plans WHERE id = $1 FOR UPDATE", [plan.id]);
    if (await one(client, "SELECT 1 FROM plan_grants WHERE subscription_invoice_id = $1", [invoiceId])) return;
    await lockCredits(client, plan.creator_id);
    const entry = await move(client, "grant", plan.creator_id, PLANS[plan.code].credits);
    await client.query("INSERT INTO plan_grants (subscription_invoice_id, plan_id, ledger_entry_id) VALUES ($1, $2, $3)", [invoiceId, plan.id, entry]);
    await client.query("UPDATE plans SET state = 'active' WHERE id = $1 AND state = 'pending_payment'", [plan.id]);
  });
}

async function settleInvoice(invoiceId: string, accountId: string): Promise<void> {
  const order = await one<{ id: string }>(pool, "SELECT id FROM orders WHERE kb_invoice_id = $1", [invoiceId]);
  const purchase = await one<{ id: string }>(pool, "SELECT id FROM credit_purchases WHERE kb_invoice_id = $1", [invoiceId]);
  if (order || purchase) {
    const outcome = await killbill.invoiceOutcome(invoiceId);
    if (order && outcome.kind === "paid") await confirmPaid(order.id, outcome.paymentId);
    if (order && outcome.kind === "failed") await failPayment(order.id);
    if (purchase) await settlePurchase(purchase.id, outcome);
    return;
  }
  const subscriptions = await killbill.invoiceSubscriptionIds(invoiceId);
  const plans = await rows<PlanRow>(pool, "SELECT * FROM plans WHERE kb_account_id = $1 AND subscription_id = ANY($2)", [accountId, subscriptions]);
  for (const plan of plans) await settlePlanInvoice(plan, invoiceId);
}

const TOKEN = Buffer.from(killbill.CALLBACK_TOKEN);

/** Kill Bill's push: 204 for any request with the tenant token, applied, duplicate or ignored alike. */
async function killbillEvent(ctx: Ctx) {
  const token = Buffer.from(ctx.query.get("token") ?? "");
  if (token.length !== TOKEN.length || !timingSafeEqual(token, TOKEN)) throw unauthenticated();
  const event = ctx.body !== null && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
  const type = typeof event.eventType === "string" ? event.eventType : "";
  const invoiceId = typeof event.objectId === "string" ? event.objectId : "";
  const accountId = typeof event.accountId === "string" ? event.accountId : "";
  if ((type !== "INVOICE_PAYMENT_SUCCESS" && type !== "INVOICE_PAYMENT_FAILED") || !invoiceId) return { status: 204 };
  let paymentId = "";
  try {
    const meta: unknown = typeof event.metaData === "string" && event.metaData ? JSON.parse(event.metaData) : event.metaData;
    if (meta !== null && typeof meta === "object" && typeof (meta as Record<string, unknown>).paymentId === "string") paymentId = (meta as Record<string, string>).paymentId ?? "";
  } catch {
    paymentId = "";
  }
  const identity = `${type}|${invoiceId}|${paymentId}`;
  const fresh = await one(pool, "INSERT INTO processed_events (identity) VALUES ($1) ON CONFLICT DO NOTHING RETURNING identity", [identity]);
  if (!fresh) return { status: 204 };
  try {
    await settleInvoice(invoiceId, accountId);
  } catch (error) {
    await pool.query("DELETE FROM processed_events WHERE identity = $1", [identity]);
    console.error("Kill Bill event not applied yet:", error instanceof Error ? error.message : error);
  }
  return { status: 204 };
}

/** The 2-second poll for orders, purchases and plans still waiting on Kill Bill. */
export async function pollKillBill(): Promise<void> {
  for (const order of await payingOrders()) {
    const outcome = await killbill.invoiceOutcome(order.kb_invoice_id);
    if (outcome.kind === "paid") await confirmPaid(order.id, outcome.paymentId);
    else if (outcome.kind === "failed") await failPayment(order.id);
  }
  const purchases = await rows<{ id: string; kb_invoice_id: string }>(pool, "SELECT id, kb_invoice_id FROM credit_purchases WHERE state = 'paying'");
  for (const purchase of purchases) await settlePurchase(purchase.id, await killbill.invoiceOutcome(purchase.kb_invoice_id));
  const plans = await rows<PlanRow>(pool, "SELECT * FROM plans WHERE state = 'pending_payment'");
  for (const plan of plans) {
    for (const invoiceId of await killbill.subscriptionInvoices(plan.kb_account_id, plan.subscription_id)) await settlePlanInvoice(plan, invoiceId);
  }
}

export const billingRoutes: Route[] = [
  { method: "GET", pattern: "/api/me/credits", handler: getCredits },
  { method: "GET", pattern: "/api/me/plan", handler: getPlan },
  { method: "POST", pattern: "/api/me/plan", handler: choosePlan },
  { method: "POST", pattern: "/api/me/plan/cancel", handler: cancelPlan },
  { method: "POST", pattern: "/api/me/credit-packs", handler: buyPack },
  { method: "GET", pattern: "/api/me/credit-packs/{id}", handler: getPack },
  { method: "POST", pattern: "/api/billing/killbill-events", handler: killbillEvent },
];
