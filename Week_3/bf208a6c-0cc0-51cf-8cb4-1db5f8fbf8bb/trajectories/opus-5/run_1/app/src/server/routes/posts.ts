import { randomUUID } from 'node:crypto';
import { POST_FORM_COPY } from '../../shared/copy';
import type { CommentDto } from '../../shared/types';
import { clean, commentError, postBodyError, postTitleError } from '../../shared/validate';
import { lockBoard } from '../boards';
import { accessBoard, accessPost, requireSignedIn } from '../context';
import { inTransaction, pool, type Db } from '../db';
import { env } from '../env';
import {
  fileTooLarge,
  forbidden,
  invalid,
  notFound,
  notHeld,
  notPublished,
  serviceUnavailable,
  unsupportedType,
} from '../errors';
import { flushBoard, recordEvent } from '../events';
import type { Ctx, Router } from '../http';
import { permissions } from '../../shared/permissions';
import {
  appendPosition,
  applyHandMove,
  bumpVersion,
  checkPositionRange,
  loadPostRow,
  loadSectionOfBoard,
  maxTargetPosition,
  moveGate,
  postDto,
  removeFromHandOrder,
} from '../posts';
import { deliverApprovalPush, markService, removeObjects } from '../services';
import { attachmentKey, postPrefix, putObject } from '../storage';
import { detectContentType, storedFileName } from '../uploads';

const reloadPost = async (db: Db, postId: string, callerId: string | null) => {
  const row = await loadPostRow(db, postId, callerId);
  if (row === null) throw notFound();
  return row;
};

const createPost = async (ctx: Ctx): Promise<void> => {
  const { board, role } = await accessBoard(pool, ctx, ctx.params.id);
  const userId = requireSignedIn(ctx);
  if (!permissions.addPost(role)) throw forbidden();
  const { fields, file } = await ctx.multipart();
  const section = await loadSectionOfBoard(pool, board.id, fields.section_id ?? '');

  let upload: { fileName: string; contentType: string; bytes: Buffer } | null = null;
  if (file !== null) {
    if (file.bytes.length > env.uploadMaxBytes) throw fileTooLarge();
    const contentType = detectContentType(file.bytes);
    if (contentType === null) throw unsupportedType();
    upload = { fileName: storedFileName(file.fileName), contentType, bytes: file.bytes };
  }

  const title = clean(fields.title ?? '');
  const body = clean(fields.body ?? '');
  const errors: Record<string, string> = {};
  const titleError = postTitleError(title);
  if (titleError !== null) errors.title = titleError;
  const bodyError = postBodyError(body);
  if (bodyError !== null) errors.body = bodyError;
  if (Object.keys(errors).length > 0) throw invalid(errors);

  const postId = randomUUID();
  let attachment: { id: string; key: string; fileName: string; contentType: string; size: number } | null = null;
  if (upload !== null) {
    const attachmentId = randomUUID();
    const key = attachmentKey(board.id, postId, attachmentId);
    try {
      await putObject(key, upload.bytes, upload.contentType);
      markService('storage', true);
    } catch {
      markService('storage', false);
      throw serviceUnavailable('storage');
    }
    attachment = {
      id: attachmentId,
      key,
      fileName: upload.fileName,
      contentType: upload.contentType,
      size: upload.bytes.length,
    };
  }

  const held = board.approval && permissions.holdsPosts(role);
  const post = await inTransaction(async (client) => {
    await lockBoard(client, board.id);
    const position = held ? null : await appendPosition(client, section.id);
    await client.query(
      `insert into posts (id, board_id, section_id, author_id, title, body, state, position, push_state, last_actor_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $4)`,
      [postId, board.id, section.id, userId, title, body, held ? 'awaiting_approval' : 'published', position, held ? 'pending' : null],
    );
    if (attachment !== null) {
      await client.query(
        'insert into attachments (id, post_id, board_id, file_name, content_type, size, object_key) values ($1, $2, $3, $4, $5, $6, $7)',
        [attachment.id, postId, board.id, attachment.fileName, attachment.contentType, attachment.size, attachment.key],
      );
    }
    const row = await reloadPost(client, postId, userId);
    await recordEvent(
      client,
      board.id,
      {
        kind: 'post_created',
        post_id: postId,
        title,
        actor_id: userId,
        actor_name: row.author_name,
        state: held ? 'awaiting_approval' : 'published',
      },
      held ? 'held' : 'all',
      userId,
    );
    return row;
  });
  await flushBoard(board.id);
  if (held) void deliverApprovalPush(board.id, board.title, postId, title);
  ctx.sendJson(201, postDto(post, role));
};

