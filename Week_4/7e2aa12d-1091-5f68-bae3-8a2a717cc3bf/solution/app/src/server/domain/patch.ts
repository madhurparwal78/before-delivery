import { gridOf, sortAreas, tracksOf } from '../../shared/grid.js';
import { nameUsed, noBreakpoint } from '../../shared/messages.js';
import type { Area, Axis, Gap, Grid, LayoutState, Scope } from '../../shared/types.js';
import { Refusal } from './refusal.js';

/**
 * A stored region of a layout: what a change replaced. Applying a patch puts that region back and
 * yields the patch that undoes it, so undo and redo are the same operation.
 */
export type Patch =
  | { op: 'track'; scope: Scope; axis: Axis; index: number; size: string }
  | { op: 'tracks'; scope: Scope; columns: string[]; rows: string[]; areas: Area[] }
  | { op: 'gap'; scope: Scope; gap: Gap | null }
  | { op: 'areas'; scope: Scope; names: string[]; areas: Area[] }
  | { op: 'rename'; from: string; to: string }
  | { op: 'layout'; state: LayoutState };

export function needGrid(state: LayoutState, scope: Scope) {
  const grid = gridOf(state, scope);
  if (!grid) throw new Refusal(noBreakpoint(scope));
  return grid;
}

/** The patch that restores a scope's tracks and areas to what they are now. */
export const gridPatch = (scope: Scope, grid: Grid): Patch => ({ op: 'tracks', scope, columns: [...grid.columns], rows: [...grid.rows], areas: structuredClone(grid.areas) });

export function renameEverywhere(state: LayoutState, from: string, to: string): void {
  for (const grid of [state, ...state.breakpoints]) {
    for (const area of grid.areas) if (area.name === from) area.name = to;
  }
}

/** The patch that would undo `patch` when applied to `state`'s current content. */
function counterpart(state: LayoutState, patch: Patch): Patch {
  switch (patch.op) {
    case 'track':
      return { ...patch, size: tracksOf(needGrid(state, patch.scope), patch.axis)[patch.index - 1] };
    case 'tracks':
      return gridPatch(patch.scope, needGrid(state, patch.scope));
    case 'gap': {
      const { gap } = needGrid(state, patch.scope);
      return { op: 'gap', scope: patch.scope, gap: gap && { ...gap } };
    }
    case 'areas': {
      const grid = needGrid(state, patch.scope);
      return { op: 'areas', scope: patch.scope, names: patch.names, areas: structuredClone(grid.areas.filter((area) => patch.names.includes(area.name))) };
    }
    case 'rename':
      return { op: 'rename', from: patch.to, to: patch.from };
    case 'layout':
      return { op: 'layout', state: structuredClone(state) };
  }
}

/** Apply a stored patch to a layout state: the new state and the patch that reverses it. */
export function applyPatch(state: LayoutState, patch: Patch): { state: LayoutState; inverse: Patch } {
  const inverse = counterpart(state, patch);
  const next = structuredClone(state);
  switch (patch.op) {
    case 'track':
      tracksOf(needGrid(next, patch.scope), patch.axis)[patch.index - 1] = patch.size;
      break;
    case 'tracks': {
      const grid = needGrid(next, patch.scope);
      grid.columns = [...patch.columns];
      grid.rows = [...patch.rows];
      grid.areas = structuredClone(patch.areas);
      break;
    }
    case 'gap': {
      const holder: { gap: Gap | null } = needGrid(next, patch.scope);
      holder.gap = patch.gap;
      break;
    }
    case 'areas': {
      const grid = needGrid(next, patch.scope);
      grid.areas = sortAreas([...grid.areas.filter((area) => !patch.names.includes(area.name)), ...structuredClone(patch.areas)]);
      break;
    }
    case 'rename': {
      if ([next, ...next.breakpoints].some((grid) => grid.areas.some((area) => area.name === patch.to))) throw new Refusal(nameUsed(patch.to));
      renameEverywhere(next, patch.from, patch.to);
      break;
    }
    case 'layout':
      return { state: structuredClone(patch.state), inverse };
  }
  return { state: next, inverse };
}
