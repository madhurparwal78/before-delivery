import { Router } from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { businessMs } from '../clock.js';
import { errors, newId, conflict } from '../errors.js';
import { wrap, requireSession } from '../http.js';
import { withIdempotency } from '../idempotency.js';
import { pushTo } from '../live.js';
import {
  loadPost, toPostObject, resolveMentions, extractHashtags, codePoints, postVisibleTo,
  summaryFor, repostCount, editableNow, loadPostOrThrow,
} from '../domain/posts.js';
import { blockedWith, getMemberById } from '../domain/profile-shared.js';

const REACTION_TYPES = ['like', 'celebrate', 'support', 'insightful', 'funny'] as const;
type ReactionType = typeof REACTION_TYPES[number];

const notify = async (
  memberId: string, kind: string, opts: { postId?: string; commentId?: string; skillId?: string; actorId: string; targetUrl: string },
): Promise<void> => {
  if (memberId === opts.actorId) return;
  await query(
    `INSERT INTO notifications (id, member_id, kind, post_id, comment_id, skill_id, actor_id, count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8)`,
    [newId(), memberId, kind, opts.postId ?? null, opts.commentId ?? null, opts.skillId ?? null, opts.actorId, new Date(businessMs())]);
  pushTo(memberId, 'notification', { kind, target_url: opts.targetUrl });
};

