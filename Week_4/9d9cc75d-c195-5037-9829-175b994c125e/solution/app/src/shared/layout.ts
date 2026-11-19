// The dashboard sizing rule, used by the server for `objects` and by the browser to reflow when an object is hidden.
import type { DashboardObject, FloatingObject, LayoutContainer, LayoutSheet } from './model.ts';

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 800;
const GAP = 8;

type PlacedObject = Omit<DashboardObject, 'name'>;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isContainer(child: LayoutSheet | LayoutContainer): child is LayoutContainer {
  return 'children' in child;
}

function shows(child: LayoutSheet | LayoutContainer, hidden: ReadonlySet<string>): boolean {
  return isContainer(child) ? child.children.some((c) => shows(c, hidden)) : !hidden.has(child.sheet);
}

/** Lengths along the container's axis: fixed children take their size, flexible ones split the rest, leftovers to the first. */
function lengths(children: readonly (LayoutSheet | LayoutContainer)[], length: number): number[] {
  const inner = length - GAP * (children.length - 1);
  const fixedTotal = children.reduce((sum, c) => sum + (!isContainer(c) && c.fixed !== null ? c.fixed : 0), 0);
  const flexible = children.filter((c) => isContainer(c) || c.fixed === null).length;
  const remaining = Math.max(0, inner - fixedTotal);
  const share = flexible === 0 ? 0 : Math.floor(remaining / flexible);
  let leftover = flexible === 0 ? 0 : remaining - share * flexible;
  return children.map((c) => {
    if (!isContainer(c) && c.fixed !== null) return c.fixed;
    if (leftover > 0) {
      leftover--;
      return share + 1;
    }
    return share;
  });
}

function place(container: LayoutContainer, box: Box, hidden: ReadonlySet<string>, out: PlacedObject[]): void {
  const across = container.type === 'horizontal';
  const visible = container.children.filter((c) => shows(c, hidden));
  const sizes = lengths(visible, across ? box.w : box.h);
  let offset = across ? box.x : box.y;
  visible.forEach((child, i) => {
    const size = sizes[i] ?? 0;
    const childBox = across ? { x: offset, y: box.y, w: size, h: box.h } : { x: box.x, y: offset, w: box.w, h: size };
    if (isContainer(child)) place(child, childBox, hidden, out);
    else out.push({ sheet: child.sheet, ...childBox, floating: false });
    offset += size + GAP;
  });
}

/** Every shown object on the 1280 by 800 stage: tiled sheets in layout order, then floating ones with their own box. */
export function placeObjects(
  layout: LayoutContainer,
  floating: readonly FloatingObject[],
  hidden: ReadonlySet<string> = new Set(),
): PlacedObject[] {
  const out: PlacedObject[] = [];
  place(layout, { x: 0, y: 0, w: STAGE_WIDTH, h: STAGE_HEIGHT }, hidden, out);
  for (const f of floating) {
    if (!hidden.has(f.sheet)) out.push({ sheet: f.sheet, x: f.x, y: f.y, w: f.w, h: f.h, floating: true });
  }
  return out;
}
