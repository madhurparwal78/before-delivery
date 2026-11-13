import { canonicalCategory, type Category } from './categories.js';
import { isDecimalText, toGrams, type EntryUnit } from './weights.js';
import type { ImportRowReason } from './types.js';

export const REQUIRED_COLUMNS = ['Item Name', 'Category', 'weight', 'unit'] as const;
export const MAX_DATA_ROWS = 2000;

export type CsvFileProblem =
  | { kind: 'unreadable' }
  | { kind: 'duplicate_column'; column: string }
  | { kind: 'missing_column'; column: string }
  | { kind: 'too_many_rows' };

export interface CsvFile {
  header: string[];
  records: string[][];
}

const UNITS: Record<string, EntryUnit> = {
  g: 'g',
  gram: 'g',
  grams: 'g',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  kg: 'kg',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
};

const PRICE = /^\$?(\d+)(?:\.(\d{2}))?$/;
const QTY = /^\d+$/;

/** Reads records exactly: quoted multi-line fields, `""`, and skipped empty lines. */
function readRecords(text: string): string[][] | null {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      started = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      fields.push(field);
      field = '';
      started = true;
      index += 1;
      continue;
    }
    if (char === '\n' || char === '\r') {
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
      if (started) {
        fields.push(field);
        records.push(fields);
        fields = [];
        field = '';
        started = false;
      }
      continue;
    }
    field += char;
    started = true;
    index += 1;
  }
  if (inQuotes) return null;
  if (started) {
    fields.push(field);
    records.push(fields);
  }
  return records;
}

export function readCsvFile(bytes: Uint8Array): { file: CsvFile } | { problem: CsvFileProblem } {
  const body =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return { problem: { kind: 'unreadable' } };
  }
  const records = readRecords(text);
  if (records === null) return { problem: { kind: 'unreadable' } };
  const [rawHeader, ...rawRows] = records;
  const header = (rawHeader ?? []).map((value) => value.trim());
  const seen = new Map<string, string>();
  for (const column of header) {
    const key = column.toLowerCase();
    if (seen.has(key)) return { problem: { kind: 'duplicate_column', column: seen.get(key) as string } };
    seen.set(key, column);
  }
  for (const required of REQUIRED_COLUMNS) {
    if (!seen.has(required.toLowerCase())) {
      return { problem: { kind: 'missing_column', column: required } };
    }
  }
  if (rawRows.length > MAX_DATA_ROWS) return { problem: { kind: 'too_many_rows' } };
  return { file: { header, records: rawRows.map((row) => row.map((value) => value.trim())) } };
}

export function columnIndex(header: string[], column: string): number {
  return header.findIndex((name) => name.toLowerCase() === column.toLowerCase());
}

export function cell(header: string[], row: string[], column: string): string {
  const index = columnIndex(header, column);
  if (index === -1) return '';
  return row[index] ?? '';
}

export interface AcceptedRow {
  name: string;
  category: Category;
  weightGrams: number;
  unitsOwned: number;
  notes: string;
  priceCents: number | null;
}

export function parsePriceCents(text: string): number | null {
  const match = PRICE.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const cents = match[2] === undefined ? 0 : Number(match[2]);
  return whole * 100 + cents;
}

/** The row value checks, in their published order. */
export function checkRow(
  header: string[],
  row: string[],
): { accepted: AcceptedRow } | { reason: ImportRowReason } {
  const name = cell(header, row, 'Item Name');
  if (name === '') return { reason: 'missing_name' };
  const category = canonicalCategory(cell(header, row, 'Category'));
  if (category === null) return { reason: 'unknown_category' };
  const weightText = cell(header, row, 'weight');
  if (!isDecimalText(weightText)) return { reason: 'invalid_weight' };
  const unit = UNITS[cell(header, row, 'unit').toLowerCase()];
  if (unit === undefined) {
    return { reason: 'unknown_unit' };
  }
  const weightGrams = toGrams(weightText, unit);
  if (weightGrams === null || weightGrams > 50000) return { reason: 'invalid_weight' };
  const qtyText = cell(header, row, 'qty');
  let unitsOwned = 1;
  if (qtyText !== '') {
    if (!QTY.test(qtyText)) return { reason: 'invalid_qty' };
    unitsOwned = Number(qtyText);
    if (unitsOwned < 1 || unitsOwned > 99) return { reason: 'invalid_qty' };
  }
  return {
    accepted: {
      name,
      category,
      weightGrams,
      unitsOwned,
      notes: cell(header, row, 'desc'),
      priceCents: parsePriceCents(cell(header, row, 'price')),
    },
  };
}

export const REJECTION_WORDS: Record<ImportRowReason, string> = {
  missing_name: 'Name is blank',
  unknown_category: 'Unknown category',
  invalid_weight: 'Invalid weight',
  unknown_unit: 'Unknown unit',
  invalid_qty: 'Invalid quantity',
};
