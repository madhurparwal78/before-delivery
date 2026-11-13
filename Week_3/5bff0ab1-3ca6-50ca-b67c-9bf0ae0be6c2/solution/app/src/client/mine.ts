import type { Lock, Ride } from "../shared/types.js";
import { STATUS, inLine, lockedStatus, promoted } from "../shared/copy.js";
import { call } from "./net.js";
import { session } from "./session.js";
import { RANK, announce } from "./status.js";
import { Store } from "./store.js";

/** The signed-in rider's own locks and rides, read again on every `mine` event and after every action of theirs. */
type MineState = { locks: Lock[] | null; rides: Ride[] | null };
export const mine = new Store<MineState>({ locks: null, rides: null });

let seen: Map<string, Lock> | null = null;
let generation = 0;
let inflight = 0;

/** Wraps one of the rider's own actions: until it settles, a re-read stays silent so the action announces its own result. */
export async function acting<T>(work: () => Promise<T>): Promise<T> {
  inflight += 1;
  try {
    return await work();
  } finally {
    inflight -= 1;
  }
}

export function resetMine(): void {
  generation += 1;
  seen = null;
  mine.set({ locks: null, rides: null });
}

function narrate(before: Lock, after: Lock): void {
  if (before.state === "requested" && after.state === "locked") announce(lockedStatus(after), RANK.lock);
  else if (before.state === "requested" && after.state === "refused") announce(STATUS.finishGone, RANK.lock);
  else if ((before.state === "requested" || before.state === "locked") && after.state === "expired") announce(STATUS.lockEnded, RANK.lock);
  else if ((before.state === "locked" || before.state === "delivery_set") && after.state === "withdrawn") announce(STATUS.withdrawn, RANK.lock);
  else if (before.waitingFor && !after.waitingFor && after.state === "delivery_set" && after.deliveryDate) announce(promoted(after.deliveryDate), RANK.other);
  else if (before.waitingFor && !after.waitingFor && after.state === "locked") announce(STATUS.dayClosed, RANK.other);
  else if (before.waitingFor && after.waitingFor === before.waitingFor && before.waitPosition !== after.waitPosition && after.waitPosition) {
    announce(inLine(after.waitPosition, after.waitingFor), RANK.other);
  }
}

export async function refreshMine(): Promise<void> {
  const user = session.get().user;
  if (!user || user.role !== "rider") {
    if (mine.get().locks !== null) resetMine();
    return;
  }
  const mark = ++generation;
  const [locks, rides] = await Promise.all([call<{ locks: Lock[] }>("GET", "/api/locks"), call<{ rides: Ride[] }>("GET", "/api/rides")]);
  if (mark !== generation || session.get().user?.id !== user.id || !locks.ok || !rides.ok) return;
  const next = new Map(locks.data.locks.map((l) => [l.id, l]));
  if (seen === null) {
    if (locks.data.locks.some((l) => l.state === "requested")) announce(STATUS.checking, RANK.lock);
  } else if (inflight === 0) {
    for (const [id, after] of next) {
      const before = seen.get(id);
      if (before) narrate(before, after);
    }
  }
  seen = next;
  mine.set({ locks: locks.data.locks, rides: rides.data.rides });
}

/** Records a lock the rider's own action just returned, so the next re-read does not announce it again. */
export function applyLock(lock: Lock): void {
  const s = mine.get();
  if (seen) seen.set(lock.id, lock);
  mine.set({ locks: s.locks ? (s.locks.some((l) => l.id === lock.id) ? s.locks.map((l) => (l.id === lock.id ? lock : l)) : [lock, ...s.locks]) : [lock] });
}

export function applyRide(ride: Ride): void {
  const s = mine.get();
  mine.set({ rides: s.rides ? (s.rides.some((r) => r.id === ride.id) ? s.rides.map((r) => (r.id === ride.id ? ride : r)) : [...s.rides, ride]) : [ride] });
}
