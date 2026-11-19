// Orders: placement, reading, the state machine, the history and the order document.
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { type Db, one, pool, query, required, transaction } from "./db.js";
import { ApiError, FieldErrors, forbidden, invalidTransition, notFound, storageUnavailable, validationFailed } from "./errors.js";
import { type Json, byCodePoint, isRecord, isUuid } from "./json.js";
import { appendEntry, readChain, rebuildView, replay } from "./history.js";
import { HOLD_COLUMNS, type HoldRow } from "./holds.js";
import { deliverPendingMail } from "./mailer.js";
import { formatEuro } from "../shared/euro.js";
import { lineTotalCents, vatCents } from "./money.js";
import { type Answer, type KeyHandle } from "./requestKeys.js";
import { deleteObject, getObject, putObject } from "./s3.js";
import { searchTerm } from "./search.js";
import { reportStorageFailure, requireStorage } from "./storage.js";
import { consumeHeld, restock } from "./stock.js";
import { isOfferedInstant, localTimeOf, remainingPlaces, requireShop } from "./shops.js";
import { HOLD_TRANSITIONS, ORDER_TRANSITIONS, isOrderStatus } from "../shared/transitions.js";
import type { SessionUser } from "./auth.js";

const MOVES = ["picking", "ready", "collected", "cancelled"] as const;
type Move = (typeof MOVES)[number];

