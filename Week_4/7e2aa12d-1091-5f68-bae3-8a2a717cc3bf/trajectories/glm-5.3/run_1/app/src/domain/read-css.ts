// The one place that reads applied CSS back into a whole layout.
import type { AreaLine, Breakpoint, Gap, LayoutData } from './layout.js';
import { readTrackSize } from './sizes.js';
import { areaNameError, sortAreas } from './areas.js';

export const CSS_TOO_LONG_MESSAGE = 'The CSS is longer than 20,000 characters.';
export const GAP_MESSAGE = 'Gaps are whole pixels from 0 to 200.';
const MAX_CSS = 20000;

/** An error carrying the line it was found on. */
export class CssError extends Error {
  line: number;
  constructor(line: number, message: string) {
    super(message);
    this.line = line;
  }
}

interface Property { line: number; property: string; value: string }
interface Rule { selector: string; line: number; properties: Property[] }
interface AreaRule { name: string; line: number; property: string; value: string }
interface MediaBlock { minWidth: number; line: number; layoutRule: Rule | null; areaRules: AreaRule[] }
interface ParsedCss { baseLayout: Rule | null; baseAreaRules: AreaRule[]; media: MediaBlock[] }

type Token =
  | { kind: 'media'; minWidth: number; line: number }
  | { kind: 'selector'; name: string; line: number }
  | { kind: 'property'; property: string; value: string; line: number }
  | { kind: 'end'; line: number };

const ONLY_RULES_MESSAGE = 'only .layout and area rules are allowed.';
const AREA_RULE_PROPERTIES = new Set(['grid-area', 'display']);

/** Splits the CSS into tokens with original line numbers, dropping comments. */
function tokenize(text: string): Token[] {
  const stripped = stripComments(text);
  const lineStarts: number[] = [0];
  for (let i = 0; i < stripped.length; i += 1) {
    if (stripped[i] === '\n') lineStarts.push(i + 1);
  }
  const lineAt = (index: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid]! <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const tokens: Token[] = [];
  let p = 0;
  const lastLine = lineAt(stripped.length);
  while (p < stripped.length) {
    while (p < stripped.length && /\s/.test(stripped[p]!)) p += 1;
    if (p >= stripped.length) break;
    const line = lineAt(p);
    if (stripped[p] === '}') {
      tokens.push({ kind: 'end', line });
      p += 1;
      continue;
    }
    const rest = stripped.slice(p);
    const mediaMatch = /^@media\s*\(\s*min-width\s*:\s*(\d+)px\s*\)\s*\{/.exec(rest);
    if (mediaMatch !== null) {
      tokens.push({ kind: 'media', minWidth: Number(mediaMatch[1]), line });
      p += mediaMatch[0].length;
      continue;
    }
    const selectorMatch = /^(\.[A-Za-z0-9_-]+)\s*\{/.exec(rest);
    if (selectorMatch !== null) {
      tokens.push({ kind: 'selector', name: selectorMatch[1]!.slice(1), line });
      p += selectorMatch[0].length;
      continue;
    }
    const propertyMatch = /^([a-zA-Z-]+)\s*:/.exec(rest);
    if (propertyMatch !== null) {
      let end = p + propertyMatch[0].length;
      while (end < stripped.length && stripped[end] !== ';' && stripped[end] !== '}') end += 1;
      const raw = stripped.slice(p + propertyMatch[0].length, end).trim();
      if (end >= stripped.length) throw new CssError(lastLine, 'missing }.');
      tokens.push({ kind: 'property', property: propertyMatch[1]!, value: raw, line });
      if (stripped[end] === ';') end += 1;
      p = end;
      continue;
    }
    throw new CssError(line, ONLY_RULES_MESSAGE);
  }
  return tokens;
}

/** Splits the CSS into rules. Throws CssError on the first error by line. */
export function parseCss(text: string): ParsedCss {
  if (text.length > MAX_CSS) throw new CssError(0, CSS_TOO_LONG_MESSAGE);
  const tokens = tokenize(text);
  const parsed: ParsedCss = { baseLayout: null, baseAreaRules: [], media: [] };
  const lastLine = text.length === 0 ? 1 : text.split('\n').length;
  let media: MediaBlock | null = null;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.kind === 'end') {
      if (media === null) throw new CssError(token.line, ONLY_RULES_MESSAGE);
      media = null;
      i += 1;
      continue;
    }
    if (token.kind === 'media') {
      if (media !== null) throw new CssError(token.line, 'breakpoints use @media (min-width: <n>px).');
      media = { minWidth: token.minWidth, line: token.line, layoutRule: null, areaRules: [] };
      parsed.media.push(media);
      i += 1;
      continue;
    }
    if (token.kind === 'property') throw new CssError(token.line, ONLY_RULES_MESSAGE);
    const selector = token.name;
    if (!/^[a-z0-9-]+$/.test(selector)) throw new CssError(token.line, ONLY_RULES_MESSAGE);
    const rule: Rule = { selector: `.${selector}`, line: token.line, properties: [] };
    i += 1;
    while (i < tokens.length && tokens[i]!.kind === 'property') {
      rule.properties.push(tokens[i]! as Extract<Token, { kind: 'property' }>);
      i += 1;
    }
    if (i >= tokens.length || tokens[i]!.kind !== 'end') throw new CssError(lastLine, 'missing }.');
    i += 1;
    if (rule.selector === '.layout') {
      if (media !== null) {
        if (media.layoutRule !== null) throw new CssError(rule.line, ONLY_RULES_MESSAGE);
        media.layoutRule = rule;
      } else if (parsed.baseLayout === null) {
        parsed.baseLayout = rule;
      } else {
        parsed.baseLayout.properties.push(...rule.properties);
      }
    } else {
      for (const property of rule.properties) {
        if (!AREA_RULE_PROPERTIES.has(property.property)) {
          throw new CssError(property.line, `unknown property ${property.property}.`);
        }
        if (property.property === 'grid-area' && property.value !== selector) {
          throw new CssError(property.line, ONLY_RULES_MESSAGE);
        }
        if (property.property === 'display' && property.value !== 'none' && property.value !== 'block') {
          throw new CssError(property.line, ONLY_RULES_MESSAGE);
        }
        const entry = { name: selector, line: property.line, property: property.property, value: property.value };
        if (media === null) parsed.baseAreaRules.push(entry);
        else media.areaRules.push(entry);
      }
    }
  }
  if (media !== null) throw new CssError(lastLine, 'missing }.');
  if (parsed.baseLayout === null) throw new CssError(1, '.layout needs display: grid.');
  const display = parsed.baseLayout.properties.find((p) => p.property === 'display');
  if (display === undefined || display.value !== 'grid') {
    throw new CssError(parsed.baseLayout.line, '.layout needs display: grid.');
  }
  return parsed;
}


