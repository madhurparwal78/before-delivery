// What a view shows, before any geometry: marks with their ids, labels, tooltips and colours, resolved from the sheet
// shape and the query result. The layouts only place these marks.
import { measureCaption } from '../display.ts';
import type { Cell, ChartKind, MeasurePill, Pill, QueryResult, SheetShape } from '../model.ts';
import { buildTwin, isMeasurePill, type Twin } from '../twin.ts';
import { memberStyle, MARK_COLOURS, sequentialColour, type PatternName } from './palette.ts';
import type { MarkShape } from './types.ts';

const SHAPE_OF_KIND: Record<ChartKind, MarkShape> = {
  bar: 'bar',
  line: 'point',
  scatter: 'point',
  heat_map: 'cell',
  text_table: 'text',
};

/** Column positions: dimension columns come as Rows, Columns, Detail, Color; measure columns as Rows, Columns, Color, Size, Label, Detail. */
export interface Shelves {
  rowDims: number[];
  columnDims: number[];
  detailDims: number[];
  colorDim: number | null;
  rowsMeasure: number;
  columnsMeasure: number;
  colorMeasure: number;
  sizeMeasure: number;
  labelMeasures: number[];
  pills: MeasurePill[];
}

function resolveShelves(sheet: SheetShape): Shelves {
  let dimension = 0;
  const dims = (pills: readonly Pill[]): number[] => pills.filter((p) => !isMeasurePill(p)).map(() => dimension++);
  const rowDims = dims(sheet.rows);
  const columnDims = dims(sheet.columns);
  const detailDims = dims(sheet.detail);
  const colorDim = sheet.color && !isMeasurePill(sheet.color) ? dimension++ : null;
  const pills: MeasurePill[] = [];
  const measure = (pill: Pill | undefined): number => {
    if (!pill || !isMeasurePill(pill)) return -1;
    pills.push(pill);
    return pills.length - 1;
  };
  const rowsMeasure = measure(sheet.rows.find(isMeasurePill));
  const columnsMeasure = measure(sheet.columns.find(isMeasurePill));
  const colorMeasure = measure(sheet.color ?? undefined);
  const sizeMeasure = measure(sheet.size ?? undefined);
  const labelMeasures = sheet.label.filter(isMeasurePill).map((pill) => measure(pill));
  sheet.detail.filter(isMeasurePill).forEach((pill) => measure(pill));
  return { rowDims, columnDims, detailDims, colorDim, rowsMeasure, columnsMeasure, colorMeasure, sizeMeasure, labelMeasures, pills };
}

/**
 * Merges member sequences that each follow the same sort into one order: a member unseen so far goes right after the
 * member before it in its sequence, or right before the first known member when it leads.
 */
export function memberOrder(sequences: readonly (readonly string[])[]): string[] {
  const order: string[] = [];
  for (const sequence of sequences) {
    const firstKnown = sequence.findIndex((member) => order.includes(member));
    let at = firstKnown < 0 ? order.length - 1 : order.indexOf(sequence[firstKnown] ?? '') - 1;
    for (const member of sequence) {
      const found = order.indexOf(member);
      if (found >= 0) {
        at = found;
      } else {
        at += 1;
        order.splice(at, 0, member);
      }
    }
  }
  return order;
}

export interface PlannedMark {
  index: number;
  id: string;
  dims: string[];
  values: Cell[];
  /** every measure column as a number, null where the value is null */
  numbers: (number | null)[];
  measure: string;
  value: string;
  valueText: string;
  tooltip: string;
  ariaLabel: string;
  color: string;
  pattern: PatternName;
  /** the Color dimension member, empty without one */
  member: string;
  labelText: string;
}

export interface ColourScale {
  min: number;
  max: number;
  minText: string;
  maxText: string;
}

export interface ViewPlan {
  kind: ChartKind;
  shape: MarkShape;
  twin: Twin;
  shelves: Shelves;
  /** the measure column the marks show, -1 when the view has no measure */
  valueAt: number;
  /** true when the shown measure is a share, so its axis reads as percents */
  share: boolean;
  marks: PlannedMark[];
  /** Color dimension members in colour order; empty without a Color dimension */
  members: string[];
  scale: ColourScale | null;
}

