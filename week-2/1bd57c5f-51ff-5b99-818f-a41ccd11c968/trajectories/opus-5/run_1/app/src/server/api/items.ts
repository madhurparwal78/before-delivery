import { isTrade, type ItemStatus, type ConflictField, type Trade } from '../../shared/domain.js';
import { db, type Queryable } from '../db.js';
import { ApiError, errorBody, fail, FIELD_MESSAGES, type ErrorBody } from '../errors.js';
import { emitItem, emitItemDeleted, jobWrite } from '../events.js';
import { body, requireAccount, route, sendEmpty, sendJson, type Ctx, type Route } from '../http.js';
import { requireJob, requireOpenJob, requireRole, requireUuid, type JobContext } from '../jobctx.js';
import {
  checkDelete,
  isItemAction,
  mayRunAction,
  runTransition,
  type ActorOnJob,
  type ItemAction,
  type ItemFacts,
} from '../core/lifecycle.js';
import { MAX_BLOCKERS, transitiveDependents, wouldCycle, type BlockerGraph } from '../core/dependencies.js';
import {
  canSeeItem,
  loadItems,
  loadRooms,
  projectItem,
  roomForPin,
  type ItemRecord,
  type RoomRecord,
} from '../model.js';
import {
  checkTradeChange,
  clearConflict,
  insertItem,
  raiseFieldErrors,
  readItemFields,
  recordItemChange,
  reloadItem,
  requireItem,
  resolveRoomAndPin,
  writeItem,
} from '../itemcore.js';
import { queueAssignmentNotices } from '../mail.js';
import { deleteObject, StorageUnavailable } from '../services/objectstore.js';
import { readPinCoordinate, type UPoint } from '../core/geometry.js';
import { exactUnits } from '../core/decimal.js';

function actorOf(ctx: JobContext): ActorOnJob {
  return { role: ctx.viewer.role, trade: ctx.viewer.trade, personId: ctx.viewer.personId };
}

export function factsOf(item: ItemRecord, items: ItemRecord[]): ItemFacts {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  const unverified = item.blockedByIds
    .map((id) => byId.get(id))
    .filter((blocker): blocker is ItemRecord => blocker !== undefined && blocker.status !== 'verified')
    .map((blocker) => blocker.number)
    .sort((a, b) => a - b);
  return {
    status: item.status,
    trade: item.trade,
    createdBy: item.createdById,
    unverifiedBlockers: unverified,
    completionPhotos: item.photos.filter((photo) => photo.kind === 'completion').length,
  };
}

function graphOf(items: ItemRecord[]): BlockerGraph {
  return new Map(items.map((item) => [item.id, item.blockedByIds]));
}

async function applyTransitionTo(
  tx: Queryable,
  ctx: JobContext,
  target: ItemRecord,
  action: ItemAction,
  reason: string | null,
  at: Date,
): Promise<{ item: ItemRecord; reopened: number[] }> {
  const items = await loadItems(tx, ctx.job.id);
  const item = items.find((candidate) => candidate.id === target.id);
  if (item === undefined) fail('not_found');
  const outcome = runTransition(action, factsOf(item, items));
  if ('error' in outcome) throw new ApiError(outcome.error as never, stripBody(outcome));
  await writeItem(
    tx,
    item.id,
    {
      status: outcome.status,
      sentBackReason: outcome.storeReason
        ? reason
        : outcome.clearSentBackReason
          ? null
          : undefined,
      by: ctx.viewer.name,
    },
    at,
  );
  const reopened: number[] = [];
  if (outcome.cascade) {
    const dependents = transitiveDependents(graphOf(items), item.id);
    for (const dependentId of dependents) {
      const dependent = items.find((candidate) => candidate.id === dependentId)!;
      if (dependent.status !== 'ready_for_check' && dependent.status !== 'verified') continue;
      await writeItem(
        tx,
        dependentId,
        { status: 'open', sentBackReason: null, by: ctx.viewer.name },
        at,
      );
      reopened.push(dependent.number);
      const fresh = await reloadItem(tx, ctx.job.id, dependentId);
      await recordItemChange(tx, ctx.job.id, fresh, 'acted', at);
      await emitItem(tx, ctx.job.id, fresh, fresh.trade);
    }
  }
  const fresh = await reloadItem(tx, ctx.job.id, item.id);
  await recordItemChange(tx, ctx.job.id, fresh, 'acted', at);
  await emitItem(tx, ctx.job.id, fresh, fresh.trade);
  return { item: fresh, reopened: reopened.sort((a, b) => a - b) };
}

