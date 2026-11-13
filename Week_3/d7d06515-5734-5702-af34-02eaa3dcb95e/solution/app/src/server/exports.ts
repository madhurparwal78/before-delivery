// Exports (PDF sheets and DXF files, rendered in-process and stored in MinIO) and the title-block revisions they print.
import { randomUUID } from 'node:crypto';
import { COPY } from '../shared/copy.ts';
import type { ExportState, ExportView, RevisionView } from '../shared/types.ts';
import { assertMay, authorizeDrawing, requireCaller, requireUser, type UserRow } from './access.ts';
import { studioDate, workspaceNow } from './clock.ts';
import { isUuid, pool, query, transaction, type Queryable } from './db.ts';
import { loadModel, viaStorage } from './drawing-store.ts';
import type { DrawingModel } from './engine/types.ts';
import { exportDxf } from './formats/dxf.ts';
import { renderSheet } from './formats/pdf.ts';
import { HttpError, registerRoute, validation, type Context, type Reply } from './http.ts';
import { getObject, putObject } from './s3.ts';

const FORMATS = {
  pdf: { contentType: 'application/pdf' },
  dxf: { contentType: 'application/dxf' },
} as const;
type Format = keyof typeof FORMATS;

const FORMAT_INVALID = 'Choose PDF or DXF.';
const LAYOUT_INVALID = 'Choose a layout from the list.';
const MODEL_LAYOUT = 'Model';
const EXPORT_COLUMNS = 'id, drawing_id, format, layout, file, state, issued_at, issue_date, title_block_revision, object_key, size_bytes';

interface ExportRow {
  id: string;
  drawing_id: string;
  format: Format;
  layout: string;
  file: string;
  state: ExportState;
  issued_at: Date;
  issue_date: string;
  title_block_revision: string;
  object_key: string | null;
  size_bytes: number | null;
}

interface RenderJob {
  exportId: string;
  drawingId: string;
  format: Format;
  layout: string;
  title: string;
  issueDate: string;
  revision: RevisionView;
  model: DrawingModel;
}

const isFormat = (value: unknown): value is Format => value === 'pdf' || value === 'dxf';

function exportView(row: ExportRow): ExportView {
  return {
    id: row.id,
    drawing_id: row.drawing_id,
    format: row.format,
    layout: row.layout,
    file: row.file,
    state: row.state,
    issued_at: row.issued_at.toISOString(),
    issue_date: row.issue_date,
    title_block_revision: row.title_block_revision,
    object_key: row.object_key,
    size_bytes: row.size_bytes,
    download_url: row.state === 'stored' ? `/api/exports/${row.id}/download` : null,
  };
}

/** The revision in force on an issue date: the latest effective on or before it (the first one when the date precedes them all). */
async function revisionIn(client: Queryable, workspaceId: string, issueDate: string): Promise<RevisionView> {
  const { rows } = await client.query<RevisionView>(
    `SELECT letter, footer_note, effective_date::text AS effective_date FROM title_revisions WHERE workspace_id = $1
     ORDER BY (effective_date <= $2::date) DESC, CASE WHEN effective_date <= $2::date THEN effective_date END DESC, effective_date`,
    [workspaceId, issueDate]);
  const revision = rows[0];
  if (!revision) throw new HttpError(404, { error: 'not_found' });
  return revision;
}

/** The one place an export leaves `rendering`. */
async function finishExport(exportId: string, state: Exclude<ExportState, 'rendering'>, stored: { key: string; size: number } | null): Promise<void> {
  await pool.query(
    `UPDATE exports SET state = $2, object_key = $3, size_bytes = $4 WHERE id = $1 AND state = 'rendering'`,
    [exportId, state, stored?.key ?? null, stored?.size ?? null]);
}

function logFailure(exportId: string, error: unknown): void {
  process.stdout.write(`export ${exportId} failed: ${error instanceof Error ? error.name : 'unknown error'}\n`);
}

async function renderExport(job: RenderJob): Promise<void> {
  const key = `exports/${job.drawingId}/${job.exportId}.${job.format}`;
  try {
    const bytes = job.format === 'pdf'
      ? renderSheet({ model: job.model, layout: job.layout, title: job.title, issued: job.issueDate, revision: job.revision.letter, note: job.revision.footer_note })
      : Buffer.from(exportDxf(job.model), 'utf8');
    await putObject(key, bytes, FORMATS[job.format].contentType);
    await finishExport(job.exportId, 'stored', { key, size: bytes.length });
  } catch (error) {
    logFailure(job.exportId, error);
    await finishExport(job.exportId, 'failed', null);
  }
}

