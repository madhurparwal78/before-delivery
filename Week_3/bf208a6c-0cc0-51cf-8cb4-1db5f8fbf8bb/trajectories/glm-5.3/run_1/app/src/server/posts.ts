import type { App } from './app.js';
import type { RequestContext } from './http.js';
import { sendJson } from './http.js';
import {
  ApiError,
  notFound,
  forbidden,
  signInRequired,
  validation,
  fileTooLarge,
  unsupportedType,
  storageUnavailable,
  notHeld,
  notPublished,
  conflict,
  outOfRangePosition,
  sortLocksOrder,
  groupBlocksMoving,
} from './errors.js';
import { limits } from './rules.js';
import { trim, countCodePoints, randomId } from './util.js';
import { sniff, cleanFileName } from './sniff.js';
import { openBoardOr404, roleAtLeast, canMovePost } from './access.js';
import { loadPostExtras, toPostDTO } from './listings.js';
import type { PostRow, BoardRow, AttachmentRow } from './types.js';
import type { PostDTO, Role, Sort } from '../shared/types.js';
import { parseMultipart } from './multipart.js';

const SORT_LABELS: Record<Sort, string> = {
  by_hand: 'By hand',
  newest: 'Newest first',
  oldest: 'Oldest first',
  most_liked: 'Most liked',
};

