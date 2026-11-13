import { notFound, validation } from '../errors.js';
import { hub, roomChannel } from '../events.js';
import { empty, json, route, type Ctx } from '../http.js';
import { config } from '../config.js';
import { lockKey, lockView, lockedError } from '../domain/locks.js';
import { findRoom, userName, type RoomRow } from '../domain/rooms.js';
import { UUID } from '../validate.js';
import { valkey } from '../valkey.js';
import type { LockTarget } from '../../shared/types.js';

const TARGETS: LockTarget[] = ['placement', 'node'];

async function targetExists(ctx: Ctx, room: RoomRow, type: LockTarget, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const found =
    type === 'placement'
      ? await ctx.db.query(`SELECT 1 FROM placements WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`, [id, room.id])
      : await ctx.db.query(`SELECT 1 FROM nodes WHERE id = $1 AND room_id = $2`, [id, room.id]);
  return found.rows.length > 0;
}

export function lockRoutes(): void {
  route('POST', '/api/rooms/:roomId/locks', {
    auth: 'member',
    load: async (ctx) => {
      const room = await findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!);
      const body = ctx.body as { targetType?: unknown; targetId?: unknown } | undefined;
      if (TARGETS.includes(body?.targetType as LockTarget) && typeof body?.targetId === 'string' && !(await targetExists(ctx, room, body.targetType as LockTarget, body.targetId))) throw notFound();
      return room;
    },
    validate: (ctx) => {
      const input = ctx.input();
      const targetType = input.oneOf('targetType', TARGETS);
      const targetId = input.text('targetId', 1, 100);
      const takeOver = input.has('takeOver') ? input.bool('takeOver') === true : false;
      input.fields.check();
      return { targetType: targetType!, targetId: targetId!, takeOver };
    },
    needs: ['valkey'],
    run: async (ctx, room, input) => {
      const attempt = await valkey.takeLock(lockKey(room.id, input.targetType, input.targetId), ctx.actor.userId, config.lockTtlSeconds * 1000, input.takeOver);
      if (attempt.outcome === 'held') throw await lockedError(ctx.db, input.targetType, input.targetId, attempt.holderId, attempt.ttlMs);
      const lock = await lockView(ctx.db, input.targetType, input.targetId, ctx.actor.userId, attempt.ttlMs);
      if (attempt.outcome === 'taken') ctx.after.push(() => hub.publish(roomChannel(room.id), 'lock', { lock }));
      if (attempt.outcome === 'taken_over') {
        const takenFrom = { userId: attempt.from, displayName: await userName(ctx.db, attempt.from) };
        ctx.after.push(() => hub.publish(roomChannel(room.id), 'lock', { lock, takenFrom }));
      }
      return json(200, { lock });
    },
  });

  route('DELETE', '/api/rooms/:roomId/locks/:targetType/:targetId', {
    auth: 'member',
    load: async (ctx) => findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!),
    validate: (ctx) => {
      if (!TARGETS.includes(ctx.params.targetType as LockTarget)) throw validation({ targetType: 'must be placement or node' });
      return ctx.params.targetType as LockTarget;
    },
    needs: ['valkey'],
    run: async (ctx, room, type) => {
      const id = ctx.params.targetId!;
      const key = lockKey(room.id, type, id);
      const holderId = await valkey.releaseLock(key, ctx.actor.userId);
      if (holderId !== null) throw await lockedError(ctx.db, type, id, holderId, (await valkey.lockHolder(key))?.ttlMs ?? 0);
      ctx.after.push(() => hub.publish(roomChannel(room.id), 'lock', { released: { targetType: type, targetId: id } }));
      return empty(204);
    },
  });
}
