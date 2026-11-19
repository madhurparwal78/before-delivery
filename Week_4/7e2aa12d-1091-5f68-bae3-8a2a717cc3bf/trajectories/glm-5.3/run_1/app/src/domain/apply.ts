// The one place that decides how one change edits a layout, and what it announces.
import type { AreaLine, Gap, LayoutData, ScopeName } from './layout.js';
import { areaNameError, sortAreas } from './areas.js';
import { readTrackSize } from './sizes.js';

export interface Limits { maxTracks: number; maxBreakpoints: number }

export class Refusal extends Error {}

export const MESSAGES = {
  unknownChange: 'Unknown change.',
  noBreakpoint: (n: number) => `There is no breakpoint at ${n}px.`,
  noColumn: (n: number) => `There is no column ${n}.`,
  noRow: (n: number) => `There is no row ${n}.`,
  maxColumns: (n: number) => `A layout can have at most ${n} columns.`,
  maxRows: (n: number) => `A layout can have at most ${n} rows.`,
  minColumn: 'A layout needs at least one column.',
  minRow: 'A layout needs at least one row.',
  gaps: 'Gaps are whole pixels from 0 to 200.',
  maxBreakpoints: (n: number) => `A layout can have at most ${n} breakpoints.`,
  breakpointRange: 'Breakpoints start between 400px and 1440px.',
  breakpointExists: (n: number) => `There is already a breakpoint at ${n}px.`,
};

/** The scope's own containers, so edits write back into the layout. */
export function scopeRef(layout: LayoutData, scope: ScopeName): { columns: string[]; rows: string[]; areas: AreaLine[]; setGap(gap: Gap): void; gap: Gap } {
  if (scope === 'base') {
    return {
      columns: layout.columns,
      rows: layout.rows,
      areas: layout.areas,
      gap: layout.gap,
      setGap(gap: Gap) { layout.gap = gap; },
    };
  }
  const bp = layout.breakpoints.find((b) => b.min_width === scope);
  if (!bp) throw new Refusal(MESSAGES.noBreakpoint(scope));
  return {
    columns: bp.columns,
    rows: bp.rows,
    areas: bp.areas,
    gap: bp.gap ?? inheritedGap(layout, scope),
    setGap(gap: Gap) { bp.gap = gap; },
  };
}

export function inheritedGap(layout: LayoutData, minWidth: number): { row: number; column: number } {
  let gap = layout.gap;
  for (const bp of layout.breakpoints) {
    if (bp.min_width < minWidth && bp.gap) gap = bp.gap;
  }
  return gap;
}

/** The grid in effect just below a width: the base, or the nearest breakpoint under it. */
function scopeBelow(layout: LayoutData, width: number): { columns: string[]; rows: string[]; areas: AreaLine[]; gap: { row: number; column: number } } {
  let current = { columns: layout.columns, rows: layout.rows, areas: layout.areas, gap: layout.gap };
  for (const bp of layout.breakpoints) {
    if (bp.min_width < width) current = { columns: bp.columns, rows: bp.rows, areas: bp.areas, gap: bp.gap ?? current.gap };
  }
  return current;
}

export type Announced =
  | { kind: 'track_size'; axis: 'column' | 'row'; index: number; size: string }
  | { kind: 'track_added'; axis: 'column' | 'row'; after: number }
  | { kind: 'track_removed'; axis: 'column' | 'row'; index: number; removedAreas: string[] }
  | { kind: 'gap'; axis: 'row' | 'column'; value: number }
  | { kind: 'area'; name: string; verb: 'created' | 'extended' | 'renamed'; old?: string }
  | { kind: 'cleared'; removedAreas: string[] }
  | { kind: 'breakpoint_added'; minWidth: number }
  | { kind: 'breakpoint_removed'; minWidth: number }
  | { kind: 'css'; added: string[]; removed: string[] }
  | { kind: 'restored'; number: number }
  | { kind: 'undo' }
  | { kind: 'none' };

