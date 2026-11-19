import { checkAreaName } from './area.js';
import { cellsToRect } from './grid.js';
import {
  BREAKPOINT_RANGE_MESSAGE,
  CSS_LENGTH_MESSAGE,
  GAP_MESSAGE,
  duplicateBreakpointMessage,
  maxBreakpointsMessage,
  maxColumnsMessage,
  maxRowsMessage,
} from './messages.js';
import { checkTrackSize, splitTrackList } from './trackSize.js';
import type { Area, Breakpoint, Gap, LayoutState, Limits } from './types.js';

export const CSS_MAX_LENGTH = 20000;

interface Declaration {
  property: string;
  value: string;
  line: number;
  strings: { text: string; line: number }[];
}

interface Rule {
  prelude: string;
  preludeLine: number;
  declarations: Declaration[];
  children: Rule[];
}

const MEDIA_PRELUDE = /^@media\s*\(\s*min-width\s*:\s*(\d+)px\s*\)$/;
const SELECTOR = /^\.([A-Za-z0-9_-]+)$/;

function stripComments(css: string): string {
  let out = '';
  let index = 0;
  while (index < css.length) {
    if (css.startsWith('/*', index)) {
      const end = css.indexOf('*/', index + 2);
      const body = end === -1 ? css.slice(index) : css.slice(index, end + 2);
      out += body.replace(/[^\n]/g, ' ');
      index = end === -1 ? css.length : end + 2;
      continue;
    }
    out += css[index];
    index += 1;
  }
  return out;
}

class Scanner {
  private index = 0;
  private lineNumber = 1;

  constructor(private readonly text: string) {}

  get line(): number {
    return this.lineNumber;
  }

  get done(): boolean {
    return this.index >= this.text.length;
  }

  peek(): string {
    return this.text[this.index] ?? '';
  }

  next(): string {
    const char = this.text[this.index] ?? '';
    this.index += 1;
    if (char === '\n') this.lineNumber += 1;
    return char;
  }

  skipWhitespace(): void {
    while (!this.done && /\s/.test(this.peek())) this.next();
  }
}

interface ParsedSheet {
  rules: Rule[];
  missingBrace: boolean;
}

function parseSheet(css: string): ParsedSheet {
  const scanner = new Scanner(css);
  const state = { missingBrace: false };
  const rules = parseRules(scanner, 0, state);
  return { rules, missingBrace: state.missingBrace };
}

function parseRules(scanner: Scanner, depth: number, state: { missingBrace: boolean }): Rule[] {
  const rules: Rule[] = [];
  for (;;) {
    scanner.skipWhitespace();
    if (scanner.done) {
      if (depth > 0) state.missingBrace = true;
      return rules;
    }
    if (scanner.peek() === '}') {
      scanner.next();
      if (depth > 0) return rules;
      continue;
    }
    const preludeLine = scanner.line;
    let prelude = '';
    while (!scanner.done && scanner.peek() !== '{') prelude += scanner.next();
    if (scanner.done) {
      state.missingBrace = true;
      return rules;
    }
    scanner.next();
    const trimmed = prelude.trim().replace(/\s+/g, ' ');
    if (trimmed.startsWith('@')) {
      rules.push({
        prelude: trimmed,
        preludeLine,
        declarations: [],
        children: parseRules(scanner, depth + 1, state),
      });
    } else {
      rules.push({
        prelude: trimmed,
        preludeLine,
        declarations: parseDeclarations(scanner, state),
        children: [],
      });
    }
  }
}

function parseDeclarations(scanner: Scanner, state: { missingBrace: boolean }): Declaration[] {
  const declarations: Declaration[] = [];
  let buffer = '';
  let startLine = scanner.line;
  let strings: { text: string; line: number }[] = [];
  let started = false;

  const flush = (): void => {
    const text = buffer.trim();
    buffer = '';
    const captured = strings;
    strings = [];
    started = false;
    if (text.length === 0) return;
    const colon = text.indexOf(':');
    const property = colon === -1 ? text : text.slice(0, colon);
    const value = colon === -1 ? '' : text.slice(colon + 1);
    declarations.push({
      property: property.trim().toLowerCase(),
      value: value.trim().replace(/\s+/g, ' '),
      line: startLine,
      strings: captured,
    });
  };

  for (;;) {
    if (scanner.done) {
      state.missingBrace = true;
      flush();
      return declarations;
    }
    const char = scanner.peek();
    if (char === '}') {
      scanner.next();
      flush();
      return declarations;
    }
    if (char === ';') {
      scanner.next();
      flush();
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = scanner.next();
      const quoteLine = scanner.line;
      let text = '';
      while (!scanner.done && scanner.peek() !== quote) text += scanner.next();
      if (!scanner.done) scanner.next();
      strings.push({ text, line: quoteLine });
      buffer += ` "${text}" `;
      if (!started) {
        started = true;
        startLine = quoteLine;
      }
      continue;
    }
    if (!started && !/\s/.test(char)) {
      started = true;
      startLine = scanner.line;
    }
    buffer += scanner.next();
  }
}

