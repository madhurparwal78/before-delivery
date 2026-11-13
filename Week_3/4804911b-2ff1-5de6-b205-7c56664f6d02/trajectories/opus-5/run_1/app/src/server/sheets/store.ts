import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { MatchedBy, RowReason, RowStatus, SheetRowState } from './resolve.js';
import { sheetCounts } from './resolve.js';

type Runner = Pick<PoolClient, 'query'>;

function runner(client?: Runner): Runner {
  return client ?? (pool as unknown as Runner);
}

export interface SheetMeta {
  id: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  importedAt: string;
  rowCount: number;
}

interface SheetRowShape {
  row_number: number;
  raw_code: string | null;
  raw_description: string | null;
  raw_new_mrp: string | null;
  raw_old_gst: string | null;
  raw_new_gst: string | null;
  status: RowStatus;
  matched_by: MatchedBy;
  sku_code: string | null;
  candidates: string[];
  reason: RowReason;
  new_mrp_paise: number | null;
  old_rate: number | null;
  new_rate: number | null;
  merged_into_row: number | null;
  ignored: boolean;
  final_settled: boolean;
}

interface SheetShape {
  id: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  imported_at: Date;
}

export async function sheetMetaById(id: string, client?: Runner): Promise<SheetMeta | null> {
  const result = await runner(client).query<SheetShape & { row_count: number }>(
    `select s.*, (select count(*)::bigint from sheet_rows r where r.sheet_id = s.id) as row_count
       from sheets s where s.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    importedAt: row.imported_at.toISOString(),
    rowCount: row.row_count,
  };
}

export async function sheetMetaBySha(sha256: string, client?: Runner): Promise<SheetMeta | null> {
  const result = await runner(client).query<{ id: string }>('select id from sheets where sha256 = $1', [sha256]);
  const row = result.rows[0];
  return row ? sheetMetaById(row.id, client) : null;
}

export async function allSheetMeta(client?: Runner): Promise<SheetMeta[]> {
  const result = await runner(client).query<{ id: string }>('select id from sheets order by seq');
  const sheets: SheetMeta[] = [];
  for (const row of result.rows) {
    const meta = await sheetMetaById(row.id, client);
    if (meta !== null) sheets.push(meta);
  }
  return sheets;
}

export async function loadSheetRows(sheetId: string, client?: Runner, forUpdate = false): Promise<SheetRowState[]> {
  const result = await runner(client).query<SheetRowShape>(
    `select * from sheet_rows where sheet_id = $1 order by row_number${forUpdate ? ' for update' : ''}`,
    [sheetId],
  );
  return result.rows.map((row) => ({
    rowNumber: row.row_number,
    raw: {
      code: row.raw_code,
      description: row.raw_description,
      newMrp: row.raw_new_mrp,
      oldGst: row.raw_old_gst,
      newGst: row.raw_new_gst,
    },
    status: row.status,
    matchedBy: row.matched_by,
    skuCode: row.sku_code,
    candidates: row.candidates,
    reason: row.reason,
    newMrpPaise: row.new_mrp_paise,
    oldRate: row.old_rate,
    newRate: row.new_rate,
    mergedIntoRow: row.merged_into_row,
    ignored: row.ignored,
    finalSettled: row.final_settled,
  }));
}

export async function insertSheetRows(
  client: PoolClient,
  sheetId: string,
  rows: SheetRowState[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `insert into sheet_rows
         (sheet_id, row_number, raw_code, raw_description, raw_new_mrp, raw_old_gst, raw_new_gst,
          status, matched_by, sku_code, candidates, reason, new_mrp_paise, old_rate, new_rate,
          merged_into_row, ignored, final_settled)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        sheetId,
        row.rowNumber,
        row.raw.code,
        row.raw.description,
        row.raw.newMrp,
        row.raw.oldGst,
        row.raw.newGst,
        row.status,
        row.matchedBy,
        row.skuCode,
        JSON.stringify(row.candidates),
        row.reason,
        row.newMrpPaise,
        row.oldRate,
        row.newRate,
        row.mergedIntoRow,
        row.ignored,
        row.finalSettled,
      ],
    );
  }
}

export async function updateSheetRows(
  client: PoolClient,
  sheetId: string,
  rows: SheetRowState[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `update sheet_rows set status = $3, matched_by = $4, sku_code = $5, candidates = $6, reason = $7,
              merged_into_row = $8, ignored = $9, final_settled = $10
        where sheet_id = $1 and row_number = $2`,
      [
        sheetId,
        row.rowNumber,
        row.status,
        row.matchedBy,
        row.skuCode,
        JSON.stringify(row.candidates),
        row.reason,
        row.mergedIntoRow,
        row.ignored,
        row.finalSettled,
      ],
    );
  }
}

export function sheetView(meta: SheetMeta, rows: SheetRowState[], reused: boolean): Record<string, unknown> {
  return {
    id: meta.id,
    filename: meta.filename,
    sha256: meta.sha256,
    sizeBytes: meta.sizeBytes,
    importedAt: meta.importedAt,
    rowCount: rows.length,
    counts: sheetCounts(rows),
    reused,
    rows: rows.map((row) => ({
      rowNumber: row.rowNumber,
      raw: {
        code: row.raw.code,
        description: row.raw.description,
        newMrp: row.raw.newMrp,
        oldGst: row.raw.oldGst,
        newGst: row.raw.newGst,
      },
      status: row.status,
      matchedBy: row.matchedBy,
      skuCode: row.skuCode,
      candidates: row.candidates,
      reason: row.reason,
      newMrpPaise: row.newMrpPaise,
      oldRate: row.oldRate,
      newRate: row.newRate,
      mergedIntoRow: row.mergedIntoRow,
      ignored: row.ignored,
    })),
  };
}

export function sheetSummaryView(meta: SheetMeta, counts: ReturnType<typeof sheetCounts>): Record<string, unknown> {
  return {
    id: meta.id,
    filename: meta.filename,
    sha256: meta.sha256,
    sizeBytes: meta.sizeBytes,
    importedAt: meta.importedAt,
    rowCount: meta.rowCount,
    counts,
    reused: false,
  };
}

export async function aliasMap(client?: Runner): Promise<Map<string, string>> {
  const result = await runner(client).query<{ normalised: string; sku_code: string }>(
    'select normalised, sku_code from aliases',
  );
  return new Map(result.rows.map((row) => [row.normalised, row.sku_code]));
}

export async function allSheetIds(client?: Runner): Promise<string[]> {
  const result = await runner(client).query<{ id: string }>('select id from sheets order by seq');
  return result.rows.map((row) => row.id);
}
