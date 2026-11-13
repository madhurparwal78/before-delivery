// Drawing routes: create, copy, delete, read, version-checked base edits, measure, activity and opened.
import { COPY } from '../shared/copy.ts';
import { measureDistance } from '../shared/geometry.ts';
import type { ApiObject, CommandSuccess, Point } from '../shared/types.ts';
import { assertMay, authorizeDrawing, requireUser, type DrawingAccess } from './access.ts';
import { workspaceNow } from './clock.ts';
import { isUuid, pool, transaction, type Queryable } from './db.ts';
import {
  bumpVersion, createDrawing, defaultDrawingName, drawingFileName, drawingRowOf, fileNameError, isUniqueViolation, loadModel, lockDrawing,
  nameTakenError, presentAll, readDrawingView, writePatch,
} from './drawing-store.ts';
import { applyCommand, applyPatch, blankModel } from './engine/index.ts';
import type { CommandOutcome, DrawingModel } from './engine/types.ts';
import { publishAccount, publishDrawing } from './events.ts';
import { recordOpened, touchFolder } from './files.ts';
import { activityEntry, listActivity, planUndoRedo, recordChange, touchedHandles } from './history.ts';
import { HttpError, registerRoute, validation, type Context, type Reply } from './http.ts';
import { applyXref } from './xrefs.ts';

const badRequest = (): HttpError => new HttpError(400, { error: 'bad_request' });

async function folderIn(client: Queryable, workspaceId: string, folderId: unknown): Promise<string> {
  const found = folderId === 'root' || isUuid(folderId)
    ? await client.query<{ id: string }>(
      `SELECT id FROM folders WHERE workspace_id = $1 AND (id::text = $2 OR ($2 = 'root' AND parent_id IS NULL))`, [workspaceId, folderId])
    : null;
  const folder = found?.rows[0];
  if (!folder) throw new HttpError(404, { error: 'not_found' });
  return folder.id;
}

/** Creates a drawing in a folder of the caller's workspace and tells their other tabs. */
async function createInFolder(userId: string, workspaceId: string, folderId: string, name: string | null, model: DrawingModel): Promise<Reply> {
  const created = await transaction(async (client) => {
    const at = await workspaceNow(workspaceId, client);
    const chosen = name ?? await defaultDrawingName(client, folderId);
    const id = await createDrawing(client, { workspaceId, folderId, name: chosen, model, at })
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? nameTakenError(chosen) : error;
      });
    await touchFolder(client, folderId, at);
    return id;
  });
  await publishAccount(userId, { type: 'files', folder_id: folderId });
  return { status: 201, body: { drawing: await readDrawingView(await drawingRowOf(created), 'owner') } };
}

async function createNew(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const user = requireUser(ctx);
  const folderId = await folderIn(pool, user.workspace_id, body.folder_id);
  let name: string | null = null;
  if (body.name !== undefined && body.name !== null) {
    name = typeof body.name === 'string' ? drawingFileName(body.name) : null;
    if (name === null) throw fileNameError();
  }
  return createInFolder(user.id, user.workspace_id, folderId, name, blankModel('mm'));
}

async function copyDrawing(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const user = requireUser(ctx);
  const source = await authorizeDrawing(ctx, ctx.params.id ?? '');
  const name = typeof body.name === 'string' ? drawingFileName(body.name) : null;
  if (name === null) throw fileNameError();
  const model = await loadModel(pool, source.drawing.id);
  return createInFolder(user.id, user.workspace_id, await folderIn(pool, user.workspace_id, 'root'), name, model);
}

async function deleteDrawing(ctx: Context): Promise<Reply> {
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  assertMay(access.access, 'owner', access);
  const { drawing } = access;
  await transaction(async (client) => {
    await client.query('UPDATE drawings SET deleted_at = $2 WHERE id = $1', [drawing.id, access.now]);
    if (drawing.folder_id) await touchFolder(client, drawing.folder_id, access.now);
  });
  if (drawing.folder_id) await publishAccount(access.ownerUserId, { type: 'files', folder_id: drawing.folder_id });
  return { status: 204 };
}

async function readDrawing(ctx: Context): Promise<Reply> {
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  return { status: 200, body: await readDrawingView(access.drawing, access.access) };
}

