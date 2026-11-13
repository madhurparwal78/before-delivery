import { parseCsv, type CsvRecord } from './csv.js';
import { convertToGrams } from './weights.js';
import { canonicalCategory, type Category } from './types.js';
import { normaliseName } from './names.js';
import { ImportFileError } from './importError.js';

export { ImportFileError };

/**
 * Import file checks and row value checks. One decision for what a legacy
 * gear-list CSV may contain, in the published order.
 */

export const REQUIRED_COLUMNS = ['Item Name', 'Category', 'weight', 'unit'] as const;

export type FileCheckFailure =
  | { kind: 'unreadable' }
  | { kind: 'duplicate_column'; column: string }
  | { kind: 'missing_column'; column: string }
  | { kind: 'too_many_rows' };

export type RowReason = 'missing_name' | 'unknown_category' | 'invalid_weight' | 'unknown_unit' | 'invalid_qty';

export interface ImportRowInput {
  readonly name: string;
  readonly category: string;
  readonly weight: string;
  readonly unit: string;
  readonly qty: string;
  readonly desc: string;
  readonly price: string;
}

export interface ImportRowParsed {
  readonly row: number;
  readonly name: string;
  readonly category: string;
  readonly reason: RowReason | null;
  readonly grams: number | null;
  readonly categoryCanonical: Category | null;
  readonly qty: number | null;
  readonly priceCents: number | null;
  readonly notes: string;
}

const ACCEPTED_UNITS: Record<string, 'g' | 'oz' | 'lb' | 'kg'> = {
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

const MAX_ROWS = 2000;

/** A file check failure with its published field message. */
export class ImportCheckError extends ImportFileError {
  readonly failure: FileCheckFailure;
  constructor(failure: FileCheckFailure, fieldMessage: string) {
    super(fieldMessage);
    this.failure = failure;
  }
}

/** Header check: duplicate then missing required columns, in published order. */
function checkHeader(header: string[]): void {
  const seen = new Map<string, string>();
  for (const raw of header) {
    const key = raw.trim().toLowerCase();
    if (seen.has(key)) throw new ImportCheckError({ kind: 'duplicate_column', column: seen.get(key) ?? raw.trim() }, `Duplicate column: ${seen.get(key) ?? raw.trim()}`);
    seen.set(key, raw.trim());
  }
  for (const required of REQUIRED_COLUMNS) {
    if (!seen.has(required.toLowerCase())) throw new ImportCheckError({ kind: 'missing_column', column: required }, `Missing column: ${required}`);
  }
}

/** Reads a whole import file: file checks first, then one parsed row per record. */
export function readImportFile(bytes: Uint8Array): { rows: ImportRowParsed[]; rawRecords: CsvRecord[] } {
  const records = parseCsv(bytes);
  const header = records[0]?.fields ?? [];
  checkHeader(header);
  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_ROWS) {
    throw new ImportCheckError({ kind: 'too_many_rows' }, 'A file can have at most 2000 rows.');
  }
  const columns = indexColumns(header);
  const rows = dataRecords.map((record, index) => parseRow(record, index + 1, columns));
  return { rows, rawRecords: dataRecords };
}

interface ColumnIndex {
  name: number | null;
  category: number | null;
  weight: number | null;
  unit: number | null;
  qty: number | null;
  desc: number | null;
  price: number | null;
}

function indexColumns(header: string[]): ColumnIndex {
  const find = (name: string): number | null => {
    const index = header.findIndex((value) => value.trim().toLowerCase() === name);
    return index >= 0 ? index : null;
  };
  return {
    name: find('item name'),
    category: find('category'),
    weight: find('weight'),
    unit: find('unit'),
    qty: find('qty'),
    desc: find('desc'),
    price: find('price'),
  };
}

function fieldAt(record: CsvRecord, index: number | null): string {
  if (index === null) return '';
  const value = record.fields[index];
  return value === undefined ? '' : value;
}

/** Row checks in their published order; the first failure is the row's reason. */
function parseRow(record: CsvRecord, rowNumber: number, columns: ColumnIndex): ImportRowParsed {
  const name = fieldAt(record, columns.name).trim();
  const category = fieldAt(record, columns.category).trim();
  const weight = fieldAt(record, columns.weight).trim();
  const unit = fieldAt(record, columns.unit).trim();
  const qty = fieldAt(record, columns.qty).trim();
  const desc = fieldAt(record, columns.desc).trim();
  const price = fieldAt(record, columns.price).trim();

  const base: ImportRowParsed = {
    row: rowNumber,
    name,
    category,
    reason: null,
    grams: null,
    categoryCanonical: null,
    qty: null,
    priceCents: null,
    notes: desc,
  };
  if (name === '') return { ...base, reason: 'missing_name' };
  const canonical = canonicalCategory(category);
  if (canonical === null) return { ...base, reason: 'unknown_category' };
  if (!/^\d+(\.\d+)?$/.test(weight)) return { ...base, reason: 'invalid_weight' };
  const unitKey = unit.toLowerCase();
  const accepted = ACCEPTED_UNITS[unitKey];
  if (accepted === undefined) return { ...base, reason: 'unknown_unit' };
  const grams = convertToGrams(weight, accepted);
  if (grams === null) return { ...base, reason: 'invalid_weight' };
  if (qty !== '') {
    if (!/^\d+$/.test(qty)) return { ...base, reason: 'invalid_qty' };
    const value = Number(qty);
    if (value < 1 || value > 99) return { ...base, reason: 'invalid_qty' };
    return { ...base, grams, categoryCanonical: canonical, qty: value, priceCents: parsePrice(price) };
  }
  return { ...base, grams, categoryCanonical: canonical, qty: 1, priceCents: parsePrice(price) };
}

/** `price`: an optional `$`, digits, then optionally a point and exactly two digits. */
export function parsePrice(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  const match = /^\$?(\d+)(\.(\d{2}))?$/.exec(text);
  if (match === null) return null;
  const dollars = Number(match[1]);
  const cents = match[3] !== undefined ? Number(match[3]) : 0;
  return dollars * 100 + cents;
}

/** Import matching: identity is normalised name plus canonical category. */
export function rowIdentity(name: string, category: Category): string {
  return `${normaliseName(name)}\u0000${category}`;
}
