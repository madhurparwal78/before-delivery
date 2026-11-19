import { checkAreaName, decideClearCells, decideSetArea } from './area.js';
import {
  addTrack,
  cloneState,
  getScopeGrid,
  nextNarrowerScope,
  normaliseRect,
  ownGap,
  rectsOverlap,
  removeTrack,
  sortAreas,
  sortedBreakpoints,
  withScopeGrid,
} from './grid.js';
import {
  BREAKPOINT_RANGE_MESSAGE,
  GAP_MESSAGE,
  MIN_COLUMNS_MESSAGE,
  MIN_ROWS_MESSAGE,
  UNKNOWN_CHANGE_MESSAGE,
  duplicateBreakpointMessage,
  maxBreakpointsMessage,
  maxColumnsMessage,
  maxRowsMessage,
  nameUsedMessage,
  noAreaMessage,
  noBreakpointMessage,
  noTrackMessage,
  noVersionMessage,
} from './messages.js';
import { cssToLayout } from './parseCss.js';
import { checkTrackSize } from './trackSize.js';
import type { Area, Axis, Change, LayoutState, Limits, Rect, Scope } from './types.js';

export type ParsedChange =
  | { ok: true; change: Change }
  | { ok: false; reason: 'body' | 'unknown-kind' };

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isScope(value: unknown): value is Scope {
  return value === 'base' || isWholeNumber(value);
}

function isAxis(value: unknown): value is Axis {
  return value === 'column' || value === 'row';
}

function isRect(raw: Record<string, unknown>): boolean {
  return (
    isWholeNumber(raw['row_start']) &&
    isWholeNumber(raw['column_start']) &&
    isWholeNumber(raw['row_end']) &&
    isWholeNumber(raw['column_end'])
  );
}

/** Structural check of the change object; a wrong shape is an invalid request body. */
export function parseChange(raw: unknown): ParsedChange {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'body' };
  const value = raw as Record<string, unknown>;
  const kind = value['kind'];
  if (typeof kind !== 'string') return { ok: false, reason: 'body' };
  switch (kind) {
    case 'set_track':
      if (!isScope(value['scope']) || !isAxis(value['axis']) || !isWholeNumber(value['index']) || typeof value['size'] !== 'string') {
        return { ok: false, reason: 'body' };
      }
      return { ok: true, change: { kind, scope: value['scope'], axis: value['axis'], index: value['index'], size: value['size'] } };
    case 'add_track':
      if (!isScope(value['scope']) || !isAxis(value['axis']) || !isWholeNumber(value['after'])) return { ok: false, reason: 'body' };
      return { ok: true, change: { kind, scope: value['scope'], axis: value['axis'], after: value['after'] } };
    case 'remove_track':
      if (!isScope(value['scope']) || !isAxis(value['axis']) || !isWholeNumber(value['index'])) return { ok: false, reason: 'body' };
      return { ok: true, change: { kind, scope: value['scope'], axis: value['axis'], index: value['index'] } };
    case 'set_gap':
      if (!isScope(value['scope']) || typeof value['row'] !== 'number' || typeof value['column'] !== 'number') {
        return { ok: false, reason: 'body' };
      }
      return { ok: true, change: { kind, scope: value['scope'], row: value['row'], column: value['column'] } };
    case 'set_area':
      if (!isScope(value['scope']) || typeof value['name'] !== 'string' || !isRect(value)) return { ok: false, reason: 'body' };
      return {
        ok: true,
        change: {
          kind,
          scope: value['scope'],
          name: value['name'],
          row_start: value['row_start'] as number,
          column_start: value['column_start'] as number,
          row_end: value['row_end'] as number,
          column_end: value['column_end'] as number,
        },
      };
    case 'rename_area':
      if (typeof value['name'] !== 'string' || typeof value['new_name'] !== 'string') return { ok: false, reason: 'body' };
      return { ok: true, change: { kind, name: value['name'], new_name: value['new_name'] } };
    case 'clear_cells':
      if (!isScope(value['scope']) || !isRect(value)) return { ok: false, reason: 'body' };
      return {
        ok: true,
        change: {
          kind,
          scope: value['scope'],
          row_start: value['row_start'] as number,
          column_start: value['column_start'] as number,
          row_end: value['row_end'] as number,
          column_end: value['column_end'] as number,
        },
      };
    case 'add_breakpoint':
    case 'remove_breakpoint':
      if (typeof value['min_width'] !== 'number') return { ok: false, reason: 'body' };
      return { ok: true, change: { kind, min_width: value['min_width'] } };
    case 'apply_css':
      if (typeof value['css'] !== 'string') return { ok: false, reason: 'body' };
      return { ok: true, change: { kind, css: value['css'] } };
    case 'restore_version':
      if (typeof value['number'] !== 'number') return { ok: false, reason: 'body' };
      return { ok: true, change: { kind, number: value['number'] } };
    case 'undo':
    case 'redo':
      return { ok: true, change: { kind } };
    default:
      return { ok: false, reason: 'unknown-kind' };
  }
}