/** What a base command did, whichever way it was run: the engine, history (UNDO, REDO) or the server-owned XREF. */
async function runBaseCommand(client: Queryable, access: DrawingAccess, model: DrawingModel, command: string, args: unknown): Promise<CommandOutcome> {
  if (command === 'UNDO' || command === 'REDO') {
    const plan = await planUndoRedo(client, access.drawing.id, access.actor.key, command);
    if (!plan) {
      const history = command === 'UNDO' ? COPY.nothingToUndo : COPY.nothingToRedo;
      return { created: [], modified: [], erased: [], locked: [], history, changed: false, next: model, before: { objects: {} }, after: { objects: {} } };
    }
    return {
      ...plan.record,
      locked: [],
      history: `${command === 'UNDO' ? 'Undo' : 'Redo'}: ${plan.command}`,
      changed: true,
      next: applyPatch(model, plan.record.after),
    };
  }
  if (command === 'XREF') return applyXref(client, access.drawing.id, access.workspaceId, model, args);
  const result = applyCommand(model, command, args);
  if (!result.ok) throw new HttpError(result.refusal.status, result.refusal.body);
  return result.outcome;
}

function successBody(version: number, outcome: CommandOutcome): CommandSuccess {
  const touched = new Set([...outcome.created, ...outcome.modified]);
  const objects: ApiObject[] = presentAll(outcome.next.objects.filter((o) => touched.has(o.handle)), outcome.next.units);
  return {
    version,
    created: outcome.created,
    modified: outcome.modified,
    erased: outcome.erased,
    locked: outcome.locked,
    objects,
    history: outcome.history,
  };
}

async function runCommand(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  assertMay(access.access, 'base', access);
  const { base_version: baseVersion, command } = body;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || typeof command !== 'string') throw badRequest();
  const { drawing, actor } = access;
  const done = await transaction(async (client) => {
    const locked = await lockDrawing(client, drawing.id, baseVersion);
    const outcome = await runBaseCommand(client, access, await loadModel(client, drawing.id), command, body.args ?? {});
    if (!outcome.changed) return { version: locked.version, outcome, entry: null };
    await writePatch(client, drawing.id, outcome.after, outcome.next);
    const version = await bumpVersion(client, drawing.id, outcome.next, access.now);
    const change = {
      created: outcome.created, modified: outcome.modified, erased: outcome.erased, before: outcome.before, after: outcome.after,
      version, actor_key: actor.key, actor_name: actor.name, command, at: access.now,
    };
    await recordChange(client, drawing.id, change);
    if (drawing.folder_id) await touchFolder(client, drawing.folder_id, access.now);
    return { version, outcome, entry: activityEntry(change, access.zone), changed: touchedHandles(change) };
  });
  if (done.entry) {
    await publishDrawing(drawing.id, { type: 'change', version: done.version, changed: done.changed, actor: actor.name, command });
    await publishDrawing(drawing.id, { type: 'activity', entry: done.entry });
  }
  return { status: 200, body: successBody(done.version, done.outcome) };
}

function pointOf(value: unknown): Point | null {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [value[0], value[1]] : null;
}

async function measure(ctx: Context): Promise<Reply> {
  const body = await ctx.json();
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  const first = pointOf(body.first);
  const second = pointOf(body.second);
  if (!first || !second) throw validation({ [first ? 'second' : 'first']: COPY.invalidPoint });
  return { status: 200, body: measureDistance(first, second, access.drawing.units) };
}

async function activity(ctx: Context): Promise<Reply> {
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  return { status: 200, body: { entries: await listActivity(pool, access.drawing.id, access.zone) } };
}

async function opened(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const access = await authorizeDrawing(ctx, ctx.params.id ?? '');
  await recordOpened(pool, user.id, access.drawing.id, access.now);
  return { status: 204 };
}

export function registerDrawingRoutes(): void {
  registerRoute('POST', '/api/drawings', createNew);
  registerRoute('POST', '/api/drawings/:id/copy', copyDrawing);
  registerRoute('DELETE', '/api/drawings/:id', deleteDrawing);
  registerRoute('GET', '/api/drawings/:id', readDrawing);
  registerRoute('POST', '/api/drawings/:id/commands', runCommand);
  registerRoute('POST', '/api/drawings/:id/measure', measure);
  registerRoute('GET', '/api/drawings/:id/activity', activity);
  registerRoute('POST', '/api/drawings/:id/opened', opened);
}