const groupedNotify = async (
  memberId: string, kind: string, postId: string, actorId: string, targetUrl: string,
): Promise<void> => {
  if (memberId === actorId) return;
  const existing = await query(
    `SELECT id, count FROM notifications WHERE member_id = $1 AND kind = $2 AND post_id = $3`,
    [memberId, kind, postId]);
  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO notifications (id, member_id, kind, post_id, actor_id, count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $6)`,
      [newId(), memberId, kind, postId, actorId, new Date(businessMs())]);
  } else {
    await query(
      `UPDATE notifications SET count = count + 1, actor_id = $1, updated_at = $2 WHERE id = $3`,
      [actorId, new Date(businessMs()), existing.rows[0].id]);
  }
  pushTo(memberId, 'notification', { kind, target_url: targetUrl });
};

export const postsRouter = (): Router => {
  const router = Router();
  router.use('/posts', requireSession);

  const requireVisiblePost = async (viewerId: string, postId: string) => {
    const post = await loadPost(postId);
    if (!post) throw errors.notFound();
    const blocked = await blockedWith(viewerId);
    if (!(await postVisibleTo(viewerId, post.author_id, blocked))) throw errors.notFound();
    return { post, blocked };
  };

  router.post('/posts', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    await withIdempotency(req, res, '/api/posts', async () => {
      const { text, photo_id, shared_post_id } = (req.body ?? {}) as Record<string, unknown>;
      const textStr = typeof text === 'string' ? text : '';
      const fields: Record<string, string> = {};
      if (textStr.trim().length === 0) fields.text = 'Write something first.';
      if (codePoints(textStr) > config.postMaxChars) fields.text = `Posts can be up to ${config.postMaxChars} characters.`;
      if (shared_post_id) {
        const shared = await loadPost(String(shared_post_id));
        if (!shared) throw errors.notFound();
        const blocked = await blockedWith(viewerId);
        if (!(await postVisibleTo(viewerId, shared.author_id, blocked))) throw errors.notFound();
      }
      if (photo_id) {
        const upload = await query(`SELECT 1 FROM uploads WHERE id = $1 AND owner_id = $2 AND kind = 'photo'`,
          [String(photo_id), viewerId]);
        if (upload.rows.length === 0) throw errors.notFound();
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const id = newId();
      await query(
        `INSERT INTO posts (id, author_id, text, photo_id, shared_post_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, viewerId, textStr, photo_id ? String(photo_id) : null,
         shared_post_id ? String(shared_post_id) : null, new Date(businessMs())]);
      const post = await loadPostOrThrow(id);
      // Mention notifications: only newly mentioned members.
      const mentions = await resolveMentions(viewerId, textStr);
      for (const mention of mentions) {
        await notify(mention.member_id, 'mention', {
          postId: id, actorId: viewerId, targetUrl: `/posts/${id}`,
        });
      }
      if (shared_post_id) {
        const shared = await loadPost(String(shared_post_id));
        if (shared) {
          await groupedNotify(shared.author_id, 'repost', shared.id, viewerId, `/posts/${shared.id}`);
        }
      }
      const obj = await toPostObject(viewerId, post);
      return { status: 201, body: obj };
    });
  }));

  router.get('/posts/:id', wrap(async (req, res) => {
    const { post } = await requireVisiblePost(req.auth!.memberId, req.params.id);
    res.json(await toPostObject(req.auth!.memberId, post));
  }));

  router.patch('/posts/:id', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { post } = await requireVisiblePost(viewerId, req.params.id);
    if (post.author_id !== viewerId) {
      const err = errors.notAuthor();
      throw err;
    }
    const { text } = (req.body ?? {}) as { text?: string };
    const textStr = typeof text === 'string' ? text : '';
    const fields: Record<string, string> = {};
    if (textStr.trim().length === 0) fields.text = 'Write something first.';
    if (codePoints(textStr) > config.postMaxChars) fields.text = `Posts can be up to ${config.postMaxChars} characters.`;
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    if (!editableNow(post.created_at)) throw conflict({ error: 'edit_window_closed' });

    const before = await resolveMentions(viewerId, post.text);
    await query(`UPDATE posts SET text = $1, edited_at = $2 WHERE id = $3`,
      [textStr, new Date(businessMs()), post.id]);
    const after = await resolveMentions(viewerId, textStr);
    for (const mention of after) {
      if (!before.some((m) => m.member_id === mention.member_id)) {
        await notify(mention.member_id, 'mention', { postId: post.id, actorId: viewerId, targetUrl: `/posts/${post.id}` });
      }
    }
    const fresh = await loadPostOrThrow(post.id);
    res.json(await toPostObject(viewerId, fresh));
  }));

  router.delete('/posts/:id', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const post = await loadPost(req.params.id);
    if (!post) throw errors.notFound();
    if (post.author_id !== viewerId) throw errors.notAuthor();
    await query(`UPDATE posts SET deleted = true WHERE id = $1`, [post.id]);
    res.status(204).end();
  }));

  router.put('/posts/:id/reaction', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { post } = await requireVisiblePost(viewerId, req.params.id);
    const { type } = (req.body ?? {}) as { type?: string };
    if (!REACTION_TYPES.includes(type as ReactionType)) {
      throw errors.validation({ type: 'Choose a reaction type.' });
    }
    await query(
      `INSERT INTO reactions (post_id, member_id, type, at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (post_id, member_id) DO UPDATE SET type = $3, at = $4`,
      [post.id, viewerId, type, new Date(businessMs())]);
    await groupedNotify(post.author_id, 'reaction', post.id, viewerId, `/posts/${post.id}`);
    const fresh = await loadPostOrThrow(post.id);
    const { reactions } = await summaryFor(fresh, viewerId);
    pushTo(post.author_id, 'post_update', { post_id: post.id });
    res.json({ reactions });
  }));

  router.delete('/posts/:id/reaction', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { post } = await requireVisiblePost(viewerId, req.params.id);
    await query(`DELETE FROM reactions WHERE post_id = $1 AND member_id = $2`, [post.id, viewerId]);
    const fresh = await loadPostOrThrow(post.id);
    const { reactions } = await summaryFor(fresh, viewerId);
    pushTo(post.author_id, 'post_update', { post_id: post.id });
    res.json({ reactions });
  }));

  router.get('/posts/:id/reactions', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { post } = await requireVisiblePost(viewerId, req.params.id);
    const blocked = await blockedWith(viewerId);
    const result = await query<{ member_id: string; type: string; at: Date }>(
      `SELECT member_id, type, at FROM reactions WHERE post_id = $1 ORDER BY at DESC`, [post.id]);
    const reactors = [];
    for (const row of result.rows) {
      if (blocked.has(row.member_id)) continue;
      const member = await getMemberById(row.member_id);
      if (!member) continue;
      reactors.push({ member: {
        id: member.id, handle: member.handle, name: member.name, headline: member.headline,
        photo_url: member.visibility === 'private' ? null : (member.photo_id ? `/media/photos/${member.photo_id}` : null),
      }, type: row.type, at: row.at.toISOString() });
    }
    res.json({ reactors });
  }));

  router.get('/posts/:id/comments', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { post } = await requireVisiblePost(viewerId, req.params.id);
    res.json({ comments: await commentsTree(post.id, viewerId) });
  }));

  router.post('/posts/:id/comments', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    await withIdempotency(req, res, '/api/comments', async () => {
      const { post } = await requireVisiblePost(viewerId, req.params.id);
      const { text, parent_id } = (req.body ?? {}) as Record<string, unknown>;
      const textStr = typeof text === 'string' ? text : '';
      const fields: Record<string, string> = {};
      if (textStr.trim().length === 0) fields.text = 'Write something first.';
      if (codePoints(textStr) > 1250) fields.text = 'Comments can be up to 1250 characters.';
      let parentComment: { id: string; parent_id: string | null; author_id: string } | undefined;
      if (parent_id) {
        const parentResult = await query<{ id: string; parent_id: string | null; author_id: string }>(
          `SELECT id, parent_id, author_id FROM comments WHERE id = $1 AND post_id = $2 AND deleted = false`,
          [String(parent_id), post.id]);
        parentComment = parentResult.rows[0];
        if (!parentComment) throw errors.notFound();
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      let topLevelId: string | null = null;
      if (parentComment) {
        topLevelId = parentComment.parent_id ?? parentComment.id;
      }
      const id = newId();
      await query(
        `INSERT INTO comments (id, post_id, parent_id, author_id, text, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, post.id, topLevelId, viewerId, textStr, new Date(businessMs())]);
      const mentions = await resolveMentions(viewerId, textStr);
      for (const mention of mentions) {
        await notify(mention.member_id, 'mention', { postId: post.id, actorId: viewerId, targetUrl: `/posts/${post.id}` });
      }
      if (parentComment) {
        await notify(parentComment.author_id, 'reply', { postId: post.id, commentId: id, actorId: viewerId, targetUrl: `/posts/${post.id}` });
      } else {
        await groupedNotify(post.author_id, 'comment', post.id, viewerId, `/posts/${post.id}`);
      }
      pushTo(post.author_id, 'post_update', { post_id: post.id });
      const created = await commentById(post.id, id, viewerId);
      return { status: 201, body: created };
    });
  }));

  router.delete('/comments/:id', async (req, res, next) => {
    try {
      const viewerId = req.auth!.memberId;
      const result = await query<{ id: string; post_id: string; author_id: string; parent_id: string | null }>(
        `SELECT id, post_id, author_id, parent_id FROM comments WHERE id = $1 AND deleted = false`, [req.params.id]);
      const comment = result.rows[0];
      if (!comment) throw errors.notFound();
      const post = await loadPost(comment.post_id);
      if (!post) throw errors.notFound();
      if (comment.author_id !== viewerId && post.author_id !== viewerId) throw errors.notAuthor();
      await query(`UPDATE comments SET deleted = true WHERE id = $1`, [comment.id]);
      pushTo(post.author_id, 'post_update', { post_id: post.id });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  router.post('/posts/:id/reposts', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { post } = await requireVisiblePost(viewerId, req.params.id);
    const existing = await query(`SELECT 1 FROM reposts WHERE post_id = $1 AND member_id = $2`, [post.id, viewerId]);
    if (existing.rows.length > 0) throw conflict({ error: 'already_reposted' });
    const id = newId();
    await query(`INSERT INTO reposts (id, member_id, post_id, created_at) VALUES ($1, $2, $3, $4)`,
      [id, viewerId, post.id, new Date(businessMs())]);
    await groupedNotify(post.author_id, 'repost', post.id, viewerId, `/posts/${post.id}`);
    const count = await repostCount(post.id, viewerId);
    res.status(201).json({ repost_id: id, repost_count: count });
  }));

  router.delete('/reposts/:id', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const result = await query(`SELECT member_id FROM reposts WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) throw errors.notFound();
    if (result.rows[0].member_id !== viewerId) throw errors.notAuthor();
    await query(`DELETE FROM reposts WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  }));

  return router;
};

export const commentsTree = async (postId: string, viewerId: string): Promise<unknown[]> => {
  const blocked = await blockedWith(viewerId);
  const result = await query<{
    id: string; parent_id: string | null; author_id: string; text: string;
    created_at: Date; deleted: boolean; name: string; handle: string; headline: string;
  }>(
    `SELECT c.id, c.parent_id, c.author_id, c.text, c.created_at, c.deleted, m.name, m.handle, m.headline
     FROM comments c LEFT JOIN members m ON m.id = c.author_id
     WHERE c.post_id = $1 ORDER BY c.created_at ASC, c.id ASC`, [postId]);
  const byId = new Map<string, unknown>();
  const topLevel: unknown[] = [];
  for (const row of result.rows) {
    if (row.deleted) continue;
    if (row.author_id && blocked.has(row.author_id)) continue;
    const comment = {
      id: row.id, post_id: postId, parent_id: row.parent_id,
      author: row.author_id ? { id: row.author_id, handle: row.handle, name: row.name, headline: row.headline } : null,
      text: row.text,
      mentions: await resolveMentions(row.author_id, row.text),
      hashtags: extractHashtags(row.text),
      created_at: row.created_at.toISOString(),
      deleted: false,
      replies: [] as unknown[],
    };
    byId.set(row.id, comment);
    if (row.parent_id) {
      const parent = byId.get(row.parent_id) as { replies: unknown[] } | undefined;
      if (parent) parent.replies.push(comment);
    } else {
      topLevel.push(comment);
    }
  }
  // Deleted top-level comments with live replies appear as placeholders.
  for (const row of result.rows) {
    if (!row.deleted || row.parent_id !== null) continue;
    const hasReplies = result.rows.some((r) => r.parent_id === row.id && !r.deleted);
    if (!hasReplies) continue;
    const replies = result.rows
      .filter((r) => r.parent_id === row.id && !r.deleted && !(r.author_id && blocked.has(r.author_id)))
      .map((r) => byId.get(r.id))
      .filter((r): r is unknown => r !== undefined);
    topLevel.push({ id: row.id, post_id: postId, parent_id: null, deleted: true, replies });
  }
  topLevel.sort((a, b) => {
    const ta = (a as { created_at: string }).created_at;
    const tb = (b as { created_at: string }).created_at;
    return ta === tb ? (a as { id: string }).id.localeCompare((b as { id: string }).id) : (ta < tb ? -1 : 1);
  });
  return topLevel;
};

const commentById = async (postId: string, commentId: string, viewerId: string): Promise<unknown> => {
  const tree = await commentsTree(postId, viewerId);
  const search = (comments: unknown[]): unknown | undefined => {
    for (const comment of comments) {
      const node = comment as { id?: string; replies?: unknown[] };
      if (node.id === commentId) return comment;
      const nested = node.replies ? search(node.replies) : undefined;
      if (nested) return nested;
    }
    return undefined;
  };
  return search(tree) ?? {};
};
