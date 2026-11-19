import type { Db } from './db.js';
import { one, rows } from './db.js';
import { config } from './config.js';
import { now, secondsAgo } from './clock.js';
import { srcsetFor } from './images.js';
import type { SessionUser } from './accounts.js';
import type {
  CommentView, CommunityView, ImageView, ModAction, ModLogEntry, PostView, PublicUser, ReportView, Rule,
} from '../shared/types.js';

const DELETED_TITLE = '[deleted by author]';

const user = (username: string, createdAt: Date): PublicUser => ({ username, createdAt: createdAt.toISOString() });

/* ------------------------------------------------------------------ communities */

interface CommunityRow {
  id: string;
  name: string;
  title: string;
  description: string;
  type: 'public' | 'restricted';
  member_count: number;
  show_mod_names: boolean;
  owner_id: string;
  created_at: Date;
  joined: boolean;
  is_moderator: boolean;
  approved: boolean;
}

const COMMUNITY_SELECT = `
  SELECT c.id, c.name, c.title, c.description, c.type, c.member_count, c.show_mod_names, c.owner_id, c.created_at,
    EXISTS (SELECT 1 FROM memberships x WHERE x.community_id = c.id AND x.user_id = $1::bigint) AS joined,
    EXISTS (SELECT 1 FROM moderators x WHERE x.community_id = c.id AND x.user_id = $1::bigint) AS is_moderator,
    EXISTS (SELECT 1 FROM approved_posters x WHERE x.community_id = c.id AND x.user_id = $1::bigint) AS approved
  FROM communities c`;

/** Loads communities for a viewer. `where` and `tail` may use $2 and up; $1 is the viewer id. */
export async function loadCommunities(db: Db, viewer: SessionUser | null, where: string, params: unknown[], tail = ''): Promise<CommunityView[]> {
  const found = await rows<CommunityRow>(db, `${COMMUNITY_SELECT} WHERE ${where} ${tail}`, [viewer?.id ?? null, ...params]);
  if (found.length === 0) return [];
  const rules = await rows<{ id: string; community_id: string; title: string; description: string }>(db,
    'SELECT id, community_id, title, description FROM rules WHERE community_id = ANY($1::bigint[]) ORDER BY community_id, position',
    [found.map((c) => c.id)]);
  return found.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    description: c.description,
    type: c.type,
    memberCount: c.member_count,
    rules: rules.filter((r) => r.community_id === c.id).map((r): Rule => ({ id: r.id, title: r.title, description: r.description })),
    showModNames: c.show_mod_names,
    createdAt: c.created_at.toISOString(),
    viewer: {
      joined: c.joined,
      isModerator: c.is_moderator,
      isOwner: viewer !== null && c.owner_id === viewer.id,
      canPost: viewer !== null && (c.type === 'public' || c.is_moderator || c.approved),
    },
  }));
}

export async function loadCommunity(db: Db, viewer: SessionUser | null, name: string): Promise<CommunityView | null> {
  return (await loadCommunities(db, viewer, 'c.name_key = lower($2)', [name]))[0] ?? null;
}

/* ------------------------------------------------------------------ posts */

interface PostRow {
  id: string;
  community_name: string;
  author_id: string;
  author_username: string;
  author_created_at: Date;
  title: string;
  body_html: string | null;
  body_md: string | null;
  spoiler: boolean;
  score: number;
  comment_count: number;
  created_at: Date;
  edited_at: Date | null;
  state: 'published' | 'removed' | 'deleted';
  removal_reason: string | null;
  removed_at: Date | null;
  locked_now: boolean;
  locked_until_now: Date | null;
  pinned: boolean;
  version: number;
  my_vote: number;
  viewer_is_moderator: boolean;
  viewer_is_author: boolean;
  archived: boolean;
}

interface ImageRow { id: string; post_id: string; alt: string | null; width: number; height: number }

export const archiveCutoff = (): Date => secondsAgo(config.limits.archiveAfterDays * 86_400);

