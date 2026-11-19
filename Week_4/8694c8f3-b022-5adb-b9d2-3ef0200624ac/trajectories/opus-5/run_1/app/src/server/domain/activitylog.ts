import type { Db } from '../db.js';
import type { ActivityEntry } from '../../shared/types.js';

export async function writeActivity(
  db: Db,
  setId: string,
  actorId: string,
  action: string,
  target: string,
  summary: string,
): Promise<void> {
  await db.query(
    `insert into activity (set_id, actor_id, action, target, summary) values ($1, $2, $3, $4, $5)`,
    [setId, actorId, action, target, summary],
  );
}

export async function readActivity(db: Db, setId: string, before: string | null): Promise<ActivityEntry[]> {
  const result = await db.query<{
    id: string;
    at: Date;
    user_id: string;
    display_name: string;
    action: string;
    target: string;
    summary: string;
  }>(
    `select a.id::text as id, a.at, u.id as user_id, u.display_name, a.action, a.target, a.summary
       from activity a join users u on u.id = a.actor_id
      where a.set_id = $1 and ($2::bigint is null or a.id < $2::bigint)
      order by a.id desc limit 50`,
    [setId, before],
  );
  return result.rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    actor: { user_id: row.user_id, display_name: row.display_name },
    action: row.action,
    target: row.target,
    summary: row.summary,
  }));
}
