import { getScopeGrid, normaliseRect, rectCells, rectsOverlap, sortAreas } from './grid.js';
import type { Change, LayoutState, Scope } from './types.js';

export interface ScopeTargets {
  scope: string;
  /** A track added or removed touches every track and cell of its scope. */
  allTracks: boolean;
  tracks: string[];
  gaps: boolean;
  cells: string[];
}

export interface TargetSet {
  whole: boolean;
  areas: string[];
  scopes: ScopeTargets[];
  /** How the conflict notice names this target. */
  name: string;
}

function scopeKey(scope: Scope): string {
  return scope === 'base' ? 'base' : String(scope);
}

const WHOLE_LAYOUT: Omit<TargetSet, 'name'> = { whole: true, areas: [], scopes: [] };

/** What a change touches, for deciding conflicts and for naming the winner's target. */
export function targetsOf(change: Change, before: LayoutState): TargetSet {
  switch (change.kind) {
    case 'set_track':
      return {
        whole: false,
        areas: [],
        scopes: [
          {
            scope: scopeKey(change.scope),
            allTracks: false,
            tracks: [`${change.axis}:${change.index}`],
            gaps: false,
            cells: [],
          },
        ],
        name: `${change.axis} ${change.index}`,
      };
    case 'add_track':
    case 'remove_track':
      return {
        whole: false,
        areas: [],
        scopes: [{ scope: scopeKey(change.scope), allTracks: true, tracks: [], gaps: false, cells: [] }],
        name: 'the layout',
      };
    case 'set_gap':
      return {
        whole: false,
        areas: [],
        scopes: [{ scope: scopeKey(change.scope), allTracks: false, tracks: [], gaps: true, cells: [] }],
        name: 'the gaps',
      };
    case 'set_area': {
      const rect = normaliseRect(change);
      const grid = getScopeGrid(before, change.scope);
      const placed = grid?.areas.find((area) => area.name === change.name);
      const cells = new Set(rectCells(rect));
      if (placed) for (const cell of rectCells(placed)) cells.add(cell);
      return {
        whole: false,
        areas: [change.name],
        scopes: [
          {
            scope: scopeKey(change.scope),
            allTracks: false,
            tracks: [],
            gaps: false,
            cells: [...cells],
          },
        ],
        name: `area ${change.name}`,
      };
    }
    case 'rename_area':
      return {
        whole: false,
        areas: [change.name, change.new_name],
        scopes: [],
        name: `area ${change.name}`,
      };
    case 'clear_cells': {
      const rect = normaliseRect(change);
      const grid = getScopeGrid(before, change.scope);
      const emptied = sortAreas(grid?.areas ?? []).filter((area) => rectsOverlap(area, rect));
      return {
        whole: false,
        areas: emptied.map((area) => area.name),
        scopes: [
          {
            scope: scopeKey(change.scope),
            allTracks: false,
            tracks: [],
            gaps: false,
            cells: rectCells(rect),
          },
        ],
        name: emptied.length > 0 ? `area ${(emptied[0] as { name: string }).name}` : 'the layout',
      };
    }
    case 'add_breakpoint':
    case 'remove_breakpoint':
    case 'apply_css':
    case 'restore_version':
    case 'undo':
    case 'redo':
      return { ...WHOLE_LAYOUT, name: 'the layout' };
  }
}

function sharesMember(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((item) => set.has(item));
}

export function targetsIntersect(a: TargetSet, b: TargetSet): boolean {
  if (a.whole || b.whole) return true;
  if (sharesMember(a.areas, b.areas)) return true;
  for (const left of a.scopes) {
    for (const right of b.scopes) {
      if (left.scope !== right.scope) continue;
      if (left.allTracks || right.allTracks) {
        if (right.tracks.length > 0 || right.cells.length > 0 || right.allTracks) return true;
        if (left.tracks.length > 0 || left.cells.length > 0) return true;
        continue;
      }
      if (sharesMember(left.tracks, right.tracks)) return true;
      if (left.gaps && right.gaps) return true;
      if (sharesMember(left.cells, right.cells)) return true;
    }
  }
  return false;
}
