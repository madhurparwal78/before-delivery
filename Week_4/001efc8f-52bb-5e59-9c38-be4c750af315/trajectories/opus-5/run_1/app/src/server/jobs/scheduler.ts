import { query } from '../db';
import { nowMs } from '../clock';
import { latestOccurrenceAtOrBefore, occurrencesFrom, type ScheduledRow } from '../domain/scheduled';
import { postScheduledMessage } from '../routes/send';

interface DueRow extends ScheduledRow {
  time_zone: string;
}

const DUE_COLUMNS = `s.id, s.workspace_id, s.channel_id, s.created_by, s.text, s.state, s.repeat_rule,
  s.local_date, s.local_time, s.next_fire_at, s.fired_count, s.last_message_id, w.time_zone`;

/**
 * Each due occurrence produces exactly one message. When several occurrences
 * were missed, only the most recent one fires and the next moves forward.
 */
export async function fireDueScheduledPosts(): Promise<void> {
  const at = nowMs();
  const due = await query<DueRow>(
    `SELECT ${DUE_COLUMNS} FROM scheduled_posts s JOIN workspaces w ON w.id = s.workspace_id
     WHERE s.state = 'scheduled' AND s.next_fire_at IS NOT NULL AND s.next_fire_at <= $1`,
    [new Date(at)],
  );
  for (const row of due) {
    const claimed = await query<{ id: string }>(
      "UPDATE scheduled_posts SET state = 'firing' WHERE id = $1 AND state = 'scheduled' RETURNING id",
      [row.id],
    );
    if (claimed.length === 0) continue;
    await fireOne(row, at);
  }
}

async function fireOne(row: DueRow, at: number): Promise<void> {
  const stillMember = await query<{ user_id: string }>(
    `SELECT cm.user_id FROM channel_members cm
     JOIN users u ON u.id = cm.user_id AND u.status = 'active'
     WHERE cm.channel_id = $1 AND cm.user_id = $2`,
    [row.channel_id, row.created_by],
  );
  if (stillMember.length === 0) {
    await query("UPDATE scheduled_posts SET state = 'cancelled', next_fire_at = NULL WHERE id = $1", [row.id]);
    return;
  }

  const occurrence = latestOccurrenceAtOrBefore(row, row.time_zone, at);
  if (occurrence === null) {
    await query("UPDATE scheduled_posts SET state = 'scheduled' WHERE id = $1", [row.id]);
    return;
  }

  const messageId = await postScheduledMessage(row.workspace_id, row.channel_id, row.created_by, row.text);

  if (row.repeat_rule === 'weekly') {
    const next = occurrencesFrom(row, row.time_zone, at + 1, 1)[0];
    await query(
      `UPDATE scheduled_posts SET state = 'scheduled', next_fire_at = $2, fired_count = fired_count + 1, last_message_id = $3
       WHERE id = $1`,
      [row.id, next === undefined ? null : new Date(next), messageId],
    );
    return;
  }
  await query(
    `UPDATE scheduled_posts SET state = 'sent', next_fire_at = NULL, fired_count = fired_count + 1, last_message_id = $2
     WHERE id = $1`,
    [row.id, messageId],
  );
}
