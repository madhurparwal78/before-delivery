import { ApiError, MESSAGES } from '../../shared/errors.js';
import { ROLE_ORDER, type Role, roleChangeToast } from '../../shared/transitions.js';
import { folderRoles, notFound, requireRole, requireSignedIn, roleForFolder } from '../access.js';
import { one, query } from '../db.js';
import type { DrawingState } from '../drawings.js';
import {
  broadcast,
  createDrawing,
  drawingsInFolder,
  entityHistory,
  loadDrawing,
  resolveXrefs,
} from '../drawings.js';
import { cookies, readJson, requireString, route, sendEmpty, sendJson, stringField } from '../http.js';
import { newId } from '../ids.js';
import { sheetsOfDrawing, versionsOfSheet, viewportSnapshot, viewportsOfSheet } from '../publish.js';
import { userExists } from '../sessions.js';
import { startViewFor } from './grading.js';

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
}

export async function drawingAccess(username: string | null, drawingId: string): Promise<{ state: DrawingState; role: Role }> {
  const state = await loadDrawing(drawingId);
  if (!state) throw notFound();
  const role = await roleForFolder(username, state.folder_id);
  if (!role) throw notFound();
  return { state, role };
}

async function folderSubtree(folderId: string): Promise<string[]> {
  const ids = [folderId];
  for (let index = 0; index < ids.length; index += 1) {
    const children = await query<{ id: string }>('select id from folders where parent_id = $1', [ids[index]]);
    for (const child of children) ids.push(child.id);
  }
  return ids;
}

async function broadcastRole(folderId: string, username: string, role: Role | null): Promise<void> {
  const folders = await folderSubtree(folderId);
  for (const id of folders) {
    const drawings = await drawingsInFolder(id);
    for (const drawing of drawings) {
      const state = await loadDrawing(drawing.id);
      if (!state) continue;
      await broadcast(state, 'role', {
        username,
        role,
        text: role ? roleChangeToast(role) : MESSAGES.noAccess,
      });
    }
  }
}

