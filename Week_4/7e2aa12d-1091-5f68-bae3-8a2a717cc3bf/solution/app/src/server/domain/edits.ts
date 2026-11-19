import { areaOrder, cellsOf, firstOverlap, gapIn, rectOf, rectangleOf, sameRect, sortAreas, sortBreakpoints, tracksOf } from '../../shared/grid.js';
import {
  INVALID_BODY_MESSAGE,
  areaCreated,
  areaExtended,
  areaRemoved,
  areaRenamed,
  areasAdded,
  areasRemoved,
  breakpointAdded,
  breakpointRemoved,
  CELLS_CLEARED,
  CSS_APPLIED,
  gapSet,
  nameUsed,
  noArea,
  noTrack,
  notRectangle,
  overlap,
  trackAdded,
  trackRemoved,
  trackSet,
  versionRestored,
} from '../../shared/messages.js';
import { checkBreakpointAdd, checkTrackCount } from '../../shared/rules.js';
import type { Area, Axis, Grid, LayoutState, Rect } from '../../shared/types.js';
import type { Limits } from '../config.js';
import { gridPatch, needGrid, renameEverywhere, type Patch } from './patch.js';
import type { PreparedChange } from './prepare.js';
import { Refusal } from './refusal.js';

export interface Edit {
  state: LayoutState;
  announcement: string;
  inverse: Patch;
  /** How a conflict notice names what the change touched. */
  label: string;
  restored: number | null;
}

type Of<K extends PreparedChange['kind']> = Extract<PreparedChange, { kind: K }>;

/** A change that edits the layout directly: everything but undo, redo and restore (which need history or a saved version). */
type DirectChange = Exclude<PreparedChange, { kind: 'undo' | 'redo' | 'restore_version' }>;

const done = (state: LayoutState, announcement: string, inverse: Patch, label: string): Edit => ({ state, announcement, inverse, label, restored: null });

function checkRect(grid: Grid, rect: Rect): void {
  if (rect.row_end > grid.rows.length + 1 || rect.column_end > grid.columns.length + 1) throw new Refusal(INVALID_BODY_MESSAGE);
}

const removalsAnnouncement = (before: LayoutState, removed: Set<string>): string =>
  areaOrder(before)
    .filter((name) => removed.has(name))
    .map(areaRemoved)
    .join('');

const spanOf = (axis: Axis) => (axis === 'column' ? (['column_start', 'column_end'] as const) : (['row_start', 'row_end'] as const));

/** A column or row inserted after `after` joins every area that spans both neighbouring tracks. */
function insertTrack(grid: Grid, axis: Axis, after: number): void {
  tracksOf(grid, axis).splice(after, 0, '1fr');
  const [start, end] = spanOf(axis);
  for (const area of grid.areas) {
    if (area[start] > after) {
      area[start] += 1;
      area[end] += 1;
    } else if (area[end] > after + 1) {
      area[end] += 1;
    }
  }
}

/** Remove a track; every area loses its cells there, and an area left with none is removed. Returns the removed names. */
function deleteTrack(grid: Grid, axis: Axis, index: number): Set<string> {
  tracksOf(grid, axis).splice(index - 1, 1);
  const [start, end] = spanOf(axis);
  const removed = new Set<string>();
  for (const area of grid.areas) {
    if (area[end] <= index) continue;
    if (area[start] > index) {
      area[start] -= 1;
      area[end] -= 1;
    } else if (area[end] - area[start] === 1) {
      removed.add(area.name);
    } else {
      area[end] -= 1;
    }
  }
  grid.areas = grid.areas.filter((area) => !removed.has(area.name));
  return removed;
}

function setTrack(state: LayoutState, c: Of<'set_track'>): Edit {
  const list = tracksOf(needGrid(state, c.scope), c.axis);
  if (c.index < 1 || c.index > list.length) throw new Refusal(noTrack(c.axis, c.index));
  const inverse: Patch = { op: 'track', scope: c.scope, axis: c.axis, index: c.index, size: list[c.index - 1] };
  list[c.index - 1] = c.size;
  return done(state, trackSet(c.axis, c.index, c.size), inverse, `${c.axis} ${c.index}`);
}

