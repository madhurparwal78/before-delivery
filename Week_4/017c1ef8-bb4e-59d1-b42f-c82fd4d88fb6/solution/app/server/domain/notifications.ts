import { now } from '../clock.js';
import { oneRow, rows, type Db, type Tx, publishAfterCommit } from '../db.js';
import { isUnread, unreadCount } from './counts.js';
import type { StoredNotificationKind } from './notify.js';
import { others } from './text.js';
import { notBlockedWith } from './visibility.js';

interface NotificationItem {
  id: string;
  kind: StoredNotificationKind | 'reaction' | 'comment';
  count: number;
  actors: Array<{ id: string; name: string }>;
  text: string;
  target_url: string;
  created_at: Date;
  updated_at: Date;
  unread: boolean;
}

interface NotificationList {
  items: NotificationItem[];
  unread_count: number;
}

const LIST_LIMIT = 50;
const ACTORS_SHOWN = 10;

interface StoredRow {
  id: string;
  kind: StoredNotificationKind;
  actor_id: string | null;
  actor_name: string | null;
  actor_handle: string | null;
  post_id: string | null;
  detail: string | null;
  created_at: Date;
  updated_at: Date;
}

interface GroupRow {
  post_id: string;
  member_id: string;
  name: string;
  created_at: Date;
}

/** `<name> <verb>`, `<name> and 1 other <verb>`, `<name> and <N-1> others <verb>`: the name is the most recent actor's. */
const groupedText = (name: string, count: number, verb: string): string => (count === 1 ? `${name} ${verb}` : `${name} and ${others(count - 1)} ${verb}`);

function storedText(row: StoredRow): string {
  const name = row.actor_name ?? '';
  switch (row.kind) {
    case 'invitation_received':
      return `${name} wants to connect`;
    case 'invitation_accepted':
      return `${name} accepted your invitation`;
    case 'reply':
      return `${name} replied to your comment`;
    case 'mention':
      return `${name} mentioned you in a post`;
    case 'repost':
      return `${name} reposted your post`;
    case 'endorsement':
      return `${name} endorsed you for ${row.detail ?? ''}`;
    case 'application_status':
      return row.detail ?? '';
  }
}

function storedTarget(row: StoredRow, viewerHandle: string): string {
  switch (row.kind) {
    case 'invitation_received':
      return '/network';
    case 'invitation_accepted':
      return `/in/${row.actor_handle ?? ''}`;
    case 'reply':
    case 'mention':
    case 'repost':
      return `/posts/${row.post_id ?? ''}`;
    case 'endorsement':
      return `/in/${viewerHandle}`;
    case 'application_status':
      return '/my-jobs';
  }
}

/** One item per post from rows ordered newest first. */
function groupPerPost(groupRows: GroupRow[], kind: 'reaction' | 'comment', verb: string, seenAt: Date): NotificationItem[] {
  const byPost = new Map<string, GroupRow[]>();
  for (const row of groupRows) byPost.set(row.post_id, [...(byPost.get(row.post_id) ?? []), row]);
  return [...byPost.entries()].map(([postId, group]) => {
    const newest = group[0] as GroupRow;
    const oldest = group[group.length - 1] as GroupRow;
    return {
      id: `${kind}:${postId}`,
      kind,
      count: group.length,
      actors: group.slice(0, ACTORS_SHOWN).map((row) => ({ id: row.member_id, name: row.name })),
      text: groupedText(newest.name, group.length, verb),
      target_url: `/posts/${postId}`,
      created_at: oldest.created_at,
      updated_at: newest.created_at,
      unread: isUnread(newest.created_at, seenAt),
    };
  });
}

/**
 * The member's notifications, newest update first. Reaction and comment items are derived from their own tables
 * at read time, so a removed reaction lowers the count and members blocked with the viewer never appear.
 */
export async function notificationList(db: Db, viewer: { id: string; handle: string }): Promise<NotificationList> {
  const { seen_at } = await oneRow<{ seen_at: Date }>(db, 'SELECT notifications_seen_at AS seen_at FROM members WHERE id = $1', [viewer.id]);
  const stored = await rows<StoredRow>(
    db,
    `SELECT n.id, n.kind, n.actor_id, a.name AS actor_name, a.handle AS actor_handle, n.post_id, n.detail, n.created_at, n.updated_at
       FROM notifications n LEFT JOIN members a ON a.id = n.actor_id LEFT JOIN comments c ON c.id = n.comment_id
      WHERE n.member_id = $1 AND (n.actor_id IS NULL OR ${notBlockedWith('$1', 'n.actor_id')}) AND (n.comment_id IS NULL OR c.deleted_at IS NULL)`,
    [viewer.id],
  );
  const reactions = await rows<GroupRow>(
    db,
    `SELECT r.post_id, r.member_id, m.name, r.created_at FROM reactions r
       JOIN posts p ON p.id = r.post_id JOIN members m ON m.id = r.member_id
      WHERE p.author_id = $1 AND r.member_id <> $1 AND ${notBlockedWith('$1', 'r.member_id')}
      ORDER BY r.created_at DESC, r.member_id`,
    [viewer.id],
  );
  const comments = await rows<GroupRow>(
    db,
    `SELECT c.post_id, c.author_id AS member_id, m.name, c.created_at FROM comments c
       JOIN posts p ON p.id = c.post_id JOIN members m ON m.id = c.author_id
      WHERE p.author_id = $1 AND c.parent_id IS NULL AND c.deleted_at IS NULL AND c.author_id <> $1 AND ${notBlockedWith('$1', 'c.author_id')}
      ORDER BY c.created_at DESC, c.id`,
    [viewer.id],
  );
  const items: NotificationItem[] = [
    ...stored.map((row) => ({
      id: row.id,
      kind: row.kind,
      count: 1,
      actors: row.actor_id && row.actor_name ? [{ id: row.actor_id, name: row.actor_name }] : [],
      text: storedText(row),
      target_url: storedTarget(row, viewer.handle),
      created_at: row.created_at,
      updated_at: row.updated_at,
      unread: isUnread(row.updated_at, seen_at),
    })),
    ...groupPerPost(reactions, 'reaction', 'reacted to your post', seen_at),
    ...groupPerPost(comments, 'comment', 'commented on your post', seen_at),
  ].sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime() || (a.id < b.id ? 1 : -1));
  return { items: items.slice(0, LIST_LIMIT), unread_count: unreadCount(items) };
}

/** Opening the Notifications page marks everything seen. */
export async function markNotificationsSeen(tx: Tx, memberId: string): Promise<void> {
  await tx.query('UPDATE members SET notifications_seen_at = $2 WHERE id = $1', [memberId, now()]);
  publishAfterCommit(tx, [memberId], { type: 'notification' });
}
