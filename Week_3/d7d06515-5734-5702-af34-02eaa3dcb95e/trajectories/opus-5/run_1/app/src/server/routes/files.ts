import crypto from 'node:crypto';
import { BLOCK_NAMES, LINETYPE_NAMES, PLOT_STYLES, STYLE_NAMES } from '../../shared/api';
import { copy } from '../../shared/copy';
import { formatDateTime } from '../../shared/format';
import { config } from '../config';
import { callerFromSession, requireCaller, type Caller } from '../accounts';
import { queryOn, query, transaction } from '../db';
import { ApiError, fail, ValidationError } from '../errors';
import {
  checkFileName,
  checkFolderName,
  defaultOrder,
  duplicateFileName,
  duplicateFolderName,
  findFolder,
  fileVersionKey,
  folderItems,
  insertFileVersion,
  isSortKey,
  listFileVersions,
  nextFileVersionNumber,
  recentItems,
  recordOpen,
  serializeItems,
  sortItems,
  touchDrawing,
  touchFolder,
  type FolderRecord,
  type SortKey,
} from '../files';
import { announceFiles, announceRecent } from '../live';
import { looksLikeDxf, parseDxf } from '../dxf';
import { getObject, putObjectConfirmed, StorageUnavailable } from '../storage';
import {
  insertDrawing,
  insertLayouts,
  nextDrawingName,
  replaceDrawingContent,
  rootFolderId,
  samplesFolderId,
} from '../workspaces';
import { findDrawingRecord, loadDrawingState, lockDrawingRecord } from '../drawings';
import { attachment, json, noContent, type Router } from '../http';

async function resolveFolder(caller: Caller, id: string): Promise<FolderRecord> {
  const folderId =
    id === 'root'
      ? await rootFolderId(caller.workspace.id)
      : id === 'samples'
        ? await samplesFolderId(caller.workspace.id)
        : id;
  const folder = await findFolder(folderId);
  if (folder === null || folder.workspace_id !== caller.workspace.id) fail('not_found');
  return folder;
}

