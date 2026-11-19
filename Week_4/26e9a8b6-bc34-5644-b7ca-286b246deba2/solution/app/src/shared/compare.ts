import { formatCostDifference, guideTotal } from './cost';
import type { Compare, Currency, Part, Step } from './types';

interface Snapshot {
  steps: Step[];
  parts: Part[];
  model_scale?: number;
  model_scale_confirmed?: boolean;
}

const stepFields = ['title', 'text', 'phase', 'explode', 'focus_parts', 'camera', 'callouts'] as const;
const partFields = ['name', 'axis', 'apart_mm', 'quantity', 'unit_price', 'fitted_at', 'node_path'] as const;
const comparedPartFields = ['name', 'quantity', 'unit_price', 'fitted_at'] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Field path -> value for everything a version stores, the unit of the `version_conflict` field list. */
function fieldValues(snapshot: Snapshot): Map<string, unknown> {
  const values = new Map<string, unknown>([
    ['model_scale', snapshot.model_scale],
    ['model_scale_confirmed', snapshot.model_scale_confirmed],
  ]);
  for (const step of snapshot.steps) for (const field of stepFields) values.set(`step/${step.id}/${field}`, step[field]);
  for (const part of snapshot.parts) for (const field of partFields) values.set(`part/${part.id}/${field}`, part[field]);
  return values;
}

export function differingFields(base: Snapshot | null, current: Snapshot): string[] {
  const before = base ? fieldValues(base) : new Map<string, unknown>();
  const after = fieldValues(current);
  return [...new Set([...before.keys(), ...after.keys()])].filter((path) => !same(before.get(path), after.get(path)));
}

/** Longest-common-subsequence word diff, words split on white space. */
export function wordDiff(older: string, newer: string): { removed: string; added: string } {
  const a = older.split(/\s+/).filter(Boolean);
  const b = newer.split(/\s+/).filter(Boolean);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
    else if (j >= b.length || (i < a.length && table[i + 1]![j]! >= table[i]![j + 1]!)) removed.push(a[i++]!);
    else added.push(b[j++]!);
  }
  return { removed: removed.join(' '), added: added.join(' ') };
}

export function compareVersions(olderNumber: number, older: Snapshot, newerNumber: number, newer: Snapshot, currency: Currency): Compare {
  const olderIds = older.steps.map((s) => s.id);
  const newerIds = newer.steps.map((s) => s.id);
  const olderById = new Map(older.steps.map((s) => [s.id, s]));
  const newerById = new Map(newer.steps.map((s) => [s.id, s]));
  const commonOlder = olderIds.filter((id) => newerById.has(id));
  const commonNewer = newerIds.filter((id) => olderById.has(id));
  const moved: Compare['moved'] = [];
  const changed: Compare['changed'] = [];
  for (const step of newer.steps) {
    const before = olderById.get(step.id);
    if (!before) continue;
    if (commonOlder.indexOf(step.id) !== commonNewer.indexOf(step.id)) moved.push({ title: step.title, from: before.number, to: step.number });
    const fields = stepFields.filter((field) => !same(before[field], step[field]));
    if (fields.length) changed.push({ position: step.number, title: step.title, fields });
  }
  const titleOf = (snapshot: Snapshot, id: string | null) => (id === null ? null : snapshot.steps.find((s) => s.id === id)?.title ?? null);
  const partChanges: Compare['part_changes'] = [];
  for (const part of newer.parts) {
    const before = older.parts.find((p) => p.id === part.id);
    if (!before) continue;
    for (const field of comparedPartFields) {
      if (!same(before[field], part[field])) {
        partChanges.push(field === 'fitted_at'
          ? { part: part.name, field, from: titleOf(older, before.fitted_at), to: titleOf(newer, part.fitted_at) }
          : { part: part.name, field, from: before[field], to: part[field] });
      }
    }
  }
  const difference = guideTotal(newer.parts, newerIds) - guideTotal(older.parts, olderIds);
  return {
    older: olderNumber,
    newer: newerNumber,
    added: newer.steps.filter((s) => !olderById.has(s.id)).map((s) => ({ position: s.number, title: s.title })),
    removed: older.steps.filter((s) => !newerById.has(s.id)).map((s) => ({ position: s.number, title: s.title })),
    changed,
    moved,
    part_changes: partChanges,
    cost_difference: difference,
    cost_difference_text: formatCostDifference(difference, currency),
    currency,
  };
}
