import type { Area, Axis, Breakpoint, Gap, LayoutState, Rect, Scope } from './types.js';

export interface ScopeGrid {
  columns: string[];
  rows: string[];
  areas: Area[];
}

export function cloneState(state: LayoutState): LayoutState {
  return structuredCloneState(state);
}

function structuredCloneState(state: LayoutState): LayoutState {
  return {
    columns: [...state.columns],
    rows: [...state.rows],
    gap: { ...state.gap },
    areas: state.areas.map((area) => ({ ...area })),
    breakpoints: state.breakpoints.map((breakpoint) => ({
      min_width: breakpoint.min_width,
      columns: [...breakpoint.columns],
      rows: [...breakpoint.rows],
      areas: breakpoint.areas.map((area) => ({ ...area })),
      gap: breakpoint.gap ? { ...breakpoint.gap } : null,
    })),
  };
}

export function sortedBreakpoints(state: LayoutState): Breakpoint[] {
  return [...state.breakpoints].sort((a, b) => a.min_width - b.min_width);
}

export function getScopeGrid(state: LayoutState, scope: Scope): ScopeGrid | null {
  if (scope === 'base') {
    return { columns: state.columns, rows: state.rows, areas: state.areas };
  }
  const breakpoint = state.breakpoints.find((item) => item.min_width === scope);
  if (!breakpoint) return null;
  return { columns: breakpoint.columns, rows: breakpoint.rows, areas: breakpoint.areas };
}

export function withScopeGrid(state: LayoutState, scope: Scope, grid: ScopeGrid): LayoutState {
  const next = cloneState(state);
  if (scope === 'base') {
    next.columns = [...grid.columns];
    next.rows = [...grid.rows];
    next.areas = sortAreas(grid.areas);
    return next;
  }
  const breakpoint = next.breakpoints.find((item) => item.min_width === scope);
  if (!breakpoint) return next;
  breakpoint.columns = [...grid.columns];
  breakpoint.rows = [...grid.rows];
  breakpoint.areas = sortAreas(grid.areas);
  return next;
}

/** Areas in reading order of their top-left cell. */
export function sortAreas(areas: Area[]): Area[] {
  return [...areas]
    .map((area) => ({ ...area }))
    .sort((a, b) => a.row_start - b.row_start || a.column_start - b.column_start);
}

export function ownGap(state: LayoutState, scope: Scope): Gap | null {
  if (scope === 'base') return state.gap;
  return state.breakpoints.find((item) => item.min_width === scope)?.gap ?? null;
}

/** The scope that applies immediately below `minWidth`. */
export function nextNarrowerScope(state: LayoutState, minWidth: number): Scope {
  const below = sortedBreakpoints(state).filter((item) => item.min_width < minWidth);
  const nearest = below[below.length - 1];
  return nearest ? nearest.min_width : 'base';
}

export function effectiveGap(state: LayoutState, scope: Scope): Gap {
  if (scope === 'base') return state.gap;
  const own = ownGap(state, scope);
  if (own) return own;
  return effectiveGap(state, nextNarrowerScope(state, scope));
}

export function scopeLabel(scope: Scope): string {
  return scope === 'base' ? 'Base' : `From ${scope}px`;
}

export function normaliseRect(rect: Rect): Rect {
  return {
    row_start: Math.min(rect.row_start, rect.row_end),
    row_end: Math.max(rect.row_start, rect.row_end),
    column_start: Math.min(rect.column_start, rect.column_end),
    column_end: Math.max(rect.column_start, rect.column_end),
  };
}

export function rectCells(rect: Rect): string[] {
  const cells: string[] = [];
  for (let row = rect.row_start; row < rect.row_end; row += 1) {
    for (let column = rect.column_start; column < rect.column_end; column += 1) {
      cells.push(`${row},${column}`);
    }
  }
  return cells;
}

export function rectContains(rect: Rect, row: number, column: number): boolean {
  return (
    row >= rect.row_start && row < rect.row_end && column >= rect.column_start && column < rect.column_end
  );
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.row_start < b.row_end &&
    b.row_start < a.row_end &&
    a.column_start < b.column_end &&
    b.column_start < a.column_end
  );
}

export function areaAt(grid: ScopeGrid, row: number, column: number): Area | null {
  for (const area of sortAreas(grid.areas)) {
    if (rectContains(area, row, column)) return area;
  }
  return null;
}

