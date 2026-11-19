import type { DocTopic, LayoutMode, MapDoc } from './model.ts';
import { childrenIndex, floatingOf, rootOf } from './tree.ts';

const ROOT_WIDTH = 240;
const ROOT_HEIGHT = 48;
const TOPIC_WIDTH = 180;
const TOPIC_HEIGHT = 32;
export const LINE_HEIGHT = 20;
const ROOT_LINE_LIMIT = 24;
const TOPIC_LINE_LIMIT = 18;
const SIBLING_GAP = 16;
const LEVEL_GAP = 80;
const ORG_SIBLING_GAP = 24;
const ORG_LEVEL_GAP = 60;
const LIST_INDENT = 32;
const LIST_GAP = 8;
const FLOAT_DROP = 120;
export const BOUNDARY_PAD = 12;

type BoxSide = 'left' | 'right' | 'none';

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  side: BoxSide;
  level: number;
  lines: string[];
}

export interface Layout {
  boxes: Map<string, Box>;
  /** Visible topics in list order: the main tree depth-first, then each floating topic's branch. */
  order: string[];
}

const half = (n: number): number => Math.floor(n / 2);

/** Greedy word wrap that counts code points. */
function wrapTitle(title: string, limit: number): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) lines.push(current.join(''));
    current = [];
  };
  for (const word of title.split(' ').filter((w) => w.length > 0)) {
    const letters = Array.from(word);
    if (current.length > 0 && current.length + 1 + letters.length <= limit) {
      current.push(' ', ...letters);
      continue;
    }
    flush();
    if (letters.length <= limit) {
      current = letters;
      continue;
    }
    for (let at = 0; at < letters.length; at += limit) {
      const piece = letters.slice(at, at + limit);
      if (at + limit >= letters.length) current = piece;
      else lines.push(piece.join(''));
    }
  }
  flush();
  return lines.length > 0 ? lines : [''];
}

function boxSize(title: string, isRoot: boolean): { w: number; h: number; lines: string[] } {
  const lines = wrapTitle(title, isRoot ? ROOT_LINE_LIMIT : TOPIC_LINE_LIMIT);
  const extra = LINE_HEIGHT * (lines.length - 1);
  return isRoot ? { w: ROOT_WIDTH, h: ROOT_HEIGHT + extra, lines } : { w: TOPIC_WIDTH, h: TOPIC_HEIGHT + extra, lines };
}

interface Context {
  topics: MapDoc['topics'];
  kids: (id: string) => DocTopic[];
  boxes: Map<string, Box>;
  size: Map<string, { w: number; h: number; lines: string[] }>;
}

const sizeOf = (ctx: Context, topic: DocTopic): { w: number; h: number; lines: string[] } => {
  let size = ctx.size.get(topic.id);
  if (!size) {
    size = boxSize(topic.title, topic.parent_id === null && !topic.floating);
    ctx.size.set(topic.id, size);
  }
  return size;
};

function place(ctx: Context, topic: DocTopic, x: number, y: number, side: BoxSide, level: number): Box {
  const size = sizeOf(ctx, topic);
  const box: Box = { id: topic.id, x, y, w: size.w, h: size.h, side, level, lines: size.lines };
  ctx.boxes.set(topic.id, box);
  return box;
}

// ------------------------------------------------------------------ mind map

function extentY(ctx: Context, topic: DocTopic, memo: Map<string, number>): number {
  const known = memo.get(topic.id);
  if (known !== undefined) return known;
  const children = ctx.kids(topic.id);
  const own = sizeOf(ctx, topic).h;
  const stacked = children.reduce((sum, c) => sum + extentY(ctx, c, memo), 0) + SIBLING_GAP * Math.max(0, children.length - 1);
  const value = children.length === 0 ? own : Math.max(own, stacked);
  memo.set(topic.id, value);
  return value;
}

function growSide(ctx: Context, parent: Box, topic: DocTopic, side: 'left' | 'right', memo: Map<string, number>): void {
  const children = ctx.kids(topic.id);
  if (children.length === 0) return;
  const total = children.reduce((sum, c) => sum + extentY(ctx, c, memo), 0) + SIBLING_GAP * (children.length - 1);
  stackColumn(ctx, parent, children, side, parent.y - half(total), memo, parent.level + 1);
}

