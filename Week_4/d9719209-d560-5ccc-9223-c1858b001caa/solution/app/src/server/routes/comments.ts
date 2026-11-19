import type pg from 'pg';
import { pool, one, rows, tx } from '../db.js';
import { config } from '../config.js';
import { now } from '../clock.js';
import { AppError, conflict, forbidden, notFound, validation } from '../errors.js';
import { ok, route, type Ctx, type Reply } from '../http.js';
import { optionalUser, requireModerator, requireUser, requireVerified } from '../guards.js';
import { communityRef } from '../community.js';
import { commentView, contextOf, loadCommentRows, threadFacts, type ThreadFacts } from '../views.js';
import { insertComment, retireComment } from '../writes.js';
import { once, type Stored } from '../idempotency.js';
import { logAction } from '../modlog.js';
import { renderMarkdown } from '../markdown.js';
import { parseRemoval } from '../postMoves.js';
import { emitComment, emitComments } from '../events.js';
import { takePostingSlot } from './posts.js';
import { COPY, asRecord, asString, failIfAny, isWithin, parseId, type Fields } from '../validate.js';
import type { SessionUser } from '../accounts.js';
import type { CommentSort, CommentView } from '../../shared/types.js';

const MAX_DEPTH = 8;

function idParam(ctx: Ctx, what: string): string {
  const id = parseId(ctx.params.id as string);
  if (id === null) throw notFound(`No such ${what}`);
  return id;
}

function parseSort(raw: string | null): CommentSort {
  if (raw === null || raw === 'top') return 'top';
  if (raw === 'new') return 'new';
  throw validation({ sort: COPY.sort });
}

function parseDepth(raw: string | null): number {
  if (raw === null) return MAX_DEPTH;
  const depth = Number(raw);
  if (!/^\d+$/.test(raw) || depth < 1 || depth > MAX_DEPTH) throw validation({ depth: COPY.depth });
  return depth;
}

type Row = Awaited<ReturnType<typeof loadCommentRows>>[number];

const byOrder = (sort: CommentSort) => (a: CommentView, b: CommentView): number => {
  const primary = sort === 'top' ? b.score - a.score : Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return primary || Number(BigInt(b.id) - BigInt(a.id));
};

/** Nests the rows into a tree no deeper than `lastDepth`; `more` lists cut-level comments with replies left out. */
function nest(found: Row[], facts: ThreadFacts, viewer: SessionUser | null, sort: CommentSort, lastDepth: number, rootIds: Set<string>) {
  const views = new Map(found.map((row) => [row.id, commentView(row, contextOf(facts, viewer))]));
  const tree: CommentView[] = [];
  for (const view of views.values()) {
    const parent = view.parentId ? views.get(view.parentId) : undefined;
    if (rootIds.has(view.id) || !parent) tree.push(view);
    else parent.replies.push(view);
  }
  const more: string[] = [];
  const order = byOrder(sort);
  const visit = (nodes: CommentView[]): void => {
    nodes.sort(order);
    for (const node of nodes) {
      if (node.depth >= lastDepth && node.descendantCount > 0) more.push(node.id);
      visit(node.replies);
    }
  };
  visit(tree);
  return { tree, more };
}

async function postTree(ctx: Ctx): Promise<Reply> {
  const viewer = optionalUser(ctx);
  const id = idParam(ctx, 'post');
  const sort = parseSort(ctx.query.get('sort'));
  const depth = parseDepth(ctx.query.get('depth'));
  const facts = await threadFacts(pool, viewer, id);
  if (!facts) throw notFound('No such post');
  const found = await loadCommentRows(pool, viewer, "cm.post_id = $2 AND cm.depth <= $3 AND (cm.state = 'published' OR cm.descendant_count > 0)", [id, depth]);
  return ok(nest(found, facts, viewer, sort, depth, new Set()));
}

