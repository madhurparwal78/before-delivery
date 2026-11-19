/* Post and comment projections: the exact published key sets per caller role. */
import type { Services } from './routes.js';
import type { Ctx } from './context.js';
import { ApiError } from './errors.js';
import { DELETED_POST_TITLE, altFallback } from './domain.js';
import { iso } from './util.js';
import { memberRole } from './communities.js';

export type PostRow = {
  id: string;
  community_id: string;
  community_name: string;
  author_id: string | null;
  title: string;
  body_md: string | null;
  body_html: string | null;
  spoiler: boolean;
  score: number;
  hot_rank: number;
  comment_count: number;
  state: string;
  removal_public_reason: string | null;
  removal_at: Date | null;
  locked: boolean;
  locked_until: Date | null;
  pinned: boolean;
  version: number;
  created_at: Date;
  edited_at: Date | null;
};

type ImageRow = { id: string; width: number; height: number; alt: string | null; position: number };

export async function postView(services: Services, post: PostRow, account: Ctx['account']): Promise<Record<string, unknown>> {
  const postId = Number(post.id);
  const community = await loadCommunity(services, Number(post.community_id));
  const role = await memberRole(services, community.id, account?.id ?? null);
  const isAuthor = account !== null && post.author_id !== null && Number(post.author_id) === account.id;
  const privileged = isAuthor || role.isModerator;

  let myVote = 0;
  if (account !== null) {
    const rows = await services.db.query(
      `SELECT value FROM votes WHERE member_id = $1 AND target_type = 'post' AND target_id = $2`,
      [account.id, postId]
    );
    if (rows.rows.length > 0) myVote = Number((rows.rows[0] as { value: number }).value);
  }

  const images = (await services.db.query(
    `SELECT id, width, height, alt, position FROM images WHERE post_id = $1 ORDER BY position, id`,
    [postId]
  )).rows as unknown as ImageRow[];

  const author = post.author_id === null
    ? null
    : await publicUser(services, Number(post.author_id));

  let title: string | null = post.title;
  let bodyHtml: string | null = post.body_html;
  let authorView: { username: string; createdAt: string } | null = author;
  let imagesView: unknown[] = [];
  let bodyMd: string | null = null;

  if (post.state === 'published') {
    imagesView = images.map((img) => imageView(img, post, community.name, author?.username ?? 'unknown'));
    if (isAuthor) bodyMd = post.body_md;
  } else if (post.state === 'removed') {
    if (privileged) {
      imagesView = images.map((img) => imageView(img, post, community.name, author?.username ?? 'unknown'));
      if (isAuthor) bodyMd = post.body_md;
    } else {
      title = null;
      bodyHtml = null;
      authorView = null;
      imagesView = [];
    }
  } else if (post.state === 'deleted') {
    title = DELETED_POST_TITLE;
    bodyHtml = null;
    authorView = null;
    imagesView = [];
  }

  const view: Record<string, unknown> = {
    id: postId,
    communityName: community.name,
    author: authorView,
    title,
    bodyHtml,
    images: imagesView,
    spoiler: post.spoiler,
    score: post.score,
    myVote,
    commentCount: post.comment_count,
    createdAt: iso(new Date(post.created_at)),
    editedAt: post.edited_at === null ? null : iso(new Date(post.edited_at)),
    state: post.state,
    removal: post.state === 'removed' && post.removal_at !== null ? { publicReason: post.removal_public_reason, at: iso(new Date(post.removal_at)) } : null,
    locked: isLocked(post),
    lockedUntil: isLocked(post) && post.locked_until !== null ? iso(new Date(post.locked_until)) : null,
    pinned: post.pinned,
    archived: isArchivedRow(services, post),
    version: post.version,
    url: `/c/${community.name}/post/${postId}`,
  };
  if (isAuthor) view.bodyMd = bodyMd;
  return view;
}

export function isArchivedRow(services: Services, post: PostRow): boolean {
  const age = (Date.now() - new Date(post.created_at).getTime()) / 1000;
  return age > services.cfg.limits.archiveAfterDays * 86_400;
}

/* A timed lock ends when the server's clock reaches lockedUntil, with no
   client or moderator action. This is the one place that decides it. */
export function isLocked(post: PostRow): boolean {
  if (!post.locked) return false;
  if (post.locked_until === null) return true;
  return new Date(post.locked_until).getTime() > Date.now();
}