export async function loadVisiblePost(
  app: App,
  ctx: RequestContext,
  postId: string,
): Promise<{ post: PostRow; board: BoardRow; role: Role | null }> {
  const res = await app.db.query('SELECT * FROM posts WHERE id = $1', [postId]);
  const post = res.rows[0] as PostRow | undefined;
  if (!post) throw notFound();
  const { board, role } = await openBoardOr404(app.db, post.board_id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  if (post.state === 'rejected') throw notFound();
  if (post.state === 'awaiting_approval') {
    const canSee = roleAtLeast(role, 'moderator') || post.author_id === ctx.userId;
    if (!canSee) throw notFound();
  }
  return { post, board, role };
}

async function postDTOFor(app: App, ctx: RequestContext, postId: string): Promise<PostDTO> {
  const { post, role } = await loadVisiblePost(app, ctx, postId);
  const extras = await loadPostExtras(app.db, [postId], ctx.userId);
  const push = roleAtLeast(role, 'moderator') && post.state === 'awaiting_approval' ? (post.push_state as 'sent' | 'pending') : null;
  return toPostDTO(post, extras.get(postId)!, push);
}

export async function handleCreatePost(app: App, ctx: RequestContext): Promise<void> {
  if (!ctx.userId) throw signInRequired();
  const { board, role } = await openBoardOr404(app.db, ctx.params.id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  if (!roleAtLeast(role, 'contributor')) throw forbidden();

  const multipart = ctx.rawBody
    ? parseMultipart(ctx.rawBody, ctx.req.headers['content-type'] ?? '')
    : null;
  if (!multipart) throw new ApiError(400, { error: 'bad_request' });
  const title = trim(multipart.fields.title ?? '');
  const body = trim(multipart.fields.body ?? '');
  const sectionId = multipart.fields.section_id ?? '';

  const errors: Record<string, string> = {};
  if (countCodePoints(title) < 1) errors.title = 'Give your post a title.';
  else if (countCodePoints(title) > limits.titleMax) errors.title = 'Titles can be at most 80 characters.';
  if (countCodePoints(body) > limits.bodyMax) errors.body = 'Text can be at most 2,000 characters.';
  const section = await app.db.query('SELECT id FROM sections WHERE id = $1 AND board_id = $2', [sectionId, board.id]);
  if (section.rows.length === 0) throw notFound();
  if (Object.keys(errors).length > 0) throw validation(errors);

  let attachment: { id: string; fileName: string; contentType: string; size: number; data: Buffer } | null = null;
  if (multipart.file && multipart.file.data.length > 0) {
    const data = multipart.file.data;
    if (data.length > app.config.uploadMaxBytes) throw fileTooLarge();
    const sniffed = sniff(data);
    if (sniffed.kind === 'refused') {
      throw unsupportedType();
    }
    const fileName = cleanFileName(multipart.file.fileName);
    if (!app.services.state.storage) throw storageUnavailable();
    const attachmentId = randomId('att');
    attachment = { id: attachmentId, fileName, contentType: sniffed.contentType, size: data.length, data };
  }

  const held = board.approval && role === 'contributor';
  const postId = randomId('pst');
  if (attachment) {
    const key = app.services.storage.objectKey(board.id, postId, attachment.id);
    const putOk = await app.services.storage.put(key, attachment.data, attachment.contentType);
    if (!putOk) throw storageUnavailable();
  }
  const client = await app.db.connect();
  try {
    await client.query('BEGIN');
    const maxPos = await client.query(
      `SELECT coalesce(max(position), 0) AS m FROM posts WHERE section_id = $1 AND state = 'published'`,
      [sectionId],
    );
    const nextPos = Number((maxPos.rows[0] as { m: string }).m) + 1;
    await client.query(
      `INSERT INTO posts (id, board_id, section_id, author_id, position, title, body, state, push_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        postId,
        board.id,
        sectionId,
        ctx.userId,
        held ? null : nextPos,
        title,
        body,
        held ? 'awaiting_approval' : 'published',
        held ? 'sent' : null,
      ],
    );
    if (attachment) {
      await client.query(
        'INSERT INTO attachments (id, post_id, board_id, file_name, content_type, size) VALUES ($1, $2, $3, $4, $5, $6)',
        [attachment.id, postId, board.id, attachment.fileName, attachment.contentType, attachment.size],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (attachment) {
      await app.services.storage.deletePrefix(app.services.storage.objectKey(board.id, postId, attachment.id));
    }
    throw err;
  } finally {
    client.release();
  }

  if (held) {
    const pushOk = await app.services.push.publish(board.id, board.title, title);
    await app.db.query('UPDATE posts SET push_state = $1 WHERE id = $2', [pushOk ? 'sent' : 'pending', postId]);
    if (!pushOk) {
      await app.db.query('INSERT INTO push_retries (post_id, next_at) VALUES ($1, now() + interval \'10 seconds\')', [postId]);
    }
    await app.events.publish(board.id, { type: 'post_held', post_id: postId });
  } else {
    await app.events.publish(board.id, { type: 'post_added', post_id: postId, author_id: ctx.userId });
  }
  sendJson(ctx.res, 201, await postDTOFor(app, ctx, postId));
}

export async function handleGetPost(app: App, ctx: RequestContext): Promise<void> {
  sendJson(ctx.res, 200, await postDTOFor(app, ctx, ctx.params.id));
}

export async function handlePatchPost(app: App, ctx: RequestContext): Promise<void> {
  const { post, board, role } = await loadVisiblePost(app, ctx, ctx.params.id);
  const mayEdit = role === 'owner' || (role === 'contributor' && post.author_id === ctx.userId);
  if (!mayEdit) throw forbidden();
  if (post.state === 'awaiting_approval') throw notPublished();
  const body = ctx.jsonBody as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const updates: string[] = [];
  const params: unknown[] = [];
  if (body.title !== undefined) {
    const title = trim(String(body.title));
    if (countCodePoints(title) < 1) errors.title = 'Give your post a title.';
    else if (countCodePoints(title) > limits.titleMax) errors.title = 'Titles can be at most 80 characters.';
    else {
      params.push(title);
      updates.push(`title = $${params.length}`);
    }
  }
  if (body.body !== undefined) {
    const text = trim(String(body.body));
    if (countCodePoints(text) > limits.bodyMax) errors.body = 'Text can be at most 2,000 characters.';
    else {
      params.push(text);
      updates.push(`body = $${params.length}`);
    }
  }
  if (typeof body.version !== 'number') throw validation({ version: 'A version is required.' });
  if (Object.keys(errors).length > 0) throw validation(errors);
  if (post.version !== body.version) {
    const mover = await app.db.query('SELECT display_name FROM users WHERE id = $1', [post.last_moved_by ?? post.author_id]);
    const moverName = (mover.rows[0] as { display_name: string }).display_name;
    throw conflict(post.section_id, post.position ?? 1, post.version, moverName);
  }
  if (updates.length > 0) {
    params.push(post.version + 1);
    updates.push(`version = $${params.length}`);
    params.push(ctx.userId);
    updates.push(`last_moved_by = $${params.length}`);
    params.push(post.id);
    await app.db.query(`UPDATE posts SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
  }
  await app.events.publish(board.id, { type: 'post_changed', post_id: post.id });
  sendJson(ctx.res, 200, await postDTOFor(app, ctx, post.id));
}

export async function handleMovePost(app: App, ctx: RequestContext): Promise<void> {
  const { post, board, role } = await loadVisiblePost(app, ctx, ctx.params.id);
  if (!canMovePost(role, ctx.userId, post)) throw forbidden();
  if (post.state === 'awaiting_approval') throw notPublished();
  const body = ctx.jsonBody as Record<string, unknown>;
  const sectionId = String(body.section_id ?? '');
  const position = Number(body.position);
  const version = Number(body.version);

  if (board.group === 'author') throw groupBlocksMoving();
  if (board.sort !== 'by_hand') {
    if (sectionId === post.section_id) throw sortLocksOrder(SORT_LABELS[board.sort]);
  }

  const section = await app.db.query('SELECT id FROM sections WHERE id = $1 AND board_id = $2', [sectionId, board.id]);
  if (section.rows.length === 0) throw notFound();
  if (!Number.isInteger(position) || position < 1) throw outOfRangePosition(1);

  const client = await app.db.connect();
  let released = false;
  const releaseClient = () => {
    if (!released) {
      released = true;
      client.release();
    }
  };
  let conflictError: ApiError | null = null;
  let rangeError: ApiError | null = null;
  try {
    await client.query('BEGIN');
    const fresh = await client.query('SELECT version, position FROM posts WHERE id = $1 FOR UPDATE', [post.id]);
    const freshRow = fresh.rows[0] as { version: number; position: number | null } | undefined;
    if (!freshRow) throw notFound();
    if (freshRow.version !== version) {
      await client.query('ROLLBACK');
      const mover = await client.query('SELECT display_name FROM users WHERE id = $1', [post.last_moved_by ?? post.author_id]);
      const moverName = (mover.rows[0] as { display_name: string }).display_name;
      conflictError = conflict(post.section_id, post.position ?? 1, post.version, moverName);
    }
    if (!conflictError) {
      const maxRes = await client.query(
        `SELECT count(*) AS n FROM posts WHERE section_id = $1 AND state = 'published' AND id != $2`,
        [sectionId, post.id],
      );
      const max = Number((maxRes.rows[0] as { n: string }).n) + 1;
      if (position > max) {
        await client.query('ROLLBACK');
        rangeError = outOfRangePosition(max);
      }
    }
    if (!conflictError && !rangeError) {
      if (sectionId !== post.section_id) {
        await client.query(
          `UPDATE posts SET position = position - 1
            WHERE section_id = $1 AND state = 'published' AND position > $2`,
          [post.section_id, post.position],
        );
        await client.query(
          `UPDATE posts SET position = position + 1
            WHERE section_id = $1 AND state = 'published' AND id != $2 AND position >= $3`,
          [sectionId, post.id, position],
        );
      } else {
        const oldPos = post.position ?? 1;
        if (position !== oldPos) {
          if (position < oldPos) {
            await client.query(
              `UPDATE posts SET position = position + 1
                WHERE section_id = $1 AND state = 'published' AND id != $2 AND position >= $3 AND position < $4`,
              [sectionId, post.id, position, oldPos],
            );
          } else {
            await client.query(
              `UPDATE posts SET position = position - 1
                WHERE section_id = $1 AND state = 'published' AND id != $2 AND position > $3 AND position <= $4`,
              [sectionId, post.id, oldPos, position],
            );
          }
        }
      }
      await client.query('UPDATE posts SET section_id = $1, position = $2, version = version + 1, last_moved_by = $3 WHERE id = $4', [
        sectionId,
        position,
        ctx.userId,
        post.id,
      ]);
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    releaseClient();
  }
  if (conflictError) throw conflictError;
  if (rangeError) throw rangeError;
  await app.events.publish(board.id, { type: 'post_moved', post_id: post.id, moved_by: ctx.userId });
  sendJson(ctx.res, 200, await postDTOFor(app, ctx, post.id));
}

export async function handleDeletePost(app: App, ctx: RequestContext): Promise<void> {
  const { post, board, role } = await loadVisiblePost(app, ctx, ctx.params.id);
  const mayDelete = roleAtLeast(role, 'moderator') || (role === 'contributor' && post.author_id === ctx.userId);
  if (!mayDelete) throw forbidden();
  const attachment = await app.db.query('SELECT id FROM attachments WHERE post_id = $1', [post.id]);
  const attachmentRow = attachment.rows[0] as { id: string } | undefined;
  await app.db.query('DELETE FROM posts WHERE id = $1', [post.id]);
  if (post.state === 'published' && post.position !== null) {
    await app.db.query(
      `UPDATE posts SET position = position - 1
        WHERE section_id = $1 AND state = 'published' AND position > $2`,
      [post.section_id, post.position],
    );
  }
  const postPrefix = `boards/${board.id}/posts/${post.id}`;
  const ok = await app.services.storage.deletePrefix(postPrefix);
  if (!ok && attachmentRow) {
    await app.db.query("INSERT INTO storage_retries (prefix, kind) VALUES ($1, 'post')", [postPrefix]);
  }
  await app.events.publish(board.id, { type: 'post_deleted', post_id: post.id, deleted_by: ctx.userId });
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function handleApprovePost(app: App, ctx: RequestContext): Promise<void> {
  const res = await app.db.query('SELECT * FROM posts WHERE id = $1', [ctx.params.id]);
  const post = res.rows[0] as PostRow | undefined;
  if (!post) throw notFound();
  const { board, role } = await openBoardOr404(app.db, post.board_id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  if (!roleAtLeast(role, 'moderator')) throw forbidden();
  if (post.state === 'rejected') throw notFound();
  if (post.state !== 'awaiting_approval') throw notHeld();
  const maxRes = await app.db.query(
    `SELECT coalesce(max(position), 0) AS m FROM posts WHERE section_id = $1 AND state = 'published'`,
    [post.section_id],
  );
  const nextPos = Number((maxRes.rows[0] as { m: string }).m) + 1;
  await app.db.query(
    "UPDATE posts SET state = 'published', position = $1, version = version + 1, last_moved_by = $2, push_state = null WHERE id = $3",
    [nextPos, ctx.userId, post.id],
  );
  await app.events.publish(board.id, { type: 'post_approved', post_id: post.id, approved_by: ctx.userId });
  sendJson(ctx.res, 200, await postDTOFor(app, ctx, post.id));
}

export async function handleRejectPost(app: App, ctx: RequestContext): Promise<void> {
  const res = await app.db.query('SELECT * FROM posts WHERE id = $1', [ctx.params.id]);
  const post = res.rows[0] as PostRow | undefined;
  if (!post) throw notFound();
  const { board, role } = await openBoardOr404(app.db, post.board_id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  if (!roleAtLeast(role, 'moderator')) throw forbidden();
  if (post.state === 'rejected') throw notFound();
  if (post.state !== 'awaiting_approval') throw notHeld();
  const attachment = await app.db.query('SELECT id FROM attachments WHERE post_id = $1', [post.id]);
  const attachmentRow = attachment.rows[0] as { id: string } | undefined;
  await app.db.query("UPDATE posts SET state = 'rejected', push_state = null WHERE id = $1", [post.id]);
  const postPrefix = `boards/${board.id}/posts/${post.id}`;
  const ok = await app.services.storage.deletePrefix(postPrefix);
  if (!ok && attachmentRow) {
    await app.db.query("INSERT INTO storage_retries (prefix, kind) VALUES ($1, 'post')", [postPrefix]);
  }
  await app.events.publish(board.id, { type: 'post_rejected', post_id: post.id });
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function handleLike(app: App, ctx: RequestContext, on: boolean): Promise<void> {
  const { post } = await loadVisiblePost(app, ctx, ctx.params.id);
  if (post.state === 'awaiting_approval') throw notPublished();
  if (!ctx.userId) throw signInRequired();
  const { board, role } = await openBoardOr404(app.db, post.board_id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  if (!roleAtLeast(role, 'viewer')) throw forbidden();
  if (on) {
    await app.db.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [post.id, ctx.userId]);
  } else {
    await app.db.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [post.id, ctx.userId]);
  }
  await app.events.publish(board.id, { type: 'reaction', post_id: post.id });
  sendJson(ctx.res, 200, await reactionSummary(app, ctx, post.id));
}

export async function handleVote(app: App, ctx: RequestContext, value: number | null): Promise<void> {
  const { post } = await loadVisiblePost(app, ctx, ctx.params.id);
  if (post.state === 'awaiting_approval') throw notPublished();
  if (!ctx.userId) throw signInRequired();
  const { board, role } = await openBoardOr404(app.db, post.board_id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  if (!roleAtLeast(role, 'viewer')) throw forbidden();
  if (value === null) {
    await app.db.query('DELETE FROM votes WHERE post_id = $1 AND user_id = $2', [post.id, ctx.userId]);
  } else {
    await app.db.query(
      'INSERT INTO votes (post_id, user_id, value) VALUES ($1, $2, $3) ON CONFLICT (post_id, user_id) DO UPDATE SET value = $3',
      [post.id, ctx.userId, value],
    );
  }
  await app.events.publish(board.id, { type: 'reaction', post_id: post.id });
  sendJson(ctx.res, 200, await reactionSummary(app, ctx, post.id));
}

async function reactionSummary(app: App, ctx: RequestContext, postId: string): Promise<{ likes: number; score: number; liked: boolean; my_vote: number }> {
  const extras = await loadPostExtras(app.db, [postId], ctx.userId);
  const e = extras.get(postId)!;
  return { likes: e.likes, score: e.score, liked: e.liked, my_vote: e.myVote };
}

export async function handleListComments(app: App, ctx: RequestContext): Promise<void> {
  const { post } = await loadVisiblePost(app, ctx, ctx.params.id);
  const res = await app.db.query(
    `SELECT c.id, c.text, c.created_at, u.id AS author_id, u.display_name
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.post_id = $1 ORDER BY c.created_at, c.id`,
    [post.id],
  );
  sendJson(ctx.res, 200, {
    comments: res.rows.map((r) => {
      const row = r as { id: string; text: string; created_at: Date; author_id: string; display_name: string };
      return {
        id: row.id,
        author: { id: row.author_id, display_name: row.display_name },
        text: row.text,
        created_at: row.created_at.toISOString(),
      };
    }),
  });
}

export async function handleCreateComment(app: App, ctx: RequestContext): Promise<void> {
  if (!ctx.userId) throw signInRequired();
  const { post, board, role } = await loadVisiblePost(app, ctx, ctx.params.id);
  if (!roleAtLeast(role, 'contributor')) throw forbidden();
  if (post.state === 'awaiting_approval') throw notPublished();
  const body = ctx.jsonBody as Record<string, unknown>;
  const text = trim(String(body.text ?? ''));
  if (countCodePoints(text) < 1) throw validation({ text: 'Write a comment first.' });
  if (countCodePoints(text) > limits.commentMax) throw validation({ text: 'Comments can be at most 500 characters.' });
  const id = randomId('cmt');
  await app.db.query('INSERT INTO comments (id, post_id, author_id, text) VALUES ($1, $2, $3, $4)', [
    id,
    post.id,
    ctx.userId,
    text,
  ]);
  await app.events.publish(board.id, { type: 'comment_added', post_id: post.id, comment_id: id, author_id: ctx.userId });
  const created = await app.db.query(
    `SELECT c.id, c.text, c.created_at, u.id AS author_id, u.display_name
       FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
    [id],
  );
  const row = created.rows[0] as { id: string; text: string; created_at: Date; author_id: string; display_name: string };
  sendJson(ctx.res, 201, {
    id: row.id,
    author: { id: row.author_id, display_name: row.display_name },
    text: row.text,
    created_at: row.created_at.toISOString(),
  });
}

export async function handleGetAttachment(app: App, ctx: RequestContext): Promise<void> {
  const res = await app.db.query(
    `SELECT a.*, p.state AS post_state, p.board_id AS post_board_id
       FROM attachments a JOIN posts p ON p.id = a.post_id
      WHERE a.id = $1`,
    [ctx.params.id],
  );
  const row = res.rows[0] as (AttachmentRow & { post_state: string; post_board_id: string }) | undefined;
  if (!row) throw notFound();
  await loadVisiblePost(app, ctx, row.post_id);
  const key = app.services.storage.objectKey(row.board_id, row.post_id, row.id);
  const obj = await app.services.storage.get(key);
  if (!obj) throw storageUnavailable();
  const inline = row.content_type.startsWith('image/');
  const disposition = inline ? 'inline' : 'attachment';
  ctx.res.writeHead(200, {
    'Content-Type': row.content_type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${disposition}; filename="${row.file_name.replace(/"/g, '')}"`,
    'Content-Length': obj.bytes.length,
  });
  ctx.res.end(obj.bytes);
}