async function subtree(ctx: Ctx): Promise<Reply> {
  const viewer = optionalUser(ctx);
  const id = idParam(ctx, 'comment');
  const sort = parseSort(ctx.query.get('sort'));
  const depth = parseDepth(ctx.query.get('depth'));
  const root = await one<{ post_id: string; depth: number; path: string }>(pool, 'SELECT post_id, depth, path FROM comments WHERE id = $1', [id]);
  if (!root) throw notFound('No such comment');
  const facts = (await threadFacts(pool, viewer, root.post_id)) as ThreadFacts;
  const lastDepth = root.depth + depth - 1;
  const found = await loadCommentRows(pool, viewer,
    "starts_with(cm.path, $2) AND cm.depth <= $3 AND (cm.id = $4 OR cm.state = 'published' OR cm.descendant_count > 0)", [root.path, lastDepth, id]);
  return ok(nest(found, facts, viewer, sort, lastDepth, new Set([id])));
}

async function viewOf(db: pg.PoolClient | typeof pool, viewer: SessionUser | null, id: string, facts: ThreadFacts, asModerator = false): Promise<CommentView> {
  const row = (await loadCommentRows(db, viewer, 'cm.id = $2', [id]))[0] as Row;
  return commentView(row, { ...contextOf(facts, viewer), viewerIsModerator: asModerator || facts.viewerIsModerator });
}

async function makeComment(ctx: Ctx, user: SessionUser, client: pg.PoolClient, keyFields: Fields): Promise<Stored> {
  const postIdValue = idParam(ctx, 'post');
  const facts = await threadFacts(client, user, postIdValue);
  if (!facts) throw notFound('No such post');
  const input = asRecord(ctx.body);
  const parentId = input.parentId === null || input.parentId === undefined ? null : String(input.parentId);
  let parentState: string | null = null;
  if (parentId !== null) {
    const parent = parseId(parentId) === null ? null
      : await one<{ state: string }>(client, 'SELECT state FROM comments WHERE id = $1 AND post_id = $2', [parentId, postIdValue]);
    if (!parent) throw notFound('No such comment in this post');
    parentState = parent.state;
  }
  requireVerified(user);
  await takePostingSlot(user);
  if (facts.state === 'removed') throw new AppError('REMOVED', 'This post was removed by moderators');
  if (facts.state === 'deleted') throw conflict('This post was deleted');
  if (facts.archived) throw new AppError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');
  if (facts.locked) throw new AppError('LOCKED', 'Locked by moderators');
  if (parentState !== null && parentState !== 'published') throw conflict('You cannot reply to a removed or deleted comment');
  const fields: Fields = { ...keyFields };
  const bodyMd = asString(input.bodyMd)?.trim() ?? '';
  if (!isWithin(bodyMd, 1, 10_000)) fields.bodyMd = COPY.comment;
  failIfAny(fields);
  const id = await insertComment(client, { postId: postIdValue, parentId, authorId: user.id, bodyMd, createdAt: now() });
  const counted = await one<{ comment_count: number }>(client, 'SELECT comment_count FROM posts WHERE id = $1', [postIdValue]);
  return { status: 201, body: { comment: await viewOf(client, user, id, facts), commentCount: counted?.comment_count } };
}

async function createComment(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const header = ctx.headers['idempotency-key'];
  const key = typeof header === 'string' && /^[\x21-\x7e]{1,100}$/.test(header) ? header : null;
  const keyFields: Fields = key === null
    ? { idempotencyKey: header === undefined ? COPY.idempotencyMissing : COPY.idempotencyFormat } : {};
  const outcome = await tx(async (client) => {
    const run = (): Promise<Stored> => makeComment(ctx, user, client, keyFields);
    return key === null ? { ...(await run()), replayed: false } : once(client, user.id, `POST ${ctx.path}`, key, ctx.body, run);
  });
  if (!outcome.replayed) {
    const made = (outcome.body as { comment: CommentView; commentCount: number });
    const postIdValue = idParam(ctx, 'post');
    const facts = (await threadFacts(pool, null, postIdValue)) as ThreadFacts;
    const community = (await one<{ name: string }>(pool, 'SELECT c.name FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1', [postIdValue]))?.name as string;
    await emitComment({ postId: postIdValue, parentId: made.comment.parentId, comment: await viewOf(pool, null, made.comment.id, facts) });
    await emitComments(community, { postId: postIdValue, commentCount: made.commentCount });
  }
  return { status: outcome.status, body: outcome.body };
}

