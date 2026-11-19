import { containerOf } from "../shared/moves.js";
import type { OutlineState } from "./outline.js";

export interface Shown {
  /** The shared bullet this id is shown through. */
  root: string;
  /** Ids between the shared bullet and this one, top down. */
  trail: string[];
  /** Displayed depth, with the shared bullet at 0. */
  depth: number;
}

/**
 * What a collaborator can open: every id reachable in the displayed tree from a shared bullet,
 * copies shown with their original's children. This is the one place collaborator scope is decided.
 */
export function shownFrom(state: OutlineState, roots: Iterable<string>): Map<string, Shown> {
  const shown = new Map<string, Shown>();
  const walk = (id: string, root: string, trail: string[], depth: number, path: Set<string>): void => {
    if (!shown.has(id)) shown.set(id, { root, trail, depth });
    const container = containerOf(state, id);
    if (path.has(container)) return;
    path.add(container);
    for (const child of state.childrenOf(container)) walk(child, root, [...trail, ...(id === root ? [] : [id])], depth + 1, path);
    path.delete(container);
  };
  for (const root of roots) {
    if (state.placement(root) !== undefined) walk(root, root, [], 0, new Set());
  }
  return shown;
}

export interface Scope {
  ownerId: string;
  isOwner: boolean;
  shareRoots: ReadonlySet<string>;
  shown: Map<string, Shown> | null;
  canSee(id: string): boolean;
  /** Whether a bullet may be placed under `parentId`; the top level of an outline belongs to its owner only. */
  canPlaceAt(parentId: string | null): boolean;
}

export function ownerScope(state: OutlineState): Scope {
  return { ownerId: state.ownerId, isOwner: true, shareRoots: new Set(), shown: null, canSee: (id) => state.placement(id) !== undefined, canPlaceAt: (parentId) => parentId === null || state.placement(parentId) !== undefined };
}

export function collaboratorScope(state: OutlineState, roots: readonly string[]): Scope {
  const shown = shownFrom(state, roots);
  return { ownerId: state.ownerId, isOwner: false, shareRoots: new Set(roots), shown, canSee: (id) => shown.has(id), canPlaceAt: (parentId) => parentId !== null && shown.has(parentId) };
}
