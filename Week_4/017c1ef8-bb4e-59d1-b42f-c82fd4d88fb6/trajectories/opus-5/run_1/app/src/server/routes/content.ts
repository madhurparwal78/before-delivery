import { decodeCursor, feedNewerThan, feedPage } from '../../domain/feed';
import { blockedWith } from '../../domain/graph';
import { memberById, personCard } from '../../domain/members';
import {
  notify,
  removeNotificationActor,
  removeNotificationsForSubject,
} from '../../domain/notifications';
import {
  commentById,
  commentTree,
  POST_COLUMNS,
  postById,
  postObject,
  postVisibleTo,
  reactionSummary,
  saveHashtags,
  saveMentions,
  type PostRow,
} from '../../domain/posts';
import { businessNow } from '../clock';
import { COMMENT_MAX_CHARS, config, WEEK_SECONDS } from '../config';
import { query } from '../db';
import { conflict, forbidden, notFound, validation } from '../errors';
import { newId } from '../ids';
import { jsonBody, requireMember, withIdempotency, type Ctx } from '../http';
import { pushToAll } from '../live';
import { REACTION_TYPES, withCommas, type ReactionType } from '../../shared/format';
import { hashtagsOf } from '../../shared/richtext';

async function visiblePost(viewerId: string, postId: string): Promise<PostRow> {
  const post = await postById(postId);
  if (!post || !(await postVisibleTo(viewerId, post))) throw notFound();
  return post;
}

function pushPost(postId: string): void {
  pushToAll('post', { post_id: postId });
}

function pushFeed(authorId: string, postId: string): void {
  pushToAll('feed', { author_id: authorId, post_id: postId });
}

async function notifyMentions(
  postId: string,
  authorId: string,
  mentionedIds: string[],
  alreadyNotified: Set<string>,
): Promise<void> {
  for (const memberId of mentionedIds) {
    if (alreadyNotified.has(memberId)) continue;
    await notify({
      memberId,
      actorId: authorId,
      kind: 'mention',
      subjectId: postId,
      targetUrl: `/posts/${postId}`,
    });
  }
}

