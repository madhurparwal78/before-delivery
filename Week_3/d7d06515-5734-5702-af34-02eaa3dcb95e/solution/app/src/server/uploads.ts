// DXF uploads, file versions, downloads and restores: file replacements that raise the drawing version without being base edits.
import { COPY, copy } from '../shared/copy.ts';
import type { VersionItem } from '../shared/types.ts';
import { assertMay, authorizeDrawing, requireUser } from './access.ts';
import { dateTimeLabel, workspaceNow } from './clock.ts';
import { isUuid, pool, query, transaction, type Queryable } from './db.ts';
import {
  bumpVersion, createDrawing, drawingFileName, drawingRowOf, isUniqueViolation, loadModel, lockDrawing, modelFromImport, readDrawingView,
  replaceModel, viaStorage,
} from './drawing-store.ts';
import { blankModel } from './engine/index.ts';
import { publishAccount, publishDrawing } from './events.ts';
import { touchFolder } from './files.ts';
import { importDxf, looksLikeDxf } from './formats/dxf.ts';
import { recordChange, REPLACEMENTS, touchedHandles } from './history.ts';
import { HttpError, registerRoute, validation, type Context, type Reply } from './http.ts';
import { getObject, putObject } from './s3.ts';

type Replacement = (typeof REPLACEMENTS)[number];

interface Actor { key: string; name: string }

/** Puts the bytes in MinIO as the drawing's next file version; the Postgres row exists only once MinIO confirmed them. */
async function storeFileVersion(client: Queryable, drawingId: string, bytes: Buffer, actor: string, at: Date): Promise<number> {
  const last = await client.query<{ last: number }>('SELECT COALESCE(MAX(number), 0) AS last FROM file_versions WHERE drawing_id = $1', [drawingId]);
  const number = (last.rows[0]?.last ?? 0) + 1;
  const key = `drawings/${drawingId}/v${number}.dxf`;
  await viaStorage(putObject(key, bytes, 'application/dxf'));
  await client.query(
    'INSERT INTO file_versions (drawing_id, number, actor, size_bytes, object_key, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [drawingId, number, actor, bytes.length, key, at]);
  return number;
}

/** Replaces an existing drawing's objects, layers and units by an import, and logs which handles that touched. */
async function replaceContent(client: Queryable, drawingId: string, text: string, command: Replacement, actor: Actor, at: Date): Promise<{ version: number; changed: string[] }> {
  const old = await loadModel(client, drawingId);
  const next = modelFromImport(old, importDxf(text));
  await replaceModel(client, drawingId, next);
  const kept = new Set(next.objects.map((o) => o.handle));
  const before = new Set(old.objects.map((o) => o.handle));
  const change = {
    created: next.objects.filter((o) => !before.has(o.handle)).map((o) => o.handle),
    modified: next.objects.filter((o) => before.has(o.handle)).map((o) => o.handle),
    erased: old.objects.filter((o) => !kept.has(o.handle)).map((o) => o.handle),
  };
  const version = await bumpVersion(client, drawingId, next, at);
  await recordChange(client, drawingId, { ...change, version, actor_key: actor.key, actor_name: actor.name, command, before: { objects: {} }, after: { objects: {} }, at });
  return { version, changed: touchedHandles(change) };
}

async function folderOf(client: Queryable, workspaceId: string, folderId: string): Promise<string> {
  const found = folderId === 'root' || isUuid(folderId)
    ? await client.query<{ id: string }>(
      `SELECT id FROM folders WHERE workspace_id = $1 AND (id::text = $2 OR ($2 = 'root' AND parent_id IS NULL))`, [workspaceId, folderId])
    : null;
  const folder = found?.rows[0];
  if (!folder) throw new HttpError(404, { error: 'not_found' });
  return folder.id;
}

async function upload(ctx: Context): Promise<Reply> {
  const file = await ctx.file();
  const user = requireUser(ctx);
  const folderId = await folderOf(pool, user.workspace_id, ctx.params.id ?? '');
  if (!looksLikeDxf(file.bytes)) throw validation({ file: copy.notDxf(file.name) });
  const name = drawingFileName(file.name);
  if (name === null) throw validation({ file: COPY.fileNameInvalid });
  const text = file.bytes.toString('utf8');
  const imported = importDxf(text);
  const actor: Actor = { key: user.id, name: user.name };
  const stored = await transaction(async (client) => {
    const at = await workspaceNow(user.workspace_id, client);
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM drawings WHERE folder_id = $1 AND name_key = $2 AND deleted_at IS NULL FOR UPDATE', [folderId, name.toLowerCase()]);
    const found = existing.rows[0];
    if (found) {
      const number = await storeFileVersion(client, found.id, file.bytes, user.name, at);
      const replaced = await replaceContent(client, found.id, text, 'UPLOAD', actor, at);
      await touchFolder(client, folderId, at);
      return { drawingId: found.id, number, replaced };
    }
    const drawingId = await createDrawing(client, { workspaceId: user.workspace_id, folderId, name, model: modelFromImport(blankModel(imported.units), imported), at })
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? validation({ file: copy.fileTaken(name) }) : error;
      });
    const number = await storeFileVersion(client, drawingId, file.bytes, user.name, at);
    await touchFolder(client, folderId, at);
    return { drawingId, number, replaced: null };
  });
  await publishAccount(user.id, { type: 'files', folder_id: folderId });
  if (stored.replaced) {
    await publishDrawing(stored.drawingId, { type: 'change', version: stored.replaced.version, changed: stored.replaced.changed, actor: user.name, command: 'UPLOAD' });
  }
  const drawing = await readDrawingView(await drawingRowOf(stored.drawingId), 'owner');
  return { status: 201, body: { drawing, file_version: stored.number, imported: imported.imported, skipped: imported.skipped } };
}