const editPost = async (ctx: Ctx): Promise<void> => {
  const { post, board, role } = await accessPost(pool, ctx, ctx.params.id);
  const userId = requireSignedIn(ctx);
  if (!permissions.editPost(role, post.author_id === userId)) throw forbidden();
  const body = await ctx.json<{ title?: string; body?: string; version?: number }>();

  const errors: Record<string, string> = {};
  const title = 'title' in body ? clean(String(body.title)) : post.title;
  const text = 'body' in body ? clean(String(body.body)) : post.body;
  const titleError = postTitleError(title);
  if (titleError !== null) errors.title = titleError;
  const textError = postBodyError(text);
  if (textError !== null) errors.body = textError;
  if (Object.keys(errors).length > 0) throw invalid(errors);

  const updated = await inTransaction(async (client) => {
    await lockBoard(client, board.id);
    const current = await reloadPost(client, post.id, userId);
    await bumpVersion(client, current, Number(body.version), userId, { title, body: text });
    const row = await reloadPost(client, post.id, userId);
    await recordEvent(
      client,
      board.id,
      { kind: 'post_updated', post_id: post.id, title, actor_id: userId },
      row.state === 'awaiting_approval' ? 'held' : 'all',
      row.author_id,
    );
    return row;
  });
  await flushBoard(board.id);
  ctx.sendJson(200, postDto(updated, role));
};

const movePost = async (ctx: Ctx): Promise<void> => {
  const { post, board, role } = await accessPost(pool, ctx, ctx.params.id);
  const body = await ctx.json<{ section_id?: string; position?: number; version?: number }>();
  const section = await loadSectionOfBoard(pool, board.id, body.section_id ?? '');
  const userId = requireSignedIn(ctx);
  if (!permissions.movePost(role, post.author_id === userId)) throw forbidden();
  if (post.state !== 'published') throw notPublished();
  moveGate(board, post, section.id);

  const moved = await inTransaction(async (client) => {
    await lockBoard(client, board.id);
    const current = await reloadPost(client, post.id, userId);
    if (current.state !== 'published' || current.position === null) throw notPublished();
    const from = { id: current.id, section_id: current.section_id, position: current.position };
    let targetPosition: number;
    if (board.sort === 'by_hand') {
      const max = await maxTargetPosition(client, from, section.id);
      const requested = Number(body.position);
      checkPositionRange(requested, max);
      targetPosition = requested;
    } else {
      targetPosition = await appendPosition(client, section.id);
    }
    await bumpVersion(client, current, Number(body.version), userId, null);
    await applyHandMove(client, from, section.id, targetPosition);
    const row = await reloadPost(client, post.id, userId);
    await recordEvent(client, board.id, {
      kind: 'post_moved',
      post_id: post.id,
      title: row.title,
      actor_id: userId,
      actor_name: row.last_actor_name,
    });
    return row;
  });
  await flushBoard(board.id);
  ctx.sendJson(200, postDto(moved, role));
};

