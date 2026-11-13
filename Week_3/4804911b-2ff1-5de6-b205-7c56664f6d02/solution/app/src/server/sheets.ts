import { createHash, randomBytes } from "node:crypto";
import type { Sheet, SheetRow } from "../shared/types.js";
import { nowIso } from "./clock.js";
import { db, tx, type Queryable, type Row } from "./db.js";
import { ApiError, notFound, storageUnavailable, validation } from "./errors.js";
import { exclusive } from "./locks.js";
import { searchChanged } from "./outbox.js";
import { insertDraft } from "./notices.js";
import { loadBook } from "./pricing.js";
import { checkRunOut, parseDay, parseRunOut, parseTitle, type RowInput } from "./rules.js";
import { applyDuplicates, resolveRow, type SRow } from "./sheetmatch.js";
import { parseSheet } from "./sheetparse.js";
import type { Upload } from "./http.js";
import { presign, sheetKey, storeOnce } from "./s3.js";
import { copyId } from "./meta.js";
import { providers } from "./status.js";

// Every desk change (import, settle) takes this key so cascades and duplicate rules see one consistent set of rows.
const DESK = "desk";

function rowOf(r: Row): SRow {
  return {
    rowNumber: r.row_number as number, raw: r.raw as SRow["raw"], normDesc: r.norm_desc as string, status: r.status as SRow["status"],
    matchedBy: (r.matched_by as SRow["matchedBy"]) ?? null, skuCode: (r.sku_code as string | null) ?? null, candidates: r.candidates as string[],
    reason: (r.reason as string | null) ?? null, newMrpPaise: (r.new_mrp_paise as number | null) ?? null, oldRate: (r.old_rate as number | null) ?? null,
    newRate: (r.new_rate as number | null) ?? null, mergedIntoRow: (r.merged_into_row as number | null) ?? null, ignored: r.ignored as boolean, final: r.final as boolean,
  };
}

function rowView(r: SRow): SheetRow {
  const open = r.status === "ambiguous" || r.status === "unmatched";
  return {
    rowNumber: r.rowNumber, raw: r.raw, status: r.status, matchedBy: r.matchedBy, skuCode: open ? null : r.skuCode, candidates: r.candidates,
    reason: r.reason, newMrpPaise: r.newMrpPaise, oldRate: r.oldRate, newRate: r.newRate, mergedIntoRow: r.mergedIntoRow, ignored: r.ignored,
  };
}

function sheetView(s: Row, rows: SRow[] | null, counts: Sheet["counts"], reused = false): Sheet {
  return {
    id: s.id as string, filename: s.filename as string, sha256: s.sha256 as string, sizeBytes: s.size_bytes as number,
    importedAt: (s.imported_at as Date).toISOString(), rowCount: s.row_count as number, counts, reused, ...(rows ? { rows: rows.map(rowView) } : {}),
  };
}

const countsOf = (rows: SRow[]): Sheet["counts"] => {
  const c = { matched: 0, ambiguous: 0, unmatched: 0, settled: 0 };
  for (const r of rows) c[r.status]++;
  return c;
};

async function loadRows(q: Queryable, sheetId: string): Promise<SRow[]> {
  return (await q.query("SELECT * FROM sheet_rows WHERE sheet_id = $1 ORDER BY row_number", [sheetId])).rows.map(rowOf);
}

async function writeRows(q: Queryable, sheetId: string, rows: SRow[]): Promise<void> {
  const payload = rows.map((r) => ({
    sheet_id: sheetId, row_number: r.rowNumber, raw: r.raw, norm_desc: r.normDesc, status: r.status, matched_by: r.matchedBy, sku_code: r.skuCode,
    candidates: r.candidates, reason: r.reason, new_mrp_paise: r.newMrpPaise, old_rate: r.oldRate, new_rate: r.newRate, merged_into_row: r.mergedIntoRow,
    ignored: r.ignored, final: r.final,
  }));
  await q.query(
    `INSERT INTO sheet_rows (sheet_id, row_number, raw, norm_desc, status, matched_by, sku_code, candidates, reason, new_mrp_paise, old_rate, new_rate, merged_into_row, ignored, final)
     SELECT sheet_id, row_number, raw, norm_desc, status, matched_by, sku_code, candidates, reason, new_mrp_paise, old_rate, new_rate, merged_into_row, ignored, final
     FROM jsonb_to_recordset($1::jsonb) AS x(sheet_id text, row_number int, raw jsonb, norm_desc text, status text, matched_by text, sku_code text, candidates jsonb, reason text,
       new_mrp_paise int, old_rate int, new_rate int, merged_into_row int, ignored boolean, final boolean)
     ON CONFLICT (sheet_id, row_number) DO UPDATE SET status = EXCLUDED.status, matched_by = EXCLUDED.matched_by, sku_code = EXCLUDED.sku_code,
       candidates = EXCLUDED.candidates, reason = EXCLUDED.reason, merged_into_row = EXCLUDED.merged_into_row, ignored = EXCLUDED.ignored, final = EXCLUDED.final`,
    [JSON.stringify(payload)],
  );
}

