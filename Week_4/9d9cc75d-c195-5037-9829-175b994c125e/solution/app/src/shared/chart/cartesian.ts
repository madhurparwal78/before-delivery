// Layouts with a value axis: bars (horizontal when the dimension is on Rows, vertical when it is on Columns), lines
// and scatter plots.
import type { QueryResult } from '../model.ts';
import { memberOrder, type PlannedMark, type ViewPlan } from './plan.ts';
import {
  baseMark, clipToRect, fitText, horizontalTicks, metricsFor, pointMark, r2, rect, referenceLines, segment, sizeBands, spot,
  textWidth, tickTexts, unitScale, verticalTicks, type Metrics,
} from './frame.ts';
import { computeTicks } from './ticks.ts';
import type { ChartLayout, ChartMark, ChartSize, LayoutOptions, Point, Rect, Series, TextSpot, TrendLine } from './types.ts';

export type LayoutBody = Pick<ChartLayout, 'size' | 'plot' | 'ticks' | 'baseline' | 'categories' | 'titles' | 'marks' | 'series' | 'references' | 'trend'>;

const BAR_CAP = 72;
const COLUMN_CAP = 120;

function amountOf(plan: ViewPlan, mark: PlannedMark): number | null {
  return plan.valueAt < 0 ? null : (mark.numbers[plan.valueAt] ?? null);
}

function bandKey(mark: PlannedMark, bandDims: readonly number[]): string {
  return bandDims.map((i) => mark.dims[i] ?? '').join(' | ');
}

function titleOf(plan: ViewPlan, dims: readonly number[]): string {
  return dims.map((i) => plan.twin.dimensions[i] ?? '').join(', ');
}

interface Band {
  label: string;
  marks: PlannedMark[];
}

/** Bands in mark order; inside a band the marks stack in Color member order. */
function bandsOf(plan: ViewPlan, bandDims: readonly number[]): Band[] {
  const bands = new Map<string, Band>();
  for (const mark of plan.marks) {
    const key = bandKey(mark, bandDims);
    const band = bands.get(key) ?? { label: key, marks: [] };
    band.marks.push(mark);
    bands.set(key, band);
  }
  if (plan.shelves.colorDim !== null) {
    const rank = new Map(plan.members.map((member, i) => [member, i]));
    for (const band of bands.values()) band.marks.sort((a, b) => (rank.get(a.member) ?? 0) - (rank.get(b.member) ?? 0));
  }
  return [...bands.values()];
}

interface Frame {
  size: { width: number; height: number };
  plot: Rect;
  categories: TextSpot[];
  titles: TextSpot[];
  /** the centre of band `i` along the category axis */
  centre: (i: number) => number;
  pitch: number;
  thickness: number;
  gap: number;
}

/** Category axis along the bottom, value axis up the left side. */
function verticalFrame(plan: ViewPlan, size: ChartSize, m: Metrics, labels: readonly string[], dims: readonly number[], tickLabels: readonly string[], cap: number): Frame {
  const { fs } = m;
  const valueTitle = m.compact ? '' : (plan.twin.measures[plan.valueAt] ?? '');
  const categoryTitle = m.compact ? '' : titleOf(plan, dims);
  const widestTick = Math.max(...tickLabels.map((t) => textWidth(t, fs)));
  const left = widestTick + 20 + (valueTitle ? fs + 12 : 0);
  const right = 16;
  const widest = labels.length > 0 ? Math.max(...labels.map((l) => textWidth(l, fs))) : 0;
  const bands = sizeBands(labels.length, size.width - left - right, 0, 0, m.touch, cap);
  const width = left + bands.length + right;
  const rotated = widest > bands.pitch - 8;
  const shownWidth = rotated ? Math.min(widest, 120) : widest;
  const labelBand = widest === 0 ? 0 : rotated ? shownWidth * 0.64 + fs + 10 : fs + 16;
  const bottom = labelBand + 10 + (categoryTitle ? fs + 14 : 0) + (widest === 0 ? fs : 0);
  const plotHeight = size.height === null ? (m.compact ? 200 : 320) : Math.max(120, size.height - m.top - bottom);
  const plot = rect(left, m.top, bands.length, plotHeight);
  const centre = (i: number): number => plot.x + (i + 0.5) * bands.pitch;
  const step = Math.max(1, Math.ceil((rotated ? fs + 4 : 16) / bands.pitch));
  const categories = labels.flatMap((label, i): TextSpot[] => {
    if (i % step !== 0 || label === '') return [];
    const y = plot.y + plot.height + 10 + (rotated ? 0 : fs / 2);
    return [rotated ? spot(fitText(label, 120, fs), centre(i), y, 'end', -40) : spot(fitText(label, bands.pitch - 6, fs), centre(i), y, 'middle')];
  });
  const height = m.top + plotHeight + bottom;
  const titles: TextSpot[] = [];
  if (valueTitle) titles.push(spot(valueTitle, fs / 2 + 4, plot.y + plot.height / 2, 'middle', -90));
  if (categoryTitle) titles.push(spot(categoryTitle, plot.x + plot.width / 2, height - fs / 2 - 4, 'middle'));
  return { size: { width: r2(width), height: r2(height) }, plot, categories, titles, centre, pitch: bands.pitch, thickness: bands.thickness, gap: bands.gap };
}