export interface EditOutcome {
  layout: LayoutData;
  announced: Announced;
}

function setTrackSize(layout: LayoutData, scope: ScopeName, axis: 'column' | 'row', index: number, size: string, limits: Limits): EditOutcome {
  const sc = scopeRef(layout, scope);
  const tracks = axis === 'column' ? sc.columns : sc.rows;
  if (!Number.isInteger(index) || index < 1 || index > tracks.length) {
    throw new Refusal(axis === 'column' ? MESSAGES.noColumn(index) : MESSAGES.noRow(index));
  }
  const { size: canonical, error } = readTrackSize(size);
  if (error) throw new Refusal(error);
  if (canonical === tracks[index - 1]) return { layout, announced: { kind: 'none' } };
  const next: LayoutData = structuredCloneLayout(layout);
  const nextScope = scopeRef(next, scope);
  const list = axis === 'column' ? nextScope.columns : nextScope.rows;
  list[index - 1] = canonical!;
  return { layout: next, announced: { kind: 'track_size', axis, index, size: canonical! } };
}

function addTrack(layout: LayoutData, scope: ScopeName, axis: 'column' | 'row', after: number, limits: Limits): EditOutcome {
  const sc = scopeRef(layout, scope);
  const tracks = axis === 'column' ? sc.columns : sc.rows;
  if (!Number.isInteger(after) || after < 1 || after > tracks.length) {
    throw new Refusal(axis === 'column' ? MESSAGES.noColumn(after) : MESSAGES.noRow(after));
  }
  if (tracks.length >= limits.maxTracks) {
    throw new Refusal(axis === 'column' ? MESSAGES.maxColumns(limits.maxTracks) : MESSAGES.maxRows(limits.maxTracks));
  }
  const next = structuredCloneLayout(layout);
  const nextScope = scopeRef(next, scope);
  const list = axis === 'column' ? nextScope.columns : nextScope.rows;
  list.splice(after, 0, '1fr');
  // A new track joins an area wherever that area spans both neighbouring tracks;
  // every other area at or beyond the new track shifts one track along.
  const updated = nextScope.areas.map((area) => {
    const start = axis === 'column' ? area.column_start : area.row_start;
    const end = axis === 'column' ? area.column_end : area.row_end;
    if (start <= after && end > after + 1) {
      return axis === 'column'
        ? { ...area, column_end: end + 1 }
        : { ...area, row_end: end + 1 };
    }
    if (start > after) {
      return axis === 'column'
        ? { ...area, column_start: start + 1, column_end: end + 1 }
        : { ...area, row_start: start + 1, row_end: end + 1 };
    }
    if (end - 1 > after) {
      return axis === 'column'
        ? { ...area, column_end: end + 1 }
        : { ...area, row_end: end + 1 };
    }
    return area;
  });
  nextScope.areas.splice(0, updated.length, ...sortAreas(updated));
  return { layout: next, announced: { kind: 'track_added', axis, after } };
}

function removeTrack(layout: LayoutData, scope: ScopeName, axis: 'column' | 'row', index: number, limits: Limits): EditOutcome {
  const sc = scopeRef(layout, scope);
  const tracks = axis === 'column' ? sc.columns : sc.rows;
  if (!Number.isInteger(index) || index < 1 || index > tracks.length) {
    throw new Refusal(axis === 'column' ? MESSAGES.noColumn(index) : MESSAGES.noRow(index));
  }
  if (tracks.length <= 1) {
    throw new Refusal(axis === 'column' ? MESSAGES.minColumn : MESSAGES.minRow);
  }
  const next = structuredCloneLayout(layout);
  const nextScope = scopeRef(next, scope);
  const list = axis === 'column' ? nextScope.columns : nextScope.rows;
  list.splice(index - 1, 1);
  const kept: AreaLine[] = [];
  const removedAreas: string[] = [];
  for (const area of nextScope.areas) {
    const start = axis === 'column' ? area.column_start : area.row_start;
    const end = axis === 'column' ? area.column_end : area.row_end;
    const newStart = start > index ? start - 1 : start;
    const newEnd = end > index ? end - 1 : end;
    if (newEnd - newStart <= 0) { removedAreas.push(area.name); continue; }
    kept.push(axis === 'column'
      ? { ...area, column_start: newStart, column_end: newEnd }
      : { ...area, row_start: newStart, row_end: newEnd });
  }
  nextScope.areas.splice(0, nextScope.areas.length, ...sortAreas(kept));
  return { layout: next, announced: { kind: 'track_removed', axis, index, removedAreas: removedAreas.sort() } };
}

