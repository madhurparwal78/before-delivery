import { boxesOnRow, makeGrid, readsRightToLeft, rowSide } from './chart';
import {
  CABLE,
  CABLE_CELLS,
  CABLE_TEXT,
  NO_STITCH,
  type StitchSymbol,
  textsForOtherSide,
  textsForOtherTerms,
  textsForSide,
} from './symbols';
import type { Chart } from './types';

export interface RowCellValue {
  col: number;
  stitch: string;
  colour: string;
}

export interface TextOk {
  ok: true;
  cells: RowCellValue[];
}

export interface TextFail {
  ok: false;
  message: string;
  position: number | null;
}

export type TextResult = TextOk | TextFail;

class ParseFail {
  constructor(
    readonly text: string,
    readonly position: number | null,
  ) {}
}

interface ParsedItem {
  symbol: StitchSymbol;
  count: number;
  colour: string | null;
}

const DELIMITERS = new Set([' ', ',', ';', '.']);
const LABEL = /^(?:Row|Rnd) (\d+)(?: \((?:RS|WS)\))?: /;

function cellsPer(symbol: StitchSymbol): number {
  return symbol.key === CABLE ? CABLE_CELLS : 1;
}

function usesPer(symbol: StitchSymbol): number {
  return symbol.key === CABLE ? CABLE_CELLS : symbol.uses;
}

function makesPer(symbol: StitchSymbol): number {
  return symbol.key === CABLE ? CABLE_CELLS : symbol.makes;
}

function itemUses(item: ParsedItem): number {
  return item.count * usesPer(item.symbol);
}

/** The message shown when a row cannot be edited as text because a repeat box crosses it. */
export function repeatBoxTextError(chart: Chart, row: number): string | null {
  const boxes = boxesOnRow(chart, row);
  if (boxes.length === 0) return null;
  return `Row ${row}: expand repeat ${boxes[0].id} before editing this row as text.`;
}