function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Reads the grid-template-areas value, checking row count, row width, names and rectangles. */
function readAreas(value: string, firstLine: number, columnCount: number | null, rowCount: number | null): AreaLine[] {
  const rows = value.split('\n').map((row) => row.trim()).filter((row) => row.length > 0);
  if (rowCount !== null && rows.length !== rowCount) {
    throw new CssError(firstLine, `grid-template-areas needs ${rowCount} rows.`);
  }
  const cells = new Map<string, { name: string; cells: Array<[number, number]>; firstLine: number }>();
  for (let r = 0; r < rows.length; r += 1) {
    const rowLine = firstLine + r;
    const names = rows[r]!.replace(/"/g, '').split(/\s+/).filter((cell) => cell.length > 0);
    if (columnCount !== null && names.length !== columnCount) {
      throw new CssError(rowLine, `every area row needs ${columnCount} cells.`);
    }
    for (let c = 0; c < names.length; c += 1) {
      const cell = names[c]!;
      if (cell === '.') continue;
      const nameError = areaNameError(cell);
      if (nameError !== null) throw new CssError(rowLine, nameError);
      const entry = cells.get(cell) ?? { name: cell, cells: [], firstLine: rowLine };
      entry.cells.push([r + 1, c + 1]);
      cells.set(cell, entry);
    }
  }
  const areas: AreaLine[] = [];
  for (const entry of cells.values()) {
    const minRow = Math.min(...entry.cells.map(([r]) => r));
    const maxRow = Math.max(...entry.cells.map(([r]) => r));
    const minColumn = Math.min(...entry.cells.map(([, c]) => c));
    const maxColumn = Math.max(...entry.cells.map(([, c]) => c));
    const span = (maxRow - minRow + 1) * (maxColumn - minColumn + 1);
    if (entry.cells.length !== span) {
      throw new CssError(entry.firstLine, `area ${entry.name} is not one rectangle.`);
    }
    areas.push({ name: entry.name, row_start: minRow, column_start: minColumn, row_end: maxRow + 1, column_end: maxColumn + 1 });
  }
  return sortAreas(areas);
}

function readTrackList(value: string, line: number, axis: 'columns' | 'rows'): string[] {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const sizes: string[] = [];
  for (const part of parts) {
    const result = readTrackSize(part);
    if (result.error !== null) throw new CssError(line, result.error);
    sizes.push(result.size!);
  }
  if (sizes.length === 0) {
    throw new CssError(line, axis === 'columns' ? 'A layout needs at least one column.' : 'A layout needs at least one row.');
  }
  return sizes;
}

function readGapValue(value: string, line: number): number {
  const match = /^(\d+)(px)?$/.exec(value.trim());
  if (match === null) throw new CssError(line, GAP_MESSAGE);
  const amount = Number(match[1]);
  if (amount < 0 || amount > 200) throw new CssError(line, GAP_MESSAGE);
  return amount;
}

interface ScopeRead { columns: string[] | null; rows: string[] | null; areas: AreaLine[] | null; gap: Gap | null }

/** Reads one .layout rule into the pieces of a scope. */
function readScopeRule(rule: Rule, limits: { maxTracks: number }): ScopeRead {
  let columns: string[] | null = null;
  let rows: string[] | null = null;
  let gap: Gap | null = null;
  let rowGap: number | null = null;
  let columnGap: number | null = null;
  let areasValue: { value: string; line: number } | null = null;
  for (const property of rule.properties) {
    switch (property.property) {
      case 'display':
        if (property.value !== 'grid') throw new CssError(property.line, '.layout needs display: grid.');
        break;
      case 'grid-template-columns':
        columns = readTrackList(property.value, property.line, 'columns');
        break;
      case 'grid-template-rows':
        rows = readTrackList(property.value, property.line, 'rows');
        break;
      case 'grid-template-areas':
        areasValue = { value: property.value, line: property.line };
        break;
      case 'gap': {
        const parts = property.value.trim().split(/\s+/);
        if (parts.length === 1) {
          const amount = readGapValue(parts[0]!, property.line);
          gap = { row: amount, column: amount };
        } else if (parts.length === 2) {
          gap = { row: readGapValue(parts[0]!, property.line), column: readGapValue(parts[1]!, property.line) };
        } else {
          throw new CssError(property.line, GAP_MESSAGE);
        }
        break;
      }
      case 'row-gap':
        rowGap = readGapValue(property.value, property.line);
        break;
      case 'column-gap':
        columnGap = readGapValue(property.value, property.line);
        break;
      default:
        throw new CssError(property.line, `unknown property ${property.property}.`);
    }
  }
  if (rowGap !== null || columnGap !== null) {
    gap = { row: gap?.row ?? rowGap ?? 0, column: gap?.column ?? columnGap ?? 0 };
    if (rowGap !== null) gap = { ...gap, row: rowGap };
    if (columnGap !== null) gap = { ...gap, column: columnGap };
  }
  if (columns !== null && columns.length > limits.maxTracks) {
    throw new CssError(rule.line, `A layout can have at most ${limits.maxTracks} columns.`);
  }
  if (rows !== null && rows.length > limits.maxTracks) {
    throw new CssError(rule.line, `A layout can have at most ${limits.maxTracks} rows.`);
  }
  const areas = areasValue === null
    ? null
    : readAreas(areasValue.value, areasValue.line, columns?.length ?? null, rows?.length ?? null);
  return { columns, rows, areas, gap };
}

export interface ApplyCssLimits { maxTracks: number; maxBreakpoints: number }
export interface ApplyCssResult { layout: LayoutData; added: string[]; removed: string[] }

function areaNamesOf(layout: LayoutData): string[] {
  const names: string[] = [];
  for (const area of sortAreas(layout.areas)) if (!names.includes(area.name)) names.push(area.name);
  for (const bp of layout.breakpoints) {
    for (const area of sortAreas(bp.areas)) if (!names.includes(area.name)) names.push(area.name);
  }
  return names;
}

/** Reads the whole layout from the CSS. The CSS is the whole layout. */
export function cssToLayout(text: string, limits: ApplyCssLimits, current: LayoutData): ApplyCssResult {
  const parsed = parseCss(text);
  const seenWidths = new Set<number>();
  for (const block of parsed.media) {
    if (block.minWidth < 400 || block.minWidth > 1440) {
      throw new CssError(block.line, 'Breakpoints start between 400px and 1440px.');
    }
    if (seenWidths.has(block.minWidth)) {
      throw new CssError(block.line, `There is already a breakpoint at ${block.minWidth}px.`);
    }
    seenWidths.add(block.minWidth);
  }
  if (parsed.media.length > limits.maxBreakpoints) {
    const block = parsed.media[limits.maxBreakpoints]!;
    throw new CssError(block.line, `A layout can have at most ${limits.maxBreakpoints} breakpoints.`);
  }

  const base = readScopeRule(parsed.baseLayout!, limits);
  let baseAreas = base.areas;
  if (baseAreas === null) baseAreas = [];
  let baseColumns = base.columns;
  let baseRows = base.rows;
  const areaColumns = baseAreas.length > 0 ? Math.max(...baseAreas.map((a) => a.column_end)) : 0;
  const areaRows = baseAreas.length > 0 ? Math.max(...baseAreas.map((a) => a.row_end)) : 0;
  if (baseColumns === null && baseRows === null) {
    const count = Math.max(1, areaColumns, areaRows);
    baseColumns = Array.from({ length: count }, () => '1fr');
    baseRows = Array.from({ length: count }, () => '1fr');
  } else {
    if (baseColumns === null) baseColumns = Array.from({ length: Math.max(1, areaColumns) }, () => '1fr');
    if (baseRows === null) baseRows = Array.from({ length: Math.max(1, areaRows) }, () => '1fr');
  }
  const baseGap: Gap = base.gap ?? { row: 0, column: 0 };

  // Every area named in an area rule must appear in some grid-template-areas.
  const placedNames = new Set<string>(baseAreas.map((a) => a.name));
  const orderedMedia = [...parsed.media].sort((a, b) => a.minWidth - b.minWidth);
  let previousAreas = baseAreas;
  for (const block of orderedMedia) {
    const scope = block.layoutRule === null
      ? { columns: null, rows: null, areas: null, gap: null }
      : readScopeRule(block.layoutRule, limits);
    const areas = scope.areas ?? previousAreas;
    for (const area of areas) placedNames.add(area.name);
    previousAreas = areas;
  }
  const allRuleNames = new Set<string>();
  for (const rule of parsed.baseAreaRules) allRuleNames.add(rule.name);
  for (const block of parsed.media) for (const rule of block.areaRules) allRuleNames.add(rule.name);
  for (const name of allRuleNames) {
    if (!placedNames.has(name)) {
      const rule = parsed.baseAreaRules.find((r) => r.name === name)
        ?? parsed.media.flatMap((block) => block.areaRules).find((r) => r.name === name)!;
      throw new CssError(rule.line, `area ${name} is not in any grid-template-areas.`);
    }
  }

  const breakpoints: Breakpoint[] = [];
  let previousColumns = baseColumns;
  let previousRows = baseRows;
  let previousAreasList = baseAreas;
  for (const block of orderedMedia) {
    const scope = block.layoutRule === null
      ? { columns: null, rows: null, areas: null, gap: null }
      : readScopeRule(block.layoutRule, limits);
    const columns = scope.columns ?? previousColumns;
    const rows = scope.rows ?? previousRows;
    const areas = scope.areas ?? previousAreasList;
    breakpoints.push({ min_width: block.minWidth, columns, rows, areas, gap: scope.gap });
    previousColumns = columns;
    previousRows = rows;
    previousAreasList = areas;
  }

  const layout: LayoutData = {
    name: current.name,
    revision: current.revision,
    columns: baseColumns,
    rows: baseRows,
    gap: baseGap,
    areas: baseAreas,
    breakpoints,
  };
  const before = areaNamesOf(current);
  const after = areaNamesOf(layout);
  return {
    layout,
    added: after.filter((name) => !before.includes(name)),
    removed: before.filter((name) => !after.includes(name)),
  };
}
