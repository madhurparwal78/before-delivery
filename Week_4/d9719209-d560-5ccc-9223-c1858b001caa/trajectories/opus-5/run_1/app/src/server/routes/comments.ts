import { config } from '../../core/config.js';
import { db, transaction, type Queryable } from '../../core/db.js';
import { ApiError, errors } from '../../core/errors.js';
import { iso } from '../../core/time.js';
import {
  commentProjection,
  commentSubtree,
  commentTree,
  createComment,
  editComment,
  loadCommentRow,
  retireComment,
  type CommentRow,
} from '../../domain/comments.js';
import { emitComment, emitComments } from '../../domain/events.js';
import { withIdempotency } from '../../domain/idempotency.js';
import { isArchived, lockState, loadPostRow, type PostRow } from '../../domain/posts.js';
import { commentBodyFieldError, parseSort } from '../../domain/validation.js';
import { castVote, checkVoteRate, parseVoteValue } from '../../domain/votes.js';
import { moderates } from '../../domain/viewer.js';
import { copy } from '../../shared/copy.js';
import { checkPostingRate, idempotencyKey } from '../guards.js';
import { requireMember, route, sendJson, type Ctx, type Route } from '../http.js';
import { assertVotable } from './posts.js';

function parseDepth(raw: string | null): number {
  if (raw === null || raw === '') return 8;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    throw errors.validation('That depth is not valid', { depth: 'That depth is not valid' });
  }
  return value;
}

async function postForComment(ctx: Ctx, postId: string, source: Queryable = db): Promise<PostRow> {
  const row = await loadPostRow(source, postId, ctx.viewer.member ? ctx.viewer.member.id : null);
  if (!row) throw errors.notFound('Post not found');
  return row;
}

function moderatorContext(ctx: Ctx, post: PostRow): { isModerator: boolean } {
  return { isModerator: moderates(ctx.viewer, String(post.community_id)) };
}

/** New comments are refused on a locked, archived, removed or deleted thread. */
function assertCommentable(post: PostRow): void {
  if (post.state === 'deleted') throw errors.conflict('That post was deleted');
  if (post.state === 'removed') throw new ApiError('REMOVED', 'That post was removed by moderators');
  if (isArchived(post)) throw new ApiError('ARCHIVED', copy.fixed.archived);
  if (lockState(post).locked) throw new ApiError('LOCKED', copy.fixed.lockBanner);
}

interface CreatedComment {
  status: number;
  body: unknown;
  created: { commentId: string; commentCount: number };
}

