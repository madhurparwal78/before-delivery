import { type DiagramDocument, findPage } from '../shared/document.js';
import type { User } from './auth.js';
import { query, queryOne, transaction } from './db.js';
import { lockDiagram, registerObjectIds } from './diagrams.js';
import { conflict, invalidRequest, notFound } from './errors.js';
import { broadcast } from './hub.js';
import { newId } from './ids.js';
import { renderPng } from './raster.js';
import { exportViewBox, pageHasVisibleShape, renderSvg } from './render.js';
import { exportKey, getObject, objectExists, putObject } from './storage.js';

export type ExportFormat = 'png' | 'svg';
export type ExportBackground = 'white' | 'transparent';
export type ExportStatus = 'rendering' | 'ready' | 'storage_unavailable';

/** If storage cannot be reached within 10 seconds the export becomes storage_unavailable. */
const STORAGE_BUDGET_MS = 10000;
const STORAGE_ATTEMPT_MS = 2500;
const STORAGE_RETRY_MS = 400;

export interface ExportView {
  id: string;
  status: ExportStatus;
  format: ExportFormat;
  page: string;
  seq: number;
  requestedBy: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

interface ExportRow extends Record<string, unknown> {
  id: string;
  diagram_id: string;
  page_id: string;
  format: ExportFormat;
  scale: number;
  background: ExportBackground;
  status: ExportStatus;
  seq: number;
  requested_by: string;
  document: DiagramDocument;
  width: number | null;
  height: number | null;
  created_at: Date;
}

const SELECT_EXPORT = `SELECT id, diagram_id, page_id, format, scale, background, status, seq,
       requested_by, document, width, height, created_at FROM exports`;

function viewOf(row: ExportRow): ExportView {
  return {
    id: row.id,
    status: row.status,
    format: row.format,
    page: row.page_id,
    seq: row.seq,
    requestedBy: row.requested_by,
    width: row.width,
    height: row.height,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listExports(diagramId: string): Promise<ExportView[]> {
  const rows = await query<ExportRow>(
    `${SELECT_EXPORT} WHERE diagram_id = $1 ORDER BY created_at DESC, id DESC`,
    [diagramId],
  );
  return rows.map(viewOf);
}

export async function loadExport(exportId: string): Promise<ExportRow | undefined> {
  return queryOne<ExportRow>(`${SELECT_EXPORT} WHERE id = $1`, [exportId]);
}

export interface ExportRequest {
  page: string;
  format: ExportFormat;
  scale: 1 | 2;
  background: ExportBackground;
}

/**
 * Creates an export, or returns the one already rendering for the same person, page,
 * format, scale and background at the current document seq. Only one record exists and
 * only one object is ever written.
 */
export async function requestExport(
  diagramId: string,
  actor: User,
  request: ExportRequest,
): Promise<{ view: ExportView; started: boolean }> {
  const result = await transaction(async (client) => {
    const diagram = await lockDiagram(client, diagramId);
    const page = findPage(diagram.document, request.page);
    if (!page) throw notFound();
    if (!pageHasVisibleShape(page)) {
      throw invalidRequest({ page: 'That page has no visible shape to export.' });
    }
    const existing = await client.query<ExportRow>(
      `${SELECT_EXPORT} WHERE diagram_id = $1 AND requested_by = $2 AND page_id = $3
         AND format = $4 AND scale = $5 AND background = $6 AND seq = $7 AND status = 'rendering'
       ORDER BY created_at DESC LIMIT 1`,
      [
        diagramId,
        actor.id,
        request.page,
        request.format,
        request.scale,
        request.background,
        diagram.seq,
      ],
    );
    const found = existing.rows[0];
    if (found) return { row: found, started: false };

    const id = newId('x');
    const inserted = await client.query<ExportRow>(
      `INSERT INTO exports (id, diagram_id, page_id, format, scale, background, status, seq,
                            requested_by, document)
       VALUES ($1, $2, $3, $4, $5, $6, 'rendering', $7, $8, $9)
       RETURNING id, diagram_id, page_id, format, scale, background, status, seq,
                 requested_by, document, width, height, created_at`,
      [
        id,
        diagramId,
        request.page,
        request.format,
        request.scale,
        request.background,
        diagram.seq,
        actor.id,
        JSON.stringify(diagram.document),
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw notFound();
    await registerObjectIds(client, diagramId, [{ id, kind: 'export' }]);
    return { row, started: true };
  });

  if (result.started) void render(result.row);
  return { view: viewOf(result.row), started: result.started };
}

/**
 * Retry is guarded: of any number of retries arriving at the same time exactly one moves
 * the export back to rendering, because the move is one conditional update.
 */
export async function retryExport(exportId: string): Promise<ExportView> {
  const rows = await query<ExportRow>(
    `UPDATE exports SET status = 'rendering'
      WHERE id = $1 AND status = 'storage_unavailable'
      RETURNING id, diagram_id, page_id, format, scale, background, status, seq,
                requested_by, document, width, height, created_at`,
    [exportId],
  );
  const row = rows[0];
  if (!row) throw conflict('export_not_retryable', 'That export cannot be retried.');
  void render(row);
  return viewOf(row);
}

/**
 * Renders the snapshot and only reports ready once object storage confirms the object.
 * Storage is tried again until the ten-second budget runs out, so a storage that is only
 * briefly away does not pause the export.
 */
async function render(row: ExportRow): Promise<void> {
  const page = findPage(row.document, row.page_id);
  if (!page) return;
  const key = exportKey(row.diagram_id, row.id, row.format);
  const file =
    row.format === 'svg'
      ? {
          body: Buffer.from(renderSvg(page, row.seq, row.background), 'utf8'),
          contentType: 'image/svg+xml',
          width: Math.round(exportViewBox(page)?.w ?? 0),
          height: Math.round(exportViewBox(page)?.h ?? 0),
        }
      : (() => {
          const raster = renderPng(page, row.scale, row.background);
          return {
            body: raster.png,
            contentType: 'image/png',
            width: raster.width,
            height: raster.height,
          };
        })();

  const deadline = Date.now() + STORAGE_BUDGET_MS;
  let stored = false;
  for (;;) {
    try {
      await putObject(key, file.body, file.contentType, STORAGE_ATTEMPT_MS);
      if (await objectExists(key, STORAGE_ATTEMPT_MS)) {
        stored = true;
        break;
      }
    } catch {
      // Storage is away; try again until the budget runs out.
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, STORAGE_RETRY_MS));
  }

  await query(
    stored
      ? "UPDATE exports SET status = 'ready', width = $2, height = $3 WHERE id = $1 AND status = 'rendering'"
      : "UPDATE exports SET status = 'storage_unavailable' WHERE id = $1 AND status = 'rendering'",
    stored ? [row.id, file.width, file.height] : [row.id],
  );
  broadcast(row.diagram_id, { t: 'exports' });
}

export async function exportFile(row: ExportRow): Promise<{ body: Buffer; contentType: string }> {
  if (row.status !== 'ready') throw conflict('export_not_ready', 'That export is not ready.');
  const body = await getObject(exportKey(row.diagram_id, row.id, row.format), STORAGE_ATTEMPT_MS);
  return { body, contentType: row.format === 'svg' ? 'image/svg+xml' : 'image/png' };
}

export function exportSummary(row: ExportRow): ExportView {
  return viewOf(row);
}
