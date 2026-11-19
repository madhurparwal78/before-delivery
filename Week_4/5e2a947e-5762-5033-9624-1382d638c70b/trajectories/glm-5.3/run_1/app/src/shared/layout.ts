import type { Boundary, CrossLink, Layout, TopicNode } from './types.js';

/**
 * The layout engine: a pure function of the tree, the layout mode and
 * each viewer's collapse set. All results are whole map-unit numbers.
 */

export interface Box {
  x: number; // centre x
  y: number; // centre y
  w: number;
  h: number;
}

export interface PositionedTopic {
  id: string;
  level: number;
  side: 'right' | 'left' | 'none';
  box: Box;
}

export interface LayoutResult {
  boxes: Map<string, Box>;
  sides: Map<string, 'right' | 'left' | 'none'>;
  levels: Map<string, number>;
}

export const CHILD_GAP = 16; // sibling gap in the mind map
export const ORG_SIBLING_GAP = 24;
export const ORG_LEVEL_GAP = 60;
export const LIST_ROW_GAP = 8;
export const LIST_INDENT = 32;
export const CONNECT_LEN = 80;

export function wrapLines(title: string, limit: number): number {
  const words = title.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return 1;
  let lines = 1;
  let len = 0;
  for (const word of words) {
    if (len === 0) {
      // A word longer than the limit starts a new line and is cut into pieces.
      lines += Math.floor(word.length / limit) - (word.length % limit === 0 ? 1 : 0);
      if (word.length > limit && word.length % limit === 0) lines -= 0;
      len = word.length % limit === 0 ? limit : word.length % limit;
      if (word.length <= limit) len = word.length;
    } else if (len + 1 + word.length <= limit) {
      len += 1 + word.length;
    } else if (word.length > limit) {
      lines += Math.floor((word.length + limit - 1) / limit) - 1;
      len = word.length % limit === 0 ? limit : word.length % limit;
    } else {
      lines += 1;
      len = word.length;
    }
  }
  return lines;
}

export function boxSize(topic: TopicNode, isRoot: boolean): Box {
  const limit = isRoot ? 24 : 18;
  const lines = wrapLines(topic.title, limit);
  const w = isRoot ? 240 : 180;
  const h = isRoot ? 48 + 20 * (lines - 1) : 32 + 20 * (lines - 1);
  return { x: 0, y: 0, w, h };
}

interface Tree {
  id: string;
  children: Tree[];
  size: Box;
  topic: TopicNode;
  level: number;
  pinned: 'left' | 'right' | null;
  side: 'right' | 'left' | 'none';
  box: Box;
  extent: number;
}

function buildForest(topics: TopicNode[]): Tree[] {
  const byParent = new Map<string | null, Tree[]>();
  const byId = new Map<string, Tree>();
  for (const t of topics) {
    const node: Tree = {
      id: t.id, children: [], size: boxSize(t, t.parent_id === null && !t.floating),
      topic: t, level: 0, pinned: t.side_pin, side: 'none', box: { x: 0, y: 0, w: 0, h: 0 }, extent: 0,
    };
    byId.set(t.id, node);
    const arr = byParent.get(t.parent_id) ?? [];
    arr.push(node);
    byParent.set(t.parent_id, arr);
  }
  for (const t of topics) {
    const node = byId.get(t.id)!;
    node.children = (byParent.get(t.id) ?? []).sort((a, b) => a.topic.rank - b.topic.rank);
  }
  const roots = byParent.get(null) ?? [];
  return roots.sort((a, b) => a.topic.rank - b.topic.rank);
}

/** E(t): subtree extent used by the mind map side-by-side stack. */
function mindExtent(node: Tree, visible: (id: string) => boolean): number {
  if (!visible(node.id) || node.children.length === 0) {
    node.extent = node.size.h;
    return node.extent;
  }
  let sum = 0;
  for (const c of node.children) sum += mindExtent(c, visible);
  node.extent = Math.max(node.size.h, sum + CHILD_GAP * (node.children.length - 1));
  return node.extent;
}

function orgExtentX(node: Tree, visible: (id: string) => boolean): number {
  for (const c of node.children) orgExtentX(c, visible);
  const kids = node.children.filter((c) => visible(c.id));
  if (kids.length === 0) {
    node.box = { ...node.size };
    return node.size.w;
  }
  const sum = kids.reduce((s, c) => s + c.box.w, 0);
  const w = Math.max(node.size.w, sum + ORG_SIBLING_GAP * (kids.length - 1));
  node.box = { x: 0, y: 0, w, h: node.size.h };
  return w;
}

