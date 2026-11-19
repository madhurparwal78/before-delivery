import type { PlacementRef, PlacementTree } from "../../shared/moves";
import type { Bullet, OutlineView, SearchResult } from "../../shared/types";

/** The part of one outline a tab holds: the zoom root, its ancestors and everything shown below it. */
export interface View {
  rootId: string | null;
  root: Bullet | null;
  ancestors: Bullet[];
  bullets: ReadonlyMap<string, Bullet>;
  kids: ReadonlyMap<string | null, readonly string[]>;
  seq: number;
}

function indexKids(bullets: Iterable<Bullet>): Map<string | null, string[]> {
  const grouped = new Map<string | null, Bullet[]>();
  for (const bullet of bullets) {
    const list = grouped.get(bullet.parentId) ?? [];
    list.push(bullet);
    grouped.set(bullet.parentId, list);
  }
  const kids = new Map<string | null, string[]>();
  for (const [parent, list] of grouped) kids.set(parent, list.sort((a, b) => a.position - b.position).map((bullet) => bullet.id));
  return kids;
}

export function viewFrom(outline: OutlineView, rootId: string | null): View {
  const bullets = new Map<string, Bullet>();
  for (const bullet of [...outline.ancestors, ...(outline.root === null ? [] : [outline.root]), ...outline.bullets]) bullets.set(bullet.id, bullet);
  return { rootId, root: outline.root, ancestors: outline.ancestors, bullets, kids: indexKids(bullets.values()), seq: outline.seq };
}

/** The tree the shared move rules read. */
export class ViewTree implements PlacementTree {
  constructor(private readonly view: View) {}

  placement(id: string): PlacementRef | undefined {
    return this.view.bullets.get(id);
  }

  childrenOf(containerId: string | null): readonly string[] {
    return this.view.kids.get(containerId) ?? [];
  }
}

export const topContainer = (view: View): string | null =>
  view.root === null ? null : view.root.mirrorOf ?? view.root.id;

export const topIds = (view: View): readonly string[] => view.kids.get(topContainer(view)) ?? [];

export function withBullet(view: View, bullet: Bullet): View {
  const bullets = new Map(view.bullets);
  bullets.set(bullet.id, bullet);
  const root = view.root !== null && view.root.id === bullet.id ? bullet : view.root;
  const ancestors = view.ancestors.map((entry) => (entry.id === bullet.id ? bullet : entry));
  return { ...view, root, ancestors, bullets, kids: indexKids(bullets.values()) };
}

export function patchBullet(view: View, id: string, change: Partial<Bullet>): View {
  const current = view.bullets.get(id);
  if (current === undefined) return view;
  const bullets = new Map(view.bullets);
  bullets.set(id, { ...current, ...change });
  const root = view.root !== null && view.root.id === id ? { ...view.root, ...change } : view.root;
  const ancestors = view.ancestors.map((entry) => (entry.id === id ? { ...entry, ...change } : entry));
  return { ...view, root, ancestors, bullets, kids: change.parentId !== undefined || change.position !== undefined ? indexKids(bullets.values()) : view.kids };
}

/** Removes bullets and everything beneath them. */
export function withoutBullets(view: View, ids: readonly string[]): View {
  const doomed = new Set(ids);
  const stack = [...ids];
  while (stack.length > 0) {
    const next = stack.pop();
    for (const child of view.kids.get(next ?? null) ?? []) {
      if (!doomed.has(child)) {
        doomed.add(child);
        stack.push(child);
      }
    }
  }
  const bullets = new Map([...view.bullets].filter(([id]) => !doomed.has(id)));
  return { ...view, bullets, kids: indexKids(bullets.values()) };
}

