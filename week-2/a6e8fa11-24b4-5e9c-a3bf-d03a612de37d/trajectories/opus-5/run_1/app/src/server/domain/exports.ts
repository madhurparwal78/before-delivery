import { ExportDto } from '../../shared/api';
import { csvDocument, csvField } from '../../shared/csv';
import { columnLetter, parseCellRef } from '../../shared/refs';
import { WorkbookState } from '../../shared/workbook';
import { query, transaction } from '../db';
import { queueMail } from '../services/mail';
import { StorageDown, putObject } from '../services/storage';
import { evaluate, loadWorkbookState } from './state';
import { ExportSheet, writeXlsx } from './xlsx';

export interface ExportRow {
  id: string;
  workbook_id: string;
  member_id: string;
  format: 'xlsx' | 'csv';
  sheet_id: string | null;
  file_name: string;
  status: 'pending' | 'waiting_for_storage' | 'ready';
  seq: number;
  object_key: string | null;
  origin: string;
  created_at: Date;
  ready_at: Date | null;
}

export function exportDto(row: ExportRow): ExportDto {
  return {
    id: row.id,
    format: row.format,
    sheetId: row.sheet_id,
    fileName: row.file_name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    readyAt: row.ready_at ? row.ready_at.toISOString() : null,
  };
}

export function fileNamePart(text: string): string {
  return text.replace(/[^A-Za-z0-9-]/g, '-');
}

export function exportFileName(workbookName: string, sheetName: string | null, format: 'xlsx' | 'csv'): string {
  const base = fileNamePart(workbookName);
  return format === 'csv' ? `${base}-${fileNamePart(sheetName ?? '')}.csv` : `${base}.xlsx`;
}

export function exportObjectKey(stationId: string, exportId: string, fileName: string): string {
  return `stations/${stationId}/exports/${exportId}/${fileName}`;
}

function sheetBounds(state: WorkbookState, sheetId: string): { lastRow: number; lastColumn: number } {
  const sheet = state.sheets.find((candidate) => candidate.id === sheetId);
  let lastRow = 0;
  let lastColumn = 0;
  for (const [ref, cell] of sheet ? sheet.cells : []) {
    if (cell.input === '') continue;
    const address = parseCellRef(ref);
    if (!address) continue;
    lastRow = Math.max(lastRow, address.row);
    lastColumn = Math.max(lastColumn, address.col);
  }
  return { lastRow, lastColumn };
}

export async function buildExportFile(
  row: ExportRow,
  workbook: { id: string; name: string; station_id: string },
  timeZone: string,
): Promise<{ body: Buffer; contentType: string }> {
  const { state } = await loadWorkbookState(workbook.id, undefined, row.seq);
  const evaluation = evaluate(state, timeZone);
  if (row.format === 'csv') {
    const sheetId = row.sheet_id as string;
    const { lastRow, lastColumn } = sheetBounds(state, sheetId);
    const rows: string[][] = [];
    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber++) {
      const fields: string[] = [];
      for (let column = 1; column <= lastColumn; column++) {
        const ref = `${columnLetter(column)}${rowNumber}`;
        const cell = evaluation.cell(sheetId, ref);
        fields.push(cell ? csvField(cell.value, cell.display) : '');
      }
      rows.push(fields);
    }
    return { body: Buffer.from(csvDocument(rows), 'utf8'), contentType: 'text/csv; charset=utf-8' };
  }
  const sheets: ExportSheet[] = state.sheets.map((sheet) => ({
    name: sheet.name,
    cells: [...sheet.cells.keys()]
      .map((ref) => {
        const address = parseCellRef(ref);
        const cell = evaluation.cell(sheet.id, ref);
        if (!address || !cell) return null;
        return {
          ref,
          column: address.col,
          row: address.row,
          input: cell.input,
          value: cell.value,
          numberFormat: cell.numberFormat,
          bold: cell.bold,
        };
      })
      .filter((cell): cell is ExportSheet['cells'][number] => cell !== null),
  }));
  return {
    body: writeXlsx(sheets),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

interface PendingExportRow extends ExportRow {
  workbook_name: string;
  station_id: string;
  time_zone: string;
  member_email: string;
}

/** An export becomes ready, and its email is queued, only after its file exists in storage. */
export async function processPendingExports(): Promise<void> {
  const rows = await query<PendingExportRow>(
    `select e.*, w.name as workbook_name, w.station_id, s.time_zone, m.email as member_email
     from exports e
     join workbooks w on w.id = e.workbook_id
     join stations s on s.id = w.station_id
     join members m on m.id = e.member_id
     where e.status in ('pending','waiting_for_storage')
     order by e.created_at asc limit 5`,
  );
  for (const row of rows) {
    try {
      const file = await buildExportFile(
        row,
        { id: row.workbook_id, name: row.workbook_name, station_id: row.station_id },
        row.time_zone,
      );
      const key = exportObjectKey(row.station_id, row.id, row.file_name);
      await putObject(key, file.body, file.contentType);
      await transaction(async (client) => {
        const updated = await client.query(
          `update exports set status = 'ready', ready_at = now(), object_key = $2
           where id = $1 and status <> 'ready' returning id`,
          [row.id, key],
        );
        if (updated.rows.length === 0) return;
        await queueMail(client, {
          to: row.member_email,
          subject: `Your export of ${row.workbook_name} is ready`,
          body:
            `${row.file_name} is ready to download.\n\n` +
            `${row.origin}/api/exports/${row.id}/download\n`,
        });
      });
    } catch (failure) {
      if (failure instanceof StorageDown) {
        await query("update exports set status = 'waiting_for_storage' where id = $1 and status = 'pending'", [row.id]);
        continue;
      }
      process.stderr.write(`export ${row.id} failed: ${String(failure)}\n`);
    }
  }
}