function stackChildren(node: Tree, side: 'right' | 'left', centreY: number, parentX: number, parentW: number, startTop: number, visible: (id: string) => boolean): void {
  const kids = node.children.filter((c) => visible(c.id));
  if (kids.length === 0) return;
  const height = kids.reduce((s, c) => s + c.extent, 0) + CHILD_GAP * (kids.length - 1);
  let top = startTop;
  for (const c of kids) {
    const cy = top + c.extent / 2;
    const size = c.size;
    const cx = side === 'right'
      ? parentX + parentW / 2 + CONNECT_LEN + size.w / 2
      : parentX - parentW / 2 - CONNECT_LEN - size.w / 2;
    c.box = { x: cx, y: cy, w: size.w, h: size.h };
    c.side = side;
    stackChildren(c, side, cy, cx, size.w, top, visible);
    top += c.extent + CHILD_GAP;
  }
  void centreY;
}

/**
 * Layout for the whole map as one viewer sees it.
 * `collapsed` is that viewer's private collapse set.
 */
export function layoutMap(
  topics: TopicNode[],
  layout: Layout,
  collapsed: Set<string>,
  visibleOverride?: (id: string) => boolean,
): LayoutResult {
  const visible = visibleOverride ?? ((id: string) => !collapsed.has(id));
  const forest = buildForest(topics);
  const boxes = new Map<string, Box>();
  const sides = new Map<string, 'right' | 'left' | 'none'>();
  const levels = new Map<string, number>();

  const mainRoot = forest.find((t) => t.topic.parent_id === null && !t.topic.floating) ?? null;
  const floaters = forest.filter((t) => t.topic.floating);
  const allTrees = mainRoot ? [mainRoot, ...floaters] : floaters;

  const walkLevels = (node: Tree, level: number) => {
    levels.set(node.id, level);
    node.level = level;
    for (const c of node.children) walkLevels(c, level + 1);
  };
  for (const t of allTrees) walkLevels(t, 1);

  if (layout === 'map') {
    for (const t of allTrees) mindExtent(t, visible);
    const placeMind = (root: Tree) => {
      const rootBox = boxSize(root.topic, true);
      const rbox: Box = { x: 0, y: 0, w: rootBox.w, h: rootBox.h };
      root.box = rbox;
      root.side = root === mainRoot ? 'none' : 'right';
      const kids = root.children.filter((c) => visible(c.id));
      if (kids.length === 0) return;
      // Side assignment: pins first, then running totals, ties to the right.
      const pinnedRight: Tree[] = [];
      const pinnedLeft: Tree[] = [];
      const rest: Tree[] = [];
      for (const c of kids) {
        if (c.pinned === 'right') pinnedRight.push(c);
        else if (c.pinned === 'left') pinnedLeft.push(c);
        else rest.push(c);
      }
      const totals = { right: 0, left: 0 };
      const counts = { right: 0, left: 0 };
      const assign = (c: Tree, side: 'right' | 'left') => {
        c.side = side;
        totals[side] += c.extent;
        counts[side] += 1;
      };
      for (const c of pinnedRight) assign(c, 'right');
      for (const c of pinnedLeft) assign(c, 'left');
      for (const c of rest) {
        const rightTotal = totals.right + 16 * counts.right;
        const leftTotal = totals.left + 16 * counts.left;
        assign(c, rightTotal <= leftTotal ? 'right' : 'left');
      }
      const bySide: Record<'right' | 'left', Tree[]> = { right: [], left: [] };
      for (const c of kids) {
        if (c.side === 'right' || c.side === 'left') bySide[c.side].push(c);
      }
      const height = (arr: Tree[]) => arr.reduce((s, c) => s + c.extent, 0) + CHILD_GAP * Math.max(0, arr.length - 1);
      for (const side of ['right', 'left'] as const) {
        const arr = bySide[side];
        if (arr.length === 0) continue;
        const total = height(arr);
        let top = -total / 2;
        for (const c of arr) {
          const cy = top + c.extent / 2;
          const cx = side === 'right'
            ? rbox.x + rbox.w / 2 + CONNECT_LEN + c.size.w / 2
            : rbox.x - rbox.w / 2 - CONNECT_LEN - c.size.w / 2;
          c.box = { x: cx, y: cy, w: c.size.w, h: c.size.h };
          stackChildren(c, side, cy, cx, c.size.w, top, visible);
          top += c.extent + CHILD_GAP;
        }
      }
    };
    if (mainRoot) placeMind(mainRoot);
    for (const f of floaters) placeMind(f);
  } else if (layout === 'org') {
    for (const t of allTrees) orgExtentX(t, visible);
    const placeOrg = (root: Tree) => {
      root.box = { x: 0, y: 0, w: root.box.w, h: root.size.h };
      root.side = 'none';
      const walk = (node: Tree) => {
        const kids = node.children.filter((c) => visible(c.id));
        if (kids.length === 0) return;
        const totalW = kids.reduce((s, c) => s + c.box.w, 0) + ORG_SIBLING_GAP * (kids.length - 1);
        let left = node.box.x - totalW / 2;
        for (const c of kids) {
          const cx = left + c.box.w / 2;
          const cy = node.box.y + node.box.h / 2 + ORG_LEVEL_GAP + c.size.h / 2;
          c.box = { x: cx, y: cy, w: c.box.w, h: c.size.h };
          c.side = 'none';
          walk(c);
          left += c.box.w + ORG_SIBLING_GAP;
        }
      };
      walk(root);
    };
    for (const t of allTrees) placeOrg(t);
  } else {
    // List: one depth-first row stream over every tree, main root first.
    let cursor = 0;
    for (const t of allTrees) {
      const walk = (node: Tree, level: number, top: number): number => {
        const size = boxSize(node.topic, node === t);
        const leftEdge = node.topic.floating && node === t ? 0 : LIST_INDENT * (level - 1);
        node.box = { x: leftEdge + size.w / 2, y: top + size.h / 2, w: size.w, h: size.h };
        node.side = 'none';
        let nextTop = top + size.h + LIST_ROW_GAP;
        for (const c of node.children) {
          if (!visible(c.id)) continue;
          nextTop = walk(c, level + 1, nextTop) + LIST_ROW_GAP;
        }
        return nextTop - LIST_ROW_GAP;
      };
      const end = walk(t, 1, cursor);
      cursor = end + LIST_ROW_GAP;
    }
  }

  const collect = (node: Tree) => {
    boxes.set(node.id, node.box);
    sides.set(node.id, node.side);
    levels.set(node.id, node.level);
    for (const c of node.children) collect(c);
  };
  for (const t of allTrees) collect(t);

  const result: LayoutResult = { boxes, sides, levels };
  return result;
}

