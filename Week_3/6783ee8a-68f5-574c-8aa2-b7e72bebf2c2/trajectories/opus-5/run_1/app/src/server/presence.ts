import type { PresenceEntry } from '../shared/types.js';
import { config } from './config.js';
import { query, queryOne } from './db.js';

export async function heartbeat(
  notebookId: string,
  tabId: string,
  userId: string,
  cellId: string | null,
): Promise<void> {
  await query(
    `insert into presence (tab_id, notebook_id, user_id, cell_id, last_seen)
     values ($1, $2, $3, $4, now())
     on conflict (tab_id) do update
       set notebook_id = excluded.notebook_id,
           user_id = excluded.user_id,
           cell_id = excluded.cell_id,
           last_seen = now()`,
    [tabId, notebookId, userId, cellId],
  );
}

export async function presentIn(notebookId: string): Promise<PresenceEntry[]> {
  return query<PresenceEntry>(
    `select p.tab_id, p.user_id, u.display_name, p.cell_id
       from presence p join users u on u.id = p.user_id
      where p.notebook_id = $1
      order by p.last_seen asc`,
    [notebookId],
  );
}

/** Drops a tab's presence marker, its lock and its kernel report. */
export async function dropTab(tabId: string): Promise<string | null> {
  const removed = await queryOne<{ notebook_id: string }>(
    `delete from presence where tab_id = $1 returning notebook_id`,
    [tabId],
  );
  if (!removed) return null;
  await query(`delete from cell_locks where tab_id = $1`, [tabId]);
  await query(`delete from kernel_reports where tab_id = $1`, [tabId]);
  return removed.notebook_id;
}

/** Drops every marker whose last heartbeat is older than the presence timeout. */
export async function dropExpired(): Promise<string[]> {
  const expired = await query<{ tab_id: string; notebook_id: string }>(
    `delete from presence
      where last_seen < now() - ($1::bigint * interval '1 millisecond')
      returning tab_id, notebook_id`,
    [config.limits.presence_timeout_ms],
  );
  if (expired.length === 0) return [];
  const tabIds = expired.map((row) => row.tab_id);
  await query(`delete from cell_locks where tab_id = any($1::text[])`, [tabIds]);
  await query(`delete from kernel_reports where tab_id = any($1::text[])`, [tabIds]);
  return [...new Set(expired.map((row) => row.notebook_id))];
}