export async function createPost(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  return withIdempotency(ctx, memberId, 'POST /api/posts', async () => {
    const body = jsonBody(ctx);
    const text = String(body.text ?? '');
    const photoId = body.photo_id === undefined || body.photo_id === null ? null : String(body.photo_id);
    const sharedPostId =
      body.shared_post_id === undefined || body.shared_post_id === null
        ? null
        : String(body.shared_post_id);

    if (photoId) {
      const rows = await query<{ id: string }>(
        'SELECT id FROM photo_uploads WHERE id = $1 AND member_id = $2',
        [photoId, memberId],
      );
      if (rows.length === 0) throw notFound();
    }
    if (sharedPostId) await visiblePost(memberId, sharedPostId);

    if (text.trim() === '') throw validation({ text: 'Write something first.' });
    if ([...text].length > config.postMaxChars) {
      throw validation({ text: `Posts can be up to ${withCommas(config.postMaxChars)} characters.` });
    }

    const id = newId('pst');
    const now = businessNow();
    await query(
      `INSERT INTO posts (id, author_id, text, created_at, photo_id, shared_post_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, memberId, text, now, photoId, sharedPostId],
    );
    const mentioned = await saveMentions('post', id, memberId, text);
    await saveHashtags(id, text);

    const notified = new Set<string>();
    if (sharedPostId) {
      const original = await postById(sharedPostId);
      if (original) {
        await notify({
          memberId: original.author_id,
          actorId: memberId,
          kind: 'repost',
          subjectId: sharedPostId,
          targetUrl: `/posts/${id}`,
        });
        notified.add(original.author_id);
      }
    }
    await notifyMentions(id, memberId, mentioned, notified);

    const post = await postById(id);
    if (!post) throw notFound();
    pushFeed(memberId, id);
    return { status: 201, body: await postObject(memberId, post) };
  });
}

export async function getPost(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const post = await visiblePost(memberId, ctx.params.id);
  return { status: 200, body: await postObject(memberId, post) };
}

export async function patchPost(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const post = await visiblePost(memberId, ctx.params.id);
  if (post.author_id !== memberId) throw forbidden('not_author');
  const closesAt = post.created_at.getTime() + config.editWindowSeconds * 1000;
  if (businessNow().getTime() >= closesAt) throw conflict('edit_window_closed');

  const body = jsonBody(ctx);
  const text = String(body.text ?? '');
  if (text.trim() === '') throw validation({ text: 'Write something first.' });
  if ([...text].length > config.postMaxChars) {
    throw validation({ text: `Posts can be up to ${withCommas(config.postMaxChars)} characters.` });
  }
  const previous = await query<{ member_id: string }>(
    `SELECT member_id FROM mentions WHERE owner_kind = 'post' AND owner_id = $1`,
    [post.id],
  );
  await query('UPDATE posts SET text = $2, edited_at = $3 WHERE id = $1', [
    post.id,
    text,
    businessNow(),
  ]);
  const mentioned = await saveMentions('post', post.id, memberId, text);
  await saveHashtags(post.id, text);
  const old = new Set(previous.map((row) => row.member_id));
  await notifyMentions(post.id, memberId, mentioned, old);
  const updated = await postById(post.id);
  if (!updated) throw notFound();
  pushPost(post.id);
  return { status: 200, body: await postObject(memberId, updated) };
}

export async function deletePost(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const post = await visiblePost(memberId, ctx.params.id);
  if (post.author_id !== memberId) throw forbidden('not_author');
  await query('UPDATE posts SET deleted_at = $2 WHERE id = $1', [post.id, businessNow()]);
  await query('DELETE FROM reposts WHERE post_id = $1', [post.id]);
  await removeNotificationsForSubject(post.id);
  pushPost(post.id);
  pushToAll('post_deleted', { post_id: post.id });
  return { status: 204, body: null };
}

export async function putReaction(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const post = await visiblePost(memberId, ctx.params.id);
  const body = jsonBody(ctx);
  const type = String(body.type ?? '');
  if (!REACTION_TYPES.includes(type as ReactionType)) {
    throw validation({ type: 'Choose a reaction type.' });
  }
  await query(
    `INSERT INTO reactions (post_id, member_id, type, created_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (post_id, member_id) DO UPDATE SET type = EXCLUDED.type, created_at = EXCLUDED.created_at`,
    [post.id, memberId, type, businessNow()],
  );
  await notify({
    memberId: post.author_id,
    actorId: memberId,
    kind: 'reaction',
    subjectId: post.id,
    targetUrl: `/posts/${post.id}`,
  });
  pushPost(post.id);
  return { status: 200, body: { reactions: await reactionSummary(memberId, post.id) } };
}

export async function deleteReaction(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const post = await visiblePost(memberId, ctx.params.id);
  await query('DELETE FROM reactions WHERE post_id = $1 AND member_id = $2', [post.id, memberId]);
  await removeNotificationActor(post.author_id, 'reaction', post.id, memberId);
  pushPost(post.id);
  return { status: 200, body: { reactions: await reactionSummary(memberId, post.id) } };
}

export async function getReactions(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const post = await visiblePost(memberId, ctx.params.id);
  const excluded = await blockedWith(memberId);
  const rows = await query<{ member_id: string; type: string; created_at: Date }>(
    'SELECT member_id, type, created_at FROM reactions WHERE post_id = $1 ORDER BY created_at DESC',
    [post.id],
  );
  const reactors: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (excluded.has(row.member_id)) continue;
    const member = await memberById(row.member_id);
    if (!member) continue;
    reactors.push({
      member: await personCard(memberId, member),
      type: row.type,
      at: row.created_at.toISOString(),
    });
  }
  return { status: 200, body: { reactors } };
}

export async function getComments(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const post = await visiblePost(memberId, ctx.params.id);
  return { status: 200, body: { comments: await commentTree(memberId, post.id) } };
}

export async function createComment(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const postId = ctx.params.id;
  return withIdempotency(ctx, memberId, 'POST /api/posts/:id/comments', async () => {
    const post = await visiblePost(memberId, postId);
    const body = jsonBody(ctx);
    const text = String(body.text ?? '');
    const parentIdRaw =
      body.parent_id === undefined || body.parent_id === null ? null : String(body.parent_id);

    let parentId: string | null = null;
    let replyTo: string | null = null;
    if (parentIdRaw) {
      const parent = await commentById(parentIdRaw);
      if (!parent || parent.post_id !== post.id) throw notFound();
      parentId = parent.parent_id ?? parent.id;
      replyTo = parent.author_id;
    }

    if (text.trim() === '') throw validation({ text: 'Write something first.' });
    if ([...text].length > COMMENT_MAX_CHARS) {
      throw validation({ text: `Comments can be up to ${COMMENT_MAX_CHARS} characters.` });
    }

    const id = newId('cmt');
    await query(
      `INSERT INTO comments (id, post_id, author_id, parent_id, text, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, post.id, memberId, parentId, text, businessNow()],
    );
    const mentioned = await saveMentions('comment', id, memberId, text);

    const notified = new Set<string>();
    if (parentId && replyTo) {
      await notify({
        memberId: replyTo,
        actorId: memberId,
        kind: 'reply',
        subjectId: parentId,
        targetUrl: `/posts/${post.id}`,
      });
      notified.add(replyTo);
    } else {
      await notify({
        memberId: post.author_id,
        actorId: memberId,
        kind: 'comment',
        subjectId: post.id,
        targetUrl: `/posts/${post.id}`,
      });
      notified.add(post.author_id);
    }
    for (const mentionedId of mentioned) {
      if (notified.has(mentionedId)) continue;
      await notify({
        memberId: mentionedId,
        actorId: memberId,
        kind: 'mention',
        subjectId: post.id,
        targetUrl: `/posts/${post.id}`,
      });
    }

    const tree = await commentTree(memberId, post.id);
    const flat: Record<string, unknown>[] = [];
    for (const top of tree) {
      flat.push(top);
      for (const reply of (top.replies as Record<string, unknown>[]) ?? []) flat.push(reply);
    }
    const created = flat.find((comment) => comment.id === id);
    pushPost(post.id);
    return { status: 201, body: created ?? { id } };
  });
}

export async function deleteComment(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const comment = await commentById(ctx.params.id);
  if (!comment || comment.deleted_at) throw notFound();
  const post = await visiblePost(memberId, comment.post_id);
  if (comment.author_id !== memberId && post.author_id !== memberId) throw forbidden('not_author');
  await query('UPDATE comments SET deleted_at = $2 WHERE id = $1', [comment.id, businessNow()]);
  if (comment.parent_id === null) {
    await removeNotificationActor(post.author_id, 'comment', post.id, comment.author_id);
  } else {
    await removeNotificationsForSubject(comment.id);
  }
  pushPost(post.id);
  return { status: 204, body: null };
}

export async function createRepost(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const post = await visiblePost(memberId, ctx.params.id);
  const existing = await query<{ id: string }>(
    'SELECT id FROM reposts WHERE member_id = $1 AND post_id = $2',
    [memberId, post.id],
  );
  if (existing.length > 0) throw conflict('already_reposted');
  const id = newId('rps');
  await query('INSERT INTO reposts (id, member_id, post_id, created_at) VALUES ($1,$2,$3,$4)', [
    id,
    memberId,
    post.id,
    businessNow(),
  ]);
  await notify({
    memberId: post.author_id,
    actorId: memberId,
    kind: 'repost',
    subjectId: post.id,
    targetUrl: `/posts/${post.id}`,
  });
  const summary = await postObject(memberId, post);
  pushPost(post.id);
  pushFeed(memberId, post.id);
  return { status: 201, body: { repost_id: id, repost_count: summary.repost_count } };
}

export async function deleteRepost(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const rows = await query<{ id: string; member_id: string; post_id: string }>(
    'SELECT id, member_id, post_id FROM reposts WHERE id = $1',
    [ctx.params.id],
  );
  const repost = rows[0];
  if (!repost) throw notFound();
  if (repost.member_id !== memberId) throw forbidden('not_author');
  await query('DELETE FROM reposts WHERE id = $1', [repost.id]);
  const post = await postById(repost.post_id);
  if (post) await removeNotificationActor(post.author_id, 'repost', post.id, memberId);
  pushPost(repost.post_id);
  return { status: 204, body: null };
}

export async function getHashtag(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const tag = decodeURIComponent(ctx.params.tag).toLowerCase();
  const rows = await query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM posts p
     WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM post_hashtags h WHERE h.post_id = p.id AND h.tag_lower = $1)
     ORDER BY created_at DESC, id DESC`,
    [tag],
  );
  const visible: PostRow[] = [];
  for (const row of rows) {
    if (await postVisibleTo(memberId, row)) visible.push(row);
  }
  const carrying = visible.filter((row) => hashtagsOf(row.text).some((t) => t.toLowerCase() === tag));
  const weekAgo = businessNow().getTime() - WEEK_SECONDS * 1000;
  const recentAuthors = new Set(
    carrying
      .filter((row) => row.created_at.getTime() > weekAgo)
      .map((row) => row.author_id),
  );

  const cursorRaw = ctx.search.get('cursor');
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) throw validation({ cursor: 'This cursor is not valid.' });
  const start = cursor
    ? carrying.findIndex(
        (row) => row.created_at.getTime() === cursor.createdAt.getTime() && row.id === cursor.entryId,
      ) + 1
    : 0;
  const page = carrying.slice(start, start + 20);
  const posts: Record<string, unknown>[] = [];
  for (const row of page) posts.push(await postObject(memberId, row));
  const last = page[page.length - 1];
  const more = start + page.length < carrying.length;
  return {
    status: 200,
    body: {
      posts,
      next_cursor:
        more && last
          ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`, 'utf8').toString('base64url')
          : null,
      stats: { posts: carrying.length, members: recentAuthors.size },
    },
  };
}

export async function getFeed(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const newerThan = ctx.search.get('newer_than');
  if (newerThan) {
    const cursor = decodeCursor(newerThan);
    if (!cursor) throw validation({ cursor: 'This cursor is not valid.' });
    return { status: 200, body: await feedNewerThan(memberId, cursor) };
  }
  const cursorRaw = ctx.search.get('cursor');
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) throw validation({ cursor: 'This cursor is not valid.' });
  return { status: 200, body: await feedPage(memberId, config.feedPageSize, cursor) };
}