/** Places a bullet at `index` among the children of `parentId`, renumbering both sibling lists. */
export function placed(view: View, id: string, parentId: string | null, index: number): View {
  const moving = view.bullets.get(id);
  if (moving === undefined) return view;
  const kids = new Map(view.kids);
  const oldList = (kids.get(moving.parentId) ?? []).filter((entry) => entry !== id);
  kids.set(moving.parentId, oldList);
  const newList = [...(parentId === moving.parentId ? oldList : kids.get(parentId) ?? [])];
  newList.splice(index, 0, id);
  kids.set(parentId, newList);
  const bullets = new Map(view.bullets);
  const renumber = (list: readonly string[], parent: string | null) => {
    list.forEach((entry, position) => {
      const bullet = bullets.get(entry);
      if (bullet !== undefined) bullets.set(entry, { ...bullet, position, parentId: parent });
    });
  };
  renumber(oldList, moving.parentId);
  renumber(newList, parentId);
  return { ...view, bullets, kids };
}

export function inserted(view: View, bullet: Bullet, index: number): View {
  const bullets = new Map(view.bullets);
  bullets.set(bullet.id, { ...bullet, parentId: bullet.parentId });
  const kids = new Map(view.kids);
  const list = [...(kids.get(bullet.parentId) ?? [])];
  list.splice(index, 0, bullet.id);
  kids.set(bullet.parentId, list);
  list.forEach((entry, position) => {
    const found = bullets.get(entry);
    if (found !== undefined) bullets.set(entry, { ...found, position });
  });
  return { ...view, bullets, kids };
}

export function renamed(view: View, from: string, to: string): View {
  const bullets = new Map<string, Bullet>();
  for (const [id, bullet] of view.bullets) {
    const next = id === from ? to : id;
    bullets.set(next, { ...bullet, id: next, parentId: bullet.parentId === from ? to : bullet.parentId, mirrorOf: bullet.mirrorOf === from ? to : bullet.mirrorOf });
  }
  const root = view.root === null ? null : bullets.get(view.root.id === from ? to : view.root.id) ?? view.root;
  return { ...view, bullets, root, kids: indexKids(bullets.values()), rootId: view.rootId === from ? to : view.rootId };
}

export interface RowNode {
  /** Stable React key and focus key: the keys of every bullet from the top of the view down to this one. */
  key: string;
  bullet: Bullet;
  level: number;
  depth: number;
  search: "match" | "context" | null;
  open: boolean;
  children: RowNode[];
}

interface RowOptions {
  hideCompleted: boolean;
  search: SearchResult | null;
  keyOf: (id: string) => string;
}

export function buildRows(view: View, options: RowOptions): { rows: RowNode[]; hidden: number } {
  const matches = options.search === null ? null : new Set(options.search.matches);
  const context = options.search === null ? null : new Set(options.search.context);
  const hideCompleted = options.hideCompleted && options.search === null;
  const base = view.root === null ? 0 : view.root.depth + 1;
  let hidden = 0;
  const level = (container: string | null, prefix: string, depth: number, guard: ReadonlySet<string>): RowNode[] => {
    const rows: RowNode[] = [];
    for (const id of view.kids.get(container) ?? []) {
      const bullet = view.bullets.get(id);
      if (bullet === undefined) continue;
      const match = matches?.has(id) === true;
      const near = context?.has(id) === true;
      if (matches !== null && !match && !near) continue;
      if (hideCompleted && bullet.completed) {
        hidden += 1;
        continue;
      }
      const key = prefix === "" ? options.keyOf(id) : `${prefix}/${options.keyOf(id)}`;
      const inner = bullet.mirrorOf ?? bullet.id;
      const children = guard.has(inner) || bullet.placeholder ? [] : level(inner, key, depth + 1, new Set([...guard, inner]));
      rows.push({
        key, bullet, level: depth - base + 1, depth, search: match ? "match" : near ? "context" : null,
        open: matches !== null || !bullet.collapsed, children,
      });
    }
    return rows;
  };
  const top = topContainer(view);
  const rows = level(top, "", base, new Set(top === null ? [] : [top]));
  return { rows, hidden };
}

export function flatten(rows: readonly RowNode[]): RowNode[] {
  return rows.flatMap((row) => [row, ...(row.open ? flatten(row.children) : [])]);
}
