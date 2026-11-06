// Route definitions: every /api endpoint and its published precedence.
import type { Pool } from "pg";
import type { Env } from "../core/env.js";
import {
  ApiError, type Ctx, errorBody, checkShape, type FieldSpecEntry,
  loadCustomerSession, loadStaffSession, createSession, destroySession,
  SESSION_COOKIE_CUSTOMER, SESSION_COOKIE_STAFF, cookieHeader, idempotencyKey,
  beginIdempotency, finishIdempotency
} from "../core/http.js";
import { message, fieldMessage } from "../core/copy.js";
import { money } from "../core/money.js";
import { findProvince } from "../core/provinces.js";
import { dateToString } from "../core/toronto.js";
import { KillBillClient } from "../services/killbill.js";
import { Outbox } from "../services/outbox.js";
import { batchStock } from "../domain/stock.js";
import { getBatch, isPublicState, logLoaf, cutBatch, scheduleBatch, openBatch, withdrawBatch } from "../domain/batches.js";
import type { BatchRow } from "../domain/stock.js";
import { createHold, releaseHold, holdView, type HoldRecord } from "../domain/holds.js";
import { requestCode, verifyCode } from "../domain/stepup.js";
import { checkout } from "../domain/checkout.js";
import {
  startSubscription, changeSubscription, patchSubscription, loadSubscription
} from "../domain/subscriptions.js";
import { issueRefund } from "../domain/refunds.js";
import { addCredit } from "../domain/credits.js";
import { packingList, packingView, shipOrder } from "../domain/packing.js";
import { submitContact } from "../domain/contact.js";
import { reconciliation, acceptLine, refundOrphan, lineView } from "../domain/reconciliation.js";
import { auditView, refundView, orderView, subscriptionView, batchView } from "../domain/views.js";
import { verifyPassword } from "../db/schema.js";
import { orderFromRow, loadOrderForStaff, refundFromRow } from "../domain/refunds.js";
import { toRecord } from "../domain/subscriptions.js";

export interface Services {
  env: Env;
  pool: Pool;
  kb: KillBillClient;
  outbox: Outbox;
  billingUp: boolean;
}

export interface RouteResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Handler = (ctx: Ctx, services: Services, params: Record<string, string>) => Promise<RouteResult>;

export interface RouteSpec {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

function route(method: string, pathTemplate: string, handler: Handler): RouteSpec {
  const paramNames: string[] = [];
  const patternSource = pathTemplate.replace(/\{(\w+)\}/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { method, pattern: new RegExp(`^${patternSource}$`), paramNames, handler };
}

async function json(status: number, body: unknown, headers?: Record<string, string>): Promise<RouteResult> {
  return { status, body, headers };
}

function stringValue(shape: { values: Record<string, unknown> }, path: string): string | undefined {
  const value = shape.values[path];
  return typeof value === "string" ? value : undefined;
}

/** Map shape errors to the published field messages: extra keys report the
 * "can't be set" message at their own path; declared keys report their own. */
function fieldsFromShape(
  shape: { errors: Record<string, string> },
  declared: Record<string, string>
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [path, kind] of Object.entries(shape.errors)) {
    if (kind === "cant_set") {
      fields[path] = fieldMessage("cant_set", "en-CA");
    } else if (declared[path]) {
      fields[path] = fieldMessage(declared[path], "en-CA");
    } else {
      fields[path] = fieldMessage("cant_set", "en-CA");
    }
  }
  return fields;
}

// ---------- shared payloads ----------

async function cartPayload(ctx: Ctx, services: Services, cartIdOverride: string | null, provinceInput: string | null): Promise<unknown> {
  const cartId = cartIdOverride ?? ctx.cookies["pdl_cart"];
  const province = provinceInput ?? "QC";
  const provinceInfo = findProvince(province);
  if (!provinceInfo) {
    throw new ApiError(422, "invalid", null, { province: fieldMessage("province", ctx.locale) });
  }
  const client = await services.pool.connect();
  try {
    const now = new Date();
    const holds = cartId
      ? ((await client.query(
          `SELECT * FROM holds WHERE cart_id = $1 AND status = 'active' AND expires_at > $2 ORDER BY created_at`,
          [cartId, now]
        )).rows as HoldRecord[])
      : [];
    const batches: { code: string; available: number; held: number; sold: number }[] = [];
    const priceBreakdown = holds.length === 0
      ? { subtotal: money(0), shipping: money(0), taxes: [], total: money(0) }
      : (await import("../core/money.js")).dropPrice(holds.length, provinceInfo.taxes);
    for (const hold of holds) {
      if (batches.some((batch) => batch.code === hold.batch_code)) continue;
      const stock = await batchStock(client, hold.batch_code, now);
      batches.push({
        code: hold.batch_code,
        available: stock.counts.available,
        held: stock.counts.held,
        sold: stock.counts.sold
      });
    }
    return {
      server_now: now.toISOString(),
      holds: holds.map(holdView),
      batches,
      province,
      subtotal: priceBreakdown.subtotal,
      shipping_fee: priceBreakdown.shipping,
      taxes: priceBreakdown.taxes.map((tax) => ({ code: tax.code, rate: tax.rateLabel, amount: tax.amount })),
      total: priceBreakdown.total
    };
  } finally {
    client.release();
  }
}

async function loadPublicBatch(client: PoolClientLike, code: string): Promise<{ batch: BatchRow; stock: Awaited<ReturnType<typeof batchStock>> } | null> {
  const batch = await getBatch(client, code);
  if (!batch || !isPublicState(batch.state)) return null;
  const stock = await batchStock(client, code, new Date());
  return { batch, stock };
}

type PoolClientLike = Parameters<typeof getBatch>[0];

// ---------- the routes ----------

export function buildRoutes(): RouteSpec[] {
  const routes: RouteSpec[] = [];

  routes.push(route("GET", "/health", async () => json(200, { status: "ok" })));

  routes.push(route("GET", "/status", async (_ctx, services) => json(200, {
    billing: services.billingUp ? "up" : "down",
    mail: services.outbox.mailUp ? "up" : "down",
    checked_at: new Date().toISOString()
  })));

  routes.push(route("GET", "/drop", async (_ctx, services) => {
    const client = await services.pool.connect();
    try {
      const now = new Date();
      const res = await client.query(
        `SELECT * FROM batches WHERE state IN ('scheduled', 'live', 'sold_out') ORDER BY drop_at NULLS LAST, code`
      );
      const batches = [];
      for (const row of res.rows as BatchRow[]) {
        const stock = await batchStock(client, row.code, now);
        batches.push(batchView(row, stock));
      }
      return json(200, { server_now: now.toISOString(), batches });
    } finally {
      client.release();
    }
  }));

  routes.push(route("GET", "/batches/{code}", async (_ctx, services, params) => {
    const client = await services.pool.connect();
    try {
      const found = await loadPublicBatch(client, params.code);
      if (!found) throw new ApiError(404, "not_found");
      return json(200, batchView(found.batch, found.stock));
    } finally {
      client.release();
    }
  }));

  routes.push(route("POST", "/holds", async (ctx, services) => {
    const spec: Record<string, FieldSpecEntry> = { batch: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, fieldsFromShape(shape, { batch: "batch" }));
    }
    const batchCode = stringValue(shape, "batch") ?? "";
    const result = await createHold(services.pool, services.env, ctx.cookies["pdl_cart"], batchCode);
    ctx.setCookies.push(cookieHeader("pdl_cart", result.cartId));
    return json(201, { hold: holdView(result.hold), cart: await cartPayload(ctx, services, result.cartId, null) });
  }));