/** The request's own form and values, checked before conflicts. */
export function checkChangeValues(change: Change, limits: Limits): string | null {
  switch (change.kind) {
    case 'set_track': {
      const check = checkTrackSize(change.size);
      return check.ok ? null : check.message;
    }
    case 'set_gap': {
      const bad = [change.row, change.column].some(
        (value) => !Number.isInteger(value) || value < 0 || value > 200,
      );
      return bad ? GAP_MESSAGE : null;
    }
    case 'set_area':
      return checkAreaName(change.name);
    case 'rename_area':
      return checkAreaName(change.new_name);
    case 'add_breakpoint':
      if (!Number.isInteger(change.min_width) || change.min_width < 400 || change.min_width > 1440) {
        return BREAKPOINT_RANGE_MESSAGE;
      }
      return null;
    case 'remove_breakpoint':
      return Number.isInteger(change.min_width) ? null : BREAKPOINT_RANGE_MESSAGE;
    case 'apply_css': {
      const parsed = cssToLayout(change.css, limits);
      return parsed.ok ? null : parsed.message;
    }
    case 'restore_version':
      return Number.isInteger(change.number) ? null : noVersionMessage(change.number);
    case 'add_track':
    case 'remove_track':
    case 'clear_cells':
    case 'undo':
    case 'redo':
      return null;
  }
}

export interface ChangeContext {
  limits: Limits;
  version: (number: number) => LayoutState | null;
}

export type ApplyResult = { ok: true; state: LayoutState } | { ok: false; message: string };

function requireScope(state: LayoutState, scope: Scope): ApplyResult | null {
  if (scope === 'base') return null;
  if (!state.breakpoints.some((item) => item.min_width === scope)) {
    return { ok: false, message: noBreakpointMessage(scope) };
  }
  return null;
}

function trackCount(state: LayoutState, scope: Scope, axis: Axis): number {
  const grid = getScopeGrid(state, scope);
  if (!grid) return 0;
  return axis === 'column' ? grid.columns.length : grid.rows.length;
}

function rectInside(state: LayoutState, scope: Scope, rect: Rect): string | null {
  const grid = getScopeGrid(state, scope);
  if (!grid) return null;
  if (rect.column_start < 1) return noTrackMessage('column', rect.column_start);
  if (rect.row_start < 1) return noTrackMessage('row', rect.row_start);
  if (rect.column_end - 1 > grid.columns.length) return noTrackMessage('column', rect.column_end - 1);
  if (rect.row_end - 1 > grid.rows.length) return noTrackMessage('row', rect.row_end - 1);
  return null;
}

function setBreakpointGap(state: LayoutState, scope: Scope, gap: { row: number; column: number } | null): LayoutState {
  const next = cloneState(state);
  if (scope === 'base') {
    if (gap) next.gap = { ...gap };
    return next;
  }
  const breakpoint = next.breakpoints.find((item) => item.min_width === scope);
  if (breakpoint) breakpoint.gap = gap ? { ...gap } : null;
  return next;
}