function isMove(value: unknown): value is Move {
  return MOVES.some((move) => move === value);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function documentKey(operatorId: string, number: string): string {
  return `orders/${operatorId}/${number}.json`;
}

interface OrderRow {
  id: string;
  operator_id: string;
  number: string;
  store_id: string;
  user_id: string;
  hold_id: string;
  slot_start_utc: Date;
  customer_name: string;
  customer_email: string;
  total_cents: number;
  vat_cents: number;
  created_at: Date;
  status: string;
  refunded_cents: number;
  store_name: string;
  timezone: string;
  vat_rate: number;
}

const ORDER_SELECT = `SELECT o.id, o.operator_id, o.number, o.store_id, o.user_id, o.hold_id, o.slot_start_utc, o.customer_name,
  o.customer_email, o.total_cents, o.vat_cents, o.created_at, v.status, v.refunded_cents, s.name AS store_name, s.timezone, s.vat_rate
  FROM orders o JOIN order_view v ON v.order_id = o.id JOIN shops s ON s.id = o.store_id`;

/** The order when this person may see it; null for an unknown id, another operator's order, or one they may not see. */
export async function loadVisibleOrder(db: Pick<Db, "query">, user: SessionUser, id: unknown): Promise<OrderRow | null> {
  if (!isUuid(id)) return null;
  const row = await one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = $1 AND o.operator_id = $2`, [id, user.operatorId]);
  if (!row) return null;
  if (user.role === "shopper" && row.user_id !== user.id) return null;
  if (user.role === "manager" && !user.shopIds.includes(row.store_id)) return null;
  return row;
}

export async function requireVisibleOrder(db: Pick<Db, "query">, user: SessionUser, id: unknown): Promise<OrderRow> {
  const row = await loadVisibleOrder(db, user, id);
  if (!row) throw notFound();
  return row;
}

async function orderObject(db: Pick<Db, "query">, row: OrderRow) {
  const lines = await query<{ sku: string; name: string; quantity: number; unit_price_milli: number; line_total_cents: number; vat_cents: number; returned_quantity: number }>(db,
    `SELECT l.sku, l.name, l.quantity, l.unit_price_milli, l.line_total_cents, l.vat_cents,
            COALESCE((SELECT sum(rl.quantity) FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                      WHERE r.order_id = l.order_id AND rl.sku = l.sku AND r.status <> 'declined'), 0)::int AS returned_quantity
     FROM order_lines l WHERE l.order_id = $1`, [row.id]);
  lines.sort((a, b) => byCodePoint(a.sku, b.sku));
  const local = localTimeOf(row, row.slot_start_utc.getTime());
  return {
    id: row.id, number: row.number, status: row.status, store_id: row.store_id, store_name: row.store_name, timezone: row.timezone,
    slot_start_utc: row.slot_start_utc.toISOString(), slot_local_date: local.date, slot_local_time: local.time,
    customer: { name: row.customer_name, email: row.customer_email },
    lines: lines.map((line) => ({ ...line, vat_rate: row.vat_rate })),
    total_cents: row.total_cents, vat_cents: row.vat_cents, refunded_cents: row.refunded_cents, created_at: row.created_at.toISOString(),
  };
}

export async function getOrder(user: SessionUser, id: string) {
  return orderObject(pool, await requireVisibleOrder(pool, user, id));
}

// ---- placement --------------------------------------------------------------------------

interface PlacementBody {
  slotMs: number;
  name: string;
  email: string;
}

function readPlacement(input: Record<string, unknown> | null): PlacementBody {
  const errors = new FieldErrors();
  const customer = isRecord(input?.customer) ? input.customer : {};
  const slot = input?.slot_start_utc;
  const slotMs = typeof slot === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(slot) ? Date.parse(slot) : Number.NaN;
  if (Number.isNaN(slotMs)) errors.add("slot_start_utc", "Pick a collection time.");
  const name = typeof customer.name === "string" ? customer.name.trim() : "";
  if (name.length < 1 || name.length > 120) errors.add("customer.name", "Give a name of 1 to 120 characters.");
  const email = typeof customer.email === "string" ? customer.email.trim() : "";
  if (!EMAIL.test(email) || email.length > 254) errors.add("customer.email", "Give a valid email address.");
  errors.throwIfAny();
  return { slotMs, name, email };
}

function confirmationBody(order: { number: string; store_name: string; slot_local_date: string; slot_local_time: string; timezone: string; total_cents: number }): string {
  return [
    `Order ${order.number}`,
    `Shop: ${order.store_name}`,
    `Collect on ${order.slot_local_date} at ${order.slot_local_time} (${order.timezone})`,
    `Total: ${formatEuro(order.total_cents)}`,
    "",
  ].join("\n");
}

export async function placeOrder(user: SessionUser, input: Record<string, unknown> | null, hold: HoldRow, now: Date, key: KeyHandle): Promise<Answer> {
  if (hold.status === "released" && hold.release_reason === "window_ended") throw new ApiError(409, "hold_expired", { hold_id: hold.id });
  if (!HOLD_TRANSITIONS[hold.status].includes("converted")) throw invalidTransition(hold.status, "converted");
  const body = readPlacement(input);
  const shop = await requireShop(pool, user, hold.store_id);
  if (!isOfferedInstant(shop, body.slotMs, now)) throw new ApiError(409, "slot_unavailable");

  let storedKey: string | null = null;
  try {
    return await transaction(async (db) => {
      const locked = await required<HoldRow>(db, `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = $1 FOR UPDATE`, [hold.id]);
      if (locked.status !== "active") throw invalidTransition(locked.status, "converted");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`slot:${shop.id}:${body.slotMs}`]);
      const [left] = await remainingPlaces(db, shop.id, [body.slotMs]);
      if (left < 1) throw new ApiError(409, "slot_unavailable");

      const held = await query<{ sku: string; quantity: number; name: string; unit_price_milli: number }>(db,
        "SELECT h.sku, h.quantity, p.name, p.unit_price_milli FROM hold_lines h JOIN products p ON p.sku = h.sku WHERE h.hold_id = $1", [hold.id]);
      held.sort((a, b) => byCodePoint(a.sku, b.sku));
      const lines = held.map((line) => ({ sku: line.sku, quantity: line.quantity }));
      const priced = held.map((line) => {
        const lineTotal = lineTotalCents(line.quantity, line.unit_price_milli);
        return { sku: line.sku, name: line.name, quantity: line.quantity, unit_price_milli: line.unit_price_milli, line_total_cents: lineTotal, vat_cents: vatCents(lineTotal, shop.vat_rate) };
      });
      const total = priced.reduce((sum, line) => sum + line.line_total_cents, 0);
      const vat = priced.reduce((sum, line) => sum + line.vat_cents, 0);

      const sequence = await required<{ order_seq: number; prefix: string }>(db,
        "UPDATE operators SET order_seq = order_seq + 1 WHERE id = $1 RETURNING order_seq, prefix", [user.operatorId]);
      const number = `${sequence.prefix}-${String(sequence.order_seq).padStart(6, "0")}`;
      const orderId = randomUUID();

      await consumeHeld(db, shop.id, lines);
      await db.query("UPDATE holds SET status = 'converted' WHERE id = $1", [hold.id]);
      await db.query("DELETE FROM cart_lines WHERE user_id = $1", [user.id]);
      await db.query("UPDATE carts SET hold_id = NULL WHERE user_id = $1", [user.id]);
      await db.query(
        `INSERT INTO orders (id, operator_id, number, store_id, user_id, hold_id, slot_start_utc, customer_name, customer_email, total_cents, vat_cents, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [orderId, user.operatorId, number, shop.id, user.id, hold.id, new Date(body.slotMs), body.name, body.email, total, vat, now]);
      for (const line of priced) {
        await db.query("INSERT INTO order_lines (order_id, sku, name, quantity, unit_price_milli, line_total_cents, vat_cents) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [orderId, line.sku, line.name, line.quantity, line.unit_price_milli, line.line_total_cents, line.vat_cents]);
      }
      const placed: Json = {
        number, store_id: shop.id, hold_id: hold.id, slot_start_utc: new Date(body.slotMs).toISOString(), total_cents: total, vat_cents: vat,
        lines: priced.map((line) => ({ sku: line.sku, quantity: line.quantity, unit_price_milli: line.unit_price_milli, line_total_cents: line.line_total_cents, vat_cents: line.vat_cents })),
      };
      const entry = await appendEntry(db, orderId, "order.placed", placed, now);
      await rebuildView(db, orderId, user.operatorId, [entry]);

      const order = await orderObject(db, await requireVisibleOrder(db, user, orderId));
      const text = JSON.stringify(order);
      const documentName = documentKey(user.operatorId, number);
      try {
        await putObject(documentName, Buffer.from(text, "utf8"), "application/json");
      } catch {
        reportStorageFailure();
        throw storageUnavailable();
      }
      storedKey = documentName;

      await db.query(
        "INSERT INTO mail_outbox (order_id, to_address, from_header, subject, body, next_attempt_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [orderId, body.email, config.mailFrom, `Order ${number} confirmed: collect at ${shop.name}`, confirmationBody(order), now]);
      const answer = { status: 201, text };
      await key.complete(db, answer);
      return answer;
    }).then((answer) => {
      void deliverPendingMail().catch(() => undefined);
      return answer;
    });
  } catch (error) {
    if (storedKey) await deleteObject(storedKey).catch(() => undefined);
    throw error;
  }
}

