import { config } from '../core/config.js';
import { db, many, one, transaction, type Queryable } from '../core/db.js';
import { errors } from '../core/errors.js';
import { iso, isoOrNull, now } from '../core/time.js';
import { renderMarkdown } from './markdown.js';
import { publicUser, type Viewer } from './viewer.js';

export type CommentSort = 'top' | 'new';

export interface CommentRow {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  author_username: string;
  author_created_at: unknown;
  body_md: string;
  body_html: string;
  score: number;
  descendant_count: number;
  depth: number;
  state: 'published' | 'deleted' | 'removed';
  removal_reason: string | null;
  created_at: unknown;
  edited_at: unknown;
  my_vote: number;
}

export const COMMENT_SELECT = `
  select c.id, c.post_id, c.parent_id, c.author_id,
         a.username as author_username, a.created_at as author_created_at,
         c.body_md, c.body_html, c.score, c.descendant_count, c.depth, c.state, c.removal_reason,
         c.created_at, c.edited_at, coalesce(v.value, 0) as my_vote
  from comments c
  join members a on a.id = c.author_id
  left join votes v on v.target_type = 'comment' and v.target_id = c.id and v.member_id = $1
`;

export interface CommentContext {
  isModerator: boolean;
}

/** The comment projection: exactly the published keys for the caller's role. */
export function commentProjection(
  row: CommentRow,
  viewer: Viewer,
  context: CommentContext,
  replies: Record<string, unknown>[],
): Record<string, unknown> {
  const isAuthor = viewer.member !== null && viewer.member.id === String(row.author_id);
  const privileged = isAuthor || context.isModerator;
  const withinWindow =
    now().getTime() - new Date(iso(row.created_at)).getTime() <= config.limits.commentEditWindowSeconds * 1000;

  const projection: Record<string, unknown> = {
    id: String(row.id),
    postId: String(row.post_id),
    parentId: row.parent_id === null ? null : String(row.parent_id),
    author: publicUser(row.author_username, row.author_created_at),
    bodyHtml: row.body_html,
    score: Number(row.score),
    myVote: viewer.member ? Number(row.my_vote) : 0,
    depth: Number(row.depth),
    descendantCount: Number(row.descendant_count),
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    state: row.state,
    canEdit: isAuthor && row.state === 'published' && withinWindow,
    replies,
  };

  if (row.state === 'deleted') {
    projection.bodyHtml = null;
    projection.author = null;
  } else if (row.state === 'removed' && !privileged) {
    projection.bodyHtml = null;
    projection.author = null;
  }

  if (isAuthor) projection.bodyMd = row.state === 'deleted' ? null : row.body_md;
  return projection;
}

interface TreeNode {
  row: CommentRow;
  children: TreeNode[];
}

function sortNodes(nodes: TreeNode[], sort: CommentSort): void {
  nodes.sort((left, right) => {
    if (sort === 'top' && Number(left.row.score) !== Number(right.row.score)) {
      return Number(right.row.score) - Number(left.row.score);
    }
    if (sort === 'new') {
      const difference = new Date(iso(right.row.created_at)).getTime() - new Date(iso(left.row.created_at)).getTime();
      if (difference !== 0) return difference;
    }
    return Number(right.row.id) - Number(left.row.id);
  });
  for (const node of nodes) sortNodes(node.children, sort);
}

/** Placeholders stay only while they still carry a visible reply below them. */
function prune(nodes: TreeNode[]): TreeNode[] {
  const kept: TreeNode[] = [];
  for (const node of nodes) {
    node.children = prune(node.children);
    if (node.row.state === 'published' || node.children.length > 0) kept.push(node);
  }
  return kept;
}

async function loadCommentRows(postId: string, viewerId: string | null): Promise<CommentRow[]> {
  return many<CommentRow>(db, `${COMMENT_SELECT} where c.post_id = $2`, [viewerId, postId]);
}

function buildTree(rows: CommentRow[], sort: CommentSort): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const row of rows) nodes.set(String(row.id), { row, children: [] });
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.row.parent_id === null ? null : String(node.row.parent_id);
    const parent = parentId === null ? null : nodes.get(parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const pruned = prune(roots);
  sortNodes(pruned, sort);
  return pruned;
}

export interface CommentTree {
  tree: Record<string, unknown>[];
  more: string[];
}

function project(
  nodes: TreeNode[],
  viewer: Viewer,
  context: CommentContext,
  levelsLeft: number,
  more: string[],
): Record<string, unknown>[] {
  return nodes.map((node) => {
    if (levelsLeft <= 1) {
      if (node.children.length > 0) more.push(String(node.row.id));
      return commentProjection(node.row, viewer, context, []);
    }
    return commentProjection(node.row, viewer, context, project(node.children, viewer, context, levelsLeft - 1, more));
  });
}

