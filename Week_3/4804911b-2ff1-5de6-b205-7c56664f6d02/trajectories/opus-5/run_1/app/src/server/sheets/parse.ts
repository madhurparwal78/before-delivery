import { ApiError } from '../domain/errors.js';
import { sentences } from '../domain/sentences.js';

export const MAX_SHEET_BYTES = 2_000_000;
export const MAX_SHEET_ROWS = 5_000;

const WHITESPACE = /[\s\u00a0]+/g;

export function trimSpaces(value: string): string {
  return value.replace(/^[\s\u00a0]+/, '').replace(/[\s\u00a0]+$/, '');
}

export function collapseSpaces(value: string): string {
  return trimSpaces(value.replace(WHITESPACE, ' '));
}

export interface RawSheetRow {
  rowNumber: number;
  code: string | null;
  description: string | null;
  newMrp: string | null;
  oldGst: string | null;
  newGst: string | null;
}

export interface ParsedSheet {
  rows: RawSheetRow[];
}

function refuse(status: number, error: string, message: string): never {
  throw new ApiError(status, error, message);
}

function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let index = 0;
  let inQuotes = false;
  let fieldWasQuoted = false;
  let fieldStart = true;

  const endField = (): void => {
    record.push(field);
    field = '';
    fieldWasQuoted = false;
    fieldStart = true;
  };
  const endRecord = (): void => {
    endField();
    const blank = record.length === 1 && trimSpaces(record[0]) === '';
    if (!blank) records.push(record);
    record = [];
  };

  while (index < text.length) {
    const ch = text[index];
    if (inQuotes) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        const next = text[index];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          refuse(422, 'sheet_bad_quoting', sentences.badSheetQuoting);
        }
        continue;
      }
      field += ch;
      index += 1;
      continue;
    }
    if (ch === '"') {
      if (fieldStart && field === '') {
        inQuotes = true;
        fieldWasQuoted = true;
        fieldStart = false;
        index += 1;
        continue;
      }
      refuse(422, 'sheet_bad_quoting', sentences.badSheetQuoting);
    }
    if (ch === ',') {
      endField();
      index += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[index + 1] === '\n') index += 1;
      index += 1;
      endRecord();
      continue;
    }
    field += ch;
    fieldStart = false;
    index += 1;
  }
  if (inQuotes) refuse(422, 'sheet_bad_quoting', sentences.badSheetQuoting);
  if (field !== '' || record.length > 0 || fieldWasQuoted) endRecord();
  return records;
}

/** Judges a sheet by its bytes, in the published refusal order, and stores nothing. */
export function parseSheet(bytes: Buffer): ParsedSheet {
  if (bytes.byteLength > MAX_SHEET_BYTES) {
    refuse(413, 'sheet_too_large', `This sheet is over the ${MAX_SHEET_BYTES} byte limit.`);
  }
  const signature = bytes.subarray(0, 4).toString('latin1');
  if (signature === 'PK\u0003\u0004' || signature === 'PK\u0005\u0006' || signature === 'PK\u0007\u0008') {
    refuse(
      415,
      'sheet_is_archive',
      'This is a workbook or archive, not a text price sheet. Save it as CSV first.',
    );
  }
  if (bytes.includes(0)) {
    refuse(422, 'sheet_has_nul', "This sheet contains NUL bytes and can't be read as text.");
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    refuse(422, 'sheet_not_utf8', "This sheet isn't UTF-8 text.");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = splitRecords(text);
  if (records.length === 0) {
    refuse(422, 'sheet_bad_header', 'This sheet needs description and new_mrp columns.');
  }
  const header = records[0].map((cell) => collapseSpaces(cell).toLowerCase());
  const columnOf = (name: string): number => header.indexOf(name);
  const descriptionAt = columnOf('description');
  const newMrpAt = columnOf('new_mrp');
  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_SHEET_ROWS) {
    refuse(422, 'sheet_too_many_rows', `This sheet has more than ${MAX_SHEET_ROWS} rows.`);
  }
  if (descriptionAt < 0 || newMrpAt < 0) {
    refuse(422, 'sheet_bad_header', 'This sheet needs description and new_mrp columns.');
  }
  if (dataRecords.length === 0) {
    refuse(422, 'sheet_empty', 'This sheet has no rows.');
  }
  const codeAt = columnOf('code');
  const oldGstAt = columnOf('old_gst');
  const newGstAt = columnOf('new_gst');

  const rows = dataRecords.map((record, index) => ({
    rowNumber: index + 1,
    code: codeAt < 0 ? null : record[codeAt] ?? null,
    description: record[descriptionAt] ?? null,
    newMrp: record[newMrpAt] ?? null,
    oldGst: oldGstAt < 0 ? null : record[oldGstAt] ?? null,
    newGst: newGstAt < 0 ? null : record[newGstAt] ?? null,
  }));
  return { rows };
}

/** Reads an Indian price into integer paise, or null when it cannot be read. */
export function parseMrpPaise(raw: string | null): number | null {
  if (raw === null) return null;
  let text = collapseSpaces(raw);
  if (text === '') return null;
  text = text.replace(/^(?:Rs\.?|₹)\s*/i, '');
  text = text.replace(/\s*\/-$/, '');
  text = text.replace(/\s+/g, '');
  if (!/^\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const plain = text.replace(/,/g, '');
  const [whole, fraction = ''] = plain.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isFinite(paise) ? paise : null;
}

export function parseRate(raw: string | null): number | null {
  if (raw === null) return null;
  const text = collapseSpaces(raw).replace(/\s*%$/, '');
  if (text === '') return null;
  if (!/^\d{1,3}$/.test(text)) return null;
  const rate = Number(text);
  return rate >= 0 && rate <= 100 ? rate : null;
}

export function rateIsBlank(raw: string | null): boolean {
  return raw === null || collapseSpaces(raw) === '';
}