/** A cell set is a rectangle when it fills its own bounding box. */
export function cellsToRect(cells: Set<string>): Rect | null {
  if (cells.size === 0) return null;
  let rowMin = Infinity;
  let rowMax = -Infinity;
  let columnMin = Infinity;
  let columnMax = -Infinity;
  for (const cell of cells) {
    const [row, column] = cell.split(',').map(Number) as [number, number];
    rowMin = Math.min(rowMin, row);
    rowMax = Math.max(rowMax, row);
    columnMin = Math.min(columnMin, column);
    columnMax = Math.max(columnMax, column);
  }
  const width = columnMax - columnMin + 1;
  const height = rowMax - rowMin + 1;
  if (width * height !== cells.size) return null;
  return {
    row_start: rowMin,
    row_end: rowMax + 1,
    column_start: columnMin,
    column_end: columnMax + 1,
  };
}

/** A column added after `after` joins an area that spans both neighbouring tracks. */
export function addTrack(grid: ScopeGrid, axis: Axis, after: number): ScopeGrid {
  const tracks = axis === 'column' ? grid.columns : grid.rows;
  const nextTracks = [...tracks];
  nextTracks.splice(after, 0, '1fr');
  const areas = grid.areas.map((area) => {
    const start = axis === 'column' ? area.column_start : area.row_start;
    const end = axis === 'column' ? area.column_end : area.row_end;
    let nextStart = start;
    let nextEnd = end;
    if (start <= after && end >= after + 2) {
      nextEnd = end + 1;
    } else if (start > after) {
      nextStart = start + 1;
      nextEnd = end + 1;
    }
    return axis === 'column'
      ? { ...area, column_start: nextStart, column_end: nextEnd }
      : { ...area, row_start: nextStart, row_end: nextEnd };
  });
  return axis === 'column'
    ? { columns: nextTracks, rows: grid.rows, areas: sortAreas(areas) }
    : { columns: grid.columns, rows: nextTracks, areas: sortAreas(areas) };
}

export interface RemoveTrackResult {
  grid: ScopeGrid;
  removedAreas: string[];
}

export function removeTrack(grid: ScopeGrid, axis: Axis, index: number): RemoveTrackResult {
  const tracks = axis === 'column' ? grid.columns : grid.rows;
  const nextTracks = tracks.filter((_, position) => position + 1 !== index);
  const kept: Area[] = [];
  const removedAreas: string[] = [];
  for (const area of sortAreas(grid.areas)) {
    const start = axis === 'column' ? area.column_start : area.row_start;
    const end = axis === 'column' ? area.column_end : area.row_end;
    const nextStart = start > index ? start - 1 : start;
    const nextEnd = end > index ? end - 1 : end;
    if (nextStart >= nextEnd) {
      removedAreas.push(area.name);
      continue;
    }
    kept.push(
      axis === 'column'
        ? { ...area, column_start: nextStart, column_end: nextEnd }
        : { ...area, row_start: nextStart, row_end: nextEnd },
    );
  }
  const nextGrid: ScopeGrid =
    axis === 'column'
      ? { columns: nextTracks, rows: grid.rows, areas: sortAreas(kept) }
      : { columns: grid.columns, rows: nextTracks, areas: sortAreas(kept) };
  return { grid: nextGrid, removedAreas };
}

export function areaNamesEverywhere(state: LayoutState): Set<string> {
  const names = new Set<string>();
  for (const area of state.areas) names.add(area.name);
  for (const breakpoint of state.breakpoints) {
    for (const area of breakpoint.areas) names.add(area.name);
  }
  return names;
}

/** Every area name in the order the generated code uses. */
export function codeAreaOrder(state: LayoutState): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const push = (areas: Area[]): void => {
    for (const area of sortAreas(areas)) {
      if (!seen.has(area.name)) {
        seen.add(area.name);
        order.push(area.name);
      }
    }
  };
  push(state.areas);
  for (const breakpoint of sortedBreakpoints(state)) push(breakpoint.areas);
  return order;
}

export function statesEqual(a: LayoutState, b: LayoutState): boolean {
  return JSON.stringify(normaliseState(a)) === JSON.stringify(normaliseState(b));
}

export function normaliseState(state: LayoutState): LayoutState {
  return {
    columns: [...state.columns],
    rows: [...state.rows],
    gap: { row: state.gap.row, column: state.gap.column },
    areas: sortAreas(state.areas).map(normaliseArea),
    breakpoints: sortedBreakpoints(state).map((breakpoint) => ({
      min_width: breakpoint.min_width,
      columns: [...breakpoint.columns],
      rows: [...breakpoint.rows],
      areas: sortAreas(breakpoint.areas).map(normaliseArea),
      gap: breakpoint.gap ? { row: breakpoint.gap.row, column: breakpoint.gap.column } : null,
    })),
  };
}

function normaliseArea(area: Area): Area {
  return {
    name: area.name,
    row_start: area.row_start,
    column_start: area.column_start,
    row_end: area.row_end,
    column_end: area.column_end,
  };
}
