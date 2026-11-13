import type { Entity, ResolvedEntity, Pt } from '../shared/geometry.js';
import { COLOUR_HEX, entityBounds, LAYER_COLOURS, LINETYPES, LINEWEIGHTS } from '../shared/geometry.js';
import type { DrawingModel, LayerRecord } from '../shared/model.js';
import { dimensionText } from '../shared/derived.js';
import { numberKey } from '../shared/num.js';

// ---------------------------------------------------------------------------
// DOM helpers, SVG rendering and entity labels for the browser.
// ---------------------------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | number | null | undefined> = {}, ...children: Array<Node | string | null | undefined>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svgEl(tag: string, attrs: Record<string, string | number | boolean | null | undefined> = {}): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, value === true ? '' : String(value));
  }
  return node;
}

export function displayText(value: number): string {
  if (Object.is(value, -0)) return '0';
  const fixed = value.toFixed(3);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  const normalised = trimmed === '' || trimmed === '-' ? '0' : trimmed;
  return normalised === '-0' ? '0' : normalised;
}

export function storedNumber(value: number): string {
  return numberKey(value);
}

export function pointText(p: Pt): string {
  return `${displayText(p.x)},${displayText(p.y)}`;
}

export function trimAngle(value: number): string {
  const fixed = value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return fixed === '' ? '0' : fixed;
}

// The entity list row label, exactly as published.
export function entityLabel(entity: ResolvedEntity, model: Pick<DrawingModel, 'dim_styles' | 'entities'>): string {
  const layer = entity.layer;
  switch (entity.type) {
    case 'line':
      return `Line ${entity.handle}, layer ${layer}, from ${pointText({ x: entity.x1, y: entity.y1 })} to ${pointText({ x: entity.x2, y: entity.y2 })}, length ${displayText(Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1))}`;
    case 'circle':
      return `Circle ${entity.handle}, layer ${layer}, centre ${pointText({ x: entity.cx, y: entity.cy })}, radius ${displayText(entity.r)}, area ${displayText(Math.PI * entity.r * entity.r)}`;
    case 'arc':
      return `Arc ${entity.handle}, layer ${layer}, centre ${pointText({ x: entity.cx, y: entity.cy })}, radius ${displayText(entity.r)}, from ${displayText(entity.start)} to ${displayText(entity.end)} degrees, length ${displayText((entity.r * (entity.end - entity.start) * Math.PI) / 180)}`;
    case 'pline': {
      const points = entity.points;
      const count = points.length;
      let length = 0;
      const last = entity.closed ? points.length : points.length - 1;
      for (let i = 0; i < last; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        length += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return entity.closed
        ? `Polyline ${entity.handle}, layer ${layer}, ${count} points, closed, length ${displayText(length)}, area ${displayText(polygonArea(points))}`
        : `Polyline ${entity.handle}, layer ${layer}, ${count} points, open, length ${displayText(length)}`;
    }
    case 'hatch':
      return `Hatch ${entity.handle}, layer ${layer}, area ${displayText(entity.area)}`;
    case 'dimension':
      return `Dimension ${entity.handle}, layer ${layer}, ${entity.kind}, value ${entity.value === null ? dimensionText(model as never, entity) : String(entity.value)}`;
    case 'insert':
      return `Block ${entity.handle}, layer ${layer}, ${entity.block} at ${pointText({ x: entity.x, y: entity.y })}, scale ${displayText(entity.scale)}, rotation ${displayText(entity.rotation)}`;
  }
}

function polygonArea(points: Pt[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export function toScreen(view: ViewTransform, world: Pt): Pt {
  return { x: world.x * view.zoom + view.panX, y: -world.y * view.zoom + view.panY };
}

export function toWorld(view: ViewTransform, screen: Pt): Pt {
  return { x: (screen.x - view.panX) / view.zoom, y: -(screen.y - view.panY) / view.zoom };
}

export const LAYER_COLOUR_HEX: Record<string, string> = Object.fromEntries(LAYER_COLOURS.map((name) => [name, COLOUR_HEX[name] ?? COLOUR_HEX.white]));

export { entityBounds, LAYER_COLOURS, LINETYPES, LINEWEIGHTS };
export type { Entity, ResolvedEntity, LayerRecord };
