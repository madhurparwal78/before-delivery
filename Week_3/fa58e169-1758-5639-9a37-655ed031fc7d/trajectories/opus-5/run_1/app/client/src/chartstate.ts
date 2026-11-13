import { analyseChart } from '../../src/domain/rows';
import { findSymbol } from '../../src/domain/symbols';
import type { Cell, Chart, ChartAnalysis, ColourLimits } from '../../src/domain/types';

export const cellKey = (row: number, col: number): string => `${row}:${col}`;

export interface ChartShape {
  craft: Chart['craft'];
  mode: Chart['mode'];
  terms: Chart['terms'];
  castOn: number;
  width: number;
  height: number;
  colours: Chart['colours'];
  repeats: Chart['repeats'];
}

export function chartOf(shape: ChartShape, cells: Map<string, Cell>): Chart {
  return { ...shape, cells: [...cells.values()] };
}

export function cellMap(cells: Cell[]): Map<string, Cell> {
  const map = new Map<string, Cell>();
  for (const cell of cells) map.set(cellKey(cell.row, cell.col), cell);
  return map;
}

export function analyse(chart: Chart, limits: ColourLimits): ChartAnalysis {
  return analyseChart(chart, limits);
}

/** The token a cell belongs to, and the cells a token covers. */
export function twinMaps(analysis: ChartAnalysis): {
  cellToToken: Map<string, { row: number; index: number }>;
  tokenCells: Map<string, string[]>;
} {
  const cellToToken = new Map<string, { row: number; index: number }>();
  const tokenCells = new Map<string, string[]>();
  for (const row of analysis.rows) {
    row.tokens.forEach((token, index) => {
      const keys = token.cells.map((cell) => cellKey(cell.row, cell.col));
      tokenCells.set(`${row.row}:${index}`, keys);
      for (const key of keys) cellToToken.set(key, { row: row.row, index });
    });
  }
  return { cellToToken, tokenCells };
}

export function stitchName(craft: Chart['craft'], stitch: string): string {
  return findSymbol(craft, stitch)?.name ?? stitch;
}

export function cellLabel(craft: Chart['craft'], cell: Cell): string {
  const name = stitchName(craft, cell.stitch);
  const base = `Row ${cell.row}, column ${cell.col}: ${name}, colour ${cell.colour}`;
  return cell.repeat ? `${base}, repeat ${cell.repeat}` : base;
}

/** The row check text for a change, new errors first then cleared rows. */
export function rowCheckText(
  before: { row: number; errors: string[] }[],
  after: { row: number; errors: string[] }[],
): string {
  const earlier = new Map(before.map((row) => [row.row, row.errors]));
  const fresh: string[] = [];
  const cleared: string[] = [];
  for (const row of after) {
    const had = earlier.get(row.row) ?? [];
    for (const message of row.errors) {
      if (!had.includes(message)) fresh.push(message);
    }
    if (had.length > 0 && row.errors.length === 0) cleared.push(`Row ${row.row} is correct.`);
  }
  return [...fresh, ...cleared].join(' ');
}
