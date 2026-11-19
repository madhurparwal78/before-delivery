// Layouts without a value axis: heat map cells and text table cells on a grid of Rows members by Columns members.
import { memberOrder, type PlannedMark, type ViewPlan } from './plan.ts';
import { baseMark, clamp, fitText, metricsFor, r2, rect, spot, textWidth } from './frame.ts';
import type { LayoutBody } from './cartesian.ts';
import type { ChartMark, ChartSize, LayoutOptions, TextSpot } from './types.ts';

const MAX_TEXT_CELL = 240;
const CELL_GAP = 4;

function keyOf(mark: PlannedMark, dims: readonly number[]): string {
  return dims.map((i) => mark.dims[i] ?? '').join(' | ');
}

/** Row or column members in grid order: each line of the grid follows the sort, so the merge of the lines gives the order. */
function lineOrder(plan: ViewPlan, along: readonly number[], across: readonly number[]): string[] {
  const lines = new Map<string, string[]>();
  for (const mark of plan.marks) {
    const line = keyOf(mark, across);
    lines.set(line, [...(lines.get(line) ?? []), keyOf(mark, along)]);
  }
  return memberOrder([...lines.values()]);
}

export function layoutGrid(plan: ViewPlan, size: ChartSize, options: LayoutOptions): LayoutBody {
  const m = metricsFor(options);
  const { fs, markFs } = m;
  const { rowDims, columnDims } = plan.shelves;
  const rowKeys = lineOrder(plan, rowDims, columnDims);
  const columnKeys = lineOrder(plan, columnDims, rowDims);
  const rowAt = new Map(rowKeys.map((key, i) => [key, i]));
  const columnAt = new Map(columnKeys.map((key, i) => [key, i]));
  const heat = plan.shape === 'cell';

  const widestRow = rowDims.length > 0 ? Math.max(...rowKeys.map((k) => textWidth(k, fs))) : 0;
  const labelWidth = Math.min(widestRow, size.width * 0.3);
  const left = labelWidth > 0 ? labelWidth + 24 : 16;
  const right = 16;
  const header = columnDims.length > 0 ? fs + 20 : 0;
  const top = m.top + header;
  const widestText = heat ? 0 : Math.max(0, ...plan.marks.map((mark) => textWidth(mark.valueText, markFs)));
  const minCell = Math.max(m.touch ? 44 + CELL_GAP : 48, widestText + 20);
  const maxCell = heat ? Number.POSITIVE_INFINITY : MAX_TEXT_CELL;
  const cellWidth = clamp((size.width - left - right) / columnKeys.length, minCell, maxCell);
  const preferredHeight = m.compact ? 36 : 52;
  const available = size.height === null ? null : size.height - top - 16;
  const cellHeight = Math.max(m.touch ? 44 + CELL_GAP : 32, available === null ? preferredHeight : Math.min(available / rowKeys.length, 96));
  const plot = rect(left, top, cellWidth * columnKeys.length, cellHeight * rowKeys.length);
  const width = Math.max(size.width, left + plot.width + right);
  const height = top + plot.height + 16;

  const marks: ChartMark[] = new Array(plan.marks.length);
  for (const planned of plan.marks) {
    const column = columnAt.get(keyOf(planned, columnDims)) ?? 0;
    const row = rowAt.get(keyOf(planned, rowDims)) ?? 0;
    const box = rect(plot.x + column * cellWidth + CELL_GAP / 2, plot.y + row * cellHeight + CELL_GAP / 2, cellWidth - CELL_GAP, cellHeight - CELL_GAP);
    marks[planned.index] = { ...baseMark(planned, plan.shape), box, tap: box, text: fitText(planned.valueText, box.width - 8, markFs) };
  }
  const categories: TextSpot[] = [
    ...rowKeys.map((key, i) => spot(fitText(key, labelWidth, fs), plot.x - 12, plot.y + (i + 0.5) * cellHeight, 'end')),
    ...columnKeys.map((key, i) => spot(fitText(key, cellWidth - 6, fs), plot.x + (i + 0.5) * cellWidth, m.top + header / 2, 'middle')),
  ].filter((label) => label.text !== '');
  return { size: { width: r2(width), height: r2(height) }, plot, ticks: [], baseline: null, categories, titles: [], marks, series: [], references: [], trend: null };
}
