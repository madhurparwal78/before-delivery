/**
 * Loads Postgres rows and calls the one price decision for any SKU or batch.
 */
import type { Pool } from 'pg';
import { bestBefore, decidePrice, editionOn, sugarMgPerPack, type BatchRecord, type Edition, type EditionRow, type SkuRecord, type WrapperQualifyingNotice } from './decision.js';
import { unitSalePrice } from '../../shared/domain.js';
import { isoToDay, type IsoDate } from '../../shared/domain.js';

export interface SkuRow extends SkuRecord {
  drinkId: string;
  format: 'carton' | 'pet' | 'glass' | 'can';
  sugarMgPer100ml: number;
  /** `<drink name> <variant>` — the live SKU name. */
  name: string;
  drinkName: string;
}

interface NoticeVersionRow {
  number: string;
  version: number;
  effective_date: IsoDate;
  run_out_until: IsoDate | null;
}

export interface PackFacts {
  batchCode: string;
  skuCode: string;
  drinkName: string;
  skuName: string;
  format: 'carton' | 'pet' | 'glass' | 'can';
  sizeMl: number;
  packedDate: IsoDate;
  printDate: IsoDate;
  oldWrapper: boolean;
  wrapperNotice: { number: string; version: number } | null;
  bestBeforeDate: IsoDate;
  printedMrpPaise: number;
  revisedMrpPaise: number | null;
  retailPricePaise: number;
  unitSalePrice: { rupees: string; per: 'ml' | 'litre' } | null;
  sugarMgPerPack: number;
  stickerApplies: boolean;
  stickerNote: string | null;
  pastBestBefore: boolean;
  dateNote: string | null;
  sourceNotice: { number: string; version: number } | null;
}

export const NO_STICKER_NOTE = 'No sticker on this pack. The printed price is the price.';
export const PAST_DATE_NOTE = "This pack is past its best-before date. Please don't drink it.";

interface CacheEntry {
  editions: Map<string, Edition[]>;
  stickerRows: Map<string, EditionRow[]>;
  latestVersions: Map<string, NoticeVersionRow>;
}

export class PriceContext {
  private cache: CacheEntry | null = null;

  constructor(private pool: Pool, private today: () => IsoDate) {}

  private async load(): Promise<CacheEntry> {
    if (this.cache) return this.cache;
    const editions = new Map<string, Edition[]>();
    const stickerRows = new Map<string, EditionRow[]>();
    const latestVersions = new Map<string, NoticeVersionRow>();

    const versions = await this.pool.query<{ number: string; version: number; effective_date: IsoDate; run_out_until: IsoDate | null }>(
      `SELECT number, version, effective_date::text, run_out_until::text
       FROM notice_versions
       WHERE (number, version) IN (SELECT number, max(version) FROM notice_versions GROUP BY number)
       ORDER BY number`
    );
    for (const v of versions.rows) {
      latestVersions.set(v.number, v);
    }
    const rows = await this.pool.query<{ number: string; version: number; sku_code: string; kind: 'sticker' | 'new_print'; effective_date: IsoDate; revised_mrp_paise: number }>(
      `SELECT r.number, r.version, r.sku_code, r.kind, v.effective_date::text, r.revised_mrp_paise
       FROM notice_rows r
       JOIN (SELECT number, max(version) AS version FROM notice_versions GROUP BY number) lv
         ON lv.number = r.number AND lv.version = r.version
       JOIN notice_versions v ON v.number = r.number AND v.version = r.version
       ORDER BY r.number, r.row_index`
    );
    for (const r of rows.rows) {
      const edList = editions.get(r.sku_code) ?? [];
      edList.push({ skuCode: r.sku_code, effectiveDate: r.effective_date, mrpPaise: r.revised_mrp_paise });
      editions.set(r.sku_code, edList);
      if (r.kind === 'sticker') {
        const sList = stickerRows.get(r.sku_code) ?? [];
        sList.push({ skuCode: r.sku_code, kind: 'sticker', effectiveDate: r.effective_date, revisedMrpPaise: r.revised_mrp_paise });
        stickerRows.set(r.sku_code, sList);
      }
    }
    this.cache = { editions, stickerRows, latestVersions };
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }

  async getSku(code: string): Promise<SkuRow | null> {
    const r = await this.pool.query(
      `SELECT s.code, s.drink_id, s.variant, s.format, s.size_ml, s.shelf_days, s.sugar_mg_per_100ml, s.launch_mrp_paise, d.name AS drink_name
       FROM skus s JOIN drinks d ON d.id = s.drink_id WHERE s.code = $1`,
      [code]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return {
      code: row.code,
      drinkId: row.drink_id,
      drinkName: row.drink_name,
      variant: row.variant,
      name: `${row.drink_name} ${row.variant}`,
      format: row.format,
      sizeMl: row.size_ml,
      shelfDays: row.shelf_days,
      sugarMgPer100ml: row.sugar_mg_per_100ml,
      launchMrpPaise: row.launch_mrp_paise,
    };
  }

  async getBatch(code: string): Promise<BatchRecord | null> {
    const r = await this.pool.query(
      'SELECT code, sku_code, packed_date::text AS packed_date, old_wrapper FROM batches WHERE code = $1',
      [code]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return { code: row.code, skuCode: row.sku_code, packedDate: row.packed_date, oldWrapper: row.old_wrapper };
  }

  async getWrapperNotice(batch: BatchRecord): Promise<WrapperQualifyingNotice | null> {
    if (!batch.oldWrapper) return null;
    const { stickerRows, latestVersions } = await this.load();
    const today = this.today();
    const candidates: WrapperQualifyingNotice[] = [];
    // Find notices whose latest version has a sticker row for this SKU and whose
    // effective date covers the batch's packed date.
    for (const [number, v] of latestVersions.entries()) {
      const hasSticker = (stickerRows.get(batch.skuCode) ?? []).some((s) => s.effectiveDate === v.effective_date);
      if (!hasSticker) continue;
      if (!v.run_out_until) continue;
      const packedDay = isoToDay(batch.packedDate);
      const effDay = isoToDay(v.effective_date);
      const runDay = isoToDay(v.run_out_until);
      if (packedDay === null || effDay === null || runDay === null) continue;
      if (packedDay >= effDay && packedDay <= runDay && effDay <= isoToDay(today)!) {
        candidates.push({ number, version: v.version, effectiveDate: v.effective_date, runOutUntil: v.run_out_until, latestVersion: v.version });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : a.number < b.number ? 1 : -1));
    return candidates[0];
  }

  async skuEditions(skuCode: string): Promise<Edition[]> {
    const { editions } = await this.load();
    return editions.get(skuCode) ?? [];
  }

  async currentMrp(skuCode: string): Promise<{ mrpPaise: number; source: { number: string; version: number } | null }> {
    const { editions, latestVersions } = await this.load();
    const list = editions.get(skuCode) ?? [];
    const today = this.today();
    const e = editionOn(list, today);
    if (!e || e.effectiveDate === '') {
      return { mrpPaise: (await this.getSku(skuCode))!.launchMrpPaise, source: null };
    }
    // find the notice that published this edition
    for (const [number, v] of latestVersions.entries()) {
      if (v.effective_date === e.effectiveDate) {
        const has = await this.pool.query('SELECT 1 FROM notice_rows WHERE number = $1 AND version = $2 AND sku_code = $3 AND revised_mrp_paise = $4', [number, v.version, skuCode, e.mrpPaise]);
        if (has.rows.length > 0) return { mrpPaise: e.mrpPaise, source: { number, version: v.version } };
      }
    }
    return { mrpPaise: e.mrpPaise, source: null };
  }

  async packFacts(sku: SkuRow, batch: BatchRecord): Promise<PackFacts> {
    const { editions, stickerRows } = await this.load();
    const today = this.today();
    const wrapperNotice = await this.getWrapperNotice(batch);
    const d = decidePrice({ sku, batch, editions: editions.get(sku.code) ?? [], stickerRows: stickerRows.get(sku.code) ?? [], today, wrapperNotice });
    const bb = bestBefore(batch.packedDate, sku.shelfDays);
    const past = isoToDay(today)! > isoToDay(bb)!;
    const retail = d.retailPricePaise;
    const unit = unitSalePrice(retail, sku.sizeMl);
    const src = await this.sourceNotice(sku, d, wrapperNotice);
    return {
      batchCode: batch.code,
      skuCode: sku.code,
      drinkName: sku.drinkName,
      skuName: sku.name,
      format: sku.format,
      sizeMl: sku.sizeMl,
      packedDate: batch.packedDate,
      printDate: d.printDate,
      oldWrapper: batch.oldWrapper,
      wrapperNotice: wrapperNotice ? { number: wrapperNotice.number, version: wrapperNotice.version } : null,
      bestBeforeDate: bb,
      printedMrpPaise: d.printedMrpPaise,
      revisedMrpPaise: d.revisedMrpPaise,
      retailPricePaise: retail,
      unitSalePrice: unit,
      sugarMgPerPack: sugarMgPerPack(sku.sugarMgPer100ml, sku.sizeMl),
      stickerApplies: d.stickerApplies,
      stickerNote: d.stickerApplies ? null : NO_STICKER_NOTE,
      pastBestBefore: past,
      dateNote: past ? PAST_DATE_NOTE : null,
      sourceNotice: src,
    };
  }

  private async sourceNotice(sku: SkuRow, d: { printedMrpPaise: number; stickerApplies: boolean; printDate: IsoDate }, wrapperNotice: WrapperQualifyingNotice | null): Promise<{ number: string; version: number } | null> {
    const src = await this.currentMrp(sku.code);
    if (!src.source) return null;
    return src.source;
  }
}

export function unitSale(retailPaise: number, sizeMl: number): { rupees: string; per: 'ml' | 'litre' } | null {
  if (sizeMl >= 1000) {
    if (sizeMl === 1000) return null;
    return { rupees: (retailPaise / 100).toFixed(2), per: 'litre' };
  }
  const unitPaise = Math.floor((retailPaise * 1000 * 2 + sizeMl) / (2 * sizeMl));
  return { rupees: (unitPaise / 100).toFixed(2), per: 'ml' };
}
