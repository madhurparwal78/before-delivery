import { addDays, compareDates, type IsoDate } from './dates.js';
import { formatRupees, sugarMgPerPack, unitSalePrice, type UnitSalePrice } from './money.js';
import { sentences } from './sentences.js';

export type PackFormat = 'carton' | 'pet' | 'glass' | 'can';
export type RowKind = 'sticker' | 'new_print';
export type PrintState = 'pending' | 'printable' | 'failed';

export interface DrinkRecord {
  id: string;
  name: string;
  carbonated: boolean;
  sugarMgPer100Ml: number;
  position: number;
}

export interface SkuRecord {
  code: string;
  drinkId: string;
  variant: string;
  format: PackFormat;
  sizeMl: number;
  shelfDays: number;
  launchMrpPaise: number;
  position: number;
}

export interface BatchRecord {
  code: string;
  skuCode: string;
  packedDate: IsoDate;
  oldWrapper: boolean;
}

export interface NoticeRef {
  number: string;
  version: number;
}

export interface PublishedRow {
  skuCode: string;
  name: string;
  kind: RowKind;
  oldMrpPaise: number;
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
}

export interface PublishedVersion {
  noticeId: string;
  number: string;
  version: number;
  title: string;
  effectiveDate: IsoDate;
  runOutUntil: IsoDate | null;
  publishedAt: string;
  reason: string | null;
  printState: PrintState;
  pdfSha256: string | null;
  sheet: { id: string; sha256: string } | null;
  rows: PublishedRow[];
}

export interface PublishedNotice {
  id: string;
  number: string;
  year: number;
  sequence: number;
  versions: PublishedVersion[];
}

/** A read-time snapshot of everything the one price decision needs. */
export interface PriceWorld {
  drinks: DrinkRecord[];
  skus: SkuRecord[];
  batches: BatchRecord[];
  notices: PublishedNotice[];
}

export interface PrintEdition {
  effectiveDate: IsoDate;
  mrpPaise: number;
  notice: NoticeRef | null;
}

export interface StickerEdition {
  effectiveDate: IsoDate;
  revisedMrpPaise: number;
  newRate: number;
  notice: NoticeRef;
}

export interface WrapperWindow {
  number: string;
  version: number;
  effectiveDate: IsoDate;
  runOutUntil: IsoDate;
}

export interface PackFacts {
  batchCode: string;
  skuCode: string;
  drinkName: string;
  skuName: string;
  format: PackFormat;
  sizeMl: number;
  packedDate: IsoDate;
  printDate: IsoDate;
  oldWrapper: boolean;
  wrapperNotice: NoticeRef | null;
  bestBeforeDate: IsoDate;
  printedMrpPaise: number;
  revisedMrpPaise: number | null;
  retailPricePaise: number;
  unitSalePrice: UnitSalePrice | null;
  sugarMgPerPack: number;
  stickerApplies: boolean;
  stickerNote: string | null;
  pastBestBefore: boolean;
  dateNote: string | null;
  sourceNotice: NoticeRef | null;
}

export function latestVersion(notice: PublishedNotice): PublishedVersion {
  return notice.versions.reduce((best, version) => (version.version > best.version ? version : best));
}

export function skuName(drink: DrinkRecord, sku: SkuRecord): string {
  return `${drink.name} ${sku.variant}`;
}

export class PriceBook {
  private readonly drinksById = new Map<string, DrinkRecord>();
  private readonly skusByCode = new Map<string, SkuRecord>();
  private readonly batchesByCode = new Map<string, BatchRecord>();
  private readonly batchesBySku = new Map<string, BatchRecord[]>();
  private readonly editions = new Map<string, PrintEdition[]>();
  private readonly stickers = new Map<string, StickerEdition[]>();
  private readonly wrappers = new Map<string, WrapperWindow[]>();

