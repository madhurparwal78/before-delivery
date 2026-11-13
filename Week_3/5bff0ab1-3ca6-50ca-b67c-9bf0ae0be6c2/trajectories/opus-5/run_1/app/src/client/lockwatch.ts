import { STATUS } from '../shared/strings.js';
import type { Lock } from '../shared/types.js';
import { labelDddDMon } from './labels.js';
import { announce, apiGet, mineChanged, identityChanged, user } from './core.js';

interface Known {
  state: Lock['state'];
  waitingFor: string | null;
  waitPosition: number | null;
  deliveryDate: string | null;
}

const known = new Map<string, Known>();
let primed = false;
let localActionAt = 0;
const localLocks = new Set<string>();

export function markLocalLockAction(lockId?: string): void {
  localActionAt = Date.now();
  if (lockId) localLocks.add(lockId);
}

function actedOn(lockId: string): boolean {
  return localLocks.has(lockId);
}

function justActed(): boolean {
  return Date.now() - localActionAt < 2_500;
}

export const lockListeners = new Set<(locks: Lock[]) => void>();

/** One place watches the rider's locks, so every screen tells the same story. */
export async function refreshLocks(): Promise<Lock[]> {
  if (user()?.role !== 'rider') {
    known.clear();
    primed = false;
    return [];
  }
  let locks: Lock[];
  try {
    locks = (await apiGet<{ locks: Lock[] }>('/api/locks')).locks;
  } catch {
    return [];
  }
  for (const lock of locks) {
    const before = known.get(lock.id);
    const now: Known = {
      state: lock.state,
      waitingFor: lock.waitingFor,
      waitPosition: lock.waitPosition,
      deliveryDate: lock.deliveryDate,
    };
    known.set(lock.id, now);
    if (!primed) {
      if (lock.state === 'requested') announce(STATUS.lockChecking, 'lock');
      continue;
    }
    if (!before) {
      if (lock.state === 'locked' && !justActed()) {
        announce(STATUS.lockConfirmed(lock.expiresLabel ?? ''), 'lock');
      }
      continue;
    }
    if (before.state === 'requested' && lock.state === 'locked') {
      announce(STATUS.lockConfirmed(lock.expiresLabel ?? ''), 'lock');
    } else if (before.state === 'requested' && lock.state === 'refused') {
      announce(STATUS.finishGone, 'lock');
    } else if (lock.state === 'withdrawn' && before.state !== 'withdrawn') {
      announce(STATUS.withdrawn, 'lock');
    } else if (lock.state === 'expired' && before.state !== 'expired') {
      announce(STATUS.lockEnded, 'lock');
    } else if (
      before.state === 'locked' &&
      lock.state === 'delivery_set' &&
      before.waitingFor !== null &&
      !actedOn(lock.id)
    ) {
      announce(STATUS.promoted(labelDddDMon(lock.deliveryDate ?? '')), 'lock');
    } else if (
      lock.waitingFor !== null &&
      lock.waitPosition !== before.waitPosition &&
      before.waitPosition !== null
    ) {
      announce(STATUS.inLine(lock.waitPosition ?? 1, labelDddDMon(lock.waitingFor)), 'other');
    } else if (before.waitingFor !== null && lock.waitingFor === null && lock.state === 'locked') {
      if (!actedOn(lock.id)) announce(STATUS.dayClosed, 'other');
    }
  }
  primed = true;
  localLocks.clear();
  for (const listener of lockListeners) listener(locks);
  return locks;
}

export function startLockWatch(): void {
  mineChanged.on(() => {
    void refreshLocks();
  });
  identityChanged.on(() => {
    known.clear();
    primed = false;
    void refreshLocks();
  });
  void refreshLocks();
}
