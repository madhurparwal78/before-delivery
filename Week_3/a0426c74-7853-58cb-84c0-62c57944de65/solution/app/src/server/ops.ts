import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError, earlier } from '../shared/errors.ts';
import {
  applyGroup, makePatch, parseOperationGroup, type Change, type GroupOutcome, type ParsedDrawing, type ServerLoaders, type XrefDirectory,
  type XrefSource,
} from '../shared/model/index.ts';
import { MINIMUM_ROLE } from '../shared/rules.ts';
import type { ModelSnapshot, OperationGroup, OperationsResponse, Underlay } from '../shared/types.ts';
import { requireUser } from './auth.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { getDrawing, type DrawingRuntime } from './drawings.ts';
import { parsedImport } from './imports.ts';
import { RateLimiter } from './ratelimit.ts';
import { drawingAccess, roleOnDrawing } from './roles.ts';
import { route } from './router.ts';
import { findReplay } from './store.ts';
import { reverseGroup } from './undo.ts';
import { lastPublishedModel, versionModelFor } from './versions.ts';

const opLimiter = new RateLimiter(config.opRate);

/**
 * The server data the group's operations copy in (xref sources, a version's model, an uploaded file), fetched before the group is
 * applied because the engine reads it synchronously. Anything outside the person's folders is `not_found`.
 */
async function loadersFor(runtime: DrawingRuntime, username: string, group: OperationGroup): Promise<ServerLoaders> {
  const sourceIds = new Set<string>();
  const versionIds = new Set<string>();
  const importIds = new Set<string>();
  for (const op of group.ops) {
    if (op.type === 'xref_attach') sourceIds.add(op.source);
    else if (op.type === 'xref_reload' && runtime.state.xrefs[op.name]) sourceIds.add(runtime.state.xrefs[op.name].source);
    else if (op.type === 'version_restore') versionIds.add(op.version);
    else if (op.type === 'import_merge') importIds.add(op.import_id);
  }
  const xrefSources = new Map<string, XrefSource>();
  for (const id of sourceIds) {
    const access = await drawingAccess(username, id);
    if (!access || access.folderId !== runtime.folderId) throw new ApiError('not_found', copy.NOT_FOUND);
    xrefSources.set(id, await lastPublishedModel(id));
  }
  const versionModels = new Map<string, ModelSnapshot>();
  for (const id of versionIds) versionModels.set(id, await versionModelFor(username, id));
  const imports = new Map<string, ParsedDrawing>();
  for (const id of importIds) imports.set(id, await parsedImport(runtime.id, id));
  const known = <T>(map: Map<string, T>, id: string): T => {
    const value = map.get(id);
    if (!value) throw new ApiError('not_found', copy.NOT_FOUND);
    return value;
  };
  return {
    drawingId: runtime.id,
    xrefSource: (id) => known(xrefSources, id),
    xrefDirectory: sourceIds.size > 0 ? await folderDirectory(runtime.folderId) : { name: () => '', sources: () => [] },
    versionModel: (id) => known(versionModels, id),
    importedDrawing: (id) => known(imports, id),
  };
}

/** The names and xref sources of the drawings of one folder, for the circular reference chain. */
async function folderDirectory(folderId: string): Promise<XrefDirectory> {
  const rows = await db.query<{ id: string; name: string; xref_sources: string[] }>(
    'SELECT id, name, xref_sources FROM drawings WHERE folder_id = $1', [folderId],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return { name: (id) => byId.get(id)?.name ?? '', sources: (id) => byId.get(id)?.xref_sources ?? [] };
}

/**
 * Applies a group to the drawing in server order and stores it: a replayed op id returns the stored response, a base revision more
 * than PLOT_OP_WINDOW behind is `stale_base` (unless a refusal earlier in the published order also applies), and the whole group
 * applies or none of it.
 */
export function submitGroup(runtime: DrawingRuntime, username: string, group: OperationGroup): Promise<OperationsResponse> {
  return runtime.enqueue(async () => {
    const replay = await findReplay(runtime.id, group.ops.map((op) => op.op_id));
    if (replay) return replay;
    const loaders = await loadersFor(runtime, username, group);
    const stale = group.base_revision < runtime.state.revision - config.opWindow ? new ApiError('stale_base', copy.STALE_BASE) : null;
    let outcome: GroupOutcome;
    try {
      outcome = applyGroup(runtime.state, group, { username, conflicts: runtime.conflicts, loaders });
    } catch (error) {
      if (error instanceof ApiError && stale) throw earlier(error, stale);
      throw error;
    }
    if (stale) throw stale;
    return runtime.commit({ username, group, outcome, stack: 'push' });
  });
}

/**
 * Attaches a stored underlay record to the drawing as its own revision (command UNDERLAY): the other pages get it live, and it is not
 * an undo step. Must run inside the drawing's queue.
 */
export async function attachUnderlay(runtime: DrawingRuntime, username: string, underlay: Underlay): Promise<void> {
  const before = runtime.state;
  const state = { ...before, revision: before.revision + 1, underlays: [...before.underlays, underlay] };
  const changes: Change[] = [{ kind: 'underlay', key: underlay.id, before: null, after: underlay, derived: false }];
  const outcome: GroupOutcome = { state, results: [], changes, notices: [], patch: makePatch(state, changes), purged: null };
  await runtime.commit({
    username, outcome, stack: 'none', group: { group_id: randomUUID(), base_revision: before.revision, command: 'UNDERLAY', ops: [] },
  });
}

/**
 * Counts the request's operations against the person's operations per minute. It runs right after the session check, because the
 * published order puts `rate_limited` before `not_found` and every 403; a body without an `ops` list counts as one operation.
 */
function countOperations(username: string, body: unknown): void {
  const ops = typeof body === 'object' && body !== null && 'ops' in body ? body.ops : null;
  const count = Array.isArray(ops) ? Math.max(ops.length, 1) : 1;
  if (!opLimiter.take(username, count)) throw new ApiError('rate_limited', copy.OPS_RATE_LIMITED);
}

route('POST', '/api/drawings/:id/ops', async (ctx) => {
  const user = requireUser(ctx);
  const body = ctx.json();
  countOperations(user.username, body);
  await roleOnDrawing(ctx, ctx.params.id, MINIMUM_ROLE.editDrawing);
  const group = parseOperationGroup(body);
  return ctx.reply(200, await submitGroup(await getDrawing(ctx.params.id), user.username, group));
});

for (const direction of ['undo', 'redo'] as const) {
  route('POST', `/api/drawings/:id/${direction}`, async (ctx) => {
    const user = requireUser(ctx);
    countOperations(user.username, null);
    await roleOnDrawing(ctx, ctx.params.id, MINIMUM_ROLE.editDrawing);
    const runtime = await getDrawing(ctx.params.id);
    return ctx.reply(200, await runtime.enqueue(() => reverseGroup(runtime, user.username, direction)));
  });
}