function addTrack(state: LayoutState, c: Of<'add_track'>, limits: Limits): Edit {
  const grid = needGrid(state, c.scope);
  const list = tracksOf(grid, c.axis);
  if (c.after < 1 || c.after > list.length) throw new Refusal(noTrack(c.axis, c.after));
  const refusal = checkTrackCount(c.axis, list.length + 1, limits.maxTracks);
  if (refusal) throw new Refusal(refusal);
  const inverse = gridPatch(c.scope, grid);
  insertTrack(grid, c.axis, c.after);
  return done(state, trackAdded(c.axis, c.after), inverse, 'the layout');
}

function removeTrack(state: LayoutState, before: LayoutState, c: Of<'remove_track'>, limits: Limits): Edit {
  const grid = needGrid(state, c.scope);
  const list = tracksOf(grid, c.axis);
  if (c.index < 1 || c.index > list.length) throw new Refusal(noTrack(c.axis, c.index));
  const refusal = checkTrackCount(c.axis, list.length - 1, limits.maxTracks);
  if (refusal) throw new Refusal(refusal);
  const inverse = gridPatch(c.scope, grid);
  const removed = deleteTrack(grid, c.axis, c.index);
  return done(state, trackRemoved(c.axis, c.index) + removalsAnnouncement(before, removed), inverse, 'the layout');
}

function setGap(state: LayoutState, c: Of<'set_gap'>): Edit {
  const holder: { gap: { row: number; column: number } | null } = needGrid(state, c.scope);
  const before = gapIn(state, c.scope).gap;
  const inverse: Patch = { op: 'gap', scope: c.scope, gap: holder.gap && { ...holder.gap } };
  holder.gap = { row: c.row, column: c.column };
  const parts = [c.row !== before.row ? gapSet('row', c.row) : '', c.column !== before.column ? gapSet('column', c.column) : ''].filter(Boolean);
  return done(state, (parts.length ? parts : [gapSet('row', c.row), gapSet('column', c.column)]).join(' '), inverse, 'the gaps');
}

const usedAnywhere = (state: LayoutState, name: string): boolean => areaOrder(state).includes(name);

function setArea(state: LayoutState, c: Of<'set_area'>): Edit {
  const grid = needGrid(state, c.scope);
  const selection = rectOf(c);
  checkRect(grid, selection);
  const label = `area ${c.name}`;
  const exact = grid.areas.find((area) => sameRect(area, selection));
  if (exact && !usedAnywhere(state, c.name)) {
    const from = exact.name;
    renameEverywhere(state, from, c.name);
    return done(state, areaRenamed(from, c.name), { op: 'rename', from: c.name, to: from }, label);
  }
  const blocker = firstOverlap(grid.areas, c.name, selection);
  if (blocker) throw new Refusal(overlap(c.name, blocker.name));
  const placed = grid.areas.find((area) => area.name === c.name);
  const inverse: Patch = { op: 'areas', scope: c.scope, names: [c.name], areas: placed ? [structuredClone(placed)] : [] };
  if (placed) {
    const union = rectangleOf(new Set([...cellsOf(placed), ...cellsOf(selection)]));
    if (!union) throw new Refusal(notRectangle(c.name));
    Object.assign(placed, union);
    grid.areas = sortAreas(grid.areas);
    return done(state, areaExtended(c.name), inverse, label);
  }
  grid.areas = sortAreas([...grid.areas, { name: c.name, ...selection }]);
  return done(state, areaCreated(c.name), inverse, label);
}

function renameArea(state: LayoutState, c: Of<'rename_area'>): Edit {
  if (!usedAnywhere(state, c.name)) throw new Refusal(noArea(c.name));
  if (usedAnywhere(state, c.new_name)) throw new Refusal(nameUsed(c.new_name));
  renameEverywhere(state, c.name, c.new_name);
  return done(state, areaRenamed(c.name, c.new_name), { op: 'rename', from: c.new_name, to: c.name }, `area ${c.name}`);
}

