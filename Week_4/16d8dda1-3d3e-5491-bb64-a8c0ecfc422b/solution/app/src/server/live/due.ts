// Due work: breakout warnings and returns, and leaves past the reconnect grace.
import { RUNNING_STATES } from '../../shared/states';
import { config } from '../config';
import { pool, rows, run } from '../db';
import { worldNow } from '../world';
import { dueRounds, settleRound } from './breakouts';
import { finalizeLeave, isAway } from './presence';
import { announce, isUp } from './valkey';

interface PendingLeave {
  id: number;
  session_id: string;
  learner_id: string;
  left_ms: number;
  grace_seconds: number | null;
  world_id: string;
}

async function settleLeaves(worldId: string | undefined): Promise<void> {
  const pending = await rows<PendingLeave>(
    pool,
    `SELECT p.id, p.session_id, p.learner_id, p.left_ms, p.grace_seconds, c.world_id
       FROM presence_intervals p JOIN sessions s ON s.id = p.session_id JOIN classes c ON c.id = s.class_id
      WHERE p.settled = false AND p.left_ms IS NOT NULL AND s.state = ANY($2)
        AND ($1::text IS NULL OR c.world_id = $1)`,
    [worldId ?? null, RUNNING_STATES],
  );
  for (const leave of pending) {
    const nowMs = await worldNow(leave.world_id);
    if (nowMs < leave.left_ms + (leave.grace_seconds ?? config.reconnectGraceSeconds) * 1000) continue;
    const claimed = await run(pool, 'UPDATE presence_intervals SET settled = true WHERE id = $1 AND settled = false', [leave.id]);
    if (claimed === 0 || !(await isAway(leave.session_id, leave.learner_id, leave.left_ms))) continue;
    await finalizeLeave(leave.session_id, leave.learner_id);
    await announce(leave.session_id, 'presence');
  }
}

/** Runs everything that has become due, in one world or in all of them. */
export async function processDue(worldId?: string): Promise<void> {
  if (!isUp()) return;
  for (const roundId of await dueRounds(worldId)) await settleRound(roundId);
  await settleLeaves(worldId);
}

export function startTicker(): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    processDue()
      .catch((error: unknown) => console.error('due work failed', error))
      .finally(() => {
        busy = false;
      });
  }, 1000);
}