// ---- listing ----------------------------------------------------------------------------

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string" && isUuid(parsed[1])) {
      const createdAt = new Date(parsed[0]);
      if (!Number.isNaN(createdAt.getTime())) return { createdAt, id: parsed[1] };
    }
  } catch {
    return null;
  }
  return null;
}

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

export async function listOrders(user: SessionUser, params: URLSearchParams) {
  const term = searchTerm(params.get("q"));
  const errors = new FieldErrors();
  const limitRaw = params.get("limit");
  let limit = DEFAULT_PAGE;
  if (limitRaw !== null) {
    limit = /^\d+$/.test(limitRaw) ? Number(limitRaw) : Number.NaN;
    if (!(limit >= 1 && limit <= MAX_PAGE)) errors.add("limit", `Use a whole number from 1 to ${MAX_PAGE}.`);
  }
  const beforeRaw = params.get("before");
  const cursor = beforeRaw === null ? null : decodeCursor(beforeRaw);
  if (beforeRaw !== null && !cursor) errors.add("before", "Use a cursor from a previous answer.");
  const status = params.get("status");
  if (status !== null && status !== "" && !isOrderStatus(status)) errors.add("status", "Use an order status.");
  errors.throwIfAny();

  const where: string[] = ["o.operator_id = $1"];
  const values: unknown[] = [user.operatorId];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    where.push(clause.replace("?", `$${values.length}`));
  };
  if (user.role === "shopper") add("o.user_id = ?", user.id);
  if (user.role === "manager") add("o.store_id = ANY(?::text[])", user.shopIds);
  if (term !== "") {
    values.push(term);
    where.push(`(upper(o.number) = upper($${values.length}) OR lower(o.customer_email) = lower($${values.length}))`);
  }
  const shopId = params.get("store_id");
  if (shopId) add("o.store_id = ?", shopId);
  if (status) add("v.status = ?", status);
  const countRow = await required<{ n: number }>(pool, `SELECT count(*)::int AS n FROM orders o JOIN order_view v ON v.order_id = o.id WHERE ${where.join(" AND ")}`, values);
  if (cursor) {
    values.push(cursor.createdAt, cursor.id);
    where.push(`(o.created_at, o.id) < ($${values.length - 1}, $${values.length})`);
  }
  values.push(limit + 1);
  const rows = await query<{ id: string; number: string; status: string; store_id: string; store_name: string; slot_start_utc: Date; total_cents: number; customer_email: string; created_at: Date }>(pool,
    `SELECT o.id, o.number, v.status, o.store_id, s.name AS store_name, o.slot_start_utc, o.total_cents, o.customer_email, o.created_at
     FROM orders o JOIN order_view v ON v.order_id = o.id JOIN shops s ON s.id = o.store_id
     WHERE ${where.join(" AND ")} ORDER BY o.created_at DESC, o.id DESC LIMIT $${values.length}`, values);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    count: countRow.n,
    orders: page.map((row) => ({
      id: row.id, number: row.number, status: row.status, store_id: row.store_id, store_name: row.store_name,
      slot_start_utc: row.slot_start_utc.toISOString(), total_cents: row.total_cents, customer_email: row.customer_email, created_at: row.created_at.toISOString(),
    })),
    next_before: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

