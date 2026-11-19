import { visibleChildren, type MapView } from './tree.js';
import type { LaidOutTopic, LayoutMode, LayoutResult, SideName } from './types.js';

export const ROOT_WRAP = 24;
export const TOPIC_WRAP = 18;
export const ROOT_WIDTH = 240;
export const TOPIC_WIDTH = 180;
export const ROOT_BASE_HEIGHT = 48;
export const TOPIC_BASE_HEIGHT = 32;
export const LINE_HEIGHT = 20;
export const SIBLING_GAP = 16;
export const MIND_GAP = 80;
export const ORG_SIBLING_GAP = 24;
export const ORG_LEVEL_GAP = 60;
export const LIST_INDENT = 32;
export const LIST_ROW_GAP = 8;
export const BOUNDARY_PAD = 12;

/** Greedy wrapping by code points. Returns the laid-out lines. */
export function wrapTitle(title: string, limit: number): string[] {
  const words = title.split(' ').filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = '';
  const placeAlone = (word: string): void => {
    let rest = [...word];
    while (rest.length > limit) {
      lines.push(rest.slice(0, limit).join(''));
      rest = rest.slice(limit);
    }
    line = rest.join('');
  };
  for (const word of words) {
    const wordLength = [...word].length;
    if (line === '') {
      placeAlone(word);
      continue;
    }
    if ([...line].length + 1 + wordLength <= limit) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = '';
      placeAlone(word);
    }
  }
  if (line !== '' || lines.length === 0) lines.push(line);
  return lines;
}

export function lineCount(title: string, isRoot: boolean): number {
  return wrapTitle(title, isRoot ? ROOT_WRAP : TOPIC_WRAP).length;
}

export function topicWidth(isRoot: boolean): number {
  return isRoot ? ROOT_WIDTH : TOPIC_WIDTH;
}

export function topicHeight(title: string, isRoot: boolean): number {
  const lines = lineCount(title, isRoot);
  return (isRoot ? ROOT_BASE_HEIGHT : TOPIC_BASE_HEIGHT) + LINE_HEIGHT * (lines - 1);
}

interface Metrics {
  width: (id: string) => number;
  height: (id: string) => number;
  children: (id: string) => string[];
}

function metricsFor(view: MapView): Metrics {
  const widths = new Map<string, number>();
  const heights = new Map<string, number>();
  const isRoot = (id: string): boolean => id === view.doc.root;
  return {
    width: (id) => {
      let value = widths.get(id);
      if (value === undefined) {
        value = topicWidth(isRoot(id));
        widths.set(id, value);
      }
      return value;
    },
    height: (id) => {
      let value = heights.get(id);
      if (value === undefined) {
        value = topicHeight(view.doc.topics[id]?.title ?? '', isRoot(id));
        heights.set(id, value);
      }
      return value;
    },
    children: (id) => visibleChildren(view, id),
  };
}

/** Vertical extent of a subtree, used by the mind map layout. */
function extent(m: Metrics, id: string, cache: Map<string, number>): number {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const children = m.children(id);
  let value = m.height(id);
  if (children.length > 0) {
    let sum = 0;
    for (const child of children) sum += extent(m, child, cache);
    sum += SIBLING_GAP * (children.length - 1);
    value = Math.max(value, sum);
  }
  cache.set(id, value);
  return value;
}

/** Horizontal extent of a subtree, used by the org chart layout. */
function orgExtent(m: Metrics, id: string, cache: Map<string, number>): number {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const children = m.children(id);
  let value = m.width(id);
  if (children.length > 0) {
    let sum = 0;
    for (const child of children) sum += orgExtent(m, child, cache);
    sum += ORG_SIBLING_GAP * (children.length - 1);
    value = Math.max(value, sum);
  }
  cache.set(id, value);
  return value;
}

function place(
  out: LayoutResult,
  m: Metrics,
  id: string,
  x: number,
  y: number,
  side: SideName,
  level: number,
): LaidOutTopic {
  const laid: LaidOutTopic = {
    id,
    x: Math.round(x),
    y: Math.round(y),
    w: m.width(id),
    h: m.height(id),
    side,
    level,
  };
  out.set(id, laid);
  return laid;
}

/** Stacks a column of same-side descendants centred on the parent's y. */
function mindStack(
  out: LayoutResult,
  m: Metrics,
  ids: string[],
  cache: Map<string, number>,
  parentX: number,
  parentWidth: number,
  parentY: number,
  side: 'left' | 'right',
  level: number,
): void {
  if (ids.length === 0) return;
  let height = SIBLING_GAP * (ids.length - 1);
  for (const id of ids) height += extent(m, id, cache);
  let top = parentY - height / 2;
  for (const id of ids) {
    const e = extent(m, id, cache);
    const width = m.width(id);
    const x =
      side === 'right'
        ? parentX + parentWidth / 2 + MIND_GAP + width / 2
        : parentX - (parentWidth / 2 + MIND_GAP + width / 2);
    const y = top + e / 2;
    place(out, m, id, x, y, side, level);
    mindStack(out, m, m.children(id), cache, x, width, y, side, level + 1);
    top = top + e + SIBLING_GAP;
  }
}

