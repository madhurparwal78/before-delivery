import { ApiFailure, del, post } from '../api';
import type { Lock, LockHolder, LockTarget } from '../../shared/types';
import { lockKey } from './model';
import { editor, say, type LockEntry } from './state';

const REFRESH_MS = 10_000;
const refreshers = new Map<string, number>();

const holdingCopy = (type: LockTarget, holder: LockHolder): string => `${holder.displayName} is holding this ${type === 'placement' ? 'prop' : 'node'}.`;

export function rememberLock(type: LockTarget, id: string, holder: LockHolder, expiresInSeconds: number): void {
  const entry: LockEntry = { targetType: type, targetId: id, holder, expiresInSeconds, until: performance.now() + expiresInSeconds * 1000 };
  editor.set((s) => ({ locks: { ...s.locks, [lockKey(type, id)]: entry } }));
}

export function forgetLock(type: LockTarget, id: string): void {
  editor.set((s) => {
    const { [lockKey(type, id)]: _gone, ...locks } = s.locks;
    return { locks };
  });
}

/** Who holds a target right now, as far as this editor knows; null when nobody (or the lock has lapsed). */
export function holderOf(type: LockTarget, id: string): LockHolder | null {
  const entry = editor.get().locks[lockKey(type, id)];
  return entry && entry.until > performance.now() ? entry.holder : null;
}

export function heldByOther(type: LockTarget, id: string): LockHolder | null {
  const holder = holderOf(type, id);
  return holder && holder.userId !== editor.get().me?.id ? holder : null;
}

function stopRefreshing(key: string): void {
  window.clearInterval(refreshers.get(key));
  refreshers.delete(key);
}

async function take(roomId: string, type: LockTarget, id: string, takeOver: boolean): Promise<Lock | null> {
  const key = lockKey(type, id);
  try {
    const { lock } = await post<{ lock: Lock }>(`/api/rooms/${roomId}/locks`, { targetType: type, targetId: id, takeOver });
    rememberLock(type, id, lock.holder, lock.expiresInSeconds);
    return lock;
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'locked') {
      const holder = error.body.holder as LockHolder;
      rememberLock(type, id, holder, Number(error.body.expiresInSeconds ?? 0));
      stopRefreshing(key);
      return null;
    }
    return null;
  }
}

/** Selecting takes the lock and keeps it fresh every 10 seconds; says who holds it when someone else does. */
export async function acquireLock(type: LockTarget, id: string, takeOver = false): Promise<boolean> {
  const roomId = editor.get().roomId;
  if (!roomId) return false;
  const key = lockKey(type, id);
  const lock = await take(roomId, type, id, takeOver);
  if (!lock) {
    const holder = heldByOther(type, id);
    if (holder) say(holdingCopy(type, holder));
    return false;
  }
  stopRefreshing(key);
  refreshers.set(key, window.setInterval(() => void take(roomId, type, id, false), REFRESH_MS));
  return true;
}

export function releaseLock(type: LockTarget, id: string): void {
  const roomId = editor.get().roomId;
  const key = lockKey(type, id);
  const mine = editor.get().locks[key]?.holder.userId === editor.get().me?.id;
  stopRefreshing(key);
  if (!roomId || !mine) return;
  forgetLock(type, id);
  void del(`/api/rooms/${roomId}/locks/${type}/${id}`).catch(() => undefined);
}

/** Another member took over a lock this editor held: stop refreshing it, and never take it back by ourselves. */
export function lostLock(type: LockTarget, id: string): void {
  stopRefreshing(lockKey(type, id));
}

export function releaseAllLocks(): void {
  for (const key of [...refreshers.keys()]) {
    const [type, id] = key.split(':') as [LockTarget, string];
    releaseLock(type, id);
  }
}

export { holdingCopy };