  routes.push(route("DELETE", "/holds/{id}", async (ctx, services, params) => {
    const client = await services.pool.connect();
    try {
      const released = await releaseHold(client, ctx.cookies["pdl_cart"], params.id);
      return json(200, { hold: holdView(released) });
    } finally {
      client.release();
    }
  }));

  routes.push(route("GET", "/cart", async (ctx, services) => {
    const province = ctx.url.searchParams.get("province");
    return json(200, await cartPayload(ctx, services, null, province));
  }));

  routes.push(route("POST", "/auth/code", async (ctx, services) => {
    const spec: Record<string, FieldSpecEntry> = {
      email: { type: "string", required: true },
      purpose: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, fieldsFromShape(shape, { email: "email", purpose: "purpose" }));
    }
    await requestCode(
      services.pool, services.env, services.outbox, ctx.locale,
      stringValue(shape, "email") ?? "",
      stringValue(shape, "purpose") ?? ""
    );
    return json(202, { status: "sent" });
  }));

  routes.push(route("POST", "/auth/verify", async (ctx, services) => {
    const spec: Record<string, FieldSpecEntry> = {
      email: { type: "string", required: true },
      code: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, fieldsFromShape(shape, { email: "email", code: "code" }));
    }
    const result = await verifyCode(
      services.pool, services.env, ctx.locale,
      stringValue(shape, "email") ?? "",
      stringValue(shape, "code") ?? ""
    );
    const token = await createSession(ctx, "customer", result.customerId, null);
    ctx.setCookies.push(cookieHeader(SESSION_COOKIE_CUSTOMER, token, { maxAge: 43200 }));
    const email = (stringValue(shape, "email") ?? "").trim().toLowerCase();
    const localeRow = await services.pool.query("SELECT locale FROM customers WHERE id = $1", [result.customerId]);
    return json(200, { customer: { email, locale: localeRow.rows[0].locale } });
  }));

  routes.push(route("POST", "/auth/sign-out", async (ctx) => {
    await destroySession(ctx, SESSION_COOKIE_CUSTOMER, "customer");
    ctx.setCookies.push(cookieHeader(SESSION_COOKIE_CUSTOMER, "", { maxAge: 0 }));
    return { status: 204 };
  }));

  routes.push(route("POST", "/checkout", async (ctx, services) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const spec: Record<string, FieldSpecEntry> = {
      holds: { type: "array", required: true },
      shipping: {
        type: "object", required: true,
        fields: {
          name: { type: "string", required: true },
          line1: { type: "string", required: true },
          city: { type: "string", required: true },
          province: { type: "string", required: true },
          postal_code: { type: "string", required: true }
        }
      }
    };
    const shape = checkShape(ctx.body, spec);
    const holdIds = (shape.values["holds"] as string[] | undefined) ?? [];
    const shipping = {
      name: shape.values["shipping.name"] as string | undefined,
      line1: shape.values["shipping.line1"] as string | undefined,
      city: shape.values["shipping.city"] as string | undefined,
      province: shape.values["shipping.province"] as string | undefined,
      postal_code: shape.values["shipping.postal_code"] as string | undefined
    };
    const key = idempotencyKey(ctx);
    const scope = `checkout:${session.customer_id}`;
    const replay = await beginIdempotency(ctx, scope, key, ctx.body);
    if (replay) {
      const stored = JSON.parse(replay) as { status: number; body: string };
      return {
        status: stored.status,
        body: JSON.parse(stored.body),
        headers: { "Idempotent-Replayed": "true" }
      };
    }
    if (Object.keys(shape.errors).length > 0) {
      const fields = fieldsFromShape(shape, {
        holds: "holds",
        "shipping.name": "name",
        "shipping.line1": "line1",
        "shipping.city": "city",
        "shipping.province": "province",
        "shipping.postal_code": "postal_code"
      });
      const apiError = new ApiError(422, "invalid", null, fields);
      const { body } = errorBody(apiError, ctx.locale);
      await finishIdempotency(ctx, scope, key, 422, body);
      throw apiError;
    }
    let result: RouteResult;
    try {
      result = await checkoutRoute(ctx, services, session.customer_id, holdIds, shipping);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if ((status >= 200 && status < 300) || status === 409 || status === 410 || status === 412 || status === 422) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
        const { body } = errorBody(apiError, ctx.locale);
        await finishIdempotency(ctx, scope, key, status, body);
      }
      throw err;
    }
    const bodyText = JSON.stringify(result.body);
    await finishIdempotency(ctx, scope, key, result.status, bodyText);
    return result;
  }));

  routes.push(route("POST", "/contact", async (ctx, services) => {
    const spec: Record<string, FieldSpecEntry> = {
      name: { type: "string", required: true },
      email: { type: "string", required: true },
      topic: { type: "string", required: true },
      message: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, fieldsFromShape(shape, { name: "name", email: "email", topic: "topic", message: "message" }));
    }
    const result = await submitContact(services.pool, services.outbox, ctx.locale, {
      name: stringValue(shape, "name") ?? "",
      email: stringValue(shape, "email") ?? "",
      topic: stringValue(shape, "topic") ?? "",
      message: shape.values["message"] as string
    });
    return json(201, result);
  }));

  routes.push(route("GET", "/account", async (ctx, services) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const client = await services.pool.connect();
    try {
      const customer = await client.query("SELECT email, locale FROM customers WHERE id = $1", [session.customer_id]);
      const orders = await client.query(
        `SELECT number, placed_at, total_cents, status FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC`,
        [session.customer_id]
      );
      const subscriptions = await client.query(
        `SELECT number, state, scent, cadence, next_bill_date FROM subscriptions WHERE customer_id = $1 ORDER BY id DESC`,
        [session.customer_id]
      );
      return json(200, {
        customer: { email: customer.rows[0].email, locale: customer.rows[0].locale },
        orders: orders.rows.map((row) => ({
          number: row.number,
          placed_at: (row.placed_at as Date).toISOString(),
          total: money(row.total_cents),
          status: row.status
        })),
        subscriptions: subscriptions.rows.map((row) => ({
          number: row.number,
          state: row.state,
          scent: row.scent,
          cadence: row.cadence,
          next_bill_date: row.next_bill_date ? dateToString(row.next_bill_date as string | Date) : null
        }))
      });
    } finally {
      client.release();
    }
  }));

  routes.push(route("GET", "/account/orders/{number}", async (ctx, services, params) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const client = await services.pool.connect();
    try {
      const res = await client.query(
        "SELECT * FROM orders WHERE number = $1 AND customer_id = $2",
        [params.number, session.customer_id]
      );
      if (!res.rows[0]) throw new ApiError(404, "not_found");
      const lines = await client.query(
        "SELECT batch_code, scent, bar, unit_cents, refunded, kb_invoice_item_id FROM order_lines WHERE order_id = $1 ORDER BY batch_code, bar",
        [res.rows[0].id]
      );
      return json(200, orderView(orderFromRow(res.rows[0], lines.rows)));
    } finally {
      client.release();
    }
  }));

  routes.push(route("POST", "/subscriptions", async (ctx, services) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const spec: Record<string, FieldSpecEntry> = {
      scent: { type: "string", required: true },
      cadence: { type: "string", required: true },
      shipping: {
        type: "object", required: true,
        fields: {
          name: { type: "string", required: true },
          line1: { type: "string", required: true },
          city: { type: "string", required: true },
          province: { type: "string", required: true },
          postal_code: { type: "string", required: true }
        }
      }
    };
    const shape = checkShape(ctx.body, spec);
    const key = idempotencyKey(ctx);
    const scope = `subscriptions:${session.customer_id}`;
    const replay = await beginIdempotency(ctx, scope, key, ctx.body);
    if (replay) {
      const stored = JSON.parse(replay) as { status: number; body: string };
      return { status: stored.status, body: JSON.parse(stored.body), headers: { "Idempotent-Replayed": "true" } };
    }
    let result: RouteResult;
    try {
      const customer = await services.pool.query("SELECT email FROM customers WHERE id = $1", [session.customer_id]);
      const started = await startSubscription(
        services.pool, services.kb, services.outbox, ctx.locale,
        session.customer_id, customer.rows[0].email as string,
        {
          scent: stringValue(shape, "scent") ?? "",
          cadence: stringValue(shape, "cadence") ?? "",
          shipping: {
            name: shape.values["shipping.name"] as string,
            line1: shape.values["shipping.line1"] as string,
            city: shape.values["shipping.city"] as string,
            province: shape.values["shipping.province"] as string,
            postal_code: shape.values["shipping.postal_code"] as string
          }
        }
      );
      result = await json(201, {
        subscription: subscriptionView(started.subscription, services.env.subscriptionLockHours),
        charged_today: money(started.chargedToday),
        credit_applied: money(started.creditApplied)
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if ((status >= 200 && status < 300) || status === 409 || status === 410 || status === 412 || status === 422) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
        const { body } = errorBody(apiError, ctx.locale);
        await finishIdempotency(ctx, scope, key, status, body);
      }
      throw err;
    }
    const bodyText = JSON.stringify(result.body);
    await finishIdempotency(ctx, scope, key, result.status, bodyText);
    return result;
  }));

  routes.push(route("GET", "/account/subscriptions/{number}", async (ctx, services, params) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const client = await services.pool.connect();
    try {
      const record = await loadSubscription(client, session.customer_id, params.number);
      return json(200, subscriptionView(record, services.env.subscriptionLockHours));
    } finally {
      client.release();
    }
  }));

  const subscriptionActions: { path: string; kind: "skip" | "unskip" | "pause" | "resume" | "cancel" }[] = [
    { path: "/skip", kind: "skip" },
    { path: "/unskip", kind: "unskip" },
    { path: "/pause", kind: "pause" },
    { path: "/resume", kind: "resume" },
    { path: "/cancel", kind: "cancel" }
  ];
  for (const action of subscriptionActions) {
    routes.push(route("POST", `/account/subscriptions/{number}${action.path}`, async (ctx, services, params) => {
      const session = await loadCustomerSession(ctx);
      if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
      const spec: Record<string, FieldSpecEntry> = {};
      const shape = checkShape(ctx.body, spec);
      void shape;
      const record = await changeSubscription(
        services.pool, services.env, services.kb, ctx.locale,
        session.customer_id, params.number, { kind: action.kind }
      );
      return json(200, { subscription: subscriptionView(record, services.env.subscriptionLockHours) });
    }));
  }

  routes.push(route("PATCH", "/account/subscriptions/{number}", async (ctx, services, params) => {
    const session = await loadCustomerSession(ctx);
    if (!session?.customer_id) throw new ApiError(401, "unauthenticated");
    const spec: Record<string, FieldSpecEntry> = {
      scent: { type: "string" },
      cadence: { type: "string" }
    };
    const shape = checkShape(ctx.body, spec);
    const patch: { scent?: string; cadence?: string } = {};
    if (shape.values["scent"] !== undefined) patch.scent = shape.values["scent"] as string;
    if (shape.values["cadence"] !== undefined) patch.cadence = shape.values["cadence"] as string;
    const record = await patchSubscription(
      services.pool, services.env, services.kb, ctx.locale,
      session.customer_id, params.number, patch
    );
    return json(200, { subscription: subscriptionView(record, services.env.subscriptionLockHours) });
  }));


  // ---------- staff routes ----------

  const staffOnly = async (ctx: Ctx, services: Services, roles: string[]): Promise<{ row: { id: number; email: string; name: string; role: string } }> => {
    const session = await loadStaffSession(ctx);
    if (!session?.staff_id) throw new ApiError(401, "unauthenticated");
    const res = await services.pool.query("SELECT id, email, name, role FROM staff WHERE id = $1", [session.staff_id]);
    const row = res.rows[0];
    if (!row) throw new ApiError(401, "unauthenticated");
    if (!roles.includes(row.role)) throw new ApiError(403, "forbidden", message("forbidden", ctx.locale));
    return { row };
  };

  routes.push(route("POST", "/staff/sign-in", async (ctx, services) => {
    const spec: Record<string, FieldSpecEntry> = {
      email: { type: "string", required: true },
      password: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, {
        email: fieldMessage("email", ctx.locale),
        password: fieldMessage("cant_set", ctx.locale)
      });
    }
    const email = (stringValue(shape, "email") ?? "").toLowerCase();
    const password = stringValue(shape, "password") ?? "";
    const res = await services.pool.query("SELECT * FROM staff WHERE email = $1", [email]);
    const row = res.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new ApiError(401, "invalid_credentials", message("invalid_credentials", ctx.locale));
    }
    const token = await createSession(ctx, "staff", null, row.id);
    ctx.setCookies.push(cookieHeader(SESSION_COOKIE_STAFF, token, { maxAge: 43200 }));
    return json(200, { staff: { email: row.email, name: row.name, role: row.role } });
  }));

  routes.push(route("POST", "/staff/sign-out", async (ctx) => {
    await destroySession(ctx, SESSION_COOKIE_STAFF, "staff");
    ctx.setCookies.push(cookieHeader(SESSION_COOKIE_STAFF, "", { maxAge: 0 }));
    return { status: 204 };
  }));

  routes.push(route("GET", "/staff/me", async (ctx, services) => {
    const session = await loadStaffSession(ctx);
    if (!session?.staff_id) throw new ApiError(401, "unauthenticated");
    const res = await services.pool.query("SELECT email, name, role FROM staff WHERE id = $1", [session.staff_id]);
    if (!res.rows[0]) throw new ApiError(401, "unauthenticated");
    return json(200, { staff: res.rows[0] });
  }));

  routes.push(route("GET", "/staff/batches", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker"]);
    const client = await services.pool.connect();
    try {
      const now = new Date();
      const res = await client.query("SELECT * FROM batches ORDER BY code");
      const batches = [];
      for (const row of res.rows as BatchRow[]) {
        const stock = await batchStock(client, row.code, now);
        const holds = await client.query(
          `SELECT bar, expires_at FROM holds WHERE batch_code = $1 AND status = 'active' AND expires_at > now() ORDER BY bar`,
          [row.code]
        );
        batches.push({
          ...batchView(row, stock),
          poured_on: dateToString(row.poured_on as string | Date),
          cure_days: row.cure_days,
          holds: holds.rows.map((hold) => ({ bar: hold.bar, expires_at: (hold.expires_at as Date).toISOString() }))
        });
      }
      return json(200, { server_now: now.toISOString(), batches });
    } finally {
      client.release();
    }
  }));

  routes.push(route("POST", "/staff/batches", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker"]);
    const spec: Record<string, FieldSpecEntry> = {
      scent: { type: "string", required: true },
      poured_on: { type: "string", required: true },
      cure_days: { type: "number", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, {
        scent: fieldMessage("scent", ctx.locale),
        poured_on: fieldMessage("poured_on", ctx.locale),
        cure_days: fieldMessage("cure_days", ctx.locale)
      });
    }
    const client = await services.pool.connect();
    try {
      const batch = await logLoaf(client, ctx.locale, {
        scent: stringValue(shape, "scent") ?? "",
        pouredOn: stringValue(shape, "poured_on") ?? "",
        cureDays: shape.values["cure_days"] as number
      });
      const stock = await batchStock(client, batch.code, new Date());
      return json(201, { batch: { ...batchView(batch, stock), poured_on: String(batch.poured_on).slice(0, 10), cure_days: batch.cure_days, holds: [] } });
    } finally {
      client.release();
    }
  }));

  const batchAction = async (
    ctx: Ctx, services: Services, code: string,
    action: "cut" | "schedule" | "open" | "withdraw",
    body: { bars?: number; dropAtLocal?: string }
  ): Promise<RouteResult> => {
    await staffOnly(ctx, services, ["maker"]);
    const client = await services.pool.connect();
    try {
      let batch: BatchRow;
      if (action === "cut") {
        batch = await cutBatch(client, ctx.locale, code, body.bars ?? 0);
      } else if (action === "schedule") {
        batch = await scheduleBatch(client, ctx.locale, code, body.dropAtLocal ?? "");
      } else if (action === "open") {
        batch = await openBatch(client, ctx.locale, code);
      } else {
        batch = await withdrawBatch(client, ctx.locale, code);
      }
      const stock = await batchStock(client, code, new Date());
      const holds = await client.query(
        `SELECT bar, expires_at FROM holds WHERE batch_code = $1 AND status = 'active' AND expires_at > now() ORDER BY bar`,
        [code]
      );
      return json(200, {
        batch: {
          ...batchView(batch, stock),
          poured_on: dateToString(batch.poured_on),
          cure_days: batch.cure_days,
          holds: holds.rows.map((hold) => ({ bar: hold.bar, expires_at: (hold.expires_at as Date).toISOString() }))
        }
      });
    } finally {
      client.release();
    }
  };

  routes.push(route("POST", "/staff/batches/{code}/cut", async (ctx, services, params) => {
    const spec: Record<string, FieldSpecEntry> = { bars: { type: "number", required: true } };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, { bars: fieldMessage("bars_cut", ctx.locale) });
    }
    return batchAction(ctx, services, params.code, "cut", { bars: shape.values["bars"] as number });
  }));

  routes.push(route("POST", "/staff/batches/{code}/schedule", async (ctx, services, params) => {
    const spec: Record<string, FieldSpecEntry> = { drop_at_local: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    if (Object.keys(shape.errors).length > 0) {
      throw new ApiError(422, "invalid", null, { drop_at_local: fieldMessage("drop_at_local_format", ctx.locale) });
    }
    return batchAction(ctx, services, params.code, "schedule", { dropAtLocal: shape.values["drop_at_local"] as string });
  }));

  routes.push(route("POST", "/staff/batches/{code}/open", async (ctx, services, params) =>
    batchAction(ctx, services, params.code, "open", {})
  ));

  routes.push(route("POST", "/staff/batches/{code}/withdraw", async (ctx, services, params) =>
    batchAction(ctx, services, params.code, "withdraw", {})
  ));

  routes.push(route("GET", "/staff/batches/{code}/movements", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker"]);
    const client = await services.pool.connect();
    try {
      const res = await client.query(
        "SELECT at, kind, bars, ref FROM stock_movements WHERE batch_code = $1 ORDER BY id",
        [params.code]
      );
      const batch = await client.query("SELECT code FROM batches WHERE code = $1", [params.code]);
      if (!batch.rows[0]) throw new ApiError(404, "not_found");
      return json(200, {
        movements: res.rows.map((row) => ({
          at: (row.at as Date).toISOString(),
          kind: row.kind,
          bars: row.bars,
          ref: row.ref
        }))
      });
    } finally {
      client.release();
    }
  }));

  routes.push(route("GET", "/staff/settings", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker"]);
    const res = await services.pool.query("SELECT value FROM settings WHERE key = 'packing_cutoff_local'");
    return json(200, { packing_cutoff_local: res.rows[0]?.value ?? "14:00", time_zone: "America/Toronto" });
  }));

  routes.push(route("PUT", "/staff/settings", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker"]);
    const spec: Record<string, FieldSpecEntry> = { packing_cutoff_local: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    const value = shape.values["packing_cutoff_local"] as string | undefined;
    if (Object.keys(shape.errors).length > 0 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? "")) {
      throw new ApiError(422, "invalid", null, { packing_cutoff_local: fieldMessage("packing_cutoff_local", ctx.locale) });
    }
    await services.pool.query("UPDATE settings SET value = $2 WHERE key = 'packing_cutoff_local'", ["", value]);
    return json(200, { packing_cutoff_local: value, time_zone: "America/Toronto" });
  }));

  routes.push(route("GET", "/staff/packing", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "packing"]);
    const client = await services.pool.connect();
    try {
      const list = await packingList(client);
      return json(200, {
        date: list.date,
        cutoff_local: list.cutoffLocal,
        orders: list.orders.map(packingView)
      });
    } finally {
      client.release();
    }
  }));

  routes.push(route("POST", "/staff/orders/{number}/ship", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker", "packing"]);
    const row = await shipOrder(services.pool, ctx.locale, params.number);
    return json(200, { order: packingView(row) });
  }));

  routes.push(route("GET", "/staff/search", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const q = ctx.url.searchParams.get("q") ?? "";
    if (q.trim().length === 0) {
      throw new ApiError(422, "invalid", null, { q: fieldMessage("q", ctx.locale) });
    }
    const client = await services.pool.connect();
    try {
      const orders = await client.query(
        `SELECT o.number, o.placed_at, o.total_cents, o.status, o.customer_id FROM orders o
         JOIN customers c ON c.id = o.customer_id
         WHERE o.number = $1 OR c.email = $1
         ORDER BY o.placed_at DESC`,
        [q.trim().toLowerCase()]
      );
      const subscriptions = await client.query(
        `SELECT s.number, s.state, s.scent, s.cadence, s.next_bill_date FROM subscriptions s
         JOIN customers c ON c.id = s.customer_id
         WHERE s.number = $1 OR c.email = $1
         ORDER BY s.id DESC`,
        [q.trim().toLowerCase()]
      );
      return json(200, {
        orders: orders.rows.map((row) => ({
          number: row.number,
          placed_at: (row.placed_at as Date).toISOString(),
          total: money(row.total_cents),
          status: row.status
        })),
        subscriptions: subscriptions.rows.map((row) => ({
          number: row.number,
          state: row.state,
          scent: row.scent,
          cadence: row.cadence,
          next_bill_date: row.next_bill_date ? dateToString(row.next_bill_date as string | Date) : null
        }))
      });
    } finally {
      client.release();
    }
  }));

  routes.push(route("GET", "/staff/orders/{number}", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const client = await services.pool.connect();
    try {
      const loaded = await loadOrderForStaff(client, params.number, false);
      const refunds = await client.query(
        `SELECT * FROM refunds WHERE order_id = $1 ORDER BY id`,
        [loaded.id]
      );
      const credits = await client.query(
        `SELECT * FROM credits WHERE target = $1 ORDER BY id`,
        [params.number]
      );
      return json(200, {
        ...orderView(loaded.order),
        refunds: refunds.rows.map((row) => refundViewFromRecord(refundFromRow(row, params.number))),
        credits: credits.rows.map((row) => ({
          number: row.number,
          target: row.target,
          status: row.status,
          amount: money(row.amount_cents),
          reason: row.reason,
          killbill_ref: row.killbill_ref,
          created_at: (row.created_at as Date).toISOString()
        }))
      }, { ETag: `"${loaded.order.version}"` });
    } finally {
      client.release();
    }
  }));

  routes.push(route("GET", "/staff/subscriptions/{number}", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const client = await services.pool.connect();
    try {
      const res = await client.query("SELECT * FROM subscriptions WHERE number = $1", [params.number]);
      if (!res.rows[0]) throw new ApiError(404, "not_found");
      const customer = await client.query("SELECT email FROM customers WHERE id = $1", [res.rows[0].customer_id]);
      const credits = await client.query(
        "SELECT * FROM credits WHERE target = $1 AND customer_id = $2 ORDER BY id",
        [params.number, res.rows[0].customer_id]
      );
      return json(200, {
        ...subscriptionView(toRecord(res.rows[0]), services.env.subscriptionLockHours),
        email: customer.rows[0].email,
        credits: credits.rows.map((row) => ({
          number: row.number,
          target: row.target,
          status: row.status,
          amount: money(row.amount_cents),
          reason: row.reason,
          killbill_ref: row.killbill_ref,
          created_at: (row.created_at as Date).toISOString()
        }))
      }, { ETag: `"${res.rows[0].version}"` });
    } finally {
      client.release();
    }
  }));

  routes.push(route("POST", "/staff/orders/{number}/refunds", async (ctx, services, params) => {
    const staff = await staffOnly(ctx, services, ["maker", "finance"]);
    const spec: Record<string, FieldSpecEntry> = {
      bars: { type: "array", required: true, items: { batch: { type: "string", required: true }, bar: { type: "number", required: true } } },
      restock: { type: "boolean", required: true },
      reason: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    const key = idempotencyKey(ctx);
    const scope = `refunds:${staff.row.email}`;
    const replay = await beginIdempotency(ctx, scope, key, ctx.body);
    if (replay) {
      const stored = JSON.parse(replay) as { status: number; body: string };
      return { status: stored.status, body: JSON.parse(stored.body), headers: { "Idempotent-Replayed": "true" } };
    }
    let result: RouteResult;
    try {
      const ifMatch = readIfMatch(ctx);
      const outcome = await issueRefund(
        services.pool, services.kb, services.outbox, ctx.locale,
        { email: staff.row.email, role: staff.row.role },
        params.number, ifMatch,
        {
          bars: (shape.values["bars"] as { batch: string; bar: number }[] | undefined) ?? [],
          restock: shape.values["restock"] === true,
          reason: shape.values["reason"] as string
        }
      );
      result = await json(201, {
        refund: refundViewFromRecord(outcome.refund),
        order: orderView(outcome.order)
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if ((status >= 200 && status < 300) || status === 409 || status === 410 || status === 412 || status === 422) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
        const { body } = errorBody(apiError, ctx.locale);
        await finishIdempotency(ctx, scope, key, status, body);
      }
      throw err;
    }
    await finishIdempotency(ctx, scope, key, result.status, JSON.stringify(result.body));
    return result;
  }));

  routes.push(route("POST", "/staff/credits", async (ctx, services) => {
    const staff = await staffOnly(ctx, services, ["maker", "finance"]);
    const spec: Record<string, FieldSpecEntry> = {
      target: { type: "string", required: true },
      amount_cents: { type: "number", required: true },
      reason: { type: "string", required: true }
    };
    const shape = checkShape(ctx.body, spec);
    const key = idempotencyKey(ctx);
    const scope = `credits:${staff.row.email}`;
    const replay = await beginIdempotency(ctx, scope, key, ctx.body);
    if (replay) {
      const stored = JSON.parse(replay) as { status: number; body: string };
      return { status: stored.status, body: JSON.parse(stored.body), headers: { "Idempotent-Replayed": "true" } };
    }
    let result: RouteResult;
    try {
      const ifMatch = readIfMatch(ctx);
      const credit = await addCredit(
        services.pool, services.kb, services.outbox, ctx.locale,
        { email: staff.row.email, role: staff.row.role },
        ifMatch,
        {
          target: stringValue(shape, "target") ?? "",
          amountCents: shape.values["amount_cents"] as number,
          reason: shape.values["reason"] as string
        }
      );
      result = await json(201, {
        number: credit.number,
        target: credit.target,
        status: credit.status,
        amount: money(credit.amount_cents),
        reason: credit.reason,
        killbill_ref: credit.killbill_ref,
        created_at: credit.created_at.toISOString()
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if ((status >= 200 && status < 300) || status === 409 || status === 410 || status === 412 || status === 422) {
        const apiError = err instanceof ApiError ? err : new ApiError(500, "internal_error");
        const { body } = errorBody(apiError, ctx.locale);
        await finishIdempotency(ctx, scope, key, status, body);
      }
      throw err;
    }
    await finishIdempotency(ctx, scope, key, result.status, JSON.stringify(result.body));
    return result;
  }));

  routes.push(route("GET", "/staff/audit", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const res = await services.pool.query("SELECT * FROM audit_entries ORDER BY id DESC");
    return json(200, { entries: res.rows.map(auditView) });
  }));

  const auditImmutable = async (ctx: Ctx): Promise<RouteResult> => {
    throw new ApiError(405, "audit_immutable", message("audit_immutable", ctx.locale));
  };
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    routes.push(route(method, "/staff/audit", auditImmutable));
    routes.push(route(method, "/staff/audit/{id}", auditImmutable));
  }

  routes.push(route("GET", "/staff/reconciliation", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const month = ctx.url.searchParams.get("month") ?? undefined;
    const result = await reconciliation(services.pool, services.kb, ctx.locale, month);
    return json(200, {
      month: result.month,
      stale: result.stale,
      checked_at: result.checkedAt,
      lines: result.lines.map(lineView),
      totals: { shop: money(result.totals.shopCents), killbill: money(result.totals.killbillCents) }
    });
  }));

  routes.push(route("POST", "/staff/reconciliation/accept", async (ctx, services) => {
    const staff = await staffOnly(ctx, services, ["maker", "finance"]);
    const spec: Record<string, FieldSpecEntry> = { month: { type: "string", required: true }, key: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    const result = await acceptLine(
      services.pool, services.kb, ctx.locale,
      { email: staff.row.email, role: staff.row.role },
      stringValue(shape, "month") ?? "",
      stringValue(shape, "key") ?? ""
    );
    return json(200, {
      line: lineView(result.line),
      audit: auditView({
        id: result.auditId,
        at: new Date(),
        actor: staff.row.email,
        role: staff.row.role,
        action: "reconciliation_accept",
        target: "",
        reason: "",
        amount: money(0),
        killbill_ref: null,
        outcome: "issued"
      })
    });
  }));

  routes.push(route("POST", "/staff/reconciliation/refund-orphan", async (ctx, services) => {
    const staff = await staffOnly(ctx, services, ["maker", "finance"]);
    const spec: Record<string, FieldSpecEntry> = { month: { type: "string", required: true }, key: { type: "string", required: true } };
    const shape = checkShape(ctx.body, spec);
    const result = await refundOrphan(
      services.pool, services.kb, ctx.locale,
      { email: staff.row.email, role: staff.row.role },
      stringValue(shape, "month") ?? "",
      stringValue(shape, "key") ?? ""
    );
    return json(200, {
      line: lineView(result.line),
      refund: { amount: money(result.refund.amountCents), killbill_ref: result.refund.killbillRef },
      audit: auditView({
        id: result.auditId,
        at: new Date(),
        actor: staff.row.email,
        role: staff.row.role,
        action: "orphan_refund",
        target: "",
        reason: "",
        amount: money(0),
        killbill_ref: null,
        outcome: "issued"
      })
    });
  }));

  routes.push(route("GET", "/staff/notices", async (ctx, services) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const status = ctx.url.searchParams.get("status");
    if (status !== null && !["queued", "retrying", "sent", "failed"].includes(status)) {
      throw new ApiError(422, "invalid", null, { status: fieldMessage("status", ctx.locale) });
    }
    const res = status
      ? await services.pool.query("SELECT * FROM notices WHERE status = $1 ORDER BY id DESC", [status])
      : await services.pool.query("SELECT * FROM notices ORDER BY id DESC");
    return json(200, {
      notices: res.rows.map((row) => ({
        number: row.number,
        key: row.key,
        kind: row.kind,
        to: row.to_email,
        locale: row.locale,
        subject: row.subject,
        status: row.status,
        enqueued_at: (row.enqueued_at as Date).toISOString(),
        attempts: row.attempts
      }))
    });
  }));

  routes.push(route("POST", "/staff/notices/{number}/resend", async (ctx, services, params) => {
    await staffOnly(ctx, services, ["maker", "finance"]);
    const result = await services.outbox.resend(params.number);
    if (!result) {
      throw new ApiError(409, "notice_not_failed", message("notice_not_failed", ctx.locale, { notice: params.number }));
    }
    return json(200, {
      notice: {
        number: result.number,
        key: result.key,
        kind: "",
        to: result.to_email,
        locale: result.locale,
        subject: result.subject,
        status: "queued",
        enqueued_at: (result.enqueued_at as Date).toISOString(),
        attempts: []
      }
    });
  }));


  return routes;
}

async function checkoutRoute(
  ctx: Ctx,
  services: Services,
  customerId: number,
  holdIds: string[],
  shipping: { name?: string; line1?: string; city?: string; province?: string; postal_code?: string }
): Promise<RouteResult> {
  const customer = await services.pool.query("SELECT email FROM customers WHERE id = $1", [customerId]);
  const result = await checkout(
    services.pool, services.kb, services.outbox, ctx.locale,
    ctx.cookies["pdl_cart"], customerId, customer.rows[0].email as string,
    {
      holds: holdIds,
      shipping: {
        name: shipping.name ?? "",
        line1: shipping.line1 ?? "",
        city: shipping.city ?? "",
        province: shipping.province ?? "",
        postal_code: shipping.postal_code ?? ""
      }
    }
  );
  return json(201, { order: orderView(result.order) });
}

function refundViewFromRecord(record: import("../domain/views.js").RefundRecord): unknown {
  return refundView(record);
}

function readIfMatch(ctx: Ctx): number | null {
  const header = ctx.req.headers.get("if-match");
  if (header === null) return null;
  const value = header.replace(/^"(.*)"$/, "$1");
  const version = Number(value);
  return Number.isInteger(version) ? version : -1;
}
