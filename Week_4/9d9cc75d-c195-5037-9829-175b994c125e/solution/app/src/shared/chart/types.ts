// The plain geometry description of a chart. No DOM and no React: the SVG view and the PNG export both draw from it.
import type { Cell, ChartKind } from '../model.ts';
import type { PatternName } from './palette.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Text centred vertically on `y`; `rotate` turns it by that many degrees about (x, y). */
export interface TextSpot {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  rotate: number;
}

export interface TickLabel extends TextSpot {
  value: number;
  /** the grid line across the plot at this tick */
  line: Segment;
}

export type MarkShape = 'bar' | 'point' | 'cell' | 'text';

export interface ChartMark {
  /** `data-mark`: the dimension values joined by ` | `, or `all` */
  id: string;
  /** position in mark order, 0-based */
  index: number;
  /** the dimension values as displayed, in the order of `ChartLayout.dimensions` */
  dims: string[];
  /** the raw dimension values */
  values: Cell[];
  /** `data-measure`: the caption of the measure the mark shows, empty when the view has none */
  measure: string;
  /** `data-value` */
  value: string;
  /** `data-color`: a channel triple such as `233, 71, 159`, empty for a null Color measure value */
  color: string;
  /** `data-pattern` */
  pattern: PatternName;
  shape: MarkShape;
  ariaLabel: string;
  /** `Dimension: value; ...; Measure: value` */
  tooltip: string;
  /** the visible extent: the bar, the cell, the text cell, or the square around a point */
  box: Rect;
  /** radius of a point, 0 for the other shapes */
  radius: number;
  /** the area that takes pointer input; at least 44 x 44 for points and cells on a touch layout */
  tap: Rect;
  /** the text drawn inside a cell or text cell, empty for bars and points */
  text: string;
  /** the Label shelf text drawn beside a bar or point, empty when the sheet has none */
  label: TextSpot | null;
}

export interface Series {
  color: string;
  pattern: PatternName;
  /** the line is broken at null values, so a series is a list of runs */
  runs: Point[][];
}

export interface ReferenceLine {
  type: 'Average' | 'Median' | 'Constant';
  value: number;
  segment: Segment;
  label: TextSpot;
}

export interface TrendLine {
  segment: Segment;
}

export interface LegendEntry {
  text: string;
  color: string;
  pattern: PatternName;
  /** a sequential scale is one entry drawn as a gradient from the first colour to the second */
  scale: [string, string] | null;
}

export interface ChartLayout {
  kind: ChartKind | 'none';
  /** the used size; it grows past the requested one when tap targets need the room */
  size: { width: number; height: number };
  plot: Rect;
  /** the tick labels of the value axes only */
  ticks: TickLabel[];
  /** the zero line of the value axis, null for heat maps and text tables */
  baseline: Segment | null;
  /** labels of the dimension axes */
  categories: TextSpot[];
  titles: TextSpot[];
  marks: ChartMark[];
  series: Series[];
  references: ReferenceLine[];
  trend: TrendLine | null;
  legend: LegendEntry[];
  /** dimension column names, in the order of `ChartMark.dims` */
  dimensions: string[];
  /** font sizes in user units: axis labels and mark text */
  fontSize: { label: number; mark: number };
}

export interface LayoutOptions {
  /** below 768 px wide: bars at least 44 thick, points and cells with a 44 x 44 tap area */
  touch: boolean;
  /** the dashboard stage and phones: tighter margins, smaller type, no axis titles */
  compact: boolean;
}

/** A requested size; a null height lets the chart choose the height its marks need. */
export interface ChartSize {
  width: number;
  height: number | null;
}