const POST_SELECT = `
  SELECT p.id, c.name AS community_name, p.author_id, u.username AS author_username, u.created_at AS author_created_at,
    p.title, p.body_html, p.body_md, p.spoiler, p.score, p.comment_count, p.created_at, p.edited_at, p.state,
    p.removal_reason, p.removed_at,
    (p.locked AND (p.locked_until IS NULL OR p.locked_until > $2)) AS locked_now,
    CASE WHEN p.locked AND p.locked_until > $2 THEN p.locked_until END AS locked_until_now,
    p.pinned, p.version, COALESCE(v.value, 0)::int AS my_vote,
    EXISTS (SELECT 1 FROM moderators m WHERE m.community_id = p.community_id AND m.user_id = $1::bigint) AS viewer_is_moderator,
    (p.author_id = $1::bigint) AS viewer_is_author,
    (p.created_at < $3) AS archived
  FROM posts p
  JOIN communities c ON c.id = p.community_id
  JOIN users u ON u.id = p.author_id
  LEFT JOIN votes v ON v.member_id = $1::bigint AND v.target_type = 'post' AND v.target_id = p.id`;

export function imageView(row: { id: string; alt: string | null; width: number; height: number }): ImageView {
  return {
    id: row.id, alt: row.alt, width: row.width, height: row.height,
    src: `/media/${row.id}/640.webp`, srcset: srcsetFor(row.id, row.width),
  };
}

function postView(row: PostRow, images: ImageRow[]): PostView {
  const privileged = row.viewer_is_author || row.viewer_is_moderator;
  const hidden = row.state === 'deleted' || (row.state === 'removed' && !privileged);
  const view: PostView = {
    id: row.id,
    communityName: row.community_name,
    author: hidden ? null : user(row.author_username, row.author_created_at),
    title: row.state === 'deleted' ? DELETED_TITLE : hidden ? null : row.title,
    bodyHtml: hidden ? null : row.body_html,
    images: hidden ? [] : images.map(imageView),
    spoiler: row.spoiler,
    score: row.score,
    myVote: row.my_vote as -1 | 0 | 1,
    commentCount: row.comment_count,
    createdAt: row.created_at.toISOString(),
    editedAt: row.edited_at?.toISOString() ?? null,
    state: row.state,
    removal: row.state === 'removed' && row.removal_reason !== null
      ? { publicReason: row.removal_reason, at: (row.removed_at as Date).toISOString() } : null,
    locked: row.locked_now,
    lockedUntil: row.locked_until_now?.toISOString() ?? null,
    pinned: row.pinned,
    archived: row.archived,
    version: row.version,
    url: `/c/${row.community_name}/post/${row.id}`,
  };
  if (row.viewer_is_author) view.bodyMd = row.state === 'deleted' ? null : row.body_md;
  return view;
}

/** Loads posts for a viewer. `where` and `tail` may use $4 and up; $1 is the viewer id, $2 now, $3 the archive cutoff. */
export async function loadPosts(db: Db, viewer: SessionUser | null, where: string, params: unknown[], tail = ''): Promise<PostView[]> {
  const found = await rows<PostRow>(db, `${POST_SELECT} WHERE ${where} ${tail}`, [viewer?.id ?? null, now(), archiveCutoff(), ...params]);
  if (found.length === 0) return [];
  const images = await rows<ImageRow>(db,
    'SELECT id, post_id, alt, width, height FROM images WHERE post_id = ANY($1::bigint[]) ORDER BY post_id, position',
    [found.map((p) => p.id)]);
  return found.map((p) => postView(p, images.filter((i) => i.post_id === p.id)));
}

export async function loadPost(db: Db, viewer: SessionUser | null, id: string): Promise<PostView | null> {
  return (await loadPosts(db, viewer, 'p.id = $4', [id]))[0] ?? null;
}

/** The current moderation state of a post, as sent with a conflict. */
export const postConflictState = (post: PostView): Record<string, unknown> => ({
  version: post.version, state: post.state, locked: post.locked, lockedUntil: post.lockedUntil, pinned: post.pinned,
});

/* ------------------------------------------------------------------ comments */

interface CommentRow {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  author_username: string;
  author_created_at: Date;
  body_html: string | null;
  body_md: string | null;
  score: number;
  depth: number;
  path: string;
  descendant_count: number;
  created_at: Date;
  edited_at: Date | null;
  state: 'published' | 'deleted' | 'removed';
  my_vote: number;
}

export interface ThreadContext {
  viewer: SessionUser | null;
  viewerIsModerator: boolean;
  locked: boolean;
  archived: boolean;
}

export const COMMENT_SELECT = `
  SELECT cm.id, cm.post_id, cm.parent_id, cm.author_id, u.username AS author_username, u.created_at AS author_created_at,
    cm.body_html, cm.body_md, cm.score, cm.depth, cm.path, cm.descendant_count, cm.created_at, cm.edited_at, cm.state,
    COALESCE(v.value, 0)::int AS my_vote
  FROM comments cm
  JOIN users u ON u.id = cm.author_id
  LEFT JOIN votes v ON v.member_id = $1::bigint AND v.target_type = 'comment' AND v.target_id = cm.id`;