// ---- document, events, replay -----------------------------------------------------------

export async function orderDocument(user: SessionUser, id: string): Promise<Buffer> {
  const row = await requireVisibleOrder(pool, user, id);
  requireStorage();
  let stored: Buffer | null;
  try {
    stored = await getObject(documentKey(row.operator_id, row.number));
  } catch {
    reportStorageFailure();
    throw storageUnavailable();
  }
  if (!stored) throw notFound();
  return stored;
}

/** Lead, care and the shop's managers may read an order's history; a shopper may not. */
function requireHistoryReader(user: SessionUser): void {
  if (user.role === "shopper") throw forbidden();
}

export async function orderHistory(user: SessionUser, id: string) {
  const row = await requireVisibleOrder(pool, user, id);
  requireHistoryReader(user);
  return { order_id: row.id, events: await readChain(pool, row.id) };
}

export async function orderReplay(user: SessionUser, id: string) {
  const row = await requireVisibleOrder(pool, user, id);
  requireHistoryReader(user);
  const state = replay(await readChain(pool, row.id));
  return { order_id: row.id, status: state.status, last_seq: state.last_seq, total_cents: state.total_cents, refunded_cents: state.refunded_cents, returns: state.returns };
}

// ---- transitions ------------------------------------------------------------------------

export async function transitionOrder(user: SessionUser, id: string, input: Record<string, unknown> | null, now: Date) {
  const row = await requireVisibleOrder(pool, user, id);
  const target = input?.to;
  const mayCancel = user.role === "care" || (user.role === "manager" && user.shopIds.includes(row.store_id));
  const mayMove = user.role === "manager" && user.shopIds.includes(row.store_id);
  if (!(mayMove || (mayCancel && target === "cancelled"))) throw forbidden();
  if (!isMove(target)) throw validationFailed({ to: "Use picking, ready, collected or cancelled." });
  await transaction(async (db) => {
    await db.query("SELECT 1 FROM order_view WHERE order_id = $1 FOR UPDATE", [row.id]);
    const chain = await readChain(db, row.id);
    const current = replay(chain).status;
    if (!ORDER_TRANSITIONS[current].includes(target)) throw invalidTransition(current, target);
    if (target === "cancelled") {
      await restock(db, row.store_id, await query<{ sku: string; quantity: number }>(db, "SELECT sku, quantity FROM order_lines WHERE order_id = $1", [row.id]));
    }
    const entry = await appendEntry(db, row.id, `order.${target}`, { from: current, to: target, by: user.id }, now);
    await rebuildView(db, row.id, row.operator_id, [...chain, entry]);
  });
  return orderObject(pool, await requireVisibleOrder(pool, user, id));
}

// ---- estate review ----------------------------------------------------------------------

const REVIEW_WINDOW_SECONDS = 86_400;

export async function estateReview(user: SessionUser, now: Date) {
  if (user.role !== "lead") throw forbidden();
  const end = now;
  const start = new Date(end.getTime() - REVIEW_WINDOW_SECONDS * 1000);
  const rows = await query<{ seq: number; at: Date; order_id: string; order_number: string; store_id: string; type: string }>(pool,
    `SELECT e.seq, e.at, e.order_id, o.number AS order_number, o.store_id, e.type
     FROM order_events e JOIN orders o ON o.id = e.order_id
     WHERE o.operator_id = $1 AND e.at >= $2 AND e.at <= $3 ORDER BY e.at, e.order_id, e.seq`, [user.operatorId, start, end]);
  return {
    window_start: start.toISOString(), window_end: end.toISOString(),
    events: rows.map((row) => ({ seq: row.seq, at: row.at.toISOString(), order_id: row.order_id, order_number: row.order_number, store_id: row.store_id, type: row.type })),
  };
}
