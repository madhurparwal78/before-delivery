import { q, q1 } from '../db.js';
import type { CellData } from './csv.js';
import type { DataRow } from './evaluate.js';
import { keyOf } from './evaluate.js';
import type { DerivedSpec, FieldKind, FieldType, RelationSpec, SourceField } from '../../shared/types.js';

export interface LoadedField extends SourceField {
  sortKeyColumn: string | null;
}

export interface LoadedSource {
  id: string;
  projectId: string;
  name: string;
  version: number;
  fields: LoadedField[];
  relation: RelationSpec | null;
  hierarchy: { name: string; fields: string[] } | null;
  entitlements: { field: string | null; users: Record<string, unknown[]> };
  tables: { name: string; rows: number; sha256: string; columns: { id: string; name: string; type: FieldType; kind: FieldKind; continuous: boolean }[] }[];
  rows: DataRow[];
  rightTable: string | null;
  joinNotice: string | null;
}

interface SourceRecord {
  id: string;
  project_id: string;
  name: string;
  version: number;
  relation: RelationSpec | null;
  hierarchy: { name: string; fields: string[] } | null;
  entitlements: { field: string | null; users: Record<string, unknown[]> };
}

interface FieldRecord {
  id: string;
  name: string;
  table_name: string;
  type: FieldType;
  kind: FieldKind;
  continuous: boolean;
  hidden: boolean;
  derived: DerivedSpec | null;
  ord: number;
}

interface TableRecord {
  name: string;
  ord: number;
  rows: number;
  sha256: string;
  columns: { name: string; type: FieldType }[];
}

const cache = new Map<string, LoadedSource>();

export function invalidateSource(sourceId: string): void {
  cache.delete(sourceId);
}

export function binLabel(value: number, size: number): { label: string; start: number } {
  const start = Math.floor(value / size) * size;
  return { label: `${start} to ${start + size - 1}`, start };
}

