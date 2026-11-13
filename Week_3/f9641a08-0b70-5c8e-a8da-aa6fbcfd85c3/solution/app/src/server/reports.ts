import type { AuditEntry, DiscountCode, GiftCardLedger, Metrics, Role } from "../shared/api";
import { audit } from "./audit";
import { sizeLabel } from "./catalogue";
import type { SessionUser } from "./auth";
import { one, rows, type Queryable, type Unit } from "./db";
import { csvText } from "./csv";
import { FIELD, fail, validation } from "./errors";
import { COLLECTIONS } from "./search";
import * as giftcards from "./giftcards";
import { roundHalfUp } from "./money";
import type { Fields } from "./validate";

// Promotions, gift card ledgers, the audit log, the dashboard figures and the CSV exports.

interface CodeRow {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  collection: string | null;
  minimum: number;
  starts_at: Date;
  ends_at: Date;
  usage_limit: number | null;
  used: number;
}

const toCode = (r: CodeRow): DiscountCode => ({ ...r, starts_at: r.starts_at.toISOString(), ends_at: r.ends_at.toISOString() });

export async function listCodes(db: Queryable): Promise<DiscountCode[]> {
  const found = await rows<CodeRow>(
    db,
    `SELECT d.code, d.kind, d.value, d.collection, d.minimum, d.starts_at, d.ends_at, d.usage_limit,
            d.used_before + (SELECT count(*) FROM orders o WHERE o.discount_code = d.code AND o.kind = 'sale' AND o.status <> 'cancelled')::int AS used
     FROM discount_codes d ORDER BY d.code`,
  );
  return found.map(toCode);
}

function when(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function createCode(u: Unit, user: SessionUser, input: Record<string, unknown>, now: Date): Promise<DiscountCode> {
  const fields: Fields = {};
  const code = typeof input.code === "string" ? input.code : "";
  if (!/^[A-Z0-9]{3,20}$/.test(code)) fields.code = FIELD.promoCode;
  else if (await one(u.db, "SELECT 1 FROM discount_codes WHERE code = $1", [code])) fields.code = FIELD.promoExists;
  const kind = input.kind === "percent" || input.kind === "fixed" ? input.kind : null;
  if (!kind) fields.kind = FIELD.promoKind;
  const value = input.value;
  const valueOk = typeof value === "number" && Number.isInteger(value) && (kind === "percent" ? value >= 1 && value <= 90 : value >= 1 && value <= 999_999);
  if (!valueOk) fields.value = FIELD.promoValue;
  const collection = input.collection === null || input.collection === undefined ? null : typeof input.collection === "string" && COLLECTIONS.includes(input.collection) && input.collection !== "all" ? input.collection : undefined;
  if (collection === undefined) fields.collection = FIELD.promoCollection;
  const minimum = input.minimum === undefined ? 0 : input.minimum;
  if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum < 0) fields.minimum = FIELD.promoMinimum;
  const starts = when(input.starts_at);
  const ends = when(input.ends_at);
  if (!starts) fields.starts_at = FIELD.promoDate;
  if (!ends) fields.ends_at = FIELD.promoDate;
  else if (starts && ends <= starts) fields.ends_at = FIELD.promoEnds;
  const limit = input.usage_limit === null || input.usage_limit === undefined ? null : input.usage_limit;
  if (limit !== null && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1)) fields.usage_limit = FIELD.promoLimit;
  if (Object.keys(fields).length > 0) throw validation(fields);
  const created: DiscountCode = {
    code,
    kind: kind ?? "percent",
    value: value as number,
    collection: collection ?? null,
    minimum: minimum as number,
    starts_at: (starts ?? now).toISOString(),
    ends_at: (ends ?? now).toISOString(),
    usage_limit: limit as number | null,
    used: 0,
  };
  await u.db.query("INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [created.code, created.kind, created.value, created.collection, created.minimum, created.starts_at, created.ends_at, created.usage_limit]);
  await audit(u, { id: user.id, role: user.role }, "created", "discount_code", code, null, created, now);
  return created;
}

export async function giftCardLedger(db: Queryable, code: string): Promise<GiftCardLedger> {
  const normalised = code.trim().toUpperCase();
  if (!(await giftcards.exists(db, normalised))) throw fail("not_found");
  const entries = await giftcards.ledger(db, normalised);
  return {
    code: normalised,
    balance: await giftcards.balanceOf(db, normalised),
    entries: entries.map((e) => ({ ...e, at: e.at.toISOString() })),
  };
}

export async function auditEntries(db: Queryable, entity: string, entityId: string): Promise<AuditEntry[]> {
  const found = await rows<{ id: string; actor_id: string; name: string; role: Role; action: string; entity: string; entity_id: string; before: unknown; after: unknown; at: Date }>(
    db,
    `SELECT a.id, a.actor_id, u.name, u.role, a.action, a.entity, a.entity_id, a.before, a.after, a.at
     FROM audit_log a JOIN users u ON u.id = a.actor_id
     WHERE ($1 = '' OR a.entity = $1) AND ($2 = '' OR a.entity_id = $2) ORDER BY a.seq DESC LIMIT 500`,
    [entity, entityId],
  );
  return found.map((a) => ({ id: a.id, actor: { id: a.actor_id, name: a.name, role: a.role }, action: a.action, entity: a.entity, entity_id: a.entity_id, before: a.before, after: a.after, at: a.at.toISOString() }));
}

