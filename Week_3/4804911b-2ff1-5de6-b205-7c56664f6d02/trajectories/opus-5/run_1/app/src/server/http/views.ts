import { compareDates, type IsoDate } from '../domain/dates.js';
import { stickerCeilingPaise, unitSalePrice } from '../domain/money.js';
import {
  latestVersion,
  type PackFacts,
  type PriceBook,
  type PublishedNotice,
  type PublishedVersion,
  type SkuRecord,
} from '../domain/price.js';

export function packFactsView(facts: PackFacts): Record<string, unknown> {
  return {
    batchCode: facts.batchCode,
    skuCode: facts.skuCode,
    drinkName: facts.drinkName,
    skuName: facts.skuName,
    format: facts.format,
    sizeMl: facts.sizeMl,
    packedDate: facts.packedDate,
    printDate: facts.printDate,
    oldWrapper: facts.oldWrapper,
    wrapperNotice: facts.wrapperNotice,
    bestBeforeDate: facts.bestBeforeDate,
    printedMrpPaise: facts.printedMrpPaise,
    revisedMrpPaise: facts.revisedMrpPaise,
    retailPricePaise: facts.retailPricePaise,
    unitSalePrice: facts.unitSalePrice,
    sugarMgPerPack: facts.sugarMgPerPack,
    stickerApplies: facts.stickerApplies,
    stickerNote: facts.stickerNote,
    pastBestBefore: facts.pastBestBefore,
    dateNote: facts.dateNote,
    sourceNotice: facts.sourceNotice,
  };
}

export function versionState(
  notice: PublishedNotice,
  version: PublishedVersion,
  todayDate: IsoDate,
): 'scheduled' | 'in_effect' | 'superseded' {
  if (version.version < latestVersion(notice).version) return 'superseded';
  return compareDates(version.effectiveDate, todayDate) > 0 ? 'scheduled' : 'in_effect';
}

export function noticeVersionView(
  notice: PublishedNotice,
  version: PublishedVersion,
  todayDate: IsoDate,
): Record<string, unknown> {
  const highest = latestVersion(notice).version;
  return {
    version: version.version,
    state: versionState(notice, version, todayDate),
    supersededBy: version.version < highest ? version.version + 1 : null,
    title: version.title,
    effectiveDate: version.effectiveDate,
    runOutUntil: version.runOutUntil,
    publishedAt: version.publishedAt,
    reason: version.reason,
    printState: version.printState,
    pdfSha256: version.pdfSha256,
    sheet: version.sheet,
    rows: version.rows.map((row) => ({
      skuCode: row.skuCode,
      name: row.name,
      kind: row.kind,
      oldMrpPaise: row.oldMrpPaise,
      revisedMrpPaise: row.revisedMrpPaise,
      oldRate: row.oldRate,
      newRate: row.newRate,
      ceilingPaise:
        row.kind === 'sticker'
          ? stickerCeilingPaise(row.oldMrpPaise, row.oldRate as number, row.newRate as number)
          : null,
    })),
  };
}

export function noticeView(
  notice: PublishedNotice,
  todayDate: IsoDate,
): Record<string, unknown> {
  const versions = [...notice.versions].sort((a, b) => b.version - a.version);
  return {
    number: notice.number,
    state: versionState(notice, latestVersion(notice), todayDate),
    versions: versions.map((version) => noticeVersionView(notice, version, todayDate)),
  };
}

export function skuView(book: PriceBook, sku: SkuRecord, todayDate: IsoDate): Record<string, unknown> {
  const drink = book.drink(sku.drinkId);
  const currentMrpPaise = book.currentMrpPaise(sku.code, todayDate);
  return {
    code: sku.code,
    variant: sku.variant,
    name: book.skuNameOf(sku),
    format: sku.format,
    sizeMl: sku.sizeMl,
    shelfDays: sku.shelfDays,
    sugarMgPerPack: sugarOf(book, sku),
    currentMrpPaise,
    drinkId: drink.id,
    drinkName: drink.name,
  };
}

export function sugarOf(book: PriceBook, sku: SkuRecord): number {
  const drink = book.drink(sku.drinkId);
  return Math.floor((2 * drink.sugarMgPer100Ml * sku.sizeMl + 100) / 200);
}

export function catalogueSkuView(book: PriceBook, sku: SkuRecord, todayDate: IsoDate): Record<string, unknown> {
  return {
    code: sku.code,
    variant: sku.variant,
    name: book.skuNameOf(sku),
    format: sku.format,
    sizeMl: sku.sizeMl,
    shelfDays: sku.shelfDays,
    sugarMgPerPack: sugarOf(book, sku),
    currentMrpPaise: book.currentMrpPaise(sku.code, todayDate),
  };
}

export function unitSalePriceOf(paise: number, sizeMl: number): { rupees: string; per: 'ml' | 'litre' } | null {
  return unitSalePrice(paise, sizeMl);
}
