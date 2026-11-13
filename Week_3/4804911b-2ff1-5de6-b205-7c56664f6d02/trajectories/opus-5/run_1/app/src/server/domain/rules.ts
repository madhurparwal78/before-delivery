import { ApiError, validationError } from './errors.js';
import { addDays, compareDates, daysBetween, isValidIsoDate, type IsoDate } from './dates.js';
import { stickerCeilingPaise } from './money.js';
import {
  PriceBook,
  latestVersion,
  type PriceWorld,
  type PublishedNotice,
  type PublishedRow,
  type PublishedVersion,
  type RowKind,
} from './price.js';

export const RUN_OUT_MAX_DAYS = 180;
const PREVIEW_NOTICE_NUMBER = 'VT-PREVIEW-00';

export interface ProposalRow {
  skuCode: string;
  kind: RowKind;
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
}

export interface NoticeInput {
  title: string;
  effectiveDate: IsoDate;
  runOutUntil: IsoDate | null;
  rows: ProposalRow[];
}

export interface PreviewRow {
  skuCode: string;
  name: string;
  kind: RowKind;
  oldMrpPaise: number;
  ceilingPaise: number | null;
  revisedMrpPaise: number;
  stickerBatches: string[];
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function readTitle(value: unknown, fields: Record<string, string>, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 200) {
    fields[field] = 'A title of 1 to 200 characters is needed.';
    return '';
  }
  return value.trim();
}

/**
 * Reads a notice body. The same reading serves draft saves, publishes,
 * corrections and the publish preview, so a preview cannot disagree with a save.
 */
export function parseNoticeInput(
  body: Record<string, unknown>,
  options: { titleField: 'title' | null },
): NoticeInput {
  const fields: Record<string, string> = {};
  const title = options.titleField === null ? '' : readTitle(body.title, fields, 'title');

  let effectiveDate: IsoDate = '';
  if (!isValidIsoDate(body.effectiveDate)) {
    fields.effectiveDate = 'An effective date as YYYY-MM-DD is needed.';
  } else {
    effectiveDate = body.effectiveDate;
  }

  let runOutUntil: IsoDate | null = null;
  const rawRunOut = body.runOutUntil;
  if (rawRunOut !== undefined && rawRunOut !== null && rawRunOut !== '') {
    if (!isValidIsoDate(rawRunOut)) {
      fields.runOutUntil = 'A run-out date as YYYY-MM-DD is needed.';
    } else {
      runOutUntil = rawRunOut;
    }
  }

  const rows: ProposalRow[] = [];
  if (!Array.isArray(body.rows)) {
    fields.rows = 'A list of rows is needed.';
  } else {
    body.rows.forEach((raw, index) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const field = `rows.${index}`;
      const skuCode = typeof row.skuCode === 'string' ? row.skuCode.trim().toUpperCase() : '';
      if (skuCode === '') {
        fields[field] = 'A pack code is needed.';
        return;
      }
      const kind = row.kind;
      if (kind !== 'sticker' && kind !== 'new_print') {
        fields[field] = 'A row is either a sticker or a new print.';
        return;
      }
      if (!isInteger(row.revisedMrpPaise) || (row.revisedMrpPaise as number) <= 0) {
        fields[field] = 'A revised MRP above zero is needed.';
        return;
      }
      if (kind === 'new_print') {
        if (row.oldRate !== undefined && row.oldRate !== null) {
          fields[field] = 'A new-print row carries no rates.';
          return;
        }
        if (row.newRate !== undefined && row.newRate !== null) {
          fields[field] = 'A new-print row carries no rates.';
          return;
        }
        rows.push({ skuCode, kind, revisedMrpPaise: row.revisedMrpPaise as number, oldRate: null, newRate: null });
        return;
      }
      const oldRate = row.oldRate;
      const newRate = row.newRate;
      if (!isInteger(oldRate) || !isInteger(newRate)) {
        fields[field] = 'A sticker row needs both rates as whole percentages.';
        return;
      }
      if (oldRate < 0 || oldRate > 100 || newRate < 0 || newRate > 100) {
        fields[field] = 'Rates are whole percentages from 0 to 100.';
        return;
      }
      if (oldRate === newRate) {
        fields[field] = 'The old and new rates must differ.';
        return;
      }
      rows.push({
        skuCode,
        kind,
        revisedMrpPaise: row.revisedMrpPaise as number,
        oldRate: oldRate as number,
        newRate: newRate as number,
      });
    });
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);

  const runOutFailure = runOutRuleFailure(effectiveDate, runOutUntil, rows);
  if (runOutFailure !== null) throw validationError({ runOutUntil: runOutFailure });

  return { title, effectiveDate, runOutUntil, rows };
}

