import { randomUUID } from "node:crypto";
import { type Ctx, readJson, sendJson, setSessionCookie } from "../http.js";
import { errors } from "../errors.js";
import { query, withTransaction } from "../db.js";
import { withIdempotency } from "../domain/idempotency.js";
import { visibleOrder } from "../domain/access.js";
import {
  accountById,
  attachSessionUser,
  createClientAccount,
  createSession,
  createUser,
  emailTaken,
  ownerOfAccount,
  serializeUser,
  sessionExists,
  setAccountCard,
  setAccountCurrency,
  userById,
} from "../domain/accounts.js";
import {
  nextOrderNumber,
  orderByIdForUpdate,
  orderById,
  orderView,
  ordersOfAccount,
  toOrderRow,
} from "../domain/orders.js";
import { quoteAt, quoteFromPrice } from "../domain/quotes.js";
import { priceInEffect } from "../domain/prices.js";
import { checkCard } from "../domain/cards.js";
import { payOrder } from "../domain/billing.js";
import { carePlanContext, planView } from "../domain/plan.js";
import { COPY, accountCurrencyRefusal } from "../../shared/copy.js";
import { isCurrency, toAmountString } from "../../shared/money.js";
import { isCarePlan, isPlanId, type PlanId } from "../../shared/plans.js";

async function ensureSession(ctx: Ctx): Promise<string> {
  if (ctx.sessionId && (await sessionExists(ctx.sessionId))) return ctx.sessionId;
  const sessionId = await createSession(ctx.user?.id ?? null);
  setSessionCookie(ctx.res, sessionId);
  ctx.sessionId = sessionId;
  return sessionId;
}

export async function createOrder(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  if (ctx.user && ctx.user.role !== "client_owner") throw errors.forbidden();
  const fields: Record<string, string> = {};
  if (!isPlanId(body.plan)) fields.plan = "Choose one of the published plans.";
  if (!isCurrency(body.currency)) fields.currency = "Choose USD or ARS.";
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  const plan = body.plan as PlanId;
  const currency = body.currency as "USD" | "ARS";
  const quote = await quoteAt(plan, currency, new Date());
  const sessionId = await ensureSession(ctx);
  const id = randomUUID();
  const number = await nextOrderNumber();
  await query(
    `insert into orders (id, number, session_id, plan, currency, state, total_minor, deposit_minor, balance_minor)
     values ($1, $2, $3, $4, $5, 'quoted', $6, $7, $8)`,
    [
      id,
      number,
      sessionId,
      plan,
      currency,
      quote.total.minor.toString(),
      quote.dueNow.minor.toString(),
      quote.dueAtLaunch.minor.toString(),
    ],
  );
  const order = await orderById(id);
  if (!order) throw errors.notFound();
  sendJson(ctx.res, 201, await orderView(order));
}

export async function listOrders(ctx: Ctx): Promise<void> {
  const user = ctx.user;
  if (!user) throw errors.unauthenticated();
  if (user.role !== "client_owner") throw errors.forbidden();
  const orders = await ordersOfAccount(user.accountId ?? "");
  const views = [];
  for (const order of orders) views.push(await orderView(order));
  sendJson(ctx.res, 200, { orders: views });
}

export async function getOrder(ctx: Ctx): Promise<void> {
  const order = await visibleOrder(ctx.user, ctx.sessionId, ctx.params.id ?? "");
  sendJson(ctx.res, 200, await orderView(order));
}

interface AcceptFields {
  businessName: string;
  name: string;
  email: string;
  password: string;
}

function readAcceptFields(body: Record<string, unknown>): { fields: Record<string, string>; values: AcceptFields } {
  const values: AcceptFields = {
    businessName: typeof body.businessName === "string" ? body.businessName.trim() : "",
    name: typeof body.name === "string" ? body.name.trim() : "",
    email: typeof body.email === "string" ? body.email.trim() : "",
    password: typeof body.password === "string" ? body.password : "",
  };
  const fields: Record<string, string> = {};
  if (values.businessName.length < 1 || values.businessName.length > 120) {
    fields.businessName = "Enter your business name.";
  }
  if (values.name.length < 1 || values.name.length > 80) fields.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) fields.email = "Enter a valid email address.";
  if (values.password.length < 10) fields.password = "Use at least 10 characters.";
  return { fields, values };
}

async function accountHasLivePlan(accountId: string): Promise<boolean> {
  const context = await carePlanContext(accountId);
  if (!context) return false;
  const plan = await planView(context);
  return plan.status !== "cancelled";
}