  constructor(readonly world: PriceWorld) {
    for (const drink of world.drinks) this.drinksById.set(drink.id, drink);
    for (const sku of world.skus) {
      this.skusByCode.set(sku.code, sku);
      this.editions.set(sku.code, [
        { effectiveDate: '0001-01-01', mrpPaise: sku.launchMrpPaise, notice: null },
      ]);
      this.stickers.set(sku.code, []);
      this.wrappers.set(sku.code, []);
      this.batchesBySku.set(sku.code, []);
    }
    for (const batch of world.batches) {
      this.batchesByCode.set(batch.code, batch);
      this.batchesBySku.get(batch.skuCode)?.push(batch);
    }
    for (const notice of world.notices) {
      const version = latestVersion(notice);
      const ref: NoticeRef = { number: notice.number, version: version.version };
      for (const row of version.rows) {
        this.editions.get(row.skuCode)?.push({
          effectiveDate: version.effectiveDate,
          mrpPaise: row.revisedMrpPaise,
          notice: ref,
        });
        if (row.kind === 'sticker') {
          this.stickers.get(row.skuCode)?.push({
            effectiveDate: version.effectiveDate,
            revisedMrpPaise: row.revisedMrpPaise,
            newRate: row.newRate ?? 0,
            notice: ref,
          });
          if (version.runOutUntil !== null) {
            this.wrappers.get(row.skuCode)?.push({
              number: notice.number,
              version: version.version,
              effectiveDate: version.effectiveDate,
              runOutUntil: version.runOutUntil,
            });
          }
        }
      }
    }
    for (const list of this.editions.values()) list.sort((a, b) => compareDates(a.effectiveDate, b.effectiveDate));
    for (const list of this.stickers.values()) list.sort((a, b) => compareDates(a.effectiveDate, b.effectiveDate));
    for (const list of this.wrappers.values()) list.sort((a, b) => compareDates(a.effectiveDate, b.effectiveDate));
    for (const list of this.batchesBySku.values()) list.sort((a, b) => compareDates(a.packedDate, b.packedDate));
  }

  drink(id: string): DrinkRecord {
    const drink = this.drinksById.get(id);
    if (!drink) throw new Error(`Unknown drink ${id}`);
    return drink;
  }

  sku(code: string): SkuRecord | null {
    return this.skusByCode.get(code) ?? null;
  }

  skus(): SkuRecord[] {
    return [...this.skusByCode.values()].sort((a, b) => a.position - b.position);
  }

  drinks(): DrinkRecord[] {
    return [...this.drinksById.values()].sort((a, b) => a.position - b.position);
  }

  batch(code: string): BatchRecord | null {
    return this.batchesByCode.get(code) ?? null;
  }

  batchesOf(skuCode: string): BatchRecord[] {
    return this.batchesBySku.get(skuCode) ?? [];
  }

  skuNameOf(sku: SkuRecord): string {
    return skuName(this.drink(sku.drinkId), sku);
  }

  bestBefore(batch: BatchRecord): IsoDate {
    const sku = this.sku(batch.skuCode);
    if (!sku) throw new Error(`Unknown SKU ${batch.skuCode}`);
    return addDays(batch.packedDate, sku.shelfDays);
  }

  /** The newest notice whose latest version lets this batch keep an old wrapper. */
  qualifyingWrapperNotice(batch: BatchRecord): WrapperWindow | null {
    const windows = (this.wrappers.get(batch.skuCode) ?? []).filter(
      (window) =>
        compareDates(batch.packedDate, window.effectiveDate) >= 0 &&
        compareDates(batch.packedDate, window.runOutUntil) <= 0,
    );
    return windows.length === 0 ? null : windows[windows.length - 1];
  }

  printDateOf(batch: BatchRecord): IsoDate {
    if (!batch.oldWrapper) return batch.packedDate;
    const window = this.qualifyingWrapperNotice(batch);
    return window === null ? batch.packedDate : addDays(window.effectiveDate, -1);
  }

  private editionAt(skuCode: string, onDate: IsoDate): PrintEdition {
    const list = this.editions.get(skuCode) ?? [];
    let chosen = list[0];
    for (const edition of list) {
      if (compareDates(edition.effectiveDate, onDate) <= 0) chosen = edition;
    }
    return chosen;
  }

  currentEdition(skuCode: string, todayDate: IsoDate): PrintEdition {
    return this.editionAt(skuCode, todayDate);
  }

  currentMrpPaise(skuCode: string, todayDate: IsoDate): number {
    return this.editionAt(skuCode, todayDate).mrpPaise;
  }

  currentSource(skuCode: string, todayDate: IsoDate): NoticeRef | null {
    return this.editionAt(skuCode, todayDate).notice;
  }

  private stickerFor(skuCode: string, printDate: IsoDate, todayDate: IsoDate): StickerEdition | null {
    const qualifying = (this.stickers.get(skuCode) ?? []).filter(
      (sticker) =>
        compareDates(sticker.effectiveDate, printDate) > 0 && compareDates(sticker.effectiveDate, todayDate) <= 0,
    );
    return qualifying.length === 0 ? null : qualifying[qualifying.length - 1];
  }