async function requestExport(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  assertMay(access.access, 'export', access);
  const { drawing } = access;
  const format = body.format;
  if (!isFormat(format)) throw validation({ format: FORMAT_INVALID });
  const layout = format === 'dxf' ? MODEL_LAYOUT : body.layout;
  const job = await transaction(async (client) => {
    const model = await loadModel(client, drawing.id);
    if (typeof layout !== 'string' || !model.layouts.some((l) => l.name === layout)) throw validation({ layout: LAYOUT_INVALID });
    const issueDate = studioDate(access.now, access.zone);
    const revision = await revisionIn(client, drawing.workspace_id, issueDate);
    const counted = await client.query<{ export_count: number }>('UPDATE drawings SET export_count = export_count + 1 WHERE id = $1 RETURNING export_count', [drawing.id]);
    const sequence = counted.rows[0]?.export_count ?? 1;
    const title = drawing.name.replace(/\.dxf$/i, '');
    const exportId = randomUUID();
    const file = `${title}-${layout}-${sequence}.${format}`;
    await client.query(
      `INSERT INTO exports (id, drawing_id, seq, format, layout, file, state, issued_at, issue_date, title_block_revision)
       VALUES ($1, $2, $3, $4, $5, $6, 'rendering', $7, $8, $9)`,
      [exportId, drawing.id, sequence, format, layout, file, access.now, issueDate, revision.letter]);
    return { exportId, drawingId: drawing.id, format, layout, title, issueDate, revision, model, file };
  });
  renderExport(job).catch((error: unknown) => logFailure(job.exportId, error));
  return { status: 202, body: { export: { id: job.exportId, state: 'rendering', file: job.file } } };
}

async function listExports(ctx: Context): Promise<Reply> {
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  const rows = await query<ExportRow>(`SELECT ${EXPORT_COLUMNS} FROM exports WHERE drawing_id = $1 ORDER BY seq DESC`, [access.drawing.id]);
  return { status: 200, body: { exports: rows.map(exportView) } };
}

async function openExport(ctx: Context): Promise<ExportRow> {
  requireCaller(ctx);
  const id = ctx.params.id ?? '';
  const rows = isUuid(id) ? await query<ExportRow>(`SELECT ${EXPORT_COLUMNS} FROM exports WHERE id = $1`, [id]) : [];
  const row = rows[0];
  if (!row) throw new HttpError(404, { error: 'not_found' });
  await authorizeDrawing(ctx, row.drawing_id);
  return row;
}

async function readExport(ctx: Context): Promise<Reply> {
  return { status: 200, body: { export: exportView(await openExport(ctx)) } };
}

async function downloadExport(ctx: Context): Promise<Reply> {
  const row = await openExport(ctx);
  if (row.state !== 'stored' || row.object_key === null) throw new HttpError(409, { error: 'export_not_ready' });
  return {
    status: 200,
    bytes: await viaStorage(getObject(row.object_key)),
    contentType: FORMATS[row.format].contentType,
    headers: { 'Content-Disposition': `attachment; filename="${row.file}"` },
  };
}

const revisionColumns = 'letter, footer_note, effective_date::text AS effective_date';

async function listRevisions(ctx: Context): Promise<Reply> {
  const caller = requireCaller(ctx);
  const revisions = await query<RevisionView>(`SELECT ${revisionColumns} FROM title_revisions WHERE workspace_id = $1 ORDER BY letter`, [caller.workspaceId]);
  return { status: 200, body: { revisions } };
}

/** Title-block revisions belong to the account: a link holder is refused by their access level. */
async function accountOwner(ctx: Context): Promise<UserRow> {
  const caller = requireCaller(ctx);
  if (caller.kind === 'link') {
    const access = await authorizeDrawing(ctx, caller.share.drawing_id);
    assertMay(access.access, 'owner', access);
  }
  return requireUser(ctx);
}

const isCalendarDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

async function addRevision(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const user = await accountOwner(ctx);
  const note = typeof body.footer_note === 'string' ? body.footer_note.trim() : '';
  const date = typeof body.effective_date === 'string' ? body.effective_date : '';
  const today = studioDate(await workspaceNow(user.workspace_id), user.time_zone);
  const revision = await transaction(async (client) => {
    await client.query('SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE', [user.workspace_id]);
    const latest = await client.query<RevisionView>(
      `SELECT ${revisionColumns} FROM title_revisions WHERE workspace_id = $1 ORDER BY letter DESC LIMIT 1`, [user.workspace_id]);
    const last = latest.rows[0];
    const errors: Record<string, string> = {};
    if (note.length < 1 || note.length > 120) errors.footer_note = COPY.footerNoteInvalid;
    if (!isCalendarDate(date) || date < today || (last !== undefined && date <= last.effective_date)) errors.effective_date = COPY.effectiveDateInvalid;
    if (Object.keys(errors).length > 0) throw validation(errors);
    if (last === undefined) throw new HttpError(404, { error: 'not_found' });
    const added: RevisionView = { letter: String.fromCharCode(last.letter.charCodeAt(0) + 1), footer_note: note, effective_date: date };
    await client.query(
      'INSERT INTO title_revisions (workspace_id, letter, footer_note, effective_date) VALUES ($1, $2, $3, $4)',
      [user.workspace_id, added.letter, added.footer_note, added.effective_date]);
    return added;
  });
  return { status: 201, body: { revision } };
}

export function registerExportRoutes(): void {
  registerRoute('POST', '/api/drawings/:id/exports', requestExport);
  registerRoute('GET', '/api/drawings/:id/exports', listExports);
  registerRoute('GET', '/api/exports/:id', readExport);
  registerRoute('GET', '/api/exports/:id/download', downloadExport);
  registerRoute('GET', '/api/templates/title-block-a3/revisions', listRevisions);
  registerRoute('POST', '/api/templates/title-block-a3/revisions', addRevision);
}