const deletePost = async (ctx: Ctx): Promise<void> => {
  const { post, board, role } = await accessPost(pool, ctx, ctx.params.id);
  const userId = requireSignedIn(ctx);
  if (!permissions.deletePost(role, post.author_id === userId)) throw forbidden();
  await inTransaction(async (client) => {
    await lockBoard(client, board.id);
    const current = await reloadPost(client, post.id, userId);
    await client.query('delete from posts where id = $1', [post.id]);
    await removeFromHandOrder(client, current);
    await recordEvent(
      client,
      board.id,
      { kind: 'post_deleted', post_id: post.id, title: post.title, actor_id: userId },
      post.state === 'awaiting_approval' ? 'held' : 'all',
      post.author_id,
    );
  });
  await flushBoard(board.id);
  await removeObjects(postPrefix(board.id, post.id));
  ctx.sendEmpty(204);
};

const approvePost = async (ctx: Ctx): Promise<void> => {
  const { post, board, role } = await accessPost(pool, ctx, ctx.params.id);
  requireSignedIn(ctx);
  if (!permissions.moderate(role)) throw forbidden();
  if (post.state !== 'awaiting_approval') throw notHeld();
  const approved = await inTransaction(async (client) => {
    await lockBoard(client, board.id);
    const current = await reloadPost(client, post.id, ctx.userId);
    if (current.state !== 'awaiting_approval') throw notHeld();
    const position = await appendPosition(client, current.section_id);
    await client.query("update posts set state = 'published', position = $2, push_state = null where id = $1", [
      post.id,
      position,
    ]);
    const row = await reloadPost(client, post.id, ctx.userId);
    await recordEvent(client, board.id, {
      kind: 'post_approved',
      post_id: post.id,
      title: row.title,
      author_id: row.author_id,
    });
    return row;
  });
  await flushBoard(board.id);
  ctx.sendJson(200, postDto(approved, role));
};

const rejectPost = async (ctx: Ctx): Promise<void> => {
  const { post, board, role } = await accessPost(pool, ctx, ctx.params.id);
  requireSignedIn(ctx);
  if (!permissions.moderate(role)) throw forbidden();
  if (post.state !== 'awaiting_approval') throw notHeld();
  await inTransaction(async (client) => {
    await lockBoard(client, board.id);
    const current = await reloadPost(client, post.id, ctx.userId);
    if (current.state !== 'awaiting_approval') throw notHeld();
    await client.query("update posts set state = 'rejected', position = null, push_state = null where id = $1", [post.id]);
    await recordEvent(
      client,
      board.id,
      { kind: 'post_rejected', post_id: post.id, title: post.title, author_id: post.author_id },
      'held',
      post.author_id,
    );
  });
  await flushBoard(board.id);
  await removeObjects(postPrefix(board.id, post.id));
  ctx.sendEmpty(204);
};

const reactionBody = async (db: Db, postId: string, userId: string): Promise<Record<string, unknown>> => {
  const row = await reloadPost(db, postId, userId);
  return { likes: row.likes, score: row.score, liked: row.liked, my_vote: row.my_vote };
};

const reactionGuard = async (ctx: Ctx): Promise<{ postId: string; boardId: string; userId: string }> => {
  const { post, role } = await accessPost(pool, ctx, ctx.params.id);
  const userId = requireSignedIn(ctx);
  if (!permissions.react(role)) throw forbidden();
  if (post.state !== 'published') throw notPublished();
  return { postId: post.id, boardId: post.board_id, userId };
};

const afterReaction = async (ctx: Ctx, postId: string, boardId: string, userId: string): Promise<void> => {
  await recordEvent(pool, boardId, { kind: 'reaction', post_id: postId });
  await flushBoard(boardId);
  ctx.sendJson(200, await reactionBody(pool, postId, userId));
};

const comments = async (ctx: Ctx): Promise<void> => {
  const { post } = await accessPost(pool, ctx, ctx.params.id);
  const result = await pool.query<{ id: string; author_id: string; display_name: string; text: string; created_at: Date }>(
    `select c.id, c.author_id, u.display_name, c.text, c.created_at
     from comments c join users u on u.id = c.author_id where c.post_id = $1 order by c.seq`,
    [post.id],
  );
  ctx.sendJson(200, {
    comments: result.rows.map(
      (row): CommentDto => ({
        id: row.id,
        author: { id: row.author_id, display_name: row.display_name },
        text: row.text,
        created_at: `${row.created_at.toISOString().slice(0, 19)}Z`,
      }),
    ),
  });
};

