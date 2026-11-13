import { COPY } from "../shared/copy.js";
import type { Format, NoticeRef, PackFacts, UnitSalePrice } from "../shared/types.js";
import { addDays } from "./clock.js";
import { db, type Queryable, type Row } from "./db.js";

export interface SkuRec {
  code: string; drinkId: string; drinkName: string; variant: string; name: string; format: Format; sizeMl: number;
  shelfDays: number; launchMrpPaise: number; sugarMgPer100ml: number;
}
export interface BatchRec { code: string; skuCode: string; packedDate: string; oldWrapper: boolean }
export interface BookRow {
  skuCode: string; name: string; kind: "sticker" | "new_print"; oldMrpPaise: number; revisedMrpPaise: number;
  oldRate: number | null; newRate: number | null; ceilingPaise: number | null;
}
export interface BookNotice { number: string; version: number; effectiveDate: string; runOutUntil: string | null; rows: BookRow[] }
export interface DrinkRec { id: string; name: string; carbonated: boolean }
export interface Book { drinks: DrinkRec[]; skus: SkuRec[]; bySku: Map<string, SkuRec>; batches: BatchRec[]; notices: BookNotice[] }

// One process owns each database, so the book can be kept until a write in this process changes it.
let generation = 0;
let cached: Promise<Book> | null = null;

/** Called after every committed change to drinks, SKUs, batches or notices. */
export function bookChanged(): void {
  generation++;
  cached = null;
}

/** The catalogue and price history as they stand. Inside a transaction (any client but the pool) it is read fresh. */
export function loadBook(q: Queryable): Promise<Book> {
  if (q !== db) return readBook(q);
  if (cached) return cached;
  const started = generation;
  const reading = readBook(q);
  cached = reading;
  reading.then(
    () => {
      if (generation !== started && cached === reading) cached = null;
    },
    () => {
      if (cached === reading) cached = null;
    },
  );
  return reading;
}

async function readBook(q: Queryable): Promise<Book> {
  const drinkRows = await q.query("SELECT id, name, carbonated FROM drinks ORDER BY position");
  const skuRows = await q.query("SELECT s.*, d.name AS drink_name, d.sugar_mg_per_100ml FROM skus s JOIN drinks d ON d.id = s.drink_id ORDER BY s.position");
  const batchRows = await q.query("SELECT * FROM batches ORDER BY packed_date, code");
  const noticeRows = await q.query(`SELECT v.number, v.version, v.effective_date, v.run_out_until FROM notice_versions v
             WHERE v.version = (SELECT max(version) FROM notice_versions WHERE number = v.number)`);
  const rowRows = await q.query(`SELECT r.* FROM notice_rows r WHERE r.version = (SELECT max(version) FROM notice_versions WHERE number = r.number)
             ORDER BY r.number, r.position`);
  const skus = skuRows.rows.map(skuFromRow);
  const rowsByNotice = new Map<string, BookRow[]>();
  for (const r of rowRows.rows) {
    const list = rowsByNotice.get(r.number as string) ?? [];
    list.push(bookRow(r));
    rowsByNotice.set(r.number as string, list);
  }
  return {
    drinks: drinkRows.rows.map((d) => ({ id: d.id as string, name: d.name as string, carbonated: d.carbonated as boolean })),
    skus,
    bySku: new Map(skus.map((s) => [s.code, s])),
    batches: batchRows.rows.map((b) => ({ code: b.code as string, skuCode: b.sku_code as string, packedDate: b.packed_date as string, oldWrapper: b.old_wrapper as boolean })),
    notices: noticeRows.rows.map((n) => ({
      number: n.number as string, version: n.version as number, effectiveDate: n.effective_date as string,
      runOutUntil: (n.run_out_until as string | null) ?? null, rows: rowsByNotice.get(n.number as string) ?? [],
    })),
  };
}

