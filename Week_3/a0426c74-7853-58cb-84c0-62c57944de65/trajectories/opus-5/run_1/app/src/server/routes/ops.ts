import type { DrawingModel } from '../../shared/model.js';
import type { ImportPayload } from '../../shared/apply.js';
import type { Operation } from '../../shared/operations.js';
import { requireRole, requireSignedIn } from '../access.js';
import { one } from '../db.js';
import {
  type ApplyHooks,
  type DrawingState,
  applyOperations,
  lastPublishedVersion,
  redo,
  undo,
  versionSnapshotModel,
} from '../drawings.js';
import { arrayField, readJson, requireNumber, route, sendJson, stringField } from '../http.js';
import { newId } from '../ids.js';
import { parseOperations } from '../validate.js';
import { drawingAccess } from './folders.js';

/** Everything the shared engine needs for this batch, fetched before it runs. */
export async function buildHooks(state: DrawingState, operations: Operation[]): Promise<ApplyHooks> {
  const versionModels = new Map<string, DrawingModel>();
  const importPayloads = new Map<string, ImportPayload>();
  const drawingNames = new Map<string, string>();
  const drawingXrefs = new Map<string, { name: string; source: string }[]>();
  const publishedVersions = new Map<string, number>();

  const noteDrawing = async (drawingId: string, depth = 0): Promise<void> => {
    if (drawingNames.has(drawingId) || depth > 20) return;
    const row = await one<{ name: string; model: DrawingModel }>('select name, model from drawings where id = $1', [drawingId]);
    if (!row) return;
    drawingNames.set(drawingId, row.name);
    drawingXrefs.set(
      drawingId,
      row.model.xrefs.map((xref) => ({ name: xref.name, source: xref.source })),
    );
    const published = await lastPublishedVersion(drawingId);
    if (published) publishedVersions.set(drawingId, published.number);
    for (const xref of row.model.xrefs) await noteDrawing(xref.source, depth + 1);
  };

  await noteDrawing(state.id);
  for (const operation of operations) {
    if (operation.type === 'version_restore') {
      const model = await versionSnapshotModel(operation.version);
      if (model) versionModels.set(operation.version, model);
    }
    if (operation.type === 'import_merge') {
      const row = await one<{ payload: ImportPayload }>('select payload from imports where id = $1 and drawing_id = $2', [
        operation.import_id,
        state.id,
      ]);
      if (row) importPayloads.set(operation.import_id, row.payload);
    }
    if (operation.type === 'xref_attach') await noteDrawing(operation.source);
    if (operation.type === 'xref_reload' || operation.type === 'xref_bind') {
      const xref = state.model.xrefs.find((candidate) => candidate.name === operation.name);
      if (!xref) continue;
      await noteDrawing(xref.source);
      const published = await lastPublishedVersion(xref.source);
      if (published) {
        publishedVersions.set(xref.source, published.number);
        versionModels.set(`${xref.source}:${xref.version_number ?? published.number}`, published.model);
        versionModels.set(`${xref.source}:${published.number}`, published.model);
      }
    }
  }

  return {
    versionModel: (key) => versionModels.get(key) ?? null,
    importPayload: (key) => importPayloads.get(key) ?? null,
    drawingName: (drawingId) => drawingNames.get(drawingId) ?? null,
    drawingXrefs: (drawingId) => drawingXrefs.get(drawingId) ?? [],
    publishedVersion: (drawingId) => publishedVersions.get(drawingId) ?? null,
  };
}

export async function runBatch(
  state: DrawingState,
  username: string,
  request: { base_revision: number; group_id: string; command: string; ops: Operation[]; draggedPoints?: string[] },
): Promise<{ revision: number; results: unknown[] }> {
  const hooks = await buildHooks(state, request.ops);
  if (request.draggedPoints) hooks.draggedPoints = request.draggedPoints;
  const outcome = await applyOperations(state, username, request, hooks);
  return outcome;
}

export function registerOpsRoutes(): void {
  route('POST', '/api/drawings/:id/ops', async (context) => {
    const username = requireSignedIn(context.username);
    const { state, role } = await drawingAccess(username, context.params.id);
    requireRole(role, 'edit');
    const body = await readJson(context);
    const baseRevision = requireNumber(body, 'base_revision');
    const groupId = stringField(body, 'group_id') ?? newId('grp');
    const command = stringField(body, 'command') ?? 'EDIT';
    const operations = parseOperations(arrayField(body, 'ops') ?? [], () => newId('op'));
    const dragged = (arrayField(body, 'dragged_points') ?? []).filter((entry): entry is string => typeof entry === 'string');
    const outcome = await runBatch(state, username, {
      base_revision: baseRevision,
      group_id: groupId,
      command,
      ops: operations,
      draggedPoints: dragged,
    });
    sendJson(context.res, 200, outcome);
  });

  route('POST', '/api/drawings/:id/undo', async (context) => {
    const username = requireSignedIn(context.username);
    const { state, role } = await drawingAccess(username, context.params.id);
    requireRole(role, 'edit');
    sendJson(context.res, 200, await undo(state, username));
  });

  route('POST', '/api/drawings/:id/redo', async (context) => {
    const username = requireSignedIn(context.username);
    const { state, role } = await drawingAccess(username, context.params.id);
    requireRole(role, 'edit');
    sendJson(context.res, 200, await redo(state, username));
  });
}

