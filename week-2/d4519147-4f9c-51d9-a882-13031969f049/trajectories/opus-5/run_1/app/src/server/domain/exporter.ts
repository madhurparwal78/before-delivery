import { plainLabel } from '../../shared/labels';
import type { Derived, PageDocument } from '../../shared/types';
import { PNG_COLOURS, Raster, type Rgb } from './png';

/** An export renders the chosen saved pages, stacked top to bottom. */

export interface ExportPage {
  doc: PageDocument;
  derived: Derived;
}

const MARGIN_X = 24;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 24;
const MIN_CONTENT_WIDTH = 240;
const MIN_CONTENT_HEIGHT = 120;

interface PageLayout {
  tx: number;
  ty: number;
}

export interface RenderedExport {
  svg: string;
  png: Buffer;
  json: string;
}

function contentBox(doc: PageDocument): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const zone of doc.zones) {
    include(zone.x, zone.y);
    include(zone.x + zone.width, zone.y + zone.height);
  }
  for (const shape of doc.shapes) {
    include(shape.x, shape.y);
    include(shape.x + shape.width, shape.y + shape.height);
  }
  for (const connector of doc.connectors) {
    for (const [x, y] of connector.points) include(x, y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: MIN_CONTENT_WIDTH, maxY: MIN_CONTENT_HEIGHT };
  return {
    minX,
    minY,
    maxX: Math.max(maxX, minX + MIN_CONTENT_WIDTH),
    maxY: Math.max(maxY, minY + MIN_CONTENT_HEIGHT),
  };
}

function layoutPages(pages: ExportPage[]): { layouts: PageLayout[]; width: number; height: number } {
  const layouts: PageLayout[] = [];
  let width = MIN_CONTENT_WIDTH + MARGIN_X * 2;
  let cursorY = 0;
  for (const page of pages) {
    const box = contentBox(page.doc);
    layouts.push({ tx: MARGIN_X - box.minX, ty: cursorY + MARGIN_TOP - box.minY });
    width = Math.max(width, Math.round(box.maxX - box.minX) + MARGIN_X * 2);
    cursorY += Math.round(box.maxY - box.minY) + MARGIN_TOP + MARGIN_BOTTOM;
  }
  return { layouts, width: Math.round(width), height: Math.round(Math.max(cursorY, MIN_CONTENT_HEIGHT)) };
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function hex(colour: Rgb): string {
  const part = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${part(colour.r)}${part(colour.g)}${part(colour.b)}`;
}

const ZONE_DATA_KIND: Record<string, string> = {
  cde: 'zone-cde',
  connected: 'zone-connected',
  out_of_scope: 'zone-out',
};

export function renderExport(
  diagram: { id: string; title: string },
  pages: ExportPage[],
  exportedAt: Date,
): RenderedExport {
  const { layouts, width, height } = layoutPages(pages);
  const svg = renderSvg(pages, layouts, width, height);
  const png = renderPng(pages, layouts, width, height);
  const json = JSON.stringify({
    diagram: { id: diagram.id, title: diagram.title },
    exportedAt: exportedAt.toISOString(),
    pages: pages.map((page) => ({
      id: page.doc.id,
      name: page.doc.name,
      zones: page.doc.zones,
      shapes: page.doc.shapes,
      connectors: page.doc.connectors,
      derived: page.derived,
    })),
  });
  return { svg, png, json };
}

function renderSvg(pages: ExportPage[], layouts: PageLayout[], width: number, height: number): string {
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  lines.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${hex(PNG_COLOURS.ground)}"/>`);
  pages.forEach((page, index) => {
    const layout = layouts[index];
    if (!layout) return;
    lines.push(`<g transform="translate(${layout.tx},${layout.ty})">`);
    const box = contentBox(page.doc);
    lines.push(
      `<text x="${box.minX}" y="${box.minY - 16}" font-family="IBM Plex Sans Condensed" font-size="18" fill="${hex(
        PNG_COLOURS.ink,
      )}">${escapeXmlText(page.doc.name)}</text>`,
    );
    for (const zone of page.doc.zones) {
      const stroke = zone.kind === 'cde' ? PNG_COLOURS.scopeRed : PNG_COLOURS.ink;
      lines.push(
        `<rect data-kind="${ZONE_DATA_KIND[zone.kind] ?? 'zone-out'}" data-id="${escapeAttribute(zone.id)}"` +
          ` x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}"` +
          ` fill="none" stroke="${hex(stroke)}" stroke-width="2"><title>${escapeXmlText(zone.name)}</title></rect>`,
      );
      lines.push(
        `<text x="${zone.x + 8}" y="${zone.y + 18}" font-family="IBM Plex Sans Condensed" font-size="14" fill="${hex(
          stroke,
        )}">${escapeXmlText(zone.name)}</text>`,
      );
    }
    for (const shape of page.doc.shapes.slice().sort((a, b) => a.z - b.z)) {
      lines.push(
        `<rect data-kind="${shape.kind}" data-id="${escapeAttribute(shape.id)}"` +
          ` x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"` +
          ` fill="${hex(PNG_COLOURS.ground)}" stroke="${hex(PNG_COLOURS.ink)}" stroke-width="1">` +
          `<title>${escapeXmlText(shape.label)}</title></rect>`,
      );
      lines.push(
        `<text x="${shape.x + 8}" y="${shape.y + 28}" font-family="IBM Plex Sans" font-size="13" fill="${hex(
          PNG_COLOURS.ink,
        )}">${escapeXmlText(plainLabel(shape.label))}</text>`,
      );
    }
    for (const connector of page.doc.connectors) {
      const points = connector.points.map(([x, y]) => `${x},${y}`).join(' ');
      lines.push(
        `<polyline data-connector="true" data-from="${escapeAttribute(connector.from.shapeId)}"` +
          ` data-from-port="${connector.from.port}" data-to="${escapeAttribute(connector.to.shapeId)}"` +
          ` data-to-port="${connector.to.port}" points="${points}" fill="none"` +
          ` stroke="${hex(PNG_COLOURS.teal)}" stroke-width="2"><title>${escapeXmlText(connector.label)}</title></polyline>`,
      );
    }
    lines.push('</g>');
  });
  lines.push('</svg>');
  return lines.join('\n');
}

