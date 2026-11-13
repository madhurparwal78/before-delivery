// add, modify, move and delete, with the Conflict rules (rebased, dropped, redirected).
import * as copy from '../copy.ts';
import { invalid } from '../errors.ts';
import { isXrefId, transformEntity } from '../geometry/index.ts';
import type { Entity, Op, OpStatus } from '../types.ts';
import type { Context, OpOutcome } from './context.ts';
import { ZERO_LAYER } from './names.ts';
import { assertSettable, buildEntity, readDraft } from './entity.ts';

/** An xref entity (`Site|L1`) is read-only. */
export function assertModelHandle(handle: string): void {
  if (isXrefId(handle)) throw invalid(copy.xrefReadOnly(handle));
}

/** The dropped result for a target that is gone: someone else deleted it after the base revision, or it never existed. */
export function dropped(ctx: Context, handle: string): { message: string } {
  const other = ctx.otherChange('entity', handle);
  if (!other) throw invalid(copy.noEntity(handle));
  const message = copy.conflictDeleted(other.user, handle);
  ctx.notify(ctx.user, message);
  return { message };
}

/** The status of an op over several targets, some of which may have been dropped or rebased. */
function summarise(handles: string[], rebased: boolean, droppedMessages: string[]): OpOutcome {
  const message = droppedMessages[0];
  if (handles.length === 0) return { status: 'dropped', handles, message };
  const status: OpStatus = rebased || droppedMessages.length > 0 ? 'rebased' : 'applied';
  return message === undefined ? { status, handles } : { status, handles, message };
}

export function addOp(ctx: Context, op: Extract<Op, { type: 'add' }>): OpOutcome {
  let draft = op.entity;
  let status: OpStatus = 'applied';
  const messages: string[] = [];
  if (!ctx.ws.layers.has(draft.layer)) {
    const other = ctx.otherChange('layer', draft.layer);
    if (other) {
      messages.push(copy.conflictLayerDeleted(other.user, draft.layer));
      draft = { ...draft, layer: ZERO_LAYER };
      status = 'redirected';
    }
  }
  if (draft.type === 'insert' && ctx.ws.blocks.has(draft.block)) {
    const other = ctx.otherChange('block', draft.block);
    if (other) {
      messages.push(copy.conflictRedefined(other.user, draft.block));
      status = 'redirected';
    }
  }
  for (const message of messages) ctx.notify(ctx.user, message);
  ctx.assertUnlocked(draft.layer);
  const handle = ctx.newHandle(draft.type);
  ctx.ws.entities.set(handle, buildEntity(ctx, draft, handle, ctx.user));
  return messages.length === 0 ? { status, handles: [handle] } : { status, handles: [handle], message: messages[0] };
}

export function modifyOp(ctx: Context, op: Extract<Op, { type: 'modify' }>): OpOutcome {
  assertModelHandle(op.handle);
  const existing = ctx.ws.entities.get(op.handle);
  if (!existing) return { status: 'dropped', handles: [], ...dropped(ctx, op.handle) };
  assertSettable(existing.type, op.set);
  ctx.assertUnlocked(existing.layer);
  const other = ctx.otherChange('entity', op.handle);
  const base: Entity = other ? ctx.entityAtBase(op.handle) ?? existing : existing;
  const draft = readDraft({ ...base, ...op.set }, 'set');
  ctx.assertUnlocked(draft.layer);
  ctx.ws.entities.set(op.handle, buildEntity(ctx, draft, op.handle, existing.author ?? null, base));
  if (other) ctx.notify(other.user, copy.conflictChanged(ctx.user, op.handle));
  return { status: other ? 'rebased' : 'applied', handles: [op.handle] };
}

export function moveOp(ctx: Context, op: Extract<Op, { type: 'move' }>): OpOutcome {
  const delta = { kind: 'translate', dx: op.dx, dy: op.dy } as const;
  const moved: string[] = [];
  const droppedMessages: string[] = [];
  let rebased = false;
  for (const handle of op.handles) {
    assertModelHandle(handle);
    const existing = ctx.ws.entities.get(handle);
    if (!existing) {
      droppedMessages.push(dropped(ctx, handle).message);
      continue;
    }
    ctx.assertUnlocked(existing.layer);
    const other = ctx.otherChange('entity', handle);
    const base: Entity = other ? ctx.entityAtBase(handle) ?? existing : existing;
    ctx.ws.entities.set(handle, transformEntity(base, delta));
    if (other) {
      rebased = true;
      ctx.notify(other.user, copy.conflictMoved(ctx.user, handle));
    }
    moved.push(handle);
  }
  return summarise(moved, rebased, droppedMessages);
}

/** Deletes entities and the constraints that refer to them; dimensions and hatches that depend on them are settled by the derive step. */
export function removeEntities(ctx: Context, handles: readonly string[]): void {
  const gone = new Set(handles);
  for (const handle of gone) ctx.ws.entities.delete(handle);
  for (const constraint of ctx.ws.constraints.values()) {
    if (constraint.refs.some((ref) => gone.has(ref.handle))) ctx.ws.constraints.delete(constraint.id);
  }
}

export function deleteOp(ctx: Context, op: Extract<Op, { type: 'delete' }>): OpOutcome {
  const removed: string[] = [];
  const droppedMessages: string[] = [];
  for (const handle of op.handles) {
    assertModelHandle(handle);
    const existing = ctx.ws.entities.get(handle);
    if (!existing) {
      droppedMessages.push(dropped(ctx, handle).message);
      continue;
    }
    ctx.assertUnlocked(existing.layer);
    removed.push(handle);
  }
  removeEntities(ctx, removed);
  return summarise(removed, false, droppedMessages);
}
