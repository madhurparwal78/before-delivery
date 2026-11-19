/* Comment endpoints: the tree with sorts and depth, replies with idempotency,
   edits inside the window, deletion, and votes. */
import crypto from 'node:crypto';
import { ApiError, validation } from '../errors.js';
import { route, type Route, type RouteHandler, type Services } from '../routes.js';
import type { Ctx } from '../context.js';
import { renderMarkdown } from '../markdown.js';
import { commentView, publishComments, publishScore, isLocked, type CommentRow, type PostRow } from '../views.js';
import { isArchived } from './posts.js';
import { memberRole } from '../communities.js';
import { iso } from '../util.js';

export function registerCommentRoutes(services: Services, add: (r: Route) => void): void {
  add(route('GET', '/api/posts/:id/comments', commentTree(services), 'none'));
  add(route('GET', '/api/comments/:id/thread', commentThread(services), 'none'));
  add(route('POST', '/api/posts/:id/comments', createComment(services)));
  add(route('PATCH', '/api/comments/:id', editComment(services)));
  add(route('DELETE', '/api/comments/:id', deleteComment(services)));
  add(route('PUT', '/api/comments/:id/vote', voteComment(services)));
}

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function loadPost(services: Services, id: number): Promise<PostRow> {
  const rows = await services.db.query(
    `SELECT p.*, c.name AS community_name FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1`,
    [id]
  );
  if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
  return rows.rows[0] as unknown as PostRow;
}

async function loadComment(services: Services, id: number): Promise<CommentRow> {
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('NOT_FOUND', 'Not found');
  const rows = await services.db.query(`SELECT * FROM comments WHERE id = $1`, [id]);
  if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
  return rows.rows[0] as unknown as CommentRow;
}

function parseCommentSort(raw: string | null): 'top' | 'new' {
  if (raw === null || raw === '') return 'top';
  if (raw === 'top' || raw === 'new') return raw;
  throw validation({ sort: 'This sort is not valid' });
}

function parseDepth(raw: string | null): number {
  if (raw === null || raw === '') return 8;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 8) throw validation({ depth: 'Depth must be between 1 and 8' });
  return n;
}

/* The tree: nested replies to the requested depth, with `more` listing
   comments at the cut level that have replies not included. */
