import { rectangleOf, sortAreas } from '../../shared/grid.js';
import {
  AREAS_NEED_QUOTED_ROWS,
  BREAKPOINT_FORMAT_MESSAGE,
  GAP_MESSAGE,
  LAYOUT_NEEDS_GRID,
  MISSING_BRACE,
  ONLY_LAYOUT_AND_AREA_RULES,
  areaNotPlaced,
  areaNotRectangle,
  cellsNeeded,
  rowsNeeded,
  unknownProperty,
} from '../../shared/messages.js';
import { checkAreaName, checkBreakpointAdd, checkBreakpointWidth, checkGap, checkTrackCount } from '../../shared/rules.js';
import { parseSize } from '../../shared/sizes.js';
import type { Area, Gap, LayoutState } from '../../shared/types.js';
import type { Limits } from '../config.js';
import { Refusal } from './refusal.js';

interface Declaration {
  property: string;
  value: string;
  line: number;
  /** The line the value starts on (it may start below the property). */
  valueLine: number;
}

interface Rule {
  selector: string;
  line: number;
  declarations: Declaration[];
}

interface MediaBlock {
  prelude: string;
  line: number;
  rules: Rule[];
}

interface CssError {
  line: number;
  message: string;
}

/** The text with every comment replaced by spaces, so offsets and line numbers stay the same. */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?(\*\/|$)/g, (comment) => comment.replace(/[^\n]/g, ' '));

class Reader {
  readonly errors: CssError[] = [];
  readonly rules: Rule[] = [];
  readonly blocks: MediaBlock[] = [];
  private position = 0;
  private readonly lineStarts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') this.lineStarts.push(i + 1);
  }

  fail(line: number, message: string): void {
    this.errors.push({ line, message });
  }

  private lineAt(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  }

  private get lastLine(): number {
    return this.lineAt(Math.max(0, this.text.trimEnd().length - 1));
  }

  private skipSpace(): void {
    while (this.position < this.text.length && /\s/.test(this.text[this.position])) this.position++;
  }

  read(): void {
    for (;;) {
      this.skipSpace();
      if (this.position >= this.text.length) return;
      const start = this.position;
      const line = this.lineAt(start);
      const stop = this.text.slice(start).search(/[{};]/);
      if (stop < 0 || this.text[start + stop] !== '{') {
        this.fail(line, ONLY_LAYOUT_AND_AREA_RULES);
        return;
      }
      const prelude = this.text.slice(start, start + stop).trim();
      this.position = start + stop + 1;
      if (prelude.startsWith('@')) {
        if (!this.readMedia(prelude, line)) return;
      } else if (!this.readRule(prelude, line, this.rules)) return;
    }
  }

  private readMedia(prelude: string, line: number): boolean {
    if (!/^@media\b/i.test(prelude)) {
      this.fail(line, ONLY_LAYOUT_AND_AREA_RULES);
      return false;
    }
    const block: MediaBlock = { prelude, line, rules: [] };
    this.blocks.push(block);
    for (;;) {
      this.skipSpace();
      if (this.position >= this.text.length) {
        this.fail(this.lastLine, MISSING_BRACE);
        return false;
      }
      if (this.text[this.position] === '}') {
        this.position++;
        return true;
      }
      const start = this.position;
      const stop = this.text.slice(start).search(/[{};]/);
      if (stop < 0 || this.text[start + stop] !== '{') {
        this.fail(this.lineAt(start), ONLY_LAYOUT_AND_AREA_RULES);
        return false;
      }
      const selector = this.text.slice(start, start + stop).trim();
      this.position = start + stop + 1;
      if (selector.startsWith('@')) {
        this.fail(this.lineAt(start), ONLY_LAYOUT_AND_AREA_RULES);
        return false;
      }
      if (!this.readRule(selector, this.lineAt(start), block.rules)) return false;
    }
  }

  private readRule(selector: string, line: number, into: Rule[]): boolean {
    const rule: Rule = { selector, line, declarations: [] };
    into.push(rule);
    for (;;) {
      this.skipSpace();
      if (this.position >= this.text.length) {
        this.fail(this.lastLine, MISSING_BRACE);
        return false;
      }
      if (this.text[this.position] === '}') {
        this.position++;
        return true;
      }
      const start = this.position;
      const declarationLine = this.lineAt(start);
      let quote = '';
      let depth = 0;
      let end = start;
      for (; end < this.text.length; end++) {
        const character = this.text[end];
        if (quote) {
          if (character === quote) quote = '';
        } else if (character === '"' || character === "'") quote = character;
        else if (character === '(') depth++;
        else if (character === ')') depth--;
        else if (character === '{') {
          this.fail(declarationLine, ONLY_LAYOUT_AND_AREA_RULES);
          return false;
        } else if ((character === ';' || character === '}') && depth <= 0) break;
      }
      const raw = this.text.slice(start, end);
      const colon = raw.indexOf(':');
      if (colon < 0) this.fail(declarationLine, unknownProperty(raw.trim()));
      else {
        const afterColon = raw.slice(colon + 1);
        const valueStart = start + colon + 1 + (afterColon.length - afterColon.trimStart().length);
        rule.declarations.push({ property: raw.slice(0, colon).trim().toLowerCase(), value: afterColon.trim(), line: declarationLine, valueLine: this.lineAt(valueStart) });
      }
      this.position = this.text[end] === ';' ? end + 1 : end;
    }
  }
}