function stripBody(outcome: ErrorBody): Record<string, unknown> {
  const extra: Record<string, unknown> = { ...outcome };
  delete extra.error;
  delete extra.message;
  return extra;
}

async function deleteItemRecord(
  ctx: JobContext,
  item: ItemRecord,
  at: Date,
): Promise<void> {
  try {
    for (const photo of item.photos) await deleteObject(photo.objectKey);
  } catch (error) {
    if (error instanceof StorageUnavailable) fail('storage_unavailable');
    throw error;
  }
  await jobWrite(ctx.job.id, async (tx) => {
    await recordItemChange(tx, ctx.job.id, item, 'deleted', at);
    await tx.query(`delete from item_blockers where item_id = $1 or blocker_id = $1`, [item.id]);
    await tx.query(`delete from items where id = $1`, [item.id]);
    await emitItemDeleted(tx, ctx.job.id, item);
  });
}

export const itemRoutes: Route[] = [
  route('GET', '/api/jobs/:jobId/items', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const rooms = await loadRooms(db, jobCtx.job.id);
    const order = new Map(rooms.map((room, index) => [room.id, index]));
    const items = (await loadItems(db, jobCtx.job.id))
      .filter((item) => canSeeItem(jobCtx.viewer, item))
      .sort(
        (a, b) =>
          (order.get(a.roomId) ?? 0) - (order.get(b.roomId) ?? 0) || a.number - b.number,
      );
    sendJson(ctx.res, 200, { items: items.map((item) => projectItem(item, jobCtx.viewer)) });
  }),

  route('POST', '/api/jobs/:jobId/items', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    if (jobCtx.viewer.role === 'trade') fail('forbidden');
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const rooms = await loadRooms(db, jobCtx.job.id);
    const fields = readItemFields(raw, rooms, jobCtx.viewer.role);
    if (!fields.present.has('title')) fields.errors.title = 'Give the item a title.';
    if (!fields.present.has('room_id')) fields.errors.room_id = 'Choose the room this item is in.';
    raiseFieldErrors(fields);

    let roomId = fields.roomId!;
    let pinStatus: 'placed' | 'unpinned' = 'unpinned';
    if (fields.present.has('pin') && fields.pin !== null) {
      const room = roomForPin(rooms, fields.pin, roomId, null);
      if (room === null) throw new ApiError('validation', { fields: { pin: FIELD_MESSAGES.pin } });
      roomId = room.id;
      pinStatus = 'placed';
    }

    const item = await jobWrite(jobCtx.job.id, (tx) =>
      insertItem(
        tx,
        jobCtx,
        {
          title: fields.title!,
          roomId,
          trade: fields.present.has('trade') ? fields.trade : null,
          costNote: fields.present.has('cost_note') ? fields.costNote : null,
          quantity: fields.present.has('quantity') ? fields.quantity : null,
          unitCost: fields.present.has('unit_cost') ? fields.unitCost : null,
          pin: pinStatus === 'placed' ? fields.pin : null,
          pinStatus,
        },
        new Date(),
      ),
    );
    sendJson(ctx.res, 201, projectItem(item, jobCtx.viewer));
  }),

  route('POST', '/api/jobs/:jobId/items/bulk', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const raw = body(ctx);
    const pending: Record<string, string> = {};
    const action =
      raw.action === 'start' ||
      raw.action === 'mark_done' ||
      raw.action === 'verify' ||
      raw.action === 'set_trade'
        ? raw.action
        : null;
    if (action === null) pending.action = 'Choose a bulk action.';
    const ids = raw.item_ids;
    const idsValid =
      Array.isArray(ids) &&
      ids.length >= 1 &&
      ids.length <= 100 &&
      new Set(ids).size === ids.length;
    if (!idsValid) pending.item_ids = 'Select 1 to 100 items, each once.';
    let trade: Trade | null = null;
    if (action === 'set_trade') {
      if (raw.trade === null) trade = null;
      else if (isTrade(raw.trade)) trade = raw.trade;
      else pending.trade = 'Choose one of the listed trades.';
    }

    const all = await loadItems(db, jobCtx.job.id);
    const selected: ItemRecord[] = [];
    if (idsValid) {
      for (const id of ids as unknown[]) {
        if (typeof id !== 'string') fail('not_found');
        requireUuid(id);
        const item = all.find((candidate) => candidate.id === id);
        if (item === undefined || !canSeeItem(jobCtx.viewer, item)) fail('not_found');
        selected.push(item);
      }
    }
    if (jobCtx.viewer.role === 'homeowner') fail('forbidden');
    if (jobCtx.viewer.role === 'trade' && (action === 'verify' || action === 'set_trade')) {
      fail('forbidden');
    }
    requireOpenJob(jobCtx);
    if (action === null || Object.keys(pending).length > 0) {
      throw new ApiError('validation', { fields: pending });
    }
    selected.sort((a, b) => a.number - b.number);

    const simulated = new Map(all.map((item) => [item.id, { ...item }]));
    const failures: { number: number; error: string; message: string }[] = [];
    for (const item of selected) {
      const current = simulated.get(item.id)!;
      if (action === 'set_trade') {
        if (current.trade !== trade && !['open', 'in_progress'].includes(current.status)) {
          const problem = errorBody('invalid_transition');
          failures.push({ number: item.number, error: problem.error, message: problem.message });
          continue;
        }
        current.trade = trade;
        continue;
      }
      const facts = factsOf(current, [...simulated.values()]);
      if (!mayRunAction(action, actorOf(jobCtx), facts)) fail('forbidden');
      const outcome = runTransition(action, facts);
      if ('error' in outcome) {
        failures.push({
          number: item.number,
          error: outcome.error as string,
          message: outcome.message as string,
        });
        continue;
      }
      current.status = outcome.status as ItemStatus;
      if (outcome.clearSentBackReason) current.sentBackReason = null;
    }
    if (failures.length > 0) {
      fail('bulk_failed', { failures: failures.sort((a, b) => a.number - b.number) });
    }

    const at = new Date();
    const updated = await jobWrite(jobCtx.job.id, async (tx) => {
      const rooms = await loadRooms(tx, jobCtx.job.id);
      const out: ItemRecord[] = [];
      for (const item of selected) {
        const target = simulated.get(item.id)!;
        if (action === 'set_trade') {
          const previous = item.trade;
          await writeItem(tx, item.id, { trade, by: jobCtx.viewer.name }, at);
          await clearConflict(tx, item.id, 'trade');
          const fresh = await reloadItem(tx, jobCtx.job.id, item.id);
          await emitItem(tx, jobCtx.job.id, fresh, previous);
          if (trade !== null && trade !== previous) {
            const room = rooms.find((candidate) => candidate.id === fresh.roomId)!;
            await queueAssignmentNotices(
              tx,
              jobCtx.job,
              fresh,
              room.name,
              trade,
              jobCtx.members,
              at,
            );
          }
          out.push(fresh);
        } else {
          await writeItem(
            tx,
            item.id,
            {
              status: target.status,
              sentBackReason: target.status === 'ready_for_check' ? null : undefined,
              by: jobCtx.viewer.name,
            },
            at,
          );
          const fresh = await reloadItem(tx, jobCtx.job.id, item.id);
          await recordItemChange(tx, jobCtx.job.id, fresh, 'acted', at);
          await emitItem(tx, jobCtx.job.id, fresh, fresh.trade);
          out.push(fresh);
        }
      }
      return out;
    });
    sendJson(ctx.res, 200, { items: updated.map((item) => projectItem(item, jobCtx.viewer)) });
  }),

  route('GET', '/api/jobs/:jobId/items/:itemId', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    sendJson(ctx.res, 200, projectItem(item, jobCtx.viewer));
  }),

  route('PATCH', '/api/jobs/:jobId/items/:itemId', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    const raw = body(ctx);
    const rooms = await loadRooms(db, jobCtx.job.id);
    const fields = readItemFields(raw, rooms, jobCtx.viewer.role);
    if (fields.present.size === 0) {
      throw new ApiError('validation', { fields: { body: 'Send at least one field to change.' } });
    }
    const homeownerPinOnly =
      jobCtx.viewer.role === 'homeowner' &&
      fields.present.size === 1 &&
      fields.present.has('pin') &&
      item.createdById === jobCtx.viewer.personId;
    if (jobCtx.viewer.role === 'trade') fail('forbidden');
    if (jobCtx.viewer.role === 'homeowner' && !homeownerPinOnly) fail('forbidden');
    requireOpenJob(jobCtx);

    if (fields.present.has('trade')) checkTradeChange(item, fields.trade);
    raiseFieldErrors(fields);

    const placement = resolveRoomAndPin(rooms, item, {
      pinSent: fields.present.has('pin'),
      pin: fields.pin,
      roomSent: fields.present.has('room_id'),
      roomId: fields.roomId,
    });

    const at = new Date();
    const updated = await jobWrite(jobCtx.job.id, async (tx) => {
      const current = (await loadItems(tx, jobCtx.job.id, [item.id]))[0];
      if (current === undefined) fail('not_found');
      if (fields.present.has('trade')) checkTradeChange(current, fields.trade);
      const previousTrade = current.trade;
      await writeItem(
        tx,
        item.id,
        {
          title: fields.present.has('title') ? fields.title! : undefined,
          trade: fields.present.has('trade') ? fields.trade : undefined,
          costNote: fields.present.has('cost_note') ? fields.costNote : undefined,
          quantity: fields.present.has('quantity') ? fields.quantity : undefined,
          unitCost: fields.present.has('unit_cost') ? fields.unitCost : undefined,
          roomId: placement.roomId,
          pin: placement.pin,
          pinStatus: placement.pinStatus,
          by: jobCtx.viewer.name,
        },
        at,
      );
      for (const key of fields.present) await clearConflict(tx, item.id, key as ConflictField);
      const fresh = await reloadItem(tx, jobCtx.job.id, item.id);
      if (fresh.roomId !== item.roomId) {
        await recordItemChange(tx, jobCtx.job.id, fresh, 'refiled', at);
      }
      await emitItem(tx, jobCtx.job.id, fresh, previousTrade);
      if (fresh.trade !== null && fresh.trade !== previousTrade) {
        const room = (await loadRooms(tx, jobCtx.job.id)).find(
          (candidate) => candidate.id === fresh.roomId,
        )!;
        await queueAssignmentNotices(
          tx,
          jobCtx.job,
          fresh,
          room.name,
          fresh.trade,
          jobCtx.members,
          at,
        );
      }
      return fresh;
    });
    sendJson(ctx.res, 200, projectItem(updated, jobCtx.viewer));
  }),

  route('DELETE', '/api/jobs/:jobId/items/:itemId', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    const problem = checkDelete(actorOf(jobCtx), factsOf(item, await loadItems(db, jobCtx.job.id)));
    if (problem !== null && problem.error === 'forbidden') fail('forbidden');
    requireOpenJob(jobCtx);
    if (problem !== null) throw new ApiError(problem.error as never, stripBody(problem));
    await deleteItemRecord(jobCtx, item, new Date());
    sendEmpty(ctx.res, 204);
  }),

  route('POST', '/api/jobs/:jobId/items/:itemId/actions', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    const raw = body(ctx);
    const action = isItemAction(raw.action) ? raw.action : null;
    const items = await loadItems(db, jobCtx.job.id);
    if (action !== null && !mayRunAction(action, actorOf(jobCtx), factsOf(item, items))) {
      fail('forbidden');
    }
    requireOpenJob(jobCtx);
    if (action === null) {
      throw new ApiError('validation', { fields: { action: 'Choose an item action.' } });
    }
    let reason: string | null = null;
    if (action === 'send_back') {
      if (typeof raw.reason !== 'string' || raw.reason.length < 1 || raw.reason.length > 500) {
        throw new ApiError('validation', {
          fields: { reason: 'Give a reason of 1 to 500 characters.' },
        });
      }
      reason = raw.reason;
    }
    const outcome = await jobWrite(jobCtx.job.id, (tx) =>
      applyTransitionTo(tx, jobCtx, item, action, reason, new Date()),
    );
    const projected = projectItem(outcome.item, jobCtx.viewer);
    if (action === 'reopen') projected.reopened_dependents = outcome.reopened;
    sendJson(ctx.res, 200, projected);
  }),

  route('PUT', '/api/jobs/:jobId/items/:itemId/blocked-by', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    requireRole(jobCtx, ['owner', 'lead']);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const ids = raw.item_ids;
    if (!Array.isArray(ids) || ids.length > MAX_BLOCKERS) {
      throw new ApiError('validation', {
        fields: { item_ids: 'An item waits on at most 10 others.' },
      });
    }
    const all = await loadItems(db, jobCtx.job.id);
    const unique: string[] = [];
    for (const id of ids) {
      if (typeof id !== 'string') fail('not_found');
      requireUuid(id);
      const blocker = all.find((candidate) => candidate.id === id);
      if (blocker === undefined || !canSeeItem(jobCtx.viewer, blocker)) fail('not_found');
      if (!unique.includes(id)) unique.push(id);
    }

    const updated = await jobWrite(jobCtx.job.id, async (tx) => {
      const items = await loadItems(tx, jobCtx.job.id);
      if (wouldCycle(graphOf(items), item.id, unique)) {
        throw new ApiError('validation', { fields: { item_ids: FIELD_MESSAGES.cycle } });
      }
      const current = items.find((candidate) => candidate.id === item.id)!;
      const unverified = unique
        .map((id) => items.find((candidate) => candidate.id === id)!)
        .filter((blocker) => blocker.status !== 'verified');
      if (
        unverified.length > 0 &&
        (current.status === 'ready_for_check' || current.status === 'verified')
      ) {
        fail('blocked', {
          waiting_on: unverified.map((blocker) => blocker.number).sort((a, b) => a - b),
        });
      }
      await tx.query(`delete from item_blockers where item_id = $1`, [item.id]);
      for (const id of unique) {
        await tx.query(`insert into item_blockers (item_id, blocker_id) values ($1, $2)`, [
          item.id,
          id,
        ]);
      }
      const fresh = await reloadItem(tx, jobCtx.job.id, item.id);
      await emitItem(tx, jobCtx.job.id, fresh, fresh.trade);
      return fresh;
    });
    sendJson(ctx.res, 200, projectItem(updated, jobCtx.viewer));
  }),

  route('POST', '/api/jobs/:jobId/items/:itemId/resolve', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const item = await requireItem(db, jobCtx, ctx.params.itemId);
    requireRole(jobCtx, ['owner', 'lead']);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const field = raw.field;
    const allowed: ConflictField[] = [
      'title',
      'room_id',
      'trade',
      'cost_note',
      'quantity',
      'unit_cost',
      'pin',
    ];
    if (typeof field !== 'string' || !allowed.includes(field as ConflictField)) {
      throw new ApiError('validation', { fields: { field: 'Choose a conflicting field.' } });
    }
    const conflict = item.conflicts.find((candidate) => candidate.field === field);
    if (conflict === undefined) fail('no_conflict');
    const chosen = raw.value ?? null;
    const encode = (value: unknown): string => JSON.stringify(value ?? null);
    if (encode(chosen) !== encode(conflict.serverValue) && encode(chosen) !== encode(conflict.phoneValue)) {
      throw new ApiError('validation', { fields: { value: 'Choose one of the two values.' } });
    }

    const rooms = await loadRooms(db, jobCtx.job.id);
    const at = new Date();
    const updated = await jobWrite(jobCtx.job.id, async (tx) => {
      const previousTrade = item.trade;
      const conflictField = field as ConflictField;
      if (conflictField === 'pin') {
        const point = chosen as { x: number; y: number } | null;
        let pin: UPoint | null = null;
        if (point !== null) {
          const x = readPinCoordinate(point.x);
          const y = readPinCoordinate(point.y);
          if (x === null || y === null) {
            throw new ApiError('validation', { fields: { pin: FIELD_MESSAGES.pin } });
          }
          pin = { x, y };
        }
        const placement = resolveRoomAndPin(rooms, item, {
          pinSent: true,
          pin,
          roomSent: false,
          roomId: null,
        });
        await writeItem(
          tx,
          item.id,
          {
            pin: placement.pin,
            pinStatus: placement.pinStatus,
            roomId: placement.roomId,
            by: jobCtx.viewer.name,
          },
          at,
        );
      } else if (conflictField === 'room_id') {
        const placement = resolveRoomAndPin(rooms, item, {
          pinSent: false,
          pin: null,
          roomSent: true,
          roomId: chosen as string,
        });
        await writeItem(
          tx,
          item.id,
          {
            roomId: placement.roomId,
            pin: placement.pin,
            pinStatus: placement.pinStatus,
            by: jobCtx.viewer.name,
          },
          at,
        );
      } else if (conflictField === 'trade') {
        const next = chosen === null ? null : (chosen as Trade);
        checkTradeChange(item, next);
        await writeItem(tx, item.id, { trade: next, by: jobCtx.viewer.name }, at);
      } else if (conflictField === 'title') {
        await writeItem(tx, item.id, { title: chosen as string, by: jobCtx.viewer.name }, at);
      } else if (conflictField === 'cost_note') {
        await writeItem(
          tx,
          item.id,
          { costNote: chosen === null ? null : (chosen as string), by: jobCtx.viewer.name },
          at,
        );
      } else if (conflictField === 'quantity') {
        await writeItem(
          tx,
          item.id,
          {
            quantity: chosen === null ? null : exactUnits(chosen as string, 3),
            by: jobCtx.viewer.name,
          },
          at,
        );
      } else {
        await writeItem(
          tx,
          item.id,
          {
            unitCost: chosen === null ? null : exactUnits(chosen as string, 2),
            by: jobCtx.viewer.name,
          },
          at,
        );
      }
      await clearConflict(tx, item.id, conflictField);
      const fresh = await reloadItem(tx, jobCtx.job.id, item.id);
      if (fresh.roomId !== item.roomId) {
        await recordItemChange(tx, jobCtx.job.id, fresh, 'refiled', at);
      }
      await emitItem(tx, jobCtx.job.id, fresh, previousTrade);
      if (fresh.trade !== null && fresh.trade !== previousTrade) {
        const room = rooms.find((candidate) => candidate.id === fresh.roomId)!;
        await queueAssignmentNotices(
          tx,
          jobCtx.job,
          fresh,
          room.name,
          fresh.trade,
          jobCtx.members,
          at,
        );
      }
      return fresh;
    });
    sendJson(ctx.res, 200, projectItem(updated, jobCtx.viewer));
  }),
];

export { applyTransitionTo, deleteItemRecord, graphOf, stripBody };
export type { RoomRecord };