export function commentView(row: CommentRow, context: ThreadContext): CommentView {
  const isAuthor = context.viewer !== null && row.author_id === context.viewer.id;
  const shown = row.state === 'published' || (row.state === 'removed' && (isAuthor || context.viewerIsModerator));
  const editable = isAuthor && row.state === 'published' && !context.locked && !context.archived &&
    now().getTime() - row.created_at.getTime() < config.limits.commentEditWindowSeconds * 1000;
  const view: CommentView = {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    author: shown ? user(row.author_username, row.author_created_at) : null,
    bodyHtml: shown ? row.body_html : null,
    score: row.score,
    myVote: row.my_vote as -1 | 0 | 1,
    depth: row.depth,
    descendantCount: row.descendant_count,
    createdAt: row.created_at.toISOString(),
    editedAt: row.edited_at?.toISOString() ?? null,
    state: row.state,
    canEdit: editable,
    replies: [],
  };
  if (isAuthor) view.bodyMd = row.state === 'deleted' ? null : row.body_md;
  return view;
}

export interface ThreadFacts { postId: string; communityId: string; locked: boolean; archived: boolean; viewerIsModerator: boolean; state: string }

export async function threadFacts(db: Db, viewer: SessionUser | null, postId: string): Promise<ThreadFacts | null> {
  const row = await one<{ id: string; community_id: string; locked_now: boolean; archived: boolean; is_moderator: boolean; state: string }>(db,
    `SELECT p.id, p.community_id, (p.locked AND (p.locked_until IS NULL OR p.locked_until > $2)) AS locked_now,
       (p.created_at < $3) AS archived, p.state,
       EXISTS (SELECT 1 FROM moderators m WHERE m.community_id = p.community_id AND m.user_id = $1::bigint) AS is_moderator
     FROM posts p WHERE p.id = $4`,
    [viewer?.id ?? null, now(), archiveCutoff(), postId]);
  return row ? {
    postId: row.id, communityId: row.community_id, locked: row.locked_now, archived: row.archived,
    viewerIsModerator: row.is_moderator, state: row.state,
  } : null;
}

export const contextOf = (facts: ThreadFacts, viewer: SessionUser | null): ThreadContext => ({
  viewer, viewerIsModerator: facts.viewerIsModerator, locked: facts.locked, archived: facts.archived,
});

export async function loadCommentRows(db: Db, viewer: SessionUser | null, where: string, params: unknown[], tail = ''): Promise<CommentRow[]> {
  return rows<CommentRow>(db, `${COMMENT_SELECT} WHERE ${where} ${tail}`, [viewer?.id ?? null, ...params]);
}

/* ------------------------------------------------------------------ mod log and reports */

export function modLogView(row: {
  id: string; action: string; target_type: 'post' | 'comment' | 'user'; target_id: string; public_reason: string | null;
  private_note: string | null; at: Date; moderator_username: string; moderator_created_at: Date;
}, showModNames: boolean, viewerIsModerator: boolean): ModLogEntry {
  const entry: ModLogEntry = {
    id: row.id,
    action: row.action as ModAction,
    target: { type: row.target_type, id: row.target_id },
    publicReason: row.public_reason,
    at: row.at.toISOString(),
    moderator: showModNames || viewerIsModerator ? user(row.moderator_username, row.moderator_created_at) : null,
  };
  if (viewerIsModerator) entry.privateNote = row.private_note;
  return entry;
}

export function reportView(row: {
  reference: string; target_type: 'post' | 'comment'; target_id: string; community_name: string; post_id: string;
  category: string; explanation: string; created_at: Date; status: 'open' | 'actioned' | 'dismissed';
}): ReportView {
  const deadline = new Date(row.created_at.getTime() + config.limits.reportDeadlineSeconds * 1000);
  const remaining = Math.floor((deadline.getTime() - now().getTime()) / 1000);
  return {
    reference: row.reference,
    target: {
      type: row.target_type,
      id: row.target_id,
      url: row.target_type === 'post'
        ? `/c/${row.community_name}/post/${row.target_id}`
        : `/c/${row.community_name}/post/${row.post_id}/comment/${row.target_id}`,
    },
    category: row.category,
    explanation: row.explanation,
    createdAt: row.created_at.toISOString(),
    deadlineAt: deadline.toISOString(),
    secondsRemaining: remaining,
    overdue: now().getTime() >= deadline.getTime(),
    status: row.status,
  };
}
