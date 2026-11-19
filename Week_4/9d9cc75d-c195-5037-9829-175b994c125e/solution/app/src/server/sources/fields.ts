// Field rules that need no database: default kinds, reconciling fields with a table's columns, bins and groups.
import type { Cell, FieldKind, Relation, SourceField, ValueType } from '../../shared/model.ts';
import type { Column } from './csv.ts';

export type DerivedDef =
  | { kind: 'bin'; field: string; size: number }
  | { kind: 'group'; field: string; groups: { name: string; members: Cell[] }[] };

/** A source field as stored. `column` is the table column it reads; derived fields (bins, groups) have none. */
export interface FieldRecord extends SourceField {
  column: string | null;
  /** A right-table join key: it repeats the left key, so it is kept out of the field list. */
  dropped: boolean;
  derived: DerivedDef | null;
}

interface TableColumns {
  name: string;
  columns: Column[];
}

export const nameClash = (name: string): string => `A field named ${name} already exists.`;
export const binFieldName = (field: string): string => `${field} (bin)`;
export const groupFieldName = (field: string): string => `${field} (group)`;

/** Number columns are measures, every other column a dimension. */
function defaultKind(type: ValueType): FieldKind {
  return type === 'number' ? 'measure' : 'dimension';
}

/** Dates are continuous; everything else follows its kind (a number on a dimension is discrete). */
export function defaultContinuous(type: ValueType, kind: FieldKind): boolean {
  return type === 'date' || kind === 'measure';
}

/** The bin a value falls in: `floor(x / size) * size`, labelled `{start} to {start + size - 1}`. */
export function binStart(value: number, size: number): number {
  return Math.floor(value / size) * size;
}

export function binLabel(value: number, size: number): string {
  const start = binStart(value, size);
  return `${start} to ${start + size - 1}`;
}

/** `base`, or `base (2)`, `base (3)`, ... when `taken` already holds it. */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

function baseField(table: string, column: Column, id: string): FieldRecord {
  const kind = defaultKind(column.type);
  return {
    id,
    name: column.name,
    table,
    type: column.type,
    kind,
    continuous: defaultContinuous(column.type, kind),
    hidden: false,
    column: column.name,
    dropped: false,
    derived: null,
  };
}

/**
 * The field list for the tables' current columns. Existing fields keep their id, name, kind and visibility (a column
 * whose type changed goes back to the defaults of its new type); new columns get fields; fields of columns that are
 * gone leave, and so do bins and groups built on them. Names stay unique: the later field takes `{name} ({table})`.
 */
export function reconcileFields(
  existing: readonly FieldRecord[],
  tables: readonly TableColumns[],
  relation: Relation | null,
  newId: () => string,
): FieldRecord[] {
  const result: FieldRecord[] = [];
  for (const table of tables) {
    for (const column of table.columns) {
      const found = existing.find((f) => f.derived === null && f.table === table.name && f.column === column.name);
      if (!found) {
        result.push(baseField(table.name, column, newId()));
      } else if (found.type !== column.type) {
        result.push({ ...baseField(table.name, column, found.id), name: found.name, hidden: found.hidden });
      } else {
        result.push({ ...found });
      }
    }
  }
  const ids = new Set(result.map((f) => f.id));
  for (const field of existing) {
    if (field.derived !== null && ids.has(field.derived.field)) {
      result.push({ ...field });
      ids.add(field.id);
    }
  }
  const taken = new Set<string>();
  return result.map((field) => {
    const dropped =
      relation !== null &&
      field.derived === null &&
      field.table === relation.right_table &&
      field.column === relation.right_key;
    if (dropped) return { ...field, dropped };
    const name = taken.has(field.name)
      ? uniqueName(field.table ? `${field.name} (${field.table})` : field.name, taken)
      : field.name;
    taken.add(name);
    return { ...field, name, dropped };
  });
}