function setGap(layout: LayoutData, scope: ScopeName, row: number, column: number): EditOutcome {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row > 200 || column < 0 || column > 200) {
    throw new Refusal(MESSAGES.gaps);
  }
  const sc = scopeRef(layout, scope);
  if (sc.gap.row === row && sc.gap.column === column) return { layout, announced: { kind: 'none' } };
  const next = structuredCloneLayout(layout);
  scopeRef(next, scope).setGap({ row, column });
  const rowChanged = row !== sc.gap.row;
  const axis = rowChanged ? 'row' : 'column';
  return { layout: next, announced: { kind: 'gap', axis, value: axis === 'row' ? row : column } };
}

function setArea(layout: LayoutData, scope: ScopeName, name: string, sel: { row_start: number; column_start: number; row_end: number; column_end: number }, limits: Limits): EditOutcome {
  const nameError = areaNameError(name);
  if (nameError) throw new Refusal(nameError);
  const sc = scopeRef(layout, scope);
  const covering = sc.areas.filter((a) => covers(a, sel));
  const exactlyOne = covering.length === 1 && sameSelection(covering[0]!, sel);
  const existing = sc.areas.find((a) => a.name === name);
  const nameUsedAnywhere = layout.areas.some((a) => a.name === name)
    || layout.breakpoints.some((bp) => bp.areas.some((a) => a.name === name));

  // Overlap is decided before rename, extend and create: the selection may not
  // touch another area's cells, except the single placed area it exactly covers.
  if (!exactlyOne) {
    const overlapped = overlappedAreas(sc.areas, sel, existing?.name ?? null);
    if (overlapped.length > 0) throw new Refusal(`Area ${name} would overlap area ${overlapped[0]!.name}.`);
  }
  if (!existing) {
    if (exactlyOne && !nameUsedAnywhere) return renameArea(layout, covering[0]!.name, name);
    const next = structuredCloneLayout(layout);
    const areas = scopeOfNext(next, scope);
    areas.push(newArea(name, sel));
    areas.sort(areaOrder);
    return { layout: next, announced: { kind: 'area', name, verb: 'created' } };
  }
  if (sameSelection(existing, sel)) return { layout, announced: { kind: 'none' } };
  const unionCells: Array<[number, number]> = [];
  for (let r = existing.row_start; r < existing.row_end; r += 1) {
    for (let c = existing.column_start; c < existing.column_end; c += 1) unionCells.push([r, c]);
  }
  for (let r = sel.row_start; r < sel.row_end; r += 1) {
    for (let c = sel.column_start; c < sel.column_end; c += 1) unionCells.push([r, c]);
  }
  const unique = dedupe(unionCells);
  const bounds = boundsOf(unique);
  const isRect = unique.length === (bounds.row_end - bounds.row_start) * (bounds.column_end - bounds.column_start);
  if (!isRect) throw new Refusal(`Area ${name} must stay one rectangle.`);
  const next = structuredCloneLayout(layout);
  const nextExisting = scopeOfNext(next, scope).find((a) => a.name === name)!;
  nextExisting.row_start = bounds.row_start;
  nextExisting.column_start = bounds.column_start;
  nextExisting.row_end = bounds.row_end;
  nextExisting.column_end = bounds.column_end;
  return { layout: next, announced: { kind: 'area', name, verb: 'extended' } };
}

