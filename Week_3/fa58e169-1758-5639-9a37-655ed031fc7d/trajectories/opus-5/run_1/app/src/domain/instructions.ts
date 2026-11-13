import { rowIsMultiColour, uniqueCells } from './chart';
import type { CellRef, LineToken, RowItem, Side } from './types';

interface WrittenLine {
  text: string;
  tokens: LineToken[];
}

interface Run {
  text: string;
  cells: CellRef[];
}

interface Piece {
  literal?: string;
  token?: LineToken;
}

function rowLabel(side: Side, row: number): string {
  if (side === 'RND') return `Rnd ${row}:`;
  return `Row ${row} (${side}):`;
}

function closingCount(made: number): string {
  return made === 1 ? ' (1 st)' : ` (${made} sts)`;
}

function itemsEqual(a: RowItem, b: RowItem, multiColour: boolean): boolean {
  if (a.text !== b.text) return false;
  if (multiColour && a.colour !== b.colour) return false;
  return true;
}

function runText(item: RowItem, count: number, multiColour: boolean): string {
  let text: string;
  if (item.counted) text = `${item.text}${count}`;
  else text = count > 1 ? `${item.text} x${count}` : item.text;
  if (multiColour) text += ` in ${item.colour}`;
  return text;
}

/** Runs of a stretch of items, each run's cells gathered from every worked repetition. */
function runsOf(
  items: RowItem[],
  multiColour: boolean,
  cellsFor: (from: number, to: number) => CellRef[],
): Run[] {
  const runs: Run[] = [];
  let start = 0;
  while (start < items.length) {
    let end = start;
    while (end + 1 < items.length && itemsEqual(items[end + 1], items[start], multiColour)) end += 1;
    runs.push({
      text: runText(items[start], end - start + 1, multiColour),
      cells: uniqueCells(cellsFor(start, end)),
    });
    start = end + 1;
  }
  return runs;
}

function straightCells(items: RowItem[]) {
  return (from: number, to: number): CellRef[] => {
    const cells: CellRef[] = [];
    for (let index = from; index <= to; index += 1) cells.push(...items[index].cells);
    return cells;
  };
}

interface DetectedRepeat {
  start: number;
  period: number;
  times: number;
}

/** The first repeat in the item list, by the published search order. */
function detectRepeat(items: RowItem[], multiColour: boolean): DetectedRepeat | null {
  const total = items.length;
  const maxPeriod = Math.floor(total / 2);
  for (let period = 2; period <= maxPeriod; period += 1) {
    for (let start = 0; start + 2 * period <= total; start += 1) {
      const unit = items.slice(start, start + period);
      if (unit.every((item) => itemsEqual(item, unit[0], multiColour))) continue;
      const repeats = (times: number): boolean => {
        const base = start + times * period;
        if (base + period > total) return false;
        for (let index = 0; index < period; index += 1) {
          if (!itemsEqual(items[base + index], unit[index], multiColour)) return false;
        }
        return true;
      };
      if (!repeats(1)) continue;
      let times = 2;
      while (repeats(times)) times += 1;
      return { start, period, times };
    }
  }
  return null;
}

function joinRuns(runs: Run[]): Piece[] {
  const pieces: Piece[] = [];
  runs.forEach((run, index) => {
    if (index > 0) pieces.push({ literal: ', ' });
    pieces.push({ token: { text: run.text, cells: run.cells } });
  });
  return pieces;
}

export function writeRow(items: RowItem[], side: Side, row: number, made: number): WrittenLine {
  const multiColour = rowIsMultiColour(items);
  const pieces: Piece[] = [{ literal: rowLabel(side, row) }, { literal: ' ' }];
  const repeat = detectRepeat(items, multiColour);

  if (!repeat) {
    pieces.push(...joinRuns(runsOf(items, multiColour, straightCells(items))));
    pieces.push({ literal: '.' });
  } else {
    const { start, period, times } = repeat;
    const prefix = items.slice(0, start);
    const unit = items.slice(start, start + period);
    const tail = items.slice(start + times * period);
    if (prefix.length > 0) {
      pieces.push(...joinRuns(runsOf(prefix, multiColour, straightCells(prefix))));
      pieces.push({ literal: ', ' });
    }
    pieces.push({ literal: '*' });
    pieces.push(
      ...joinRuns(
        runsOf(unit, multiColour, (from, to) => {
          const cells: CellRef[] = [];
          for (let time = 0; time < times; time += 1) {
            for (let index = from; index <= to; index += 1) {
              cells.push(...items[start + time * period + index].cells);
            }
          }
          return cells;
        }),
      ),
    );
    pieces.push({ literal: '; rep from * to ' });
    const tailUses = tail.reduce((sum, item) => sum + item.uses, 0);
    if (tail.length === 0) {
      pieces.push({ literal: 'end.' });
    } else {
      if (tailUses === 0) pieces.push({ literal: 'end, ' });
      else if (tailUses === 1) pieces.push({ literal: 'last st, ' });
      else pieces.push({ literal: `last ${tailUses} sts, ` });
      pieces.push(...joinRuns(runsOf(tail, multiColour, straightCells(tail))));
      pieces.push({ literal: '.' });
    }
  }
  pieces.push({ literal: closingCount(made) });

  let text = '';
  const tokens: LineToken[] = [];
  for (const piece of pieces) {
    if (piece.literal !== undefined) text += piece.literal;
    if (piece.token) {
      text += piece.token.text;
      tokens.push(piece.token);
    }
  }
  return { text, tokens };
}
