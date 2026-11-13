import crypto from 'node:crypto';
import type { ExportRow, TitleBlockRevision } from '../shared/api';
import { copy } from '../shared/copy';
import { formatIsoDate } from '../shared/format';
import { parseIsoDate, studioToday, type WorkspaceRecord } from './clock';
import { one, query } from './db';
import { invalid } from './errors';
import { drawingExtents, isLayerVisible, loadDrawingState, type DrawingState } from './drawings';
import { writeDxf } from './dxf';
import { renderPdfSheet } from './pdf';
import { putObjectConfirmed } from './storage';

export interface ExportRecord {
  id: string;
  drawing_id: string;
  format: 'pdf' | 'dxf';
  layout: string;
  file: string;
  state: 'rendering' | 'stored' | 'failed';
  issued_at: Date;
  issue_date: string;
  title_block_revision: string;
  object_key: string | null;
  size_bytes: number | null;
}

export async function listRevisions(workspaceId: string): Promise<TitleBlockRevision[]> {
  const rows = await query<{ letter: string; footer_note: string; effective_date: string }>(
    'select letter, footer_note, effective_date from title_block_revisions where workspace_id = $1 order by effective_date, letter',
    [workspaceId],
  );
  return rows.map((row) => ({ ...row }));
}

/** An export uses the revision with the latest effective date on or before its issue date. */
export function revisionInEffect(revisions: TitleBlockRevision[], issueDate: string): TitleBlockRevision {
  const eligible = revisions.filter((revision) => revision.effective_date <= issueDate);
  const chosen = eligible.at(-1) ?? revisions[0];
  return chosen ?? { letter: 'A', footer_note: 'Issued for coordination.', effective_date: issueDate };
}

export async function addRevision(
  workspace: WorkspaceRecord,
  footerNote: string,
  effectiveDate: string,
  now: Date,
): Promise<TitleBlockRevision> {
  if (footerNote.length < 1 || footerNote.length > 120) invalid('footer_note', copy.exports.footerNoteError);
  if (parseIsoDate(effectiveDate) === null) invalid('effective_date', copy.exports.effectiveDateError);
  const revisions = await listRevisions(workspace.id);
  const latest = revisions.at(-1);
  const today = studioToday(workspace);
  if (effectiveDate < today) invalid('effective_date', copy.exports.effectiveDateError);
  if (latest !== undefined && effectiveDate <= latest.effective_date) {
    invalid('effective_date', copy.exports.effectiveDateError);
  }
  const letter = String.fromCharCode(65 + revisions.length);
  await query(
    `insert into title_block_revisions (workspace_id, letter, footer_note, effective_date, created_at)
     values ($1,$2,$3,$4,$5)`,
    [workspace.id, letter, footerNote, effectiveDate, now],
  );
  return { letter, footer_note: footerNote, effective_date: effectiveDate };
}

export function exportKey(drawingId: string, exportId: string, format: 'pdf' | 'dxf'): string {
  return `exports/${drawingId}/${exportId}.${format}`;
}

export function serializeExport(record: ExportRecord): ExportRow {
  return {
    id: record.id,
    drawing_id: record.drawing_id,
    format: record.format,
    layout: record.layout,
    file: record.file,
    state: record.state,
    issued_at: record.issued_at.toISOString(),
    issue_date: record.issue_date,
    title_block_revision: record.title_block_revision,
    object_key: record.object_key,
    size_bytes: record.size_bytes,
    download_url: record.state === 'stored' ? `/api/exports/${record.id}/download` : null,
  };
}

export async function findExport(id: string): Promise<ExportRecord | null> {
  return await one<ExportRecord>('select * from exports where id = $1', [id]);
}

export async function listExports(drawingId: string): Promise<ExportRecord[]> {
  return await query<ExportRecord>(
    'select * from exports where drawing_id = $1 order by issued_at desc, file desc',
    [drawingId],
  );
}

export interface ExportRequest {
  state: DrawingState;
  workspace: WorkspaceRecord;
  format: 'pdf' | 'dxf';
  layout: string;
  now: Date;
}

export async function createExport(request: ExportRequest): Promise<ExportRecord> {
  const { state, workspace } = request;
  const counter = await query<{ export_count: number }>(
    'update drawings set export_count = export_count + 1 where id = $1 returning export_count',
    [state.record.id],
  );
  const sequence = counter[0]!.export_count;
  const baseName = state.record.name.replace(/\.dxf$/i, '');
  const layoutName = request.format === 'dxf' ? 'Model' : request.layout;
  const file = `${baseName}-${layoutName}-${sequence}.${request.format}`;
  const issueDate = formatIsoDate(request.now, workspace.time_zone);
  const revision = revisionInEffect(await listRevisions(workspace.id), issueDate);
  const id = crypto.randomUUID();
  const rows = await query<ExportRecord>(
    `insert into exports (id, drawing_id, format, layout, file, state, issued_at, issue_date, title_block_revision)
     values ($1,$2,$3,$4,$5,'rendering',$6,$7,$8) returning *`,
    [id, state.record.id, request.format, layoutName, file, request.now, issueDate, revision.letter],
  );
  return rows[0]!;
}

/** Renders the sheet in-process and marks it stored only once MinIO confirms the object. */
export async function renderAndStore(record: ExportRecord, workspace: WorkspaceRecord): Promise<void> {
  try {
    const state = await loadDrawingState(record.drawing_id);
    if (state === null) throw new Error('drawing vanished');
    const revision = revisionInEffect(await listRevisions(workspace.id), record.issue_date);
    const body =
      record.format === 'dxf'
        ? Buffer.from(writeDxf(state), 'latin1')
        : renderPdfSheet({
            title: state.record.name.replace(/\.dxf$/i, ''),
            layout: record.layout,
            viewportScale:
              record.layout === 'Model'
                ? null
                : (state.layouts.find((layout) => layout.name === record.layout)?.viewport_scale ?? '1:50'),
            issueDate: record.issue_date,
            revisionLetter: revision.letter,
            footerNote: revision.footer_note,
            plotStyle: state.record.plot_style,
            layers: state.layers,
            objects: state.objects.filter((object) => isLayerVisible(state.layers, object.layer)),
            all: new Map(state.objects.map((object) => [object.handle, object])),
            units: state.record.units,
            extents: drawingExtents(state),
          });
    const key = exportKey(record.drawing_id, record.id, record.format);
    const size = await putObjectConfirmed(key, body, record.format === 'pdf' ? 'application/pdf' : 'application/dxf');
    await query("update exports set state = 'stored', object_key = $2, size_bytes = $3 where id = $1", [
      record.id,
      key,
      size,
    ]);
  } catch {
    await query("update exports set state = 'failed' where id = $1", [record.id]);
  }
}