export function registerFileRoutes(router: Router): void {
  router.add('GET', '/api/folders/:id', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const folder = await resolveFolder(caller, context.params.id!);
    const sortParam = context.query('sort');
    const orderParam = context.query('order');
    if (sortParam !== null && !isSortKey(sortParam)) throw new ValidationError({ sort: 'Unknown sort column.' });
    if (orderParam !== null && orderParam !== 'asc' && orderParam !== 'desc') {
      throw new ValidationError({ order: 'Unknown sort order.' });
    }
    const sort: SortKey = sortParam === null ? 'modified' : sortParam;
    const order = orderParam === null ? defaultOrder(sort) : orderParam;
    const search = context.query('q');
    let items = await folderItems(folder.id);
    if (search !== null && search.trim() !== '') {
      const needle = search.trim().toLowerCase();
      items = items.filter((item) => item.name.toLowerCase().includes(needle));
    }
    return json(200, {
      folder: { id: folder.id, name: folder.name, parent_id: folder.parent_id },
      items: serializeItems(sortItems(items, sort, order), caller.workspace),
    });
  });

  router.add('POST', '/api/folders', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const body = await context.json();
    const parent = await resolveFolder(caller, typeof body.parent_id === 'string' ? body.parent_id : 'root');
    const name = checkFolderName(typeof body.name === 'string' ? body.name : '');
    try {
      const rows = await query<FolderRecord>(
        `insert into folders (id, workspace_id, parent_id, name, kind, modified_at, created_at)
         values ($1,$2,$3,$4,'normal',$5,$5) returning *`,
        [crypto.randomUUID(), caller.workspace.id, parent.id, name, caller.now],
      );
      const folder = rows[0]!;
      await touchFolder(parent.id, caller.now);
      await announceFiles(caller.user.id, parent.id);
      return json(201, { folder: { id: folder.id, name: folder.name, parent_id: folder.parent_id } });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') throw duplicateFolderName(name);
      throw error;
    }
  });

  router.add('DELETE', '/api/folders/:id', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const folder = await resolveFolder(caller, context.params.id!);
    const items = await folderItems(folder.id);
    if (items.length > 0) fail('folder_not_empty');
    await query('delete from folders where id = $1', [folder.id]);
    if (folder.parent_id !== null) await touchFolder(folder.parent_id, caller.now);
    await announceFiles(caller.user.id, folder.parent_id);
    return noContent();
  });

  router.add('POST', '/api/drawings', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const body = await context.json();
    const folder = await resolveFolder(caller, typeof body.folder_id === 'string' ? body.folder_id : 'root');
    const name =
      typeof body.name === 'string' && body.name.trim() !== ''
        ? checkFileName(body.name)
        : await nextDrawingName(folder.id);
    const drawing = await transaction(async (client) => {
      const existing = await queryOn<{ id: string }>(
        client,
        'select id from drawings where folder_id = $1 and lower(name) = lower($2)',
        [folder.id, name],
      );
      if (existing.length > 0) throw duplicateFileName(name);
      const id = await insertDrawing(client, {
        workspaceId: caller.workspace.id,
        folderId: folder.id,
        name,
        units: caller.workspace.units,
        ownerUserId: caller.user.id,
        now: caller.now,
      });
      await client.query(
        `insert into layers (drawing_id, name, color, linetype, lineweight, is_on, frozen, locked, is_current, ord)
         values ($1,'0','White','Continuous','0.25 mm',true,false,false,true,0)`,
        [id],
      );
      return id;
    });
    await touchFolder(folder.id, caller.now);
    await announceFiles(caller.user.id, folder.id);
    const state = await loadDrawingState(drawing);
    return json(201, {
      drawing: {
        id: drawing,
        name,
        folder_id: folder.id,
        version: state?.record.version ?? 1,
        units: caller.workspace.units,
      },
    });
  });

  router.add('POST', '/api/drawings/:id/copy', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const source = await findDrawingRecord(context.params.id!);
    if (source === null || source.workspace_id !== caller.workspace.id) fail('not_found');
    const body = await context.json();
    const name = checkFileName(typeof body.name === 'string' ? body.name : '');
    const folder = await findFolder(
      source.is_sample ? await rootFolderId(caller.workspace.id) : source.folder_id,
    );
    if (folder === null) fail('not_found');
    const id = await transaction(async (client) => {
      const existing = await queryOn<{ id: string }>(
        client,
        'select id from drawings where folder_id = $1 and lower(name) = lower($2)',
        [folder.id, name],
      );
      if (existing.length > 0) throw duplicateFileName(name);
      const created = await queryOn<{ id: string }>(
        client,
        `insert into drawings (id, workspace_id, folder_id, name, units, plot_style, version, owner_user_id,
           is_sample, next_handle, object_seq, modified_at, created_at)
         select $1, $2, $3, $4, units, plot_style, 1, $5, false, next_handle, object_seq, $6, $6
         from drawings where id = $7 returning id`,
        [crypto.randomUUID(), caller.workspace.id, folder.id, name, caller.user.id, caller.now, source.id],
      );
      const newId = created[0]!.id;
      await client.query(
        `insert into layers (drawing_id, name, color, linetype, lineweight, is_on, frozen, locked, is_current, ord)
         select $1, name, color, linetype, lineweight, is_on, frozen, locked, is_current, ord
         from layers where drawing_id = $2`,
        [newId, source.id],
      );
      await client.query(
        `insert into objects (drawing_id, handle, type, layer, color, linetype, linetype_scale, lineweight,
           dimension_style, text_style, multileader_style, data, ord)
         select $1, handle, type, layer, color, linetype, linetype_scale, lineweight,
           dimension_style, text_style, multileader_style, data, ord
         from objects where drawing_id = $2`,
        [newId, source.id],
      );
      await client.query(
        `insert into layouts (drawing_id, name, viewport_scale, ord)
         select $1, name, viewport_scale, ord from layouts where drawing_id = $2`,
        [newId, source.id],
      );
      return newId;
    });
    await touchFolder(folder.id, caller.now);
    await announceFiles(caller.user.id, folder.id);
    return json(201, { drawing: { id, name, folder_id: folder.id, version: 1 } });
  });

  router.add('DELETE', '/api/drawings/:id', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const drawing = await findDrawingRecord(context.params.id!);
    if (drawing === null || drawing.workspace_id !== caller.workspace.id) fail('not_found');
    await query('delete from drawings where id = $1', [drawing.id]);
    await touchFolder(drawing.folder_id, caller.now);
    await announceFiles(caller.user.id, drawing.folder_id);
    return noContent();
  });

  router.add('POST', '/api/folders/:id/uploads', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const folder = await resolveFolder(caller, context.params.id!);
    const part = await context.upload(config.uploadMaxBytes);
    if (part === null) throw new ValidationError({ file: 'Choose a DXF file to upload.' });
    if (part.content.byteLength > config.uploadMaxBytes) {
      throw new ApiError('file_too_large', { limit_bytes: config.uploadMaxBytes });
    }
    const name = checkFileName(part.filename);
    if (!looksLikeDxf(part.content)) throw new ValidationError({ file: copy.files.notDxf(name) });
    const parsed = parseDxf(part.content.toString('latin1'));

    const existing = await query<{ id: string; version: number }>(
      'select id, version from drawings where folder_id = $1 and lower(name) = lower($2)',
      [folder.id, name],
    );
    const drawingId = existing[0]?.id ?? crypto.randomUUID();
    const isNew = existing.length === 0;
    const fileVersion = isNew ? 1 : await nextFileVersionNumber(drawingId);
    const key = fileVersionKey(drawingId, fileVersion);

    let sizeBytes: number;
    try {
      sizeBytes = await putObjectConfirmed(key, part.content, 'application/dxf');
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }

    const version = await transaction(async (client) => {
      if (isNew) {
        await client.query(
          `insert into drawings (id, workspace_id, folder_id, name, units, plot_style, version, owner_user_id,
             is_sample, modified_at, created_at)
           values ($1,$2,$3,$4,$5,'Monochrome',1,$6,false,$7,$7)`,
          [drawingId, caller.workspace.id, folder.id, name, parsed.units, caller.user.id, caller.now],
        );
        await insertLayouts(client, drawingId);
      }
      await replaceDrawingContent(client, drawingId, parsed.units, parsed.layers, parsed.objects);
      await insertFileVersion(client, {
        drawing_id: drawingId,
        number: fileVersion,
        created_at: caller.now,
        actor: caller.user.name,
        size_bytes: sizeBytes,
        object_key: key,
      });
      const updated = await queryOn<{ version: number }>(
        client,
        `update drawings set version = case when $2 then 1 else version + 1 end, modified_at = $3
         where id = $1 returning version`,
        [drawingId, isNew, caller.now],
      );
      const nextVersion = updated[0]!.version;
      await client.query(
        `insert into drawing_versions (drawing_id, version, actor, actor_key, command, created_handles,
           modified_handles, erased_handles, before_state, after_state, created_at)
         values ($1,$2,$3,$4,'UPLOAD',$5,'{}','{}','{"objects":{}}','{"objects":{}}',$6)`,
        [
          drawingId,
          nextVersion,
          caller.user.name,
          `user:${caller.user.id}`,
          parsed.objects.map((_, index) => (0x10 + index).toString(16).toUpperCase()),
          caller.now,
        ],
      );
      return nextVersion;
    });

    await touchFolder(folder.id, caller.now);
    await announceFiles(caller.user.id, folder.id);
    return json(201, {
      drawing: { id: drawingId, name, folder_id: folder.id, version },
      file_version: fileVersion,
      imported: parsed.imported,
      skipped: parsed.skipped,
    });
  });

  router.add('GET', '/api/drawings/:id/file-versions', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const drawing = await findDrawingRecord(context.params.id!);
    if (drawing === null || drawing.workspace_id !== caller.workspace.id) fail('not_found');
    const versions = await listFileVersions(drawing.id);
    return json(200, {
      versions: versions.map((version) => ({
        number: version.number,
        created_at: version.created_at.toISOString(),
        created_label: formatDateTime(version.created_at, caller.workspace.time_zone),
        actor: version.actor,
        size_bytes: version.size_bytes,
        object_key: version.object_key,
      })),
    });
  });

  router.add('GET', '/api/drawings/:id/file-versions/:number/download', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const drawing = await findDrawingRecord(context.params.id!);
    if (drawing === null || drawing.workspace_id !== caller.workspace.id) fail('not_found');
    const number = Number.parseInt(context.params.number!, 10);
    const versions = await listFileVersions(drawing.id);
    const version = versions.find((candidate) => candidate.number === number);
    if (version === undefined) fail('not_found');
    try {
      return attachment(await getObject(version.object_key), 'application/dxf', drawing.name);
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
  });

  router.add('POST', '/api/drawings/:id/file-versions/:number/restore', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const drawing = await findDrawingRecord(context.params.id!);
    if (drawing === null || drawing.workspace_id !== caller.workspace.id) fail('not_found');
    const body = await context.json();
    const baseVersion = typeof body.base_version === 'number' ? body.base_version : -1;
    if (drawing.version !== baseVersion) {
      throw new ApiError('version_conflict', { current_version: drawing.version, changed: [] });
    }
    const number = Number.parseInt(context.params.number!, 10);
    const versions = await listFileVersions(drawing.id);
    const source = versions.find((candidate) => candidate.number === number);
    if (source === undefined) fail('not_found');

    const newNumber = await nextFileVersionNumber(drawing.id);
    const key = fileVersionKey(drawing.id, newNumber);
    let bytes: Buffer;
    let sizeBytes: number;
    try {
      bytes = await getObject(source.object_key);
      sizeBytes = await putObjectConfirmed(key, bytes, 'application/dxf');
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
    const parsed = parseDxf(bytes.toString('latin1'));

    const version = await transaction(async (client) => {
      const locked = await lockDrawingRecord(client, drawing.id);
      if (locked === null) fail('not_found');
      if (locked.version !== baseVersion) {
        throw new ApiError('version_conflict', { current_version: locked.version, changed: [] });
      }
      await replaceDrawingContent(client, drawing.id, parsed.units, parsed.layers, parsed.objects);
      await insertFileVersion(client, {
        drawing_id: drawing.id,
        number: newNumber,
        created_at: caller.now,
        actor: caller.user.name,
        size_bytes: sizeBytes,
        object_key: key,
      });
      const updated = await queryOn<{ version: number }>(
        client,
        'update drawings set version = version + 1, modified_at = $2 where id = $1 returning version',
        [drawing.id, caller.now],
      );
      const nextVersion = updated[0]!.version;
      await client.query(
        `insert into drawing_versions (drawing_id, version, actor, actor_key, command, created_handles,
           modified_handles, erased_handles, before_state, after_state, created_at)
         values ($1,$2,$3,$4,'RESTORE',$5,'{}','{}','{"objects":{}}','{"objects":{}}',$6)`,
        [
          drawing.id,
          nextVersion,
          caller.user.name,
          `user:${caller.user.id}`,
          parsed.objects.map((_, index) => (0x10 + index).toString(16).toUpperCase()),
          caller.now,
        ],
      );
      const text = `${caller.user.name} restored version ${number}`;
      await client.query(
        'insert into activity (drawing_id, at, actor, command, count, verb, text) values ($1,$2,$3,$4,$5,$6,$7)',
        [drawing.id, caller.now, caller.user.name, 'RESTORE', parsed.imported, 'modified', text],
      );
      return nextVersion;
    });

    await touchDrawing(drawing.id, caller.now);
    await announceFiles(caller.user.id, drawing.folder_id);
    return json(201, { file_version: newNumber, version });
  });

  router.add('POST', '/api/drawings/:id/opened', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const drawing = await findDrawingRecord(context.params.id!);
    if (drawing === null || drawing.workspace_id !== caller.workspace.id) fail('not_found');
    await recordOpen(caller.user.id, drawing.id, caller.now);
    await announceRecent(caller.user.id);
    return noContent();
  });

  router.add('GET', '/api/recent', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    return json(200, { items: await recentItems(caller.user.id, caller.workspace) });
  });

  router.add('GET', '/api/support-files', async (context) => {
    requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    return json(200, {
      linetypes: LINETYPE_NAMES,
      plot_styles: PLOT_STYLES,
      blocks: BLOCK_NAMES,
      templates: ['Title block A3'],
      text_styles: STYLE_NAMES,
    });
  });
}
