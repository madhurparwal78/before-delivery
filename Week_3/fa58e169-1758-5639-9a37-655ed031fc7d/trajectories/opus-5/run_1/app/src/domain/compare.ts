import { makeGrid } from './chart';
import { analyseChart, topRowStitches } from './rows';
import { NO_STITCH } from './symbols';
import type { Chart, ColourLimits } from './types';

export type Diff = 'added' | 'changed' | 'same';

export interface CompareCell {
  row: number;
  col: number;
  stitch: string;
  colour: string;
  diff: Diff;
}

export interface CompareResult {
  rowsChanged: number;
  rowsAdded: number;
  rowsRemoved: number;
  cellsChanged: number;
  stitchesFrom: number;
  stitchesTo: number;
  summary: string;
  cells: CompareCell[];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function compareCharts(a: Chart, b: Chart, limits: ColourLimits): CompareResult {
  const gridA = makeGrid(a);
  const gridB = makeGrid(b);
  const pairedRows = Math.min(a.height, b.height);
  const widest = Math.max(a.width, b.width);
  let rowsChanged = 0;
  let cellsChanged = 0;

  for (let row = 1; row <= pairedRows; row += 1) {
    let changed = false;
    for (let col = 1; col <= widest; col += 1) {
      if (col > a.width || col > b.width) {
        changed = true;
        cellsChanged += 1;
        continue;
      }
      const cellA = gridA(row, col);
      const cellB = gridB(row, col);
      if (cellA.stitch !== cellB.stitch || cellA.colour !== cellB.colour) {
        changed = true;
        cellsChanged += 1;
      }
    }
    if (changed) rowsChanged += 1;
  }

  const rowsAdded = Math.max(0, b.height - a.height);
  const rowsRemoved = Math.max(0, a.height - b.height);
  const stitchesFrom = topRowStitches(analyseChart(a, limits));
  const stitchesTo = topRowStitches(analyseChart(b, limits));

  const cells: CompareCell[] = [];
  for (let row = 1; row <= b.height; row += 1) {
    for (let col = 1; col <= b.width; col += 1) {
      const cellB = gridB(row, col);
      let diff: Diff;
      if (row > a.height || col > a.width) {
        diff = 'added';
      } else {
        const cellA = gridA(row, col);
        diff = cellA.stitch !== cellB.stitch || cellA.colour !== cellB.colour ? 'changed' : 'same';
      }
      cells.push({
        row,
        col,
        stitch: cellB.stitch ?? NO_STITCH,
        colour: cellB.colour,
        diff,
      });
    }
  }

  const summary =
    `${plural(rowsChanged, 'row changed', 'rows changed')}, ` +
    `${plural(rowsAdded, 'row added', 'rows added')}, ` +
    `${plural(rowsRemoved, 'row removed', 'rows removed')}, ` +
    `${plural(cellsChanged, 'cell changed', 'cells changed')}. ` +
    `Stitches ${stitchesFrom} to ${stitchesTo}.`;

  return {
    rowsChanged,
    rowsAdded,
    rowsRemoved,
    cellsChanged,
    stitchesFrom,
    stitchesTo,
    summary,
    cells,
  };
}
