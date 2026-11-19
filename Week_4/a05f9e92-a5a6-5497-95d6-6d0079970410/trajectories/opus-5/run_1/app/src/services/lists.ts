/**
 * Lists, grouping, paging, aggregates and export rows. Filter text is evaluated
 * through the expression interpreter, so lists, drill-downs and exports all
 * agree. Group counts are computed after access rules.
 */

import { nowMs } from '../clock';
import { settings } from '../config';
import { unknownField } from '../errors';
import { condition as evaluateCondition } from '../expr/interpret';
import { builderPaths, canonicalFilter, parseFilter } from '../expr/filter';
import { canReadField } from '../domain/access';
import {
  choiceLabel,
  fieldSpec,
  priorityLabels,
  type TableName,
} from '../domain/fields';
import { stateLabel } from '../domain/transitions';
import { addDays, isoInZone, localDate, startOfLocalDate, startOfWeek } from '../domain/zone';
import { Engine, type Caller } from './engine';
import { knownPath } from './scope';
import type { RecordRow } from './store';

export interface ListQuery {
  readonly table: TableName;
  readonly filter?: string;
  readonly q?: string;
  readonly sort?: string;
  readonly dir?: 'asc' | 'desc';
  readonly page?: number;
  readonly groupBy?: string;
  readonly columns?: readonly string[];
}

/** Every path a filter, sort or group names must be readable, or it is unknown. */
export function requireReadablePath(engine: Engine, caller: Caller, table: TableName, path: string): void {
  const parts = path.split('.');
  if (!knownPath(table, parts)) throw unknownField(path);
  const context = engine.accessContext(caller);
  if (!canReadField(context, null, table, parts[0])) throw unknownField(path);
}

export function validateFilter(engine: Engine, caller: Caller, table: TableName, filter: string): string {
  const builder = parseFilter(filter);
  for (const path of builderPaths(builder)) requireReadablePath(engine, caller, table, path);
  return canonicalFilter(filter);
}

function matches(engine: Engine, caller: Caller, record: RecordRow, filter: string): boolean {
  if (filter.trim() === '') return true;
  const scope = engine.scopeFor(
    { table: record.table, fields: record.fields, state: record.state, number: record.number },
    caller,
  );
  try {
    return evaluateCondition(filter, scope);
  } catch {
    return false;
  }
}

/** A trimmed query matched case-insensitively as a substring, skipping denied fields. */
function matchesText(engine: Engine, caller: Caller, record: RecordRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  const readable = new Set(engine.readableFieldNames(caller, record));
  const haystacks: string[] = [record.number];
  if (readable.has('short_description') || record.table === 'change') {
    haystacks.push(String(record.fields.short_description ?? record.fields.title ?? ''));
  }
  if (readable.has('description')) haystacks.push(String(record.fields.description ?? ''));
  return haystacks.some((text) => text.toLowerCase().includes(needle));
}

