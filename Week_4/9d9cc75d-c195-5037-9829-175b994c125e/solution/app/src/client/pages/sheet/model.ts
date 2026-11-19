// The sheet page's shelf rules: what a pill is called, where it may go, and how adding, removing, moving and drilling
// change a sheet shape. Pure functions over `SheetShape`, so the page, drag and keyboard all edit a sheet the same way.
import { measureCaption } from '../../../shared/display.ts';
import { isMeasurePill } from '../../../shared/twin.ts';
import type { Agg, DateLevel, Filter, FieldKind, MeasurePill, Pill, SheetShape, SortMode, ValueType } from '../../../shared/model.ts';

export type PillShelf = 'Rows' | 'Columns' | 'Color' | 'Size' | 'Label' | 'Detail';
export type Shelf = PillShelf | 'Filters';

/** The menu order of `menu "Add to shelf"`. */
export const SHELVES: readonly Shelf[] = ['Rows', 'Columns', 'Color', 'Size', 'Label', 'Detail', 'Filters'];
export const AGGS: readonly Agg[] = ['SUM', 'AVG', 'MEDIAN', 'MIN', 'MAX', 'COUNT', 'COUNT_UNIQUE'];
export const DATE_LEVELS: readonly { level: DateLevel; label: string }[] = [
  { level: 'year', label: 'Year' },
  { level: 'month', label: 'Month' },
  { level: 'week', label: 'Week' },
  { level: 'day', label: 'Day' },
];

/** A name the field list offers: a source field, a calculation or a set. */
export interface FieldEntry {
  key: string;
  name: string;
  kind: FieldKind;
  type: ValueType;
  /** a level-of-detail calculation lands with AVG */
  lod: boolean;
}

export function pillField(pill: Pill): string {
  return typeof pill === 'string' ? pill : pill.field;
}

/** A dimension shows its field name, a measure its caption from the display rule. */
export function pillCaption(pill: Pill): string {
  return isMeasurePill(pill) ? measureCaption(pill) : pillField(pill);
}

/** The pills on a shelf, in order. */
export function shelfPills(shape: SheetShape, shelf: PillShelf): Pill[] {
  switch (shelf) {
    case 'Rows':
      return shape.rows;
    case 'Columns':
      return shape.columns;
    case 'Color':
      return shape.color ? [shape.color] : [];
    case 'Size':
      return shape.size ? [shape.size] : [];
    case 'Label':
      return shape.label;
    case 'Detail':
      return shape.detail;
  }
}

function withShelf(shape: SheetShape, shelf: PillShelf, pills: Pill[]): SheetShape {
  switch (shelf) {
    case 'Rows':
      return { ...shape, rows: pills };
    case 'Columns':
      return { ...shape, columns: pills };
    case 'Color':
      return { ...shape, color: pills[pills.length - 1] ?? null };
    case 'Size':
      return { ...shape, size: pills[pills.length - 1] ?? null };
    case 'Label':
      return { ...shape, label: pills };
    case 'Detail':
      return { ...shape, detail: pills };
  }
}

/** The pill a field becomes on a shelf: measures default to SUM (AVG for a level-of-detail result), dates to Month. */
export function pillFor(field: FieldEntry): Pill {
  if (field.kind === 'measure') return { field: field.name, agg: field.lod ? 'AVG' : 'SUM', table_calc: null };
  if (field.type === 'date') return { field: field.name, level: 'month' };
  return field.name;
}

/** Places a pill at `index` (the end by default). Color and Size hold one pill, so a new one replaces the old. */
export function insertPill(shape: SheetShape, shelf: PillShelf, pill: Pill, index?: number): SheetShape {
  const pills = [...shelfPills(shape, shelf)];
  pills.splice(index ?? pills.length, 0, pill);
  return withShelf(shape, shelf, shelf === 'Color' || shelf === 'Size' ? [pill] : pills);
}

export function removePill(shape: SheetShape, shelf: PillShelf, index: number): SheetShape {
  return withShelf(shape, shelf, shelfPills(shape, shelf).filter((_, i) => i !== index));
}

export function replacePill(shape: SheetShape, shelf: PillShelf, index: number, pill: Pill): SheetShape {
  return withShelf(shape, shelf, shelfPills(shape, shelf).map((old, i) => (i === index ? pill : old)));
}

/** Moves a pill one place within its shelf; null when it is already at that end. */
export function stepPill(shape: SheetShape, shelf: PillShelf, index: number, by: -1 | 1): SheetShape | null {
  const pills = [...shelfPills(shape, shelf)];
  const to = index + by;
  const moving = pills[index];
  if (moving === undefined || to < 0 || to >= pills.length) return null;
  pills.splice(index, 1);
  pills.splice(to, 0, moving);
  return withShelf(shape, shelf, pills);
}

