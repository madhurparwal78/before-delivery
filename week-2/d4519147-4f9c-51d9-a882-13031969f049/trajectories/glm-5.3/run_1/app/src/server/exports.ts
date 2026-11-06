// Exports: a dated three-file set (SVG, PNG, JSON) confirmed by storage.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { PageDocument, Derived } from '../shared/types.js';
import { errors } from './errors.js';
import { exportKeys, getObject, putObject, sha256Hex } from './storage.js';
import { withTransaction } from './db.js';
import { writeDiagramEvent } from './shares.js';

// The drawing's colours, as channels from 0 to 255.
export const COLOURS = {
  ground: [243, 240, 232],
  ink: [22, 32, 46],
  scopeRed: [200, 50, 63],
  teal: [43, 111, 119],
} as const;

const PAGE_MARGIN = 24;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ExportPageInput {
  doc: PageDocument;
  derived: Derived;
}

// Lay the pages out top to bottom, each framed by 24 units of background.
export function exportLayout(pages: readonly ExportPageInput[]): { width: number; height: number; offsets: { tx: number; ty: number }[] } {
  let cursorY = 0;
  const offsets: { tx: number; ty: number }[] = [];
  let width = 0;
  for (const page of pages) {
    const items = [
      ...page.doc.zones.map((z) => ({ x1: z.x, y1: z.y, x2: z.x + z.width, y2: z.y + z.height })),
      ...page.doc.shapes.map((s) => ({ x1: s.x, y1: s.y, x2: s.x + s.width, y2: s.y + s.height })),
    ];
    const minX = items.length ? Math.min(...items.map((i) => i.x1)) : 0;
    const minY = items.length ? Math.min(...items.map((i) => i.y1)) : 0;
    const maxX = items.length ? Math.max(...items.map((i) => i.x2)) : 0;
    const maxY = items.length ? Math.max(...items.map((i) => i.y2)) : 0;
    offsets.push({ tx: PAGE_MARGIN - minX, ty: cursorY + PAGE_MARGIN - minY });
    cursorY += (maxY - minY) + 2 * PAGE_MARGIN;
    width = Math.max(width, maxX - minX + 2 * PAGE_MARGIN);
  }
  return { width: Math.max(width, 2 * PAGE_MARGIN), height: Math.max(cursorY, 2 * PAGE_MARGIN), offsets };
}

// Render the SVG file. It has no style element or attribute and passes the
// import safety rules.
export function renderSvg(pages: readonly ExportPageInput[]): string {
  const { width, height, offsets } = exportLayout(pages);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  pages.forEach((page, index) => {
    const { tx, ty } = offsets[index];
    parts.push(`<g transform="translate(${tx},${ty})">`);
    parts.push(`<text x="0" y="-4">${escapeXml(page.doc.name)}</text>`);
    for (const zone of page.doc.zones) {
      // The zone kind id the import rule recognises for round-tripping.
      const zoneKind = zone.kind === 'cde' ? 'zone-cde' : zone.kind === 'connected' ? 'zone-connected' : 'zone-out';
      parts.push(`<rect data-kind="${escapeXml(zoneKind)}" data-id="${escapeXml(zone.id)}" x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}"><title>${escapeXml(zone.name)}</title></rect>`);
    }
    for (const shape of page.doc.shapes) {
      parts.push(`<rect data-kind="${escapeXml(shape.kind)}" data-id="${escapeXml(shape.id)}" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"><title>${escapeXml(shape.label)}</title></rect>`);
    }
    for (const conn of page.doc.connectors) {
      const pts = conn.points.map((p) => `${p[0]},${p[1]}`).join(' ');
      parts.push(`<polyline data-connector="${escapeXml(conn.id)}" data-from="${escapeXml(conn.from.shapeId)}" data-from-port="${conn.from.port}" data-to="${escapeXml(conn.to.shapeId)}" data-to-port="${conn.to.port}" points="${pts}"><title>${escapeXml(conn.label)}</title></polyline>`);
    }
    parts.push('</g>');
  });
  parts.push('</svg>');
  return parts.join('');
}

