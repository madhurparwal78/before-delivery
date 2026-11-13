/**
 * The one price decision: one server function of SKU, batch print date and today.
 * Every surface — panel, mirror, reader, search, current prices, notice, PDF,
 * price sheet, message payload and publish preview — calls this module only.
 */
import { divRoundHalfUp, isoToDay, dayToIso, type IsoDate, type Paise } from '../../shared/domain.js';

export type RowKind = 'sticker' | 'new_print';

export interface EditionRow {
  skuCode: string;
  kind: RowKind;
  effectiveDate: IsoDate;
  revisedMrpPaise: Paise;
}

export interface Edition {
  skuCode: string;
  effectiveDate: IsoDate;
  mrpPaise: Paise;
}

export interface SkuRecord {
  code: string;
  drinkName: string;
  variant: string;
  sizeMl: number;
  shelfDays: number;
  launchMrpPaise: Paise;
}

export interface BatchRecord {
  code: string;
  skuCode: string;
  packedDate: IsoDate;
  oldWrapper: boolean;
}

export interface WrapperQualifyingNotice {
  number: string;
  version: number;
  effectiveDate: IsoDate;
  runOutUntil: IsoDate | null;
  latestVersion: number;
}

export interface PriceDecisionInput {
  sku: SkuRecord;
  batch: BatchRecord | null;
  editions: Edition[];         // print editions for the SKU, newest-first by effective date
  stickerRows: EditionRow[];   // sticker rows for the SKU, from latest versions of published notices
  today: IsoDate;
  wrapperNotice: WrapperQualifyingNotice | null;
}

export interface PriceDecision {
  printedMrpPaise: Paise;
  revisedMrpPaise: Paise | null;
  retailPricePaise: Paise;
  stickerApplies: boolean;
  printDate: IsoDate;
}

function dayOf(d: IsoDate): number {
  return isoToDay(d) ?? 0;
}

/** The newest edition whose effective date is on or before `date`. */
export function editionOn(editions: Edition[], date: IsoDate): Edition | null {
  const d = dayOf(date);
  let best: Edition | null = null;
  for (const e of editions) {
    if (dayOf(e.effectiveDate) <= d) {
      if (!best || dayOf(e.effectiveDate) > dayOf(best.effectiveDate)) best = e;
    }
  }
  return best;
}

/** A batch's print date: its packed date, or the day before the newest qualifying notice's effective date. */
export function printDateOf(batch: BatchRecord, wrapperNotice: WrapperQualifyingNotice | null): IsoDate {
  if (batch.oldWrapper && wrapperNotice) {
    const d = dayOf(wrapperNotice.effectiveDate) - 1;
    return dayToIso(d);
  }
  return batch.packedDate;
}

export function decidePrice(input: PriceDecisionInput): PriceDecision {
  const printDate = input.batch ? printDateOf(input.batch, input.wrapperNotice) : input.today;
  const printed = editionOn(input.editions, printDate) ?? { skuCode: input.sku.code, effectiveDate: '', mrpPaise: input.sku.launchMrpPaise };
  const printedMrpPaise = printed.mrpPaise;

  let sticker: EditionRow | null = null;
  if (input.batch) {
    const pd = dayOf(printDate);
    const td = dayOf(input.today);
    for (const r of input.stickerRows) {
      const ed = dayOf(r.effectiveDate);
      if (ed > pd && ed <= td) {
        if (!sticker || ed > dayOf(sticker.effectiveDate)) sticker = r;
      }
    }
  }
  const revisedMrpPaise = sticker ? sticker.revisedMrpPaise : null;
  return {
    printedMrpPaise,
    revisedMrpPaise,
    retailPricePaise: revisedMrpPaise ?? printedMrpPaise,
    stickerApplies: sticker !== null,
    printDate,
  };
}

export function stickerCeiling(oldMrpPaise: Paise, oldRate: number, newRate: number): Paise {
  return divRoundHalfUp(oldMrpPaise * (100 + newRate), 100 + oldRate);
}

/** Sugar mg per pack: stored mg per 100 ml times size over 100, rounded half up. */
export function sugarMgPerPack(sugarMgPer100ml: number, sizeMl: number): number {
  return divRoundHalfUp(sugarMgPer100ml * sizeMl, 100);
}

/** Best-before: packed date plus shelf days; a Feb 29 that does not exist falls to Feb 28. */
export function bestBefore(packedDate: IsoDate, shelfDays: number): IsoDate {
  const d = isoToDay(packedDate);
  if (d === null) return packedDate;
  return dayToIso(d + shelfDays);
}
