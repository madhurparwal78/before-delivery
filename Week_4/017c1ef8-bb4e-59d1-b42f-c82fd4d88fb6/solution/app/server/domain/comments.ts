import { maybeRow, oneRow, rows, type Db, type Tx } from '../db.js';
import { config } from '../config.js';
import { newId } from '../ids.js';
import { notFound, validation } from '../errors.js';
import { announcePost } from './post-events.js';
import { notify } from './notify.js';
import { checkedText, hashtagsIn, mentionObjects, parseText, type MentionObject, type ResolvedMention } from './text.js';
import { memberVisibleTo, notBlockedWith } from './visibility.js';


interface CommentAuthor {
  id: string;
  handle: string;
  name: string;
  headline: string;
}

interface CommentObject {
  id: string;
  post_id: string;
  parent_id: string | null;
  author: CommentAuthor;
  text: string;
  mentions: MentionObject[];
  hashtags: string[];
  created_at: Date;
  deleted: false;
  replies: CommentObject[];
}

interface DeletedCommentObject {
  id: string;
  post_id: string;
  parent_id: null;
  deleted: true;
  replies: CommentObject[];
}

interface CommentRow {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  handle: string;
  name: string;
  headline: string;
  text: string;
  mentions: ResolvedMention[];
  created_at: Date;
  deleted: boolean;
  blocked: boolean;
}

/**
 * The comments of these posts the viewer sees. A live comment by a blocked member is hidden, with its replies
 * when it is a top-level comment. A deleted top-level comment stays, as a placeholder, only while it has a visible reply.
 */
export async function visibleComments(db: Db, viewerId: string, postIds: string[]): Promise<CommentRow[]> {
  const all = await rows<CommentRow>(
    db,
    `SELECT c.id, c.post_id, c.parent_id, c.author_id, m.handle, m.name, m.headline, c.text, c.mentions, c.created_at,
            c.deleted_at IS NOT NULL AS deleted, NOT ${notBlockedWith('$1', 'c.author_id')} AS blocked
       FROM comments c JOIN members m ON m.id = c.author_id
      WHERE c.post_id = ANY($2)
      ORDER BY c.created_at, c.id`,
    [viewerId, postIds],
  );
  const hiddenTop = new Set(all.filter((c) => c.parent_id === null && !c.deleted && c.blocked).map((c) => c.id));
  const liveReplies = all.filter((c) => c.parent_id !== null && !c.deleted && !c.blocked && !hiddenTop.has(c.parent_id));
  const withReplies = new Set(liveReplies.map((c) => c.parent_id));
  const tops = all.filter((c) => c.parent_id === null && (c.deleted ? withReplies.has(c.id) : !hiddenTop.has(c.id)));
  return [...tops, ...liveReplies];
}

export async function commentTree(db: Db, viewerId: string, postId: string): Promise<Array<CommentObject | DeletedCommentObject>> {
  const visible = await visibleComments(db, viewerId, [postId]);
  const live = visible.filter((comment) => !comment.deleted);
  const mentions = await mentionObjects(db, viewerId, live.map((comment) => comment.mentions));
  const objects = new Map<string, CommentObject>(
    live.map((comment, index) => [
      comment.id,
      {
        id: comment.id,
        post_id: comment.post_id,
        parent_id: comment.parent_id,
        author: { id: comment.author_id, handle: comment.handle, name: comment.name, headline: comment.headline },
        text: comment.text,
        mentions: mentions[index] as MentionObject[],
        hashtags: hashtagsIn(comment.text),
        created_at: comment.created_at,
        deleted: false,
        replies: [],
      },
    ]),
  );
  const tops: Array<CommentObject | DeletedCommentObject> = [];
  for (const comment of visible) {
    if (comment.parent_id === null) {
      tops.push(comment.deleted ? { id: comment.id, post_id: comment.post_id, parent_id: null, deleted: true, replies: [] } : (objects.get(comment.id) as CommentObject));
    }
  }
  for (const comment of visible) {
    const reply = objects.get(comment.id);
    const parent = comment.parent_id === null ? undefined : tops.find((top) => top.id === comment.parent_id);
    if (reply && parent) parent.replies.push(reply);
  }
  return tops;
}

