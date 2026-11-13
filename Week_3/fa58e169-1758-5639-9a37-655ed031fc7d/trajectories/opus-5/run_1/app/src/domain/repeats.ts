import { makeGrid } from './chart';
import { NO_STITCH } from './symbols';
import type { Chart, RepeatBox } from './types';

export interface PlainCell {
  row: number;
  col: number;
  stitch: string;
  colour: string;
  repeat: string | null;
}

export interface ReshapedChart {
  width: number;
  cells: PlainCell[];
  repeats: RepeatBox[];
  added: number;
}

export function nextRepeatId(existing: RepeatBox[]): string {
  const taken = new Set(existing.map((box) => box.id));
  for (let code = 0; code < 26; code += 1) {
    const id = String.fromCharCode(65 + code);
    if (!taken.has(id)) return id;
  }
  return 'A';
}

export function boxesOverlap(a: RepeatBox, b: Omit<RepeatBox, 'id' | 'times'>): boolean {
  return a.fromRow <= b.toRow && a.toRow >= b.fromRow && a.fromCol <= b.toCol && a.toCol >= b.fromCol;
}

function boxWidth(box: Pick<RepeatBox, 'fromCol' | 'toCol'>): number {
  return box.toCol - box.fromCol + 1;
}

export function expandedWidth(chart: Pick<Chart, 'width'>, box: RepeatBox): number {
  return chart.width + (box.times - 1) * boxWidth(box);
}

/** The chart with a repeat box's columns written out in place, the box gone. */
export function expandBox(chart: Chart, box: RepeatBox): ReshapedChart {
  const grid = makeGrid(chart);
  const unit = boxWidth(box);
  const added = (box.times - 1) * unit;
  const width = chart.width + added;
  const cells: PlainCell[] = [];

  for (let row = 1; row <= chart.height; row += 1) {
    const inBox = row >= box.fromRow && row <= box.toRow;
    for (let col = 1; col < box.fromCol; col += 1) {
      const cell = grid(row, col);
      cells.push({ row, col, stitch: cell.stitch, colour: cell.colour, repeat: cell.repeat });
    }
    for (let time = 0; time < box.times; time += 1) {
      for (let inner = box.fromCol; inner <= box.toCol; inner += 1) {
        const col = box.fromCol + time * unit + (inner - box.fromCol);
        if (inBox) {
          const cell = grid(row, inner);
          cells.push({ row, col, stitch: cell.stitch, colour: cell.colour, repeat: null });
        } else if (time === 0) {
          const cell = grid(row, inner);
          cells.push({ row, col, stitch: cell.stitch, colour: cell.colour, repeat: cell.repeat });
        } else {
          cells.push({ row, col, stitch: NO_STITCH, colour: 'A', repeat: null });
        }
      }
    }
    for (let col = box.toCol + 1; col <= chart.width; col += 1) {
      const cell = grid(row, col);
      cells.push({ row, col: col + added, stitch: cell.stitch, colour: cell.colour, repeat: cell.repeat });
    }
  }

  const repeats = chart.repeats
    .filter((other) => other.id !== box.id)
    .map((other) =>
      other.fromCol > box.toCol
        ? { ...other, fromCol: other.fromCol + added, toCol: other.toCol + added }
        : other,
    );

  return { width, cells, repeats, added };
}

/** The chart with an expansion's added columns taken away and its box restored. */
export function undoExpandBox(chart: Chart, box: RepeatBox): ReshapedChart {
  const grid = makeGrid(chart);
  const unit = boxWidth(box);
  const added = (box.times - 1) * unit;
  const width = chart.width - added;
  const cells: PlainCell[] = [];

  for (let row = 1; row <= chart.height; row += 1) {
    const inBox = row >= box.fromRow && row <= box.toRow;
    for (let col = 1; col <= width; col += 1) {
      const source = col <= box.toCol ? col : col + added;
      const cell = grid(row, source);
      const insideBox = inBox && col >= box.fromCol && col <= box.toCol;
      cells.push({
        row,
        col,
        stitch: cell.stitch,
        colour: cell.colour,
        repeat: insideBox ? box.id : cell.repeat,
      });
    }
  }

  const repeats = [
    ...chart.repeats.map((other) =>
      other.fromCol > box.toCol + added
        ? { ...other, fromCol: other.fromCol - added, toCol: other.toCol - added }
        : other,
    ),
    box,
  ].sort((a, b) => a.id.localeCompare(b.id));

  return { width, cells, repeats, added };
}
