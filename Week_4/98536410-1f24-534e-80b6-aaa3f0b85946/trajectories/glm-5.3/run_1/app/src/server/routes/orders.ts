import { Router, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { errors, ApiError } from "../api-errors.js";
import type { AppLocals, StoreRecord } from "../auth-types.js";
import { loadStoreRecord } from "./stores.js";
import { loadActiveHold, releaseHold, releaseExpiredHolds, loadHoldById, type HoldRecord } from "./cart.js";
import { appendOrderEvent, checkChain, eventDigest, lastDigest } from "../history.js";
import { OPERATORS } from "../../shared/domain.js";
import { lineTotalCents, vatCents } from "../../shared/money.js";
import { isValidQuery, searchLiteral } from "../../shared/search.js";
import { localDateInZone, localTimeInZone } from "../time-slots.js";

export interface OrderRecord {
  id: string;
  operator_id: string;
  person_id: string;
  store_id: string;
  number: string;
  status: string;
  slot_start_utc: Date;
  customer_name: string;
  customer_email: string;
  total_cents: number;
  vat_cents: number;
  created_at: Date;
  next_seq: number;
}

export interface OrderLineRecord {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
  line_total_cents: number;
  vat_rate: number;
  vat_cents: number;
  returned_quantity: number;
}

export async function loadOrderById(client: PoolClient, orderId: string): Promise<OrderRecord | null> {
  const result = await client.query<OrderRecord>("SELECT * FROM orders WHERE id = $1", [orderId]);
  return result.rows[0] ?? null;
}

export function canSeeOrder(auth: { user: { id: string; role: string; operatorId: string }; storeIds: string[] }, order: OrderRecord): boolean {
  if (order.operator_id !== auth.user.operatorId) return false;
  if (auth.user.role === "shopper") return order.person_id === auth.user.id;
  return true;
}

export async function orderAnswer(client: PoolClient, order: OrderRecord): Promise<Record<string, unknown>> {
  const store = await client.query<{ name: string; timezone: string }>("SELECT name, timezone FROM stores WHERE id = $1", [order.store_id]);
  const lines = await client.query<OrderLineRecord>(
    "SELECT sku, name, quantity, unit_price_milli, line_total_cents, vat_rate, vat_cents, returned_quantity FROM order_lines WHERE order_id = $1 ORDER BY sku",
    [order.id],
  );
  const returns = await client.query<{ id: string; number: string; status: string; refund_cents: number }>(
    "SELECT id, number, status, refund_cents FROM returns WHERE order_id = $1 ORDER BY created_at, id",
    [order.id],
  );
  const refunded = returns.rows.filter((r) => r.status === "settled").reduce((sum, r) => sum + r.refund_cents, 0);
  const tz = store.rows[0].timezone;
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    store_id: order.store_id,
    store_name: store.rows[0].name,
    timezone: tz,
    slot_start_utc: order.slot_start_utc.toISOString(),
    slot_local_date: localDateInZone(tz as "Europe/Lisbon" | "Atlantic/Azores", order.slot_start_utc),
    slot_local_time: localTimeInZone(tz as "Europe/Lisbon" | "Atlantic/Azores", order.slot_start_utc).slice(0, 5),
    customer: { name: order.customer_name, email: order.customer_email },
    lines: lines.rows.map((line) => ({
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unit_price_milli: line.unit_price_milli,
      line_total_cents: line.line_total_cents,
      vat_rate: line.vat_rate,
      vat_cents: line.vat_cents,
      returned_quantity: line.returned_quantity,
    })),
    total_cents: order.total_cents,
    vat_cents: order.vat_cents,
    refunded_cents: refunded,
    created_at: order.created_at.toISOString(),
  };
}

