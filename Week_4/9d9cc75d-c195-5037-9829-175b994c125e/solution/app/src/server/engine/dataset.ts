// A source's joined rows, column by column. The left join keeps every left row; a right key that repeats joins its
// first line. A right-table field remembers which right row each joined row came from, so a right-table measure can
// be aggregated once per distinct right key within a mark.
import type { Cell } from '../../shared/model.ts';
import { binLabel, binStart, type FieldRecord } from '../sources/fields.ts';
import type { ModelTable, SourceModel } from '../sources/model.ts';
import type { Dataset, DatasetField } from './contract.ts';
import { cellKey } from './values.ts';

const cache = new WeakMap<SourceModel, Dataset>();

function columnOf(table: ModelTable, column: string | null): number {
  return table.columns.findIndex((c) => c.name === column);
}

/** For each left row, the right row it joins, or -1. */
function joinRows(left: ModelTable, right: ModelTable, leftKey: string, rightKey: string): Int32Array {
  const li = columnOf(left, leftKey);
  const ri = columnOf(right, rightKey);
  const leftType = left.columns[li]?.type ?? null;
  const rightType = right.columns[ri]?.type ?? null;
  const first = new Map<string, number>();
  right.rows.forEach((row, index) => {
    const key = row[ri] ?? null;
    if (key === null) return;
    const text = cellKey(key, rightType);
    if (!first.has(text)) first.set(text, index);
  });
  const joined = new Int32Array(left.rows.length);
  left.rows.forEach((row, index) => {
    const key = row[li] ?? null;
    joined[index] = key === null ? -1 : (first.get(cellKey(key, leftType)) ?? -1);
  });
  return joined;
}

function datasetField(record: FieldRecord, values: Cell[], order: Cell[] | null, rightRows: Int32Array | null): DatasetField {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    kind: record.kind,
    continuous: record.continuous,
    hidden: record.hidden,
    values,
    order,
    rightRows,
  };
}

/** The joined rows of a source at one snapshot. Cached per `SourceModel` object. */
export function buildDataset(model: SourceModel): Dataset {
  const known = cache.get(model);
  if (known) return known;
  const relation = model.relation;
  const left = (relation ? model.tables.find((t) => t.name === relation.left_table) : model.tables[0]) ?? model.tables[0];
  const right = relation ? model.tables.find((t) => t.name === relation.right_table) : undefined;
  const rowCount = left?.rows.length ?? 0;
  const joined =
    left && right && relation ? joinRows(left, right, relation.left_key, relation.right_key) : new Int32Array(rowCount).fill(-1);

  const fields: DatasetField[] = [];
  const byId = new Map<string, DatasetField>();
  const add = (field: DatasetField): void => {
    fields.push(field);
    byId.set(field.id, field);
  };
  for (const record of model.fields) {
    if (record.dropped || record.derived !== null) continue;
    if (left && record.table === left.name) {
      const at = columnOf(left, record.column);
      add(datasetField(record, left.rows.map((row) => row[at] ?? null), null, null));
    } else {
      const at = right && record.table === right.name ? columnOf(right, record.column) : -1;
      const values = Array.from(joined, (r) => (right && r >= 0 && at >= 0 ? (right.rows[r]?.[at] ?? null) : null));
      add(datasetField(record, values, null, joined));
    }
  }
  for (const record of model.fields) {
    const derived = record.derived;
    const source = derived ? byId.get(derived.field) : undefined;
    if (record.dropped || !derived || !source) continue;
    if (derived.kind === 'bin') {
      const values = source.values.map((v) => (typeof v === 'number' ? binLabel(v, derived.size) : null));
      const order = source.values.map((v) => (typeof v === 'number' ? binStart(v, derived.size) : null));
      add({ ...datasetField(record, values, order, null), type: 'text' });
    } else {
      const groupOf = new Map<string, string>();
      for (const group of derived.groups) {
        for (const member of group.members) groupOf.set(cellKey(member, source.type), group.name);
      }
      const values = source.values.map((v) =>
        v === null ? null : (groupOf.get(cellKey(v, source.type)) ?? (source.type === 'text' ? v : cellKey(v, source.type))),
      );
      add({ ...datasetField(record, values, null, null), type: 'text' });
    }
  }
  const dataset: Dataset = { rowCount, fields, byName: new Map(fields.map((f) => [f.name, f])) };
  cache.set(model, dataset);
  return dataset;
}
