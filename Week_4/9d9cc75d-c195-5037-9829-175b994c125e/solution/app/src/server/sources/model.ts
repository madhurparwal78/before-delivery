import type { Cell, Relation } from '../../shared/model.ts';
import type { Column } from './csv.ts';
import type { FieldRecord } from './fields.ts';

export interface ModelTable {
  name: string;
  columns: Column[];
  /** Typed cells, columns in `columns` order; dates are epoch milliseconds. */
  rows: Cell[][];
}

/**
 * Everything the query engine needs to know about a source at one snapshot: the tables' rows, the visible-or-hidden
 * field list (right-table join keys left out), the relation, the drill hierarchy and the row-level security table.
 * A new object is built whenever the snapshot or any field, relation or security edit changes, so an engine cache
 * keyed on the object itself (a WeakMap) stays correct.
 */
export interface SourceModel {
  sourceId: string;
  snapshotId: string;
  tables: ModelTable[];
  fields: FieldRecord[];
  relation: Relation | null;
  /** Field names, top level first. */
  hierarchy: { name: string; fields: string[] } | null;
  security: { field: FieldRecord | null; users: Record<string, string[]> };
}
