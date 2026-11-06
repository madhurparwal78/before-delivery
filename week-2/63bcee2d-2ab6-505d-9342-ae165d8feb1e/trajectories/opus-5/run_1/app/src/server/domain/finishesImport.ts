/** The legacy finishes CSV matching rules, decided here and nowhere else. */

import { countCharacters } from '../../shared/chars.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { FINISH_CATEGORIES } from '../../shared/domain.js';
import { parseCsv } from './csv.js';

export const FINISH_IMPORT_MAX_ROWS = 2000;

export interface ExistingFinish {
  id: string;
  code: string;
  name: string;
  category: string;
  supplier: string;
  productRef: string;
  location: string;
  notes: string;
}

export type RowStatus = 'created' | 'updated' | 'unchanged' | 'rejected';

export interface ImportRowReport {
  line: number;
  status: RowStatus;
  code: string;
  name: string;
  reason: string;
}

export interface FinishValues {
  code: string;
  name: string;
  category: string;
  supplier: string;
  productRef: string;
  location: string;
  notes: string;
}

export type ImportOperation =
  | { kind: 'create'; values: FinishValues }
  | { kind: 'update'; id: string; values: FinishValues };

export interface ImportPlan {
  rows: ImportRowReport[];
  operations: ImportOperation[];
  summary: { created: number; updated: number; unchanged: number; rejected: number };
}

export class FinishImportRefused extends Error {
  readonly copy: string;

  constructor(copy: string) {
    super(copy);
    this.copy = copy;
  }
}

const COLUMN_LABELS = {
  code: 'Finish Code',
  name: 'Finish Name',
  category: 'Category',
  supplier: 'Supplier',
  productRef: 'Product Ref',
  location: 'Location',
  notes: 'Notes',
} as const;

const COLUMN_LIMITS = {
  code: 20,
  name: 120,
  category: 120,
  supplier: 120,
  productRef: 60,
  location: 120,
  notes: 500,
} as const;

type ColumnKey = keyof typeof COLUMN_LABELS;

const HEADER_ALIASES: Record<string, ColumnKey> = {
  'finish code': 'code',
  'finish name': 'name',
  category: 'category',
  supplier: 'supplier',
  'product ref': 'productRef',
  location: 'location',
  notes: 'notes',
};

export function normaliseCode(value: string): string {
  return value.trim().toUpperCase();
}

export function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function nameKey(value: string): string {
  return normaliseName(value).toLowerCase();
}

function canonicalCategory(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return FINISH_CATEGORIES.find((category) => category.toLowerCase() === trimmed) ?? null;
}