/** Applies a change to a layout, checking the rules that depend on the current layout. */
export function applyChange(change: Change, state: LayoutState, context: ChangeContext): ApplyResult {
  const { limits } = context;
  switch (change.kind) {
    case 'set_track': {
      const missing = requireScope(state, change.scope);
      if (missing) return missing;
      const count = trackCount(state, change.scope, change.axis);
      if (change.index < 1 || change.index > count) {
        return { ok: false, message: noTrackMessage(change.axis, change.index) };
      }
      const grid = getScopeGrid(state, change.scope) as NonNullable<ReturnType<typeof getScopeGrid>>;
      const size = (checkTrackSize(change.size) as { ok: true; canonical: string }).canonical;
      const columns = [...grid.columns];
      const rows = [...grid.rows];
      if (change.axis === 'column') columns[change.index - 1] = size;
      else rows[change.index - 1] = size;
      return { ok: true, state: withScopeGrid(state, change.scope, { columns, rows, areas: grid.areas }) };
    }
    case 'add_track': {
      const missing = requireScope(state, change.scope);
      if (missing) return missing;
      const count = trackCount(state, change.scope, change.axis);
      if (change.after < 1 || change.after > count) {
        return { ok: false, message: noTrackMessage(change.axis, change.after) };
      }
      if (count + 1 > limits.maxTracks) {
        return {
          ok: false,
          message: change.axis === 'column' ? maxColumnsMessage(limits.maxTracks) : maxRowsMessage(limits.maxTracks),
        };
      }
      const grid = getScopeGrid(state, change.scope) as NonNullable<ReturnType<typeof getScopeGrid>>;
      return { ok: true, state: withScopeGrid(state, change.scope, addTrack(grid, change.axis, change.after)) };
    }
    case 'remove_track': {
      const missing = requireScope(state, change.scope);
      if (missing) return missing;
      const count = trackCount(state, change.scope, change.axis);
      if (change.index < 1 || change.index > count) {
        return { ok: false, message: noTrackMessage(change.axis, change.index) };
      }
      if (count - 1 < 1) {
        return { ok: false, message: change.axis === 'column' ? MIN_COLUMNS_MESSAGE : MIN_ROWS_MESSAGE };
      }
      const grid = getScopeGrid(state, change.scope) as NonNullable<ReturnType<typeof getScopeGrid>>;
      return {
        ok: true,
        state: withScopeGrid(state, change.scope, removeTrack(grid, change.axis, change.index).grid),
      };
    }
    case 'set_gap': {
      const missing = requireScope(state, change.scope);
      if (missing) return missing;
      return { ok: true, state: setBreakpointGap(state, change.scope, { row: change.row, column: change.column }) };
    }
    case 'set_area': {
      const missing = requireScope(state, change.scope);
      if (missing) return missing;
      const rect = normaliseRect(change);
      const outside = rectInside(state, change.scope, rect);
      if (outside) return { ok: false, message: outside };
      const grid = getScopeGrid(state, change.scope) as NonNullable<ReturnType<typeof getScopeGrid>>;
      const outcome = decideSetArea(state, grid, change.name, rect);
      if (outcome.kind === 'error') return { ok: false, message: outcome.message };
      if (outcome.kind === 'none') return { ok: true, state: cloneState(state) };
      if (outcome.kind === 'rename') {
        return { ok: true, state: renameEverywhere(state, outcome.previousName, change.name) };
      }
      return { ok: true, state: withScopeGrid(state, change.scope, { ...grid, areas: outcome.areas }) };
    }
    case 'rename_area': {
      const names = new Set<string>();
      for (const area of state.areas) names.add(area.name);
      for (const breakpoint of state.breakpoints) for (const area of breakpoint.areas) names.add(area.name);
      if (!names.has(change.name)) return { ok: false, message: noAreaMessage(change.name) };
      if (change.new_name !== change.name && names.has(change.new_name)) {
        return { ok: false, message: nameUsedMessage(change.new_name) };
      }
      return { ok: true, state: renameEverywhere(state, change.name, change.new_name) };
    }
    case 'clear_cells': {
      const missing = requireScope(state, change.scope);
      if (missing) return missing;
      const rect = normaliseRect(change);
      const outside = rectInside(state, change.scope, rect);
      if (outside) return { ok: false, message: outside };
      const grid = getScopeGrid(state, change.scope) as NonNullable<ReturnType<typeof getScopeGrid>>;
      const outcome = decideClearCells(grid, rect);
      if (outcome.kind === 'error') return { ok: false, message: outcome.message };
      return { ok: true, state: withScopeGrid(state, change.scope, { ...grid, areas: outcome.areas }) };
    }
    case 'add_breakpoint': {
      if (state.breakpoints.some((item) => item.min_width === change.min_width)) {
        return { ok: false, message: duplicateBreakpointMessage(change.min_width) };
      }
      if (state.breakpoints.length + 1 > limits.maxBreakpoints) {
        return { ok: false, message: maxBreakpointsMessage(limits.maxBreakpoints) };
      }
      const source = nextNarrowerScope(state, change.min_width);
      const grid = getScopeGrid(state, source) as NonNullable<ReturnType<typeof getScopeGrid>>;
      const next = cloneState(state);
      next.breakpoints.push({
        min_width: change.min_width,
        columns: [...grid.columns],
        rows: [...grid.rows],
        areas: sortAreas(grid.areas),
        gap: null,
      });
      next.breakpoints = sortedBreakpoints(next);
      return { ok: true, state: next };
    }
    case 'remove_breakpoint': {
      if (!state.breakpoints.some((item) => item.min_width === change.min_width)) {
        return { ok: false, message: noBreakpointMessage(change.min_width) };
      }
      const next = cloneState(state);
      next.breakpoints = next.breakpoints.filter((item) => item.min_width !== change.min_width);
      return { ok: true, state: next };
    }
    case 'apply_css': {
      const parsed = cssToLayout(change.css, limits);
      if (!parsed.ok) return { ok: false, message: parsed.message };
      return { ok: true, state: parsed.state };
    }
    case 'restore_version': {
      const version = context.version(change.number);
      if (!version) return { ok: false, message: noVersionMessage(change.number) };
      return { ok: true, state: cloneState(version) };
    }
    case 'undo':
    case 'redo':
      return { ok: false, message: UNKNOWN_CHANGE_MESSAGE };
  }
}

