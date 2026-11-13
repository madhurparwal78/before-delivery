/**
 * Publish checks, the sticker ceiling, rate continuity and revision order:
 * decided in exactly one place, shared by publish, correction and preview.
 */
import { isoToDay, type IsoDate } from '../../shared/domain.js';
import { stickerCeiling } from './decision.js';

export type RowKind = 'sticker' | 'new_print';

export interface DraftRowInput {
  skuCode: string;
  kind: RowKind;
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
}

export interface PublishedRow {
  number: string;
  version: number;
  effectiveDate: IsoDate;
  skuCode: string;
  kind: RowKind;
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
  isLatestVersion: boolean;
}

export interface SkuInfo {
  code: string;
  name: string;
  launchMrpPaise: number;
}

export interface OldMrpResult {
  oldMrpPaise: number;
  ceilingPaise: number | null;
}

/** Old MRP is the print in force the day before the effective date, ignoring earlier versions of the same notice. */
export function oldMrpFor(sku: SkuInfo, rows: PublishedRow[], effectiveDate: IsoDate, excludeNumber?: string): OldMrpResult {
  const dayBefore = isoToDay(effectiveDate)! - 1;
  let best: { effectiveDate: IsoDate; mrp: number } | null = null;
  for (const r of rows) {
    if (excludeNumber && r.number === excludeNumber) continue;
    if (r.skuCode !== sku.code) continue;
    const ed = isoToDay(r.effectiveDate)!;
    if (ed <= dayBefore) {
      if (!best || ed > isoToDay(best.effectiveDate)!) best = { effectiveDate: r.effectiveDate, mrp: r.revisedMrpPaise };
    }
  }
  return { oldMrpPaise: best ? best.mrp : sku.launchMrpPaise, ceilingPaise: null };
}

export function ceilingFor(oldMrpPaise: number, oldRate: number, newRate: number): number {
  return stickerCeiling(oldMrpPaise, oldRate, newRate);
}

export interface CheckContext {
  skus: Map<string, SkuInfo>;
  publishedRows: PublishedRow[];
  today: IsoDate;
  // For a correction: the notice being corrected.
  correctionOf?: { number: string; latestVersion: number; effectiveDate: IsoDate };
  oldWrapperBatches: Map<string, Array<{ code: string; packedDate: IsoDate }>>;
  // Current run-out of the corrected notice, read from Postgres state.
  currentRunOut?: (number: string) => IsoDate | null;
}

export interface BlockingError {
  status: number;
  body: Record<string, unknown>;
}

function day(d: IsoDate): number {
  return isoToDay(d) ?? 0;
}

/**
 * The publish checks, in the published order. Returns null when the publish
 * would succeed, else the full error body the real publish would answer.
 */
