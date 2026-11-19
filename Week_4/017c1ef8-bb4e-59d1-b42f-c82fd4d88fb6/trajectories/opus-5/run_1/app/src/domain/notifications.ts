import { businessNow } from '../server/clock';
import { query } from '../server/db';
import { newId } from '../server/ids';
import { blockedWith } from './graph';

export type NotificationKind =
  | 'invitation_received'
  | 'invitation_accepted'
  | 'reaction'
  | 'comment'
  | 'reply'
  | 'mention'
  | 'repost'
  | 'endorsement'
  | 'application_status';

const GROUPED: NotificationKind[] = ['reaction', 'comment'];

/** Members never get notifications about their own actions. */
export async function notify(options: {
  memberId: string;
  actorId: string | null;
  kind: NotificationKind;
  subjectId: string | null;
  targetUrl: string;
  detail?: string | null;
}): Promise<void> {
  const { memberId, actorId, kind, subjectId, targetUrl } = options;
  if (actorId && actorId === memberId) return;
  const now = businessNow();
  const grouped = GROUPED.includes(kind);
  let id: string | null = null;
  if (grouped && subjectId) {
    const existing = await query<{ id: string }>(
      'SELECT id FROM notifications WHERE member_id = $1 AND kind = $2 AND subject_id = $3',
      [memberId, kind, subjectId],
    );
    id = existing[0]?.id ?? null;
  }
  if (id) {
    await query('UPDATE notifications SET updated_at = $2, target_url = $3 WHERE id = $1', [
      id,
      now,
      targetUrl,
    ]);
  } else {
    id = newId('ntf');
    await query(
      `INSERT INTO notifications (id, member_id, kind, subject_id, target_url, detail, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [id, memberId, kind, subjectId, targetUrl, options.detail ?? null, now],
    );
  }
  if (actorId) {
    await query(
      `INSERT INTO notification_actors (notification_id, actor_id, at) VALUES ($1,$2,$3)
       ON CONFLICT (notification_id, actor_id) DO UPDATE SET at = EXCLUDED.at`,
      [id, actorId, now],
    );
  }
}

export async function removeNotificationActor(
  memberId: string,
  kind: NotificationKind,
  subjectId: string,
  actorId: string,
): Promise<void> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM notifications WHERE member_id = $1 AND kind = $2 AND subject_id = $3',
    [memberId, kind, subjectId],
  );
  for (const row of rows) {
    await query('DELETE FROM notification_actors WHERE notification_id = $1 AND actor_id = $2', [
      row.id,
      actorId,
    ]);
    const left = await query<{ count: string }>(
      'SELECT count(*) AS count FROM notification_actors WHERE notification_id = $1',
      [row.id],
    );
    if (Number(left[0].count) === 0) {
      await query('DELETE FROM notifications WHERE id = $1', [row.id]);
    }
  }
}

export async function removeNotificationsForSubject(subjectId: string): Promise<void> {
  await query('DELETE FROM notifications WHERE subject_id = $1', [subjectId]);
}

function textFor(kind: string, named: string, count: number, detail: string | null): string {
  const others = count === 1 ? '' : count === 2 ? ' and 1 other' : ` and ${count - 1} others`;
  switch (kind) {
    case 'invitation_received':
      return `${named} wants to connect`;
    case 'invitation_accepted':
      return `${named} accepted your invitation`;
    case 'reaction':
      return `${named}${others} reacted to your post`;
    case 'comment':
      return `${named}${others} commented on your post`;
    case 'reply':
      return `${named} replied to your comment`;
    case 'mention':
      return `${named} mentioned you in a post`;
    case 'repost':
      return `${named} reposted your post`;
    case 'endorsement':
      return `${named} endorsed you for ${detail ?? ''}`;
    default:
      return detail ?? '';
  }
}

export type NotificationItem = {
  id: string;
  kind: string;
  count: number;
  actors: { id: string; name: string }[];
  text: string;
  target_url: string;
  created_at: string;
  updated_at: string;
  unread: boolean;
};

export async function notificationsFor(
  memberId: string,
): Promise<{ items: NotificationItem[]; unread_count: number }> {
  const seenRows = await query<{ notifications_seen_at: Date | null }>(
    'SELECT notifications_seen_at FROM members WHERE id = $1',
    [memberId],
  );
  const seenAt = seenRows[0]?.notifications_seen_at ?? null;
  const excluded = await blockedWith(memberId);

  const rows = await query<{
    id: string;
    kind: string;
    subject_id: string | null;
    target_url: string;
    detail: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, kind, subject_id, target_url, detail, created_at, updated_at
     FROM notifications WHERE member_id = $1 ORDER BY updated_at DESC LIMIT 200`,
    [memberId],
  );

  const items: NotificationItem[] = [];
  for (const row of rows) {
    const actorRows = await query<{ id: string; name: string; at: Date }>(
      `SELECT m.id, m.name, a.at FROM notification_actors a JOIN members m ON m.id = a.actor_id
       WHERE a.notification_id = $1 ORDER BY a.at DESC`,
      [row.id],
    );
    const actors = actorRows.filter((actor) => !excluded.has(actor.id));
    if (actorRows.length > 0 && actors.length === 0) continue;
    if (row.subject_id && (row.kind === 'reaction' || row.kind === 'comment' || row.kind === 'repost' || row.kind === 'mention')) {
      const post = await query<{ one: number }>(
        'SELECT 1 AS one FROM posts WHERE id = $1 AND deleted_at IS NULL',
        [row.subject_id],
      );
      if (post.length === 0) continue;
    }
    if (row.kind === 'reply' && row.subject_id) {
      const comment = await query<{ one: number }>(
        'SELECT 1 AS one FROM comments WHERE id = $1 AND deleted_at IS NULL',
        [row.subject_id],
      );
      if (comment.length === 0) continue;
    }
    const count = Math.max(actors.length, 1);
    items.push({
      id: row.id,
      kind: row.kind,
      count,
      actors: actors.map((actor) => ({ id: actor.id, name: actor.name })),
      text: textFor(row.kind, actors[0]?.name ?? '', count, row.detail),
      target_url: row.target_url,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      unread: seenAt === null || row.updated_at.getTime() > seenAt.getTime(),
    });
  }
  const limited = items.slice(0, 50);
  return { items: limited, unread_count: items.filter((item) => item.unread).length };
}

export async function markNotificationsSeen(memberId: string): Promise<void> {
  await query('UPDATE members SET notifications_seen_at = $2 WHERE id = $1', [
    memberId,
    businessNow(),
  ]);
}
