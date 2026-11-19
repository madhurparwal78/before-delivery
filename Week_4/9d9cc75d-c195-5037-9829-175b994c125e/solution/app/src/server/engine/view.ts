// What a sheet draws: the automatic chart table and the shelf refusals, checked in the published order.
import type { ChartKind, Pill, SheetShape } from '../../shared/model.ts';
import { isMeasurePill } from '../../shared/twin.ts';

/** How a dimension pill counts in the chart table: a continuous date (T), any other date, or no date. */
export type DateKind = 'continuous' | 'discrete' | null;

type ChartChoice = { ok: true; chart: ChartKind | 'none' } | { ok: false; message: string };

type ShelfClass = 'empty' | 'M' | 'T' | 'D';

export const tooManyMeasures = (field: string): string => `One measure per axis. Remove ${field} or place it on Label.`;
export const LINE_REFUSAL = 'Line needs a date on Columns and a measure on Rows.';
export const SCATTER_REFUSAL = 'Scatter needs a measure on Rows and on Columns.';
export const HEAT_MAP_REFUSAL = 'Heat map needs a measure on Color.';
export const SIZE_SCATTER_ONLY = 'Size works with Scatter only.';
export const SIZE_NEEDS_MEASURE = 'Size needs a measure.';

function classify(pills: readonly Pill[], dateKind: (pill: Pill) => DateKind): ShelfClass {
  const last = pills[pills.length - 1];
  if (last === undefined) return 'empty';
  if (pills.some(isMeasurePill)) return 'M';
  return dateKind(last) === 'continuous' ? 'T' : 'D';
}

function automatic(sheet: SheetShape, dateKind: (pill: Pill) => DateKind): ChartKind {
  const rows = classify(sheet.rows, dateKind);
  const columns = classify(sheet.columns, dateKind);
  if (rows === 'M' && columns === 'M') return 'scatter';
  if (rows === 'M' && columns === 'T') return 'line';
  if ((rows === 'M' && columns === 'D') || (rows === 'D' && columns === 'M')) return 'bar';
  if (rows === 'D' && columns === 'D' && sheet.color !== null && isMeasurePill(sheet.color)) return 'heat_map';
  return 'text_table';
}

export function chooseChart(sheet: SheetShape, dateKind: (pill: Pill) => DateKind): ChartChoice {
  for (const shelf of [sheet.rows, sheet.columns]) {
    const extra = shelf.filter(isMeasurePill)[1];
    if (extra) return { ok: false, message: tooManyMeasures(extra.field) };
  }
  const rowsMeasure = sheet.rows.some(isMeasurePill);
  const columnsMeasure = sheet.columns.some(isMeasurePill);
  const chosen = sheet.chart === 'automatic' ? null : sheet.chart;
  if (chosen === 'line' && !(rowsMeasure && sheet.columns.some((p) => !isMeasurePill(p) && dateKind(p) !== null))) {
    return { ok: false, message: LINE_REFUSAL };
  }
  if (chosen === 'scatter' && !(rowsMeasure && columnsMeasure)) return { ok: false, message: SCATTER_REFUSAL };
  if (chosen === 'heat_map' && !(sheet.color !== null && isMeasurePill(sheet.color))) {
    return { ok: false, message: HEAT_MAP_REFUSAL };
  }
  const empty = sheet.rows.length === 0 && sheet.columns.length === 0;
  const chart = empty ? 'none' : (chosen ?? automatic(sheet, dateKind));
  if (sheet.size !== null && chart !== 'scatter') return { ok: false, message: SIZE_SCATTER_ONLY };
  if (sheet.size !== null && !isMeasurePill(sheet.size)) return { ok: false, message: SIZE_NEEDS_MEASURE };
  return { ok: true, chart };
}