/** The comment a request may reply to: live, on this post, and visible to the viewer. Anything else is not found. */
async function replyTarget(db: Db, viewerId: string, postId: string, parentId: string): Promise<{ id: string; author_id: string; top_id: string }> {
  const visible = await visibleComments(db, viewerId, [postId]);
  const target = visible.find((comment) => comment.id === parentId && !comment.deleted);
  if (!target) throw notFound();
  return { id: target.id, author_id: target.author_id, top_id: target.parent_id ?? target.id };
}

interface NewComment {
  text: unknown;
  parent_id: unknown;
}

/** Looks up the replied-to comment (404 checks), kept apart so it runs before the idempotency replay. */
export async function resolveParent(db: Db, viewerId: string, postId: string, parentId: unknown): Promise<{ id: string; author_id: string; top_id: string } | null> {
  if (parentId === undefined || parentId === null) return null;
  if (typeof parentId !== 'string') throw validation({ parent_id: 'Choose a comment to reply to.' });
  return replyTarget(db, viewerId, postId, parentId);
}

export async function createComment(
  tx: Tx,
  viewer: { id: string },
  post: { id: string; author_id: string },
  input: NewComment,
  parent: { id: string; author_id: string; top_id: string } | null,
  at: Date,
): Promise<CommentObject> {
  const text = checkedText(input.text, config.commentMaxChars, `Comments can be up to ${config.commentMaxChars} characters.`);
  const parsed = await parseText(tx, viewer.id, text);
  const id = newId();
  await tx.query(
    'INSERT INTO comments (id, post_id, parent_id, author_id, text, mentions, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, post.id, parent?.top_id ?? null, viewer.id, text, JSON.stringify(parsed.mentions), at],
  );
  if (parent) await notify(tx, { memberId: parent.author_id, kind: 'reply', actorId: viewer.id, postId: post.id, commentId: id });
  announcePost(tx, 'comments', post);
  const author = await oneRow<CommentAuthor>(tx, 'SELECT id, handle, name, headline FROM members WHERE id = $1', [viewer.id]);
  const [mentions] = await mentionObjects(tx, viewer.id, [parsed.mentions]);
  return {
    id,
    post_id: post.id,
    parent_id: parent?.top_id ?? null,
    author,
    text,
    mentions: mentions as MentionObject[],
    hashtags: hashtagsIn(text),
    created_at: at,
    deleted: false,
    replies: [],
  };
}

interface CommentTarget {
  id: string;
  post_id: string;
  author_id: string;
  post_author_id: string;
}

/** The comment to delete, or not found when it is missing, already deleted, or its post or author is hidden from the viewer. */
export async function deletableComment(db: Db, viewerId: string, commentId: string): Promise<CommentTarget> {
  const target = await maybeRow<CommentTarget>(
    db,
    `SELECT c.id, c.post_id, c.author_id, p.author_id AS post_author_id
       FROM comments c JOIN posts p ON p.id = c.post_id JOIN members am ON am.id = p.author_id
      WHERE c.id = $2 AND c.deleted_at IS NULL AND ${memberVisibleTo('$1', 'am')}`,
    [viewerId, commentId],
  );
  if (!target) throw notFound();
  const visible = await visibleComments(db, viewerId, [target.post_id]);
  if (!visible.some((comment) => comment.id === target.id)) throw notFound();
  return target;
}

export async function deleteComment(tx: Tx, target: CommentTarget, at: Date): Promise<void> {
  await tx.query('UPDATE comments SET deleted_at = $2 WHERE id = $1 AND deleted_at IS NULL', [target.id, at]);
  announcePost(tx, 'comments', { id: target.post_id, author_id: target.post_author_id });
}