function layoutMindRoot(
  out: LayoutResult,
  m: Metrics,
  rootId: string,
  originX: number,
  originY: number,
  level: number,
  balanced: boolean,
  pins: (id: string) => 'left' | 'right' | null,
): void {
  const cache = new Map<string, number>();
  const rootWidth = m.width(rootId);
  place(out, m, rootId, originX, originY, 'none', level);
  const children = m.children(rootId);
  const right: string[] = [];
  const left: string[] = [];
  if (balanced) {
    const pinned = children.filter((id) => pins(id) !== null);
    const free = children.filter((id) => pins(id) === null);
    for (const id of pinned) (pins(id) === 'left' ? left : right).push(id);
    const total = (ids: string[]): number => {
      let sum = 0;
      for (const id of ids) sum += extent(m, id, cache) + SIBLING_GAP;
      return sum;
    };
    for (const id of free) {
      if (total(right) <= total(left)) right.push(id);
      else left.push(id);
    }
  } else {
    right.push(...children);
  }
  mindStack(out, m, right, cache, originX, rootWidth, originY, 'right', level + 1);
  mindStack(out, m, left, cache, originX, rootWidth, originY, 'left', level + 1);
}

function layoutOrgRoot(
  out: LayoutResult,
  m: Metrics,
  rootId: string,
  originX: number,
  originY: number,
  level: number,
): void {
  const cache = new Map<string, number>();
  const walk = (id: string, cx: number, cy: number, depth: number): void => {
    place(out, m, id, cx, cy, 'none', depth);
    const children = m.children(id);
    if (children.length === 0) return;
    let span = ORG_SIBLING_GAP * (children.length - 1);
    for (const child of children) span += orgExtent(m, child, cache);
    let start = cx - span / 2;
    const parentHeight = m.height(id);
    for (const child of children) {
      const childExtent = orgExtent(m, child, cache);
      const childX = start + childExtent / 2;
      const childY = cy + parentHeight / 2 + ORG_LEVEL_GAP + m.height(child) / 2;
      walk(child, childX, childY, depth + 1);
      start = start + childExtent + ORG_SIBLING_GAP;
    }
  };
  walk(rootId, originX, originY, level);
}

export function layoutMap(view: MapView, mode: LayoutMode): LayoutResult {
  const out: LayoutResult = new Map();
  const m = metricsFor(view);
  const doc = view.doc;
  const rootVisible = !view.hidden.has(doc.root);
  const floating = doc.floating.filter((id) => !view.hidden.has(id) && doc.topics[id]);
  const pins = (id: string): 'left' | 'right' | null => doc.topics[id]?.side_pin ?? null;

  if (mode === 'list') {
    let top = 0;
    const walk = (id: string, level: number): void => {
      const width = m.width(id);
      const height = m.height(id);
      const left = LIST_INDENT * (level - 1);
      place(out, m, id, left + width / 2, top + height / 2, 'none', level);
      top = top + height + LIST_ROW_GAP;
      for (const child of m.children(id)) walk(child, level + 1);
    };
    if (rootVisible) walk(doc.root, 1);
    for (const id of floating) walk(id, 1);
    return out;
  }

  if (mode === 'org') {
    if (rootVisible) layoutOrgRoot(out, m, doc.root, 0, 0, 1);
    for (const id of floating) {
      const t = doc.topics[id];
      layoutOrgRoot(out, m, id, t.x ?? 0, t.y ?? 0, 1);
    }
    return out;
  }

  if (rootVisible) layoutMindRoot(out, m, doc.root, 0, 0, 1, true, pins);
  for (const id of floating) {
    const t = doc.topics[id];
    layoutMindRoot(out, m, id, t.x ?? 0, t.y ?? 0, 1, false, pins);
  }
  return out;
}

export function lowestBottom(layout: LayoutResult): number {
  let bottom = 0;
  let seen = false;
  for (const laid of layout.values()) {
    const value = laid.y + laid.h / 2;
    if (!seen || value > bottom) {
      bottom = value;
      seen = true;
    }
  }
  return seen ? bottom : 0;
}

export function boundingBox(
  layout: LayoutResult,
): { x: number; y: number; w: number; h: number } | null {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let seen = false;
  for (const laid of layout.values()) {
    const left = laid.x - laid.w / 2;
    const right = laid.x + laid.w / 2;
    const top = laid.y - laid.h / 2;
    const bottom = laid.y + laid.h / 2;
    if (!seen) {
      minX = left;
      maxX = right;
      minY = top;
      maxY = bottom;
      seen = true;
    } else {
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, right);
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, bottom);
    }
  }
  if (!seen) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The point a new floating topic takes. */
export function nextFloatingSpot(view: MapView): { x: number; y: number } {
  const layout = layoutMap(view, 'map');
  const rootX = layout.get(view.doc.root)?.x ?? 0;
  return { x: rootX, y: lowestBottom(layout) + 120 };
}