export function parseAndApplyRowText(
  chart: Chart,
  row: number,
  text: string,
  needed: number,
): TextResult {
  const boxError = repeatBoxTextError(chart, row);
  if (boxError) return { ok: false, message: boxError, position: null };

  const side = rowSide(chart, row);
  const valid = textsForSide(chart.craft, chart.terms, side);
  const otherSide = textsForOtherSide(chart.craft, side);
  const otherTerms = textsForOtherTerms(chart.craft, chart.terms);
  const colours = new Set(chart.colours.map((colour) => colour.letter));
  let index = 0;

  const fail = (position: number | null, message: string): never => {
    throw new ParseFail(message, position);
  };
  const at = (offset = 0): string => text[index + offset] ?? '';

  const readWord = (): string => {
    let end = index;
    while (end < text.length && !DELIMITERS.has(text[end])) end += 1;
    return text.slice(index, end);
  };

  const parseItem = (): ParsedItem => {
    const start = index;
    let symbol: StitchSymbol;
    let count = 1;
    if (chart.craft === 'knit' && text.startsWith(CABLE_TEXT, index)) {
      symbol = valid.get(CABLE_TEXT)!.symbol;
      index += CABLE_TEXT.length;
    } else {
      const word = readWord();
      const split = /^(.+?)(\d+)$/.exec(word);
      const plain = valid.get(word);
      const counted = split ? valid.get(split[1]) : undefined;
      if (plain && !plain.symbol.counted) {
        symbol = plain.symbol;
        index += word.length;
      } else if (split && counted && counted.symbol.counted && Number(split[2]) >= 1) {
        symbol = counted.symbol;
        count = Number(split[2]);
        index += word.length;
      } else if (otherTerms.has(word) || (split && otherTerms.has(split[1]))) {
        const base = otherTerms.has(word) ? word : split![1];
        const termsName = chart.terms === 'uk' ? 'UK' : 'US';
        return fail(start + 1, `${base} is not valid in ${termsName} terms.`);
      } else if (otherSide.has(word)) {
        const sideName = side === 'WS' ? 'wrong-side' : 'right-side';
        return fail(start + 1, `${word} is not valid on a ${sideName} row.`);
      } else {
        return fail(start + 1, `unknown stitch "${word}".`);
      }
    }

    if (!symbol.counted && text.startsWith(' x', index)) {
      const digits = /^\d+/.exec(text.slice(index + 2));
      if (digits) {
        count = Number(digits[0]);
        index += 2 + digits[0].length;
      }
    }

    let colour: string | null = null;
    if (text.startsWith(' in ', index)) {
      index += 4;
      const letterStart = index;
      const letter = readWord();
      index += letter.length;
      if (letter.length !== 1 || !colours.has(letter)) {
        return fail(letterStart + 1, `colour ${letter} is not in the key.`);
      }
      colour = letter;
    }
    return { symbol, count, colour };
  };

  const separatorFail = (): never => fail(index + 1, 'expected a comma or a full stop.');

  /** Reads items up to one of the closing marks, and returns the mark it stopped on. */
  const parseItems = (stops: string[]): { items: ParsedItem[]; stop: string } => {
    const items: ParsedItem[] = [];
    for (;;) {
      items.push(parseItem());
      if (text.startsWith(', ', index)) {
        index += 2;
        continue;
      }
      const stop = stops.find((mark) => text.startsWith(mark, index));
      if (stop === undefined) return separatorFail();
      index += stop.length;
      return { items, stop };
    }
  };

  const expect = (literal: string): void => {
    if (!text.startsWith(literal, index)) separatorFail();
    index += literal.length;
  };

  interface ParsedRepeat {
    starPosition: number;
    unit: ParsedItem[];
    tail: ParsedItem[];
    named: number;
  }

  const parseRepeat = (): ParsedRepeat => {
    const starPosition = index + 1;
    index += 1;
    const { items: unit } = parseItems([';']);
    expect(' rep from * to ');
    if (text.startsWith('end', index)) {
      index += 3;
      if (text.startsWith(', ', index)) {
        index += 2;
        const { items: tail } = parseItems(['.']);
        return { starPosition, unit, tail, named: 0 };
      }
      expect('.');
      return { starPosition, unit, tail: [], named: 0 };
    }
    if (text.startsWith('last ', index)) {
      index += 5;
      let named: number;
      if (text.startsWith('st, ', index)) {
        named = 1;
        index += 4;
      } else {
        const sized = /^(\d+) sts?, /.exec(text.slice(index));
        if (!sized) return separatorFail();
        named = Number(sized[1]);
        index += sized[0].length;
      }
      const { items: tail } = parseItems(['.']);
      return { starPosition, unit, tail, named };
    }
    return separatorFail();
  };

  try {
    const label = LABEL.exec(text);
    if (label) {
      if (Number(label[1]) !== row) fail(1, `the label says Row ${Number(label[1])}.`);
      index = label[0].length;
    }

    const before: ParsedItem[] = [];
    let repeat: ParsedRepeat | null = null;
    for (;;) {
      if (at() === '*') {
        repeat = parseRepeat();
        break;
      }
      const item = parseItem();
      before.push(item);
      if (text.startsWith(', ', index)) {
        index += 2;
        continue;
      }
      if (at() === '.') {
        index += 1;
        break;
      }
      separatorFail();
    }

    let declared: number | null = null;
    let declaredPosition = 0;
    if (index < text.length) {
      const closing = /^ \((\d+) sts?\)$/.exec(text.slice(index));
      if (!closing) separatorFail();
      declared = Number(closing![1]);
      declaredPosition = index + 2;
      index = text.length;
    }

    let worked: ParsedItem[] = before;
    if (repeat) {
      const usedBefore = before.reduce((sum, item) => sum + itemUses(item), 0);
      const unitUses = repeat.unit.reduce((sum, item) => sum + itemUses(item), 0);
      const tailUses = repeat.tail.reduce((sum, item) => sum + itemUses(item), 0);
      const rest = needed - usedBefore - tailUses;
      const times = unitUses > 0 ? rest / unitUses : 0;
      if (
        repeat.named !== tailUses ||
        unitUses <= 0 ||
        !Number.isInteger(times) ||
        times < 1
      ) {
        fail(repeat.starPosition, `the repeat does not fit ${needed} stitches.`);
      }
      worked = [...before];
      for (let time = 0; time < times; time += 1) worked.push(...repeat.unit);
      worked.push(...repeat.tail);
    }

    const cellCount = worked.reduce((sum, item) => sum + item.count * cellsPer(item.symbol), 0);
    if (cellCount > chart.width) {
      fail(1, `the text needs ${cellCount} cells, the chart is ${chart.width} wide.`);
    }
    const made = worked.reduce((sum, item) => sum + item.count * makesPer(item.symbol), 0);
    if (declared !== null && declared !== made) {
      fail(
        declaredPosition,
        `the closing count says ${declared} ${declared === 1 ? 'st' : 'sts'}, the row makes ${made}.`,
      );
    }

    return { ok: true, cells: layRowCells(chart, row, worked, cellCount) };
  } catch (error) {
    if (error instanceof ParseFail) {
      const prefix = error.position === null ? `Row ${row}: ` : `Row ${row}, position ${error.position}: `;
      return { ok: false, message: prefix + error.text, position: error.position };
    }
    throw error;
  }
}

/** Puts the worked items into the row's cells in reading order. */
function layRowCells(chart: Chart, row: number, worked: ParsedItem[], cellCount: number): RowCellValue[] {
  const grid = makeGrid(chart);
  const rightToLeft = readsRightToLeft(rowSide(chart, row));
  const columns: number[] = [];
  for (let col = 1; col <= chart.width; col += 1) columns.push(col);
  if (rightToLeft) columns.reverse();

  let start = columns.findIndex((col) => grid(row, col).stitch !== NO_STITCH);
  if (start < 0) start = 0;
  if (start + cellCount > chart.width) start = chart.width - cellCount;

  const laid = new Map<number, RowCellValue>();
  let position = start;
  for (const item of worked) {
    for (let time = 0; time < item.count; time += 1) {
      for (let cell = 0; cell < cellsPer(item.symbol); cell += 1) {
        const col = columns[position];
        position += 1;
        laid.set(col, {
          col,
          stitch: item.symbol.key,
          colour: item.colour ?? grid(row, col).colour,
        });
      }
    }
  }

  return columns.map((col) => {
    const value = laid.get(col);
    if (value) return value;
    return { col, stitch: NO_STITCH, colour: grid(row, col).colour };
  });
}