/** Whitespace-separated tokens, keeping `minmax( … , … )` whole. */
function tokens(value: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth++;
    if (character === ')') depth--;
    if (/\s/.test(character) && depth === 0) {
      if (current) found.push(current);
      current = '';
    } else current += character;
  }
  if (current) found.push(current);
  return found;
}

interface Declared {
  columns: string[] | null;
  rows: string[] | null;
  gap: Partial<Gap> | null;
  areaRows: { cells: string[]; line: number }[] | null;
  areasLine: number;
  displayGrid: boolean;
}

const blankDeclared = (): Declared => ({ columns: null, rows: null, gap: null, areaRows: null, areasLine: 0, displayGrid: false });

/** A gap value in pixels; NaN when it is not `0` or `<n>px`. */
function pixelGap(value: string): number {
  const match = /^(\d+)px$/.exec(value);
  return value === '0' ? 0 : match ? Number(match[1]) : Number.NaN;
}

/** The quoted rows of a `grid-template-areas` value, each with the line it sits on; null when the value is not quoted rows. */
function areaRowsOf(value: string, valueLine: number): { cells: string[]; line: number }[] | null {
  if (value === 'none') return [];
  const rows: { cells: string[]; line: number }[] = [];
  const pattern = /"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  let lastEnd = 0;
  while ((match = pattern.exec(value))) {
    if (value.slice(lastEnd, match.index).trim()) return null;
    const line = valueLine + (value.slice(0, match.index).match(/\n/g) ?? []).length;
    rows.push({ cells: (match[1] ?? match[2]).trim().split(/\s+/).map((cell) => (/^\.+$/.test(cell) ? '.' : cell)), line });
    lastEnd = match.index + match[0].length;
  }
  return value.slice(lastEnd).trim() || rows.length === 0 ? null : rows;
}