const addComment = async (ctx: Ctx): Promise<void> => {
  const { post, board, role } = await accessPost(pool, ctx, ctx.params.id);
  const userId = requireSignedIn(ctx);
  if (!permissions.comment(role)) throw forbidden();
  if (post.state !== 'published') throw notPublished();
  const body = await ctx.json<{ text?: string }>();
  const text = clean(body.text ?? '');
  const textError = commentError(text);
  if (textError !== null) throw invalid({ text: textError });

  const comment = await inTransaction(async (client) => {
    const inserted = await client.query<{ id: string; created_at: Date; display_name: string }>(
      `with saved as (
         insert into comments (id, post_id, author_id, text) values ($1, $2, $3, $4) returning id, author_id, created_at
       )
       select saved.id, saved.created_at, u.display_name from saved join users u on u.id = saved.author_id`,
      [randomUUID(), post.id, userId, text],
    );
    const row = inserted.rows[0];
    const dto: CommentDto = {
      id: row.id,
      author: { id: userId, display_name: row.display_name },
      text,
      created_at: `${row.created_at.toISOString().slice(0, 19)}Z`,
    };
    await recordEvent(client, board.id, { kind: 'comment', post_id: post.id, comment: dto });
    return dto;
  });
  await flushBoard(board.id);
  ctx.sendJson(201, comment);
};

export const registerPostRoutes = (router: Router): void => {
  router.add('POST', '/api/boards/:id/posts', createPost);
  router.add('GET', '/api/posts/:id', async (ctx) => {
    const { post, role } = await accessPost(pool, ctx, ctx.params.id);
    ctx.sendJson(200, postDto(post, role));
  });
  router.add('PATCH', '/api/posts/:id', editPost);
  router.add('PATCH', '/api/posts/:id/move', movePost);
  router.add('DELETE', '/api/posts/:id', deletePost);
  router.add('POST', '/api/posts/:id/approve', approvePost);
  router.add('POST', '/api/posts/:id/reject', rejectPost);
  router.add('PUT', '/api/posts/:id/like', async (ctx) => {
    const { postId, boardId, userId } = await reactionGuard(ctx);
    await pool.query('insert into likes (post_id, user_id) values ($1, $2) on conflict do nothing', [postId, userId]);
    await afterReaction(ctx, postId, boardId, userId);
  });
  router.add('DELETE', '/api/posts/:id/like', async (ctx) => {
    const { postId, boardId, userId } = await reactionGuard(ctx);
    await pool.query('delete from likes where post_id = $1 and user_id = $2', [postId, userId]);
    await afterReaction(ctx, postId, boardId, userId);
  });
  router.add('PUT', '/api/posts/:id/vote', async (ctx) => {
    const { postId, boardId, userId } = await reactionGuard(ctx);
    const body = await ctx.json<{ value?: number }>();
    const value = Number(body.value);
    if (value !== 1 && value !== -1) throw invalid({ value: 'Not a known value.' });
    await pool.query(
      'insert into votes (post_id, user_id, value) values ($1, $2, $3) on conflict (post_id, user_id) do update set value = $3',
      [postId, userId, value],
    );
    await afterReaction(ctx, postId, boardId, userId);
  });
  router.add('DELETE', '/api/posts/:id/vote', async (ctx) => {
    const { postId, boardId, userId } = await reactionGuard(ctx);
    await pool.query('delete from votes where post_id = $1 and user_id = $2', [postId, userId]);
    await afterReaction(ctx, postId, boardId, userId);
  });
  router.add('GET', '/api/posts/:id/comments', comments);
  router.add('POST', '/api/posts/:id/comments', addComment);
};