// ---- dashboard figures and exports ------------------------------------------------------------

const IST_OFFSET = "+05:30";

/** `from` and `to` as YYYY-MM-DD, both days included in India Standard Time. */
function range(query: URLSearchParams): { start: Date; end: Date } {
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00${IST_OFFSET}`).getTime());
  const fields: Fields = {};
  if (!valid(from) || !valid(to) || from > to) {
    fields.from = FIELD.dateRange;
    fields.to = FIELD.dateRange;
    throw validation(fields);
  }
  const start = new Date(`${from}T00:00:00${IST_OFFSET}`);
  const end = new Date(new Date(`${to}T00:00:00${IST_OFFSET}`).getTime() + 24 * 3600 * 1000);
  return { start, end };
}

export async function metrics(db: Queryable, query: URLSearchParams): Promise<Metrics> {
  const { start, end } = range(query);
  const sales = await one<{ orders: number; gross: number; units: number }>(
    db,
    `SELECT count(*) AS orders, coalesce(sum(o.grand_total), 0) AS gross,
            coalesce(sum((SELECT sum(quantity) FROM order_lines l WHERE l.order_id = o.id)), 0) AS units
     FROM orders o WHERE o.kind = 'sale' AND o.placed_at >= $1 AND o.placed_at < $2`,
    [start, end],
  );
  const refunded = await one<{ n: number }>(db, "SELECT coalesce(sum(r.amount), 0) AS n FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.kind = 'sale' AND r.at >= $1 AND r.at < $2", [start, end]);
  const orders = sales?.orders ?? 0;
  const gross = sales?.gross ?? 0;
  const refunds = refunded?.n ?? 0;
  return { orders, gross_sales: gross, refunds, net_sales: gross - refunds, units_sold: sales?.units ?? 0, average_order_value: orders === 0 ? 0 : roundHalfUp(gross, orders) };
}

export async function ordersCsv(db: Queryable, query: URLSearchParams): Promise<string> {
  const { start, end } = range(query);
  const found = await rows<{ number: string; placed_at: Date; email: string; status: string; payment_base: string; subtotal: number; discount: number; shipping: number; tax: number; gift_card_amount: number; grand_total: number; refunded: number; id: string }>(
    db,
    `SELECT o.id, o.number, o.placed_at, u.email, o.status, o.payment_base, o.subtotal, o.discount, o.shipping, o.tax, o.gift_card_amount, o.grand_total,
            coalesce((SELECT sum(amount) FROM refunds r WHERE r.order_id = o.id), 0) AS refunded
     FROM orders o JOIN users u ON u.id = o.user_id WHERE o.placed_at >= $1 AND o.placed_at < $2 ORDER BY o.placed_at, o.number`,
    [start, end],
  );
  const header = ["order_number", "placed_at", "customer_email", "status", "payment_status", "subtotal", "discount", "shipping", "tax", "gift_card", "total", "refunded"];
  return csvText([header, ...found.map((o) => [o.number, o.placed_at.toISOString(), o.email, o.status, o.refunded <= 0 ? o.payment_base : o.refunded >= o.grand_total ? "refunded" : "partially_refunded", o.subtotal, o.discount, o.shipping, o.tax, o.gift_card_amount, o.grand_total, o.refunded])]);
}

export async function inventoryCsv(db: Queryable): Promise<string> {
  const found = await rows<{ sku: string; product: string; colour: string; size_slug: string; location: string; account: string; total: number }>(
    db,
    `SELECT v.sku, p.name AS product, v.colour, v.size_slug, loc.location, e.account, coalesce(sum(e.quantity), 0) AS total
     FROM variants v JOIN products p ON p.id = v.product_id
     CROSS JOIN (VALUES ('bhiwandi'), ('gurugram')) AS loc(location)
     LEFT JOIN stock_entries e ON e.sku = v.sku AND e.location = loc.location AND e.account IN ('available', 'reserved', 'committed')
     GROUP BY v.sku, p.name, v.colour, v.size_slug, loc.location, e.account ORDER BY v.sku COLLATE "C", loc.location`,
  );
  const table = new Map<string, { head: string[]; available: number; reserved: number; committed: number }>();
  for (const r of found) {
    const key = `${r.sku}|${r.location}`;
    const row = table.get(key) ?? { head: [r.sku, r.product, r.colour, sizeLabel(r.size_slug), r.location], available: 0, reserved: 0, committed: 0 };
    if (r.account === "available" || r.account === "reserved" || r.account === "committed") row[r.account] = r.total;
    table.set(key, row);
  }
  return csvText([
    ["sku", "product", "colour", "size", "location", "available", "reserved", "committed", "on_hand"],
    ...[...table.values()].map((r) => [...r.head, r.available, r.reserved, r.committed, r.available + r.reserved]),
  ]);
}