export const commentRoutes: Route[] = [
  route(
    'GET',
    '/api/posts/:id/comments',
    async (ctx) => {
      const post = await postForComment(ctx, ctx.params.id);
      const sort = parseSort(ctx.url.searchParams.get('sort'), ['top', 'new'] as const, 'top');
      const depth = parseDepth(ctx.url.searchParams.get('depth'));
      const tree = await commentTree(String(post.id), ctx.viewer, moderatorContext(ctx, post), sort, depth);
      sendJson(ctx, 200, tree);
    },
    'none',
  ),

  route(
    'GET',
    '/api/comments/:id/thread',
    async (ctx) => {
      const sort = parseSort(ctx.url.searchParams.get('sort'), ['top', 'new'] as const, 'top');
      const depth = parseDepth(ctx.url.searchParams.get('depth'));
      const row = await loadCommentRow(db, ctx.params.id, null);
      if (!row) throw errors.notFound('Comment not found');
      const post = await postForComment(ctx, String(row.post_id));
      const subtree = await commentSubtree(ctx.params.id, ctx.viewer, moderatorContext(ctx, post), sort, depth);
      if (!subtree) throw errors.notFound('Comment not found');
      sendJson(ctx, 200, subtree.tree);
    },
    'none',
  ),

  route('POST', '/api/posts/:id/comments', async (ctx) => {
    const member = requireMember(ctx);
    const key = idempotencyKey(ctx);

    const create = async (tx: Queryable): Promise<CreatedComment> => {
      const post = await postForComment(ctx, ctx.params.id, tx);
      if (!member.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', copy.post.unverified);
      await checkPostingRate(member);
      assertCommentable(post);

      const parentId = typeof ctx.body.parentId === 'string' && ctx.body.parentId !== '' ? ctx.body.parentId : null;
      const bodyMd = typeof ctx.body.bodyMd === 'string' ? ctx.body.bodyMd.trim() : '';

      if (key === null) {
        throw errors.validation(copy.validation.idempotencyRequired, {
          idempotencyKey: copy.validation.idempotencyRequired,
        });
      }
      const bodyError = commentBodyFieldError(bodyMd);
      if (bodyError) throw errors.validation(bodyError, { bodyMd: bodyError });

      const created = await createComment(tx, {
        postId: String(post.id),
        authorId: member.id,
        parentId,
        bodyMd,
      });
      const row = await loadCommentRow(tx, created.commentId, member.id);
      if (!row) throw errors.notFound('Comment not found');
      const comment = commentProjection(row, ctx.viewer, { isModerator: false }, []);
      return {
        status: 201,
        body: { comment, commentCount: created.commentCount },
        created: { commentId: created.commentId, commentCount: created.commentCount },
      };
    };

    if (key === null) {
      await transaction(create);
      return;
    }

    const outcome = await withIdempotency(member.id, 'create-comment', key, ctx.body, create);
    if (!outcome.replayed && outcome.created) {
      const post = await postForComment(ctx, ctx.params.id);
      const row = await loadCommentRow(db, outcome.created.commentId, null);
      if (row) {
        await emitComment(String(post.id), row.parent_id === null ? null : String(row.parent_id), {
          ...commentProjection(row, { member: null, moderatorOf: new Set() }, { isModerator: false }, []),
        });
      }
      await emitComments(String(post.id), outcome.created.commentCount, post.community_name);
    }
    sendJson(ctx, outcome.status, outcome.body);
  }),

  route('PATCH', '/api/comments/:id', async (ctx) => {
    const member = requireMember(ctx);
    const row = await loadCommentRow(db, ctx.params.id, member.id);
    if (!row) throw errors.notFound('Comment not found');
    if (String(row.author_id) !== member.id) throw errors.forbidden('Only the author can edit this comment');
    const post = await postForComment(ctx, String(row.post_id));
    if (isArchived(post)) throw new ApiError('ARCHIVED', copy.fixed.archived);
    if (lockState(post).locked) throw new ApiError('LOCKED', copy.fixed.lockBanner);
    if (row.state !== 'published') throw errors.conflict('That comment cannot be edited');
    const withinWindow =
      Date.now() - new Date(iso(row.created_at)).getTime() <= config.limits.commentEditWindowSeconds * 1000;
    if (!withinWindow) throw errors.conflict(copy.comment.editWindowClosed);

    const bodyMd = typeof ctx.body.bodyMd === 'string' ? ctx.body.bodyMd.trim() : '';
    const bodyError = commentBodyFieldError(bodyMd);
    if (bodyError) throw errors.validation(bodyError, { bodyMd: bodyError });

    await editComment(String(row.id), bodyMd);
    const updated = await loadCommentRow(db, ctx.params.id, member.id);
    sendJson(ctx, 200, commentProjection(updated as CommentRow, ctx.viewer, moderatorContext(ctx, post), []));
  }),

  route('DELETE', '/api/comments/:id', async (ctx) => {
    const member = requireMember(ctx);
    const row = await loadCommentRow(db, ctx.params.id, member.id);
    if (!row) throw errors.notFound('Comment not found');
    if (String(row.author_id) !== member.id) throw errors.forbidden('Only the author can delete this comment');
    if (row.state !== 'published') throw errors.conflict('That comment cannot be deleted');
    const post = await postForComment(ctx, String(row.post_id));
    const result = await retireComment(String(row.id), 'deleted', null, null);
    await emitComments(String(post.id), result.commentCount, post.community_name);
    sendJson(ctx, 200, { commentCount: result.commentCount });
  }),

  route('PUT', '/api/comments/:id/vote', async (ctx) => {
    const member = requireMember(ctx);
    const row = await loadCommentRow(db, ctx.params.id, member.id);
    if (!row) throw errors.notFound('Comment not found');
    const post = await postForComment(ctx, String(row.post_id));
    if (!member.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', copy.vote.unverified);
    await checkVoteRate(member);
    assertVotable(post);
    const value = parseVoteValue(ctx.body.value);
    sendJson(
      ctx,
      200,
      await castVote(
        member,
        {
          targetType: 'comment',
          targetId: String(row.id),
          postId: String(post.id),
          communityName: post.community_name,
        },
        value,
      ),
    );
  }),
];
