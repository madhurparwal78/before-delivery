import { broadcast } from '../services/valkey.js';

export const OPS_PER_WINDOW = 120;
export const WINDOW_MS = 10_000;

interface LocalWindow {
  windowStart: number;
  count: number;
}

const local = new Map<string, LocalWindow>();

function localCount(collaboratorId: string, windowStart: number, amount: number): number {
  const held = local.get(collaboratorId);
  if (!held || held.windowStart !== windowStart) {
    local.set(collaboratorId, { windowStart, count: amount });
    return amount;
  }
  held.count += amount;
  return held.count;
}

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  release: () => Promise<void>;
}

/** Each collaborator may have at most 120 operations accepted in each 10-second window. */
export async function reserveOperations(
  collaboratorId: string,
  amount: number,
): Promise<ThrottleDecision> {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));
  const shared = await broadcast.countOperations(collaboratorId, windowStart, amount);
  const total = shared ?? localCount(collaboratorId, windowStart, amount);
  const release = async (): Promise<void> => {
    if (shared === null) {
      localCount(collaboratorId, windowStart, -amount);
      return;
    }
    await broadcast.countOperations(collaboratorId, windowStart, -amount);
  };
  if (total > OPS_PER_WINDOW) {
    await release();
    return { allowed: false, retryAfterSeconds, release: async () => undefined };
  }
  return { allowed: true, retryAfterSeconds, release };
}