/** Moves a filter one place within the Filters shelf; null when it is already at that end. */
export function stepFilter(shape: SheetShape, index: number, by: -1 | 1): SheetShape | null {
  const filters = [...shape.filters];
  const to = index + by;
  const moving = filters[index];
  if (moving === undefined || to < 0 || to >= filters.length) return null;
  filters.splice(index, 1);
  filters.splice(to, 0, moving);
  return { ...shape, filters };
}

/** Moves a pill to another shelf, or to another place on its own shelf. */
export function movePill(shape: SheetShape, from: PillShelf, index: number, to: PillShelf, at: number): SheetShape {
  const pill = shelfPills(shape, from)[index];
  if (pill === undefined) return shape;
  if (from !== to) return insertPill(removePill(shape, from, index), to, pill, at);
  const pills = [...shelfPills(shape, from)];
  pills.splice(index, 1);
  pills.splice(at > index ? at - 1 : at, 0, pill);
  return withShelf(shape, from, pills);
}

/** The drill state of a dimension pill on a hierarchy level: null when it is not drillable. */
export function drillState(shape: SheetShape, shelf: PillShelf, index: number, hierarchy: readonly string[]): 'expand' | 'collapse' | null {
  const pills = shelfPills(shape, shelf);
  const pill = pills[index];
  if (typeof pill !== 'string') return null;
  const level = hierarchy.indexOf(pill);
  const next = hierarchy[level + 1];
  if (level < 0 || next === undefined) return null;
  return pills[index + 1] === next ? 'collapse' : 'expand';
}

/** Expanding inserts the next level right after the pill; collapsing removes every lower level from the shelf. */
export function drill(shape: SheetShape, shelf: PillShelf, index: number, hierarchy: readonly string[]): SheetShape {
  const pills = shelfPills(shape, shelf);
  const pill = pills[index];
  if (typeof pill !== 'string') return shape;
  const level = hierarchy.indexOf(pill);
  const next = hierarchy[level + 1];
  if (level < 0 || next === undefined) return shape;
  if (pills[index + 1] === next) {
    const lower = new Set(hierarchy.slice(level + 1));
    return withShelf(shape, shelf, pills.filter((p) => !(typeof p === 'string' && lower.has(p))));
  }
  return insertPill(shape, shelf, next, index + 1);
}

/** Ascending, then descending, then by the first measure descending, then ascending again. */
export function nextSort(mode: SortMode | undefined): SortMode {
  if (mode === 'desc') return 'measure';
  if (mode === 'measure') return 'asc';
  return 'desc';
}

/** The view's dimensions, in Rows, Columns, Detail, Color order. */
export function viewDimensions(shape: SheetShape): string[] {
  const pills = [...shape.rows, ...shape.columns, ...shape.detail, ...(shape.color ? [shape.color] : [])];
  return [...new Set(pills.filter((pill) => !isMeasurePill(pill)).map(pillField))];
}

/** The view's measure pills, in Rows, Columns, Color, Size, Label, Detail order, one per caption. */
export function viewMeasures(shape: SheetShape): MeasurePill[] {
  const pills = [...shape.rows, ...shape.columns, shape.color, shape.size, ...shape.label, ...shape.detail];
  const seen = new Set<string>();
  const measures: MeasurePill[] = [];
  for (const pill of pills) {
    if (!pill || !isMeasurePill(pill) || seen.has(measureCaption(pill))) continue;
    seen.add(measureCaption(pill));
    measures.push(pill);
  }
  return measures;
}

export function withAgg(pill: MeasurePill, agg: Agg): MeasurePill {
  return { ...pill, agg };
}

export function withLevel(pill: Pill, level: DateLevel): Pill {
  return typeof pill === 'object' && !isMeasurePill(pill) ? { ...pill, level } : pill;
}

/** A filter that is not on any step yet: every key present, as the sheet shape requires. */
export function blankFilter(field: string): Filter {
  return { field, step: 'dimension', values: [], n: null, by: null, min: null, max: null, agg: null, table_calc: null };
}

/** Filter pills show the field name; a data source filter says so, so it never shares a name with a view filter. */
export function filterCaption(filter: Filter): string {
  return filter.step === 'source' ? `${filter.field} (data source)` : filter.field;
}

export function isMeasureFilter(filter: Filter): boolean {
  return filter.step === 'measure' || filter.step === 'table_calc';
}