async function listVersions(ctx: Context): Promise<Reply> {
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  const rows = await query<Omit<VersionItem, 'created_label'> & { created_at: Date }>(
    'SELECT number, created_at, actor, size_bytes, object_key FROM file_versions WHERE drawing_id = $1 ORDER BY number DESC', [access.drawing.id]);
  const versions: VersionItem[] = rows.map((r) => ({
    number: r.number,
    created_at: r.created_at.toISOString(),
    created_label: dateTimeLabel(r.created_at, access.zone),
    actor: r.actor,
    size_bytes: r.size_bytes,
    object_key: r.object_key,
  }));
  return { status: 200, body: { versions } };
}

async function versionKey(drawingId: string, number: string | undefined): Promise<string> {
  const rows = Number.isInteger(Number(number))
    ? await query<{ object_key: string }>('SELECT object_key FROM file_versions WHERE drawing_id = $1 AND number = $2', [drawingId, Number(number)])
    : [];
  const row = rows[0];
  if (!row) throw new HttpError(404, { error: 'not_found' });
  return row.object_key;
}

async function downloadVersion(ctx: Context): Promise<Reply> {
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  const key = await versionKey(access.drawing.id, ctx.params.number);
  return {
    status: 200,
    bytes: await viaStorage(getObject(key)),
    contentType: 'application/dxf',
    headers: { 'Content-Disposition': `attachment; filename="${access.drawing.name}"` },
  };
}

async function restoreVersion(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  assertMay(access.access, 'base', access);
  const key = await versionKey(access.drawing.id, ctx.params.number);
  const baseVersion = body.base_version;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion)) throw new HttpError(400, { error: 'bad_request' });
  const { drawing } = access;
  const restored = await transaction(async (client) => {
    await lockDrawing(client, drawing.id, baseVersion);
    const bytes = await viaStorage(getObject(key));
    const number = await storeFileVersion(client, drawing.id, bytes, access.actor.name, access.now);
    const replaced = await replaceContent(client, drawing.id, bytes.toString('utf8'), 'RESTORE', access.actor, access.now);
    if (drawing.folder_id) await touchFolder(client, drawing.folder_id, access.now);
    return { number, ...replaced };
  });
  await publishDrawing(drawing.id, { type: 'change', version: restored.version, changed: restored.changed, actor: access.actor.name, command: 'RESTORE' });
  if (drawing.folder_id) await publishAccount(access.ownerUserId, { type: 'files', folder_id: drawing.folder_id });
  return { status: 201, body: { file_version: restored.number, version: restored.version } };
}

export function registerUploadRoutes(): void {
  registerRoute('POST', '/api/folders/:id/uploads', upload);
  registerRoute('GET', '/api/drawings/:id/file-versions', listVersions);
  registerRoute('GET', '/api/drawings/:id/file-versions/:number/download', downloadVersion);
  registerRoute('POST', '/api/drawings/:id/file-versions/:number/restore', restoreVersion);
}
