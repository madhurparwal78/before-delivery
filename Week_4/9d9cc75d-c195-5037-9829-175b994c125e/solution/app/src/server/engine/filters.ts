// What a single filter keeps. When each filter runs is decided by the query order in query.ts.
import type { Cell, ValueType } from '../../shared/model.ts';
import { evalGroups, type EvalRuntime, type RowFn, type Rows } from './formula/evaluate.ts';
import type { RNode } from './formula/resolved.ts';
import { cellKey, compareCells, dateAtLevel } from './values.ts';
import type { Work } from './work.ts';

const DATE_LEVELS: [RegExp, 'year' | 'month' | 'day'][] = [
  [/^\d{4}$/, 'year'],
  [/^\d{4}-\d{2}$/, 'month'],
  [/^\d{4}-\d{2}-\d{2}$/, 'day'],
];

/**
 * A member list. Values match by their text; on a date, a `YYYY`, `YYYY-MM` or `YYYY-MM-DD` value matches every
 * moment in that year, month or day, as written by a date mark.
 */
export function memberMatcher(values: readonly Cell[], type: ValueType | null): (cell: Cell) => boolean {
  const keys = new Set(values.map((v) => cellKey(v, type)));
  if (type !== 'date') return (cell) => keys.has(cellKey(cell, type));
  const levels = values.flatMap((v) =>
    typeof v === 'string' ? DATE_LEVELS.filter(([pattern]) => pattern.test(v)).map(([, level]) => ({ level, v })) : [],
  );
  return (cell) =>
    keys.has(cellKey(cell, type)) || (typeof cell === 'number' && levels.some(({ level, v }) => dateAtLevel(cell, level) === v));
}

/** "At least" and "At most", both inclusive, either may be absent; a null value is outside every range. */
export function inRange(value: Cell, min: number | null, max: number | null): boolean {
  if (typeof value !== 'number') return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

/**
 * The keys of the top `n` members of a field by a measure over `rows`. Ties at the cut-off go to the member that sorts
 * first, so exactly `n` members stay.
 */
export function* topMembers(
  member: RowFn,
  type: ValueType | null,
  rows: Rows,
  n: number,
  by: RNode,
  rt: EvalRuntime,
): Work<Set<string>> {
  const groups = new Map<string, { value: Cell; rows: number[] }>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? 0;
    const value = member(row);
    const key = cellKey(value, type);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { value, rows: [row] });
  }
  const entries = [...groups.entries()];
  const measures = yield* evalGroups(by, entries.map(([, g]) => g.rows), rt, null);
  const ranked = entries
    .map(([key, group], i) => ({ key, member: group.value, measure: measures[i] ?? null }))
    .sort((a, b) => compareCells(a.measure, b.measure, true) || compareCells(a.member, b.member));
  return new Set(ranked.slice(0, Math.max(0, n)).map((entry) => entry.key));
}