/** Boundary box: union of the visible boxes of a branch, plus 12 each side. */
export function boundaryBox(topicId: string, boxes: Map<string, Box>, childrenOf: (id: string) => string[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (id: string) => {
    const b = boxes.get(id);
    if (b) {
      minX = Math.min(minX, b.x - b.w / 2);
      minY = Math.min(minY, b.y - b.h / 2);
      maxX = Math.max(maxX, b.x + b.w / 2);
      maxY = Math.max(maxY, b.y + b.h / 2);
    }
    for (const c of childrenOf(id)) walk(c);
  };
  walk(topicId);
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX + 24, h: maxY - minY + 24 };
}

export function connectorsFor(topics: TopicNode[], layout: Layout, collapsed: Set<string>, visibleOverride?: (id: string) => boolean): { child: string; parent: string }[] {
  const visible = visibleOverride ?? ((id: string) => !collapsed.has(id));
  const res: { child: string; parent: string }[] = [];
  for (const t of topics) {
    if (t.parent_id === null) continue;
    if (!visible(t.id)) continue;
    // The parent is always drawn (it is on the path to the child).
    void layout;
    res.push({ child: t.id, parent: t.parent_id });
  }
  return res;
}

/** Visible ancestor for cross-link ends hidden by collapse or restriction. */
export function drawnEnd(topicId: string, visible: (id: string) => boolean, parentOf: (id: string) => string | null): string {
  let cur: string | null = topicId;
  while (cur !== null) {
    if (visible(cur)) return cur;
    cur = parentOf(cur);
  }
  return topicId;
}

export function linksDrawn(links: CrossLink[], boundaries: Boundary[], visible: (id: string) => boolean, parentOf: (id: string) => string | null): { from: string; to: string; link: CrossLink }[] {
  void boundaries;
  const out: { from: string; to: string; link: CrossLink }[] = [];
  for (const l of links) {
    const from = drawnEnd(l.from, visible, parentOf);
    const to = drawnEnd(l.to, visible, parentOf);
    if (from === to) continue;
    out.push({ from, to, link: l });
  }
  return out;
}
