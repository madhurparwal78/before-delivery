import type { Queryable } from '../db.js';
import { ApiError, fail } from '../errors.js';
import { valkey } from '../valkey.js';
import { userName } from './rooms.js';
import type { Lock, LockTarget } from '../../shared/types.js';

export const lockKey = (roomId: string, type: LockTarget, targetId: string): string => `lock:${roomId}:${type}:${targetId}`;

const secondsOf = (ttlMs: number): number => Math.max(1, Math.ceil(ttlMs / 1000));

export async function lockView(db: Queryable, type: LockTarget, targetId: string, holderId: string, ttlMs: number): Promise<Lock> {
  return { targetType: type, targetId, holder: { userId: holderId, displayName: await userName(db, holderId) }, expiresInSeconds: secondsOf(ttlMs) };
}

/** The 409 `locked` answer: who holds the target and for how long. */
export async function lockedError(db: Queryable, type: LockTarget, targetId: string, holderId: string, ttlMs: number): Promise<ApiError> {
  const lock = await lockView(db, type, targetId, holderId, ttlMs);
  return fail(409, 'locked', { holder: lock.holder, expiresInSeconds: lock.expiresInSeconds });
}

/** 409 locked when another member holds the target. While Valkey is unreachable nothing is checked: edits go by version only. */
export async function assertNotHeldByOther(db: Queryable, roomId: string, type: LockTarget, targetId: string, userId: string): Promise<void> {
  if (!valkey.available) return;
  let held: { holderId: string; ttlMs: number } | null;
  try {
    held = await valkey.lockHolder(lockKey(roomId, type, targetId));
  } catch {
    return;
  }
  if (!held || held.holderId === userId) return;
  throw await lockedError(db, type, targetId, held.holderId, held.ttlMs);
}