export function runOutRuleFailure(
  effectiveDate: IsoDate,
  runOutUntil: IsoDate | null,
  rows: ProposalRow[],
): string | null {
  const hasSticker = rows.some((row) => row.kind === 'sticker');
  if (runOutUntil === null) return null;
  if (!hasSticker) return 'Only a notice with a sticker row can allow old wrappers.';
  if (compareDates(runOutUntil, effectiveDate) < 0) {
    return 'The run-out date cannot be before the effective date.';
  }
  if (daysBetween(effectiveDate, runOutUntil) > RUN_OUT_MAX_DAYS) {
    return `The run-out date cannot be more than ${RUN_OUT_MAX_DAYS} days after the effective date.`;
  }
  return null;
}

export interface Proposal extends NoticeInput {
  /** The notice being corrected, or null for a publish. */
  noticeNumber: string | null;
  baseVersion: PublishedVersion | null;
}

function syntheticVersion(book: PriceBook, proposal: Proposal, version: number): PublishedVersion {
  const rows: PublishedRow[] = proposal.rows.map((row) => {
    const sku = book.sku(row.skuCode);
    return {
      skuCode: row.skuCode,
      name: sku === null ? row.skuCode : book.skuNameOf(sku),
      kind: row.kind,
      oldMrpPaise: book.oldMrpPaiseFor(row.skuCode, proposal.effectiveDate, proposal.noticeNumber),
      revisedMrpPaise: row.revisedMrpPaise,
      oldRate: row.oldRate,
      newRate: row.newRate,
    };
  });
  return {
    noticeId: 'preview',
    number: proposal.noticeNumber ?? PREVIEW_NOTICE_NUMBER,
    version,
    title: proposal.title,
    effectiveDate: proposal.effectiveDate,
    runOutUntil: proposal.runOutUntil,
    publishedAt: new Date(0).toISOString(),
    reason: null,
    printState: 'pending',
    pdfSha256: null,
    sheet: null,
    rows,
  };
}

/** The world as it would be with this proposal published, for simulating its effects. */
export function worldWithProposal(book: PriceBook, proposal: Proposal): PriceBook {
  const world = book.world;
  const notices: PublishedNotice[] = [];
  let replaced = false;
  for (const notice of world.notices) {
    if (proposal.noticeNumber !== null && notice.number === proposal.noticeNumber) {
      replaced = true;
      const next = latestVersion(notice).version + 1;
      notices.push({ ...notice, versions: [syntheticVersion(book, proposal, next)] });
    } else {
      notices.push(notice);
    }
  }
  if (!replaced) {
    notices.push({
      id: 'preview',
      number: PREVIEW_NOTICE_NUMBER,
      year: 0,
      sequence: 0,
      versions: [syntheticVersion(book, proposal, 1)],
    });
  }
  const nextWorld: PriceWorld = { ...world, notices };
  return new PriceBook(nextWorld);
}

interface LaterRow {
  skuCode: string;
  noticeNumber: string;
  effectiveDate: IsoDate;
  row: PublishedRow;
}

function laterRowsFor(book: PriceBook, ignoreNoticeNumber: string | null): LaterRow[] {
  const found: LaterRow[] = [];
  for (const notice of book.world.notices) {
    if (notice.number === ignoreNoticeNumber) continue;
    const version = latestVersion(notice);
    for (const row of version.rows) {
      found.push({
        skuCode: row.skuCode,
        noticeNumber: notice.number,
        effectiveDate: version.effectiveDate,
        row,
      });
    }
  }
  return found;
}

function rowsDiffer(a: PublishedRow | ProposalRow, b: ProposalRow): boolean {
  return (
    a.kind !== b.kind ||
    a.revisedMrpPaise !== b.revisedMrpPaise ||
    (a.oldRate ?? null) !== b.oldRate ||
    (a.newRate ?? null) !== b.newRate
  );
}

