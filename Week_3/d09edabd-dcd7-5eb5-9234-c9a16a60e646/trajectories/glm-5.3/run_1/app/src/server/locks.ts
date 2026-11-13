import { config } from './config.js';
import { valkeyAvailable, guard, redis } from './valkey.js';
import { pool } from './db.js';
import { ApiError } from './errors.js';

/**
 * The one lock winner: Valkey SET NX-style behaviour with a TTL.
 * While Valkey is unreachable the request answers 503 live_unavailable.
 */
export async function takeLock(
  roomId: string,
  targetType: 'placement' | 'node',
  targetId: string,
  userId: string,
  takeOver = false
): Promise<{ ok: boolean; holder?: { userId: string; displayName: string } }> {
  if (!valkeyAvailable()) throw new ApiError(503, 'live_unavailable');
  const key = `lock:${roomId}:${targetType}:${targetId}`;
  if (!takeOver) {
    const cur = (await guard(redis.get(key))) as string | null;
    if (cur && cur !== userId) {
      const name = await displayName(cur);
      return { ok: false, holder: { userId: cur, displayName: name } };
    }
  }
  await guard(redis.set(key, userId, { EX: config.lockTtl }));
  return { ok: true, holder: { userId, displayName: await displayName(userId) } };
}

async function displayName(userId: string): Promise<string> {
  const r = await pool.query(`SELECT display_name FROM users WHERE id = $1`, [userId]);
  return (r.rows[0]?.display_name as string) ?? '';
}

/** Who holds this lock, or null when nobody (or Valkey is down). */
export async function lockHeld(
  roomId: string,
  targetType: 'placement' | 'node',
  targetId: string
): Promise<{ userId: string; displayName: string } | null> {
  if (!valkeyAvailable()) return null;
  const key = `lock:${roomId}:${targetType}:${targetId}`;
  const cur = (await guard(redis.get(key))) as string | null;
  if (!cur) return null;
  return { userId: cur, displayName: await displayName(cur) };
}

/** Release a lock: only the holder may. */
export async function releaseLock(
  roomId: string,
  targetType: 'placement' | 'node',
  targetId: string,
  userId: string
): Promise<{ ok: boolean; holder?: { userId: string; displayName: string } }> {
  if (!valkeyAvailable()) throw new ApiError(503, 'live_unavailable');
  const key = `lock:${roomId}:${targetType}:${targetId}`;
  const cur = (await guard(redis.get(key))) as string | null;
  if (cur && cur !== userId) {
    return { ok: false, holder: { userId: cur, displayName: await displayName(cur) } };
  }
  await guard(redis.del(key));
  return { ok: true };
}
