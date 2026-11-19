// Returns of collected orders: requested, received (units back on the shelf), settled (refunded) or declined.
import { randomUUID } from "node:crypto";
import { type Db, one, pool, query, required, transaction } from "./db.js";
import { FieldErrors, forbidden, invalidTransition, notFound, storageUnavailable, validationFailed } from "./errors.js";
import { type Json, byCodePoint, isRecord, isUuid } from "./json.js";
import { appendEntry, readChain, rebuildView, replay } from "./history.js";
import { refundCents } from "./money.js";
import { getObject, putObject } from "./s3.js";
import { reportStorageFailure, requireStorage } from "./storage.js";
import { restock } from "./stock.js";
import { RETURN_TRANSITIONS } from "../shared/transitions.js";
import { requireShopManager, requireShop } from "./shops.js";
import { loadVisibleOrder, requireVisibleOrder } from "./orders.js";
import type { SessionUser } from "./auth.js";

const MOVES = ["received", "settled", "declined"] as const;
type Move = (typeof MOVES)[number];

function isMove(value: unknown): value is Move {
  return MOVES.some((move) => move === value);
}

interface ReturnRow {
  id: string;
  order_id: string;
  number: string;
  status: string;
  reason: string;
  refund_cents: number;
  created_at: Date;
}

async function returnObject(db: Pick<Db, "query">, row: ReturnRow) {
  const lines = await query<{ sku: string; quantity: number; refund_cents: number }>(db,
    "SELECT sku, quantity, refund_cents FROM return_lines WHERE return_id = $1", [row.id]);
  lines.sort((a, b) => byCodePoint(a.sku, b.sku));
  return {
    id: row.id, number: row.number, order_id: row.order_id, status: row.status, lines,
    refund_cents: row.refund_cents, reason: row.reason, created_at: row.created_at.toISOString(),
  };
}

const RETURN_SELECT = "SELECT id, order_id, number, status, reason, refund_cents, created_at FROM returns";

export async function requestReturn(user: SessionUser, orderId: string, input: Record<string, unknown> | null, now: Date) {
  const order = await requireVisibleOrder(pool, user, orderId);
  requireShopManager(user, order.store_id);
  const errors = new FieldErrors();
  const reason = typeof input?.reason === "string" ? input.reason : "";
  if (reason.length < 1 || reason.length > 200) errors.add("reason", "Give a reason of 1 to 200 characters.");
  const asked: { sku: string; quantity: number }[] = [];
  if (!Array.isArray(input?.lines) || input.lines.length === 0) errors.add("lines", "Choose at least one line to return.");
  else {
    input.lines.forEach((entry: unknown, index) => {
      const item = isRecord(entry) ? entry : {};
      if (typeof item.sku !== "string") errors.add(`lines.${index}.sku`, "Name an item of the order.");
      if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity < 1) errors.add(`lines.${index}.quantity`, "Use a whole number of 1 or more.");
      if (typeof item.sku === "string" && typeof item.quantity === "number") asked.push({ sku: item.sku, quantity: item.quantity });
    });
  }
  errors.throwIfAny();

  const created = await transaction(async (db) => {
    await db.query("SELECT 1 FROM order_view WHERE order_id = $1 FOR UPDATE", [order.id]);
    const chain = await readChain(db, order.id);
    const current = replay(chain).status;
    if (current !== "collected") throw invalidTransition(current, "requested");
    const lines = await query<{ sku: string; quantity: number; unit_price_milli: number; line_total_cents: number }>(db,
      "SELECT sku, quantity, unit_price_milli, line_total_cents FROM order_lines WHERE order_id = $1", [order.id]);
    const returned = await query<{ sku: string; quantity: number; refund_cents: number }>(db,
      `SELECT rl.sku, sum(rl.quantity)::int AS quantity, sum(rl.refund_cents)::int AS refund_cents FROM return_lines rl
       JOIN returns r ON r.id = rl.return_id WHERE r.order_id = $1 AND r.status <> 'declined' GROUP BY rl.sku`, [order.id]);
    const lineErrors = new FieldErrors();
    const priced = asked.map((item, index) => {
      const line = lines.find((candidate) => candidate.sku === item.sku);
      const before = returned.find((candidate) => candidate.sku === item.sku) ?? { sku: item.sku, quantity: 0, refund_cents: 0 };
      if (!line) {
        lineErrors.add(`lines.${index}.sku`, "That item is not on the order.");
        return { sku: item.sku, quantity: item.quantity, refund_cents: 0 };
      }
      if (item.quantity > line.quantity - before.quantity) lineErrors.add(`lines.${index}.quantity`, "More than can be returned.");
      return {
        sku: item.sku, quantity: item.quantity,
        refund_cents: refundCents({ quantity: line.quantity, unitPriceMilli: line.unit_price_milli, lineTotalCents: line.line_total_cents },
          { quantity: before.quantity, refundCents: before.refund_cents }, item.quantity),
      };
    });
    lineErrors.throwIfAny();
    const sequence = (await required<{ n: number }>(db, "SELECT count(*)::int AS n FROM returns WHERE order_id = $1", [order.id])).n + 1;
    const id = randomUUID();
    const number = `${order.number}-R${sequence}`;
    const refund = priced.reduce((sum, line) => sum + line.refund_cents, 0);
    await db.query("INSERT INTO returns (id, order_id, number, seq, status, reason, refund_cents, created_at) VALUES ($1, $2, $3, $4, 'requested', $5, $6, $7)",
      [id, order.id, number, sequence, reason, refund, now]);
    for (const line of priced) {
      await db.query("INSERT INTO return_lines (return_id, sku, quantity, refund_cents) VALUES ($1, $2, $3, $4)", [id, line.sku, line.quantity, line.refund_cents]);
    }
    const data: Json = { return_id: id, number, refund_cents: refund, lines: priced.map((line) => ({ sku: line.sku, quantity: line.quantity, refund_cents: line.refund_cents })) };
    const entry = await appendEntry(db, order.id, "return.requested", data, now);
    await rebuildView(db, order.id, order.operator_id, [...chain, entry]);
    return id;
  });
  return returnObject(pool, await required<ReturnRow>(pool, `${RETURN_SELECT} WHERE id = $1`, [created]));
}

