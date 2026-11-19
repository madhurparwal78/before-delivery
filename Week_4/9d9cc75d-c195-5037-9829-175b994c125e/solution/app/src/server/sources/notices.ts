import type { Cell, ValueType } from '../../shared/model.ts';
import { formatNumber } from '../../shared/display.ts';
import type { SourceModel } from './model.ts';

function keyText(cell: Cell, type: ValueType): string {
  if (typeof cell === 'number') return type === 'date' ? new Date(cell).toISOString().slice(0, 10) : formatNumber(cell);
  return String(cell);
}

/**
 * `{table} has {n} duplicate keys. First line kept: {key}.` when right keys repeat: `n` counts the distinct repeated
 * values and `key` is the first of them in file order. Empty without a relation or duplicates.
 */
export function joinNotices(model: Pick<SourceModel, 'relation' | 'tables'>): string[] {
  const relation = model.relation;
  const right = relation && model.tables.find((t) => t.name === relation.right_table);
  if (!relation || !right) return [];
  const index = right.columns.findIndex((c) => c.name === relation.right_key);
  const type = right.columns[index]?.type ?? 'text';
  const counts = new Map<Cell, number>();
  const order: Cell[] = [];
  for (const row of right.rows) {
    const key = row[index] ?? null;
    if (key === null) continue;
    const seen = counts.get(key) ?? 0;
    if (seen === 0) order.push(key);
    counts.set(key, seen + 1);
  }
  const repeated = order.filter((key) => (counts.get(key) ?? 0) > 1);
  const first = repeated[0];
  if (first === undefined) return [];
  return [`${right.name} has ${formatNumber(repeated.length)} duplicate keys. First line kept: ${keyText(first, type)}.`];
}
