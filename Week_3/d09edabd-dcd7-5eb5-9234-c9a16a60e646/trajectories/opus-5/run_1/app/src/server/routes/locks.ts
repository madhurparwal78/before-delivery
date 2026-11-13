import { config } from '../config.js';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { requireMember } from '../domain/session.js';
import { asRecord } from '../domain/validate.js';
import { readLock, releaseLock, takeLock } from '../services/live.js';
import { rowOne, tx } from '../services/db.js';
import { memberRoom, publishRoom } from './support.js';

type TargetType = 'placement' | 'node';

async function assertTarget(
  roomId: string,
  targetType: TargetType,
  targetId: string,
): Promise<void> {
  const found = await tx((client) =>
    targetType === 'placement'
      ? rowOne<{ id: string }>(
          client,
          `select id from placements where id = $1 and room_id = $2 and deleted_at is null`,
          [targetId, roomId],
        )
      : rowOne<{ id: string }>(
          client,
          `select id from trigger_nodes where id = $1 and room_id = $2`,
          [targetId, roomId],
        ),
  );
  if (!found) throw errors.notFound();
}

function readTargetType(value: unknown): TargetType {
  if (value !== 'placement' && value !== 'node') {
    throw errors.field('targetType', 'must be placement or node');
  }
  return value;
}

export const lockRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/locks',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const body = asRecord(ctx.body);
      const targetType = readTargetType(body.targetType);
      const targetId = typeof body.targetId === 'string' ? body.targetId : '';
      await assertTarget(room.id, targetType, targetId);
      const takeOver = body.takeOver === true;
      const result = await takeLock(
        room.id,
        targetType,
        targetId,
        { userId: member.id, displayName: member.displayName },
        takeOver,
      );
      if (!result.taken) {
        throw errors.locked(result.state.holder, result.state.expiresInSeconds);
      }
      const lock = {
        targetType,
        targetId,
        holder: { userId: member.id, displayName: member.displayName },
        expiresInSeconds: config.lockTtlSeconds,
      };
      publishRoom(
        room.id,
        'lock',
        result.takenFrom === null ? { lock } : { lock, takenFrom: result.takenFrom },
      );
      return { lock };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/rooms/:roomId/locks/:targetType/:targetId',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const targetType = readTargetType(ctx.params.targetType);
      const targetId = ctx.params.targetId;
      await assertTarget(room.id, targetType, targetId);
      const state = await readLock(room.id, targetType, targetId);
      if (state !== null && state.holder.userId !== member.id) {
        throw errors.locked(state.holder, state.expiresInSeconds);
      }
      await releaseLock(room.id, targetType, targetId);
      publishRoom(room.id, 'lock', { released: { targetType, targetId } });
      return undefined;
    },
  },
];