export async function listReturns(user: SessionUser, shopId: string | null) {
  if (user.role !== "lead" && user.role !== "manager") throw forbidden();
  if (shopId) {
    await requireShop(pool, user, shopId);
    if (user.role === "manager" && !user.shopIds.includes(shopId)) throw notFound();
  }
  const rows = await query<ReturnRow>(pool,
    `SELECT r.id, r.order_id, r.number, r.status, r.reason, r.refund_cents, r.created_at FROM returns r JOIN orders o ON o.id = r.order_id
     WHERE o.operator_id = $1 AND ($2::text IS NULL OR o.store_id = $2) AND ($3::text[] IS NULL OR o.store_id = ANY($3))
     ORDER BY r.created_at DESC, r.id DESC`, [user.operatorId, shopId, user.role === "manager" ? user.shopIds : null]);
  return { returns: await Promise.all(rows.map((row) => returnObject(pool, row))) };
}

async function visibleReturn(user: SessionUser, id: string) {
  const row = isUuid(id) ? await one<ReturnRow>(pool, `${RETURN_SELECT} WHERE id = $1`, [id]) : null;
  const order = row ? await loadVisibleOrder(pool, user, row.order_id) : null;
  if (!row || !order) throw notFound();
  return { row, order };
}

export async function transitionReturn(user: SessionUser, id: string, input: Record<string, unknown> | null, now: Date) {
  const { row, order } = await visibleReturn(user, id);
  requireShopManager(user, order.store_id);
  const target = input?.to;
  if (!isMove(target)) throw validationFailed({ to: "Use received, settled or declined." });
  await transaction(async (db) => {
    await db.query("SELECT 1 FROM order_view WHERE order_id = $1 FOR UPDATE", [order.id]);
    const chain = await readChain(db, order.id);
    const current = replay(chain).returns.find((item) => item.id === row.id)?.status ?? "requested";
    if (!RETURN_TRANSITIONS[current].includes(target)) throw invalidTransition(current, target);
    if (target === "received") {
      await restock(db, order.store_id, await query<{ sku: string; quantity: number }>(db, "SELECT sku, quantity FROM return_lines WHERE return_id = $1", [row.id]));
    }
    await db.query("UPDATE returns SET status = $2 WHERE id = $1", [row.id, target]);
    const entry = await appendEntry(db, order.id, `return.${target}`, { return_id: row.id, from: current, to: target, by: user.id }, now);
    await rebuildView(db, order.id, order.operator_id, [...chain, entry]);
  });
  return returnObject(pool, await required<ReturnRow>(pool, `${RETURN_SELECT} WHERE id = $1`, [row.id]));
}

/** The label text, written to storage the first time it is asked for and read back unchanged ever after. */
export async function returnLabel(user: SessionUser, id: string): Promise<string> {
  const { row, order } = await visibleReturn(user, id);
  requireShopManager(user, order.store_id);
  requireStorage();
  const key = `returns/${order.operator_id}/${row.number}.txt`;
  try {
    return await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`label:${row.id}`]);
      const stored = await getObject(key);
      if (stored) return stored.toString("utf8");
      const lines = await query<{ sku: string; name: string; quantity: number }>(db,
        "SELECT rl.sku, p.name, rl.quantity FROM return_lines rl JOIN products p ON p.sku = rl.sku WHERE rl.return_id = $1", [row.id]);
      lines.sort((a, b) => byCodePoint(a.sku, b.sku));
      const text = [`Tramela return ${row.number}`, `Order ${order.number}`, `Shop ${order.store_name}`,
        ...lines.map((line) => `${line.quantity} x ${line.sku} ${line.name}`), ""].join("\n");
      await putObject(key, Buffer.from(text, "utf8"), "text/plain; charset=utf-8");
      return text;
    });
  } catch {
    reportStorageFailure();
    throw storageUnavailable();
  }
}