function trendLine(result: QueryResult, place: (x: number, y: number) => Point, x0: number, x1: number, plot: Rect): TrendLine | null {
  if (!result.trend) return null;
  const { slope, intercept } = result.trend;
  const clipped = clipToRect(place(x0, intercept + slope * x0), place(x1, intercept + slope * x1), plot);
  return clipped ? { segment: clipped } : null;
}

interface Stack {
  positive: number;
  negative: number;
}

/** Adds a value to a stack and returns the span it covers along the value axis. */
function stackSpan(stack: Stack, v: number): [number, number] {
  if (v >= 0) {
    const from = stack.positive;
    stack.positive += v;
    return [from, stack.positive];
  }
  const to = stack.negative;
  stack.negative += v;
  return [stack.negative, to];
}

export function layoutBars(plan: ViewPlan, result: QueryResult, size: ChartSize, options: LayoutOptions): LayoutBody {
  const m = metricsFor(options);
  const horizontal = plan.shelves.rowsMeasure < 0;
  const bandDims = horizontal ? plan.shelves.rowDims : plan.shelves.columnDims;
  const bands = bandsOf(plan, bandDims);
  const extremes = bands.flatMap((band) => {
    const stack = { positive: 0, negative: 0 };
    for (const mark of band.marks) stackSpan(stack, amountOf(plan, mark) ?? 0);
    return [stack.positive, stack.negative];
  });
  const ticks = computeTicks(extremes);
  const texts = tickTexts(ticks, plan.share);
  const unit = unitScale(ticks);
  const labels = bands.map((band) => band.label);
  const out: ChartMark[] = new Array(plan.marks.length);

  if (horizontal) {
    const { fs } = m;
    const valueTitle = m.compact ? '' : (plan.twin.measures[plan.valueAt] ?? '');
    const categoryTitle = m.compact ? '' : titleOf(plan, bandDims);
    const widest = labels.length > 0 ? Math.max(...labels.map((l) => textWidth(l, fs))) : 0;
    const labelWidth = Math.min(widest, size.width * 0.3);
    const left = (categoryTitle ? fs + 12 : 0) + (labelWidth > 0 ? labelWidth + 26 : 16);
    const right = Math.max(16, textWidth(texts[texts.length - 1] ?? '', fs) / 2 + 6);
    const bottom = fs + 18 + (valueTitle ? fs + 14 : 0);
    const width = Math.max(size.width, left + right + 120);
    const sizing = sizeBands(bands.length, size.height === null ? null : size.height - m.top - bottom, 56, m.compact ? 120 : 180, m.touch, BAR_CAP);
    const plot = rect(left, m.top, width - left - right, sizing.length);
    const xOf = (v: number): number => plot.x + unit(v) * plot.width;
    const height = m.top + sizing.length + bottom;
    bands.forEach((band, i) => {
      const y = plot.y + i * sizing.pitch + (sizing.pitch - sizing.thickness) / 2;
      const stack = { positive: 0, negative: 0 };
      for (const planned of band.marks) {
        const [from, to] = stackSpan(stack, amountOf(plan, planned) ?? 0);
        const box = rect(xOf(from), y, xOf(to) - xOf(from), sizing.thickness);
        const mark = { ...baseMark(planned, 'bar'), box, tap: box };
        if (planned.labelText && band.marks.length === 1) mark.label = spot(planned.labelText, box.x + box.width + 6, y + sizing.thickness / 2, 'start');
        out[planned.index] = mark;
      }
    });
    const titles: TextSpot[] = [];
    if (categoryTitle) titles.push(spot(categoryTitle, fs / 2 + 4, plot.y + plot.height / 2, 'middle', -90));
    if (valueTitle) titles.push(spot(valueTitle, plot.x + plot.width / 2, height - fs / 2 - 4, 'middle'));
    return {
      size: { width: r2(width), height: r2(height) },
      plot,
      ticks: horizontalTicks(ticks, texts, plot, xOf, fs),
      baseline: segment(xOf(0), plot.y, xOf(0), plot.y + plot.height),
      categories: labels.map((label, i) => spot(fitText(label, labelWidth, fs), plot.x - 12, plot.y + (i + 0.5) * sizing.pitch, 'end')),
      titles,
      marks: out,
      series: [],
      references: referenceLines(result, plan, plot, 'x', xOf, fs),
      trend: null,
    };
  }

  const frame = verticalFrame(plan, size, m, labels, bandDims, texts, COLUMN_CAP);
  const { plot } = frame;
  const yOf = (v: number): number => plot.y + plot.height - unit(v) * plot.height;
  bands.forEach((band, i) => {
    const x = frame.centre(i) - frame.thickness / 2;
    const stack = { positive: 0, negative: 0 };
    for (const planned of band.marks) {
      const v = amountOf(plan, planned) ?? 0;
      const [from, to] = stackSpan(stack, v);
      const top = yOf(to);
      const box = rect(x, top, frame.thickness, yOf(from) - top);
      const mark = { ...baseMark(planned, 'bar'), box, tap: box };
      if (planned.labelText && band.marks.length === 1) mark.label = spot(planned.labelText, frame.centre(i), v >= 0 ? top - 10 : top + box.height + 10, 'middle');
      out[planned.index] = mark;
    }
  });
  return {
    size: frame.size,
    plot,
    ticks: verticalTicks(ticks, texts, plot, yOf),
    baseline: segment(plot.x, yOf(0), plot.x + plot.width, yOf(0)),
    categories: frame.categories,
    titles: frame.titles,
    marks: out,
    series: [],
    references: referenceLines(result, plan, plot, 'y', yOf, m.fs),
    trend: trendLine(result, (i, v) => ({ x: frame.centre(i), y: yOf(v) }), 0, Math.max(0, bands.length - 1), plot),
  };
}

