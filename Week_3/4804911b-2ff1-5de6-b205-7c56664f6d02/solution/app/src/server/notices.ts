import { randomBytes } from "node:crypto";
import type { Draft, NoticeVersion, Preview } from "../shared/types.js";
import { nowIso, today } from "./clock.js";
import { db, tx, type Queryable, type Row } from "./db.js";
import { queueNoticeDeliveries } from "./deliveries.js";
import { ApiError, notFound, validation } from "./errors.js";
import { exclusive, PRICE_HISTORY } from "./locks.js";
import { enqueue, renderJob, searchChanged } from "./outbox.js";
import { bookChanged, loadBook, type Book } from "./pricing.js";
import {
  checkRunOut, firstFailure, parseDay, parseRows, parseRunOut, parseTitle, previewRows, rowViews, staleDraft,
  type NoticeInput, type RowInput, type Subject,
} from "./rules.js";
import { loadNotices, withStates } from "./views.js";

interface DraftRecord { id: string; state: string; revision: number; input: NoticeInput; sheetId: string | null }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const asBody = (body: unknown): Record<string, unknown> => (body && typeof body === "object" ? (body as Record<string, unknown>) : {});

async function loadDraft(q: Queryable, id: string, lock = false): Promise<DraftRecord | null> {
  const r = (await q.query(`SELECT * FROM drafts WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id])).rows[0];
  return r ? draftOf(r) : null;
}

function draftOf(r: Row): DraftRecord {
  return {
    id: r.id as string, state: r.state as string, revision: r.revision as number, sheetId: (r.sheet_id as string | null) ?? null,
    input: { title: r.title as string, effectiveDate: r.effective_date as string, runOutUntil: (r.run_out_until as string | null) ?? null, rows: r.rows as RowInput[] },
  };
}

async function draftView(q: Queryable, book: Book, d: DraftRecord): Promise<Draft> {
  const sheet = d.sheetId ? (await q.query("SELECT sha256 FROM sheets WHERE id = $1", [d.sheetId])).rows[0] : undefined;
  return {
    id: d.id, state: "draft", revision: d.revision, title: d.input.title, effectiveDate: d.input.effectiveDate, runOutUntil: d.input.runOutUntil,
    sheet: d.sheetId && sheet ? { id: d.sheetId, sha256: sheet.sha256 as string } : null,
    rows: rowViews(book, d.input).map((v) => ({
      skuCode: v.skuCode, name: v.name, kind: v.kind, oldMrpPaise: v.oldMrpPaise, revisedMrpPaise: v.revisedMrpPaise, oldRate: v.oldRate, newRate: v.newRate, ceilingPaise: v.ceilingPaise,
    })),
  };
}

export async function draftViewById(q: Queryable, book: Book, id: string): Promise<Draft> {
  return draftView(q, book, (await loadDraft(q, id))!);
}

export async function listDrafts(q: Queryable, book: Book): Promise<Draft[]> {
  const rows = (await q.query("SELECT * FROM drafts WHERE state = 'draft' ORDER BY seq DESC")).rows;
  return Promise.all(rows.map((r) => draftView(q, book, draftOf(r))));
}

/** Everything a draft save checks about the typed values; the same code answers previews. */
function draftInput(body: Record<string, unknown>, book: Book): NoticeInput {
  const input: NoticeInput = {
    title: parseTitle(body.title), effectiveDate: parseDay(body.effectiveDate, "effectiveDate"),
    runOutUntil: parseRunOut(body.runOutUntil, null), rows: parseRows(body.rows, book),
  };
  checkRunOut(input);
  return input;
}

export async function insertDraft(q: Queryable, input: NoticeInput, sheetId: string | null): Promise<string> {
  const id = randomBytes(6).toString("hex");
  await q.query(
    "INSERT INTO drafts (id, revision, title, effective_date, run_out_until, sheet_id, rows) VALUES ($1, 1, $2, $3, $4, $5, $6)",
    [id, input.title, input.effectiveDate, input.runOutUntil, sheetId, JSON.stringify(input.rows)],
  );
  return id;
}

export async function createDraft(bodyRaw: unknown): Promise<Draft> {
  const book = await loadBook(db);
  const id = await insertDraft(db, draftInput(asBody(bodyRaw), book), null);
  return draftView(db, book, (await loadDraft(db, id))!);
}

/** The gates in front of a draft save or publish: not a draft any more, then the revision it was loaded at. */
function gateDraft(d: DraftRecord, body: Record<string, unknown>): void {
  if (d.state !== "draft") throw new ApiError(409, "not_draft", "That notice is already published.");
  if (!isInt(body.baseRevision)) throw validation({ baseRevision: "Send the revision you loaded." });
  if (body.baseRevision !== d.revision) throw staleDraft();
}

export async function saveDraft(id: string, bodyRaw: unknown): Promise<Draft> {
  const body = asBody(bodyRaw);
  const d = await loadDraft(db, id);
  if (!d) throw notFound();
  gateDraft(d, body);
  const book = await loadBook(db);
  const input = draftInput(body, book);
  const saved = await db.query(
    "UPDATE drafts SET revision = revision + 1, title = $3, effective_date = $4, run_out_until = $5, rows = $6 WHERE id = $1 AND revision = $2 AND state = 'draft' RETURNING *",
    [id, d.revision, input.title, input.effectiveDate, input.runOutUntil, JSON.stringify(input.rows)],
  );
  if (!saved.rows[0]) throw staleDraft();
  return draftView(db, book, draftOf(saved.rows[0]));
}

function subjectFor(book: Book, number: string | null): Subject {
  return { notice: number ? (book.notices.find((n) => n.number === number) ?? null) : null, today: today() };
}

async function previewOf(book: Book, subject: Subject, build: () => NoticeInput): Promise<Preview> {
  let input: NoticeInput;
  try {
    input = build();
  } catch (error) {
    if (error instanceof ApiError) return { blocking: error.body() as Preview["blocking"], rows: [] };
    throw error;
  }
  const failure = firstFailure(book, subject, input);
  return { blocking: (failure?.body() as Preview["blocking"]) ?? null, rows: previewRows(book, subject, input) };
}

export async function previewDraft(id: string, bodyRaw: unknown): Promise<Preview> {
  const body = asBody(bodyRaw);
  const d = await loadDraft(db, id);
  if (!d) throw notFound();
  const book = await loadBook(db);
  return previewOf(book, subjectFor(book, null), () => {
    gateDraft(d, body);
    return draftInput(body, book);
  });
}

async function nextNumber(q: Queryable): Promise<{ number: string; year: number; seq: number }> {
  const year = Number(today().slice(0, 4));
  const last = await q.query("SELECT coalesce(max(seq), 0) AS seq FROM notices WHERE year = $1", [year]);
  const seq = (last.rows[0]!.seq as number) + 1;
  return { number: `VT-${year}-${String(seq).padStart(2, "0")}`, year, seq };
}

async function writeVersion(
  q: Queryable, book: Book,
  args: { number: string; version: number; title: string; input: NoticeInput; reason: string | null; sheetId: string | null; previousSkus: string[] },
): Promise<void> {
  const { number, version, input } = args;
  await q.query(
    "INSERT INTO notice_versions (number, version, title, effective_date, run_out_until, published_at, reason, print_state, sheet_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)",
    [number, version, args.title, input.effectiveDate, input.runOutUntil, nowIso(), args.reason, args.sheetId],
  );
  const views = rowViews(book, input, number);
  for (const [i, v] of views.entries())
    await q.query(
      "INSERT INTO notice_rows (number, version, position, sku_code, name, kind, old_mrp_paise, revised_mrp_paise, old_rate, new_rate, ceiling_paise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [number, version, i, v.skuCode, v.name, v.kind, v.oldMrpPaise, v.revisedMrpPaise, v.oldRate, v.newRate, v.ceilingPaise],
    );
  await enqueue(q, renderJob(number, version));
  await searchChanged(q, [...input.rows.map((r) => r.skuCode), ...args.previousSkus]);
  await queueNoticeDeliveries(q, {
    number, version, supersedesVersion: version > 1 ? version - 1 : null, effectiveDate: input.effectiveDate, title: args.title,
    rows: views.map((v) => ({ skuCode: v.skuCode, name: v.name, kind: v.kind, oldMrpPaise: v.oldMrpPaise, revisedMrpPaise: v.revisedMrpPaise })),
  });
}

async function versionOf(number: string, version: number): Promise<NoticeVersion> {
  const [notice] = withStates(await loadNotices(db, [number]), today());
  return notice!.versions.find((v) => v.version === version)!;
}

export function publishDraft(id: string, bodyRaw: unknown): Promise<{ number: string; version: NoticeVersion }> {
  const body = asBody(bodyRaw);
  return exclusive(PRICE_HISTORY, async () => {
    const number = await tx(async (q) => {
      const d = await loadDraft(q, id, true);
      if (!d) throw notFound();
      gateDraft(d, body);
      const book = await loadBook(q);
      const failure = firstFailure(book, subjectFor(book, null), d.input);
      if (failure) throw failure;
      const numbered = await nextNumber(q);
      await q.query("INSERT INTO notices (number, year, seq) VALUES ($1,$2,$3)", [numbered.number, numbered.year, numbered.seq]);
      await writeVersion(q, book, { number: numbered.number, version: 1, title: d.input.title, input: d.input, reason: null, sheetId: d.sheetId, previousSkus: [] });
      await q.query("UPDATE drafts SET state = 'published' WHERE id = $1", [id]);
      return numbered.number;
    });
    bookChanged();
    return { number, version: await versionOf(number, 1) };
  });
}

interface CorrectionFacts { baseVersion: number; input: NoticeInput; reason: string }

function correctionInput(body: Record<string, unknown>, book: Book, latest: { version: number; title: string; runOutUntil: string | null }): CorrectionFacts {
  if (!isInt(body.baseVersion)) throw validation({ baseVersion: "Send the version you loaded." });
  if (body.baseVersion !== latest.version) throw new ApiError(409, "stale_version", "A newer version of this notice exists. Reload to see it.");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 500) throw validation({ reason: "Give a reason of up to 500 characters." });
  return {
    baseVersion: body.baseVersion, reason,
    input: {
      title: latest.title, effectiveDate: parseDay(body.effectiveDate, "effectiveDate"),
      runOutUntil: parseRunOut(body.runOutUntil, latest.runOutUntil), rows: parseRows(body.rows, book),
    },
  };
}

async function latestOf(q: Queryable, number: string): Promise<{ version: number; title: string; runOutUntil: string | null; sheetId: string | null }> {
  const r = (await q.query("SELECT * FROM notice_versions WHERE number = $1 ORDER BY version DESC LIMIT 1", [number])).rows[0];
  if (!r) throw notFound();
  return { version: r.version as number, title: r.title as string, runOutUntil: (r.run_out_until as string | null) ?? null, sheetId: (r.sheet_id as string | null) ?? null };
}

export async function previewCorrection(number: string, bodyRaw: unknown): Promise<Preview> {
  const body = asBody(bodyRaw);
  const latest = await latestOf(db, number);
  const book = await loadBook(db);
  return previewOf(book, subjectFor(book, number), () => correctionInput(body, book, latest).input);
}

export function correctNotice(number: string, bodyRaw: unknown): Promise<{ number: string; version: NoticeVersion }> {
  const body = asBody(bodyRaw);
  return exclusive(PRICE_HISTORY, async () => {
    const version = await tx(async (q) => {
      const latest = await latestOf(q, number);
      const book = await loadBook(q);
      const facts = correctionInput(body, book, latest);
      const subject = subjectFor(book, number);
      const failure = firstFailure(book, subject, facts.input);
      if (failure) throw failure;
      const next = latest.version + 1;
      const previousSkus = subject.notice!.rows.map((r) => r.skuCode);
      await writeVersion(q, book, { number, version: next, title: latest.title, input: facts.input, reason: facts.reason, sheetId: latest.sheetId, previousSkus });
      return next;
    });
    bookChanged();
    return { number, version: await versionOf(number, version) };
  });
}

export async function retryPrint(number: string, version: number): Promise<void> {
  await tx(async (q) => {
    const found = (await q.query("SELECT print_state FROM notice_versions WHERE number = $1 AND version = $2 FOR UPDATE", [number, version])).rows[0];
    if (!found) throw notFound();
    if (found.print_state !== "failed") throw new ApiError(409, "print_not_failed", "Only a version that failed to print can be printed again.");
    await q.query("UPDATE notice_versions SET print_state = 'pending' WHERE number = $1 AND version = $2", [number, version]);
    await enqueue(q, renderJob(number, version));
  });
}