interface CommentHead { author_id: string; post_id: string; state: string; created_at: Date; path: string }

async function commentHead(id: string): Promise<CommentHead> {
  const head = await one<CommentHead>(pool, 'SELECT author_id, post_id, state, created_at, path FROM comments WHERE id = $1', [id]);
  if (!head) throw notFound('No such comment');
  return head;
}

async function editComment(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const id = idParam(ctx, 'comment');
  const head = await commentHead(id);
  if (head.author_id !== user.id) throw forbidden('Only the author can edit this comment');
  const facts = (await threadFacts(pool, user, head.post_id)) as ThreadFacts;
  if (head.state !== 'published') throw conflict('This comment can no longer be edited');
  if (facts.archived) throw new AppError('ARCHIVED', 'This thread is archived. Voting and replies are closed.');
  if (facts.locked) throw new AppError('LOCKED', 'Locked by moderators');
  if (now().getTime() - head.created_at.getTime() >= config.limits.commentEditWindowSeconds * 1000) throw conflict('The edit window has closed');
  const bodyMd = asString(asRecord(ctx.body).bodyMd)?.trim() ?? '';
  if (!isWithin(bodyMd, 1, 10_000)) throw validation({ bodyMd: COPY.comment });
  await pool.query('UPDATE comments SET body_md = $2, body_html = $3, edited_at = $4 WHERE id = $1 AND state = \'published\'', [id, bodyMd, renderMarkdown(bodyMd), now()]);
  return ok(await viewOf(pool, user, id, facts));
}

async function communityNameOf(postId: string): Promise<string> {
  return (await one<{ name: string }>(pool, 'SELECT c.name FROM posts p JOIN communities c ON c.id = p.community_id WHERE p.id = $1', [postId]))?.name as string;
}

async function deleteComment(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const id = idParam(ctx, 'comment');
  const head = await commentHead(id);
  if (head.author_id !== user.id) throw forbidden('Only the author can delete this comment');
  const commentCount = await tx(async (client) => {
    const locked = await one<{ state: string }>(client, 'SELECT state FROM comments WHERE id = $1 FOR UPDATE', [id]);
    if (locked?.state !== 'published') throw conflict('This comment is already gone');
    return retireComment(client, { id, postId: head.post_id, path: head.path }, 'deleted', null);
  });
  await emitComments(await communityNameOf(head.post_id), { postId: head.post_id, commentCount });
  return ok({ commentCount });
}

async function removeComment(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const id = idParam(ctx, 'comment');
  const head = await commentHead(id);
  const community = await communityRef(pool, await communityNameOf(head.post_id));
  await requireModerator(pool, user, community);
  const commentCount = await tx(async (client) => {
    const locked = await one<{ state: string }>(client, 'SELECT state FROM comments WHERE id = $1 FOR UPDATE', [id]);
    if (locked?.state !== 'published') throw conflict('This comment is not published');
    const rules = await rows<{ id: string; title: string }>(client, 'SELECT id, title FROM rules WHERE community_id = $1', [community.id]);
    const removal = parseRemoval(ctx.body, rules);
    const count = await retireComment(client, { id, postId: head.post_id, path: head.path }, 'removed', removal.publicReason);
    await logAction(client, {
      communityId: community.id, action: 'remove_comment', target: { type: 'comment', id },
      publicReason: removal.publicReason, privateNote: removal.privateNote, moderatorId: user.id,
    });
    return count;
  });
  await emitComments(community.name, { postId: head.post_id, commentCount });
  const facts = (await threadFacts(pool, user, head.post_id)) as ThreadFacts;
  return ok(await viewOf(pool, user, id, facts, true));
}

export function registerCommentRoutes(): void {
  route('GET', '/api/posts/:id/comments', postTree);
  route('GET', '/api/comments/:id/thread', subtree);
  route('POST', '/api/posts/:id/comments', createComment);
  route('PATCH', '/api/comments/:id', editComment);
  route('DELETE', '/api/comments/:id', deleteComment);
  route('POST', '/api/comments/:id/removal', removeComment);
}