async function buildTree(services: Services, ctx: Ctx, postId: number, sort: 'top' | 'new', depth: number, rootCommentId: number | null, rootDepth: number): Promise<{ status: number; body: unknown }> {
  const post = await loadPost(services, postId);
  const communityId = Number(post.community_id);
  const orderBy = sort === 'top' ? 'score DESC, id DESC' : 'created_at DESC, id DESC';
  const rows = await services.db.query(
    `SELECT * FROM comments WHERE post_id = $1 ORDER BY ${orderBy}`,
    [postId]
  );
  const all = rows.rows as unknown as CommentRow[];
  const byId = new Map<number, CommentRow>();
  for (const c of all) byId.set(Number(c.id), c);

  // Visible comments: the root itself, its ancestors and everything within depth.
  const visible = new Set<number>();
  if (rootCommentId !== null) {
    const root = byId.get(rootCommentId);
    if (root === undefined) throw new ApiError('NOT_FOUND', 'Not found');
    visible.add(rootCommentId);
    for (const part of root.path.split('.').map(Number)) visible.add(part);
  }
  for (const c of all) {
    const relativeDepth = c.depth - rootDepth;
    if (rootCommentId === null) {
      if (c.depth <= depth) visible.add(Number(c.id));
    } else if (Number(c.id) === rootCommentId || (relativeDepth <= depth && isDescendantOf(c, rootCommentId, byId))) {
      visible.add(Number(c.id));
    }
  }
  // Prune: a comment whose parent is not visible is not visible.
  const reachable = new Set<number>();
  const visitRoots = rootCommentId === null ? all.filter((c) => c.parent_id === null).map((c) => Number(c.id)) : [rootCommentId];
  const queue = [...visitRoots];
  while (queue.length > 0) {
    const id = queue.pop() as number;
    if (reachable.has(id) || !visible.has(id)) continue;
    reachable.add(id);
    for (const c of all) {
      if (c.parent_id !== null && Number(c.parent_id) === id) queue.push(Number(c.id));
    }
  }
  const more: number[] = [];
  for (const c of all) {
    if (!visible.has(Number(c.id))) continue;
    // A comment at the cut level whose replies fall outside the depth gets a
    // continue link.
    const kids = all.filter((k) => k.parent_id !== null && Number(k.parent_id) === Number(c.id));
    if (kids.length === 0) continue;
    const relative = rootCommentId === null ? c.depth : c.depth - rootDepth;
    const included = relative < depth && reachable.has(Number(c.id));
    if (!included && relative >= depth) more.push(Number(c.id));
  }
  const childrenOf = new Map<number, CommentRow[]>();
  for (const c of all) {
    if (c.parent_id === null) continue;
    const list = childrenOf.get(Number(c.parent_id)) ?? [];
    list.push(c);
    childrenOf.set(Number(c.parent_id), list);
  }
  const views = new Map<number, Record<string, unknown>>();
  for (const c of all) {
    if (!reachable.has(Number(c.id))) continue;
    const view = await commentView(services, c, ctx.account, communityId, false);
    view.replies = [];
    views.set(Number(c.id), view);
  }
  for (const c of all) {
    if (!reachable.has(Number(c.id))) continue;
    const view = views.get(Number(c.id));
    if (view === undefined) continue;
    const kids = (childrenOf.get(Number(c.id)) ?? []).filter((k) => reachable.has(Number(k.id)));
    view.replies = kids.map((k) => views.get(Number(k.id))).filter((v): v is Record<string, unknown> => v !== undefined);
  }
  const topLevel = rootCommentId === null
    ? all.filter((c) => c.parent_id === null && reachable.has(Number(c.id)))
    : [byId.get(rootCommentId)].filter((c): c is CommentRow => c !== undefined && reachable.has(Number(c.id)));
  const tree = topLevel.map((c) => views.get(Number(c.id))).filter((v): v is Record<string, unknown> => v !== undefined);
  const sortedMore = [...new Set(more)];
  return { status: 200, body: { tree, more: sortedMore } };
}

function isDescendantOf(c: CommentRow, ancestorId: number, byId: Map<number, CommentRow>): boolean {
  let cur: CommentRow | undefined = c;
  while (cur !== undefined && cur.parent_id !== null) {
    if (Number(cur.parent_id) === ancestorId) return true;
    cur = byId.get(Number(cur.parent_id));
  }
  return false;
}


function commentTree(services: Services): RouteHandler {
  return async (ctx) => {
    const postId = Number(ctx.params.id);
    if (!Number.isInteger(postId)) throw new ApiError('NOT_FOUND', 'Not found');
    const sort = parseCommentSort(ctx.url.searchParams.get('sort'));
    const depth = parseDepth(ctx.url.searchParams.get('depth'));
    return buildTree(services, ctx, postId, sort, depth, null, 0);
  };
}

function commentThread(services: Services): RouteHandler {
  return async (ctx) => {
    const commentId = Number(ctx.params.id);
    const comment = await loadComment(services, commentId);
    const sort = parseCommentSort(ctx.url.searchParams.get('sort'));
    const depth = parseDepth(ctx.url.searchParams.get('depth'));
    return buildTree(services, ctx, Number(comment.post_id), sort, depth, commentId, comment.depth - 1);
  };
}