function renderPng(pages: ExportPage[], layouts: PageLayout[], width: number, height: number): Buffer {
  const raster = new Raster(width, height, PNG_COLOURS.ground);
  pages.forEach((page, index) => {
    const layout = layouts[index];
    if (!layout) return;
    for (const zone of page.doc.zones) {
      raster.strokeRect(
        zone.x + layout.tx,
        zone.y + layout.ty,
        zone.width,
        zone.height,
        2,
        zone.kind === 'cde' ? PNG_COLOURS.scopeRed : PNG_COLOURS.ink,
      );
    }
    for (const shape of page.doc.shapes.slice().sort((a, b) => a.z - b.z)) {
      raster.fillRect(shape.x + layout.tx, shape.y + layout.ty, shape.width, shape.height, PNG_COLOURS.ground);
      raster.strokeRect(shape.x + layout.tx, shape.y + layout.ty, shape.width, shape.height, 1, PNG_COLOURS.ink);
    }
    for (const connector of page.doc.connectors) {
      for (let i = 1; i < connector.points.length; i += 1) {
        const a = connector.points[i - 1];
        const b = connector.points[i];
        if (!a || !b) continue;
        const ax = a[0] + layout.tx;
        const ay = a[1] + layout.ty;
        const bx = b[0] + layout.tx;
        const by = b[1] + layout.ty;
        if (ay === by) {
          const from = Math.min(ax, bx);
          const to = Math.max(ax, bx);
          raster.fillRect(from, ay - 1, to - from + 1, 2, PNG_COLOURS.teal);
        } else {
          const from = Math.min(ay, by);
          const to = Math.max(ay, by);
          raster.fillRect(ax - 1, from, 2, to - from + 1, PNG_COLOURS.teal);
        }
      }
    }
  });
  return raster.toPng();
}
