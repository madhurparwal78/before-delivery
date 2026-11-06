// Price lists (brief: API → Allocations and prices; Business rules → Pricing).
import { FIELD, outOfRange } from "../shared/copy";
import { CURRENCY, instantText, parseDate } from "../shared/time";
import { requireRole, staff } from "./auth";
import { nowSeconds, one, pool, rows, tx } from "./db";
import { reply, route, validationFailed } from "./http";
import { copenhagenDay, pricesInForceOn } from "./pricing";
import { type Fields, failed, requiredText } from "./validate";

const CURRENCIES = Object.values(CURRENCY);

route("GET", "/api/price-lists", "none", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, "finance_lead", "merchandiser");
  const lists = await rows<{ id: string; name: string; effective_date: string; created_at: Date }>(
    pool,
    "SELECT id, name, effective_date, created_at FROM price_lists WHERE workspace_id = $1 ORDER BY effective_date DESC, created_order DESC",
    [me.workspaceId],
  );
  const prices = await rows<{ price_list_id: string; style_number: string; currency: string; unit_price_minor: number }>(
    pool,
    "SELECT p.* FROM price_list_prices p JOIN price_lists l ON l.id = p.price_list_id WHERE l.workspace_id = $1 ORDER BY p.style_number, p.currency",
    [me.workspaceId],
  );
  const inForce = new Set((await pricesInForceOn(pool, me.workspaceId, copenhagenDay())).map((p) => p.priceListId));
  return reply(200, {
    items: lists.map((l) => ({
      id: l.id,
      name: l.name,
      effectiveDate: l.effective_date,
      prices: prices.filter((p) => p.price_list_id === l.id).map((p) => ({ styleNumber: p.style_number, currency: p.currency, unitPriceMinor: p.unit_price_minor })),
      inForce: inForce.has(l.id),
      createdAt: instantText(l.created_at.getTime()),
    })),
  });
});

route("POST", "/api/price-lists", "json", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, "finance_lead");
  const body = ctx.json();
  const fields: Fields = {};
  const name = requiredText(body.name, "name", 80, fields);
  const effective = typeof body.effectiveDate === "string" ? parseDate(body.effectiveDate) : null;
  if (body.effectiveDate === undefined || body.effectiveDate === "") fields.effectiveDate = FIELD.required;
  else if (!effective) fields.effectiveDate = FIELD.date;
  else if ((body.effectiveDate as string) < copenhagenDay()) fields.effectiveDate = FIELD.pastPriceList;
  const list = Array.isArray(body.prices) ? body.prices : [];
  if (!list.length) fields.prices = FIELD.required;
  const prices = list.map((raw, i) => {
    const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const styleNumber = requiredText(p.styleNumber, `prices.${i}.styleNumber`, 40, fields);
    const currency = typeof p.currency === "string" ? p.currency : "";
    if (!CURRENCIES.includes(currency)) fields[`prices.${i}.currency`] = "Choose one of DKK, SEK, EUR, GBP, USD or JPY.";
    const unit = p.unitPriceMinor;
    if (typeof unit !== "number" || !Number.isInteger(unit) || unit < 1 || unit > 100_000_000) fields[`prices.${i}.unitPriceMinor`] = outOfRange(1, 100_000_000);
    return { styleNumber, currency, unit: typeof unit === "number" ? unit : 0 };
  });
  if (failed(fields)) throw validationFailed(fields);
  return tx(async (db) => {
    const created = (await one<{ id: string; created_at: Date }>(
      db,
      "INSERT INTO price_lists (workspace_id, name, effective_date, created_at) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
      [me.workspaceId, name, body.effectiveDate, nowSeconds()],
    )) as { id: string; created_at: Date };
    for (const p of prices) {
      await db.query("INSERT INTO price_list_prices (price_list_id, style_number, currency, unit_price_minor) VALUES ($1, $2, $3, $4)", [created.id, p.styleNumber, p.currency, p.unit]);
    }
    return reply(201, {
      id: created.id,
      name,
      effectiveDate: body.effectiveDate as string,
      prices: prices.map((p) => ({ styleNumber: p.styleNumber, currency: p.currency, unitPriceMinor: p.unit })),
      createdAt: instantText(created.created_at.getTime()),
    });
  });
});