// Render the PNG: a real raster of the same drawing, one pixel per unit.
export function renderPng(pages: readonly ExportPageInput[]): Buffer {
  const { width, height, offsets } = exportLayout(pages);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  // RGB canvas.
  const px = new Uint8Array(w * h * 3);
  fillRect(px, w, h, 0, 0, w, h, COLOURS.ground);
  pages.forEach((page, index) => {
    const { tx, ty } = offsets[index];
    // Zones: 2px solid outline, inside the rectangle.
    for (const zone of page.doc.zones) {
      const colour = zone.kind === 'cde' ? COLOURS.scopeRed : COLOURS.ink;
      const x1 = tx + zone.x;
      const y1 = ty + zone.y;
      const x2 = tx + zone.x + zone.width;
      const y2 = ty + zone.y + zone.height;
      strokeRectInside(px, w, h, x1, y1, x2, y2, colour, 2);
    }
    // Shapes: ground fill, 1px ink outline.
    for (const shape of page.doc.shapes) {
      const x1 = tx + shape.x;
      const y1 = ty + shape.y;
      const x2 = tx + shape.x + shape.width;
      const y2 = ty + shape.y + shape.height;
      fillRect(px, w, h, x1, y1, x2, y2, COLOURS.ground);
      strokeRectInside(px, w, h, x1, y1, x2, y2, COLOURS.ink, 1);
    }
    // Connectors: teal, 2px; horizontal at y covers y-1 and y, vertical at x
    // covers x-1 and x.
    for (const conn of page.doc.connectors) {
      for (let i = 0; i + 1 < conn.points.length; i++) {
        const a = conn.points[i];
        const b = conn.points[i + 1];
        const ax = tx + a[0];
        const ay = ty + a[1];
        const bx = tx + b[0];
        const by = ty + b[1];
        if (ax === bx) {
          const lo = Math.min(ay, by);
          const hi = Math.max(ay, by);
          for (let y = lo; y <= hi; y++) {
            setPixel(px, w, h, ax - 1, y, COLOURS.teal);
            setPixel(px, w, h, ax, y, COLOURS.teal);
          }
        } else {
          const lo = Math.min(ax, bx);
          const hi = Math.max(ax, bx);
          for (let x = lo; x <= hi; x++) {
            setPixel(px, w, h, x, ay - 1, COLOURS.teal);
            setPixel(px, w, h, x, ay, COLOURS.teal);
          }
        }
      }
    }
  });
  return encodePngRgb(px, w, h);
}

function setPixel(px: Uint8Array, w: number, h: number, x: number, y: number, colour: readonly [number, number, number] | readonly number[]): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 3;
  px[i] = colour[0];
  px[i + 1] = colour[1];
  px[i + 2] = colour[2];
}

function fillRect(px: Uint8Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, colour: readonly number[]): void {
  for (let y = Math.max(0, y1); y < Math.min(h, y2); y++) {
    for (let x = Math.max(0, x1); x < Math.min(w, x2); x++) {
      setPixel(px, w, h, x, y, colour);
    }
  }
}

function strokeRectInside(px: Uint8Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, colour: readonly number[], width: number): void {
  for (let k = 0; k < width; k++) {
    for (let x = x1 + k; x < x2 - k; x++) {
      setPixel(px, w, h, x, y1 + k, colour);
      setPixel(px, w, h, x, y2 - 1 - k, colour);
    }
    for (let y = y1 + k; y < y2 - k; y++) {
      setPixel(px, w, h, x1 + k, y, colour);
      setPixel(px, w, h, x2 - 1 - k, y, colour);
    }
  }
}