function skuFromRow(r: Row): SkuRec {
  const variant = r.variant as string;
  const drinkName = r.drink_name as string;
  return {
    code: r.code as string, drinkId: r.drink_id as string, drinkName, variant, name: `${drinkName} ${variant}`,
    format: r.format as Format, sizeMl: r.size_ml as number, shelfDays: r.shelf_days as number,
    launchMrpPaise: r.launch_mrp_paise as number, sugarMgPer100ml: r.sugar_mg_per_100ml as number,
  };
}

function bookRow(r: Row): BookRow {
  return {
    skuCode: r.sku_code as string, name: r.name as string, kind: r.kind as "sticker" | "new_print",
    oldMrpPaise: r.old_mrp_paise as number, revisedMrpPaise: r.revised_mrp_paise as number,
    oldRate: (r.old_rate as number | null) ?? null, newRate: (r.new_rate as number | null) ?? null,
    ceilingPaise: (r.ceiling_paise as number | null) ?? null,
  };
}

interface Edition { effectiveDate: string; mrpPaise: number; source: NoticeRef | null }

function editionsOf(book: Book, sku: SkuRec, excludeNumber?: string): Edition[] {
  const list: Edition[] = [{ effectiveDate: "", mrpPaise: sku.launchMrpPaise, source: null }];
  for (const n of book.notices) {
    if (n.number === excludeNumber) continue;
    for (const r of n.rows) if (r.skuCode === sku.code) list.push({ effectiveDate: n.effectiveDate, mrpPaise: r.revisedMrpPaise, source: { number: n.number, version: n.version } });
  }
  return list.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

const newestOnOrBefore = (editions: Edition[], day: string): Edition => {
  let found = editions[0]!;
  for (const e of editions) if (e.effectiveDate <= day) found = e;
  return found;
};

/** The print in force on the day before `effectiveDate`, ignoring the notice being priced. */
export const oldMrpFor = (book: Book, skuCode: string, effectiveDate: string, excludeNumber?: string): number =>
  newestOnOrBefore(editionsOf(book, book.bySku.get(skuCode)!, excludeNumber), addDays(effectiveDate, -1)).mrpPaise;

/** floor(old MRP x (100 + new rate) / (100 + old rate)) in exact integer paise. */
export const ceilingFor = (oldMrpPaise: number, oldRate: number, newRate: number): number =>
  Math.floor((oldMrpPaise * (100 + newRate)) / (100 + oldRate));

export const currentEdition = (book: Book, today: string, skuCode: string): { mrpPaise: number; effectiveDate: string; source: NoticeRef | null } =>
  newestOnOrBefore(editionsOf(book, book.bySku.get(skuCode)!), today);

/** The newest notice whose latest version stickers this SKU and whose run-out window holds the packed date. */
export function qualifyingNotice(book: Book, skuCode: string, packedDate: string): BookNotice | null {
  let best: BookNotice | null = null;
  for (const n of book.notices) {
    if (!n.runOutUntil || !n.rows.some((r) => r.skuCode === skuCode && r.kind === "sticker")) continue;
    if (packedDate < n.effectiveDate || packedDate > n.runOutUntil) continue;
    if (!best || n.effectiveDate > best.effectiveDate) best = n;
  }
  return best;
}

interface Decision {
  printDate: string;
  printedMrpPaise: number;
  printSource: NoticeRef | null;
  revisedMrpPaise: number | null;
  stickerSource: NoticeRef | null;
  wrapperNotice: BookNotice | null;
}

/** The one price decision: a function of SKU, batch print date and today. */
function decide(book: Book, today: string, skuCode: string, packedDate: string, oldWrapper: boolean): Decision {
  const wrapperNotice = oldWrapper ? qualifyingNotice(book, skuCode, packedDate) : null;
  const printDate = wrapperNotice ? addDays(wrapperNotice.effectiveDate, -1) : packedDate;
  const printed = newestOnOrBefore(editionsOf(book, book.bySku.get(skuCode)!), printDate);
  let sticker: { effectiveDate: string; mrpPaise: number; source: NoticeRef } | null = null;
  for (const n of book.notices) {
    if (n.effectiveDate <= printDate || n.effectiveDate > today) continue;
    const row = n.rows.find((r) => r.skuCode === skuCode && r.kind === "sticker");
    if (row && (!sticker || n.effectiveDate > sticker.effectiveDate))
      sticker = { effectiveDate: n.effectiveDate, mrpPaise: row.revisedMrpPaise, source: { number: n.number, version: n.version } };
  }
  return {
    printDate, printedMrpPaise: printed.mrpPaise, printSource: printed.source,
    revisedMrpPaise: sticker?.mrpPaise ?? null, stickerSource: sticker?.source ?? null, wrapperNotice,
  };
}

const halfUp = (numerator: number, denominator: number): number => Math.floor((2 * numerator + denominator) / (2 * denominator));

/** Rupees per ml under 1,000 ml, per litre from there; omitted when it equals the retail price. */
export function unitSalePrice(retailPaise: number, sizeMl: number): UnitSalePrice | null {
  const perLitre = sizeMl >= 1000;
  const hundredths = perLitre ? halfUp(retailPaise * 1000, sizeMl) : halfUp(retailPaise, sizeMl);
  if (hundredths === retailPaise) return null;
  return { rupees: `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`, per: perLitre ? "litre" : "ml" };
}

export const sugarPerPack = (sku: SkuRec): number => halfUp(sku.sugarMgPer100ml * sku.sizeMl, 100);

const bestBefore = (sku: SkuRec, packedDate: string): string => addDays(packedDate, sku.shelfDays);

export function packFacts(book: Book, today: string, batch: BatchRec): PackFacts {
  const sku = book.bySku.get(batch.skuCode)!;
  const d = decide(book, today, batch.skuCode, batch.packedDate, batch.oldWrapper);
  const retail = d.revisedMrpPaise ?? d.printedMrpPaise;
  const best = bestBefore(sku, batch.packedDate);
  const past = today > best;
  return {
    batchCode: batch.code, skuCode: sku.code, drinkName: sku.drinkName, skuName: sku.name, format: sku.format, sizeMl: sku.sizeMl,
    packedDate: batch.packedDate, printDate: d.printDate, oldWrapper: batch.oldWrapper,
    wrapperNotice: d.wrapperNotice ? { number: d.wrapperNotice.number, version: d.wrapperNotice.version } : null,
    bestBeforeDate: best, printedMrpPaise: d.printedMrpPaise, revisedMrpPaise: d.revisedMrpPaise, retailPricePaise: retail,
    unitSalePrice: unitSalePrice(retail, sku.sizeMl), sugarMgPerPack: sugarPerPack(sku),
    stickerApplies: d.revisedMrpPaise !== null, stickerNote: d.revisedMrpPaise === null ? COPY.noSticker : null,
    pastBestBefore: past, dateNote: past ? COPY.pastDate : null, sourceNotice: d.stickerSource ?? d.printSource,
  };
}

/** The oldest batch of the SKU that is not past best-before, or the newest batch when every one is past. */
export function storyBatch(book: Book, today: string, skuCode: string): BatchRec {
  const sku = book.bySku.get(skuCode)!;
  const own = book.batches.filter((b) => b.skuCode === skuCode);
  return own.find((b) => today <= bestBefore(sku, b.packedDate)) ?? own[own.length - 1]!;
}

/** Registered batches the price decision would sticker from `candidate` if it were published and `day` were today. */
export function stickerBatchesFor(book: Book, candidate: BookNotice, skuCode: string): string[] {
  const hypothetical: Book = { ...book, notices: [...book.notices.filter((n) => n.number !== candidate.number), candidate] };
  const sku = book.bySku.get(skuCode)!;
  return book.batches
    .filter((b) => b.skuCode === skuCode && candidate.effectiveDate <= bestBefore(sku, b.packedDate))
    .filter((b) => decide(hypothetical, candidate.effectiveDate, skuCode, b.packedDate, b.oldWrapper).stickerSource?.number === candidate.number)
    .map((b) => b.code)
    .sort();
}
