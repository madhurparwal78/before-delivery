import type { Queryable } from "./db.ts";
import { rows } from "./db.ts";
import type { ActivityEntry } from "../shared/types.ts";

export async function recordActivity(q: Queryable, setId: string, actorId: string, action: string, target: string, summary: string): Promise<void> {
  await q.query("INSERT INTO activity (set_id, actor_id, action, target, summary) VALUES ($1,$2,$3,$4,$5)", [setId, actorId, action, target, summary]);
}

interface ActivityRow {
  id: string;
  at: Date;
  user_id: string;
  display_name: string;
  action: string;
  target: string;
  summary: string;
}

const ACTIVITY_PAGE = 50;

export async function activityPage(q: Queryable, setId: string, before: number | null): Promise<ActivityEntry[]> {
  const found = await rows<ActivityRow>(
    q,
    `SELECT a.id::text AS id, a.at, u.id AS user_id, u.display_name, a.action, a.target, a.summary
     FROM activity a JOIN users u ON u.id = a.actor_id
     WHERE a.set_id = $1 AND ($2::bigint IS NULL OR a.id < $2)
     ORDER BY a.id DESC LIMIT ${ACTIVITY_PAGE}`,
    [setId, before],
  );
  return found.map((row) => ({
    id: row.id, at: row.at.toISOString(), actor: { user_id: row.user_id, display_name: row.display_name },
    action: row.action, target: row.target, summary: row.summary,
  }));
}
