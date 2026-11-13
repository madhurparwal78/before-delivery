import { COPY } from "../shared/copy.js";
import { daysBetween, isRealDay } from "./clock.js";
import { ApiError, validation } from "./errors.js";
import { ceilingFor, oldMrpFor, stickerBatchesFor, type Book, type BookNotice } from "./pricing.js";

export interface RowInput { skuCode: string; kind: "sticker" | "new_print"; revisedMrpPaise: number; oldRate: number | null; newRate: number | null }
export interface NoticeInput { title: string; effectiveDate: string; runOutUntil: string | null; rows: RowInput[] }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isRate = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 100;
const RUN_OUT_DAYS = 180;
const MAX_PAISE = 1_000_000_000;

export const codePoints = (text: string): number => Array.from(text).length;

/** Shape and field checks shared by draft saves, previews and corrections. */
export function parseRows(raw: unknown, book: Book): RowInput[] {
  if (!Array.isArray(raw)) throw validation({ rows: "Rows must be a list." });
  return raw.map((item: unknown, i) => {
    const field = (name: string): string => `rows[${i}].${name}`;
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    if (typeof r.skuCode !== "string" || !book.bySku.has(r.skuCode)) fields[field("skuCode")] = "Choose a pack from the catalogue.";
    if (r.kind !== "sticker" && r.kind !== "new_print") fields[field("kind")] = "Kind is sticker or new_print.";
    if (!isInt(r.revisedMrpPaise) || r.revisedMrpPaise <= 0 || r.revisedMrpPaise > MAX_PAISE) fields[field("revisedMrpPaise")] = "Enter a price above zero in whole paise.";
    if (r.kind === "sticker") {
      if (!isRate(r.oldRate)) fields[field("oldRate")] = "Rates are whole percentages from 0 to 100.";
      if (!isRate(r.newRate)) fields[field("newRate")] = "Rates are whole percentages from 0 to 100.";
      if (isRate(r.oldRate) && isRate(r.newRate) && r.oldRate === r.newRate) fields[field("newRate")] = "The old and new rates must differ.";
    } else if (r.kind === "new_print") {
      if ((r.oldRate ?? null) !== null || (r.newRate ?? null) !== null) fields[field("oldRate")] = "A new-print row has no rates.";
    }
    if (Object.keys(fields).length) throw validation(fields);
    return {
      skuCode: r.skuCode as string, kind: r.kind as RowInput["kind"], revisedMrpPaise: r.revisedMrpPaise as number,
      oldRate: r.kind === "sticker" ? (r.oldRate as number) : null, newRate: r.kind === "sticker" ? (r.newRate as number) : null,
    };
  });
}

export function parseTitle(raw: unknown): string {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (!title || codePoints(title) > 200) throw validation({ title: "Give the notice a title of up to 200 characters." });
  return title;
}

export function parseDay(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !isRealDay(raw)) throw validation({ [field]: "Use a real date as YYYY-MM-DD." });
  return raw;
}

/** A run-out date needs a sticker row and falls from the effective date to 180 Kolkata days after it. */
export function checkRunOut(input: NoticeInput): void {
  if (input.runOutUntil === null) return;
  const sticker = input.rows.some((r) => r.kind === "sticker");
  const span = daysBetween(input.effectiveDate, input.runOutUntil);
  if (!sticker || span < 0 || span > RUN_OUT_DAYS)
    throw validation({ runOutUntil: sticker ? "Old wrappers can run out from the effective date to 180 days after it." : "Only a notice with a sticker row can allow old wrappers." });
}

export function parseRunOut(raw: unknown, fallback: string | null): string | null {
  if (raw === undefined) return fallback;
  return raw === null ? null : parseDay(raw, "runOutUntil");
}

export interface Subject {
  /** the notice a correction belongs to; null for a draft */
  notice: BookNotice | null;
  today: string;
}

interface RowView { skuCode: string; name: string; kind: RowInput["kind"]; oldMrpPaise: number; ceilingPaise: number | null; revisedMrpPaise: number; oldRate: number | null; newRate: number | null }

export function rowViews(book: Book, input: NoticeInput, excludeNumber?: string): RowView[] {
  return input.rows.map((r) => {
    const oldMrpPaise = oldMrpFor(book, r.skuCode, input.effectiveDate, excludeNumber);
    return {
      skuCode: r.skuCode, name: book.bySku.get(r.skuCode)!.name, kind: r.kind, oldMrpPaise, revisedMrpPaise: r.revisedMrpPaise,
      oldRate: r.oldRate, newRate: r.newRate, ceilingPaise: r.kind === "sticker" ? ceilingFor(oldMrpPaise, r.oldRate!, r.newRate!) : null,
    };
  });
}

const codes = (list: string[]): string => list.join(", ");
const sameRow = (a: { kind: string; revisedMrpPaise: number; oldRate: number | null; newRate: number | null }, b: RowInput): boolean =>
  a.kind === b.kind && a.revisedMrpPaise === b.revisedMrpPaise && a.oldRate === b.oldRate && a.newRate === b.newRate;

const CANDIDATE = "__candidate__";

/** The candidate as the book will hold it once published: its number is the notice's own, or a placeholder for a draft. */
function candidateOf(subject: Subject, input: NoticeInput): BookNotice {
  const version = (subject.notice?.version ?? 0) + 1;
  return {
    number: subject.notice?.number ?? CANDIDATE, version, effectiveDate: input.effectiveDate, runOutUntil: input.runOutUntil,
    rows: input.rows.map((r) => ({ ...r, name: "", oldMrpPaise: 0, ceilingPaise: null })),
  };
}

