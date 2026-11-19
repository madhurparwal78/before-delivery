import type { ModAction, ModLogEntry } from '../shared/types.js';
import { utcLabel } from '../shared/format.js';
import { Link } from './router.js';

const ACTION_TEXT: Record<ModAction, string> = {
  remove_post: 'Removed post',
  restore_post: 'Restored post',
  remove_comment: 'Removed comment',
  lock: 'Locked thread',
  unlock: 'Unlocked thread',
  pin: 'Pinned post',
  unpin: 'Unpinned post',
  add_moderator: 'Added moderator',
  remove_moderator: 'Removed moderator',
  approve_poster: 'Approved poster',
  unapprove_poster: 'Removed approved poster',
};

export const actionText = (action: ModAction): string => ACTION_TEXT[action];

/** The Target cell: `Post <id>`, `Comment <id>` or `u/<username>`, linking to what it names. */
export function TargetCell({ community, entry }: { community: string; entry: ModLogEntry }): React.JSX.Element {
  const { type, id } = entry.target;
  if (type === 'post') return <Link to={`/c/${community}/post/${id}`}>{`Post ${id}`}</Link>;
  // A comment target carries only the comment id; the thread page finds its post from the comment.
  if (type === 'comment') return <Link to={`/c/${community}/post/0/comment/${id}`}>{`Comment ${id}`}</Link>;
  return <Link to={`/u/${id}`}>{`u/${id}`}</Link>;
}

export const timeText = (entry: ModLogEntry): string => utcLabel(entry.at);
