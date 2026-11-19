import type { Area, Axis, Breakpoint, Gap, Grid, LayoutState, Rect, Scope } from './types.js';

const readingOrder = (a: Area, b: Area): number => a.row_start - b.row_start || a.column_start - b.column_start;

export const rectOf = (area: Area | Rect): Rect => ({
  row_start: area.row_start,
  column_start: area.column_start,
  row_end: area.row_end,
  column_end: area.column_end,
});

export const sameRect = (a: Rect, b: Rect): boolean =>
  a.row_start === b.row_start && a.column_start === b.column_start && a.row_end === b.row_end && a.column_end === b.column_end;

export const overlapsRect = (a: Rect, b: Rect): boolean =>
  a.row_start < b.row_end && b.row_start < a.row_end && a.column_start < b.column_end && b.column_start < a.column_end;

export function cellsOf(rect: Rect): string[] {
  const cells: string[] = [];
  for (let row = rect.row_start; row < rect.row_end; row++) {
    for (let column = rect.column_start; column < rect.column_end; column++) cells.push(`${row}:${column}`);
  }
  return cells;
}

/** The rectangle a set of cells fills exactly, or null when the cells are not one rectangle. */
export function rectangleOf(cells: Set<string>): Rect | null {
  if (cells.size === 0) return null;
  let rowStart = Infinity;
  let columnStart = Infinity;
  let rowEnd = 0;
  let columnEnd = 0;
  for (const cell of cells) {
    const [row, column] = cell.split(':').map(Number);
    rowStart = Math.min(rowStart, row);
    columnStart = Math.min(columnStart, column);
    rowEnd = Math.max(rowEnd, row + 1);
    columnEnd = Math.max(columnEnd, column + 1);
  }
  const rect = { row_start: rowStart, column_start: columnStart, row_end: rowEnd, column_end: columnEnd };
  return cellsOf(rect).length === cells.size ? rect : null;
}

export function sortAreas(areas: Area[]): Area[] {
  return [...areas].sort(readingOrder);
}

export function sortBreakpoints(breakpoints: Breakpoint[]): Breakpoint[] {
  return [...breakpoints].sort((a, b) => a.min_width - b.min_width);
}

/** The grid a scope edits: the base layout itself or one breakpoint; undefined when the breakpoint does not exist. */
export function gridOf(state: LayoutState, scope: Scope): LayoutState | Breakpoint | undefined {
  return scope === 'base' ? state : state.breakpoints.find((breakpoint) => breakpoint.min_width === scope);
}

export const tracksOf = (grid: Grid, axis: Axis): string[] => (axis === 'column' ? grid.columns : grid.rows);

export const containsCell = (rect: Rect, row: number, column: number): boolean =>
  row >= rect.row_start && row < rect.row_end && column >= rect.column_start && column < rect.column_end;

/** The first area (in reading order) other than `name` whose cells meet `rect`. */
export const firstOverlap = (areas: Area[], name: string, rect: Rect): Area | undefined =>
  sortAreas(areas).find((area) => area.name !== name && overlapsRect(area, rect));

/** The scopes from narrowest to widest: base first, then every breakpoint. */
export function scopesOf(state: LayoutState): { scope: Scope; grid: Grid }[] {
  return [{ scope: 'base', grid: state }, ...state.breakpoints.map((breakpoint) => ({ scope: breakpoint.min_width, grid: breakpoint }))];
}

/** The gap in effect for a scope and the scope that sets it: the scope itself, else the nearest narrower scope with a gap of its own. */
export function gapIn(state: LayoutState, scope: Scope): { gap: Gap; source: Scope } {
  let found: { gap: Gap; source: Scope } = { gap: state.gap, source: 'base' };
  for (const breakpoint of state.breakpoints) {
    if (scope === 'base' || breakpoint.min_width > scope) break;
    if (breakpoint.gap) found = { gap: breakpoint.gap, source: breakpoint.min_width };
  }
  return found;
}

/** Area names in generated-code order: base reading order, then each breakpoint's reading order. */
export function areaOrder(state: LayoutState): string[] {
  const names: string[] = [];
  for (const { grid } of scopesOf(state)) {
    for (const area of sortAreas(grid.areas)) if (!names.includes(area.name)) names.push(area.name);
  }
  return names;
}

export function normalise(state: LayoutState): LayoutState {
  return {
    columns: state.columns,
    rows: state.rows,
    gap: { row: state.gap.row, column: state.gap.column },
    areas: sortAreas(state.areas).map((area) => ({ name: area.name, ...rectOf(area) })),
    breakpoints: sortBreakpoints(state.breakpoints).map((breakpoint) => ({
      min_width: breakpoint.min_width,
      columns: breakpoint.columns,
      rows: breakpoint.rows,
      areas: sortAreas(breakpoint.areas).map((area) => ({ name: area.name, ...rectOf(area) })),
      gap: breakpoint.gap ? { row: breakpoint.gap.row, column: breakpoint.gap.column } : null,
    })),
  };
}

export const sameState = (a: LayoutState, b: LayoutState): boolean => JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