function renameArea(layout: LayoutData, oldName: string, newName: string): EditOutcome {
  const nameError = areaNameError(newName);
  if (nameError) throw new Refusal(nameError);
  const used = new Set<string>();
  for (const area of layout.areas) used.add(area.name);
  for (const bp of layout.breakpoints) for (const area of bp.areas) used.add(area.name);
  if (!used.has(oldName)) throw new Refusal(`There is no area ${oldName}.`);
  if (used.has(newName)) throw new Refusal(`The name ${newName} is already used.`);
  const next = structuredCloneLayout(layout);
  for (const area of next.areas) if (area.name === oldName) area.name = newName;
  for (const bp of next.breakpoints) for (const area of bp.areas) if (area.name === oldName) area.name = newName;
  return { layout: next, announced: { kind: 'area', name: newName, verb: 'renamed', old: oldName } };
}

function clearCells(layout: LayoutData, scope: ScopeName, sel: { row_start: number; column_start: number; row_end: number; column_end: number }): EditOutcome {
  const sc = scopeRef(layout, scope);
  const touched = selectionTouchesArea(sc.areas, sel);
  if (!touched) return { layout, announced: { kind: 'none' } };
  const next = structuredCloneLayout(layout);
  const nextAreas = scopeOfNext(next, scope);
  const removedAreas: string[] = [];
  const kept: AreaLine[] = [];
  for (const area of nextAreas) {
    const cells: Array<[number, number]> = [];
    for (let r = area.row_start; r < area.row_end; r += 1) {
      for (let c = area.column_start; c < area.column_end; c += 1) {
        const inside = r >= sel.row_start && r < sel.row_end && c >= sel.column_start && c < sel.column_end;
        if (!inside) cells.push([r, c]);
      }
    }
    if (cells.length === 0) { removedAreas.push(area.name); continue; }
    const bounds = boundsOf(cells);
    const isRect = cells.length === (bounds.row_end - bounds.row_start) * (bounds.column_end - bounds.column_start);
    if (!isRect) throw new Refusal(`Area ${area.name} must stay one rectangle.`);
    kept.push({ ...area, row_start: bounds.row_start, column_start: bounds.column_start, row_end: bounds.row_end, column_end: bounds.column_end });
  }
  nextAreas.splice(0, nextAreas.length, ...sortAreas(kept));
  return { layout: next, announced: { kind: 'cleared', removedAreas: removedAreas.sort() } };
}

function covers(a: AreaLine, sel: { row_start: number; column_start: number; row_end: number; column_end: number }): boolean {
  return a.row_start <= sel.row_start && a.row_end >= sel.row_end && a.column_start <= sel.column_start && a.column_end >= sel.column_end;
}

function sameSelection(a: AreaLine, sel: { row_start: number; column_start: number; row_end: number; column_end: number }): boolean {
  return a.row_start === sel.row_start && a.column_start === sel.column_start && a.row_end === sel.row_end && a.column_end === sel.column_end;
}

function newArea(name: string, sel: { row_start: number; column_start: number; row_end: number; column_end: number }): AreaLine {
  return { name, row_start: sel.row_start, column_start: sel.column_start, row_end: sel.row_end, column_end: sel.column_end };
}

function dedupe(cells: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const cell of cells) {
    const key = `${cell[0]}:${cell[1]}`;
    if (!seen.has(key)) { seen.add(key); out.push(cell); }
  }
  return out;
}

function boundsOf(cells: Array<[number, number]>) {
  const rowStart = Math.min(...cells.map(([r]) => r));
  const rowEnd = Math.max(...cells.map(([r]) => r));
  const columnStart = Math.min(...cells.map(([, c]) => c));
  const columnEnd = Math.max(...cells.map(([, c]) => c));
  return { row_start: rowStart, column_start: columnStart, row_end: rowEnd + 1, column_end: columnEnd + 1 };
}

