import { CABLE, CABLE_CELLS, NO_STITCH, findSymbol, stitchText } from './symbols';
import type { Cell, CellRef, Chart, RepeatBox, RowItem, Side } from './types';

export type Grid = (row: number, col: number) => Cell;

export function makeGrid(chart: Chart): Grid {
  const byKey = new Map<number, Cell>();
  for (const cell of chart.cells) byKey.set(cell.row * 1000 + cell.col, cell);
  return (row: number, col: number) => {
    const found = byKey.get(row * 1000 + col);
    return found ?? { row, col, stitch: NO_STITCH, colour: 'A', repeat: null, rev: 0 };
  };
}

export function rowSide(chart: Pick<Chart, 'mode'>, row: number): Side {
  if (chart.mode === 'round') return 'RND';
  return row % 2 === 1 ? 'RS' : 'WS';
}

export function readsRightToLeft(side: Side): boolean {
  return side !== 'WS';
}

export function boxesOnRow(chart: Pick<Chart, 'repeats'>, row: number): RepeatBox[] {
  return chart.repeats
    .filter((box) => row >= box.fromRow && row <= box.toRow)
    .sort((a, b) => a.fromCol - b.fromCol);
}

/** The row's columns left to right, with every repeat box worked its number of times. */
function expandedColumns(chart: Pick<Chart, 'repeats' | 'width'>, row: number): number[] {
  const boxes = boxesOnRow(chart, row);
  const columns: number[] = [];
  let col = 1;
  while (col <= chart.width) {
    const box = boxes.find((b) => b.fromCol === col);
    if (box) {
      for (let time = 0; time < box.times; time += 1) {
        for (let inner = box.fromCol; inner <= box.toCol; inner += 1) columns.push(inner);
      }
      col = box.toCol + 1;
    } else {
      columns.push(col);
      col += 1;
    }
  }
  return columns;
}

/** The row's columns in reading order, repeat boxes worked out. */
export function readingColumns(chart: Pick<Chart, 'repeats' | 'width' | 'mode'>, row: number): number[] {
  const columns = expandedColumns(chart, row);
  return readsRightToLeft(rowSide(chart, row)) ? columns.reverse() : columns;
}

export interface RowItemsResult {
  items: RowItem[];
  /** True when any run of cable cells is not a whole number of cables. */
  brokenCable: boolean;
  hasCable: boolean;
  empty: boolean;
}

export function rowItems(chart: Chart, row: number, grid = makeGrid(chart)): RowItemsResult {
  const side = rowSide(chart, row);
  const columns = readingColumns(chart, row);
  const items: RowItem[] = [];
  let brokenCable = false;
  let hasCable = false;
  let empty = true;
  let cableRun: Cell[] = [];

  const flushCable = (): void => {
    if (cableRun.length === 0) return;
    if (cableRun.length % CABLE_CELLS !== 0) brokenCable = true;
    for (let start = 0; start < cableRun.length; start += CABLE_CELLS) {
      const group = cableRun.slice(start, start + CABLE_CELLS);
      const symbol = findSymbol(chart.craft, CABLE)!;
      items.push({
        stitch: CABLE,
        text: stitchText(symbol, chart.craft, chart.terms, side),
        counted: false,
        uses: group.length,
        makes: group.length,
        colour: group[0].colour,
        cells: group.map((cell) => ({ row: cell.row, col: cell.col })),
      });
    }
    cableRun = [];
  };

  for (const col of columns) {
    const cell = grid(row, col);
    if (cell.stitch !== NO_STITCH) empty = false;
    if (cell.stitch === CABLE) {
      hasCable = true;
      cableRun.push(cell);
      continue;
    }
    flushCable();
    if (cell.stitch === NO_STITCH) continue;
    const symbol = findSymbol(chart.craft, cell.stitch);
    if (!symbol) continue;
    items.push({
      stitch: cell.stitch,
      text: stitchText(symbol, chart.craft, chart.terms, side),
      counted: symbol.counted,
      uses: symbol.uses,
      makes: symbol.makes,
      colour: cell.colour,
      cells: [{ row: cell.row, col: cell.col }],
    });
  }
  flushCable();
  return { items, brokenCable, hasCable, empty };
}

export function uniqueCells(cells: CellRef[]): CellRef[] {
  const seen = new Set<string>();
  const out: CellRef[] = [];
  for (const cell of cells) {
    const key = `${cell.row}:${cell.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cell);
  }
  return out;
}

export function rowIsMultiColour(items: RowItem[]): boolean {
  const colours = new Set(items.map((item) => item.colour));
  return colours.size > 1;
}
