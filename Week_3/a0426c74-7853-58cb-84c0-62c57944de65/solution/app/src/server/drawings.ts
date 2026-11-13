import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError, fieldError } from '../shared/errors.ts';
import { ChangeLog, documentCollections, type GroupOutcome, type RestoreDirection } from '../shared/model/index.ts';
import type { DrawingDocument, DrawingState, Entity, OperationGroup, OperationsResponse, Xref } from '../shared/types.ts';
import { requireUser } from './auth.ts';
import { clock } from './clock.ts';
import { config } from './config.ts';
import { db, isUniqueViolation } from './db.ts';
import { hub } from './live.ts';
import { roleOnDrawing } from './roles.ts';
import { route, socketRoute } from './router.ts';
import { s3 } from './s3.ts';
import { sheetsOf } from './sheets.ts';
import { insertDrawing, logGroup, readChangesAfter, readDrawing, readTouches, writePatch } from './store.ts';
import { UndoStacks, type Stacks, type UndoEntry } from './undo.ts';

/** How a committed group changes its author's undo and redo stacks. */
export type StackEffect = 'push' | 'none' | { reverse: RestoreDirection; entry: UndoEntry };

export interface Commit {
  username: string;
  group: Pick<OperationGroup, 'group_id' | 'base_revision' | 'command' | 'ops'>;
  outcome: GroupOutcome;
  stack: StackEffect;
  /** on an undo or redo: the command of the group that was reversed or repeated */
  undone?: string;
}

/**
 * One drawing in memory: its current state, its change log and its people's undo stacks, written through to PostgreSQL by every
 * commit. Everything that changes the drawing runs through `enqueue`, so server order is arrival order.
 */
export class DrawingRuntime {
  readonly conflicts = new ChangeLog(() => this.state, config.opWindow);
  readonly undoStacks: UndoStacks;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(readonly id: string, readonly folderId: string, readonly name: string, public state: DrawingState) {
    this.undoStacks = new UndoStacks(id);
  }

  /** Runs `task` after everything queued before it has finished, whether that succeeded or not. */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Stores an applied group in one transaction, then makes it current and tells everyone with the drawing open. */
  async commit({ username, group, outcome, stack, undone }: Commit): Promise<OperationsResponse> {
    const revision = outcome.state.revision;
    const logged = { revision, command: group.command, changes: outcome.changes };
    const reversed = typeof stack === 'object';
    const stacked = (stack === 'push' && outcome.changes.length > 0) || reversed;
    if (stacked) await this.undoStacks.of(username);
    let stacks: Stacks | null;
    try {
      stacks = await db.tx(async (q) => {
        await logGroup(q, this.id, {
          revision, baseRevision: group.base_revision, groupId: group.group_id, username, command: group.command,
          at: new Date(clock.now()), ops: group.ops, results: outcome.results, changes: outcome.changes,
        });
        await writePatch(q, this.id, outcome.patch);
        if (reversed) return this.undoStacks.persistReversal(q, username, stack.reverse, stack.entry, revision);
        return stacked ? this.undoStacks.persistNewGroup(q, username, logged) : null;
      });
    } catch (error) {
      // Nothing was stored. If the drawing in memory is out of step with the database (another copy of the server wrote to it),
      // the next request reads it again.
      open.delete(this.id);
      throw error;
    }
    this.state = outcome.state;
    this.conflicts.record(outcome.changes, username, revision);
    if (stacks) this.undoStacks.install(username, stacks);
    hub.broadcast(this.id, {
      type: 'ops',
      data: {
        username, group_id: group.group_id, command: group.command, base_revision: group.base_revision, revision, ops: group.ops,
        results: outcome.results, patch: outcome.patch, ...(undone === undefined ? {} : { undone }),
      },
    });
    for (const notice of outcome.notices) hub.broadcast(this.id, { type: 'notice', data: notice });
    return { revision, results: outcome.results };
  }
}

// ---------------------------------------------------------------- opening and creating

const open = new Map<string, Promise<DrawingRuntime | null>>();

async function load(id: string): Promise<DrawingRuntime | null> {
  const stored = await readDrawing(id);
  if (!stored) return null;
  const runtime = new DrawingRuntime(id, stored.folderId, stored.name, stored.state);
  const before = new Map<string, Entity | null>();
  for (const group of await readChangesAfter(id, stored.state.revision - config.opWindow)) {
    for (const change of group.changes) if (change.kind === 'entity') before.set(`${change.key}\u0000${group.revision}`, change.before);
  }
  for (const touch of await readTouches(id)) {
    const known = before.get(`${touch.key}\u0000${touch.revision}`);
    runtime.conflicts.add(touch.kind, touch.key, {
      revision: touch.revision, username: touch.username, derived: touch.derived, ...(known === undefined ? {} : { entityBefore: known }),
    });
  }
  return runtime;
}

