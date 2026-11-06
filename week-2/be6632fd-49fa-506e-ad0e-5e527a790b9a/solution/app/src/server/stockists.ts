// The stockist directory (brief: Business rules → Stockist directory). Danish ordering is decided by `danish`.
import { COPY } from "../shared/copy";
import { CITY, CURRENCY, type Market, instantText } from "../shared/time";
import { type Member, requireRole, staff } from "./auth";
import { type Db, nowSeconds, one, pool, rows, tx } from "./db";
import { ApiError, type Json, notFound, reply, route, validationFailed } from "./http";
import { csvReply } from "./csv";
import { checkEmail, checkMarket, failed, type Fields, isUuid, optionalText, requiredText } from "./validate";

/** Danish alphabetical order: æ, ø and å after z, and a double a sorted as å. */
export const danish = new Intl.Collator("da");

interface StockistRow {
  id: string;
  workspace_id: string;
  name: string;
  market: Market;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_erased: boolean;
  notes: string;
  archived_at: Date | null;
  created_at: Date;
}

function byDanishName(a: StockistRow, b: StockistRow): number {
  return danish.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function stockistJson(s: StockistRow): Json {
  return {
    id: s.id,
    name: s.name,
    market: s.market,
    city: CITY[s.market],
    currency: CURRENCY[s.market],
    contactName: s.contact_name,
    contactEmail: s.contact_email,
    contactPhone: s.contact_phone,
    contactErased: s.contact_erased,
    notes: s.notes,
    status: s.archived_at ? "archived" : "active",
    archivedAt: s.archived_at ? instantText(s.archived_at.getTime()) : null,
    createdAt: instantText(s.created_at.getTime()),
  };
}

function buyerJson(s: StockistRow): Json {
  return { id: s.id, name: s.name, market: s.market, city: CITY[s.market], currency: CURRENCY[s.market] };
}

/** A stockist the caller may see (step 5): same workspace, active unless `archived`, and a buyer's own store only. */
export async function visibleStockist(db: Db, me: Member, id: string, archived = false): Promise<StockistRow> {
  const found = isUuid(id) ? await one<StockistRow>(db, "SELECT * FROM stockists WHERE id = $1 AND workspace_id = $2", [id, me.workspaceId]) : undefined;
  if (!found || Boolean(found.archived_at) !== archived) throw notFound();
  if (me.role === "stockist_buyer" && me.stockistId !== found.id) throw notFound();
  return found;
}

const READERS = ["merchandiser", "finance_lead", "launch_producer", "stockist_buyer"] as const;

function encodeCursor(s: StockistRow): string {
  return Buffer.from(JSON.stringify([s.name, s.id])).toString("base64url");
}

function decodeCursor(text: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string" ? [value[0], value[1]] : null;
  } catch {
    return null;
  }
}

route("GET", "/api/stockists", "none", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, ...READERS);
  if (me.role === "stockist_buyer") {
    const own = await rows<StockistRow>(pool, "SELECT * FROM stockists WHERE id = $1 AND archived_at IS NULL", [me.stockistId]);
    return reply(200, { items: own.map(buyerJson), nextCursor: null });
  }
  const fields: Fields = {};
  const limitText = ctx.query("limit");
  const limit = limitText === null || limitText === "" ? 25 : /^\d+$/.test(limitText) && Number(limitText) >= 1 ? Math.min(50, Number(limitText)) : 0;
  if (!limit) fields.limit = "Enter a whole number from 1 to 50.";
  const cursorText = ctx.query("cursor");
  const cursor = cursorText ? decodeCursor(cursorText) : null;
  if (cursorText && !cursor) fields.cursor = "Start again from the first page.";
  if (failed(fields)) throw validationFailed(fields);
  const archived = ctx.query("archived") === "true";
  const q = (ctx.query("q") ?? "").trim().toLowerCase();
  const all = (await rows<StockistRow>(pool, `SELECT * FROM stockists WHERE workspace_id = $1 AND archived_at IS ${archived ? "NOT NULL" : "NULL"}`, [me.workspaceId]))
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .sort(byDanishName);
  const after = cursor ? all.filter((s) => (danish.compare(s.name, cursor[0]) || (s.id < cursor[1] ? -1 : s.id > cursor[1] ? 1 : 0)) > 0) : all;
  const page = after.slice(0, limit);
  return reply(200, { items: page.map(stockistJson), nextCursor: after.length > limit ? encodeCursor(page[page.length - 1]) : null });
});