export function layoutLine(plan: ViewPlan, result: QueryResult, size: ChartSize, options: LayoutOptions): LayoutBody {
  const m = metricsFor(options);
  const bandDims = plan.shelves.columnDims;
  const seriesDims = plan.marks[0]?.dims.map((_, i) => i).filter((i) => !bandDims.includes(i)) ?? [];
  const groups = new Map<string, PlannedMark[]>();
  for (const mark of plan.marks) {
    const key = bandKey(mark, seriesDims);
    groups.set(key, [...(groups.get(key) ?? []), mark]);
  }
  const order = memberOrder([...groups.values()].map((marks) => marks.map((mark) => bandKey(mark, bandDims))));
  const at = new Map(order.map((label, i) => [label, i]));
  const values = plan.marks.map((mark) => amountOf(plan, mark));
  const ticks = computeTicks(values);
  const texts = tickTexts(ticks, plan.share);
  const unit = unitScale(ticks);
  const frame = verticalFrame(plan, size, m, order, bandDims, texts, COLUMN_CAP);
  const { plot } = frame;
  const yOf = (v: number): number => plot.y + plot.height - unit(v) * plot.height;
  const radius = m.compact ? 5 : 7;
  const out: ChartMark[] = new Array(plan.marks.length);
  const series: Series[] = [];
  for (const marks of groups.values()) {
    const runs: Point[][] = [];
    let run: Point[] = [];
    const sorted = [...marks].sort((a, b) => (at.get(bandKey(a, bandDims)) ?? 0) - (at.get(bandKey(b, bandDims)) ?? 0));
    for (const planned of sorted) {
      const value = amountOf(plan, planned);
      const centre = { x: frame.centre(at.get(bandKey(planned, bandDims)) ?? 0), y: yOf(value ?? 0) };
      const mark = pointMark(baseMark(planned, 'point'), centre, radius, m.touch);
      if (planned.labelText) mark.label = spot(planned.labelText, centre.x, centre.y - radius - 10, 'middle');
      out[planned.index] = mark;
      if (value === null) {
        if (run.length > 0) runs.push(run);
        run = [];
      } else {
        run.push({ x: r2(centre.x), y: r2(centre.y) });
      }
    }
    if (run.length > 0) runs.push(run);
    const first = marks[0];
    series.push({ color: first?.color ?? '', pattern: first?.pattern ?? 'solid', runs });
  }
  return {
    size: frame.size,
    plot,
    ticks: verticalTicks(ticks, texts, plot, yOf),
    baseline: segment(plot.x, yOf(0), plot.x + plot.width, yOf(0)),
    categories: frame.categories,
    titles: frame.titles,
    marks: out,
    series,
    references: referenceLines(result, plan, plot, 'y', yOf, m.fs),
    trend: trendLine(result, (i, v) => ({ x: frame.centre(i), y: yOf(v) }), 0, Math.max(0, order.length - 1), plot),
  };
}