export function registerFolderRoutes(): void {
  route('GET', '/api/folders', async (context) => {
    const username = requireSignedIn(context.username);
    const rows = await query<FolderRow>('select id, name, parent_id from folders order by created_at', []);
    const folders: Record<string, unknown>[] = [];
    for (const row of rows) {
      const role = await roleForFolder(username, row.id);
      if (!role) continue;
      folders.push({ id: row.id, name: row.name, parent_id: row.parent_id, role });
    }
    sendJson(context.res, 200, { folders });
  });

  route('POST', '/api/folders', async (context) => {
    const username = requireSignedIn(context.username);
    const body = await readJson(context);
    const name = requireString(body, 'name');
    const parentId = stringField(body, 'parent_id');
    if (parentId) {
      const parent = await one<FolderRow>('select id, name, parent_id from folders where id = $1', [parentId]);
      if (!parent) throw notFound();
      requireRole(await roleForFolder(username, parentId), 'manage');
    }
    const id = newId('fld');
    await query('insert into folders (id, name, parent_id) values ($1,$2,$3)', [id, name, parentId]);
    await query('insert into folder_roles (folder_id, username, role) values ($1,$2,$3)', [id, username, 'manage']);
    sendJson(context.res, 201, { id, name, parent_id: parentId, role: 'manage' });
  });

  route('PUT', '/api/folders/:id/roles/:username', async (context) => {
    const username = requireSignedIn(context.username);
    const folder = await one<FolderRow>('select id, name, parent_id from folders where id = $1', [context.params.id]);
    if (!folder) throw notFound();
    requireRole(await roleForFolder(username, folder.id), 'manage');
    const body = await readJson(context);
    const role = requireString(body, 'role');
    if (!(ROLE_ORDER as string[]).includes(role)) throw new ApiError('invalid', MESSAGES.invalid);
    const target = context.params.username.toLowerCase();
    if (!(await userExists(target))) throw notFound();
    await query(
      'insert into folder_roles (folder_id, username, role) values ($1,$2,$3) on conflict (folder_id, username) do update set role = $3',
      [folder.id, target, role],
    );
    await broadcastRole(folder.id, target, role as Role);
    sendJson(context.res, 200, { username: target, role, inherited: false });
  });

  route('DELETE', '/api/folders/:id/roles/:username', async (context) => {
    const username = requireSignedIn(context.username);
    const folder = await one<FolderRow>('select id, name, parent_id from folders where id = $1', [context.params.id]);
    if (!folder) throw notFound();
    requireRole(await roleForFolder(username, folder.id), 'manage');
    const target = context.params.username.toLowerCase();
    await query('delete from folder_roles where folder_id = $1 and username = $2', [folder.id, target]);
    const remaining = await roleForFolder(target, folder.id);
    await broadcastRole(folder.id, target, remaining);
    sendEmpty(context.res, 204);
  });

  route('GET', '/api/folders/:id/drawings', async (context) => {
    const username = requireSignedIn(context.username);
    const folder = await one<FolderRow>('select id, name, parent_id from folders where id = $1', [context.params.id]);
    if (!folder) throw notFound();
    const role = await roleForFolder(username, folder.id);
    if (!role) throw notFound();
    const drawings = await drawingsInFolder(folder.id);
    const payload: Record<string, unknown>[] = [];
    for (const drawing of drawings) {
      const sheets = await sheetsOfDrawing(drawing.id);
      const sheetPayload: Record<string, unknown>[] = [];
      for (const sheet of sheets) {
        const versions = await versionsOfSheet(sheet.id);
        sheetPayload.push({
          id: sheet.id,
          name: sheet.name,
          size: sheet.size,
          number: sheet.number,
          locked: sheet.locked,
          versions: versions.map((version) => ({
            id: version.id,
            number: version.number,
            state: version.state,
            snapshot: version.snapshot,
          })),
        });
      }
      payload.push({ id: drawing.id, name: drawing.name, sheets: sheetPayload });
    }
    sendJson(context.res, 200, { drawings: payload });
  });

  route('POST', '/api/folders/:id/drawings', async (context) => {
    const username = requireSignedIn(context.username);
    const folder = await one<FolderRow>('select id, name, parent_id from folders where id = $1', [context.params.id]);
    if (!folder) throw notFound();
    requireRole(await roleForFolder(username, folder.id), 'edit');
    const body = await readJson(context);
    const name = requireString(body, 'name');
    const state = await createDrawing(folder.id, name);
    sendJson(context.res, 201, { id: state.id, name: state.name, revision: 0 });
  });

  route('GET', '/api/drawings/:id', async (context) => {
    const username = requireSignedIn(context.username);
    const { state, role } = await drawingAccess(username, context.params.id);
    const sheets = await sheetsOfDrawing(state.id);
    const sheetPayload: Record<string, unknown>[] = [];
    for (const sheet of sheets) {
      const viewports = await viewportsOfSheet(sheet.id);
      const versions = await versionsOfSheet(sheet.id);
      sheetPayload.push({
        id: sheet.id,
        name: sheet.name,
        size: sheet.size,
        number: sheet.number,
        locked: sheet.locked,
        locked_by: sheet.locked_by,
        attributes: sheet.attributes,
        creator: sheet.creator,
        viewports: viewports.map(viewportSnapshot),
        versions: versions.map((version) => ({
          id: version.id,
          number: version.number,
          state: version.state,
          replaced_by: version.replaced_by,
        })),
      });
    }
    const underlays = await query<{ id: string; key: string; bytes: number; x1: number; y1: number; x2: number; y2: number }>(
      'select id, key, bytes, x1, y1, x2, y2 from underlays where drawing_id = $1',
      [state.id],
    );
    sendJson(context.res, 200, {
      id: state.id,
      name: state.name,
      folder_id: state.folder_id,
      role,
      revision: state.revision,
      next_handle: state.model.next_handle,
      layers: state.model.layers,
      entities: state.model.entities,
      blocks: state.model.blocks,
      dim_styles: state.model.dim_styles,
      parameters: state.model.parameters,
      constraints: state.model.constraints,
      xrefs: await resolveXrefs(state),
      layer_states: state.model.layer_states,
      underlays,
      members: await folderRoles(state.folder_id),
      start_view: startViewFor(cookies(context.req).plot_session, state.id),
      sheets: sheetPayload,
    });
  });

  route('GET', '/api/drawings/:id/entities/:handle/history', async (context) => {
    const username = requireSignedIn(context.username);
    const { state } = await drawingAccess(username, context.params.id);
    sendJson(context.res, 200, { history: entityHistory(state, context.params.handle) });
  });

}
