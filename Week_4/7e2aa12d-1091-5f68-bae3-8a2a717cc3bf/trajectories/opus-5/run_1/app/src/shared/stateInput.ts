import { checkAreaName } from './area.js';
import { rectsOverlap, sortAreas } from './grid.js';
import {
  BREAKPOINT_RANGE_MESSAGE,
  GAP_MESSAGE,
  MIN_COLUMNS_MESSAGE,
  MIN_ROWS_MESSAGE,
  duplicateBreakpointMessage,
  maxBreakpointsMessage,
  maxColumnsMessage,
  maxRowsMessage,
  noTrackMessage,
  overlapMessage,
} from './messages.js';
import { checkTrackSize } from './trackSize.js';
import type { Area, Breakpoint, Gap, LayoutState, Limits } from './types.js';

export type StateInputResult = { ok: true; state: LayoutState } | { ok: false; message: string };

function readTracks(
  raw: unknown,
  axis: 'columns' | 'rows',
  limits: Limits,
): { ok: true; sizes: string[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: axis === 'columns' ? MIN_COLUMNS_MESSAGE : MIN_ROWS_MESSAGE };
  if (raw.length < 1) {
    return { ok: false, message: axis === 'columns' ? MIN_COLUMNS_MESSAGE : MIN_ROWS_MESSAGE };
  }
  if (raw.length > limits.maxTracks) {
    return {
      ok: false,
      message: axis === 'columns' ? maxColumnsMessage(limits.maxTracks) : maxRowsMessage(limits.maxTracks),
    };
  }
  const sizes: string[] = [];
  for (const item of raw) {
    const check = checkTrackSize(typeof item === 'string' ? item : '');
    if (!check.ok) return { ok: false, message: check.message };
    sizes.push(check.canonical);
  }
  return { ok: true, sizes };
}

function readGap(raw: unknown): { ok: true; gap: Gap } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, message: GAP_MESSAGE };
  const value = raw as Record<string, unknown>;
  const row = value['row'];
  const column = value['column'];
  const bad = [row, column].some(
    (item) => typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 200,
  );
  if (bad) return { ok: false, message: GAP_MESSAGE };
  return { ok: true, gap: { row: row as number, column: column as number } };
}

function readAreas(
  raw: unknown,
  columns: number,
  rows: number,
): { ok: true; areas: Area[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: true, areas: [] };
  const areas: Area[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, message: 'The request body is not valid.' };
    }
    const value = item as Record<string, unknown>;
    const name = value['name'];
    const nameProblem = checkAreaName(typeof name === 'string' ? name : '');
    if (nameProblem) return { ok: false, message: nameProblem };
    const numbers = ['row_start', 'column_start', 'row_end', 'column_end'].map((key) => value[key]);
    if (numbers.some((number) => typeof number !== 'number' || !Number.isInteger(number))) {
      return { ok: false, message: 'The request body is not valid.' };
    }
    const area: Area = {
      name: name as string,
      row_start: numbers[0] as number,
      column_start: numbers[1] as number,
      row_end: numbers[2] as number,
      column_end: numbers[3] as number,
    };
    if (area.row_end <= area.row_start || area.row_start < 1 || area.row_end - 1 > rows) {
      return { ok: false, message: noTrackMessage('row', area.row_end - 1) };
    }
    if (area.column_end <= area.column_start || area.column_start < 1 || area.column_end - 1 > columns) {
      return { ok: false, message: noTrackMessage('column', area.column_end - 1) };
    }
    for (const placed of areas) {
      if (rectsOverlap(placed, area)) {
        return { ok: false, message: overlapMessage(area.name, placed.name) };
      }
    }
    areas.push(area);
  }
  return { ok: true, areas: sortAreas(areas) };
}

/** Reads a layout's tracks, gaps, areas and breakpoints from a request, with the editor's rules. */
export function readLayoutState(raw: Record<string, unknown>, limits: Limits): StateInputResult {
  const columns = readTracks(raw['columns'], 'columns', limits);
  if (!columns.ok) return columns;
  const rows = readTracks(raw['rows'], 'rows', limits);
  if (!rows.ok) return rows;
  const gap = readGap(raw['gap']);
  if (!gap.ok) return gap;
  const areas = readAreas(raw['areas'], columns.sizes.length, rows.sizes.length);
  if (!areas.ok) return areas;

  const breakpoints: Breakpoint[] = [];
  const rawBreakpoints = Array.isArray(raw['breakpoints']) ? (raw['breakpoints'] as unknown[]) : [];
  if (rawBreakpoints.length > limits.maxBreakpoints) {
    return { ok: false, message: maxBreakpointsMessage(limits.maxBreakpoints) };
  }
  for (const item of rawBreakpoints) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, message: 'The request body is not valid.' };
    }
    const value = item as Record<string, unknown>;
    const minWidth = value['min_width'];
    if (typeof minWidth !== 'number' || !Number.isInteger(minWidth) || minWidth < 400 || minWidth > 1440) {
      return { ok: false, message: BREAKPOINT_RANGE_MESSAGE };
    }
    if (breakpoints.some((breakpoint) => breakpoint.min_width === minWidth)) {
      return { ok: false, message: duplicateBreakpointMessage(minWidth) };
    }
    const breakpointColumns = readTracks(value['columns'], 'columns', limits);
    if (!breakpointColumns.ok) return breakpointColumns;
    const breakpointRows = readTracks(value['rows'], 'rows', limits);
    if (!breakpointRows.ok) return breakpointRows;
    const breakpointAreas = readAreas(
      value['areas'],
      breakpointColumns.sizes.length,
      breakpointRows.sizes.length,
    );
    if (!breakpointAreas.ok) return breakpointAreas;
    let breakpointGap: Gap | null = null;
    if (value['gap'] !== null && value['gap'] !== undefined) {
      const parsed = readGap(value['gap']);
      if (!parsed.ok) return parsed;
      breakpointGap = parsed.gap;
    }
    breakpoints.push({
      min_width: minWidth,
      columns: breakpointColumns.sizes,
      rows: breakpointRows.sizes,
      areas: breakpointAreas.areas,
      gap: breakpointGap,
    });
  }

  return {
    ok: true,
    state: {
      columns: columns.sizes,
      rows: rows.sizes,
      gap: gap.gap,
      areas: areas.areas,
      breakpoints: breakpoints.sort((a, b) => a.min_width - b.min_width),
    },
  };
}