const LAYOUT_PROPERTIES = new Set([
  'display',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'gap',
  'row-gap',
  'column-gap',
]);

interface ScopeSpec {
  minWidth: number | null;
  line: number;
  columns: string[] | null;
  rows: string[] | null;
  areaRows: { cells: string[]; line: number }[] | null;
  gap: Gap | null;
}

export type CssParseResult = { ok: true; state: LayoutState } | { ok: false; message: string };

class Problems {
  private readonly entries: { line: number; order: number; message: string }[] = [];

  add(line: number, message: string): void {
    this.entries.push({ line, order: this.entries.length, message });
  }

  get empty(): boolean {
    return this.entries.length === 0;
  }

  first(): string | null {
    if (this.entries.length === 0) return null;
    const sorted = [...this.entries].sort((a, b) => a.line - b.line || a.order - b.order);
    const best = sorted[0] as { line: number; message: string };
    return `Line ${best.line}: ${best.message}`;
  }
}

function parseGapValue(value: string, problems: Problems, line: number): Gap | null {
  const parts = value.split(' ').filter((part) => part.length > 0);
  if (parts.length < 1 || parts.length > 2) {
    problems.add(line, GAP_MESSAGE);
    return null;
  }
  const numbers = parts.map((part) => {
    const match = /^(\d+)px$/.exec(part) ?? /^(0)$/.exec(part);
    return match ? Number(match[1]) : null;
  });
  if (numbers.some((number) => number === null || number > 200)) {
    problems.add(line, GAP_MESSAGE);
    return null;
  }
  const row = numbers[0] as number;
  const column = numbers.length === 2 ? (numbers[1] as number) : row;
  return { row, column };
}

function parseTracks(
  value: string,
  problems: Problems,
  line: number,
  axis: 'columns' | 'rows',
  limits: Limits,
): string[] | null {
  const parts = splitTrackList(value);
  if (parts.length === 0) return null;
  const sizes: string[] = [];
  for (const part of parts) {
    const check = checkTrackSize(part);
    if (!check.ok) {
      problems.add(line, check.message);
      return null;
    }
    sizes.push(check.canonical);
  }
  if (sizes.length > limits.maxTracks) {
    problems.add(line, axis === 'columns' ? maxColumnsMessage(limits.maxTracks) : maxRowsMessage(limits.maxTracks));
    return null;
  }
  return sizes;
}

function readLayoutRule(
  rule: Rule,
  problems: Problems,
  limits: Limits,
  requireDisplayGrid: boolean,
): Omit<ScopeSpec, 'minWidth' | 'line'> {
  const spec: Omit<ScopeSpec, 'minWidth' | 'line'> = {
    columns: null,
    rows: null,
    areaRows: null,
    gap: null,
  };
  let display: string | null = null;
  let rowGap: number | null = null;
  let columnGap: number | null = null;
  let shorthandGap: Gap | null = null;

  for (const declaration of rule.declarations) {
    if (!LAYOUT_PROPERTIES.has(declaration.property)) {
      problems.add(declaration.line, `unknown property ${declaration.property}.`);
      continue;
    }
    switch (declaration.property) {
      case 'display':
        display = declaration.value;
        break;
      case 'grid-template-columns':
        spec.columns = parseTracks(declaration.value, problems, declaration.line, 'columns', limits);
        break;
      case 'grid-template-rows':
        spec.rows = parseTracks(declaration.value, problems, declaration.line, 'rows', limits);
        break;
      case 'grid-template-areas':
        if (declaration.value === 'none') {
          spec.areaRows = [];
        } else {
          spec.areaRows = declaration.strings.map((entry) => ({
            cells: entry.text.trim().split(/\s+/).filter((cell) => cell.length > 0),
            line: entry.line,
          }));
        }
        break;
      case 'gap':
        shorthandGap = parseGapValue(declaration.value, problems, declaration.line);
        break;
      case 'row-gap': {
        const parsed = parseGapValue(declaration.value, problems, declaration.line);
        if (parsed) rowGap = parsed.row;
        break;
      }
      case 'column-gap': {
        const parsed = parseGapValue(declaration.value, problems, declaration.line);
        if (parsed) columnGap = parsed.row;
        break;
      }
    }
  }

  if (requireDisplayGrid && display !== 'grid') {
    problems.add(rule.preludeLine, '.layout needs display: grid.');
  }
  if (!requireDisplayGrid && display !== null && display !== 'grid') {
    problems.add(rule.preludeLine, '.layout needs display: grid.');
  }

  if (shorthandGap) spec.gap = { ...shorthandGap };
  if (rowGap !== null || columnGap !== null) {
    const base = spec.gap ?? { row: 0, column: 0 };
    spec.gap = {
      row: rowGap ?? base.row,
      column: columnGap ?? base.column,
    };
  }
  return spec;
}

