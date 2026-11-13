import { cell, checkRow, type AcceptedRow, type CsvFile } from './csv.js';
import { normaliseName } from './normalise.js';
import type { ImportRow } from './types.js';

export interface ClosetIdentity {
  id: string;
  normalisedName: string;
  category: string;
}

export interface MatchedImport {
  rows: ImportRow[];
  accepted: Map<number, AcceptedRow>;
  counts: { matched: number; created: number; rejected: number };
}

function identity(name: string, category: string): string {
  return `${normaliseName(name)}\u0000${category}`;
}

/** Import matching: by identity, with duplicates in one file merging. */
export function matchImport(file: CsvFile, closet: ClosetIdentity[]): MatchedImport {
  const existing = new Map(
    closet.map((item) => [`${item.normalisedName}\u0000${item.category}`, item.id]),
  );
  const firstRowOf = new Map<string, number>();
  const rows: ImportRow[] = [];
  const accepted = new Map<number, AcceptedRow>();
  const counts = { matched: 0, created: 0, rejected: 0 };

  file.records.forEach((record, index) => {
    const row = index + 1;
    const checked = checkRow(file.header, record);
    const rawName = cell(file.header, record, 'Item Name');
    const rawCategory = cell(file.header, record, 'Category');
    if ('reason' in checked) {
      counts.rejected += 1;
      rows.push({
        row,
        name: rawName,
        category: rawCategory,
        outcome: 'rejected',
        itemId: null,
        sameAsRow: null,
        reason: checked.reason,
      });
      return;
    }
    const key = identity(checked.accepted.name, checked.accepted.category);
    const sameAsRow = firstRowOf.get(key) ?? null;
    const existingId = existing.get(key) ?? null;
    if (sameAsRow === null) firstRowOf.set(key, row);
    accepted.set(row, checked.accepted);
    const matched = sameAsRow !== null || existingId !== null;
    if (matched) counts.matched += 1;
    else counts.created += 1;
    rows.push({
      row,
      name: rawName,
      category: rawCategory,
      outcome: matched ? 'matched' : 'created',
      itemId: existingId,
      sameAsRow,
      reason: null,
    });
  });

  return { rows, accepted, counts };
}
