import { gridOf, overlapsRect } from '../../shared/grid.js';
import type { Axis, LayoutState, Rect, Scope } from '../../shared/types.js';
import type { PreparedChange } from './prepare.js';

/** What a change touches; two changes by different designers conflict when their targets meet. */
export type Target =
  | { kind: 'layout' }
  | { kind: 'track'; scope: Scope; axis: Axis; index: number }
  | { kind: 'tracks'; scope: Scope }
  | { kind: 'gap'; scope: Scope }
  | { kind: 'area'; scope: Scope | 'all'; names: string[]; rect: Rect | null };

const shares = (a: string[], b: string[]): boolean => a.some((name) => b.includes(name));

/** The single rule that decides whether a stale change meets a change applied after its base revision. */
export function meets(a: Target, b: Target): boolean {
  if (a.kind === 'layout' || b.kind === 'layout') return true;
  if (a.kind === 'track' && b.kind === 'track') return a.scope === b.scope && a.axis === b.axis && a.index === b.index;
  if (a.kind === 'track' && b.kind === 'tracks') return a.scope === b.scope;
  if (a.kind === 'tracks' && (b.kind === 'track' || b.kind === 'tracks')) return a.scope === b.scope;
  if (a.kind === 'tracks' && b.kind === 'area') return b.scope === a.scope;
  if (a.kind === 'area' && b.kind === 'tracks') return a.scope === b.scope;
  if (a.kind === 'gap' && b.kind === 'gap') return a.scope === b.scope;
  if (a.kind === 'area' && b.kind === 'area') {
    if (shares(a.names, b.names)) return true;
    return a.scope === b.scope && a.scope !== 'all' && a.rect !== null && b.rect !== null && overlapsRect(a.rect, b.rect);
  }
  return false;
}

/** The target a change touches, known before it is applied so a conflict is decided before its other rules. */
export function targetOf(change: Exclude<PreparedChange, { kind: 'undo' | 'redo' }>, state: LayoutState): Target {
  switch (change.kind) {
    case 'set_track':
      return { kind: 'track', scope: change.scope, axis: change.axis, index: change.index };
    case 'add_track':
    case 'remove_track':
      return { kind: 'tracks', scope: change.scope };
    case 'set_gap':
      return { kind: 'gap', scope: change.scope };
    case 'set_area':
      return { kind: 'area', scope: change.scope, names: [change.name], rect: change };
    case 'rename_area':
      return { kind: 'area', scope: 'all', names: [change.name, change.new_name], rect: null };
    case 'clear_cells': {
      const areas = gridOf(state, change.scope)?.areas ?? [];
      return { kind: 'area', scope: change.scope, names: areas.filter((area) => overlapsRect(area, change)).map((area) => area.name), rect: change };
    }
    default:
      return { kind: 'layout' };
  }
}
