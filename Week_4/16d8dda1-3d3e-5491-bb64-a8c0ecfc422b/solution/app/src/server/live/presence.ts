// Presence: who is in the room, from real WebSocket connections on either instance.
import { config } from '../config';
import { one, pool, run } from '../db';
import { worldNow } from '../world';
import { clearSpotlightOf, dropConnection, freeSeat, registerConnection, removeOnline } from './valkey';

const local = new Map<string, number>();
const connectionKey = (sessionId: string, learnerId: string): string => `${sessionId}|${learnerId}`;

async function openInterval(sessionId: string, learnerId: string, worldId: string): Promise<void> {
  await run(
    pool,
    `INSERT INTO presence_intervals (session_id, learner_id, joined_ms)
     SELECT $1, $2, $3 WHERE NOT EXISTS
       (SELECT 1 FROM presence_intervals WHERE session_id = $1 AND learner_id = $2 AND left_ms IS NULL)`,
    [sessionId, learnerId, await worldNow(worldId)],
  );
}

async function registerQuietly(sessionId: string, learnerId: string, count: number): Promise<void> {
  try {
    await registerConnection(sessionId, learnerId, count);
  } catch {
    // The bus is paused; the connection is registered again when it returns.
  }
}

export async function learnerConnected(sessionId: string, learnerId: string, worldId: string): Promise<void> {
  const key = connectionKey(sessionId, learnerId);
  const count = (local.get(key) ?? 0) + 1;
  local.set(key, count);
  if (count === 1) await openInterval(sessionId, learnerId, worldId);
  await registerQuietly(sessionId, learnerId, count);
}

/** The last connection of a learner (on every instance) closing starts the reconnect grace. */
export async function learnerDisconnected(sessionId: string, learnerId: string, worldId: string): Promise<void> {
  const key = connectionKey(sessionId, learnerId);
  const count = (local.get(key) ?? 1) - 1;
  if (count > 0) {
    local.set(key, count);
    await registerQuietly(sessionId, learnerId, count);
    return;
  }
  local.delete(key);
  let lastOne = false;
  try {
    lastOne = await dropConnection(sessionId, learnerId);
  } catch {
    return;
  }
  if (!lastOne) return;
  await run(pool, 'UPDATE presence_intervals SET left_ms = $3, grace_seconds = $4 WHERE session_id = $1 AND learner_id = $2 AND left_ms IS NULL', [
    sessionId,
    learnerId,
    await worldNow(worldId),
    config.reconnectGraceSeconds,
  ]);
}

/** After the bus returns, every local connection is counted again. */
export async function registerAgain(): Promise<void> {
  for (const [key, count] of local) {
    const [sessionId, learnerId] = key.split('|');
    if (sessionId && learnerId) await registerQuietly(sessionId, learnerId, count);
  }
}

/** A leave becomes final: the seat, hand, spotlight and place in the room go. */
export async function finalizeLeave(sessionId: string, learnerId: string): Promise<void> {
  await removeOnline(sessionId, learnerId);
  await freeSeat(sessionId, learnerId);
  await clearSpotlightOf(sessionId, learnerId);
}

/** True when the learner has no interval still open or ending after this one, so its leave is final. */
export async function isAway(sessionId: string, learnerId: string, afterMs: number): Promise<boolean> {
  const later = await one(
    pool,
    `SELECT 1 AS found FROM presence_intervals
      WHERE session_id = $1 AND learner_id = $2 AND (left_ms IS NULL OR left_ms > $3)`,
    [sessionId, learnerId, afterMs],
  );
  return later === null;
}
