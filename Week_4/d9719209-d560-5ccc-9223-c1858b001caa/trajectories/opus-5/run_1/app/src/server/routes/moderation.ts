import { db } from '../../core/db.js';
import { errors } from '../../core/errors.js';
import { commentProjection, loadCommentRow, retireComment } from '../../domain/comments.js';
import { loadCommunityById } from '../../domain/communities.js';
import { emitComments } from '../../domain/events.js';
import {
  mutatePost,
  parseRemovalInput,
  publicReasonFor,
  writeModLog,
  type PostMutation,
} from '../../domain/moderation.js';
import { loadPostRow, projectPost } from '../../domain/posts.js';
import { sendStatementOfReasons } from '../../services/mail.js';
import { communityOr404, requireModerator } from '../guards.js';
import { requireMember, route, sendJson, type Ctx, type Route } from '../http.js';

function parseVersion(ctx: Ctx): number {
  const value = ctx.body.version;
  const version = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(version)) {
    throw errors.validation('Send the version you saw', { version: 'Send the version you saw' });
  }
  return version;
}

async function postAndCommunity(ctx: Ctx) {
  const post = await loadPostRow(db, ctx.params.id, ctx.viewer.member ? ctx.viewer.member.id : null);
  if (!post) throw errors.notFound('Post not found');
  const community = await communityOr404(post.community_name);
  return { post, community };
}

async function runMutation(ctx: Ctx, build: (community: Awaited<ReturnType<typeof postAndCommunity>>['community']) => PostMutation) {
  const { post, community } = await postAndCommunity(ctx);
  const moderator = requireModerator(ctx, community);
  const version = parseVersion(ctx);
  const mutation = build(community);
  const outcome = await mutatePost(moderator, community, String(post.id), version, mutation, (source, id) =>
    loadPostRow(source, id, ctx.viewer.member ? ctx.viewer.member.id : null),
  );
  return { outcome, community, post };
}

export const moderationRoutes: Route[] = [
  route('POST', '/api/posts/:id/removal', async (ctx) => {
    const { post, community } = await postAndCommunity(ctx);
    const moderator = requireModerator(ctx, community);
    const version = parseVersion(ctx);
    const removal = parseRemovalInput(ctx.body, community);
    const publicReason = publicReasonFor(removal, community);
    const outcome = await mutatePost(
      moderator,
      community,
      String(post.id),
      version,
      { kind: 'remove', removal, publicReason },
      (source, id) => loadPostRow(source, id, ctx.viewer.member ? ctx.viewer.member.id : null),
    );

    const author = await db.query<{ email: string }>('select email from members where id = $1', [post.author_id]);
    const email = author.rows[0]?.email;
    if (email) {
      await sendStatementOfReasons({
        to: email,
        communityName: community.name,
        postTitle: post.title,
        publicReason,
        postUrl: `/c/${community.name}/post/${post.id}`,
      });
    }
    sendJson(ctx, 200, await projectPost(outcome.post, ctx.viewer));
  }),

  route('DELETE', '/api/posts/:id/removal', async (ctx) => {
    const { outcome } = await runMutation(ctx, () => ({ kind: 'restore' }));
    sendJson(ctx, 200, await projectPost(outcome.post, ctx.viewer));
  }),

  route('POST', '/api/posts/:id/lock', async (ctx) => {
    const duration = ctx.body.duration;
    if (duration !== 'indefinite' && duration !== '1h' && duration !== '24h' && duration !== '7d') {
      throw errors.validation('Choose a lock duration', { duration: 'Choose a lock duration' });
    }
    const { outcome } = await runMutation(ctx, () => ({ kind: 'lock', duration }));
    sendJson(ctx, 200, await projectPost(outcome.post, ctx.viewer));
  }),

  route('DELETE', '/api/posts/:id/lock', async (ctx) => {
    const { outcome } = await runMutation(ctx, () => ({ kind: 'unlock' }));
    sendJson(ctx, 200, await projectPost(outcome.post, ctx.viewer));
  }),

  route('POST', '/api/posts/:id/pin', async (ctx) => {
    const replacePostId = typeof ctx.body.replacePostId === 'string' ? ctx.body.replacePostId : null;
    const { outcome } = await runMutation(ctx, () => ({ kind: 'pin', replacePostId }));
    sendJson(ctx, 200, await projectPost(outcome.post, ctx.viewer));
  }),

  route('DELETE', '/api/posts/:id/pin', async (ctx) => {
    const { outcome } = await runMutation(ctx, () => ({ kind: 'unpin' }));
    sendJson(ctx, 200, await projectPost(outcome.post, ctx.viewer));
  }),

  route('POST', '/api/comments/:id/removal', async (ctx) => {
    requireMember(ctx);
    const comment = await loadCommentRow(db, ctx.params.id, ctx.viewer.member ? ctx.viewer.member.id : null);
    if (!comment) throw errors.notFound('Comment not found');
    const post = await loadPostRow(db, String(comment.post_id), null);
    if (!post) throw errors.notFound('Post not found');
    const community = await loadCommunityById(db, String(post.community_id));
    if (!community) throw errors.notFound('Community not found');
    const moderator = requireModerator(ctx, community);
    if (comment.state !== 'published') throw errors.conflict('That comment cannot be removed');

    const removal = parseRemovalInput(ctx.body, community);
    const publicReason = publicReasonFor(removal, community);
    const result = await retireComment(String(comment.id), 'removed', publicReason, (tx) =>
      writeModLog(tx, {
        communityId: String(community.id),
        moderatorId: moderator.id,
        action: 'remove_comment',
        targetType: 'comment',
        targetId: String(comment.id),
        publicReason,
        privateNote: removal.privateNote,
      }),
    );
    await emitComments(String(post.id), result.commentCount, post.community_name);

    const updated = await loadCommentRow(db, ctx.params.id, ctx.viewer.member ? ctx.viewer.member.id : null);
    if (!updated) throw errors.notFound('Comment not found');
    sendJson(ctx, 200, commentProjection(updated, ctx.viewer, { isModerator: true }, []));
  }),
];
