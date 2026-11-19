import { now } from '../clock.js';
import { publishAfterCommit, type Tx } from '../db.js';
import { newId } from '../ids.js';

export type StoredNotificationKind =
  | 'invitation_received'
  | 'invitation_accepted'
  | 'reply'
  | 'mention'
  | 'repost'
  | 'endorsement'
  | 'application_status';

interface NewNotification {
  memberId: string;
  kind: StoredNotificationKind;
  actorId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  /** The skill, or the status announcement for an application. */
  detail?: string | null;
}

/** Stores one notification event and tells the member's open pages. Members are never notified of their own actions. */
export async function notify(tx: Tx, notification: NewNotification): Promise<void> {
  if (notification.actorId && notification.actorId === notification.memberId) return;
  const at = now();
  await tx.query(
    `INSERT INTO notifications (id, member_id, kind, actor_id, post_id, comment_id, detail, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [newId(), notification.memberId, notification.kind, notification.actorId ?? null, notification.postId ?? null, notification.commentId ?? null, notification.detail ?? null, at],
  );
  publishAfterCommit(tx, [notification.memberId], { type: 'notification' });
}
