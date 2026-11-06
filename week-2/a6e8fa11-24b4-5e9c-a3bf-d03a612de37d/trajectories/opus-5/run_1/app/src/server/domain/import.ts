import { LIMITS, MAX_SHEET_NAME_CHARS } from '../../shared/limits';
import { ApiError } from '../http/errors';
import { ImportedSheet, readXlsx } from './xlsx';
import { looksLikeZip, readCentralDirectory } from './zip';

export type ImportKind = 'xlsx' | 'csv';

export interface ImportResult {
  kind: ImportKind;
  sheets: ImportedSheet[];
}

function limitError(code: string, limit?: number): ApiError {
  return new ApiError(422, code, 'That file was refused by an import limit.', limit === undefined ? {} : { limit });
}

function unsupported(): ApiError {
  return new ApiError(415, 'unsupported_file', "That file isn't a real .xlsx or .csv workbook.");
}

function isValidUtf8(data: Buffer): boolean {
  if (data.includes(0)) return false;
  return Buffer.compare(Buffer.from(data.toString('utf8'), 'utf8'), data) === 0;
}

export function sanitiseSheetName(name: string): string {
  const cleaned = name.replace(/['!\[\]:*?/\\]/g, '-').slice(0, MAX_SHEET_NAME_CHARS);
  return cleaned.length > 0 ? cleaned : 'Sheet';
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let at = 0;
  while (at < text.length) {
    const ch = text[at];
    if (quoted) {
      if (ch === '"') {
        if (text[at + 1] === '"') {
          field += '"';
          at += 2;
          continue;
        }
        quoted = false;
        at += 1;
        continue;
      }
      field += ch;
      at += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      at += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      at += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      at += ch === '\r' && text[at + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    at += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Checks run in order: content type, archive checks, then content limits. */
export function readImportFile(data: Buffer, fileName: string): ImportResult {
  if (looksLikeZip(data)) {
    const entries = readCentralDirectory(data);
    if (!entries || !entries.some((entry) => entry.name === 'xl/workbook.xml')) throw unsupported();

    let expanded = 0;
    for (const entry of entries) expanded += entry.uncompressedSize;
    if (expanded > LIMITS.maxImportExpandedBytes) {
      throw limitError('archive_too_large', LIMITS.maxImportExpandedBytes);
    }
    for (const entry of entries) {
      const ratio = entry.compressedSize === 0 ? (entry.uncompressedSize > 0 ? Infinity : 0) : entry.uncompressedSize / entry.compressedSize;
      if (ratio > LIMITS.maxCompressionRatio) throw limitError('archive_too_compressed', LIMITS.maxCompressionRatio);
    }
    for (const entry of entries) {
      if (entry.name.includes('..') || entry.name.startsWith('/') || entry.name.startsWith('\\') || /^[A-Za-z]:/.test(entry.name)) {
        throw limitError('unsafe_archive');
      }
    }

    const read = readXlsx(data, entries, {
      maxCells: LIMITS.maxImportCells,
      maxColumns: LIMITS.maxColumns,
      maxRows: LIMITS.maxRows,
    });
    if (!read.ok) {
      if (read.reason === 'too_many_cells') throw limitError('too_many_cells', LIMITS.maxImportCells);
      throw unsupported();
    }
    if (read.sheets.length > LIMITS.maxSheets) throw limitError('too_many_sheets', LIMITS.maxSheets);
    return {
      kind: 'xlsx',
      sheets: read.sheets.map((sheet) => ({ name: sanitiseSheetName(sheet.name), cells: sheet.cells })),
    };
  }

  const withoutBom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.slice(3) : data;
  if (!isValidUtf8(withoutBom)) throw unsupported();
  const rows = parseCsv(withoutBom.toString('utf8'));
  const cells = new Map<string, { input: string; numberFormat: 'general'; bold: false }>();
  let filled = 0;
  rows.forEach((row, rowIndex) => {
    row.forEach((field, columnIndex) => {
      if (field === '') return;
      if (columnIndex + 1 > LIMITS.maxColumns || rowIndex + 1 > LIMITS.maxRows) {
        throw limitError('too_many_cells', LIMITS.maxImportCells);
      }
      filled += 1;
      if (filled > LIMITS.maxImportCells) throw limitError('too_many_cells', LIMITS.maxImportCells);
      const ref = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
      cells.set(ref, { input: field.startsWith('=') ? `'${field}` : field, numberFormat: 'general', bold: false });
    });
  });
  const base = fileName.replace(/\.[^.]*$/, '');
  return { kind: 'csv', sheets: [{ name: sanitiseSheetName(base), cells }] };
}
