// The chart layout: a pure function of the sheet shape, the query result and a size. The SVG view draws it and the PNG
// export draws the same description, so the marks are identical.
import type { QueryResult, SheetShape } from '../model.ts';
import { layoutBars, layoutLine, layoutScatter, type LayoutBody } from './cartesian.ts';
import { metricsFor, rect } from './frame.ts';
import { layoutGrid } from './grid.ts';
import { HIGH_COLOUR, LOW_COLOUR, memberStyle } from './palette.ts';
import { planView, type ViewPlan } from './plan.ts';
import type { ChartLayout, ChartSize, LayoutOptions, LegendEntry } from './types.ts';

function legendOf(plan: ViewPlan): LegendEntry[] {
  if (plan.scale) {
    return [{ text: `${plan.scale.minText} to ${plan.scale.maxText}`, color: HIGH_COLOUR, pattern: 'solid', scale: [LOW_COLOUR, HIGH_COLOUR] }];
  }
  return plan.members.map((text, i) => ({ text, ...memberStyle(i), scale: null }));
}

function bodyOf(plan: ViewPlan, result: QueryResult, size: ChartSize, options: LayoutOptions): LayoutBody {
  switch (plan.kind) {
    case 'bar':
      return layoutBars(plan, result, size, options);
    case 'line':
      return layoutLine(plan, result, size, options);
    case 'scatter':
      return layoutScatter(plan, result, size, options);
    case 'heat_map':
    case 'text_table':
      return layoutGrid(plan, size, options);
  }
}

/**
 * Lays a view out inside `size.width` and, when `size.height` is a number, that height. The result may be larger than
 * asked when tap targets need the room. Deterministic for the same arguments.
 */
export function layoutChart(sheet: SheetShape, result: QueryResult, size: ChartSize, options: LayoutOptions): ChartLayout {
  const metrics = metricsFor(options);
  const fontSize = { label: metrics.fs, mark: metrics.markFs };
  const plan = planView(sheet, result);
  if (!plan) {
    const empty = rect(0, 0, 0, 0);
    return {
      kind: 'none', size: { width: size.width, height: size.height ?? 0 }, plot: empty, ticks: [], baseline: null, categories: [], titles: [],
      marks: [], series: [], references: [], trend: null, legend: [], dimensions: [], fontSize,
    };
  }
  return { kind: plan.kind, ...bodyOf(plan, result, size, options), legend: legendOf(plan), dimensions: plan.twin.dimensions, fontSize };
}
