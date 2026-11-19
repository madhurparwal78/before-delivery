import { displayNumber } from './display.js';
import type { ChartType, MeasurePill, Pill, TableCalcKind } from './types.js';

export const CALC_WORDS: Record<TableCalcKind, string> = {
  run_total: 'Running total',
  prev_diff: 'Difference from previous',
  share: 'Percent of total',
  rank: 'Rank',
};

export function isMeasurePill(p: Pill): p is MeasurePill {
  return typeof p === 'object' && p !== null && 'agg' in p;
}

export function pillField(p: Pill): string {
  if (typeof p === 'string') return p;
  return p.field;
}

export function measureCaption(pill: MeasurePill): string {
  const base = pill.agg === 'SUM' ? pill.field : `${pill.agg} ${pill.field}`;
  if (pill.table_calc === null) return base;
  return `${CALC_WORDS[pill.table_calc.kind]} of ${base}`;
}

export interface TickScale {
  ticks: number[];
  first: number;
  last: number;
}

export function tickScale(values: (number | null)[]): TickScale {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = Math.min(0, ...(present.length > 0 ? present : [0]));
  const hi = Math.max(0, ...(present.length > 0 ? present : [0]));
  if (lo === 0 && hi === 0) return { ticks: [0, 1], first: 0, last: 1 };
  const raw = (hi - lo) / 4;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * e).find((s) => s >= raw) ?? 10 * e;
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  const count = Math.round((last - first) / step);
  for (let i = 0; i <= count; i += 1) ticks.push(Number((first + i * step).toPrecision(12)));
  return { ticks, first, last };
}

export function tickLabel(v: number): string {
  return displayNumber(v);
}

export const CATEGORICAL_COLORS: [number, number, number][] = [
  [233, 71, 159],
  [26, 10, 20],
  [217, 225, 63],
  [110, 74, 94],
  [234, 160, 205],
];

export const PATTERNS = ['solid', 'dots', 'stripes', 'checks', 'rings'];

export function colorTriple(rgb: [number, number, number]): string {
  return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
}

export function categoricalColor(index: number): string {
  return colorTriple(CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]);
}

export function categoricalPattern(index: number): string {
  return PATTERNS[index % PATTERNS.length];
}

const SEQ_LOW: [number, number, number] = [253, 241, 247];
const SEQ_HIGH: [number, number, number] = [233, 71, 159];

export function sequentialColor(v: number | null, min: number, max: number): string {
  if (v === null) return '';
  const t = max === min ? 0 : (v - min) / (max - min);
  const channel = (lo: number, hi: number): number => Math.floor(lo + (hi - lo) * t + 0.5);
  return colorTriple([
    channel(SEQ_LOW[0], SEQ_HIGH[0]),
    channel(SEQ_LOW[1], SEQ_HIGH[1]),
    channel(SEQ_LOW[2], SEQ_HIGH[2]),
  ]);
}

export function rgbCss(triple: string): string {
  return `rgb(${triple})`;
}

export type ShelfClass = 'empty' | 'D' | 'M' | 'T';

export interface ViewShape {
  rows: ShelfClass;
  columns: ShelfClass;
  colorIsMeasure: boolean;
  colorPresent: boolean;
  sizePresent: boolean;
  sizeIsMeasure: boolean;
  rowMeasures: number;
  columnMeasures: number;
  secondAxisMeasure: string | null;
}

export type DrawnChart = 'none' | 'bar' | 'line' | 'scatter' | 'text_table' | 'heat_map';

export function automaticChart(shape: ViewShape): DrawnChart {
  const { rows, columns, colorIsMeasure } = shape;
  if (rows === 'empty' && columns === 'empty') return 'none';
  if (rows === 'M' && columns === 'M') return 'scatter';
  if (rows === 'M' && columns === 'T') return 'line';
  if (rows === 'M' && columns === 'D') return 'bar';
  if (rows === 'D' && columns === 'M') return 'bar';
  if (rows === 'D' && columns === 'D' && colorIsMeasure) return 'heat_map';
  return 'text_table';
}

export function chartRefusal(chart: ChartType, shape: ViewShape): string | null {
  if (shape.secondAxisMeasure !== null) {
    return `One measure per axis. Remove ${shape.secondAxisMeasure} or place it on Label.`;
  }
  if (chart === 'line' && !(shape.rows === 'M' && shape.columns === 'T')) {
    return 'Line needs a date on Columns and a measure on Rows.';
  }
  if (chart === 'scatter' && !(shape.rows === 'M' && shape.columns === 'M')) {
    return 'Scatter needs a measure on Rows and on Columns.';
  }
  if (chart === 'heat_map' && !shape.colorIsMeasure) {
    return 'Heat map needs a measure on Color.';
  }
  const drawn = chart === 'automatic' ? automaticChart(shape) : chart;
  if (shape.sizePresent && drawn !== 'scatter') return 'Size works with Scatter only.';
  if (shape.sizePresent && !shape.sizeIsMeasure) return 'Size needs a measure.';
  return null;
}

export function markShape(chart: DrawnChart): string {
  switch (chart) {
    case 'bar':
      return 'bar';
    case 'line':
    case 'scatter':
      return 'point';
    case 'heat_map':
      return 'cell';
    default:
      return 'text';
  }
}