interface AreaRuleRef {
  name: string;
  line: number;
}

function readAreaRule(rule: Rule, name: string, problems: Problems): void {
  for (const declaration of rule.declarations) {
    if (declaration.property === 'grid-area') {
      if (declaration.value !== name) {
        problems.add(rule.preludeLine, 'only .layout and area rules are allowed.');
      }
      continue;
    }
    if (declaration.property === 'display') {
      if (declaration.value !== 'none' && declaration.value !== 'block') {
        problems.add(rule.preludeLine, 'only .layout and area rules are allowed.');
      }
      continue;
    }
    problems.add(declaration.line, `unknown property ${declaration.property}.`);
  }
}

function areasFromRows(
  rows: { cells: string[]; line: number }[],
  columnCount: number,
  rowCount: number,
  areaRowsLine: number,
  problems: Problems,
): Area[] {
  let countProblem = false;
  for (const row of rows) {
    if (row.cells.length !== columnCount) {
      problems.add(row.line, `every area row needs ${columnCount} cells.`);
      countProblem = true;
      break;
    }
  }
  if (rows.length !== rowCount) {
    problems.add(areaRowsLine, `grid-template-areas needs ${rowCount} rows.`);
  }

  const cellsByName = new Map<string, Set<string>>();
  const firstLine = new Map<string, number>();
  const badNames = new Set<string>();
  rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, columnIndex) => {
      if (cell === '.') return;
      if (!firstLine.has(cell)) firstLine.set(cell, row.line);
      const nameProblem = checkAreaName(cell);
      if (nameProblem) {
        if (!badNames.has(cell)) {
          badNames.add(cell);
          problems.add(row.line, nameProblem);
        }
        return;
      }
      const set = cellsByName.get(cell) ?? new Set<string>();
      set.add(`${rowIndex + 1},${columnIndex + 1}`);
      cellsByName.set(cell, set);
    });
  });

  const areas: Area[] = [];
  for (const [name, cells] of cellsByName) {
    const rect = cellsToRect(cells);
    if (!rect) {
      if (!countProblem) {
        problems.add(firstLine.get(name) as number, `area ${name} is not one rectangle.`);
      }
      continue;
    }
    areas.push({ name, ...rect });
  }
  return areas.sort((a, b) => a.row_start - b.row_start || a.column_start - b.column_start);
}