function valueColumn(kind: ChartKind, shelves: Shelves, measures: number): number {
  if (measures === 0) return -1;
  if (kind === 'heat_map' && shelves.colorMeasure >= 0) return shelves.colorMeasure;
  if (kind === 'text_table') return 0;
  return [shelves.rowsMeasure, shelves.columnsMeasure].find((at) => at >= 0) ?? 0;
}

function numberOf(cell: Cell): number | null {
  return typeof cell === 'number' ? cell : null;
}

export function planView(sheet: SheetShape, result: QueryResult): ViewPlan | null {
  if (result.chart === 'none') return null;
  const kind = result.chart;
  const shape = SHAPE_OF_KIND[kind];
  const twin = buildTwin(result);
  const shelves = resolveShelves(sheet);
  const dimCount = twin.dimensions.length;
  const valueAt = valueColumn(kind, shelves, twin.measures.length);
  const caption = valueAt >= 0 ? (twin.measures[valueAt] ?? '') : '';
  const valuePill = shelves.pills[valueAt];
  const share = valuePill?.table_calc?.kind === 'share' && measureCaption(valuePill) === caption;
  const total = result.rows.length;

  const marks: PlannedMark[] = result.rows.map((row, index) => {
    const twinRow = twin.rows[index];
    const dims = twinRow?.heads ?? [];
    const cells = twinRow?.cells ?? [];
    const id = dims.length > 0 ? dims.join(' | ') : 'all';
    const valueCell = cells[valueAt];
    const valueText = valueCell?.text ?? '';
    const where = `${dims.length > 0 ? dims.join(', ') : 'all'}, ${caption === '' ? '' : `${caption} ${valueText}, `}`;
    const tooltip = [
      ...twin.dimensions.map((name, i) => `${name}: ${dims[i] ?? ''}`),
      ...twin.measures.map((name, i) => `${name}: ${cells[i]?.text ?? ''}`),
    ].join('; ');
    const labelText = shelves.labelMeasures.map((at) => cells[at]?.text ?? '').filter((text) => text !== '').join(', ');
    return {
      index,
      id,
      dims,
      values: row.slice(0, dimCount),
      numbers: row.slice(dimCount).map(numberOf),
      measure: caption,
      value: valueCell?.value ?? '',
      valueText,
      tooltip,
      ariaLabel: `${where}${shape} ${index + 1} of ${total}`,
      color: MARK_COLOURS[0],
      pattern: 'solid',
      member: shelves.colorDim === null ? '' : (dims[shelves.colorDim] ?? ''),
      labelText,
    };
  });

  let members: string[] = [];
  let scale: ColourScale | null = null;
  if (shelves.colorDim !== null) {
    const colorAt = shelves.colorDim;
    const groups = new Map<string, string[]>();
    for (const mark of marks) {
      const key = mark.dims.filter((_, i) => i !== colorAt).join(' | ');
      groups.set(key, [...(groups.get(key) ?? []), mark.member]);
    }
    members = memberOrder([...groups.values()]);
    const styles = new Map(members.map((member, i) => [member, memberStyle(i)]));
    for (const mark of marks) {
      const style = styles.get(mark.member) ?? memberStyle(0);
      mark.color = style.color;
      mark.pattern = style.pattern;
    }
  } else if (shelves.colorMeasure >= 0) {
    const at = shelves.colorMeasure;
    let low: PlannedMark | null = null;
    let high: PlannedMark | null = null;
    for (const mark of marks) {
      const v = mark.numbers[at] ?? null;
      if (v === null) continue;
      if (low === null || v < (low.numbers[at] ?? v)) low = mark;
      if (high === null || v > (high.numbers[at] ?? v)) high = mark;
    }
    if (low && high) {
      const min = low.numbers[at] ?? 0;
      const max = high.numbers[at] ?? 0;
      const textOf = (mark: PlannedMark): string => twin.rows[mark.index]?.cells[at]?.text ?? '';
      scale = { min, max, minText: textOf(low), maxText: textOf(high) };
    }
    for (const mark of marks) {
      const v = mark.numbers[at] ?? null;
      mark.color = v === null || scale === null ? '' : sequentialColour(v, scale.min, scale.max);
    }
  }
  return { kind, shape, twin, shelves, valueAt, share, marks, members, scale };
}