function createComment(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const account = ctx.account;
    if (!account.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', 'Verify your email to reply');
    const post = await loadPost(services, Number(ctx.params.id));
    if (post.state === 'deleted') throw new ApiError('CONFLICT', 'Deleted posts cannot be replied to');
    if (post.state === 'removed') throw new ApiError('REMOVED', 'Removed posts cannot be replied to');
    if (isArchived(services, post)) throw new ApiError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');
    if (isLocked(post)) throw new ApiError('LOCKED', 'Locked by moderators');
    const b = body(ctx);
    const bodyMd = str(b.bodyMd).trim();
    const parentIdRaw = b.parentId;
    if (bodyMd.length < 1 || bodyMd.length > 10_000) throw validation({ bodyMd: 'Comments are 1 to 10,000 characters' });

    let parent: CommentRow | null = null;
    if (parentIdRaw !== null && parentIdRaw !== undefined) {
      const parentId = Number(parentIdRaw);
      const rows = await services.db.query(`SELECT * FROM comments WHERE id = $1 AND post_id = $2`, [parentId, Number(post.id)]);
      if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Parent not in this post');
      parent = rows.rows[0] as unknown as CommentRow;
    }

    // Posting rate limit in Valkey; skipped when Valkey is unreachable.
    if (services.valkey.isUp) {
      try {
        const r = await services.valkey.consumeSlot(`rl:post:${account.id}`, services.cfg.limits.postRate, 60_000);
        if (!r.ok) throw new ApiError('RATE_LIMITED', 'Slow down', { retryAfter: r.retryAfter });
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }

    const key = typeof ctx.req.headers['idempotency-key'] === 'string' ? (ctx.req.headers['idempotency-key'] as string) : null;
    if (key === null) throw validation({ idempotencyKey: 'Idempotency-Key header is required' });
    const fingerprint = crypto.createHash('sha256').update(ctx.rawBody ?? '').digest('hex');
    const existing = await services.db.query(
      `SELECT status, response, fingerprint FROM idempotency WHERE account_id = $1 AND endpoint = 'create-comment' AND key = $2`,
      [account.id, key]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as { status: number; response: string; fingerprint: string };
      if (row.fingerprint !== fingerprint) throw validation({ idempotencyKey: 'This key was already used for a different request' });
      return { status: row.status, body: JSON.parse(row.response) as unknown };
    }
    await services.db.query(
      `INSERT INTO idempotency (key, account_id, endpoint, fingerprint, status, response) VALUES ($1,$2,'create-comment',$3,0,'')
       ON CONFLICT (account_id, endpoint, key) DO NOTHING`,
      [key, account.id, fingerprint]
    );

    const bodyHtml = renderMarkdown(bodyMd);
    const depth = parent === null ? 1 : parent.depth + 1;
    const path = parent === null ? '' : parent.path;
    await services.db.query(`BEGIN`);
    try {
      const inserted = await services.db.query(
        `INSERT INTO comments (post_id, parent_id, author_id, path, depth, body_md, body_html) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [Number(post.id), parent === null ? null : Number(parent.id), account.id, path, depth, bodyMd, bodyHtml]
      );
      const comment = inserted.rows[0] as unknown as CommentRow;
      // The new comment's path includes itself; every ancestor's descendant
      // count and the post's comment count move in the same transaction.
      const newPath = path === '' ? String(comment.id) : `${path}.${comment.id}`;
      await services.db.query(`UPDATE comments SET path = $2 WHERE id = $1`, [Number(comment.id), newPath]);
      const ancestorIds = path === '' ? [] : path.split('.').map(Number);
      for (const anc of ancestorIds) {
        await services.db.query(`UPDATE comments SET descendant_count = descendant_count + 1 WHERE id = $1`, [anc]);
      }
      await services.db.query(`UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`, [Number(post.id)]);
      await services.db.query(`COMMIT`);
      const fresh = await loadComment(services, Number(comment.id));
      const view = await commentView(services, fresh, account, Number(post.community_id), true);
      (view as { replies: unknown[] }).replies = [];
      const postFresh = await loadPost(services, Number(post.id));
      const responseBody = { comment: view, commentCount: postFresh.comment_count };
      await services.db.query(
        `UPDATE idempotency SET status = 201, response = $3 WHERE account_id = $1 AND endpoint = 'create-comment' AND key = $2`,
        [account.id, key, JSON.stringify(responseBody)]
      );
      // Live events: the comment, then the count.
      const publicView = await commentView(services, fresh, null, Number(post.community_id), true);
      (publicView as { replies: unknown[] }).replies = [];
      await services.valkey.publish({
        topics: [`post:${Number(post.id)}`, `community:${post.community_name.toLowerCase()}`, 'home'],
        event: 'comment',
        data: { postId: Number(post.id), parentId: parent === null ? null : Number(parent.id), comment: publicView },
      });
      await publishComments(services, Number(post.id), post.community_name, postFresh.comment_count);
      return { status: 201, body: responseBody };
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
  };
}

function editComment(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const comment = await loadComment(services, Number(ctx.params.id));
    const post = await loadPost(services, Number(comment.post_id));
    if (comment.author_id === null || Number(comment.author_id) !== ctx.account.id) {
      throw new ApiError('FORBIDDEN', 'Only the author can edit');
    }
    if (comment.state !== 'published') throw new ApiError('CONFLICT', 'Only published comments can be edited');
    if (isLocked(post)) throw new ApiError('LOCKED', 'Locked by moderators');
    if (isArchived(services, post)) throw new ApiError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');
    const within = Date.now() - new Date(comment.created_at).getTime() <= services.cfg.limits.commentEditWindow * 1000;
    if (!within) throw new ApiError('CONFLICT', 'The edit window has closed');
    const bodyMd = str(body(ctx).bodyMd).trim();
    if (bodyMd.length < 1 || bodyMd.length > 10_000) throw validation({ bodyMd: 'Comments are 1 to 10,000 characters' });
    await services.db.query(`UPDATE comments SET body_md = $2, body_html = $3, edited_at = now() WHERE id = $1`, [
      Number(comment.id),
      bodyMd,
      renderMarkdown(bodyMd),
    ]);
    const fresh = await loadComment(services, Number(comment.id));
    return { status: 200, body: await commentView(services, fresh, ctx.account, Number(post.community_id), false) };
  };
}

function deleteComment(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const comment = await loadComment(services, Number(ctx.params.id));
    const post = await loadPost(services, Number(comment.post_id));
    if (comment.author_id === null || Number(comment.author_id) !== ctx.account.id) {
      throw new ApiError('FORBIDDEN', 'Only the author can delete');
    }
    if (comment.state !== 'published') throw new ApiError('CONFLICT', 'Only published comments can be deleted');
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`UPDATE comments SET state = 'deleted' WHERE id = $1`, [Number(comment.id)]);
      await services.db.query(`UPDATE posts SET comment_count = comment_count - 1 WHERE id = $1`, [Number(comment.post_id)]);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    const fresh = await loadPost(services, Number(comment.post_id));
    await publishComments(services, Number(comment.post_id), post.community_name, fresh.comment_count);
    return { status: 200, body: { commentCount: fresh.comment_count } };
  };
}

function voteComment(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
    const account = ctx.account;
    if (!account.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', 'Verify your email to vote');
    const comment = await loadComment(services, Number(ctx.params.id));
    const post = await loadPost(services, Number(comment.post_id));
    if (post.state === 'removed') throw new ApiError('REMOVED', 'Removed posts cannot be voted');
    if (post.state === 'deleted') throw new ApiError('CONFLICT', 'Deleted posts cannot be voted');
    if (comment.state === 'deleted' || comment.state === 'removed') throw new ApiError('CONFLICT', 'This comment cannot be voted');
    if (isArchived(services, post)) throw new ApiError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');
    const value = body(ctx).value;
    if (value !== 1 && value !== 0 && value !== -1) throw validation({ value: 'Value must be 1, 0 or -1' });
    let limit: { ok: boolean; retryAfter: number };
    try {
      limit = await services.valkey.consumeSlot(`rl:vote:${account.id}`, services.cfg.limits.voteRate, 60_000);
    } catch {
      throw new ApiError('SERVICE_UNAVAILABLE', "Vote didn't save");
    }
    if (!limit.ok) throw new ApiError('RATE_LIMITED', 'Slow down — try again later', { retryAfter: limit.retryAfter });
    const { applyVote } = await import('./posts.js');
    const result = await applyVote(services, 'comment', Number(comment.id), account.id, value as number);
    await publishScore(services, 'comment', Number(comment.id), post.community_name, result.score);
    return { status: 200, body: { score: result.score, myVote: result.myVote } };
  };
}
