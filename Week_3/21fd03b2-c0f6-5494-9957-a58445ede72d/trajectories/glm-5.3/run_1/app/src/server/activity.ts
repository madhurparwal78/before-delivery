import type { DbClient } from './db';
import { randomId } from './crypto';
import type { ActivityAction } from '../bench/activity';

export type Actor = { id: string; displayName: string };

export async function writeActivity(
  client: DbClient,
  workspaceId: string,
  actor: Actor,
  action: ActivityAction,
  targetName: string,
): Promise<void> {
  await client.query(
    'INSERT INTO activity_events (id, workspace_id, at, actor_user_id, actor_name, action, target_name) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [randomId('evt'), workspaceId, new Date(), actor.id, actor.displayName, action, targetName],
  );
}