  /** The one price decision: SKU, batch print date and today. */
  decide(batch: BatchRecord, todayDate: IsoDate): PackFacts {
    const sku = this.sku(batch.skuCode);
    if (!sku) throw new Error(`Unknown SKU ${batch.skuCode}`);
    const drink = this.drink(sku.drinkId);
    const window = batch.oldWrapper ? this.qualifyingWrapperNotice(batch) : null;
    const printDate = this.printDateOf(batch);
    const printedEdition = this.editionAt(sku.code, printDate);
    const sticker = this.stickerFor(sku.code, printDate, todayDate);
    const retailPricePaise = sticker === null ? printedEdition.mrpPaise : sticker.revisedMrpPaise;
    const bestBeforeDate = addDays(batch.packedDate, sku.shelfDays);
    const pastBestBefore = compareDates(todayDate, bestBeforeDate) > 0;
    return {
      batchCode: batch.code,
      skuCode: sku.code,
      drinkName: drink.name,
      skuName: skuName(drink, sku),
      format: sku.format,
      sizeMl: sku.sizeMl,
      packedDate: batch.packedDate,
      printDate,
      oldWrapper: batch.oldWrapper,
      wrapperNotice: window === null ? null : { number: window.number, version: window.version },
      bestBeforeDate,
      printedMrpPaise: printedEdition.mrpPaise,
      revisedMrpPaise: sticker === null ? null : sticker.revisedMrpPaise,
      retailPricePaise,
      unitSalePrice: unitSalePrice(retailPricePaise, sku.sizeMl),
      sugarMgPerPack: sugarMgPerPack(drink.sugarMgPer100Ml, sku.sizeMl),
      stickerApplies: sticker !== null,
      stickerNote: sticker === null ? sentences.noSticker : null,
      pastBestBefore,
      dateNote: pastBestBefore ? sentences.pastDate : null,
      sourceNotice: sticker === null ? printedEdition.notice : sticker.notice,
    };
  }

  /** The oldest batch not past best-before, or the newest batch when every one is past. */
  storyBatch(skuCode: string, todayDate: IsoDate): BatchRecord | null {
    const batches = this.batchesOf(skuCode);
    if (batches.length === 0) return null;
    const fresh = batches.find((batch) => compareDates(todayDate, this.bestBefore(batch)) <= 0);
    return fresh ?? batches[batches.length - 1];
  }

  /**
   * The old MRP of a row: the print in force the day before the effective date,
   * ignoring every version of the notice the row belongs to.
   */
  oldMrpPaiseFor(skuCode: string, effectiveDate: IsoDate, ignoreNoticeNumber: string | null): number {
    const sku = this.sku(skuCode);
    if (!sku) throw new Error(`Unknown SKU ${skuCode}`);
    const dayBefore = addDays(effectiveDate, -1);
    let chosen = sku.launchMrpPaise;
    for (const edition of this.editions.get(skuCode) ?? []) {
      if (edition.notice !== null && edition.notice.number === ignoreNoticeNumber) continue;
      if (compareDates(edition.effectiveDate, dayBefore) <= 0) chosen = edition.mrpPaise;
    }
    return chosen;
  }

  /** The newRate of the SKU's latest sticker row dated before this date. */
  lastStickerRateBefore(skuCode: string, effectiveDate: IsoDate, ignoreNoticeNumber: string | null): number | null {
    const earlier = (this.stickers.get(skuCode) ?? []).filter(
      (sticker) =>
        compareDates(sticker.effectiveDate, effectiveDate) < 0 && sticker.notice.number !== ignoreNoticeNumber,
    );
    return earlier.length === 0 ? null : earlier[earlier.length - 1].newRate;
  }

  marqueeRows(todayDate: IsoDate): { skuName: string; oldPaise: number; revisedPaise: number; date: IsoDate }[] {
    const entries: { skuName: string; oldPaise: number; revisedPaise: number; date: IsoDate }[] = [];
    for (const notice of this.world.notices) {
      const version = latestVersion(notice);
      if (compareDates(version.effectiveDate, todayDate) > 0) continue;
      for (const row of version.rows) {
        const sku = this.sku(row.skuCode);
        if (!sku) continue;
        entries.push({
          skuName: this.skuNameOf(sku),
          oldPaise: row.oldMrpPaise,
          revisedPaise: row.revisedMrpPaise,
          date: version.effectiveDate,
        });
      }
    }
    return entries;
  }

  counts(todayDate: IsoDate): { drinks: number; skus: number; notices: number; scheduledRevisions: number } {
    let inEffect = 0;
    let scheduled = 0;
    for (const notice of this.world.notices) {
      if (compareDates(latestVersion(notice).effectiveDate, todayDate) <= 0) inEffect += 1;
      else scheduled += 1;
    }
    return {
      drinks: this.world.drinks.length,
      skus: this.world.skus.length,
      notices: inEffect,
      scheduledRevisions: scheduled,
    };
  }
}

export function formatPaise(paise: number): string {
  return formatRupees(paise);
}