export async function acceptOrder(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const existing = await visibleOrder(ctx.user, ctx.sessionId, ctx.params.id ?? "");
  if (ctx.user && ctx.user.role !== "client_owner") throw errors.forbidden();

  const result = await withTransaction(async (client) => {
    await client.query("set local lock_timeout = '15s'");
    const locked = await orderByIdForUpdate(client, existing.id);
    if (!locked) throw errors.notFound();
    if (locked.state !== "quoted") throw errors.invalidTransition(locked.state);

    let accountId = ctx.user?.accountId ?? null;
    if (accountId && isCarePlan(locked.plan) && (await accountHasLivePlan(accountId))) {
      throw errors.planExists();
    }
    if (accountId) {
      const account = await accountById(accountId);
      if (account?.currency && account.currency !== locked.currency) {
        throw errors.validation({ currency: accountCurrencyRefusal(account.currency) });
      }
    }

    const priceRow = await priceInEffect(locked.plan, locked.currency, new Date());
    if (!priceRow) throw errors.billingUnavailable();
    const fresh = quoteFromPrice(locked.plan, priceRow);
    if (fresh.total.minor !== locked.total.minor) {
      const updated = await client.query(
        `update orders set total_minor = $2, deposit_minor = $3, balance_minor = $4
          where id = $1 returning id, number, session_id, account_id, plan, currency, state, total_minor,
            deposit_minor, balance_minor, price_row_id, price_effective_at, accepted_at, deposit_invoice_id,
            balance_invoice_id, care_subscription_id, care_bundle_id, care_tier, created_at`,
        [
          locked.id,
          fresh.total.minor.toString(),
          fresh.dueNow.minor.toString(),
          fresh.dueAtLaunch.minor.toString(),
        ],
      );
      const row = updated.rows[0];
      const requoted = row ? toOrderRow(row) : locked;
      return { kind: "stale" as const, staleOrder: requoted };
    }

    if (body.acceptTerms !== true) {
      throw errors.validation({ acceptTerms: "Tick the box to accept the scope and price." });
    }

    let user = ctx.user;
    if (!user) {
      const { fields, values } = readAcceptFields(body);
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      if (await emailTaken(values.email)) {
        throw errors.validation({ email: "That email already has a Pampero Ledger sign-in." });
      }
      accountId = await createClientAccount(client, {
        businessName: values.businessName,
        currency: locked.currency,
      });
      user = await createUser(client, {
        accountId,
        name: values.name,
        email: values.email,
        password: values.password,
        role: "client_owner",
      });
      const sessionId = ctx.sessionId ?? (await createSession(user.id));
      await client.query(`update sessions set user_id = $2 where id = $1`, [sessionId, user.id]);
      setSessionCookie(ctx.res, sessionId);
      ctx.sessionId = sessionId;
      ctx.user = user;
    } else if (accountId) {
      await client.query(`update client_accounts set currency = $2 where id = $1 and currency is null`, [
        accountId,
        locked.currency,
      ]);
    }

    await client.query(
      `update orders set state = 'accepted', account_id = $2, accepted_at = now(), price_row_id = $3,
         price_effective_at = $4, care_tier = $5 where id = $1`,
      [
        locked.id,
        accountId,
        priceRow.id,
        priceRow.effectiveAt.toISOString(),
        isCarePlan(locked.plan) ? (locked.plan === "care-lite" ? "lite" : "plus") : null,
      ],
    );
    return { kind: "accepted" as const, acceptedId: locked.id, userId: user.id };
  });

  if (result.kind === "stale") {
    const view = await orderView(result.staleOrder);
    sendJson(ctx.res, 409, {
      error: "quote_stale",
      message: COPY.quoteStale,
      order: view,
    });
    return;
  }
  const order = await orderById(result.acceptedId);
  const user = await userById(result.userId);
  if (!order || !user) throw errors.notFound();
  sendJson(ctx.res, 200, { order: await orderView(order), user: serializeUser(user) });
}

function isLockTimeout(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "55P03";
}

export async function payOrderRoute(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const user = ctx.user;
  if (!user) throw errors.unauthenticated();
  const order = await visibleOrder(user, ctx.sessionId, ctx.params.id ?? "");
  if (user.role !== "client_owner") throw errors.forbidden();

  const outcome = await withIdempotency(ctx, body, async () => {
    const card = checkCard((body.card ?? {}) as Record<string, unknown>, new Date());
    if (Object.keys(card.fields).length > 0) throw errors.validation(card.fields);
    if (!card.card) throw errors.validation({ "Card number": "Enter the card number." });
    if (!card.card.approves) throw errors.cardDeclined();
    const account = await accountById(order.accountId ?? "");
    const owner = order.accountId ? await ownerOfAccount(order.accountId) : null;
    if (!account || !owner) throw errors.notFound();
    if (!account.currency) await setAccountCurrency(account.id, order.currency);
    await setAccountCard(account.id, card.card.last4);

    let paid;
    try {
      paid = await payOrder({ order, account, ownerEmail: owner.email, card: card.card });
    } catch (error) {
      if (isLockTimeout(error)) {
        const current = await orderById(order.id);
        throw errors.invalidTransition(current?.state ?? order.state);
      }
      throw error;
    }
    const after = await orderById(order.id);
    if (!after) throw errors.notFound();
    return {
      status: 201,
      body: {
        order: await orderView(after),
        payment: {
          kind: paid.kind,
          amount: toAmountString(paid.amount),
          currency: paid.amount.currency,
          killbillPaymentId: paid.killbillPaymentId,
        },
        receiptUrl: `/orders/${order.id}/receipt`,
      },
    };
  });
  sendJson(
    ctx.res,
    outcome.status,
    outcome.body,
    outcome.replayed ? { "Idempotent-Replayed": "true" } : {},
  );
}