function readLayoutRule(rule: Rule, into: Declared, reader: Reader, limits: Limits): void {
  for (const { property, value, line, valueLine } of rule.declarations) {
    switch (property) {
      case 'display':
        into.displayGrid = value === 'grid';
        break;
      case 'grid-template-columns':
      case 'grid-template-rows': {
        const axis = property === 'grid-template-columns' ? 'column' : 'row';
        const sizes: string[] = [];
        let refused = false;
        for (const token of tokens(value)) {
          const parsed = parseSize(token);
          if (!parsed.ok) {
            reader.fail(line, parsed.message);
            refused = true;
            break;
          }
          sizes.push(parsed.size);
        }
        if (refused) break;
        const refusal = checkTrackCount(axis, sizes.length, limits.maxTracks);
        if (refusal) reader.fail(line, refusal);
        else if (axis === 'column') into.columns = sizes;
        else into.rows = sizes;
        break;
      }
      case 'grid-template-areas': {
        into.areasLine = line;
        const rows = areaRowsOf(value, valueLine);
        if (rows) into.areaRows = rows;
        else reader.fail(line, AREAS_NEED_QUOTED_ROWS);
        break;
      }
      case 'gap':
      case 'row-gap':
      case 'column-gap': {
        const parts = tokens(value).map(pixelGap);
        const valid = property === 'gap' ? parts.length >= 1 && parts.length <= 2 : parts.length === 1;
        const message = valid ? parts.map(checkGap).find(Boolean) : GAP_MESSAGE;
        if (message) {
          reader.fail(line, message);
          break;
        }
        const gap = into.gap ?? {};
        if (property === 'gap') {
          gap.row = parts[0];
          gap.column = parts[parts.length - 1];
        } else gap[property === 'row-gap' ? 'row' : 'column'] = parts[0];
        into.gap = gap;
        break;
      }
      default:
        reader.fail(line, unknownProperty(property));
    }
  }
}

/** Place the rows of `grid-template-areas` into rectangles, reporting each problem on its row's line. */
function areasFromRows(rows: { cells: string[]; line: number }[], columnCount: number, rowCount: number, areasLine: number, reader: Reader): Area[] {
  if (rows.length === 0) return [];
  const wrong = rows.find((row) => row.cells.length !== columnCount);
  if (wrong) {
    reader.fail(wrong.line, cellsNeeded(columnCount));
    return [];
  }
  if (rows.length !== rowCount) {
    reader.fail(areasLine, rowsNeeded(rowCount));
    return [];
  }
  const placed = new Map<string, { cells: Set<string>; line: number }>();
  rows.forEach((row, rowIndex) =>
    row.cells.forEach((name, columnIndex) => {
      if (name === '.') return;
      const message = checkAreaName(name);
      if (message) {
        reader.fail(row.line, message);
        return;
      }
      const area = placed.get(name) ?? { cells: new Set<string>(), line: row.line };
      area.cells.add(`${rowIndex + 1}:${columnIndex + 1}`);
      placed.set(name, area);
    }),
  );
  const areas: Area[] = [];
  for (const [name, { cells, line }] of placed) {
    const rect = rectangleOf(cells);
    if (rect) areas.push({ name, ...rect });
    else reader.fail(line, areaNotRectangle(name));
  }
  return sortAreas(areas);
}

/**
 * Read CSS into a layout state. Throws a `Refusal` with `Line <n>: <message>` for the first error by line.
 * The CSS describes the whole layout: what it does not mention is removed.
 */
