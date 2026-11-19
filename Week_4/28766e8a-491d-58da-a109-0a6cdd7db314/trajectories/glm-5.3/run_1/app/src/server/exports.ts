import type { AppConfig } from './config.js';
import type { App } from './app.js';
import type { Document, Page } from '../shared/model.js';
import { connectorShown, labelAnchor, routePage } from '../shared/router.js';
import { escapeXml } from './xml.js';
import { putObject, headObject, exportKey } from './storage.js';

const PAPER = 'warm';
const INK = '#1b2a4a';

/** Render one export: build the file from the document at the snapshot seq. */
export async function renderExport(app: App, config: AppConfig, exportId: string): Promise<void> {
  const record = await app.db.query(
    `SELECT id, diagram_id, page_id, format, scale, background, seq, status FROM exports WHERE id = $1`,
    [exportId]);
  const row = record.rows[0] as {
    id: string; diagram_id: string; page_id: string; format: 'png' | 'svg';
    scale: number; background: string; seq: number; status: string;
  } | undefined;
  if (!row) return;
  const doc = await snapshotAt(app, row.diagram_id, row.seq);
  if (!doc) {
    await app.db.query(`UPDATE exports SET status = 'storage_unavailable' WHERE id = $1`, [exportId]);
    return;
  }
  const page = doc.pages.find((p) => p.id === row.page_id);
  if (!page) {
    await app.db.query(`UPDATE exports SET status = 'storage_unavailable' WHERE id = $1`, [exportId]);
    return;
  }
  const { svg, viewBox, width, height } = renderSvg(page, row.seq);
  try {
    if (row.format === 'svg') {
      const buffer = Buffer.from(svg, 'utf8');
      const ok = await putObject(config, exportKey(row.diagram_id, exportId, 'svg'), buffer, 'image/svg+xml');
      const exists = ok && await headObject(config, exportKey(row.diagram_id, exportId, 'svg'));
      if (!exists) throw new Error('storage unavailable');
      await app.db.query(
        `UPDATE exports SET status = 'ready', width = $2, height = $3 WHERE id = $1`,
        [exportId, width, height]);
    } else {
      const { renderPng } = await import('./png.js');
      const buffer = await renderPng(svg, width, height, row.scale, row.background === 'transparent');
      const ok = await putObject(config, exportKey(row.diagram_id, exportId, 'png'), buffer, 'image/png');
      const exists = ok && await headObject(config, exportKey(row.diagram_id, exportId, 'png'));
      if (!exists) throw new Error('storage unavailable');
      await app.db.query(
        `UPDATE exports SET status = 'ready', width = $2, height = $3 WHERE id = $1`,
        [exportId, Math.round(width * row.scale), Math.round(height * row.scale)]);
    }
    app.broadcast(row.diagram_id, { kind: 'export', payload: { id: exportId, status: 'ready' } });
  } catch {
    await app.db.query(`UPDATE exports SET status = 'storage_unavailable' WHERE id = $1`, [exportId]);
    app.broadcast(row.diagram_id, { kind: 'export', payload: { id: exportId, status: 'storage_unavailable' } });
  }
}

async function snapshotAt(app: App, diagramId: string, seq: number): Promise<Document | null> {
  const doc = await app.loadDocument(diagramId);
  if (!doc) return null;
  if (doc.seq === seq) return doc;
  // Replay from version snapshots plus later operations.
  const version = await app.db.query(
    `SELECT content FROM versions WHERE diagram_id = $1 AND seq <= $2 ORDER BY seq DESC LIMIT 1`,
    [diagramId, seq]);
  const base = version.rows[0] as { content: Document; seq: number } | undefined;
  if (!base) return seq >= doc.seq ? doc : null;
  const clone: Document = JSON.parse(JSON.stringify(base.content)) as Document;
  const ops = await app.db.query(
    `SELECT op FROM operations WHERE diagram_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq`,
    [diagramId, base.seq, seq]);
  const { applyOperation } = await import('./documents.js');
  for (const opRow of ops.rows as { op: { kind: string } & Record<string, unknown> }[]) {
    const result = applyOperation(clone, opRow.op as never, { userId: '', role: 'owner', now: new Date() }, (p) => app.newId(p));
    if ('error' in result) continue;
  }
  return clone;
}