function stackColumn(
  ctx: Context,
  parent: Box,
  column: DocTopic[],
  side: 'left' | 'right',
  firstTop: number,
  memo: Map<string, number>,
  level: number,
): void {
  let top = firstTop;
  for (const child of column) {
    const extent = extentY(ctx, child, memo);
    const size = sizeOf(ctx, child);
    const reach = half(parent.w) + LEVEL_GAP + half(size.w);
    const box = place(ctx, child, parent.x + (side === 'right' ? reach : -reach), top + half(extent), side, level);
    growSide(ctx, box, child, side, memo);
    top += extent + SIBLING_GAP;
  }
}

function layoutMindRoot(ctx: Context, root: DocTopic, cx: number, cy: number, floating: boolean, memo: Map<string, number>): void {
  const rootBox = place(ctx, root, cx, cy, 'none', 1);
  const children = ctx.kids(root.id);
  if (children.length === 0) return;
  if (floating) {
    growSide(ctx, rootBox, root, 'right', memo);
    return;
  }
  const sideOf = new Map<string, 'left' | 'right'>();
  const totals = { left: 0, right: 0 };
  const take = (child: DocTopic, side: 'left' | 'right'): void => {
    sideOf.set(child.id, side);
    totals[side] += extentY(ctx, child, memo) + SIBLING_GAP;
  };
  for (const child of children) if (child.side_pin) take(child, child.side_pin);
  for (const child of children) if (!child.side_pin) take(child, totals.right <= totals.left ? 'right' : 'left');
  for (const side of ['right', 'left'] as const) {
    const column = children.filter((c) => sideOf.get(c.id) === side);
    if (column.length === 0) continue;
    const total = column.reduce((sum, c) => sum + extentY(ctx, c, memo), 0) + SIBLING_GAP * (column.length - 1);
    stackColumn(ctx, rootBox, column, side, cy - half(total), memo, 2);
  }
}

// ------------------------------------------------------------------ org chart

function extentX(ctx: Context, topic: DocTopic, memo: Map<string, number>): number {
  const known = memo.get(topic.id);
  if (known !== undefined) return known;
  const children = ctx.kids(topic.id);
  const own = sizeOf(ctx, topic).w;
  const spread = children.reduce((sum, c) => sum + extentX(ctx, c, memo), 0) + ORG_SIBLING_GAP * Math.max(0, children.length - 1);
  const value = children.length === 0 ? own : Math.max(own, spread);
  memo.set(topic.id, value);
  return value;
}

function growOrg(ctx: Context, parent: Box, topic: DocTopic, memo: Map<string, number>): void {
  const children = ctx.kids(topic.id);
  if (children.length === 0) return;
  const total = children.reduce((sum, c) => sum + extentX(ctx, c, memo), 0) + ORG_SIBLING_GAP * (children.length - 1);
  let left = parent.x - half(total);
  for (const child of children) {
    const extent = extentX(ctx, child, memo);
    const size = sizeOf(ctx, child);
    const y = parent.y + half(parent.h) + ORG_LEVEL_GAP + half(size.h);
    const box = place(ctx, child, left + half(extent), y, 'none', parent.level + 1);
    growOrg(ctx, box, child, memo);
    left += extent + ORG_SIBLING_GAP;
  }
}

// ----------------------------------------------------------------------- list

function layoutList(ctx: Context, roots: DocTopic[]): { top: number } {
  let top = 0;
  const walk = (topic: DocTopic, level: number): void => {
    const size = sizeOf(ctx, topic);
    const left = LIST_INDENT * (level - 1);
    place(ctx, topic, left + half(size.w), top + half(size.h), 'none', level);
    top += size.h + LIST_GAP;
    for (const child of ctx.kids(topic.id)) walk(child, level + 1);
  };
  for (const root of roots) walk(root, 1);
  return { top };
}

