import { useSyncExternalStore } from 'react';
import { REST_FOCUS, type FollowSnapshot } from '../../shared/evaluator/follow';

interface FollowReadout {
  tiltX: number;
  tiltY: number;
  targetX: number;
  targetY: number;
  focusX: number;
  focusY: number;
}

const REST: FollowReadout = { tiltX: 0, tiltY: 0, targetX: 0, targetY: 0, focusX: REST_FOCUS.x, focusY: REST_FOCUS.y };

let readouts: ReadonlyMap<string, FollowReadout> = new Map();
let focus: { x: number; y: number } = { x: REST_FOCUS.x, y: REST_FOCUS.y };
let version = 0;
const listeners = new Set<() => void>();

/** The stage publishes its Follow Light values here after each frame that moved them (null: back to rest). */
export function publishFollow(snapshot: FollowSnapshot | null): void {
  focus = snapshot ? snapshot.focus : { x: REST_FOCUS.x, y: REST_FOCUS.y };
  const next = new Map<string, FollowReadout>();
  if (snapshot) {
    for (const [id, t] of snapshot.tilt) {
      next.set(id, { tiltX: t.x, tiltY: t.y, targetX: t.targetX, targetY: t.targetY, focusX: focus.x, focusY: focus.y });
    }
  }
  readouts = next;
  version += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const cache = new Map<string, { version: number; value: FollowReadout }>();

/** The current Follow Light values of a layer (tilt) and the scene (light focus), re-rendered per animation frame. */
export function useFollowReadout(layerId: string | null): FollowReadout {
  useSyncExternalStore(subscribe, () => version);
  const own = layerId === null ? undefined : readouts.get(layerId);
  if (own) return own;
  const key = layerId ?? '';
  const hit = cache.get(key);
  if (hit && hit.version === version) return hit.value;
  const value: FollowReadout = { ...REST, focusX: focus.x, focusY: focus.y };
  cache.set(key, { version, value });
  return value;
}