export function renameEverywhere(state: LayoutState, from: string, to: string): LayoutState {
  const next = cloneState(state);
  for (const area of next.areas) if (area.name === from) area.name = to;
  for (const breakpoint of next.breakpoints) {
    for (const area of breakpoint.areas) if (area.name === from) area.name = to;
  }
  return next;
}

function scopeAreas(state: LayoutState, scope: Scope): Area[] {
  const grid = getScopeGrid(state, scope);
  return grid ? grid.areas : [];
}

function restoreAreaNames(
  state: LayoutState,
  scope: Scope,
  before: LayoutState,
  names: Set<string>,
): LayoutState {
  const grid = getScopeGrid(state, scope);
  if (!grid) return cloneState(state);
  const kept = grid.areas.filter((area) => !names.has(area.name));
  const restored = scopeAreas(before, scope).filter((area) => names.has(area.name));
  return withScopeGrid(state, scope, { ...grid, areas: sortAreas([...kept, ...restored]) });
}

function restoreScope(state: LayoutState, scope: Scope, before: LayoutState): LayoutState {
  const grid = getScopeGrid(before, scope);
  if (!grid) return cloneState(state);
  return withScopeGrid(state, scope, { columns: [...grid.columns], rows: [...grid.rows], areas: sortAreas(grid.areas) });
}

/**
 * Puts back what a change replaced: the track size, the gaps, the areas it touched,
 * or the whole scope or layout.
 */
export function invertChange(original: Change, before: LayoutState, current: LayoutState): LayoutState {
  switch (original.kind) {
    case 'set_track': {
      const grid = getScopeGrid(before, original.scope);
      const live = getScopeGrid(current, original.scope);
      if (!grid || !live) return cloneState(before);
      const size =
        original.axis === 'column' ? grid.columns[original.index - 1] : grid.rows[original.index - 1];
      if (size === undefined) return cloneState(current);
      const columns = [...live.columns];
      const rows = [...live.rows];
      if (original.axis === 'column') columns[original.index - 1] = size;
      else rows[original.index - 1] = size;
      return withScopeGrid(current, original.scope, { columns, rows, areas: live.areas });
    }
    case 'set_gap':
      return setBreakpointGap(current, original.scope, ownGap(before, original.scope));
    case 'add_track':
    case 'remove_track':
      return restoreScope(current, original.scope, before);
    case 'set_area': {
      const rect = normaliseRect(original);
      const grid = getScopeGrid(before, original.scope);
      if (!grid) return cloneState(before);
      const outcome = decideSetArea(before, grid, original.name, rect);
      if (outcome.kind === 'rename') return renameEverywhere(current, original.name, outcome.previousName);
      return restoreAreaNames(current, original.scope, before, new Set([original.name]));
    }
    case 'clear_cells': {
      const rect = normaliseRect(original);
      const names = new Set(
        scopeAreas(before, original.scope)
          .filter((area) => rectsOverlap(area, rect))
          .map((area) => area.name),
      );
      return restoreAreaNames(current, original.scope, before, names);
    }
    case 'rename_area':
      return renameEverywhere(current, original.new_name, original.name);
    default:
      return cloneState(before);
  }
}