export async function loadSource(sourceId: string): Promise<LoadedSource | null> {
  const cached = cache.get(sourceId);
  if (cached !== undefined) return cached;

  const src = await q1<SourceRecord & Record<string, unknown>>(
    'SELECT id, project_id, name, version, relation, hierarchy, entitlements FROM sources WHERE id = $1',
    [sourceId],
  );
  if (src === null) return null;

  const tableRecords = await q<TableRecord & Record<string, unknown>>(
    'SELECT name, ord, rows, sha256, columns FROM source_tables WHERE source_id = $1 ORDER BY ord',
    [sourceId],
  );
  const fieldRecords = await q<FieldRecord & Record<string, unknown>>(
    'SELECT id, name, table_name, type, kind, continuous, hidden, derived, ord FROM fields WHERE source_id = $1 ORDER BY ord',
    [sourceId],
  );
  const snapshots = await q<{ table_name: string; rows: Record<string, CellData>[] }>(
    'SELECT table_name, rows FROM snapshots WHERE source_id = $1',
    [sourceId],
  );
  const byTable = new Map(snapshots.map((s) => [s.table_name, s.rows]));

  const relation = src.relation;
  const leftTable = relation !== null ? relation.left_table : tableRecords[0]?.name ?? '';
  const rightTable = relation !== null ? relation.right_table : null;
  const leftRows = byTable.get(leftTable) ?? [];

  let joinNotice: string | null = null;
  const rows: DataRow[] = [];
  const fields: LoadedField[] = fieldRecords.map((f) => ({
    id: f.id,
    name: f.name,
    table: f.table_name,
    type: f.type,
    kind: f.kind,
    continuous: f.continuous,
    hidden: f.hidden,
    derived: f.derived,
    sortKeyColumn: f.derived !== null && f.derived.kind === 'bin' ? `__sort__${f.name}` : null,
  }));

  const rightColumns =
    rightTable === null
      ? []
      : (tableRecords.find((t) => t.name === rightTable)?.columns ?? []).map((c) => c.name);
  const leftColumns = tableRecords.find((t) => t.name === leftTable)?.columns.map((c) => c.name) ?? [];
  const rightOwn = rightColumns.filter((c) => !leftColumns.includes(c));

  if (relation !== null && rightTable !== null) {
    const rightRows = byTable.get(rightTable) ?? [];
    const first = new Map<string, Record<string, CellData>>();
    const counts = new Map<string, number>();
    let firstDuplicateKey: CellData = null;
    let duplicateKeys = 0;
    for (const r of rightRows) {
      const k = keyOf(r[relation.right_key] ?? null);
      const count = (counts.get(k) ?? 0) + 1;
      counts.set(k, count);
      if (count === 1) first.set(k, r);
      if (count === 2) {
        duplicateKeys += 1;
        if (firstDuplicateKey === null) firstDuplicateKey = r[relation.right_key] ?? null;
      }
    }
    if (duplicateKeys > 0) {
      joinNotice = `${rightTable} has ${duplicateKeys} duplicate keys. First line kept: ${String(firstDuplicateKey)}.`;
    }
    leftRows.forEach((l, index) => {
      const k = keyOf(l[relation.left_key] ?? null);
      const match = first.get(k);
      const row: DataRow = { ...l, __i: index } as DataRow;
      for (const col of rightOwn) row[col] = match === undefined ? null : match[col] ?? null;
      row.__rk = match === undefined ? null : l[relation.left_key] ?? null;
      rows.push(row);
    });
  } else {
    leftRows.forEach((l, index) => {
      rows.push({ ...l, __i: index, __rk: null } as DataRow);
    });
  }

  for (const field of fields) {
    const derived = field.derived;
    if (derived === null || derived === undefined) continue;
    if (derived.kind === 'bin') {
      for (const row of rows) {
        const base = row[derived.base];
        if (typeof base === 'number') {
          const { label, start } = binLabel(base, derived.size);
          row[field.name] = label;
          row[`__sort__${field.name}`] = start;
        } else {
          row[field.name] = null;
          row[`__sort__${field.name}`] = null;
        }
      }
    } else {
      const lookup = new Map<string, string>();
      derived.groups.forEach((g) => g.members.forEach((m) => lookup.set(keyOf(m as CellData), g.name)));
      for (const row of rows) {
        const base = row[derived.base] ?? null;
        const found = lookup.get(keyOf(base));
        row[field.name] = found ?? base;
      }
    }
  }

  const loaded: LoadedSource = {
    id: src.id,
    projectId: src.project_id,
    name: src.name,
    version: src.version,
    fields,
    relation,
    hierarchy: src.hierarchy,
    entitlements: src.entitlements,
    tables: tableRecords.map((t) => ({
      name: t.name,
      rows: t.rows,
      sha256: t.sha256,
      columns: t.columns.map((c) => {
        const field = fieldRecords.find((f) => f.name === c.name && f.table_name === t.name);
        return {
          id: field?.id ?? `${t.name}.${c.name}`,
          name: c.name,
          type: c.type,
          kind: field?.kind ?? (c.type === 'number' ? 'measure' : 'dimension'),
          continuous: field?.continuous ?? c.type === 'date',
        };
      }),
    })),
    rows,
    rightTable,
    joinNotice,
  };
  cache.set(sourceId, loaded);
  return loaded;
}

export function entitledRows(source: LoadedSource, username: string | null): { rows: DataRow[]; secured: boolean } {
  const field = source.entitlements.field;
  if (field === null) return { rows: source.rows, secured: false };
  const allowed = username === null ? undefined : source.entitlements.users[username];
  if (allowed === undefined) return { rows: [], secured: true };
  const keys = new Set(allowed.map((v) => keyOf(v as CellData)));
  return { rows: source.rows.filter((r) => keys.has(keyOf(r[field] ?? null))), secured: true };
}

export function fieldByName(source: LoadedSource, name: string): LoadedField | undefined {
  return source.fields.find((f) => f.name === name);
}

export function isRightField(source: LoadedSource, name: string): boolean {
  const f = fieldByName(source, name);
  if (f === undefined) return false;
  if (f.derived != null) return isRightField(source, f.derived.base);
  return source.rightTable !== null && f.table === source.rightTable;
}
