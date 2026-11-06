import { Evaluation } from './formula/evaluate';
import { formatCellRef, parseRangeRef } from './refs';
import { ChartRecord, WorkbookState, findSheetById } from './workbook';

export interface ChartSeries {
  name: string;
  values: (number | null)[];
}

export interface ChartData {
  categories: string[];
  series: ChartSeries[];
}

/** The first column gives categories, the first row series names, each further column a series. */
export function chartData(chart: ChartRecord, state: WorkbookState, evaluation: Evaluation): ChartData {
  const sheet = findSheetById(state, chart.sheetId);
  const range = parseRangeRef(chart.range);
  if (!sheet || !range) return { categories: [], series: [] };
  const categories: string[] = [];
  for (let row = range.startRow + 1; row <= range.endRow; row++) {
    categories.push(evaluation.displayAt(sheet.id, formatCellRef({ col: range.startCol, row })));
  }
  const series: ChartSeries[] = [];
  for (let col = range.startCol + 1; col <= range.endCol; col++) {
    const name = evaluation.displayAt(sheet.id, formatCellRef({ col, row: range.startRow }));
    const values: (number | null)[] = [];
    for (let row = range.startRow + 1; row <= range.endRow; row++) {
      const value = evaluation.valueAt(sheet.id, formatCellRef({ col, row }));
      values.push(typeof value === 'number' ? value : null);
    }
    series.push({ name, values });
  }
  return { categories, series };
}