function effectiveDateTaken(book: PriceBook, proposal: Proposal): ApiError | null {
  const clashes: string[] = [];
  for (const row of proposal.rows) {
    const clash = book.world.notices.some((notice) => {
      if (notice.number === proposal.noticeNumber) return false;
      const version = latestVersion(notice);
      return (
        version.effectiveDate === proposal.effectiveDate &&
        version.rows.some((published) => published.skuCode === row.skuCode)
      );
    });
    if (clash && !clashes.includes(row.skuCode)) clashes.push(row.skuCode);
  }
  if (clashes.length === 0) return null;
  return new ApiError(
    409,
    'effective_date_taken',
    `Another notice already changes these packs on that date: ${clashes.join(', ')}.`,
    { rows: clashes },
  );
}

function laterRevisionExists(book: PriceBook, proposal: Proposal): ApiError | null {
  const later = laterRowsFor(book, proposal.noticeNumber);
  const baseRows = proposal.baseVersion?.rows ?? [];
  const baseDate = proposal.baseVersion?.effectiveDate ?? null;
  const skuCodes = new Set<string>([
    ...baseRows.map((row) => row.skuCode),
    ...proposal.rows.map((row) => row.skuCode),
  ]);
  const offending: { skuCode: string; noticeNumber: string; effectiveDate: IsoDate }[] = [];

  for (const skuCode of skuCodes) {
    const base = baseRows.find((row) => row.skuCode === skuCode) ?? null;
    const next = proposal.rows.find((row) => row.skuCode === skuCode) ?? null;
    const oldDate = base === null ? null : baseDate;
    const newDate = next === null ? null : proposal.effectiveDate;
    for (const candidate of later.filter((entry) => entry.skuCode === skuCode)) {
      const laterDate = candidate.effectiveDate;
      let broken = false;
      if (oldDate === null && newDate !== null && compareDates(newDate, laterDate) < 0) broken = true;
      if (oldDate !== null && compareDates(oldDate, laterDate) < 0) {
        if (newDate === null) broken = true;
        else if (compareDates(newDate, laterDate) > 0) broken = true;
        else if (base !== null && next !== null && rowsDiffer(base, next)) broken = true;
      }
      if (
        oldDate !== null &&
        newDate !== null &&
        compareDates(oldDate, laterDate) > 0 &&
        compareDates(newDate, laterDate) < 0
      ) {
        broken = true;
      }
      if (broken) {
        offending.push({ skuCode, noticeNumber: candidate.noticeNumber, effectiveDate: laterDate });
      }
    }
  }

  if (offending.length === 0) return null;
  const ordered = [...proposal.rows.map((row) => row.skuCode), ...baseRows.map((row) => row.skuCode)];
  offending.sort((a, b) => ordered.indexOf(a.skuCode) - ordered.indexOf(b.skuCode));
  const entries = offending
    .map((entry) => `${entry.skuCode} in ${entry.noticeNumber} from ${entry.effectiveDate}`)
    .join('; ');
  return new ApiError(409, 'later_revision_exists', `Later notice exists: ${entries}.`, { rows: offending });
}

function runOutBatchesStranded(book: PriceBook, proposal: Proposal): ApiError | null {
  const after = worldWithProposal(book, proposal);
  const stranded: string[] = [];
  for (const batch of book.world.batches) {
    if (!batch.oldWrapper) continue;
    if (after.qualifyingWrapperNotice(batch) === null) stranded.push(batch.code);
  }
  if (stranded.length === 0) return null;
  stranded.sort();
  return new ApiError(
    409,
    'run_out_batches_exist',
    `Old-wrapper batches would be stranded: ${stranded.join(', ')}.`,
    { batches: stranded },
  );
}

function ceilingExceeded(book: PriceBook, proposal: Proposal): ApiError | null {
  const blocked: { skuCode: string; name: string; revisedMrpPaise: number; ceilingPaise: number }[] = [];
  for (const row of proposal.rows) {
    if (row.kind !== 'sticker') continue;
    const oldMrpPaise = book.oldMrpPaiseFor(row.skuCode, proposal.effectiveDate, proposal.noticeNumber);
    const ceilingPaise = stickerCeilingPaise(oldMrpPaise, row.oldRate as number, row.newRate as number);
    if (row.revisedMrpPaise > ceilingPaise) {
      const sku = book.sku(row.skuCode);
      blocked.push({
        skuCode: row.skuCode,
        name: sku === null ? row.skuCode : book.skuNameOf(sku),
        revisedMrpPaise: row.revisedMrpPaise,
        ceilingPaise,
      });
    }
  }
  if (blocked.length === 0) return null;
  return new ApiError(
    422,
    'ceiling_exceeded',
    `Over the ceiling: ${blocked.map((row) => row.skuCode).join(', ')}.`,
    { rows: blocked },
  );
}

