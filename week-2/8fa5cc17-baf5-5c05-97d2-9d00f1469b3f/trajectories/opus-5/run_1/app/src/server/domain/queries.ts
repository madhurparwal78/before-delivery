import { Tx } from '../db/pool';
import { TypeRecord, FieldRecord } from './types';
import {
  Ast,
  EvalObject,
  SortKind,
  compareText,
  compareValues,
  evaluate,
} from '../../shared/query';
import { dateInZone } from '../../shared/homeclock';

export const QUERY_ROW_CAP = 200;

export type SortEntry = { key: string; dir: 'asc' | 'desc' };

export type QueryRow = {
  id: string;
  title: string;
  type_name: string;
  backlinks: number;
  updated_at: string;
};

export type ObjectsForQuery = {
  all: Map<string, EvalObject>;
  titles: Map<string, string>;
  rows: Map<string, QueryRow>;
};

export async function loadObjectsForQuery(tx: Tx, types: TypeRecord[], zone: string): Promise<ObjectsForQuery> {
  const rows = await tx.query<{
    id: string;
    title: string;
    type_id: string;
    backlinks: number;
    updated_at: Date;
  }>('select id, title, type_id, backlinks, updated_at from object_note');
  const properties = await tx.query<{ object_id: string; field_id: string; value: unknown }>(
    'select object_id, field_id, value from property_value',
  );
  const fieldById = new Map<string, FieldRecord>();
  for (const type of types) for (const field of type.fields) fieldById.set(field.id, field);
  const all = new Map<string, EvalObject>();
  const titles = new Map<string, string>();
  const queryRows = new Map<string, QueryRow>();
  for (const row of rows) {
    const typeName = types.find((type) => type.id === row.type_id)?.name ?? '';
    const own: Record<string, unknown> = {};
    for (const entry of properties) {
      if (entry.object_id !== row.id) continue;
      const field = fieldById.get(entry.field_id);
      if (field === undefined) continue;
      own[field.name] = entry.value;
    }
    all.set(row.id, {
      id: row.id,
      title: row.title,
      backlinks: row.backlinks,
      updatedDate: dateInZone(row.updated_at, zone),
      properties: own,
    });
    titles.set(row.id, row.title);
    queryRows.set(row.id, {
      id: row.id,
      title: row.title,
      type_name: typeName,
      backlinks: row.backlinks,
      updated_at: row.updated_at.toISOString(),
    });
  }
  return { all, titles, rows: queryRows };
}

function sortKindOf(key: string, type: TypeRecord): { kind: SortKind; field: FieldRecord | null } | null {
  if (key === '@title') return { kind: '@title', field: null };
  if (key === '@backlinks') return { kind: '@backlinks', field: null };
  if (key === '@updated') return { kind: '@updated', field: null };
  const field = type.fields.find((candidate) => candidate.name.toLowerCase() === key.toLowerCase());
  if (field === undefined) return null;
  return { kind: field.kind, field };
}

function valueForKey(object: EvalObject, key: string): unknown {
  if (key === '@title') return object.title;
  if (key === '@backlinks') return object.backlinks;
  if (key === '@updated') return object.updatedDate;
  const value = object.properties[key];
  return value === undefined ? null : value;
}

export function isSortKeyOnType(key: string, type: TypeRecord): boolean {
  return sortKindOf(key, type) !== null;
}

export function evaluateQuery(
  ast: Ast,
  type: TypeRecord,
  data: ObjectsForQuery,
  objectsOfType: string[],
  today: string,
  sort: SortEntry[],
  groupBy: string | null,
): { results: QueryRow[]; groups: Record<string, unknown>[] | null } {
  const context = {
    today,
    objectById: (id: string): EvalObject | null => data.all.get(id) ?? null,
    titleOf: (id: string): string | null => data.titles.get(id) ?? null,
  };
  const matched: EvalObject[] = [];
  for (const id of objectsOfType) {
    const object = data.all.get(id);
    if (object === undefined) continue;
    if (evaluate(ast, object, context)) matched.push(object);
  }
  const titleOf = (id: string): string | null => data.titles.get(id) ?? null;
  matched.sort((a, b) => {
    for (const entry of sort) {
      const resolved = sortKindOf(entry.key, type);
      if (resolved === null) continue;
      const left = valueForKey(a, resolved.field === null ? entry.key : resolved.field.name);
      const right = valueForKey(b, resolved.field === null ? entry.key : resolved.field.name);
      const leftNull = left === null || left === undefined;
      const rightNull = right === null || right === undefined;
      if (leftNull && rightNull) continue;
      if (leftNull) return 1;
      if (rightNull) return -1;
      const compared = compareValues(resolved.kind, left, right, resolved.field, titleOf);
      if (compared !== 0) return entry.dir === 'desc' ? -compared : compared;
    }
    const byTitle = compareText(a.title, b.title);
    if (byTitle !== 0) return byTitle;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const capped = matched.slice(0, QUERY_ROW_CAP);
  const results = capped.map((object) => data.rows.get(object.id) as QueryRow);
  if (groupBy === null) return { results, groups: null };
  const field = type.fields.find((candidate) => candidate.name.toLowerCase() === groupBy.toLowerCase());
  if (field === undefined) return { results, groups: null };
  const buckets = new Map<string, { key: unknown; label: string; rows: QueryRow[] }>();
  for (const object of capped) {
    const raw = valueForKey(object, field.name);
    const isNull = raw === null || raw === undefined;
    let label = 'No value';
    let key: unknown = null;
    if (!isNull) {
      key = raw;
      if (field.kind === 'relation') label = titleOf(String(raw)) ?? 'No value';
      else label = String(raw);
    }
    const bucketKey = isNull ? '\u0000no-value' : `${label}`;
    const bucket = buckets.get(bucketKey) ?? { key, label, rows: [] };
    bucket.rows.push(data.rows.get(object.id) as QueryRow);
    buckets.set(bucketKey, bucket);
  }
  const groups = [...buckets.values()]
    .sort((a, b) => {
      if (a.label === 'No value') return 1;
      if (b.label === 'No value') return -1;
      return compareText(a.label, b.label);
    })
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      count: bucket.rows.length,
      results: bucket.rows,
    }));
  return { results, groups };
}