route("POST", "/api/stockists", "json", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, "merchandiser");
  const body = ctx.json();
  const fields: Fields = {};
  const name = requiredText(body.name, "name", 120, fields);
  const market = checkMarket(body.market, "market", fields);
  const contactName = optionalText(body.contactName, "contactName", 80, fields);
  const contactEmail = body.contactEmail === undefined || body.contactEmail === null || body.contactEmail === "" ? "" : checkEmail(body.contactEmail, "contactEmail", fields);
  const contactPhone = optionalText(body.contactPhone, "contactPhone", 40, fields);
  const notes = optionalText(body.notes, "notes", 500, fields);
  if (failed(fields)) throw validationFailed(fields);
  const created = (await one<StockistRow>(
    pool,
    "INSERT INTO stockists (workspace_id, name, market, contact_name, contact_email, contact_phone, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
    [me.workspaceId, name, market, contactName || null, contactEmail || null, contactPhone || null, notes, nowSeconds()],
  )) as StockistRow;
  return reply(201, stockistJson(created));
});

route("GET", "/api/stockists.csv", "none", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, "merchandiser", "finance_lead", "launch_producer");
  const all = (await rows<StockistRow>(pool, "SELECT * FROM stockists WHERE workspace_id = $1 AND archived_at IS NULL", [me.workspaceId])).sort(byDanishName);
  return csvReply(
    [
      ["Name", "Market", "City", "Currency", "Contact name", "Contact email", "Contact phone"],
      ...all.map((s) => [s.name, s.market, CITY[s.market], CURRENCY[s.market], s.contact_erased ? COPY.erased : s.contact_name, s.contact_email, s.contact_phone]),
    ],
    "stockists.csv",
  );
});

route("GET", "/api/stockists/{id}", "none", async (ctx) => {
  const me = await staff(ctx);
  const s = await visibleStockist(pool, me, ctx.params.id);
  requireRole(me, ...READERS);
  return reply(200, me.role === "stockist_buyer" ? buyerJson(s) : stockistJson(s));
});

route("POST", "/api/stockists/{id}/archive", "none", async (ctx) => {
  const me = await staff(ctx);
  const s = await visibleStockist(pool, me, ctx.params.id);
  requireRole(me, "merchandiser");
  const done = (await one<StockistRow>(pool, "UPDATE stockists SET archived_at = $2 WHERE id = $1 RETURNING *", [s.id, nowSeconds()])) as StockistRow;
  return reply(200, stockistJson(done));
});

route("POST", "/api/stockists/{id}/restore", "none", async (ctx) => {
  const me = await staff(ctx);
  const found = isUuid(ctx.params.id) ? await one<StockistRow>(pool, "SELECT * FROM stockists WHERE id = $1 AND workspace_id = $2", [ctx.params.id, me.workspaceId]) : undefined;
  if (!found || (me.role === "stockist_buyer" && me.stockistId !== found.id)) throw notFound();
  requireRole(me, "merchandiser");
  if (!found.archived_at) throw new ApiError(409, "stockist_active", COPY.stockistActive);
  const done = (await one<StockistRow>(pool, "UPDATE stockists SET archived_at = NULL WHERE id = $1 RETURNING *", [found.id])) as StockistRow;
  return reply(200, stockistJson(done));
});

route("POST", "/api/stockists/{id}/erase-contact", "none", async (ctx) => {
  const me = await staff(ctx);
  const s = await visibleStockist(pool, me, ctx.params.id);
  requireRole(me, "merchandiser");
  return tx(async (db) => {
    if (s.contact_email) await db.query("DELETE FROM outbox WHERE delivered_at IS NULL AND lower(to_email) = lower($1)", [s.contact_email]);
    const done = (await one<StockistRow>(
      db,
      "UPDATE stockists SET contact_name = NULL, contact_email = NULL, contact_phone = NULL, contact_erased = true WHERE id = $1 RETURNING *",
      [s.id],
    )) as StockistRow;
    return reply(200, stockistJson(done));
  });
});