export function ordersRouter(): Router {
  const router = Router();

  router.post("/orders", async (req, res, next) => {
    try {
      const { db, cfg, storage } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      if (auth.user.role !== "shopper") {
        next(errors.forbidden());
        return;
      }
      const requestKey = req.headers["request-key"];
      if (typeof requestKey !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(requestKey)) {
        next(errors.validationFailed({ request_key: "A request key of 8 to 64 letters, digits and hyphens is required." }));
        return;
      }
      const body = req.body as { hold_id?: unknown; slot_start_utc?: unknown; customer?: { name?: unknown; email?: unknown } };
      if (typeof body.hold_id !== "string" || typeof body.slot_start_utc !== "string" || typeof body.customer?.name !== "string" || typeof body.customer?.email !== "string") {
        next(errors.validationFailed({ body: "hold_id, slot_start_utc and customer are required." }));
        return;
      }
      if (body.customer.name.trim().length < 1 || body.customer.name.trim().length > 120) {
        next(errors.validationFailed({ "customer.name": "Enter a name of 1 to 120 characters." }));
        return;
      }
      const emailTrim = body.customer.email.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailTrim)) {
        next(errors.validationFailed({ "customer.email": "Enter an email address." }));
        return;
      }
      const replay = await requestKeyReplay(db, auth, "POST", "/api/orders", body, requestKey);
      if (replay.replayError) {
        next(replay.replayError);
        return;
      }
      if (replay.replayStatus !== null) {
        res.status(replay.replayStatus).json(replay.replayBody);
        return;
      }
      const placed = await placeOrder(db, cfg, storage, auth, {
        hold_id: body.hold_id as string,
        slot_start_utc: body.slot_start_utc as string,
        customer: { name: (body.customer?.name as string).trim(), email: (body.customer?.email as string).trim() },
      }, requestKey);
      if ("error" in placed && placed.error) {
        if (placed.error.status >= 500) {
          await clearRequestKeyOn5xx(db, auth, requestKey);
        }
        next(placed.error);
        return;
      }
      res.status(201).json(placed.answer);
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const q = typeof req.query.q === "string" ? req.query.q : undefined;
      if (!isValidQuery(q)) {
        next(errors.validationFailed({ q: "q must be at most 100 characters" }));
        return;
      }
      const trimmed = searchLiteral(q);
      const limitParam = typeof req.query.limit === "string" ? req.query.limit : undefined;
      let limit = 20;
      if (limitParam !== undefined) {
        const parsed = Number.parseInt(limitParam, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          next(errors.validationFailed({ limit: "limit must be 1 to 100." }));
          return;
        }
        limit = parsed;
      }
      const beforeParam = typeof req.query.before === "string" ? req.query.before : undefined;
      const storeParam = typeof req.query.store_id === "string" ? req.query.store_id : undefined;
      const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
      const answer = await db.withClient(async (client) => {
        const params: unknown[] = [auth.user.operatorId];
        let where = "o.operator_id = $1";
        if (auth.user.role === "shopper") {
          params.push(auth.user.id);
          where += ` AND o.person_id = $${params.length}`;
        }
        if (trimmed) {
          const lowered = trimmed.toLowerCase();
          params.push(lowered, lowered);
          where += ` AND (lower(o.number) = $${params.length - 1} OR lower(o.customer_email) = $${params.length})`;
        }
        if (storeParam) {
          params.push(storeParam);
          where += ` AND o.store_id = $${params.length}`;
        }
        if (statusParam) {
          params.push(statusParam);
          where += ` AND o.status = $${params.length}`;
        }
        if (beforeParam) {
          const decoded = Buffer.from(beforeParam, "base64url").toString("utf8");
          const [createdAt, id] = decoded.split("|");
          const parsedTime = Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt) : null;
          if (!parsedTime || typeof id !== "string") {
            return { invalid: errors.validationFailed({ before: "Unknown cursor." }) };
          }
          params.push(parsedTime.toISOString(), id);
          where += ` AND (o.created_at, o.id) < ($${params.length - 1}, $${params.length})`;
        }
        const countResult = await client.query<{ count: string }>(`SELECT count(*) as count FROM orders o WHERE ${where}`, params);
        params.push(limit);
        const rows = await client.query<{ id: string; number: string; status: string; store_id: string; store_name: string; slot_start_utc: Date; total_cents: number; customer_email: string; created_at: Date }>(
          `SELECT o.id, o.number, o.status, o.store_id, s.name as store_name, o.slot_start_utc, o.total_cents, o.customer_email, o.created_at
             FROM orders o JOIN stores s ON s.id = o.store_id
            WHERE ${where}
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT $${params.length}`,
          params,
        );
        let nextBefore: string | null = null;
        if (rows.rows.length === limit) {
          const last = rows.rows[rows.rows.length - 1];
          nextBefore = Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString("base64url");
        }
        return {
          count: Number(countResult.rows[0].count),
          orders: rows.rows.map((row) => ({
            id: row.id,
            number: row.number,
            status: row.status,
            store_id: row.store_id,
            store_name: row.store_name,
            slot_start_utc: row.slot_start_utc.toISOString(),
            total_cents: row.total_cents,
            customer_email: row.customer_email,
            created_at: row.created_at.toISOString(),
          })),
          next_before: nextBefore,
        };
      });
      if ("invalid" in answer && answer.invalid) {
        next(answer.invalid);
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:id", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const answer = await db.withClient(async (client) => {
        const order = await loadOrderById(client, req.params.id);
        if (!order || !canSeeOrder(auth, order)) return null;
        return orderAnswer(client, order);
      });
      if (answer === null) {
        next(errors.notFound());
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  router.post("/orders/:id/transitions", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const to = (req.body as { to?: unknown }).to;
      if (typeof to !== "string" || !["picking", "ready", "collected", "cancelled"].includes(to)) {
        next(errors.validationFailed({ to: "Unknown transition." }));
        return;
      }
      const answer = await db.withClient(async (client) => {
        await client.query("BEGIN");
        const order = await loadOrderById(client, req.params.id);
        if (!order || !canSeeOrder(auth, order)) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        const allowed: Record<string, string[]> = {
          manager: ["picking", "ready", "collected", "cancelled"],
          care: ["cancelled"],
          lead: [],
          shopper: [],
        };
        const allowedTo = allowed[auth.user.role] ?? [];
        const mayAct =
          (auth.user.role === "manager" && auth.storeIds.includes(order.store_id) && allowedTo.includes(to)) ||
          (auth.user.role === "care" && to === "cancelled") ||
          (auth.user.role === "shopper" && order.person_id === auth.user.id && false);
        if (!mayAct) {
          await client.query("COMMIT");
          return { forbidden: true };
        }
        const transitions: Record<string, string[]> = {
          placed: ["picking", "cancelled"],
          picking: ["ready", "cancelled"],
          ready: ["collected", "cancelled"],
          collected: [],
          cancelled: [],
        };
        if (!(transitions[order.status] ?? []).includes(to)) {
          await client.query("COMMIT");
          return { invalid: errors.invalidTransition(order.status, to) };
        }
        const chain = await loadEvents(client, order.id);
        const check = checkChain(chain);
        if (!check.ok) {
          await client.query("COMMIT");
          return { invalid: errors.conflict("sequence_broken", { first_bad_seq: check.firstBadSeq }) };
        }
        const newStatus = to;
        await client.query("UPDATE orders SET status = $1 WHERE id = $2", [newStatus, order.id]);
        if (newStatus === "cancelled") {
          const lines = await client.query<{ sku: string; quantity: number }>("SELECT sku, quantity FROM order_lines WHERE order_id = $1", [order.id]);
          for (const line of lines.rows) {
            await client.query(
              "UPDATE stock_lines SET on_hand = on_hand + $1 WHERE store_id = $2 AND sku = $3",
              [line.quantity, order.store_id, line.sku],
            );
          }
        }
        const at = new Date();
        const last = await lastDigest(client, order.id);
        const seq = last.seq + 1;
        const digestType = to === "cancelled" ? "order.cancelled" : `order.${to}`;
        await appendOrderEvent(client, order.id, seq, digestType, { from: order.status, to: newStatus, by: auth.user.id }, at, last.digest);
        await rebuildOrderView(client, order.id);
        await client.query("COMMIT");
        return { orderId: order.id };
      });
      if ("notFound" in answer && answer.notFound) {
        next(errors.notFound());
        return;
      }
      if ("forbidden" in answer && answer.forbidden) {
        next(errors.forbidden());
        return;
      }
      if ("invalid" in answer && answer.invalid) {
        next(answer.invalid);
        return;
      }
      const order = await db.withClient(async (client) => {
        const record = await loadOrderById(client, (answer as { orderId: string }).orderId);
        return record ? orderAnswer(client, record) : null;
      });
      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:id/document", async (req, res, next) => {
    try {
      const { db, storage } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const order = await db.withClient(async (client) => {
        const record = await loadOrderById(client, req.params.id);
        if (!record || !canSeeOrder(auth, record)) return null;
        return record;
      });
      if (!order) {
        next(errors.notFound());
        return;
      }
      if (!storage.isUp()) {
        next(errors.storageUnavailable());
        return;
      }
      try {
        const object = await storage.get(`orders/${order.operator_id}/${order.number}.json`);
        res.setHeader("Content-Type", object.contentType);
        res.send(object.body);
      } catch {
        next(errors.notFound());
      }
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:id/events", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const answer = await db.withClient(async (client) => {
        const order = await loadOrderById(client, req.params.id);
        if (!order || !canSeeOrder(auth, order)) return { notFound: true };
        if (!["lead", "care", "manager"].includes(auth.user.role)) return { forbidden: true };
        if (auth.user.role === "manager" && !auth.storeIds.includes(order.store_id)) return { forbidden: true };
        const chain = await loadEvents(client, order.id);
        const check = checkChain(chain);
        if (!check.ok) return { broken: errors.conflict("sequence_broken", { first_bad_seq: check.firstBadSeq }) };
        return {
          order_id: order.id,
          events: chain.map((entry) => ({
            seq: entry.seq,
            type: entry.type,
            at: entry.at.toISOString(),
            data: entry.data,
            digest: entry.digest,
          })),
        };
      });
      if ("notFound" in answer && answer.notFound) {
        next(errors.notFound());
        return;
      }
      if ("forbidden" in answer && answer.forbidden) {
        next(errors.forbidden());
        return;
      }
      if ("broken" in answer && answer.broken) {
        next(answer.broken);
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:id/replay", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const answer = await db.withClient(async (client) => {
        const order = await loadOrderById(client, req.params.id);
        if (!order || !canSeeOrder(auth, order)) return { notFound: true };
        if (!["lead", "care", "manager"].includes(auth.user.role)) return { forbidden: true };
        if (auth.user.role === "manager" && !auth.storeIds.includes(order.store_id)) return { forbidden: true };
        const chain = await loadEvents(client, order.id);
        const check = checkChain(chain);
        if (!check.ok) return { broken: errors.conflict("sequence_broken", { first_bad_seq: check.firstBadSeq }) };
        return replayFromEvents(chain);
      });
      if ("notFound" in answer && answer.notFound) {
        next(errors.notFound());
        return;
      }
      if ("forbidden" in answer && answer.forbidden) {
        next(errors.forbidden());
        return;
      }
      if ("broken" in answer && answer.broken) {
        next(answer.broken);
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export interface OrderEventRow {
  order_id: string;
  seq: number;
  type: string;
  at: Date;
  data: unknown;
  digest: string;
}

export async function loadEvents(client: PoolClient, orderId: string): Promise<OrderEventRow[]> {
  const result = await client.query<{ order_id: string; seq: number; type: string; at: Date; data: unknown; digest: string }>(
    "SELECT order_id, seq, type, at, data, digest FROM order_events WHERE order_id = $1 ORDER BY seq",
    [orderId],
  );
  return result.rows.map((row) => ({ ...row, data: typeof row.data === "string" ? JSON.parse(row.data) : row.data }));
}

export function replayFromEvents(chain: OrderEventRow[]): Record<string, unknown> {
  let status = "placed";
  let totalCents = 0;
  let refundedCents = 0;
  const returns: { id: string; status: string; refund_cents: number }[] = [];
  for (const entry of chain) {
    const data = entry.data as Record<string, unknown>;
    if (entry.type === "order.placed") {
      totalCents = typeof data.total_cents === "number" ? data.total_cents : 0;
    } else if (entry.type.startsWith("order.")) {
      status = typeof data.to === "string" ? data.to : status;
    } else if (entry.type === "return.requested") {
      const returnId = typeof data.return_id === "string" ? data.return_id : "";
      const refund = typeof data.refund_cents === "number" ? data.refund_cents : 0;
      returns.push({ id: returnId, status: "requested", refund_cents: refund });
    } else if (entry.type === "return.received") {
      const returnId = typeof data.return_id === "string" ? data.return_id : "";
      const found = returns.find((r) => r.id === returnId);
      if (found) found.status = "received";
    } else if (entry.type === "return.settled") {
      const returnId = typeof data.return_id === "string" ? data.return_id : "";
      const found = returns.find((r) => r.id === returnId);
      if (found) {
        found.status = "settled";
        refundedCents += found.refund_cents;
      }
    } else if (entry.type === "return.declined") {
      const returnId = typeof data.return_id === "string" ? data.return_id : "";
      const found = returns.find((r) => r.id === returnId);
      if (found) found.status = "declined";
    }
  }
  const lastSeq = chain.length > 0 ? chain[chain.length - 1].seq : 0;
  const orderId = chain.length > 0 ? chain[0].order_id : "";
  return { order_id: orderId, status, last_seq: lastSeq, total_cents: totalCents, refunded_cents: refundedCents, returns };
}

export async function rebuildOrderView(client: PoolClient, orderId: string): Promise<void> {
  const chain = await loadEvents(client, orderId);
  const check = checkChain(chain);
  if (!check.ok) return;
  const replayed = replayFromEvents(chain) as { status: string; last_seq: number; total_cents: number; refunded_cents: number };
  const order = await loadOrderById(client, orderId);
  if (!order) return;
  await client.query(
    `INSERT INTO order_view (order_id, operator_id, store_id, number, status, total_cents, refunded_cents, last_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (order_id) DO UPDATE SET operator_id = EXCLUDED.operator_id, store_id = EXCLUDED.store_id,
       number = EXCLUDED.number, status = EXCLUDED.status, total_cents = EXCLUDED.total_cents,
       refunded_cents = EXCLUDED.refunded_cents, last_seq = EXCLUDED.last_seq`,
    [orderId, order.operator_id, order.store_id, order.number, replayed.status, replayed.total_cents, replayed.refunded_cents, replayed.last_seq],
  );
}

export interface RequestKeyRow {
  operator_id: string;
  account_id: string;
  request_key: string;
  method: string;
  path: string;
  body_hash: string;
  in_progress: boolean;
  response_status: number | null;
  response_body: unknown;
}

export function canonicalBody(body: unknown): string {
  return stableStringify(body);
}

export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return "null";
}