export function planFinishImport(
  csvText: string,
  existing: readonly ExistingFinish[],
): ImportPlan {
  const table = parseCsv(csvText).filter(
    (row) => row.length > 1 || (row[0] ?? '').trim() !== '',
  );
  const headerRow = table[0];
  if (!headerRow) throw new FinishImportRefused(fieldErrorCopy.csvMissingColumn());

  const columns = new Map<ColumnKey, number>();
  headerRow.forEach((heading, index) => {
    const key = HEADER_ALIASES[heading.trim().toLowerCase()];
    if (key !== undefined && !columns.has(key)) columns.set(key, index);
  });
  if (!columns.has('name') || !columns.has('category')) {
    throw new FinishImportRefused(fieldErrorCopy.csvMissingColumn());
  }

  const dataRows = table.slice(1);
  if (dataRows.length > FINISH_IMPORT_MAX_ROWS) {
    throw new FinishImportRefused(fieldErrorCopy.csvTooManyRows());
  }

  const byCode = new Map<string, ExistingFinish>();
  const byName = new Map<string, ExistingFinish[]>();
  for (const finish of existing) {
    if (finish.code !== '') byCode.set(finish.code, finish);
    const key = nameKey(finish.name);
    byName.set(key, [...(byName.get(key) ?? []), finish]);
  }

  const seenCodeLines = new Map<string, number>();
  const seenNameLines = new Map<string, number>();
  const rows: ImportRowReport[] = [];
  const operations: ImportOperation[] = [];
  const summary = { created: 0, updated: 0, unchanged: 0, rejected: 0 };

  const cell = (row: readonly string[], key: ColumnKey): string => {
    const index = columns.get(key);
    return index === undefined ? '' : row[index] ?? '';
  };

  dataRows.forEach((row, offset) => {
    const line = offset + 2;
    const code = normaliseCode(cell(row, 'code'));
    const rawName = cell(row, 'name');
    const name = normaliseName(rawName);
    const rawCategory = cell(row, 'category');

    const reject = (reason: string): void => {
      rows.push({ line, status: 'rejected', code, name, reason });
      summary.rejected += 1;
    };

    if (name === '') {
      reject('Name is missing.');
      return;
    }
    const category = canonicalCategory(rawCategory);
    if (category === null) {
      reject(`Unknown category ${rawCategory}.`);
      return;
    }

    const values: FinishValues = {
      code,
      name,
      category,
      supplier: cell(row, 'supplier'),
      productRef: cell(row, 'productRef'),
      location: cell(row, 'location'),
      notes: cell(row, 'notes'),
    };

    const overLimit = (Object.keys(COLUMN_LIMITS) as ColumnKey[]).find(
      (key) => countCharacters(values[key]) > COLUMN_LIMITS[key],
    );
    if (overLimit !== undefined) {
      reject(fieldErrorCopy.tooLong(COLUMN_LABELS[overLimit], COLUMN_LIMITS[overLimit]));
      return;
    }

    const key = nameKey(name);
    const earlierCodeLine = code === '' ? undefined : seenCodeLines.get(code);
    const earlierNameLine = seenNameLines.get(key);
    if (earlierCodeLine !== undefined || earlierNameLine !== undefined) {
      reject(`Duplicate of line ${earlierCodeLine ?? earlierNameLine}.`);
      return;
    }

    const byCodeMatch = code === '' ? undefined : byCode.get(code);
    const byNameMatches = byName.get(key) ?? [];

    let target: ExistingFinish | undefined = byCodeMatch;
    if (!target) {
      if (byNameMatches.length > 1) {
        reject('Name matches more than one finish.');
        return;
      }
      const only = byNameMatches[0];
      if (only) {
        if (code !== '' && only.code !== '' && only.code !== code) {
          reject(`Code ${code} conflicts with ${only.code} for the same name.`);
          return;
        }
        target = only;
      }
    }

    if (code !== '') seenCodeLines.set(code, line);
    seenNameLines.set(key, line);

    if (target) {
      const next: FinishValues = { ...values, code: code === '' ? target.code : code };
      const changed =
        next.code !== target.code ||
        next.name !== target.name ||
        next.category !== target.category ||
        next.supplier !== target.supplier ||
        next.productRef !== target.productRef ||
        next.location !== target.location ||
        next.notes !== target.notes;
      if (changed) {
        operations.push({ kind: 'update', id: target.id, values: next });
        rows.push({ line, status: 'updated', code: next.code, name, reason: '' });
        summary.updated += 1;
        byCode.delete(target.code);
        if (next.code !== '') byCode.set(next.code, { ...target, ...next });
        byName.set(nameKey(next.name), [{ ...target, ...next }]);
      } else {
        rows.push({ line, status: 'unchanged', code: next.code, name, reason: '' });
        summary.unchanged += 1;
      }
      return;
    }

    operations.push({ kind: 'create', values });
    rows.push({ line, status: 'created', code, name, reason: '' });
    summary.created += 1;
    const placeholder: ExistingFinish = { id: '', ...values };
    if (code !== '') byCode.set(code, placeholder);
    byName.set(key, [...byNameMatches, placeholder]);
  });

  return { rows, operations, summary };
}
