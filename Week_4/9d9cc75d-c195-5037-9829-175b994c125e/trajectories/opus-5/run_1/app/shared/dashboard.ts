import type { DashboardObject, LayoutNode } from './types.js';

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 800;
const GAP = 8;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function sheetsOf(node: LayoutNode): string[] {
  if (node.sheet !== undefined) return [node.sheet];
  return (node.children ?? []).flatMap(sheetsOf);
}

export function layoutSheets(layout: LayoutNode): string[] {
  return sheetsOf(layout);
}

function place(
  node: LayoutNode,
  box: Box,
  hidden: Set<string>,
  out: Map<string, Box>,
): void {
  if (node.sheet !== undefined) {
    out.set(node.sheet, box);
    return;
  }
  const horizontal = node.type !== 'vertical';
  const children = (node.children ?? []).filter((child) => sheetsOf(child).some((s) => !hidden.has(s)));
  if (children.length === 0) return;
  const total = horizontal ? box.w : box.h;
  const inner = total - GAP * (children.length - 1);
  const fixedTotal = children.reduce((sum, child) => sum + (child.fixed ?? 0), 0);
  const flexible = children.filter((child) => (child.fixed ?? null) === null);
  const share = flexible.length === 0 ? 0 : Math.floor((inner - fixedTotal) / flexible.length);
  let leftover = flexible.length === 0 ? 0 : inner - fixedTotal - share * flexible.length;
  let offset = horizontal ? box.x : box.y;
  for (const child of children) {
    let length = child.fixed ?? share;
    if ((child.fixed ?? null) === null && leftover > 0) {
      length += 1;
      leftover -= 1;
    }
    const childBox: Box = horizontal
      ? { x: offset, y: box.y, w: length, h: box.h }
      : { x: box.x, y: offset, w: box.w, h: length };
    place(child, childBox, hidden, out);
    offset += length + GAP;
  }
}

export function dashboardObjects(
  layout: LayoutNode,
  floating: { sheet: string; x: number; y: number; w: number; h: number }[],
  names: Map<string, string>,
  hidden: Set<string> = new Set(),
): DashboardObject[] {
  const boxes = new Map<string, Box>();
  place(layout, { x: 0, y: 0, w: STAGE_WIDTH, h: STAGE_HEIGHT }, hidden, boxes);
  const tiled: DashboardObject[] = [];
  for (const sheet of sheetsOf(layout)) {
    const box = boxes.get(sheet);
    if (box === undefined) continue;
    tiled.push({
      sheet,
      name: names.get(sheet) ?? sheet,
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.w),
      h: Math.round(box.h),
      floating: false,
    });
  }
  const float = floating
    .filter((f) => !hidden.has(f.sheet))
    .map((f) => ({
      sheet: f.sheet,
      name: names.get(f.sheet) ?? f.sheet,
      x: Math.round(f.x),
      y: Math.round(f.y),
      w: Math.round(f.w),
      h: Math.round(f.h),
      floating: true,
    }));
  return [...tiled, ...float];
}

export function nestingDepth(node: LayoutNode, depth = 0): number {
  if (node.sheet !== undefined) return depth;
  return Math.max(depth, ...(node.children ?? []).map((child) => nestingDepth(child, depth + 1)));
}