export function runPublishChecks(
  rows: DraftRowInput[],
  effectiveDate: IsoDate,
  runOutUntil: IsoDate | null,
  ctx: CheckContext
): BlockingError | null {
  // 4. effective_date_taken
  const takenSku: string[] = [];
  for (const r of rows) {
    for (const p of ctx.publishedRows) {
      if (!p.isLatestVersion) continue;
      if (p.skuCode !== r.skuCode) continue;
      if (ctx.correctionOf && p.number === ctx.correctionOf.number) continue;
      if (p.effectiveDate === effectiveDate) {
        if (!takenSku.includes(r.skuCode)) takenSku.push(r.skuCode);
      }
    }
  }
  if (takenSku.length > 0) {
    return { status: 409, body: { error: 'effective_date_taken', message: 'That date is already taken for those packs.', rows: takenSku } };
  }

  // 5. later_revision_exists
  const laterEntries: string[] = [];
  const laterRows: Array<{ skuCode: string; noticeNumber: string; effectiveDate: IsoDate }> = [];
  const ownNumber = ctx.correctionOf?.number;
  const laterBySku = new Map<string, PublishedRow[]>();
  for (const p of ctx.publishedRows) {
    if (!p.isLatestVersion) continue;
    if (ownNumber && p.number === ownNumber) continue;
    const list = laterBySku.get(p.skuCode) ?? [];
    list.push(p);
    laterBySku.set(p.skuCode, list);
  }
  for (const r of rows) {
    const laterList = (laterBySku.get(r.skuCode) ?? []).filter((p) => day(p.effectiveDate) > day(effectiveDate));
    if (laterList.length > 0) {
      const seen = new Set<string>();
      for (const l of laterList) {
        const key = `${r.skuCode}|${l.number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        laterEntries.push(`${r.skuCode} in ${l.number} from ${l.effectiveDate}`);
        laterRows.push({ skuCode: r.skuCode, noticeNumber: l.number, effectiveDate: l.effectiveDate });
      }
    }
  }
  if (laterEntries.length > 0) {
    return {
      status: 409,
      body: { error: 'later_revision_exists', message: `Later notice exists: ${laterEntries.join('; ')}.`, rows: laterRows },
    };
  }

  // 6. run_out_batches_exist (correction only)
  if (ctx.correctionOf) {
    const stranded = strandBatches(rows, effectiveDate, runOutUntil, ctx);
    if (stranded.length > 0) {
      return {
        status: 409,
        body: {
          error: 'run_out_batches_exist',
          message: `Old-wrapper batches would be stranded: ${stranded.join(', ')}.`,
          batches: stranded,
        },
      };
    }
  }

  // 7. no_rows, duplicate SKU, run-out rules
  if (rows.length === 0) return { status: 422, body: { error: 'no_rows', message: 'A notice needs at least one row.' } };
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.skuCode)) {
      return { status: 422, body: validationBody({ rows: 'Each pack may appear once.' }) };
    }
    seen.add(r.skuCode);
  }
  const stickerKinds = rows.filter((r) => r.kind === 'sticker');
  const hasSticker = stickerKinds.length > 0;
  if (hasSticker && runOutUntil !== null) {
    const from = day(effectiveDate);
    const to = day(runOutUntil);
    if (to < from || to - from > 180) {
      return { status: 422, body: validationBody({ runOutUntil: 'Old wrappers run from the effective date to 180 days after it.' }) };
    }
  }
  if (!hasSticker && runOutUntil !== null) {
    return { status: 422, body: validationBody({ runOutUntil: 'Only a sticker notice may allow old wrappers.' }) };
  }

  // 8. effective_date_past — for a correction, only when the date changes.
  const dateChanged = ctx.correctionOf ? effectiveDate !== ctx.correctionOf.effectiveDate : true;
  if (dateChanged && day(effectiveDate) < day(ctx.today)) {
    return { status: 422, body: { error: 'effective_date_past', message: 'The effective date must be today or later.' } };
  }

  // 9. ceiling_exceeded
  const over: Array<{ skuCode: string; name: string; revisedMrpPaise: number; ceilingPaise: number }> = [];
  const overCodes: string[] = [];
  for (const r of stickerKinds) {
    const sku = ctx.skus.get(r.skuCode);
    if (!sku) continue;
    const old = oldMrpFor(sku, ctx.publishedRows, effectiveDate, ownNumber);
    if (r.oldRate === null || r.newRate === null) continue;
    const ceiling = ceilingFor(old.oldMrpPaise, r.oldRate, r.newRate);
    if (r.revisedMrpPaise > ceiling) {
      over.push({ skuCode: r.skuCode, name: sku.name, revisedMrpPaise: r.revisedMrpPaise, ceilingPaise: ceiling });
      overCodes.push(r.skuCode);
    }
  }
  if (over.length > 0) {
    return { status: 422, body: { error: 'ceiling_exceeded', message: `Over the ceiling: ${overCodes.join(', ')}.`, rows: over } };
  }

  // 10. rate_discontinuity
  const discon: Array<{ skuCode: string; expectedOldRate: number; oldRate: number }> = [];
  const disconCodes: string[] = [];
  for (const r of stickerKinds) {
    if (r.oldRate === null || r.newRate === null) continue;
    const earlier = ctx.publishedRows
      .filter((p) => p.isLatestVersion && p.skuCode === r.skuCode && p.kind === 'sticker' && day(p.effectiveDate) < day(effectiveDate) && (!ownNumber || p.number !== ownNumber))
      .sort((a, b) => day(a.effectiveDate) - day(b.effectiveDate));
    if (earlier.length === 0) continue;
    const last = earlier[earlier.length - 1];
    if (last.newRate !== null && r.oldRate !== last.newRate) {
      discon.push({ skuCode: r.skuCode, expectedOldRate: last.newRate, oldRate: r.oldRate });
      disconCodes.push(r.skuCode);
    }
  }
  if (discon.length > 0) {
    return { status: 422, body: { error: 'rate_discontinuity', message: `Rate does not follow the last notice: ${disconCodes.join(', ')}.`, rows: discon } };
  }
  return null;
}

function validationBody(fields: Record<string, string>): Record<string, unknown> {
  return { error: 'validation', message: 'Some fields need attention.', fields };
}

export function strandBatches(rows: DraftRowInput[], effectiveDate: IsoDate, runOutUntil: IsoDate | null, ctx: CheckContext): string[] {
  if (!ctx.correctionOf) return [];
  const codes: string[] = [];
  for (const [skuCode, batches] of ctx.oldWrapperBatches) {
    for (const b of batches) {
      const qualifiesNow = noticeQualifies(ctx.correctionOf!.number, skuCode, b.packedDate, ctx);
      const stickerKept = rows.some((r) => r.skuCode === skuCode && r.kind === 'sticker');
      const inWindow =
        runOutUntil !== null &&
        day(b.packedDate) >= day(effectiveDate) &&
        day(b.packedDate) <= day(runOutUntil) &&
        day(effectiveDate) <= day(ctx.today);
      const stillQualifies = stickerKept && inWindow && qualifiesNow;
      if (qualifiesNow && !stillQualifies && !codes.includes(b.code)) codes.push(b.code);
    }
  }
  return codes.sort();
}

function noticeQualifies(number: string, skuCode: string, packedDate: IsoDate, ctx: CheckContext): boolean {
  // A notice qualifies when its latest version has a sticker row for the SKU and
  // the packed date is from the effective date to runOutUntil, both inclusive.
  const rows = ctx.publishedRows.filter((p) => p.number === number && p.isLatestVersion && p.skuCode === skuCode && p.kind === 'sticker');
  if (rows.length === 0) return false;
  const r = rows[0];
  if (ctx.correctionOf!.number === number) {
    // current state of this notice
    const eff = ctx.correctionOf!.effectiveDate;
    const run = ctx.currentRunOut?.(number) ?? null;
    if (!run) return false;
    return day(packedDate) >= day(eff) && day(packedDate) <= day(run) && day(eff) <= day(ctx.today);
  }
  return day(packedDate) >= day(r.effectiveDate);
}

/** The `later_revision_exists` check also covers date moves: compare against the notice's own previous date when correcting. */
export function checkCorrectionDateMove(
  rows: DraftRowInput[],
  newEffectiveDate: IsoDate,
  ctx: CheckContext
): BlockingError | null {
  if (!ctx.correctionOf) return null;
  const own = ctx.correctionOf;
  // If the date changes on an in-effect notice, refuse.
  if (day(newEffectiveDate) !== day(own.effectiveDate)) {
    const inEffect = day(own.effectiveDate) <= day(ctx.today);
    if (inEffect) {
      return { status: 409, body: { error: 'effective_date_locked', message: "An in-effect notice's effective date cannot change." } };
    }
  }
  return null;
}
