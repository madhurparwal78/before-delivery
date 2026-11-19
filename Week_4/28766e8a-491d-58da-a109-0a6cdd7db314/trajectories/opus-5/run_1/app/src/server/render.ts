import {
  type Page,
  type Point,
  type Shape,
  isLayerVisible,
  layersBottomFirst,
  shownConnectors,
  visibleShapes,
} from '../shared/document.js';
import { connectorLabelPoint } from '../shared/geometry.js';

export const EXPORT_PADDING = 24;
const INK = '#1b2a4a';
const PAPER = '#fbf8f1';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The bounding box of the page's visible shapes and connector routes, expanded by 24. */
export function exportViewBox(page: Page): ViewBox | null {
  const shapes = visibleShapes(page);
  if (shapes.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const shape of shapes) {
    x1 = Math.min(x1, shape.x);
    y1 = Math.min(y1, shape.y);
    x2 = Math.max(x2, shape.x + shape.w);
    y2 = Math.max(y2, shape.y + shape.h);
  }
  for (const connector of shownConnectors(page)) {
    for (const point of connector.route) {
      x1 = Math.min(x1, point[0]);
      y1 = Math.min(y1, point[1]);
      x2 = Math.max(x2, point[0]);
      y2 = Math.max(y2, point[1]);
    }
  }
  return {
    x: x1 - EXPORT_PADDING,
    y: y1 - EXPORT_PADDING,
    w: x2 - x1 + EXPORT_PADDING * 2,
    h: y2 - y1 + EXPORT_PADDING * 2,
  };
}

/** Escapes text content so no element or attribute can come from label text. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function shapeOutline(shape: Shape): string {
  const { x, y, w, h } = shape;
  switch (shape.kind) {
    case 'ellipse':
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="none" stroke="${INK}" stroke-width="1.5"/>`;
    case 'diamond':
      return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="none" stroke="${INK}" stroke-width="1.5"/>`;
    case 'text':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="none"/>`;
    case 'rectangle':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-width="1.5"/>`;
  }
}

export function routePath(route: readonly Point[]): string {
  return route.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
}

/** Shapes in drawing order: by layer order, then z within the layer. */
export function shapesInDrawOrder(page: Page): Shape[] {
  const order = new Map(layersBottomFirst(page).map((layer, index) => [layer.id, index]));
  return visibleShapes(page).sort(
    (a, b) => (order.get(a.layer) ?? 0) - (order.get(b.layer) ?? 0) || a.z - b.z,
  );
}

/**
 * The SVG export. It holds only the page's visible shapes and shown connectors: no comment
 * pins or text, cursors, selection handles, port dots or lock icons.
 */
export function renderSvg(page: Page, seq: number, background: 'white' | 'transparent'): string {
  const viewBox = exportViewBox(page);
  if (!viewBox) throw new Error('A page with no visible shape cannot be exported');
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox.w}" height="${viewBox.h}"` +
      ` viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}" data-seq="${seq}">`,
  );
  if (background === 'white') {
    parts.push(
      `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.w}" height="${viewBox.h}" fill="${PAPER}"/>`,
    );
  }
  for (const shape of shapesInDrawOrder(page)) {
    parts.push(`<g id="shape-${shape.id}">`);
    parts.push(shapeOutline(shape));
    if (shape.label.length > 0) {
      parts.push(
        `<text x="${shape.x + shape.w / 2}" y="${shape.y + shape.h / 2}" fill="${INK}"` +
          ' font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="14"' +
          ` text-anchor="middle" dominant-baseline="central">${escapeXml(shape.label)}</text>`,
      );
    }
    parts.push('</g>');
  }
  for (const connector of shownConnectors(page)) {
    parts.push(`<g id="connector-${connector.id}">`);
    parts.push(
      `<path d="${routePath(connector.route)}" fill="none" stroke="${INK}" stroke-width="1.5"/>`,
    );
    if (connector.label.length > 0) {
      const at = connectorLabelPoint(connector.route);
      parts.push(
        `<text class="connector-label" x="${at[0]}" y="${at[1]}" fill="${INK}"` +
          ' font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="12"' +
          ` text-anchor="middle" dominant-baseline="central">${escapeXml(connector.label)}</text>`,
      );
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}

export function pageHasVisibleShape(page: Page): boolean {
  return page.shapes.some((s) => isLayerVisible(page, s.layer));
}
