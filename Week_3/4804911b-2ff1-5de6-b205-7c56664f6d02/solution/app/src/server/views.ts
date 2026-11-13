import type { Catalogue, DrinkSummary, NoticeDetail, NoticeRow, NoticeVersion, SkuDetail, SkuSummary } from "../shared/types.js";
import type { Queryable } from "./db.js";
import { currentEdition, type Book, type SkuRec, packFacts, storyBatch, sugarPerPack, unitSalePrice } from "./pricing.js";

export function skuSummary(book: Book, today: string, sku: SkuRec): SkuSummary {
  return {
    code: sku.code, variant: sku.variant, name: sku.name, format: sku.format, sizeMl: sku.sizeMl, shelfDays: sku.shelfDays,
    sugarMgPerPack: sugarPerPack(sku), currentMrpPaise: currentEdition(book, today, sku.code).mrpPaise,
  };
}

export function counts(book: Book, today: string): Catalogue["counts"] {
  return {
    drinks: book.drinks.length, skus: book.skus.length,
    notices: book.notices.filter((n) => n.effectiveDate <= today).length,
    scheduledRevisions: book.notices.filter((n) => n.effectiveDate > today).length,
  };
}

export function catalogue(book: Book, today: string): Catalogue {
  const drinks: DrinkSummary[] = book.drinks.map((d) => ({
    id: d.id, name: d.name, carbonated: d.carbonated,
    skus: book.skus.filter((s) => s.drinkId === d.id).map((s) => skuSummary(book, today, s)),
  }));
  return { today, counts: counts(book, today), drinks };
}

export function skuDetail(book: Book, today: string, sku: SkuRec): SkuDetail {
  const current = currentEdition(book, today, sku.code);
  return {
    ...skuSummary(book, today, sku), drinkId: sku.drinkId, drinkName: sku.drinkName, currentSource: current.source,
    unitSalePrice: unitSalePrice(current.mrpPaise, sku.sizeMl), storyBatch: packFacts(book, today, storyBatch(book, today, sku.code)),
  };
}

export async function loadNotices(q: Queryable, numbers?: string[]): Promise<NoticeDetail[]> {
  const filter = numbers ? "WHERE v.number = ANY($1)" : "";
  const args = numbers ? [numbers] : [];
  const [versions, rows] = await Promise.all([
    q.query(
      `SELECT v.*, s.sha256 AS sheet_sha FROM notice_versions v LEFT JOIN sheets s ON s.id = v.sheet_id ${filter} ORDER BY v.number, v.version DESC`,
      args,
    ),
    q.query(`SELECT r.* FROM notice_rows r ${numbers ? "WHERE r.number = ANY($1)" : ""} ORDER BY r.number, r.version, r.position`, args),
  ]);
  const rowsOf = new Map<string, NoticeRow[]>();
  for (const r of rows.rows) {
    const key = `${r.number as string}/${r.version as number}`;
    const list = rowsOf.get(key) ?? [];
    list.push({
      skuCode: r.sku_code as string, name: r.name as string, kind: r.kind as "sticker" | "new_print", oldMrpPaise: r.old_mrp_paise as number,
      revisedMrpPaise: r.revised_mrp_paise as number, oldRate: (r.old_rate as number | null) ?? null, newRate: (r.new_rate as number | null) ?? null,
      ceilingPaise: (r.ceiling_paise as number | null) ?? null,
    });
    rowsOf.set(key, list);
  }
  const byNumber = new Map<string, NoticeVersion[]>();
  for (const v of versions.rows) {
    const number = v.number as string;
    const list = byNumber.get(number) ?? [];
    const printState = v.print_state as NoticeVersion["printState"];
    list.push({
      version: v.version as number, state: "superseded", supersededBy: null, title: v.title as string,
      effectiveDate: v.effective_date as string, runOutUntil: (v.run_out_until as string | null) ?? null,
      publishedAt: (v.published_at as Date).toISOString(), reason: (v.reason as string | null) ?? null, printState,
      pdfSha256: printState === "printable" ? (v.pdf_sha256 as string | null) : null,
      sheet: v.sheet_id ? { id: v.sheet_id as string, sha256: v.sheet_sha as string } : null,
      rows: rowsOf.get(`${number}/${v.version as number}`) ?? [],
    });
    byNumber.set(number, list);
  }
  return [...byNumber.entries()].map(([number, list]) => ({ number, state: "in_effect" as const, versions: list }));
}

/** States derive at read time: the newest version is scheduled or in effect, older ones are superseded by the next. */
export function withStates(notices: NoticeDetail[], today: string): NoticeDetail[] {
  return notices
    .map((n) => {
      const versions = n.versions.map((v, i) =>
        i === 0
          ? { ...v, state: (v.effectiveDate > today ? "scheduled" : "in_effect") as NoticeVersion["state"], supersededBy: null }
          : { ...v, state: "superseded" as const, supersededBy: v.version + 1 },
      );
      return { number: n.number, state: versions[0]!.state === "scheduled" ? ("scheduled" as const) : ("in_effect" as const), versions };
    })
    .sort((a, b) => b.versions[0]!.effectiveDate.localeCompare(a.versions[0]!.effectiveDate) || b.number.localeCompare(a.number));
}

