import type { Bullet, OutlineView, SearchResult } from '../../shared/types.js';
import { fullName } from '../../shared/types.js';

/** One placement in the view, with the path that makes copies' children unique. */
export interface Node {
  bullet: Bullet;
  key: string;
  level: number;
  parent: Node | null;
  children: Node[];
}

export interface Tree {
  roots: Node[];
  flat: Node[];
  byKey: Map<string, Node>;
  byId: Map<string, Node[]>;
}

/** Rebuilds the display tree from the ordered, depth-marked list the API sends. */
export function buildTree(view: OutlineView): Tree {
  const roots: Node[] = [];
  const flat: Node[] = [];
  const byKey = new Map<string, Node>();
  const byId = new Map<string, Node[]>();
  const stack: Node[] = [];
  const baseDepth = view.bullets[0]?.depth ?? 0;
  for (const bullet of view.bullets) {
    const level = bullet.depth - baseDepth + 1;
    while (stack.length >= level) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    const node: Node = {
      bullet,
      key: `${parent === null ? '' : parent.key}/${bullet.id}`,
      level: stack.length + 1,
      parent,
      children: []
    };
    if (parent === null) roots.push(node);
    else parent.children.push(node);
    stack.push(node);
    flat.push(node);
    byKey.set(node.key, node);
    const sameId = byId.get(bullet.id) ?? [];
    sameId.push(node);
    byId.set(bullet.id, sameId);
  }
  return { roots, flat, byKey, byId };
}

export function nodeName(bullet: Bullet): string {
  return fullName(bullet);
}

export interface Filters {
  hideCompleted: boolean;
  search: SearchResult | null;
}

/** The rows a view shows, after folding, Hide completed and the live search. */
export function visibleRows(tree: Tree, filters: Filters): Node[] {
  const searching = filters.search !== null;
  const keep = new Set<string>();
  if (filters.search !== null) {
    const wanted = new Set([...filters.search.matches, ...filters.search.context]);
    for (const node of tree.flat) if (wanted.has(node.bullet.id)) keep.add(node.key);
  }
  const rows: Node[] = [];
  const walk = (nodes: Node[]): void => {
    for (const node of nodes) {
      if (searching && !keep.has(node.key)) continue;
      if (!searching && filters.hideCompleted && node.bullet.completed) continue;
      rows.push(node);
      const folded = node.bullet.collapsed && !searching;
      if (!folded) walk(node.children);
    }
  };
  walk(tree.roots);
  return rows;
}

/** Completed bullets the Hide completed switch takes out of the view. */
export function hiddenCompletedCount(tree: Tree): number {
  let count = 0;
  const walk = (nodes: Node[]): void => {
    for (const node of nodes) {
      if (node.bullet.completed) {
        count += 1;
        continue;
      }
      walk(node.children);
    }
  };
  walk(tree.roots);
  return count;
}

export function siblingsOf(tree: Tree, node: Node): Node[] {
  return node.parent === null ? tree.roots : node.parent.children;
}

export function indexOf(tree: Tree, node: Node): number {
  return siblingsOf(tree, node).findIndex((sibling) => sibling.key === node.key);
}