function selectionTouchesArea(areas: AreaLine[], sel: { row_start: number; column_start: number; row_end: number; column_end: number }): boolean {
  for (const a of areas) {
    if (a.row_start < sel.row_end && a.row_end > sel.row_start && a.column_start < sel.column_end && a.column_end > sel.column_start) return true;
  }
  return false;
}

function scopeOfNext(next: LayoutData, scope: ScopeName): AreaLine[] {
  return scope === 'base' ? next.areas : next.breakpoints.find((b) => b.min_width === scope)!.areas;
}

function addBreakpoint(layout: LayoutData, minWidth: number, limits: Limits): EditOutcome {
  if (!Number.isInteger(minWidth) || minWidth < 400 || minWidth > 1440) throw new Refusal(MESSAGES.breakpointRange);
  if (layout.breakpoints.some((b) => b.min_width === minWidth)) throw new Refusal(MESSAGES.breakpointExists(minWidth));
  if (layout.breakpoints.length >= limits.maxBreakpoints) throw new Refusal(MESSAGES.maxBreakpoints(limits.maxBreakpoints));
  const below = scopeBelow(layout, minWidth);
  const bp = {
    min_width: minWidth,
    columns: [...below.columns],
    rows: [...below.rows],
    areas: below.areas.map((a) => ({ ...a })),
    gap: null,
  };
  const next = structuredCloneLayout(layout);
  next.breakpoints.push(bp);
  next.breakpoints.sort((a, b) => a.min_width - b.min_width);
  return { layout: next, announced: { kind: 'breakpoint_added', minWidth } };
}

function removeBreakpoint(layout: LayoutData, minWidth: number, limits: Limits): EditOutcome {
  const index = layout.breakpoints.findIndex((b) => b.min_width === minWidth);
  if (index < 0) throw new Refusal(MESSAGES.noBreakpoint(minWidth));
  const next = structuredCloneLayout(layout);
  next.breakpoints.splice(index, 1);
  return { layout: next, announced: { kind: 'breakpoint_removed', minWidth } };
}

export function structuredCloneLayout(layout: LayoutData): LayoutData {
  return {
    name: layout.name,
    revision: layout.revision,
    columns: [...layout.columns],
    rows: [...layout.rows],
    gap: { ...layout.gap },
    areas: layout.areas.map((a) => ({ ...a })),
    breakpoints: layout.breakpoints.map((b) => ({
      min_width: b.min_width,
      columns: [...b.columns],
      rows: [...b.rows],
      areas: b.areas.map((a) => ({ ...a })),
      gap: b.gap ? { ...b.gap } : null,
    })),
  };
}

export function applyChange(layout: LayoutData, change: Record<string, unknown>, limits: Limits): EditOutcome {
  const kind = change['kind'];
  if (typeof kind !== 'string') throw new Refusal(MESSAGES.unknownChange);
  const scope = readScopeName(change['scope']);
  switch (kind) {
    case 'set_track': {
      const axis = readAxis(change['axis']);
      const index = readIndex(change['index']);
      const size = readString(change['size']);
      return setTrackSize(layout, scope, axis, index, size, limits);
    }
    case 'add_track': {
      const axis = readAxis(change['axis']);
      const after = readIndex(change['after']);
      return addTrack(layout, scope, axis, after, limits);
    }
    case 'remove_track': {
      const axis = readAxis(change['axis']);
      const index = readIndex(change['index']);
      return removeTrack(layout, scope, axis, index, limits);
    }
    case 'set_gap': {
      const row = readIndex(change['row']);
      const column = readIndex(change['column']);
      return setGap(layout, scope, row, column);
    }
    case 'set_area': {
      const name = readString(change['name']);
      const sel = readSelection(change);
      return setArea(layout, scope, name, sel, limits);
    }
    case 'rename_area': {
      const name = readString(change['name']);
      const newName = readString(change['new_name']);
      return renameArea(layout, name, newName);
    }
    case 'clear_cells': {
      const sel = readSelection(change);
      return clearCells(layout, scope, sel);
    }
    case 'add_breakpoint': {
      const minWidth = readIndex(change['min_width']);
      return addBreakpoint(layout, minWidth, limits);
    }
    case 'remove_breakpoint': {
      const minWidth = readIndex(change['min_width']);
      return removeBreakpoint(layout, minWidth, limits);
    }
    default:
      throw new Refusal(MESSAGES.unknownChange);
  }
}