export function layoutScatter(plan: ViewPlan, result: QueryResult, size: ChartSize, options: LayoutOptions): LayoutBody {
  const m = metricsFor(options);
  const { fs } = m;
  const { shelves } = plan;
  const xs = plan.marks.map((mark) => (shelves.columnsMeasure < 0 ? null : (mark.numbers[shelves.columnsMeasure] ?? null)));
  const ys = plan.marks.map((mark) => amountOf(plan, mark));
  const xTicks = computeTicks(xs);
  const yTicks = computeTicks(ys);
  const xTexts = tickTexts(xTicks, false);
  const yTexts = tickTexts(yTicks, plan.share);
  const xUnit = unitScale(xTicks);
  const yUnit = unitScale(yTicks);
  const xTitle = m.compact ? '' : (plan.twin.measures[shelves.columnsMeasure] ?? '');
  const yTitle = m.compact ? '' : (plan.twin.measures[plan.valueAt] ?? '');
  const top = m.top + 8;
  const left = Math.max(...yTexts.map((t) => textWidth(t, fs))) + 20 + (yTitle ? fs + 12 : 0);
  const right = Math.max(16, textWidth(xTexts[xTexts.length - 1] ?? '', fs) / 2 + 6) + 8;
  const bottom = fs + 18 + (xTitle ? fs + 14 : 0);
  const width = Math.max(size.width, left + right + 120);
  const plotHeight = size.height === null ? (m.compact ? 220 : 360) : Math.max(120, size.height - top - bottom);
  const plot = rect(left, top, width - left - right, plotHeight);
  const height = top + plotHeight + bottom;
  const xOf = (v: number): number => plot.x + xUnit(v) * plot.width;
  const yOf = (v: number): number => plot.y + plot.height - yUnit(v) * plot.height;

  const sizes = shelves.sizeMeasure < 0 ? [] : plan.marks.map((mark) => mark.numbers[shelves.sizeMeasure] ?? null);
  const known = sizes.filter((v): v is number => v !== null);
  const lowest = known.length > 0 ? Math.min(...known) : 0;
  const highest = known.length > 0 ? Math.max(...known) : 0;
  const base = m.compact ? 6.5 : 9;
  const biggest = m.compact ? 14 : 22;
  const radiusOf = (i: number): number => {
    const v = sizes[i] ?? null;
    if (shelves.sizeMeasure < 0 || highest === lowest) return base;
    return v === null ? 4 : 4 + (biggest - 4) * Math.sqrt((v - lowest) / (highest - lowest));
  };
  const out: ChartMark[] = plan.marks.map((planned, i) => {
    const centre = { x: xOf(xs[i] ?? 0), y: yOf(ys[i] ?? 0) };
    const mark = pointMark(baseMark(planned, 'point'), centre, radiusOf(i), m.touch);
    if (planned.labelText) mark.label = spot(planned.labelText, centre.x, centre.y - mark.radius - 10, 'middle');
    return mark;
  });
  const titles: TextSpot[] = [];
  if (yTitle) titles.push(spot(yTitle, fs / 2 + 4, plot.y + plot.height / 2, 'middle', -90));
  if (xTitle) titles.push(spot(xTitle, plot.x + plot.width / 2, height - fs / 2 - 4, 'middle'));
  const knownX = xs.filter((v): v is number => v !== null);
  const xMin = knownX.length > 0 ? Math.min(...knownX) : 0;
  const xMax = knownX.length > 0 ? Math.max(...knownX) : 0;
  return {
    size: { width: r2(width), height: r2(height) },
    plot,
    ticks: [...horizontalTicks(xTicks, xTexts, plot, xOf, fs), ...verticalTicks(yTicks, yTexts, plot, yOf)],
    baseline: segment(plot.x, yOf(0), plot.x + plot.width, yOf(0)),
    categories: [],
    titles,
    marks: out,
    series: [],
    references: referenceLines(result, plan, plot, 'y', yOf, fs),
    trend: trendLine(result, (x, v) => ({ x: xOf(x), y: yOf(v) }), xMin, xMax, plot),
  };
}