export async function commentTree(
  postId: string,
  viewer: Viewer,
  context: CommentContext,
  sort: CommentSort,
  depth: number,
): Promise<CommentTree> {
  const rows = await loadCommentRows(postId, viewer.member ? viewer.member.id : null);
  const roots = buildTree(rows, sort);
  const more: string[] = [];
  return { tree: project(roots, viewer, context, depth, more), more };
}

export async function commentSubtree(
  commentId: string,
  viewer: Viewer,
  context: CommentContext,
  sort: CommentSort,
  depth: number,
): Promise<{ postId: string; tree: CommentTree } | null> {
  const root = await one<{ post_id: string }>(db, 'select post_id from comments where id = $1', [commentId]);
  if (!root) return null;
  const rows = await loadCommentRows(String(root.post_id), viewer.member ? viewer.member.id : null);
  const roots = buildTree(rows, sort);
  const found = findNode(roots, commentId);
  const more: string[] = [];
  const tree = found ? project([found], viewer, context, depth, more) : [];
  return { postId: String(root.post_id), tree: { tree, more } };
}

function findNode(nodes: TreeNode[], commentId: string): TreeNode | null {
  for (const node of nodes) {
    if (String(node.row.id) === commentId) return node;
    const found = findNode(node.children, commentId);
    if (found) return found;
  }
  return null;
}

export async function loadCommentRow(
  source: Queryable,
  commentId: string,
  viewerId: string | null,
): Promise<CommentRow | null> {
  if (!/^\d+$/.test(commentId)) return null;
  return one<CommentRow>(source, `${COMMENT_SELECT} where c.id = $2`, [viewerId, commentId]);
}

export interface CreateCommentInput {
  postId: string;
  authorId: string;
  parentId: string | null;
  bodyMd: string;
}

export interface CreatedComment {
  commentId: string;
  commentCount: number;
}

/** A comment, the post's comment count and every ancestor's descendant count move together. */
export async function createComment(tx: Queryable, input: CreateCommentInput): Promise<CreatedComment> {
  const parent = input.parentId
    ? await one<{ id: string; depth: number; path: string[] }>(
        tx,
        'select id, depth, path from comments where id = $1 and post_id = $2',
        [input.parentId, input.postId],
      )
    : null;
  if (input.parentId && !parent) throw errors.notFound('That comment is not part of this post');

  const depth = parent ? Number(parent.depth) + 1 : 1;
  const path = parent ? [...parent.path.map(String), String(parent.id)] : [];

  const inserted = await one<{ id: string }>(
    tx,
    `insert into comments (post_id, parent_id, author_id, body_md, body_html, depth, path, state)
     values ($1, $2, $3, $4, $5, $6, $7::bigint[], 'published') returning id`,
    [input.postId, input.parentId, input.authorId, input.bodyMd, renderMarkdown(input.bodyMd), depth, path],
  );

  const post = await one<{ comment_count: number }>(
    tx,
    'update posts set comment_count = comment_count + 1 where id = $1 returning comment_count',
    [input.postId],
  );

  if (path.length > 0) {
    await tx.query('update comments set descendant_count = descendant_count + 1 where id = any($1::bigint[])', [path]);
  }

  return { commentId: String(inserted?.id), commentCount: Number(post?.comment_count ?? 0) };
}

export async function editComment(commentId: string, bodyMd: string): Promise<void> {
  await db.query('update comments set body_md = $2, body_html = $3, edited_at = now() where id = $1', [
    commentId,
    bodyMd,
    renderMarkdown(bodyMd),
  ]);
}

/** Deletion and removal both keep the thread shape and move the derived counters by one. */
export async function retireComment(
  commentId: string,
  state: 'deleted' | 'removed',
  removalReason: string | null,
  writeModLog: ((tx: Queryable) => Promise<void>) | null,
): Promise<{ commentCount: number }> {
  return transaction(async (tx) => {
    const row = await one<{ post_id: string; path: string[] }>(
      tx,
      'select post_id, path from comments where id = $1 for update',
      [commentId],
    );
    if (!row) throw errors.notFound('Comment not found');

    await tx.query('update comments set state = $2, removal_reason = $3 where id = $1', [
      commentId,
      state,
      removalReason,
    ]);

    const post = await one<{ comment_count: number }>(
      tx,
      'update posts set comment_count = comment_count - 1 where id = $1 returning comment_count',
      [row.post_id],
    );

    if (row.path.length > 0) {
      await tx.query('update comments set descendant_count = descendant_count - 1 where id = any($1::bigint[])', [
        row.path.map(String),
      ]);
    }

    if (writeModLog) await writeModLog(tx);

    return { commentCount: Number(post?.comment_count ?? 0) };
  });
}