export function readCss(css: string, limits: Limits): LayoutState {
  const reader = new Reader(withoutComments(css));
  reader.read();

  const baseRules = reader.rules.filter((rule) => rule.selector === '.layout');
  const base = blankDeclared();
  for (const rule of baseRules) readLayoutRule(rule, base, reader, limits);
  if (!base.displayGrid) reader.fail(baseRules[0]?.line ?? 1, LAYOUT_NEEDS_GRID);

  const placedNames = new Set<string>();
  const declaredAreas: { name: string; line: number }[] = [];
  const collectAreaRules = (rules: Rule[]): void => {
    for (const rule of rules) {
      if (rule.selector === '.layout') continue;
      const name = /^\.([A-Za-z0-9_-]+)$/.exec(rule.selector)?.[1];
      if (!name) {
        reader.fail(rule.line, ONLY_LAYOUT_AND_AREA_RULES);
        continue;
      }
      for (const { property, value, line } of rule.declarations) {
        if (property === 'grid-area') {
          if (value === name) declaredAreas.push({ name, line: rule.line });
          else reader.fail(line, ONLY_LAYOUT_AND_AREA_RULES);
        } else if (property !== 'display' || !/^(none|block)$/.test(value)) reader.fail(line, unknownProperty(property));
      }
      const message = checkAreaName(name);
      if (message) reader.fail(rule.line, message);
    }
  };
  collectAreaRules(reader.rules);

  const columns = base.columns ?? Array.from({ length: base.areaRows?.[0]?.cells.length || 1 }, () => '1fr');
  const rows = base.rows ?? Array.from({ length: base.areaRows?.length || 1 }, () => '1fr');
  const areas = base.areaRows ? areasFromRows(base.areaRows, columns.length, rows.length, base.areasLine, reader) : [];
  const state: LayoutState = {
    columns,
    rows,
    gap: { row: base.gap?.row ?? 0, column: base.gap?.column ?? 0 },
    areas,
    breakpoints: [],
  };
  areas.forEach((area) => placedNames.add(area.name));

  const accepted: { block: MediaBlock; width: number }[] = [];
  for (const block of reader.blocks) {
    const width = /^@media\s*\(\s*min-width\s*:\s*(\d+)px\s*\)$/i.exec(block.prelude)?.[1];
    if (width === undefined) {
      reader.fail(block.line, BREAKPOINT_FORMAT_MESSAGE);
      continue;
    }
    const minWidth = Number(width);
    const message = checkBreakpointWidth(minWidth) ?? checkBreakpointAdd(accepted.map((entry) => entry.width), minWidth, limits.maxBreakpoints);
    if (message) reader.fail(block.line, message);
    else {
      accepted.push({ block, width: minWidth });
      collectAreaRules(block.rules);
    }
  }
  accepted.sort((a, b) => a.width - b.width);

  let below: { columns: string[]; rows: string[]; areas: Area[]; gap: Gap } = { columns, rows, areas, gap: state.gap };
  state.breakpoints = accepted.map(({ block, width }) => {
    const declared = blankDeclared();
    for (const rule of block.rules.filter((candidate) => candidate.selector === '.layout')) readLayoutRule(rule, declared, reader, limits);
    const breakpointColumns = declared.columns ?? [...below.columns];
    const breakpointRows = declared.rows ?? [...below.rows];
    const breakpointAreas = declared.areaRows
      ? areasFromRows(declared.areaRows, breakpointColumns.length, breakpointRows.length, declared.areasLine, reader)
      : fit(below.areas, breakpointColumns.length, breakpointRows.length, block.line, reader);
    const gap = declared.gap ? { row: declared.gap.row ?? below.gap.row, column: declared.gap.column ?? below.gap.column } : null;
    breakpointAreas.forEach((area) => placedNames.add(area.name));
    below = { columns: breakpointColumns, rows: breakpointRows, areas: breakpointAreas, gap: gap ?? below.gap };
    return { min_width: width, columns: breakpointColumns, rows: breakpointRows, areas: breakpointAreas, gap };
  });

  for (const { name, line } of declaredAreas) {
    if (!placedNames.has(name)) reader.fail(line, areaNotPlaced(name));
  }
  if (reader.errors.length) {
    const first = reader.errors.reduce((best, error) => (error.line < best.line ? error : best));
    throw new Refusal(`Line ${first.line}: ${first.message}`);
  }
  return state;
}

/** Areas copied from the next narrower scope must still fit this scope's tracks. */
function fit(areas: Area[], columnCount: number, rowCount: number, line: number, reader: Reader): Area[] {
  if (areas.some((area) => area.column_end > columnCount + 1)) reader.fail(line, cellsNeeded(columnCount));
  else if (areas.some((area) => area.row_end > rowCount + 1)) reader.fail(line, rowsNeeded(rowCount));
  return structuredClone(areas);
}