export function renderSvg(page: Page, seq: number): { svg: string; viewBox: string; width: number; height: number } {
  const visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
  const { routes, shown } = routePage(page);
  const shapes = page.shapes.filter((s) => visible.has(s.layer));
  const shownConnectors = page.connectors.filter((c) => shown.has(c.id));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const boxes: { id: string; x: number; y: number; w: number; h: number }[] = [];
  for (const shape of shapes) {
    boxes.push({ id: shape.id, x: shape.x, y: shape.y, w: shape.w, h: shape.h });
    minX = Math.min(minX, shape.x); minY = Math.min(minY, shape.y);
    maxX = Math.max(maxX, shape.x + shape.w); maxY = Math.max(maxY, shape.y + shape.h);
  }
  for (const connector of shownConnectors) {
    const route = routes.get(connector.id)?.route ?? connector.route;
    for (const [x, y] of route) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
  const pad = 24;
  const x0 = Math.floor(minX - pad), y0 = Math.floor(minY - pad);
  const x1 = Math.ceil(maxX + pad), y1 = Math.ceil(maxY + pad);
  const width = x1 - x0, height = y1 - y0;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${width} ${height}" width="${width}" height="${height}" data-seq="${seq}">`);
  for (const shape of shapes) {
    const routeless = shape.kind === 'rectangle' || shape.kind === 'text' || shape.kind === 'ellipse' || shape.kind === 'diamond';
    void routeless;
    parts.push(`<g id="shape-${shape.id}">`);
    const body = shapeBody(shape);
    if (body) parts.push(body);
    if (shape.label.length > 0) {
      parts.push(`<text x="${shape.x + shape.w / 2}" y="${shape.y + shape.h / 2}" text-anchor="middle" dominant-baseline="central" fill="${INK}">${escapeXml(shape.label)}</text>`);
    }
    parts.push('</g>');
  }
  for (const connector of shownConnectors) {
    const result = routes.get(connector.id);
    const route = result?.route ?? connector.route;
    const d = route.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
    parts.push(`<g id="connector-${connector.id}">`);
    parts.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="2"${result?.blocked ? ' stroke-dasharray="8 6"' : ''}/>`);
    if (connector.label.length > 0) {
      const anchor = labelAnchor(route);
      parts.push(`<text class="connector-label" x="${anchor.x}" y="${anchor.y}" text-anchor="middle" dominant-baseline="central" fill="${INK}">${escapeXml(connector.label)}</text>`);
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return { svg: parts.join('\n'), viewBox: `${x0} ${y0} ${width} ${height}`, width, height };
}

function shapeBody(shape: Page['shapes'][number]): string {
  const stroke = `fill="${PAPER === 'warm' ? 'none' : 'none'}" stroke="${INK}" stroke-width="2"`;
  switch (shape.kind) {
    case 'rectangle':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" ${stroke}/>`;
    case 'ellipse':
      return `<ellipse cx="${shape.x + shape.w / 2}" cy="${shape.y + shape.h / 2}" rx="${shape.w / 2}" ry="${shape.h / 2}" ${stroke}/>`;
    case 'diamond': {
      const cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
      return `<polygon points="${cx},${shape.y} ${shape.x + shape.w},${cy} ${cx},${shape.y + shape.h} ${shape.x},${cy}" ${stroke}/>`;
    }
    case 'text':
      return '';
  }
}

export function connectorInExport(connectorId: string, page: Page): boolean {
  const visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
  const connector = page.connectors.find((c) => c.id === connectorId);
  if (!connector) return false;
  return connectorShown(connector, page, visible);
}
