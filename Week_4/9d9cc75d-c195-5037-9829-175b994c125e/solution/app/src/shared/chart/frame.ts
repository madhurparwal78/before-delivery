// Sizes, text fitting and value-axis pieces shared by every chart layout.
import { formatNumber, formatShare } from '../display.ts';
import type { QueryResult } from '../model.ts';
import type { PlannedMark, ViewPlan } from './plan.ts';
import type { ChartMark, LayoutOptions, MarkShape, Point, Rect, ReferenceLine, Segment, TextSpot, TickLabel } from './types.ts';

const TAP = 44;

export interface Metrics {
  touch: boolean;
  compact: boolean;
  /** axis label font size */
  fs: number;
  /** font size of text inside marks */
  markFs: number;
  top: number;
}

export function metricsFor(options: LayoutOptions): Metrics {
  return {
    touch: options.touch,
    compact: options.compact,
    fs: options.compact ? 11 : 13,
    markFs: options.compact ? 12 : 14,
    top: options.compact ? 8 : 16,
  };
}

export const r2 = (n: number): number => Math.round(n * 100) / 100;
export const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** A text width estimate in user units, good enough to size margins without a DOM. */
export function textWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * 0.58);
}

/** Cuts text to fit `maxWidth`, ending in three ASCII dots. */
export function fitText(text: string, maxWidth: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  const keep = Math.max(1, Math.floor(maxWidth / (fontSize * 0.58)) - 3);
  return `${text.slice(0, keep)}...`;
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x: r2(x), y: r2(y), width: r2(width), height: r2(height) };
}

export function segment(x1: number, y1: number, x2: number, y2: number): Segment {
  return { x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2) };
}

export function spot(text: string, x: number, y: number, anchor: TextSpot['anchor'], rotate = 0): TextSpot {
  return { text, x: r2(x), y: r2(y), anchor, rotate };
}

/** Grows a box to at least 44 x 44 around its centre; the tap area of points and cells on a touch layout. */
function tapArea(box: Rect, touch: boolean): Rect {
  if (!touch) return box;
  const width = Math.max(box.width, TAP);
  const height = Math.max(box.height, TAP);
  return rect(box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
}

interface BandSizing {
  pitch: number;
  gap: number;
  thickness: number;
  length: number;
}

/** Equal bands along an axis; bars never get thinner than 44 on a touch layout, and the axis grows to hold them. */
export function sizeBands(count: number, available: number | null, preferred: number, minLength: number, touch: boolean, cap: number): BandSizing {
  const n = Math.max(1, count);
  let pitch = available === null ? clamp(480 / n, 4, preferred) : available / n;
  if (available === null && n * pitch < minLength) pitch = minLength / n;
  let gap = Math.min(pitch * 0.28, 24);
  if (touch && pitch - gap < TAP) {
    pitch = TAP + 12;
    gap = 12;
  }
  return { pitch, gap, thickness: Math.min(pitch - gap, cap), length: pitch * n };
}

export function tickTexts(ticks: readonly number[], share: boolean): string[] {
  return ticks.map((tick) => (share ? formatShare(tick) : formatNumber(tick)));
}

/** Where a value falls along an axis: 0 at the first tick, 1 at the last. */
export function unitScale(ticks: readonly number[]): (value: number) => number {
  const first = ticks[0] ?? 0;
  const span = (ticks[ticks.length - 1] ?? 1) - first;
  return (value) => (value - first) / span;
}

export function verticalTicks(ticks: readonly number[], texts: readonly string[], plot: Rect, yOf: (v: number) => number): TickLabel[] {
  return ticks.map((value, i) => {
    const y = yOf(value);
    return { ...spot(texts[i] ?? '', plot.x - 10, y, 'end'), value, line: segment(plot.x, y, plot.x + plot.width, y) };
  });
}

export function horizontalTicks(ticks: readonly number[], texts: readonly string[], plot: Rect, xOf: (v: number) => number, fs: number): TickLabel[] {
  return ticks.map((value, i) => {
    const x = xOf(value);
    const y = plot.y + plot.height + 10 + fs / 2;
    return { ...spot(texts[i] ?? '', x, y, 'middle'), value, line: segment(x, plot.y, x, plot.y + plot.height) };
  });
}

const REFERENCE_NAME = { average: 'Average', median: 'Median', constant: 'Constant' } as const;

/** Reference lines across the plot at their values; a value past the last tick sits on the plot edge. */
export function referenceLines(result: QueryResult, plan: ViewPlan, plot: Rect, along: 'x' | 'y', at: (v: number) => number, fs: number): ReferenceLine[] {
  const labels = plan.twin.rows.filter((row) => row.kind === 'reference');
  const lines: ReferenceLine[] = [];
  result.reference_lines.forEach((line, i) => {
    if (line.value === null) return;
    const text = `${REFERENCE_NAME[line.type]} ${labels[i]?.cells[0]?.text ?? ''}`;
    if (along === 'x') {
      const x = clamp(at(line.value), plot.x, plot.x + plot.width);
      lines.push({ type: REFERENCE_NAME[line.type], value: line.value, segment: segment(x, plot.y, x, plot.y + plot.height), label: spot(text, x + 4, plot.y + fs, 'start') });
    } else {
      const y = clamp(at(line.value), plot.y, plot.y + plot.height);
      lines.push({ type: REFERENCE_NAME[line.type], value: line.value, segment: segment(plot.x, y, plot.x + plot.width, y), label: spot(text, plot.x + plot.width - 4, y - fs * 0.8, 'end') });
    }
  });
  return lines;
}

/** Liang-Barsky: the part of a segment inside a rectangle, or null when none is. */
export function clipToRect(from: Point, to: Point, box: Rect): Segment | null {
  let t0 = 0;
  let t1 = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const edges: [number, number][] = [
    [-dx, from.x - box.x],
    [dx, box.x + box.width - from.x],
    [-dy, from.y - box.y],
    [dy, box.y + box.height - from.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  if (t0 > t1) return null;
  return segment(from.x + t0 * dx, from.y + t0 * dy, from.x + t1 * dx, from.y + t1 * dy);
}

export function pointMark(mark: ChartMark, centre: Point, radius: number, touch: boolean): ChartMark {
  const box = rect(centre.x - radius, centre.y - radius, radius * 2, radius * 2);
  return { ...mark, box, radius, tap: tapArea(box, touch) };
}

export function baseMark(planned: PlannedMark, shape: MarkShape): ChartMark {
  const none = rect(0, 0, 0, 0);
  return {
    id: planned.id,
    index: planned.index,
    dims: planned.dims,
    values: planned.values,
    measure: planned.measure,
    value: planned.value,
    color: planned.color,
    pattern: planned.pattern,
    shape,
    ariaLabel: planned.ariaLabel,
    tooltip: planned.tooltip,
    box: none,
    radius: 0,
    tap: none,
    text: '',
    label: null,
  };
}