async function resolver(q: Queryable): Promise<{ skus: Awaited<ReturnType<typeof loadBook>>["skus"]; aliases: Map<string, string> }> {
  const book = await loadBook(q);
  const aliases = new Map((await q.query("SELECT alias, sku_code FROM aliases")).rows.map((a) => [a.alias as string, a.sku_code as string]));
  return { skus: book.skus, aliases };
}

export function importSheet(upload: Upload): Promise<{ status: 200 | 201; sheet: Sheet }> {
  const parsed = parseSheet(upload);
  const bytes = upload.bytes;
  const sha = createHash("sha256").update(bytes).digest("hex");
  return exclusive(DESK, async () => {
    const known = (await db.query("SELECT * FROM sheets WHERE sha256 = $1", [sha])).rows[0];
    if (known) {
      const rows = await loadRows(db, known.id as string);
      return { status: 200 as const, sheet: sheetView({ ...known, row_count: rows.length }, rows, countsOf(rows), true) };
    }
    if (!providers.storage) throw storageUnavailable();
    const copy = await copyId();
    try {
      await storeOnce(sheetKey(copy, sha), bytes, "application/octet-stream");
    } catch {
      throw storageUnavailable();
    }
    const context = await resolver(db);
    const rows = parsed.map((raw, i) => resolveRow(raw, i + 1, context));
    applyDuplicates(rows);
    const id = randomBytes(8).toString("hex");
    const record = await tx(async (q) => {
      const inserted = await q.query(
        "INSERT INTO sheets (id, filename, sha256, size_bytes, imported_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [id, upload.filename, sha, bytes.length, nowIso()],
      );
      await writeRows(q, id, rows);
      return inserted.rows[0]!;
    });
    return { status: 201 as const, sheet: sheetView({ ...record, row_count: rows.length }, rows, countsOf(rows)) };
  });
}

export async function listSheets(): Promise<Sheet[]> {
  const sheets = (await db.query("SELECT s.*, (SELECT count(*) FROM sheet_rows r WHERE r.sheet_id = s.id) AS row_count FROM sheets s ORDER BY s.seq")).rows;
  const tallies = (await db.query("SELECT sheet_id, status, count(*) AS n FROM sheet_rows GROUP BY sheet_id, status")).rows;
  return sheets.map((s) => {
    const counts = { matched: 0, ambiguous: 0, unmatched: 0, settled: 0 };
    for (const t of tallies) if (t.sheet_id === s.id) counts[t.status as keyof typeof counts] = t.n as number;
    return sheetView(s, null, counts);
  });
}

async function loadSheet(q: Queryable, id: string): Promise<{ record: Row; rows: SRow[] }> {
  const record = (await q.query("SELECT * FROM sheets WHERE id = $1", [id])).rows[0];
  if (!record) throw notFound();
  const rows = await loadRows(q, id);
  return { record: { ...record, row_count: rows.length }, rows };
}

export async function getSheet(id: string): Promise<Sheet> {
  const { record, rows } = await loadSheet(db, id);
  return sheetView(record, rows, countsOf(rows));
}

const isOpen = (r: SRow): boolean => r.status === "ambiguous" || r.status === "unmatched";