function readScopeName(value: unknown): ScopeName {
  if (value === undefined || value === null) return 'base';
  if (value === 'base') return 'base';
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isInteger(Number(value))) return Number(value);
  throw new Refusal('Unknown change.');
}

function readAxis(value: unknown): 'column' | 'row' {
  if (value === 'column' || value === 'row') return value;
  throw new Refusal('Unknown change.');
}

function readIndex(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw new Refusal('Unknown change.');
}

function readString(value: unknown): string {
  if (typeof value === 'string') return value;
  throw new Refusal('Unknown change.');
}

function readSelection(change: Record<string, unknown>): { row_start: number; column_start: number; row_end: number; column_end: number } {
  return {
    row_start: readIndex(change['row_start']),
    column_start: readIndex(change['column_start']),
    row_end: readIndex(change['row_end']),
    column_end: readIndex(change['column_end']),
  };
}

export function announcementOf(announced: Announced): string {
  switch (announced.kind) {
    case 'track_size':
      return `${announced.axis === 'column' ? 'Column' : 'Row'} ${announced.index} set to ${announced.size}.`;
    case 'track_added':
      return `${announced.axis === 'column' ? 'Column' : 'Row'} added after ${announced.axis === 'column' ? 'column' : 'row'} ${announced.after}.`;
    case 'track_removed': {
      const head = `${announced.axis === 'column' ? 'Column' : 'Row'} ${announced.index} removed.`;
      return head + announced.removedAreas.map((n) => ` Area ${n} removed.`).join('');
    }
    case 'gap':
      return `${announced.axis === 'row' ? 'Row' : 'Column'} gap set to ${announced.value}px.`;
    case 'area':
      if (announced.verb === 'renamed') return `Area ${announced.old} renamed to ${announced.name}.`;
      if (announced.verb === 'extended') return `Area ${announced.name} extended.`;
      return `Area ${announced.name} created.`;
    case 'cleared':
      return `Cells cleared.` + announced.removedAreas.map((n) => ` Area ${n} removed.`).join('');
    case 'breakpoint_added':
      return `Breakpoint From ${announced.minWidth}px added.`;
    case 'breakpoint_removed':
      return `Breakpoint From ${announced.minWidth}px removed.`;
    case 'css': {
      let text = 'CSS applied.';
      if (announced.added.length > 0) text += ` Areas added: ${announced.added.join(', ')}.`;
      if (announced.removed.length > 0) text += ` Areas removed: ${announced.removed.join(', ')}.`;
      return text;
    }
    case 'restored':
      return `Restored version ${announced.number}.`;
    case 'undo':
      return 'Undone.';
    case 'none':
      return 'No changes.';
  }
}

/** Areas whose cells the selection touches, in reading order, ignoring one allowed name. */
function overlappedAreas(areas: AreaLine[], sel: { row_start: number; column_start: number; row_end: number; column_end: number }, allowed: string | null): AreaLine[] {
  const touched = areas.filter((a) =>
    a.name !== allowed
    && a.row_start < sel.row_end && a.row_end > sel.row_start
    && a.column_start < sel.column_end && a.column_end > sel.column_start
  );
  return sortAreas(touched);
}

function areaOrder(a: AreaLine, b: AreaLine): number {
  return a.row_start - b.row_start || a.column_start - b.column_start || a.name.localeCompare(b.name);
}