/** Reads grid CSS back into a layout. The single decision behind `apply_css`. */
export function cssToLayout(css: string, limits: Limits): CssParseResult {
  if (css.length > CSS_MAX_LENGTH) return { ok: false, message: CSS_LENGTH_MESSAGE };

  const problems = new Problems();
  const text = stripComments(css);
  const totalLines = text.split('\n').length;
  const sheet = parseSheet(text);
  if (sheet.missingBrace) problems.add(totalLines, 'missing }.');

  const areaRuleRefs: AreaRuleRef[] = [];
  let baseLayoutRule: Rule | null = null;
  const mediaBlocks: { minWidth: number; line: number; rule: Rule | null }[] = [];
  const seenWidths = new Set<number>();
  let mediaCount = 0;

  const collect = (
    rules: Rule[],
    onLayoutRule: (rule: Rule) => void,
    allowMedia: boolean,
  ): void => {
    for (const rule of rules) {
      if (rule.prelude.startsWith('@')) {
        if (!allowMedia) {
          problems.add(rule.preludeLine, 'only .layout and area rules are allowed.');
          continue;
        }
        const match = MEDIA_PRELUDE.exec(rule.prelude);
        if (!match) {
          problems.add(rule.preludeLine, 'breakpoints use @media (min-width: <n>px).');
          continue;
        }
        const minWidth = Number(match[1]);
        if (minWidth < 400 || minWidth > 1440) {
          problems.add(rule.preludeLine, BREAKPOINT_RANGE_MESSAGE);
          continue;
        }
        if (seenWidths.has(minWidth)) {
          problems.add(rule.preludeLine, duplicateBreakpointMessage(minWidth));
          continue;
        }
        seenWidths.add(minWidth);
        mediaCount += 1;
        if (mediaCount > limits.maxBreakpoints) {
          problems.add(rule.preludeLine, maxBreakpointsMessage(limits.maxBreakpoints));
          continue;
        }
        const block: { minWidth: number; line: number; rule: Rule | null } = {
          minWidth,
          line: rule.preludeLine,
          rule: null,
        };
        mediaBlocks.push(block);
        collect(
          rule.children,
          (inner) => {
            block.rule = inner;
          },
          false,
        );
        continue;
      }
      if (rule.prelude === '.layout') {
        onLayoutRule(rule);
        continue;
      }
      const selector = SELECTOR.exec(rule.prelude);
      if (!selector || checkAreaName(selector[1] as string)) {
        problems.add(rule.preludeLine, 'only .layout and area rules are allowed.');
        continue;
      }
      const name = selector[1] as string;
      readAreaRule(rule, name, problems);
      areaRuleRefs.push({ name, line: rule.preludeLine });
    }
  };

  collect(
    sheet.rules,
    (rule) => {
      baseLayoutRule = rule;
    },
    true,
  );

  if (!baseLayoutRule) {
    problems.add(1, '.layout needs display: grid.');
    const message = problems.first();
    return { ok: false, message: message as string };
  }

  const baseSpec = readLayoutRule(baseLayoutRule, problems, limits, true);
  const baseAreaRowsLine =
    (baseLayoutRule as Rule).declarations.find((item) => item.property === 'grid-template-areas')?.line ??
    (baseLayoutRule as Rule).preludeLine;

  const baseColumnCount =
    baseSpec.columns?.length ?? (baseSpec.areaRows && baseSpec.areaRows.length > 0 ? (baseSpec.areaRows[0] as { cells: string[] }).cells.length : 1);
  const baseRowCount =
    baseSpec.rows?.length ?? (baseSpec.areaRows && baseSpec.areaRows.length > 0 ? baseSpec.areaRows.length : 1);
  const baseColumns = baseSpec.columns ?? new Array<string>(Math.max(baseColumnCount, 1)).fill('1fr');
  const baseRows = baseSpec.rows ?? new Array<string>(Math.max(baseRowCount, 1)).fill('1fr');
  const baseAreas = baseSpec.areaRows
    ? areasFromRows(baseSpec.areaRows, baseColumns.length, baseRows.length, baseAreaRowsLine, problems)
    : [];

  const state: LayoutState = {
    columns: baseColumns,
    rows: baseRows,
    gap: baseSpec.gap ?? { row: 0, column: 0 },
    areas: baseAreas,
    breakpoints: [],
  };

  const ordered = [...mediaBlocks].sort((a, b) => a.minWidth - b.minWidth);
  let narrower: { columns: string[]; rows: string[]; areas: Area[] } = {
    columns: baseColumns,
    rows: baseRows,
    areas: baseAreas,
  };
  for (const block of ordered) {
    const rule = block.rule;
    const spec = rule ? readLayoutRule(rule, problems, limits, false) : null;
    const columns = spec?.columns ?? [...narrower.columns];
    const rows = spec?.rows ?? [...narrower.rows];
    let areas: Area[];
    if (spec?.areaRows) {
      const line =
        rule?.declarations.find((item) => item.property === 'grid-template-areas')?.line ?? block.line;
      areas = areasFromRows(spec.areaRows, columns.length, rows.length, line, problems);
    } else {
      areas = narrower.areas.map((area) => ({ ...area }));
    }
    const breakpoint: Breakpoint = {
      min_width: block.minWidth,
      columns,
      rows,
      areas,
      gap: spec?.gap ? { ...spec.gap } : null,
    };
    state.breakpoints.push(breakpoint);
    narrower = { columns, rows, areas };
  }

  const placed = new Set<string>();
  for (const area of state.areas) placed.add(area.name);
  for (const breakpoint of state.breakpoints) {
    for (const area of breakpoint.areas) placed.add(area.name);
  }
  for (const ref of areaRuleRefs) {
    if (!placed.has(ref.name)) {
      problems.add(ref.line, `area ${ref.name} is not in any grid-template-areas.`);
    }
  }

  if (!problems.empty) return { ok: false, message: problems.first() as string };
  return { ok: true, state };
}