/** The layout engine: a pure function of the tree, my collapsed topics and the layout mode. */
export function layoutDoc(doc: MapDoc, collapsed: ReadonlySet<string>, mode: LayoutMode = doc.layout): Layout {
  const index = childrenIndex(doc.topics);
  const ctx: Context = {
    topics: doc.topics,
    kids: (id) => (collapsed.has(id) ? [] : index.get(id) ?? []),
    boxes: new Map(),
    size: new Map(),
  };
  const root = rootOf(doc.topics);
  const floating = floatingOf(doc.topics);
  if (mode === 'list') {
    layoutList(ctx, root ? [root, ...floating] : floating);
  } else {
    const memo = new Map<string, number>();
    if (root) {
      if (mode === 'map') layoutMindRoot(ctx, root, 0, 0, false, memo);
      else {
        const box = place(ctx, root, 0, 0, 'none', 1);
        growOrg(ctx, box, root, memo);
      }
    }
    for (const f of floating) {
      const cx = f.x ?? 0;
      const cy = f.y ?? 0;
      if (mode === 'map') layoutMindRoot(ctx, f, cx, cy, true, memo);
      else {
        const box = place(ctx, f, cx, cy, 'none', 1);
        growOrg(ctx, box, f, memo);
      }
    }
  }
  return { boxes: ctx.boxes, order: listOrder(ctx, root, floating) };
}

function listOrder(ctx: Context, root: DocTopic | undefined, floating: DocTopic[]): string[] {
  const order: string[] = [];
  const walk = (topic: DocTopic): void => {
    order.push(topic.id);
    for (const child of ctx.kids(topic.id)) walk(child);
  };
  if (root) walk(root);
  for (const f of floating) walk(f);
  return order;
}

/** The connector between a parent box and a child box, drawn the same way on screen, in miniatures, in the audience and in SVG exports. */
export function connectorPath(mode: LayoutMode, parent: Box, child: Box): string {
  if (mode === 'org') {
    const from = parent.y + half(parent.h);
    const to = child.y - half(child.h);
    const mid = (from + to) / 2;
    return `M${parent.x},${from} C${parent.x},${mid} ${child.x},${mid} ${child.x},${to}`;
  }
  if (mode === 'list') {
    const trunk = parent.x - half(parent.w) + LIST_INDENT / 2;
    return `M${trunk},${parent.y + half(parent.h)} V${child.y} H${child.x - half(child.w)}`;
  }
  const direction = child.x >= parent.x ? 1 : -1;
  const from = parent.x + direction * half(parent.w);
  const to = child.x - direction * half(child.w);
  const mid = (from + to) / 2;
  return `M${from},${parent.y} C${mid},${parent.y} ${mid},${child.y} ${to},${child.y}`;
}

/** Where Alt+Enter puts a new floating topic: under the lowest box, one drop below it. */
export function floatingDrop(layout: Layout, rootX: number): { x: number; y: number } {
  let lowest = 0;
  for (const box of layout.boxes.values()) lowest = Math.max(lowest, box.y + half(box.h));
  return { x: rootX, y: lowest + FLOAT_DROP };
}

interface BoundaryRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A boundary wraps its topic and every visible descendant, with a pad on each side. */
export function boundaryRect(layout: Layout, doc: MapDoc, topicId: string): BoundaryRect | null {
  const index = childrenIndex(doc.topics);
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const walk = (id: string): void => {
    const box = layout.boxes.get(id);
    if (!box) return;
    left = Math.min(left, box.x - half(box.w));
    right = Math.max(right, box.x - half(box.w) + box.w);
    top = Math.min(top, box.y - half(box.h));
    bottom = Math.max(bottom, box.y - half(box.h) + box.h);
    for (const child of index.get(id) ?? []) walk(child.id);
  };
  walk(topicId);
  if (!Number.isFinite(left)) return null;
  const w = right - left + 2 * BOUNDARY_PAD;
  const h = bottom - top + 2 * BOUNDARY_PAD;
  return { x: left - BOUNDARY_PAD + half(w), y: top - BOUNDARY_PAD + half(h), w, h };
}
