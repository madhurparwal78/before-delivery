import { containerOf, depthOf } from "../shared/moves.js";
import type { Bullet, OutlineView } from "../shared/types.js";
import { notFound } from "./http.js";
import type { OutlineState } from "./outline.js";
import type { Scope } from "./scope.js";

const asViewer = (scope: Scope, bullet: Bullet, depth: number): Bullet =>
  scope.isOwner ? { ...bullet, depth } : { ...bullet, depth, parentId: scope.shareRoots.has(bullet.id) ? null : bullet.parentId };

function depthIn(state: OutlineState, scope: Scope, id: string): number {
  return scope.shown?.get(id)?.depth ?? depthOf(state, id);
}

/** The bullet as `scope`'s person sees it: depth counted from the shared bullet for a collaborator. */
export function bulletFor(state: OutlineState, scope: Scope, id: string): Bullet {
  const row = state.placement(id);
  if (row === undefined) throw notFound();
  return asViewer(scope, state.bullet(row, depthIn(state, scope, id)), depthIn(state, scope, id));
}

function listing(state: OutlineState, scope: Scope, container: string | null, depth: number, path: Set<string>, out: Bullet[]): void {
  for (const id of state.childrenOf(container)) {
    const row = state.placement(id);
    if (row === undefined) continue;
    out.push(asViewer(scope, state.bullet(row, depth), depth));
    const inner = containerOf(state, id);
    if (!path.has(inner)) {
      path.add(inner);
      listing(state, scope, inner, depth + 1, path, out);
      path.delete(inner);
    }
  }
}

function displayList(state: OutlineState, scope: Scope, rootId: string | null): Bullet[] {
  const out: Bullet[] = [];
  const container = rootId === null ? null : containerOf(state, rootId);
  const base = rootId === null ? 0 : depthIn(state, scope, rootId) + 1;
  listing(state, scope, container, base, new Set(container === null ? [] : [container]), out);
  return out;
}

function ancestorsOf(state: OutlineState, scope: Scope, id: string): Bullet[] {
  const ids: string[] = [];
  const shown = scope.shown?.get(id);
  if (shown !== undefined) ids.push(...shown.trail);
  else {
    for (let cursor = state.placement(id)?.parentId ?? null; cursor !== null; cursor = state.placement(cursor)?.parentId ?? null) {
      ids.unshift(cursor);
    }
  }
  return ids.map((ancestor) => bulletFor(state, scope, ancestor));
}

export function outlineFor(state: OutlineState, scope: Scope, seq: number, rootId: string | null): OutlineView {
  if (rootId !== null && !scope.canSee(rootId)) throw notFound();
  return {
    root: rootId === null ? null : bulletFor(state, scope, rootId),
    ancestors: rootId === null ? [] : ancestorsOf(state, scope, rootId),
    seq,
    bullets: displayList(state, scope, rootId),
  };
}
