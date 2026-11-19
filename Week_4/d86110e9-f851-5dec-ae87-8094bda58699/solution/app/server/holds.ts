import { config } from './config.js';
import type { Queryable } from './db.js';

/** The name of the member holding a step against `userId` at `now`, or null when the step is free to them. */
export async function heldByOther(client: Queryable, automationId: string, stepId: string, userId: string, now: number): Promise<string | null> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT u.name FROM edit_holds h JOIN users u ON u.id = h.user_id
     WHERE h.automation_id = $1 AND h.step_id = $2 AND h.user_id <> $3 AND h.held_at + $4 > $5`,
    [automationId, stepId, userId, config.editHoldSeconds * 1000, now],
  );
  return rows[0]?.name ?? null;
}

export async function takeHold(client: Queryable, automationId: string, stepId: string, userId: string, now: number): Promise<void> {
  await client.query(
    `INSERT INTO edit_holds (automation_id, step_id, user_id, held_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (automation_id, step_id) DO UPDATE SET user_id = EXCLUDED.user_id, held_at = EXCLUDED.held_at`,
    [automationId, stepId, userId, now],
  );
}
