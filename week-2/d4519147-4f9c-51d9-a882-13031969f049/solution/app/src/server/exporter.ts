import { parseLabel, type LabelNode } from "../shared/label.ts";
import type { Derived, PageDoc } from "../shared/model.ts";
import { encodePalettePng, type Rgb } from "./png.ts";
import { SVG_NS } from "./xml.ts";

const GROUND: Rgb = [243, 240, 232];
const INK: Rgb = [22, 32, 46];
const SCOPE_RED: Rgb = [200, 50, 63];
const TEAL: Rgb = [43, 111, 119];
const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

const MARGIN = 48;
const HEADING = 48;
const DASH: Record<string, string> = { cde: "12 4", connected: "6 4", out_of_scope: "2 4" };
const ZONE_DATA_KIND: Record<string, string> = { cde: "zone-cde", connected: "zone-connected", out_of_scope: "zone-out" };

export interface ExportPage {
  doc: PageDoc;
  derived: Derived;
}

interface Placed extends ExportPage {
  tx: number;
  ty: number;
  headingY: number;
}

function layout(pages: ExportPage[]): { width: number; height: number; placed: Placed[] } {
  let cursor = MARGIN;
  let widest = 240;
  const placed = pages.map((page) => {
    const xs: number[] = [], ys: number[] = [];
    for (const r of [...page.doc.zones, ...page.doc.shapes]) {
      xs.push(r.x, r.x + r.width);
      ys.push(r.y, r.y + r.height);
    }
    for (const c of page.doc.connectors) for (const [x, y] of c.points) xs.push(x), ys.push(y);
    const minX = xs.length ? Math.min(...xs) : 0, maxX = xs.length ? Math.max(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 0;
    const top = cursor + HEADING;
    widest = Math.max(widest, maxX - minX);
    cursor = top + (maxY - minY) + MARGIN;
    return { ...page, tx: MARGIN - minX, ty: top - minY, headingY: top - 16 };
  });
  return { width: widest + 2 * MARGIN, height: Math.max(cursor, 2 * MARGIN), placed };
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Label text with its acting formatting as tspans; everything else stays literal (escaped) text. */
function labelText(label: string, x: number, y: number, size: number): string {
  const lines: string[] = [""];
  const emit = (nodes: LabelNode[], bold: boolean, italic: boolean) => {
    for (const n of nodes) {
      if (n.type === "br") lines.push("");
      else if (n.type === "text") {
        const attrs = `${bold ? ' font-weight="600"' : ""}${italic ? ' font-style="italic"' : ""}`;
        lines[lines.length - 1] += attrs ? `<tspan${attrs}>${escapeXml(n.text)}</tspan>` : escapeXml(n.text);
      } else emit(n.children, bold || n.type === "b", italic || n.type === "i");
    }
  };
  emit(parseLabel(label), false, false);
  const spans = lines.map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : Math.round(size * 1.3)}">${line}</tspan>`).join("");
  return `<text x="${x}" y="${y}" font-family="IBM Plex Sans, sans-serif" font-size="${size}" fill="${hex(INK)}">${spans}</text>`;
}

export function renderSvg(pages: ExportPage[]): string {
  const { width, height, placed } = layout(pages);
  const out: string[] = [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${hex(GROUND)}"/>`,
  ];
  for (const p of placed) {
    out.push(`<text x="${MARGIN}" y="${p.headingY}" font-family="IBM Plex Sans Condensed, sans-serif" font-size="20" font-weight="600" fill="${hex(INK)}">${escapeXml(p.doc.name)}</text>`);
    out.push(`<g transform="translate(${p.tx},${p.ty})">`);
    for (const z of p.doc.zones) {
      const stroke = z.kind === "cde" ? SCOPE_RED : INK;
      out.push(`<rect data-kind="${ZONE_DATA_KIND[z.kind]}" data-id="${escapeXml(z.id)}" x="${z.x}" y="${z.y}" width="${z.width}" height="${z.height}" fill="none" stroke="${hex(stroke)}" stroke-width="2" stroke-dasharray="${DASH[z.kind]}"><title>${escapeXml(z.name)}</title></rect>`);
      out.push(`<text x="${z.x + 8}" y="${z.y + 20}" font-family="IBM Plex Sans Condensed, sans-serif" font-size="14" font-weight="600" fill="${hex(stroke)}">${escapeXml(z.name)}</text>`);
    }
    for (const s of [...p.doc.shapes].sort((a, b) => a.z - b.z)) {
      out.push(`<rect data-kind="${s.kind}" data-id="${escapeXml(s.id)}" x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" fill="${hex(GROUND)}" stroke="${hex(INK)}" stroke-width="1"><title>${escapeXml(s.label)}</title></rect>`);
      out.push(labelText(s.label, s.x + 10, s.y + Math.min(24, s.height - 4), 13));
    }
    for (const c of p.doc.connectors) {
      out.push(`<polyline data-connector="${escapeXml(c.id)}" data-from="${escapeXml(c.from.shapeId)}" data-from-port="${c.from.port}" data-to="${escapeXml(c.to.shapeId)}" data-to-port="${c.to.port}" points="${c.points.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="${hex(TEAL)}" stroke-width="2"><title>${escapeXml(c.label)}</title></polyline>`);
    }
    out.push("</g>");
  }
  out.push("</svg>");
  return out.join("\n");
}

/** A palette raster of the same drawing: zones (2px inside outline), shapes (ground fill, 1px ink outline), then 2px teal connectors. */
export function renderPng(pages: ExportPage[]): Buffer {
  const { width, height, placed } = layout(pages);
  type Span = { y0: number; y1: number; draw: (y: number, line: Uint8Array) => void };
  const spans: Span[] = [];
  const fill = (line: Uint8Array, a: number, b: number, color: number) => {
    for (let x = Math.max(0, a); x <= Math.min(width - 1, b); x++) line[x] = color;
  };
  for (const p of placed) {
    for (const z of p.doc.zones) {
      const x0 = z.x + p.tx, y0 = z.y + p.ty, x1 = x0 + z.width - 1, y1 = y0 + z.height - 1;
      const color = z.kind === "cde" ? 2 : 1;
      spans.push({ y0, y1, draw: (y, line) => {
        if (y <= y0 + 1 || y >= y1 - 1) fill(line, x0, x1, color);
        else for (const x of [x0, x0 + 1, x1 - 1, x1]) fill(line, x, x, color);
      } });
    }
    for (const s of [...p.doc.shapes].sort((a, b) => a.z - b.z)) {
      const x0 = s.x + p.tx, y0 = s.y + p.ty, x1 = x0 + s.width - 1, y1 = y0 + s.height - 1;
      spans.push({ y0, y1, draw: (y, line) => {
        if (y === y0 || y === y1) fill(line, x0, x1, 1);
        else {
          fill(line, x0 + 1, x1 - 1, 0);
          fill(line, x0, x0, 1);
          fill(line, x1, x1, 1);
        }
      } });
    }
    for (const c of p.doc.connectors) {
      for (let i = 0; i + 1 < c.points.length; i++) {
        const [ax, ay] = c.points[i]!, [bx, by] = c.points[i + 1]!;
        const x0 = Math.min(ax, bx) + p.tx, x1 = Math.max(ax, bx) + p.tx, y0 = Math.min(ay, by) + p.ty, y1 = Math.max(ay, by) + p.ty;
        if (ay === by) spans.push({ y0: y0 - 1, y1: y0, draw: (_y, line) => fill(line, x0, x1, 3) });
        else spans.push({ y0, y1, draw: (_y, line) => fill(line, x0 - 1, x0, 3) });
      }
    }
  }
  return encodePalettePng(width, height, [GROUND, INK, SCOPE_RED, TEAL], (y, line) => {
    for (const s of spans) if (y >= s.y0 && y <= s.y1) s.draw(y, line);
  });
}

export function renderJson(diagram: { id: string; title: string }, pages: ExportPage[], exportedAt: string): string {
  return JSON.stringify({
    diagram,
    exportedAt,
    pages: pages.map(({ doc, derived }) => ({ id: doc.id, name: doc.name, zones: doc.zones, shapes: doc.shapes, connectors: doc.connectors, derived })),
  }, null, 2);
}