function clearCells(state: LayoutState, before: LayoutState, c: Of<'clear_cells'>): Edit {
  const grid = needGrid(state, c.scope);
  const selection = rectOf(c);
  checkRect(grid, selection);
  const cleared = new Set(cellsOf(selection));
  const touched: Area[] = [];
  const removed = new Set<string>();
  const kept: Area[] = [];
  for (const area of sortAreas(grid.areas)) {
    const cells = cellsOf(area);
    const remaining = new Set(cells.filter((cell) => !cleared.has(cell)));
    if (remaining.size === cells.length) {
      kept.push(area);
      continue;
    }
    touched.push(structuredClone(area));
    if (remaining.size === 0) {
      removed.add(area.name);
      continue;
    }
    const rect = rectangleOf(remaining);
    if (!rect) throw new Refusal(notRectangle(area.name));
    kept.push({ name: area.name, ...rect });
  }
  const inverse: Patch = { op: 'areas', scope: c.scope, names: touched.map((area) => area.name), areas: touched };
  grid.areas = sortAreas(kept);
  return done(state, CELLS_CLEARED + removalsAnnouncement(before, removed), inverse, touched.length ? `area ${touched[0].name}` : 'the layout');
}

function addBreakpoint(state: LayoutState, c: Of<'add_breakpoint'>, limits: Limits): Edit {
  const refusal = checkBreakpointAdd(state.breakpoints.map((breakpoint) => breakpoint.min_width), c.min_width, limits.maxBreakpoints);
  if (refusal) throw new Refusal(refusal);
  let below: Grid = state;
  for (const breakpoint of state.breakpoints) if (breakpoint.min_width < c.min_width) below = breakpoint;
  const inverse: Patch = { op: 'layout', state: structuredClone(state) };
  state.breakpoints = sortBreakpoints([
    ...state.breakpoints,
    { min_width: c.min_width, columns: [...below.columns], rows: [...below.rows], areas: structuredClone(below.areas), gap: null },
  ]);
  return done(state, breakpointAdded(c.min_width), inverse, 'the layout');
}

function removeBreakpoint(state: LayoutState, c: Of<'remove_breakpoint'>): Edit {
  needGrid(state, c.min_width);
  const inverse: Patch = { op: 'layout', state: structuredClone(state) };
  state.breakpoints = state.breakpoints.filter((breakpoint) => breakpoint.min_width !== c.min_width);
  return done(state, breakpointRemoved(c.min_width), inverse, 'the layout');
}

/** CSS applied: the layout becomes the CSS's state; areas are matched by name. */
function applyCss(before: LayoutState, c: Of<'apply_css'>): Edit {
  const was = areaOrder(before);
  const now = areaOrder(c.state);
  const added = now.filter((name) => !was.includes(name));
  const removed = was.filter((name) => !now.includes(name));
  const announcement = CSS_APPLIED + (added.length ? areasAdded(added) : '') + (removed.length ? areasRemoved(removed) : '');
  return done(structuredClone(c.state), announcement, { op: 'layout', state: structuredClone(before) }, 'the layout');
}

/** Apply one change that edits the layout directly. Rules checked against the layout throw `Refusal`. */
export function applyChange(before: LayoutState, change: DirectChange, limits: Limits): Edit {
  const state = structuredClone(before);
  switch (change.kind) {
    case 'set_track':
      return setTrack(state, change);
    case 'add_track':
      return addTrack(state, change, limits);
    case 'remove_track':
      return removeTrack(state, before, change, limits);
    case 'set_gap':
      return setGap(state, change);
    case 'set_area':
      return setArea(state, change);
    case 'rename_area':
      return renameArea(state, change);
    case 'clear_cells':
      return clearCells(state, before, change);
    case 'add_breakpoint':
      return addBreakpoint(state, change, limits);
    case 'remove_breakpoint':
      return removeBreakpoint(state, change);
    case 'apply_css':
      return applyCss(before, change);
  }
}

/** Restoring version `number` replaces the whole layout with the saved state. */
export function restoreVersion(before: LayoutState, number: number, saved: LayoutState): Edit {
  return { state: structuredClone(saved), announcement: versionRestored(number), inverse: { op: 'layout', state: structuredClone(before) }, label: 'the layout', restored: number };
}
