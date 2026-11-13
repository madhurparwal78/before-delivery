// Published sheet versions as the rest of the server reads them: summaries, documents, compare and the loaders the engine needs.
import * as copy from '../shared/copy.ts';
import { ApiError } from '../shared/errors.ts';
import { compareModels, type XrefSource } from '../shared/model/index.ts';
import type { ModelSnapshot, ReviewStep, VersionDocument, VersionSnapshot, VersionState, VersionSummary } from '../shared/types.ts';
import { accessTo, drawingOf } from './access.ts';
import { db, type Queryable } from './db.ts';
import { numberParam } from './fields.ts';
import { drawingAccess } from './roles.ts';
import { route } from './router.ts';

export interface StoredStamp { text: string; comment: string }

export interface VersionRow {
  id: string; sheet_id: string; number: number; state: VersionState; replaced_by: string | null;
  snapshot: VersionSnapshot; steps: ReviewStep[]; stamps: StoredStamp[];
}

export const summaryOf = (row: VersionRow): VersionSummary => ({
  id: row.id, number: row.number, state: row.state, replaced_by: row.replaced_by, stamps: row.stamps.map((stamp) => stamp.text), steps: row.steps,
});

/** One version; `not_found` for an unknown id. */
async function loadVersion(versionId: string, q: Queryable = db): Promise<VersionRow> {
  const rows = await q.query<VersionRow>('SELECT * FROM versions WHERE id = $1', [versionId]);
  if (rows.length === 0) throw new ApiError('not_found', copy.NOT_FOUND);
  return rows[0];
}

/** The version as `GET /api/versions/<id>` and the view link answer it. */
export async function versionDocument(versionId: string): Promise<VersionDocument> {
  const row = await loadVersion(versionId);
  return { ...summaryOf(row), sheet_id: row.sheet_id, drawing_id: await drawingOf('version', versionId), snapshot: row.snapshot };
}

const NO_MODEL: ModelSnapshot = { layers: [], entities: [], blocks: [], xrefs: [] };

/** What an xref copies from a drawing: the model of the version it published last, over all its sheets. */
export async function lastPublishedModel(drawingId: string): Promise<XrefSource> {
  const rows = await db.query<{ id: string; snapshot: VersionSnapshot }>(
    `SELECT v.id, v.snapshot FROM versions v JOIN sheets s ON s.id = v.sheet_id WHERE s.drawing_id = $1 ORDER BY v.seq DESC LIMIT 1`,
    [drawingId],
  );
  return rows.length === 0 ? { version_id: null, model: NO_MODEL } : { version_id: rows[0].id, model: rows[0].snapshot.model };
}

/** The model of a version for Restore; `not_found` unless the person has a role on its drawing. */
export async function versionModelFor(username: string, versionId: string): Promise<ModelSnapshot> {
  if (!(await drawingAccess(username, await drawingOf('version', versionId)))) throw new ApiError('not_found', copy.NOT_FOUND);
  return (await loadVersion(versionId)).snapshot.model;
}

route('GET', '/api/sheets/:id/versions', async (ctx) => {
  await accessTo(ctx, 'sheet', ctx.params.id);
  const rows = await db.query<VersionRow>('SELECT * FROM versions WHERE sheet_id = $1 ORDER BY number', [ctx.params.id]);
  return ctx.reply(200, { versions: rows.map(summaryOf) });
});

route('GET', '/api/versions/:id', async (ctx) => {
  await accessTo(ctx, 'version', ctx.params.id);
  return ctx.reply(200, await versionDocument(ctx.params.id));
});

route('GET', '/api/sheets/:id/compare', async (ctx) => {
  await accessTo(ctx, 'sheet', ctx.params.id);
  const [from, to] = ['from', 'to'].map((name) => numberParam(ctx.query, name));
  const rows = await db.query<{ number: number; snapshot: VersionSnapshot }>(
    'SELECT number, snapshot FROM versions WHERE sheet_id = $1 AND number = ANY($2)', [ctx.params.id, [from, to]],
  );
  const model = (number: number): ModelSnapshot => {
    const row = rows.find((candidate) => candidate.number === number);
    if (!row) throw new ApiError('not_found', copy.NOT_FOUND);
    return row.snapshot.model;
  };
  return ctx.reply(200, compareModels(model(from), model(to)));
});
