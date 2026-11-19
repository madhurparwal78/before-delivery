// Shape outlines (drawn the same on the canvas and in exports) and the export SVG writer
// (brief: Required SVG properties). Exports carry only visible shapes and shown connectors.
import { visibleLayerIds } from "./geometry";
import { isBlocked, isShown, labelAnchor } from "./router";
import type { Box, Page, Point, ShapeKind } from "./types";

const EXPORT_PAD = 24;
const INK = "#1B2A4A";

/** The outline path of a shape; text shapes have none. */
export function shapePath(kind: ShapeKind, b: Box): string | null {
  switch (kind) {
    case "rectangle":
      return `M${b.x} ${b.y}H${b.x + b.w}V${b.y + b.h}H${b.x}Z`;
    case "ellipse": {
      const rx = b.w / 2;
      const ry = b.h / 2;
      return `M${b.x} ${b.y + ry}A${rx} ${ry} 0 1 0 ${b.x + b.w} ${b.y + ry}A${rx} ${ry} 0 1 0 ${b.x} ${b.y + ry}Z`;
    }
    case "diamond":
      return `M${b.x + b.w / 2} ${b.y}L${b.x + b.w} ${b.y + b.h / 2}L${b.x + b.w / 2} ${b.y + b.h}L${b.x} ${b.y + b.h / 2}Z`;
    case "text":
      return null;
  }
}

export function routePath(route: Point[]): string {
  return route.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface ExportFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The bounding box of the page's visible shapes and shown connector routes, padded by 24; null when nothing is visible. */
export function exportFrame(page: Page): ExportFrame | null {
  const visible = visibleLayerIds(page);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of page.shapes) {
    if (!visible.has(s.layer)) continue;
    xs.push(s.x, s.x + s.w);
    ys.push(s.y, s.y + s.h);
  }
  if (!xs.length) return null;
  for (const c of page.connectors) {
    if (!isShown(page, c, visible)) continue;
    for (const p of c.route) {
      xs.push(p[0]);
      ys.push(p[1]);
    }
  }
  const x = Math.min(...xs) - EXPORT_PAD;
  const y = Math.min(...ys) - EXPORT_PAD;
  return { x, y, width: Math.max(...xs) - Math.min(...xs) + 2 * EXPORT_PAD, height: Math.max(...ys) - Math.min(...ys) + 2 * EXPORT_PAD };
}

/** The export SVG for a page: no hidden layers, comments, cursors, selection, port dots or lock icons. */
export function exportSvg(page: Page, frame: ExportFrame, background: "white" | "transparent", seq: number): string {
  const visible = visibleLayerIds(page);
  const layerOrder = new Map(page.layers.map((l) => [l.id, l.order]));
  const shapes = page.shapes.filter((s) => visible.has(s.layer)).sort((a, b) => (layerOrder.get(a.layer) ?? 0) - (layerOrder.get(b.layer) ?? 0) || a.z - b.z);
  const font = `font-family="IBM Plex Sans, sans-serif" font-size="13" fill="${INK}" text-anchor="middle" dominant-baseline="central"`;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" data-seq="${seq}" viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}" width="${frame.width}" height="${frame.height}">`,
    `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="${INK}" stroke-width="1.5"/></marker></defs>`,
  ];
  if (background === "white") parts.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="#FFFFFF"/>`);
  for (const s of shapes) {
    const outline = shapePath(s.kind, s);
    parts.push(`<g id="shape-${s.id}">`);
    if (outline) parts.push(`<path d="${outline}" fill="#FFFFFF" fill-opacity="0" stroke="${INK}" stroke-width="1.5"/>`);
    if (s.label) parts.push(`<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" ${font}>${escapeXml(s.label)}</text>`);
    parts.push("</g>");
  }
  for (const c of page.connectors) {
    if (!isShown(page, c, visible)) continue;
    const dash = isBlocked(page, c, c.route) ? ` stroke-dasharray="6 4"` : "";
    parts.push(`<g id="connector-${c.id}"><path d="${routePath(c.route)}" fill="none" stroke="${INK}" stroke-width="1.5"${dash} marker-end="url(#arrowhead)"/>`);
    if (c.label) {
      const [x, y] = labelAnchor(c.route);
      parts.push(`<text class="connector-label" x="${x}" y="${y}" ${font}>${escapeXml(c.label)}</text>`);
    }
    parts.push("</g>");
  }
  parts.push("</svg>");
  return parts.join("");
}