export interface RequestKeyAnswer {
  replayError: ApiError | null;
  replayStatus: number | null;
  replayBody: unknown;
}

export async function requestKeyReplay(
  db: import("../db.js").Database,
  auth: { user: { id: string; operatorId: string } },
  method: string,
  path: string,
  body: unknown,
  requestKey: string,
): Promise<RequestKeyAnswer> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<{ body_hash: string; in_progress: boolean; response_status: number | null; response_body: unknown }>(
      "SELECT body_hash, in_progress, response_status, response_body FROM request_keys WHERE operator_id = $1 AND account_id = $2 AND request_key = $3 FOR UPDATE",
      [auth.user.operatorId, auth.user.id, requestKey],
    );
    if (row.rows.length === 0) {
      await client.query(
        `INSERT INTO request_keys (operator_id, account_id, request_key, method, path, body_hash, in_progress)
         VALUES ($1,$2,$3,$4,$5,$6,true)
         ON CONFLICT (operator_id, account_id, request_key) DO NOTHING`,
        [auth.user.operatorId, auth.user.id, requestKey, method, path, stableStringify(body)],
      );
      await client.query("COMMIT");
      return { replayError: null, replayStatus: null, replayBody: null };
    }
    const existing = row.rows[0];
    if (existing.in_progress) {
      await client.query("COMMIT");
      return { replayError: errors.conflict("request_in_progress"), replayStatus: null, replayBody: null };
    }
    if (existing.body_hash !== stableStringify(body)) {
      await client.query("COMMIT");
      return { replayError: errors.conflict("request_key_reuse"), replayStatus: null, replayBody: null };
    }
    const parsed = existing.response_body ?? null;
    await client.query("COMMIT");
    return { replayError: null, replayStatus: existing.response_status, replayBody: parsed };
  } finally {
    client.release();
  }
}