export function settleRow(sheetId: string, rowNumber: number, bodyRaw: unknown): Promise<Sheet> {
  const body = (bodyRaw && typeof bodyRaw === "object" ? bodyRaw : {}) as { skuCode?: unknown; ignore?: unknown };
  return exclusive(DESK, () =>
    tx(async (q) => {
      const { record, rows } = await loadSheet(q, sheetId);
      const row = rows.find((r) => r.rowNumber === rowNumber);
      if (!row) throw notFound();
      if (!isOpen(row)) throw new ApiError(409, "row_not_open", "That row is already settled.");
      const touched = new Map<string, SRow[]>([[sheetId, rows]]);
      if (body.ignore === true) {
        Object.assign(row, { status: "settled", ignored: true, skuCode: null, matchedBy: null, candidates: [], reason: null, mergedIntoRow: null });
      } else {
        const context = await resolver(q);
        if (typeof body.skuCode !== "string" || !context.skus.some((s) => s.code === body.skuCode)) throw validation({ skuCode: "Choose a pack from the catalogue." });
        if (row.reason === "unreadable_values") throw validation({ skuCode: "A row with unreadable values can only be ignored." });
        const sku = body.skuCode;
        Object.assign(row, { final: row.reason === "conflicting_prices", status: "settled", ignored: false, skuCode: sku, matchedBy: null, candidates: [], reason: null });
        if (row.normDesc) {
          await q.query("INSERT INTO aliases (alias, sku_code) VALUES ($1,$2) ON CONFLICT (alias) DO UPDATE SET sku_code = EXCLUDED.sku_code", [row.normDesc, sku]);
          await cascade(q, row, sku, touched);
          await searchChanged(q, [sku]);
        }
      }
      for (const [id, list] of touched) {
        applyDuplicates(list);
        await writeRows(q, id, list);
      }
      return sheetView(record, rows, countsOf(rows));
    }),
  );
}

/** A settled description re-resolves every open row with the same description, on every sheet, as matched by alias. */
async function cascade(q: Queryable, settled: SRow, sku: string, touched: Map<string, SRow[]>): Promise<void> {
  const same = (await q.query(
    "SELECT sheet_id FROM sheet_rows WHERE norm_desc = $1 AND status IN ('ambiguous', 'unmatched') AND reason IS DISTINCT FROM 'unreadable_values' AND reason IS DISTINCT FROM 'conflicting_prices' GROUP BY sheet_id",
    [settled.normDesc],
  )).rows;
  for (const { sheet_id } of same) {
    const id = sheet_id as string;
    const list = touched.get(id) ?? (await loadRows(q, id));
    touched.set(id, list);
    for (const r of list)
      if (r !== settled && r.normDesc === settled.normDesc && isOpen(r) && r.reason !== "unreadable_values" && r.reason !== "conflicting_prices")
        Object.assign(r, { status: "matched", matchedBy: "alias", skuCode: sku, candidates: [], reason: null });
  }
}

export async function draftFromSheet(sheetId: string, bodyRaw: unknown): Promise<string> {
  const body = (bodyRaw && typeof bodyRaw === "object" ? bodyRaw : {}) as Record<string, unknown>;
  const { rows } = await loadSheet(db, sheetId);
  const open = rows.filter(isOpen).length;
  if (open) throw new ApiError(409, "open_rows", `${open} ${open === 1 ? "row is" : "rows are"} still open on this sheet.`, { openRows: open });
  const title = parseTitle(body.title);
  const effectiveDate = parseDay(body.effectiveDate, "effectiveDate");
  const runOutUntil = parseRunOut(body.runOutUntil, null);
  const inputRows: RowInput[] = rows
    .filter((r) => (r.status === "matched" || r.status === "settled") && !r.ignored && r.mergedIntoRow === null && r.skuCode)
    .map((r) => ({
      skuCode: r.skuCode!, kind: r.oldRate !== null ? "sticker" : "new_print", revisedMrpPaise: r.newMrpPaise!, oldRate: r.oldRate, newRate: r.newRate,
    }));
  if (inputRows.length === 0) throw new ApiError(422, "no_rows", "This sheet has no settled rows to draft from.");
  const input = { title, effectiveDate, runOutUntil, rows: inputRows };
  checkRunOut(input);
  return insertDraft(db, input, sheetId);
}

export async function sheetLink(id: string): Promise<{ url: string; expiresInSeconds: 60; sha256: string }> {
  const { record } = await loadSheet(db, id);
  if (!providers.storage) throw storageUnavailable();
  const name = record.filename as string;
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const star = encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const url = presign(sheetKey(await copyId(), record.sha256 as string), {
    "response-content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${star}`,
  });
  return { url, expiresInSeconds: 60, sha256: record.sha256 as string };
}

