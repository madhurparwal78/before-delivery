import type { CsvTable } from './csv.js';
import { isDateString } from '../../shared/time.js';

export const MAX_IMPORT_ROWS = 2000;

export interface ImportRow {
  line: number;
  source: string;
  externalId: string;
  title: string;
  estimateMinutes: number | null;
  dueDate: string | null;
}

export interface RejectedRow {
  line: number;
  reason: string;
}

export interface PreparedImport {
  winners: ImportRow[];
  mergedCount: number;
  rejected: RejectedRow[];
  sources: string[];
  keys: Set<string>;
}

export function importKey(source: string, externalId: string): string {
  return `${source}\u0000${externalId}`;
}

export function hasTaskExportHeader(table: CsvTable): boolean {
  return table.header.includes('external_id') && table.header.includes('title');
}

function validEstimate(value: number): boolean {
  return Number.isInteger(value) && value >= 5 && value <= 600 && value % 5 === 0;
}

/**
 * Rows are matched on the pair (source, external id). When several rows in one file share
 * a key the last row wins and each earlier one counts as merged, on every import.
 */
export function prepareImport(table: CsvTable): PreparedImport {
  const columnOf = (name: string): number => table.header.indexOf(name);
  const externalIdColumn = columnOf('external_id');
  const titleColumn = columnOf('title');
  const estimateColumn = columnOf('estimate_minutes');
  const dueDateColumn = columnOf('due_date');
  const sourceColumn = columnOf('source');

  const rejected: RejectedRow[] = [];
  const byKey = new Map<string, ImportRow>();
  let mergedCount = 0;
  const sources = new Set<string>();

  for (const row of table.rows) {
    const cell = (index: number): string => (index < 0 ? '' : (row.cells[index] ?? '').trim());
    const externalId = cell(externalIdColumn);
    const title = cell(titleColumn);
    if (externalId === '') {
      rejected.push({ line: row.line, reason: 'missing external_id' });
      continue;
    }
    if (title === '') {
      rejected.push({ line: row.line, reason: 'missing title' });
      continue;
    }
    if (title.length > 200) {
      rejected.push({ line: row.line, reason: 'title longer than 200 characters' });
      continue;
    }

    const estimateRaw = cell(estimateColumn);
    let estimateMinutes: number | null = null;
    if (estimateRaw !== '') {
      const parsed = Number(estimateRaw);
      if (!validEstimate(parsed)) {
        rejected.push({ line: row.line, reason: 'invalid estimate_minutes' });
        continue;
      }
      estimateMinutes = parsed;
    }

    const dueRaw = cell(dueDateColumn);
    let dueDate: string | null = null;
    if (dueRaw !== '') {
      if (!isDateString(dueRaw)) {
        rejected.push({ line: row.line, reason: 'invalid due_date' });
        continue;
      }
      dueDate = dueRaw;
    }

    const source = cell(sourceColumn) === '' ? 'csv' : cell(sourceColumn);
    sources.add(source);
    const key = importKey(source, externalId);
    if (byKey.has(key)) mergedCount += 1;
    byKey.set(key, { line: row.line, source, externalId, title, estimateMinutes, dueDate });
  }

  return {
    winners: [...byKey.values()],
    mergedCount,
    rejected,
    sources: [...sources],
    keys: new Set(byKey.keys()),
  };
}
