import { makeGrid, rowItems, rowSide } from './chart';
import { writeRow } from './instructions';
import { CABLE, CABLE_TEXT } from './symbols';
import type { Chart, ChartAnalysis, ColourLimits, ColourWarning, RowAnalysis, RowItem } from './types';

function countError(row: number, needed: number, used: number): string {
  return `Row ${row} needs ${needed} stitches, found ${used}.`;
}

const CABLE_CELLS_ERROR = (row: number): string => `Row ${row}: a 2/2 cable needs 4 cells.`;
const CABLE_SIDE_ERROR = (row: number): string =>
  `Row ${row}: ${CABLE_TEXT} can only be worked on a right-side row.`;

export function analyseChart(chart: Chart, limits: ColourLimits): ChartAnalysis {
  const grid = makeGrid(chart);
  const rows: RowAnalysis[] = [];
  const colourWarnings: ColourWarning[] = [];
  let needed = chart.castOn;

  for (let row = 1; row <= chart.height; row += 1) {
    const side = rowSide(chart, row);
    const { items, brokenCable, hasCable, empty } = rowItems(chart, row, grid);
    if (empty) {
      rows.push({
        row,
        side,
        used: 0,
        made: 0,
        needed,
        state: 'empty',
        errors: [],
        text: '',
        tokens: [],
        items: [],
      });
      continue;
    }
    const used = items.reduce((sum, item) => sum + item.uses, 0);
    const made = items.reduce((sum, item) => sum + item.makes, 0);
    const errors: string[] = [];
    if (used !== needed) errors.push(countError(row, needed, used));
    if (brokenCable) errors.push(CABLE_CELLS_ERROR(row));
    if (hasCable && side === 'WS') errors.push(CABLE_SIDE_ERROR(row));
    const line = writeRow(items, side, row, made);
    rows.push({
      row,
      side,
      used,
      made,
      needed,
      state: errors.length > 0 ? 'error' : 'ok',
      errors,
      text: line.text,
      tokens: line.tokens,
      items,
    });
    colourWarnings.push(...rowColourWarnings(row, items, limits));
    needed = made;
  }

  return { rows, colourWarnings };
}

function rowColourWarnings(row: number, items: RowItem[], limits: ColourLimits): ColourWarning[] {
  const warnings: ColourWarning[] = [];
  const letters = [...new Set(items.map((item) => item.colour))].sort();
  if (letters.length > limits.coloursPerRow) {
    warnings.push({
      row,
      message: `Row ${row} uses ${letters.length} colours, the limit is ${limits.coloursPerRow}.`,
    });
  }
  for (const letter of letters) {
    const longest = longestFloat(items, letter);
    if (longest > limits.maxFloat) {
      warnings.push({ row, message: `Row ${row}: float of ${longest} stitches in colour ${letter}.` });
    }
  }
  return warnings;
}

function itemWeight(item: RowItem): number {
  return item.stitch === CABLE ? item.cells.length : 1;
}

/** The longest run of other colours between two cells of this colour. */
function longestFloat(items: RowItem[], letter: string): number {
  let longest = 0;
  let open = false;
  let span = 0;
  for (const item of items) {
    if (item.colour === letter) {
      if (open && span > longest) longest = span;
      open = true;
      span = 0;
    } else if (open) {
      span += itemWeight(item);
    }
  }
  return longest;
}

export function rowErrorCount(analysis: ChartAnalysis): number {
  return analysis.rows.reduce((sum, row) => sum + row.errors.length, 0);
}

/** What the top non-empty row makes, as shown for a version's stitches. */
export function topRowStitches(analysis: ChartAnalysis): number {
  for (let index = analysis.rows.length - 1; index >= 0; index -= 1) {
    const row = analysis.rows[index];
    if (row.state !== 'empty') return row.made;
  }
  return 0;
}
