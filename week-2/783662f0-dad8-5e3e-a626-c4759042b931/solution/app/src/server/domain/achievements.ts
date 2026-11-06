import type { PoolClient } from 'pg';
import { ACHIEVEMENT_NAMES, type AchievementId } from '../../shared/domain.js';
import { appendEvent } from './events.js';
import { instant } from '../util.js';

/** Each achievement unlocks once per character and is pushed as an event. */
export async function unlock(
  client: PoolClient,
  serverId: string,
  characterId: string,
  userId: string,
  id: AchievementId,
): Promise<void> {
  const inserted = await client.query<{ unlocked_at: Date }>(
    `INSERT INTO achievements (character_id, server_id, achievement_id, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (character_id, achievement_id) DO NOTHING
     RETURNING unlocked_at`,
    [characterId, serverId, id, ACHIEVEMENT_NAMES[id]],
  );
  const row = inserted.rows[0];
  if (row === undefined) return;
  await appendEvent(
    {
      serverId,
      stream: 'server',
      scopeId: serverId,
      kind: 'achievement',
      payload: {
        character_id: characterId,
        name: ACHIEVEMENT_NAMES[id],
        unlocked_at: instant(row.unlocked_at),
      },
      audience: [userId],
    },
    client,
  );
}

export async function countBreak(
  client: PoolClient,
  serverId: string,
  characterId: string,
): Promise<number> {
  const rows = await client.query<{ broken: number }>(
    `INSERT INTO break_counts (character_id, server_id, broken)
     VALUES ($1, $2, 1)
     ON CONFLICT (character_id) DO UPDATE SET broken = break_counts.broken + 1
     RETURNING broken`,
    [characterId, serverId],
  );
  return rows.rows[0]?.broken ?? 0;
}