/** The publish checks of the brief, in order. The first failure is the answer. Returns null when the action would succeed. */
export function firstFailure(book: Book, subject: Subject, input: NoticeInput): ApiError | null {
  const self = subject.notice;
  const others = book.notices.filter((n) => n.number !== self?.number);
  const skus = [...new Set(input.rows.map((r) => r.skuCode))];

  if (self && self.effectiveDate <= subject.today && input.effectiveDate !== self.effectiveDate)
    return new ApiError(409, "effective_date_locked", "The effective date of a notice already in effect can't change.");

  const taken = skus.filter((s) => others.some((n) => n.effectiveDate === input.effectiveDate && n.rows.some((r) => r.skuCode === s)));
  if (taken.length) return new ApiError(409, "effective_date_taken", `Another notice already revises these packs on that date: ${codes(taken)}.`, { rows: taken });

  const later: { skuCode: string; noticeNumber: string; effectiveDate: string }[] = [];
  for (const sku of skus) {
    const added = input.rows.find((r) => r.skuCode === sku)!;
    const was = self?.rows.find((r) => r.skuCode === sku) ?? null;
    for (const other of others) {
      if (!other.rows.some((r) => r.skuCode === sku)) continue;
      const c = other.effectiveDate;
      const violates = was === null ? input.effectiveDate < c : self!.effectiveDate < c ? !sameRow(was, added) || input.effectiveDate > c : input.effectiveDate < c;
      if (violates) later.push({ skuCode: sku, noticeNumber: other.number, effectiveDate: c });
    }
  }
  if (self) {
    for (const was of self.rows) {
      if (skus.includes(was.skuCode)) continue;
      for (const other of others)
        if (other.effectiveDate > self.effectiveDate && other.rows.some((r) => r.skuCode === was.skuCode))
          later.push({ skuCode: was.skuCode, noticeNumber: other.number, effectiveDate: other.effectiveDate });
    }
  }
  if (later.length)
    return new ApiError(409, "later_revision_exists", `Later notice exists: ${later.map((l) => `${l.skuCode} in ${l.noticeNumber} from ${l.effectiveDate}`).join("; ")}.`, { rows: later });

  if (self) {
    const hypothetical = { ...book, notices: [...others, candidateOf(subject, input)] };
    const stranded = book.batches
      .filter((b) => b.oldWrapper)
      .filter((b) => !hypotheticalQualifies(hypothetical, b.skuCode, b.packedDate))
      .map((b) => b.code)
      .sort();
    if (stranded.length)
      return new ApiError(409, "run_out_batches_exist", `Old-wrapper batches would be stranded: ${codes(stranded)}.`, { batches: stranded });
  }

  if (input.rows.length === 0) return new ApiError(422, "no_rows", "Add at least one row before publishing.");
  if (skus.length !== input.rows.length) return validation({ rows: "A pack can appear only once in a notice." });
  try {
    checkRunOut(input);
  } catch (error) {
    return error as ApiError;
  }

  if ((!self || input.effectiveDate !== self.effectiveDate) && input.effectiveDate < subject.today)
    return new ApiError(422, "effective_date_past", "The effective date can't be before today.");

  const views = rowViews(book, input, self?.number);
  const over = views.filter((v) => v.kind === "sticker" && v.revisedMrpPaise > v.ceilingPaise!);
  if (over.length)
    return new ApiError(422, "ceiling_exceeded", `Over the ceiling: ${codes(over.map((v) => v.skuCode))}.`, {
      rows: over.map((v) => ({ skuCode: v.skuCode, name: v.name, revisedMrpPaise: v.revisedMrpPaise, ceilingPaise: v.ceilingPaise })),
    });

  const broken = input.rows.flatMap((r) => {
    if (r.kind !== "sticker") return [];
    let expected: number | null = null;
    let at = "";
    for (const other of others) {
      const row = other.rows.find((x) => x.skuCode === r.skuCode && x.kind === "sticker");
      if (row && other.effectiveDate < input.effectiveDate && other.effectiveDate > at) {
        at = other.effectiveDate;
        expected = row.newRate;
      }
    }
    return expected !== null && expected !== r.oldRate ? [{ skuCode: r.skuCode, expectedOldRate: expected, oldRate: r.oldRate }] : [];
  });
  if (broken.length) return new ApiError(422, "rate_discontinuity", `Rate does not follow the last notice: ${codes(broken.map((b) => b.skuCode))}.`, { rows: broken });
  return null;
}

function hypotheticalQualifies(book: Book, skuCode: string, packedDate: string): boolean {
  return book.notices.some(
    (n) => n.runOutUntil !== null && packedDate >= n.effectiveDate && packedDate <= n.runOutUntil && n.rows.some((r) => r.skuCode === skuCode && r.kind === "sticker"),
  );
}

interface PreviewRow { skuCode: string; name: string; kind: RowInput["kind"]; oldMrpPaise: number; ceilingPaise: number | null; revisedMrpPaise: number; stickerBatches: string[] }

export function previewRows(book: Book, subject: Subject, input: NoticeInput): PreviewRow[] {
  const candidate = candidateOf(subject, input);
  return rowViews(book, input, subject.notice?.number).map((v) => ({
    skuCode: v.skuCode, name: v.name, kind: v.kind, oldMrpPaise: v.oldMrpPaise, ceilingPaise: v.ceilingPaise, revisedMrpPaise: v.revisedMrpPaise,
    stickerBatches: v.kind === "sticker" ? stickerBatchesFor(book, candidate, v.skuCode) : [],
  }));
}

export const staleDraft = (): ApiError => new ApiError(409, "stale_draft", COPY.staleDraft);