function valueAt(engine: Engine, record: RecordRow, path: string): unknown {
  const parts = path.split('.');
  if (parts.length === 1) {
    if (parts[0] === 'state') return record.state;
    if (parts[0] === 'number') return record.number;
    return record.fields[parts[0]] ?? null;
  }
  const scope = engine.scopeFor(
    { table: record.table, fields: record.fields, state: record.state, number: record.number },
    { username: null, roles: ['operator'] },
  );
  const found = scope.lookup(parts);
  return typeof found === 'symbol' ? null : found;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

export interface GroupResult {
  readonly value: unknown;
  readonly label: string;
  readonly count: number;
  readonly filter: string;
}

/** The label and own filter text of one group value. */
function groupLabelAndFilter(
  engine: Engine,
  table: TableName,
  path: string,
  value: unknown,
): { label: string; filter: string } {
  if (value === null || value === undefined) {
    return { label: '(empty)', filter: `is_empty(${path})` };
  }
  const spec = fieldSpec(table, path.split('.')[0]);
  if (path === 'priority') {
    return { label: `${value} ${priorityLabels[Number(value)] ?? ''}`.trim(), filter: `priority = ${value}` };
  }
  if (path === 'state') {
    return { label: stateLabel(table, String(value)), filter: `state = ${JSON.stringify(String(value))}` };
  }
  if (path === 'impact' || path === 'urgency') {
    return {
      label: choiceLabel(table, path, value) ?? String(value),
      filter: `${path} = ${value}`,
    };
  }
  if (spec?.type === 'boolean') {
    return { label: value ? 'Yes' : 'No', filter: `${path} = ${value ? 'true' : 'false'}` };
  }
  if (spec?.type === 'reference') {
    return {
      label: engine.displayOf(table, path, value) ?? String(value),
      filter: `${path} = ${JSON.stringify(String(value))}`,
    };
  }
  if (typeof value === 'number') return { label: String(value), filter: `${path} = ${value}` };
  return { label: String(value), filter: `${path} = ${JSON.stringify(String(value))}` };
}

export interface ListResult {
  readonly records: readonly RecordRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly groups: readonly GroupResult[] | null;
  readonly canonical: string;
}

/** Runs a list query: access rules, filter, text search, sort, group then page. */
export function runList(engine: Engine, caller: Caller, query: ListQuery): ListResult {
  const canonical = query.filter ? validateFilter(engine, caller, query.table, query.filter) : '';
  if (query.sort) requireReadablePath(engine, caller, query.table, query.sort);
  if (query.groupBy) requireReadablePath(engine, caller, query.table, query.groupBy);
  for (const column of query.columns ?? []) requireReadablePath(engine, caller, query.table, column);

  const visible = engine.visibleRecords(caller, query.table);
  const filtered = visible
    .filter((r) => matches(engine, caller, r, canonical))
    .filter((r) => matchesText(engine, caller, r, query.q ?? ''));

  const sortPath = query.sort ?? 'number';
  const direction = query.dir === 'desc' ? -1 : 1;
  const sorted = [...filtered].sort((a, b) => {
    const primary = compareValues(valueAt(engine, a, sortPath), valueAt(engine, b, sortPath)) * direction;
    if (primary !== 0) return primary;
    // Number ascending is the tie-break, so pages never repeat or skip a record.
    return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
  });

  let groups: GroupResult[] | null = null;
  if (query.groupBy) {
    const buckets = new Map<string, { value: unknown; count: number }>();
    for (const record of sorted) {
      const value = valueAt(engine, record, query.groupBy);
      const key = value === null || value === undefined ? '\u0000empty' : JSON.stringify(value);
      const bucket = buckets.get(key);
      if (bucket) bucket.count += 1;
      else buckets.set(key, { value: value ?? null, count: 1 });
    }
    groups = [...buckets.values()]
      .sort((a, b) => {
        const aEmpty = a.value === null;
        const bEmpty = b.value === null;
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        return compareValues(a.value, b.value);
      })
      .map((bucket) => {
        const { label, filter } = groupLabelAndFilter(engine, query.table, query.groupBy as string, bucket.value);
        return { value: bucket.value, label, count: bucket.count, filter };
      });
  }

  const pageSize = settings().LIST_PAGE_SIZE;
  const page = Math.max(1, query.page ?? 1);
  return {
    records: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: sorted.length,
    page,
    pageSize,
    groups,
    canonical,
  };
}

export interface AggregateQuery {
  readonly table: TableName;
  readonly filter?: string;
  readonly groupBy?: string | null;
  readonly bucket?: 'day' | 'week' | null;
  readonly dateField?: string | null;
  readonly timeZone?: string | null;
}

export const trendBuckets = 14;

/** Trend widgets always have 14 buckets, oldest first, in the viewer's zone. */
export function bucketKeys(zone: string, bucket: 'day' | 'week', at: number): string[] {
  const today = localDate(zone, at);
  const last = bucket === 'week' ? startOfWeek(today) : today;
  const keys: string[] = [];
  for (let i = trendBuckets - 1; i >= 0; i -= 1) {
    keys.push(addDays(last, -(i * (bucket === 'week' ? 7 : 1))));
  }
  return keys;
}

export function bucketFilter(
  zone: string,
  bucket: 'day' | 'week',
  dateField: string,
  key: string,
): string {
  const start = startOfLocalDate(zone, key);
  const end = startOfLocalDate(zone, addDays(key, bucket === 'week' ? 7 : 1));
  return canonicalFilter(
    `${dateField} >= ${JSON.stringify(isoInZone(zone, start))} and ${dateField} < ${JSON.stringify(isoInZone(zone, end))}`,
  );
}

export interface AggregateResult {
  readonly groups: readonly GroupResult[];
  readonly total: number;
}

export function runAggregate(engine: Engine, caller: Caller, query: AggregateQuery): AggregateResult {
  const zone = query.timeZone ?? caller.timeZone;
  const canonical = query.filter ? validateFilter(engine, caller, query.table, query.filter) : '';
  const visible = engine
    .visibleRecords(caller, query.table)
    .filter((r) => matches(engine, caller, r, canonical));

  if (query.bucket) {
    const dateField = query.dateField ?? 'created_at';
    requireReadablePath(engine, caller, query.table, dateField);
    const keys = bucketKeys(zone, query.bucket, engine.at);
    const counts = new Map<string, number>(keys.map((k) => [k, 0]));
    for (const record of visible) {
      const raw = valueAt(engine, record, dateField);
      const ms = typeof raw === 'string' ? Date.parse(raw) : NaN;
      if (Number.isNaN(ms)) continue;
      const day = localDate(zone, ms);
      const key = query.bucket === 'week' ? startOfWeek(day) : day;
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      groups: keys.map((key) => ({
        value: key,
        label: key,
        count: counts.get(key) ?? 0,
        filter: bucketFilter(zone, query.bucket as 'day' | 'week', dateField, key),
      })),
      total: visible.length,
    };
  }

  if (query.groupBy) {
    const result = runList(engine, caller, {
      table: query.table,
      filter: canonical,
      groupBy: query.groupBy,
      page: 1,
    });
    return { groups: result.groups ?? [], total: result.total };
  }

  return { groups: [], total: visible.length };
}

/** Rows of a list for an export, after access rules, in the list's order. */
export function exportRows(
  engine: Engine,
  caller: Caller,
  table: TableName,
  filter: string,
  columns: readonly string[],
): { header: string[]; rows: string[][] } {
  const canonical = filter ? validateFilter(engine, caller, table, filter) : '';
  const context = engine.accessContext(caller);
  const kept = columns.filter((column) => canReadField(context, null, table, column.split('.')[0]));
  const visible = engine
    .visibleRecords(caller, table)
    .filter((r) => matches(engine, caller, r, canonical))
    .sort((a, b) => (a.number < b.number ? -1 : 1));
  return {
    header: kept.map((column) => engine.labelOf(table, column)),
    rows: visible.map((record) =>
      kept.map((column) => {
        const value = valueAt(engine, record, column);
        if (value === null || value === undefined) return '';
        if (column === 'state') return stateLabel(table, String(value));
        return String(engine.displayOf(table, column, value) ?? value);
      }),
    ),
  };
}

export function csvOf(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (text: string): string =>
    /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\n');
}

export function serverNow(): number {
  return nowMs();
}