export async function clearRequestKeyOn5xx(db: import("../db.js").Database, auth: { user: { id: string; operatorId: string } }, requestKey: string): Promise<void> {
  await db.withClient(async (client) => {
    await client.query(
      "UPDATE request_keys SET in_progress = false, response_status = NULL, response_body = NULL WHERE operator_id = $1 AND account_id = $2 AND request_key = $3",
      [auth.user.operatorId, auth.user.id, requestKey],
    );
  });
}

export async function placeOrder(
  db: import("../db.js").Database,
  cfg: import("../config.js").Config,
  storage: import("../object-storage.js").ObjectStorage,
  auth: { user: { id: string; operatorId: string }; storeIds: string[] },
  body: { hold_id: string; slot_start_utc: string; customer: { name: string; email: string } },
  requestKey: string,
): Promise<{ error?: ApiError; answer?: Record<string, unknown> }> {
  const now = new Date();
  const client = await db.connect();
  let storedDocument = false;
  let documentKey = "";
  try {
    await client.query("BEGIN");
    await releaseExpiredHolds(client, now);
    const hold = await loadHoldById(client, body.hold_id, auth.user.id);
    if (!hold) {
      await client.query("ROLLBACK");
      return { error: errors.notFound() };
    }
    if (hold.status === "released") {
      if (hold.release_reason === "window ended") {
        await storeRequestKey(client, auth, "POST", "/api/orders", body, requestKey, 409, { code: "hold_expired", hold_id: hold.id });
        await client.query("COMMIT");
        return { error: errors.conflict("hold_expired", { hold_id: hold.id }) };
      }
      await storeRequestKey(client, auth, "POST", "/api/orders", body, requestKey, 409, { code: "invalid_transition", from: hold.status, to: "converted" });
      await client.query("COMMIT");
      return { error: errors.invalidTransition(hold.status, "converted") };
    }
    if (hold.status === "converted") {
      await client.query("COMMIT");
      await storeRequestKey(client, auth, "POST", "/api/orders", body, requestKey, 409, { code: "invalid_transition", from: hold.status, to: "converted" });
      return { error: errors.invalidTransition(hold.status, "converted") };
    }
    if (hold.expires_at.getTime() <= now.getTime()) {
      await releaseHold(client, hold, "window ended", now);
      await storeRequestKey(client, auth, "POST", "/api/orders", body, requestKey, 409, { code: "hold_expired", hold_id: hold.id });
      await client.query("COMMIT");
      return { error: errors.conflict("hold_expired", { hold_id: hold.id }) };
    }
    const store = await loadStoreRecord(client, hold.store_id, auth.user.operatorId);
    if (!store) {
      await client.query("ROLLBACK");
      return { error: errors.notFound() };
    }
    const slotDate = new Date(body.slot_start_utc);
    if (Number.isNaN(slotDate.getTime())) {
      await client.query("ROLLBACK");
      return { error: errors.validationFailed({ slot_start_utc: "Pick a collection time." }) };
    }
    const slotOk = await isOfferedSlot(client, store, slotDate, now);
    if (!slotOk) {
      await client.query("ROLLBACK");
      await storeRequestKey(client, auth, "POST", "/api/orders", body, requestKey, 409, { code: "slot_unavailable" });
      await client.query("COMMIT");
      return { error: errors.conflict("slot_unavailable") };
    }
    // Serialize placements on the same shop so the slot capacity check is exact.
    await client.query("SELECT id FROM stores WHERE id = $1 FOR UPDATE", [store.id]);
    const capacity = await client.query<{ count: string }>(
      "SELECT count(*) as count FROM orders WHERE store_id = $1 AND slot_start_utc = $2 AND status <> 'cancelled'",
      [store.id, slotDate],
    );
    if (Number(capacity.rows[0].count) >= 2) {
      await storeRequestKey(client, auth, "POST", "/api/orders", body, requestKey, 409, { code: "slot_unavailable" });
      await client.query("COMMIT");
      return { error: errors.conflict("slot_unavailable") };
    }
    const operatorPrefix = OPERATORS.find((op) => op.id === auth.user.operatorId)?.prefix ?? "XX";
    const seqResult = await client.query<{ last_number: number }>(
      "UPDATE operator_sequences SET last_number = last_number + 1 WHERE operator_id = $1 RETURNING last_number",
      [auth.user.operatorId],
    );
    const nextNumber = seqResult.rows[0].last_number;
    const orderNumber = `${operatorPrefix}-${String(nextNumber).padStart(6, "0")}`;
    const orderId = crypto.randomUUID();
    const lines = await client.query<{ sku: string; name: string; quantity: number; unit_price_milli: number }>(
      `SELECT hl.sku, p.name, hl.quantity, p.unit_price_milli
         FROM hold_lines hl JOIN products p ON p.operator_id = $2 AND p.sku = hl.sku
        WHERE hl.hold_id = $1 ORDER BY hl.sku`,
      [hold.id, auth.user.operatorId],
    );
    const vatRate = store.timezone === "Atlantic/Azores" ? 16 : 23;
    let totalCents = 0;
    let totalVat = 0;
    const lineRows = lines.rows.map((row) => {
      const lineTotal = lineTotalCents(row.quantity, row.unit_price_milli);
      const vat = vatCents(lineTotal, vatRate);
      totalCents += lineTotal;
      totalVat += vat;
      return { ...row, lineTotal, vat };
    });
    await client.query(
      `INSERT INTO orders (id, operator_id, person_id, store_id, number, status, slot_start_utc, customer_name, customer_email, total_cents, vat_cents, created_at, next_seq)
       VALUES ($1,$2,$3,$4,$5,'placed',$6,$7,$8,$9,$10,$11,2)`,
      [orderId, auth.user.operatorId, auth.user.id, store.id, orderNumber, slotDate, body.customer.name.trim(), body.customer.email.trim(), totalCents, totalVat, now],
    );
    for (const line of lineRows) {
      await client.query(
        `INSERT INTO order_lines (order_id, sku, name, quantity, unit_price_milli, line_total_cents, vat_rate, vat_cents, returned_quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)`,
        [orderId, line.sku, line.name, line.quantity, line.unit_price_milli, line.lineTotal, vatRate, line.vat],
      );
      await client.query(
        "UPDATE stock_lines SET on_hand = on_hand - $1, held = held - $1 WHERE store_id = $2 AND sku = $3",
        [line.quantity, store.id, line.sku],
      );
    }
    await client.query("UPDATE holds SET status = 'converted' WHERE id = $1", [hold.id]);
    const placedData = {
      number: orderNumber,
      store_id: store.id,
      hold_id: hold.id,
      slot_start_utc: slotDate.toISOString(),
      total_cents: totalCents,
      vat_cents: totalVat,
      lines: lineRows.map((line) => ({
        sku: line.sku,
        quantity: line.quantity,
        unit_price_milli: line.unit_price_milli,
        line_total_cents: line.lineTotal,
        vat_cents: line.vat,
      })),
    };
    await appendOrderEvent(client, orderId, 1, "order.placed", placedData, now, "0".repeat(64));
    await client.query("DELETE FROM cart_lines WHERE person_id = $1", [auth.user.id]);
    const orderAnswerBody = await orderAnswer(client, {
      id: orderId,
      operator_id: auth.user.operatorId,
      person_id: auth.user.id,
      store_id: store.id,
      number: orderNumber,
      status: "placed",
      slot_start_utc: slotDate,
      customer_name: body.customer.name.trim(),
      customer_email: body.customer.email.trim(),
      total_cents: totalCents,
      vat_cents: totalVat,
      created_at: now,
      next_seq: 2,
    });
    documentKey = `orders/${auth.user.operatorId}/${orderNumber}.json`;
    try {
      await storage.put(documentKey, "application/json", Buffer.from(JSON.stringify(orderAnswerBody), "utf8"));
      storedDocument = true;
    } catch {
      await client.query("ROLLBACK");
      return { error: errors.storageUnavailable() };
    }
    await rebuildOrderView(client, orderId);
    await storeRequestKey(client, auth, "POST", "/api/orders", body, requestKey, 201, orderAnswerBody);
    await client.query(
      `INSERT INTO mail_outbox (order_id, to_email, subject, body)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (order_id) DO NOTHING`,
      [
        orderId,
        body.customer.email.trim(),
        `Order ${orderNumber} confirmed: collect at ${store.name}`,
        buildMailBody(orderNumber, store.name, orderAnswerBody.slot_local_date as string, orderAnswerBody.slot_local_time as string, store.timezone, totalCents),
      ],
    );
    await client.query("COMMIT");
    return { answer: orderAnswerBody };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      void 0;
    }
    if (storedDocument) {
      try {
        await storage.delete(documentKey);
      } catch {
        void 0;
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

export function buildMailBody(number: string, storeName: string, localDate: string, localTime: string, timezone: string, totalCents: number): string {
  const amount = formatEuro(totalCents);
  return `Order ${number}\nShop: ${storeName}\nCollect on ${localDate} at ${localTime} (${timezone})\nTotal: ${amount}`;
}

export function formatEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}${whole},${String(rest).padStart(2, "0")} €`;
}

export async function isOfferedSlot(client: PoolClient, store: StoreRecord, slotDate: Date, now: Date): Promise<boolean> {
  const { loadPlans } = await import("./stores.js");
  const { localSlotsForDate: slotsFn, planForDate, localDateInZone } = await import("../time-slots.js");
  const plans = await loadPlans(client, store.id);
  const localDate = localDateInZone(store.timezone, slotDate);
  const entry = planForDate(plans.current, plans.upcoming, localDate);
  if (!entry) return false;
  const slots = slotsFn(store.timezone, localDate, entry);
  const matches = slots.some((slot) => slot.utc.getTime() === slotDate.getTime());
  if (!matches) return false;
  const lower = now.getTime() + 7200 * 1000;
  const upper = now.getTime() + 604800 * 1000;
  return slotDate.getTime() >= lower && slotDate.getTime() <= upper;
}

export async function storeRequestKey(
  client: PoolClient,
  auth: { user: { id: string; operatorId: string } },
  method: string,
  path: string,
  body: unknown,
  requestKey: string,
  status: number,
  responseBody: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO request_keys (operator_id, account_id, request_key, method, path, body_hash, in_progress, response_status, response_body)
     VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8)
     ON CONFLICT (operator_id, account_id, request_key) DO UPDATE SET in_progress = false, response_status = $7, response_body = $8`,
    [auth.user.operatorId, auth.user.id, requestKey, method, path, stableStringify(body), status, JSON.stringify(responseBody)],
  );
}

export { eventDigest };