/** The drawing in memory (read from PostgreSQL on first use), or null when no drawing has that id. */
async function findDrawing(id: string): Promise<DrawingRuntime | null> {
  let pending = open.get(id);
  if (!pending) {
    pending = load(id);
    open.set(id, pending);
  }
  try {
    const runtime = await pending;
    if (!runtime) open.delete(id);
    return runtime;
  } catch (error) {
    open.delete(id);
    throw error;
  }
}

/** The drawing in memory; `not_found` when there is none. */
export async function getDrawing(id: string): Promise<DrawingRuntime> {
  const runtime = await findDrawing(id);
  if (!runtime) throw new ApiError('not_found', copy.NOT_FOUND);
  return runtime;
}

/** Creates a drawing in the folder with the given starting state. Names are unique within a folder. */
export async function createDrawing(folderId: string, name: string, state: DrawingState): Promise<DrawingRuntime> {
  const id = randomUUID();
  try {
    await db.tx((q) => insertDrawing(q, id, folderId, name, state));
  } catch (error) {
    if (isUniqueViolation(error)) throw fieldError('name', copy.DRAWING_NAME_TAKEN);
    throw error;
  }
  const runtime = new DrawingRuntime(id, folderId, name, state);
  open.set(id, Promise.resolve(runtime));
  return runtime;
}

/** Tells every drawing that has `sourceId` as an xref that the source published `versionId`, so its people see the reload notice. */
export async function announceXrefVersion(sourceId: string, versionId: string): Promise<void> {
  const source = await getDrawing(sourceId);
  const hosts = await db.query<{ id: string; xrefs: Xref[] }>('SELECT id, xrefs FROM drawings WHERE $1 = ANY(xref_sources)', [sourceId]);
  for (const host of hosts) {
    const names = host.xrefs.filter((xref) => xref.source === sourceId).map((xref) => xref.name);
    hub.broadcast(host.id, { type: 'xref_version', data: { source: sourceId, name: source.name, xref_names: names, version_id: versionId } });
  }
}

// ---------------------------------------------------------------- routes

route('GET', '/api/drawings/:id', async (ctx) => {
  const user = requireUser(ctx);
  const access = await roleOnDrawing(ctx, ctx.params.id);
  const runtime = await getDrawing(ctx.params.id);
  const seq = hub.lastSeq(runtime.id);
  const state = runtime.state;
  const views = await db.query<{ zoom: number; pan_x: number; pan_y: number }>(
    'SELECT zoom, pan_x, pan_y FROM drawing_views WHERE token_hash = $1 AND drawing_id = $2', [user.session, runtime.id],
  );
  const document: DrawingDocument = {
    id: runtime.id, name: runtime.name, folder_id: runtime.folderId, role: access.role, revision: state.revision,
    next_handle: state.next_handle, seq, view: views[0] ?? null, ...documentCollections(state),
    sheets: await sheetsOf(runtime.id),
  };
  return ctx.reply(200, document);
});

route('GET', '/api/drawings/:id/entities/:handle/history', async (ctx) => {
  await roleOnDrawing(ctx, ctx.params.id);
  const rows = await db.query<{ revision: number; username: string; command: string; at: Date }>(
    `SELECT g.revision, g.username, g.command, g.at FROM group_targets t
       JOIN op_groups g ON g.drawing_id = t.drawing_id AND g.revision = t.revision
      WHERE t.drawing_id = $1 AND t.kind = 'entity' AND t.key = $2 ORDER BY t.revision DESC`,
    [ctx.params.id, ctx.params.handle],
  );
  return ctx.reply(200, { history: rows.map((row) => ({ revision: row.revision, username: row.username, command: row.command, at: row.at.toISOString() })) });
});

// The image bytes of an underlay record. Its key holds the sha256 of the bytes, so the answer never changes.
route('GET', '/api/drawings/:id/underlays/:underlay', async (ctx) => {
  await roleOnDrawing(ctx, ctx.params.id);
  const underlay = (await getDrawing(ctx.params.id)).state.underlays.find((candidate) => candidate.id === ctx.params.underlay);
  if (!underlay) throw new ApiError('not_found', copy.NOT_FOUND);
  const contentType = underlay.key.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return ctx.reply(200, await s3.get(underlay.key), { 'content-type': contentType, 'cache-control': 'private, max-age=31536000, immutable' });
});

socketRoute('/api/drawings/:id/live', async (ctx) => {
  const user = requireUser(ctx);
  const access = await roleOnDrawing(ctx, ctx.params.id);
  return { attach: (socket) => hub.attachDrawing(ctx.params.id, user.username, access.role, socket) };
});
