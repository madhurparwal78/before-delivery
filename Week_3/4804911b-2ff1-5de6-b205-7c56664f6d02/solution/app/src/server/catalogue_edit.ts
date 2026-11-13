import type { DrinkSummary, HistoryEntry, PackFacts, SkuSummary } from "../shared/types.js";
import { COPY } from "../shared/copy.js";
import { isRealDay, nowIso, today } from "./clock.js";
import { parseBatchCode } from "./batchcode.js";
import { db, tx } from "./db.js";
import { ApiError, notFound, validation } from "./errors.js";
import { exclusive, PRICE_HISTORY } from "./locks.js";
import { searchChanged } from "./outbox.js";
import { bookChanged, loadBook, packFacts, qualifyingNotice } from "./pricing.js";
import { codePoints } from "./rules.js";
import { catalogue, skuSummary } from "./views.js";

function cleanName(raw: unknown, field: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || codePoints(name) > 80) throw validation({ [field]: "Use 1 to 80 characters." });
  return name;
}

const body = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});

export function renameDrink(id: string, raw: unknown): Promise<DrinkSummary> {
  return exclusive("names", async () => {
    await tx(async (q) => {
      const drink = (await q.query("SELECT * FROM drinks WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!drink) throw notFound();
      const name = cleanName(body(raw).name, "name");
      const clash = await q.query("SELECT 1 FROM drinks WHERE id <> $1 AND lower(name) = lower($2)", [id, name]);
      if (clash.rows.length) throw new ApiError(409, "name_taken", "Another drink already has that name.");
      if (name === drink.name) return;
      await q.query("UPDATE drinks SET name = $2 WHERE id = $1", [id, name]);
      const skus = (await q.query("SELECT code FROM skus WHERE drink_id = $1 ORDER BY position", [id])).rows.map((s) => s.code as string);
      for (const code of skus)
        await q.query("INSERT INTO sku_history (sku_code, at, field, from_value, to_value) VALUES ($1,$2,'drink_name',$3,$4)", [code, nowIso(), drink.name, name]);
      await searchChanged(q, skus);
    });
    bookChanged();
    const view = catalogue(await loadBook(db), today()).drinks.find((d) => d.id === id)!;
    return view;
  });
}

export function renameSku(code: string, raw: unknown): Promise<SkuSummary> {
  return exclusive("names", async () => {
    await tx(async (q) => {
      const sku = (await q.query("SELECT * FROM skus WHERE code = $1 FOR UPDATE", [code])).rows[0];
      if (!sku) throw notFound();
      const variant = cleanName(body(raw).variant, "variant");
      if (variant === sku.variant) return;
      await q.query("UPDATE skus SET variant = $2 WHERE code = $1", [code, variant]);
      await q.query("INSERT INTO sku_history (sku_code, at, field, from_value, to_value) VALUES ($1,$2,'variant',$3,$4)", [code, nowIso(), sku.variant, variant]);
      await searchChanged(q, [code]);
    });
    bookChanged();
    const book = await loadBook(db);
    return skuSummary(book, today(), book.bySku.get(code)!);
  });
}

export async function skuHistory(code: string): Promise<HistoryEntry[]> {
  if (!(await db.query("SELECT 1 FROM skus WHERE code = $1", [code])).rows.length) throw notFound();
  return (await db.query("SELECT * FROM sku_history WHERE sku_code = $1 ORDER BY id", [code])).rows.map((h) => ({
    at: (h.at as Date).toISOString(), field: h.field as HistoryEntry["field"], from: h.from_value as string, to: h.to_value as string,
  }));
}

/** Registers a batch; an old-wrapper batch needs a notice whose run-out window holds its packed date, decided under the price-history lock. */
export function registerBatch(raw: unknown): Promise<PackFacts> {
  const b = body(raw);
  return exclusive(PRICE_HISTORY, async () => {
    const book = await loadBook(db);
    if (typeof b.skuCode !== "string") throw validation({ skuCode: "Choose a pack." });
    if (!book.bySku.has(b.skuCode)) throw notFound();
    const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
    if (book.batches.some((x) => x.code === code)) throw new ApiError(409, "batch_exists", "That batch is already registered.");
    const parsed = parseBatchCode(code);
    if (!parsed || !isRealDay(parsed.packedDate) || parsed.packedDate > today()) throw validation({ code: "Use a batch code like NSK-260915-07 packed on or before today." });
    if (b.oldWrapper !== undefined && typeof b.oldWrapper !== "boolean") throw validation({ oldWrapper: "Old wrapper is true or false." });
    const oldWrapper = b.oldWrapper === true;
    if (oldWrapper && !qualifyingNotice(book, b.skuCode, parsed.packedDate)) throw new ApiError(422, "wrapper_window_closed", COPY.closedWrapper);
    await db.query("INSERT INTO batches (code, sku_code, packed_date, old_wrapper) VALUES ($1,$2,$3,$4)", [code, b.skuCode, parsed.packedDate, oldWrapper]);
    bookChanged();
    const fresh = await loadBook(db);
    return packFacts(fresh, today(), fresh.batches.find((x) => x.code === code)!);
  });
}