function imageView(img: ImageRow, post: PostRow, communityName: string, username: string): Record<string, unknown> {
  void post;
  void communityName;
  const id = Number(img.id);
  return {
    id,
    alt: img.alt,
    width: img.width,
    height: img.height,
    src: `/media/${id}/640.webp`,
    srcset: [320, 640, 1080].map((slot) => `/media/${id}/${slot}.webp ${slot}w`).join(', '),
    altFallbackText: altFallback(img.position + 1, 1, username),
  };
}

async function loadCommunity(services: Services, id: number): Promise<{ id: number; name: string }> {
  const rows = await services.db.query(`SELECT id, name FROM communities WHERE id = $1`, [id]);
  if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
  const r = rows.rows[0] as { id: string; name: string };
  return { id: Number(r.id), name: r.name };
}

export async function publicUser(services: Services, accountId: number): Promise<{ username: string; createdAt: string } | null> {
  const rows = await services.db.query(`SELECT username, created_at FROM accounts WHERE id = $1`, [accountId]);
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0] as { username: string; created_at: Date };
  return { username: r.username, createdAt: iso(new Date(r.created_at)) };
}

/* ---- comments ---- */

export type CommentRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string | null;
  path: string;
  depth: number;
  body_md: string | null;
  body_html: string | null;
  score: number;
  descendant_count: number;
  state: string;
  removal_public_reason: string | null;
  created_at: Date;
  edited_at: Date | null;
};

export async function commentView(services: Services, comment: CommentRow, account: Ctx['account'], communityId: number, withReplies: boolean): Promise<Record<string, unknown>> {
  const isAuthor = account !== null && comment.author_id !== null && Number(comment.author_id) === account.id;
  const role = await memberRole(services, communityId, account?.id ?? null);
  const privileged = isAuthor || role.isModerator;
  const author = comment.author_id === null ? null : await publicUser(services, Number(comment.author_id));
  let myVote = 0;
  if (account !== null) {
    const rows = await services.db.query(
      `SELECT value FROM votes WHERE member_id = $1 AND target_type = 'comment' AND target_id = $2`,
      [account.id, Number(comment.id)]
    );
    if (rows.rows.length > 0) myVote = Number((rows.rows[0] as { value: number }).value);
  }
  let bodyHtml = comment.body_html;
  let authorView = author;
  let bodyMd: string | null = null;
  if (comment.state === 'removed') {
    if (!privileged) {
      bodyHtml = null;
      authorView = null;
    }
    if (isAuthor) bodyMd = comment.body_md;
  } else if (comment.state === 'deleted') {
    bodyHtml = null;
    authorView = null;
  } else {
    if (isAuthor) bodyMd = comment.body_md;
  }
  const canEdit =
    isAuthor && comment.state === 'published' &&
    Date.now() - new Date(comment.created_at).getTime() < services.cfg.limits.commentEditWindow * 1000;
  const view: Record<string, unknown> = {
    id: Number(comment.id),
    postId: Number(comment.post_id),
    parentId: comment.parent_id === null ? null : Number(comment.parent_id),
    author: authorView,
    bodyHtml,
    score: comment.score,
    myVote,
    depth: comment.depth,
    descendantCount: comment.descendant_count,
    createdAt: iso(new Date(comment.created_at)),
    editedAt: comment.edited_at === null ? null : iso(new Date(comment.edited_at)),
    state: comment.state,
    canEdit,
  };
  if (isAuthor) view.bodyMd = bodyMd;
  if (withReplies) view.replies = [];
  return view;
}

/* Live-event helpers. */

export async function publishScore(services: Services, targetType: 'post' | 'comment', targetId: number, communityName: string, score: number): Promise<void> {
  let postId = targetId;
  if (targetType === 'comment') {
    const rows = await services.db.query(`SELECT post_id FROM comments WHERE id = $1`, [targetId]);
    postId = Number((rows.rows[0] as { post_id: string }).post_id);
  }
  await services.valkey.publish({
    topics: ['home', `community:${communityName.toLowerCase()}`, `post:${postId}`],
    event: 'score',
    data: { targetType, targetId, postId, score },
  });
}

export async function publishComments(services: Services, postId: number, communityName: string, commentCount: number): Promise<void> {
  await services.valkey.publish({
    topics: ['home', `community:${communityName.toLowerCase()}`, `post:${postId}`],
    event: 'comments',
    data: { postId, commentCount },
  });
}