// Minimal PNG encoder: 8-bit RGB, no filtering.
function encodePngRgb(px: Uint8Array, w: number, h: number): Buffer {
  const rowBytes = w * 3 + 1;
  const raw = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    raw[y * rowBytes] = 0;
    for (let x = 0; x < w * 3; x++) {
      raw[y * rowBytes + 1 + x] = px[y * w * 3 + x];
    }
  }
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  chunks.push(pngChunk('IHDR', ihdr));
  chunks.push(pngChunk('IDAT', zlibDeflate(raw)));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zlibDeflate(data: Buffer): Buffer {
  return zlib.deflateSync(data, { level: 6 });
}

// The JSON file with its derived values equal to the stored ones.
export function renderJson(diagramId: string, diagramTitle: string, exportedAt: Date, pages: readonly ExportPageInput[]): string {
  return JSON.stringify({
    diagram: { id: diagramId, title: diagramTitle },
    exportedAt: exportedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    pages: pages.map((p) => ({
      id: p.doc.id,
      name: p.doc.name,
      zones: p.doc.zones,
      shapes: p.doc.shapes,
      connectors: p.doc.connectors,
      derived: p.derived,
    })),
  });
}

export interface ExportRecord {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  pageIds: string[];
  files: { format: 'png' | 'svg' | 'json'; sizeBytes: number; sha256: string }[] | null;
  createdAt: Date;
  createdBy: string;
}

export function exportFileSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function exportFileName(title: string, createdAt: Date, format: string): string {
  const date = createdAt.toISOString().slice(0, 10);
  return `${exportFileSlug(title)}-${date}.${format}`;
}

// Create an export: a pending record, then the three objects, then ready only
// after reading each one back with matching size and checksum. Any failure
// marks the export failed, and nothing is ever downloadable. Audit events are
// written in the same transaction that commits each status change.
export interface ExportActorContext {
  now: Date;
  actor: string;
  actorId: string;
}

export async function createExport(
  ctx: ExportActorContext,
  diagramId: string,
  diagramTitle: string,
  pages: readonly ExportPageInput[],
): Promise<ExportRecord> {
  const exportId = crypto.randomUUID();
  const createdAt = new Date(ctx.now);
  const pageIds = pages.map((p) => p.doc.id);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO exports (id, diagram_id, status, page_ids, files, created_by, created_at)
       VALUES ($1, $2, 'pending', $3, NULL, $4, $5)`,
      [exportId, diagramId, JSON.stringify(pageIds), ctx.actorId, createdAt],
    );
  });
  const svg = renderSvg(pages);
  const png = renderPng(pages);
  const json = renderJson(diagramId, diagramTitle, createdAt, pages);
  const keys = exportKeys(diagramId, exportId);
  const written: { format: 'png' | 'svg' | 'json'; sizeBytes: number; sha256: string }[] = [];
  try {
    const formats = [
      ['svg', svg],
      ['png', png],
      ['json', json],
    ] as const;
    for (const [format, content] of formats) {
      const stored = await putObject(keys[format], content);
      // Confirm by reading each object back before listing it as a file.
      const bytes = await getObject(keys[format]);
      if (bytes.length !== stored.sizeBytes || sha256Hex(bytes) !== stored.sha256) {
        throw new Error('storage verification failed');
      }
      written.push({ format, sizeBytes: stored.sizeBytes, sha256: stored.sha256 });
    }
  } catch {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE exports SET status = 'failed', files = '[]'::jsonb WHERE id = $1`,
        [exportId],
      );
      await writeDiagramEvent({ client, now: new Date(), actor: ctx.actor }, diagramId, 'export.failed', { exportId });
    });
    throw errors.storageUnavailable();
  }
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE exports SET status = 'ready', files = $2::jsonb WHERE id = $1`,
      [exportId, JSON.stringify(written)],
    );
    await writeDiagramEvent({ client, now: new Date(), actor: ctx.actor }, diagramId, 'export.created', { exportId });
  });
  return {
    id: exportId,
    status: 'ready',
    pageIds,
    files: written,
    createdAt,
    createdBy: ctx.actor,
  };
}