function rateDiscontinuity(book: PriceBook, proposal: Proposal): ApiError | null {
  const blocked: { skuCode: string; expectedOldRate: number; oldRate: number }[] = [];
  for (const row of proposal.rows) {
    if (row.kind !== 'sticker') continue;
    const expected = book.lastStickerRateBefore(row.skuCode, proposal.effectiveDate, proposal.noticeNumber);
    if (expected !== null && expected !== row.oldRate) {
      blocked.push({ skuCode: row.skuCode, expectedOldRate: expected, oldRate: row.oldRate as number });
    }
  }
  if (blocked.length === 0) return null;
  return new ApiError(
    422,
    'rate_discontinuity',
    `Rate does not follow the last notice: ${blocked.map((row) => row.skuCode).join(', ')}.`,
    { rows: blocked },
  );
}

/** The published publish checks, in their published order. The first failure answers. */
export function runPublishChecks(
  book: PriceBook,
  proposal: Proposal,
  todayDate: IsoDate,
  isCorrection: boolean,
): ApiError | null {
  const taken = effectiveDateTaken(book, proposal);
  if (taken !== null) return taken;

  const later = laterRevisionExists(book, proposal);
  if (later !== null) return later;

  if (isCorrection) {
    const stranded = runOutBatchesStranded(book, proposal);
    if (stranded !== null) return stranded;
  }

  if (proposal.rows.length === 0) {
    return new ApiError(422, 'no_rows', 'This notice has no rows.');
  }

  const seen = new Set<string>();
  for (const row of proposal.rows) {
    if (seen.has(row.skuCode)) {
      return validationError({ rows: `This notice lists ${row.skuCode} twice.` });
    }
    seen.add(row.skuCode);
    if (book.sku(row.skuCode) === null) {
      return validationError({ rows: `${row.skuCode} is not in the programme.` });
    }
  }

  const runOutFailure = runOutRuleFailure(proposal.effectiveDate, proposal.runOutUntil, proposal.rows);
  if (runOutFailure !== null) return validationError({ runOutUntil: runOutFailure });

  const dateChanged = proposal.baseVersion === null || proposal.baseVersion.effectiveDate !== proposal.effectiveDate;
  if (dateChanged && compareDates(proposal.effectiveDate, todayDate) < 0) {
    return new ApiError(422, 'effective_date_past', 'A notice cannot take effect before today.');
  }

  const ceiling = ceilingExceeded(book, proposal);
  if (ceiling !== null) return ceiling;

  return rateDiscontinuity(book, proposal);
}

/** The preview rows: old MRP, ceiling and the batches that would take a sticker. */
export function previewRows(book: PriceBook, proposal: Proposal): PreviewRow[] {
  const after = worldWithProposal(book, proposal);
  const noticeNumber = proposal.noticeNumber ?? PREVIEW_NOTICE_NUMBER;
  return proposal.rows.map((row) => {
    const sku = book.sku(row.skuCode);
    const oldMrpPaise = book.oldMrpPaiseFor(row.skuCode, proposal.effectiveDate, proposal.noticeNumber);
    const ceilingPaise =
      row.kind === 'sticker'
        ? stickerCeilingPaise(oldMrpPaise, row.oldRate as number, row.newRate as number)
        : null;
    const stickerBatches =
      row.kind === 'sticker'
        ? after
            .batchesOf(row.skuCode)
            .filter((batch) => {
              const facts = after.decide(batch, proposal.effectiveDate);
              return (
                facts.stickerApplies &&
                !facts.pastBestBefore &&
                facts.sourceNotice !== null &&
                facts.sourceNotice.number === noticeNumber
              );
            })
            .map((batch) => batch.code)
            .sort()
        : [];
    return {
      skuCode: row.skuCode,
      name: sku === null ? row.skuCode : book.skuNameOf(sku),
      kind: row.kind,
      oldMrpPaise,
      ceilingPaise,
      revisedMrpPaise: row.revisedMrpPaise,
      stickerBatches,
    };
  });
}

export function wrapperWindowAllows(book: PriceBook, skuCode: string, packedDate: IsoDate): boolean {
  return book.qualifyingWrapperNotice({ code: '', skuCode, packedDate, oldWrapper: true }) !== null;
}

export function dayBefore(date: IsoDate): IsoDate {
  return addDays(date, -1);
}
