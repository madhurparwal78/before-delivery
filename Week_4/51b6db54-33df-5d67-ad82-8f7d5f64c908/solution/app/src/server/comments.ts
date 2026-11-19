import { createHash } from 'node:crypto';
import { asId, spriteAccess } from './access';
import { userNames } from './auth';
import { now } from './clock';
import { one, pool, rows, type Queryable } from './db';
import { conflict, invalid, notFound, forbidden } from './errors';
import { publishToSprite } from './hub';
import { created, route, type Ctx } from './http';
import { enqueueMail } from './mailer';
import { recordActivity, runOperation, type Operation } from './ops';
import { Errors, intIn, isInt, objectBody } from './validate';
import { formatNumber } from '../shared/format';
import { COMMENT_MAX } from '../shared/rules';
import type { CommentInfo } from '../shared/types';

interface CommentRow {
  id: number;
  sprite_id: number;
  author_id: number;
  frame: number;
  x: number;
  y: number;
  text: string;
  state: 'open' | 'resolved';
}

export async function commentInfos(q: Queryable, where: string, params: unknown[]): Promise<CommentInfo[]> {
  const found = await rows<CommentRow>(q, `SELECT id, sprite_id, author_id, frame, x, y, text, state FROM comments WHERE ${where} ORDER BY id`, params);
  if (found.length === 0) return [];
  const names = await userNames([...new Set(found.map((c) => c.author_id))]);
  const mentions = await rows<{ comment_id: number; name: string; state: 'pending' | 'delivered' }>(
    q,
    'SELECT m.comment_id, u.name, m.state FROM mentions m JOIN users u ON u.id = m.user_id WHERE m.comment_id = ANY($1) ORDER BY u.name',
    [found.map((c) => c.id)],
  );
  return found.map((c) => ({
    id: c.id,
    frame: c.frame,
    x: c.x,
    y: c.y,
    text: c.text,
    state: c.state,
    author: names.get(c.author_id) ?? '',
    mentions: mentions.filter((m) => m.comment_id === c.id).map(({ name, state }) => ({ name, state })),
  }));
}

export const loadComments = (q: Queryable, spriteId: number): Promise<CommentInfo[]> => commentInfos(q, 'sprite_id = $1', [spriteId]);

/** Names of project members mentioned as `@name`, longest name first, each once. */
export function mentionedMembers<T extends { name: string }>(text: string, members: readonly T[]): T[] {
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length);
  const found = new Map<string, T>();
  let at = text.indexOf('@');
  while (at >= 0) {
    const rest = text.slice(at + 1).toLowerCase();
    const match = byLength.find((m) => rest.startsWith(m.name.toLowerCase()) && !/[\p{L}\p{N}]/u.test(rest.charAt(m.name.length)));
    if (match) {
      found.set(match.name, match);
      at = text.indexOf('@', at + 1 + match.name.length);
    } else at = text.indexOf('@', at + 1);
  }
  return [...found.values()];
}

const fingerprint = (body: unknown, spriteId: number): string => createHash('sha256').update(JSON.stringify([spriteId, body])).digest('hex');

async function postComment(ctx: Ctx, op: Operation) {
  const body = objectBody(ctx.body);
  const key = ctx.req.headers['idempotency-key'];
  const idem = typeof key === 'string' && key !== '' ? key : null;
  const print = fingerprint({ frame: body.frame, x: body.x, y: body.y, text: body.text }, op.sprite.id);
  if (idem) {
    const stored = await one<{ fingerprint: string; comment_id: number }>(op.tx, 'SELECT fingerprint, comment_id FROM comment_keys WHERE user_id = $1 AND key = $2', [op.userId, idem]);
    if (stored) {
      if (stored.fingerprint !== print) throw conflict('idempotency_conflict');
      const [info] = await commentInfos(op.tx, 'id = $1', [stored.comment_id]);
      const seq = (await one<{ seq: number }>(op.tx, 'SELECT seq FROM comments WHERE id = $1', [stored.comment_id]))?.seq ?? 0;
      return created({ ...info, seq });
    }
  }
  const errors = new Errors();
  const text = typeof body.text === 'string' ? body.text : '';
  const frames = (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM frames WHERE sprite_id = $1', [op.sprite.id]))?.n ?? 0;
  if (text.trim() === '') errors.add('text', 'Write a comment first');
  else if (text.length > COMMENT_MAX) errors.add('text', `Use at most ${formatNumber(COMMENT_MAX, ctx.locale.number_format)} characters`);
  if (!intIn(body.frame, 1, frames)) errors.add('frame', `Use 1 to ${formatNumber(frames, ctx.locale.number_format)}`);
  if (!intIn(body.x, 0, op.sprite.width - 1)) errors.add('x', `Use 0 to ${op.sprite.width - 1}`);
  if (!intIn(body.y, 0, op.sprite.height - 1)) errors.add('y', `Use 0 to ${op.sprite.height - 1}`);
  errors.check();
  const comment = await one<{ id: number }>(
    op.tx,
    "INSERT INTO comments (sprite_id, author_id, frame, x, y, text, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7) RETURNING id",
    [op.sprite.id, op.userId, body.frame, body.x, body.y, text, now()],
  );
  const commentId = comment?.id ?? 0;
  const members = await rows<{ id: number; name: string; email: string }>(
    op.tx,
    'SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1',
    [op.sprite.project_id],
  );
  for (const member of mentionedMembers(text, members)) {
    await op.tx.query("INSERT INTO mentions (comment_id, user_id, state) VALUES ($1, $2, 'pending')", [commentId, member.id]);
    await enqueueMail(op.tx, {
      to: member.email,
      subject: `Mentioned on ${op.sprite.name}, frame ${String(body.frame)}`,
      body: `From: ${op.userName}\nComment: ${text}`,
      mention: { commentId, userId: member.id },
    });
  }
  const [info] = await commentInfos(op.tx, 'id = $1', [commentId]);
  const seq = await op.emit('comment', { comment: info });
  await op.tx.query('UPDATE comments SET seq = $2 WHERE id = $1', [commentId, seq]);
  if (idem) await op.tx.query('INSERT INTO comment_keys (user_id, key, fingerprint, comment_id) VALUES ($1, $2, $3, $4)', [op.userId, idem, print, commentId]);
  await draftEmpty(op, `comment:${op.sprite.id}`);
  await recordActivity(op.tx, op.sprite.project_id, op.userId, op.sprite.id, { kind: 'comment', data: {} });
  return created({ ...info, seq });
}

async function draftEmpty(op: Operation, key: string): Promise<void> {
  await op.tx.query("INSERT INTO drafts (user_id, key, text, version) VALUES ($1, $2, '', 1) ON CONFLICT (user_id, key) DO UPDATE SET text = '', version = drafts.version + 1", [op.userId, key]);
}

route('GET', '/api/sprites/:id/comments', async (ctx) => {
  const { sprite } = await spriteAccess(ctx.need().id, asId(ctx.params.id));
  return { comments: await loadComments(pool, sprite.id) };
});

route('POST', '/api/sprites/:id/comments', (ctx) => runOperation(ctx.need().id, asId(ctx.params.id), 'comment', (op) => postComment(ctx, op)));

async function moveComment(ctx: Ctx, to: 'open' | 'resolved') {
  const user = ctx.need();
  const found = await one<{ sprite_id: number }>(pool, 'SELECT sprite_id FROM comments WHERE id = $1', [asId(ctx.params.id)]);
  if (!found) throw notFound();
  return runOperation(user.id, found.sprite_id, 'comment', async (op) => {
    const comment = await one<{ state: string }>(op.tx, 'SELECT state FROM comments WHERE id = $1', [asId(ctx.params.id)]);
    if (comment?.state === to) throw conflict('comment_state', { message: to === 'resolved' ? 'Already resolved' : 'Already open' });
    await op.tx.query('UPDATE comments SET state = $2 WHERE id = $1', [asId(ctx.params.id), to]);
    const [info] = await commentInfos(op.tx, 'id = $1', [asId(ctx.params.id)]);
    const seq = await op.emit('comment', { comment: info });
    return { ...info, seq };
  });
}

route('POST', '/api/comments/:id/resolve', (ctx) => moveComment(ctx, 'resolved'));
route('POST', '/api/comments/:id/reopen', (ctx) => moveComment(ctx, 'open'));

/** Tells open workspaces that a mention reached the mail server. */
export async function announceDelivery(commentId: number): Promise<void> {
  const row = await one<{ sprite_id: number }>(pool, 'SELECT sprite_id FROM comments WHERE id = $1', [commentId]);
  const [info] = await commentInfos(pool, 'id = $1', [commentId]);
  if (row && info) publishToSprite(row.sprite_id, 'comment', info);
}

route('GET', '/api/drafts/:key', async (ctx) => {
  const user = ctx.need();
  await draftAccess(user.id, ctx.params.key ?? '', false);
  const draft = await one<{ text: string; version: number }>(pool, 'SELECT text, version FROM drafts WHERE user_id = $1 AND key = $2', [user.id, ctx.params.key]);
  return { text: draft?.text ?? '', version: draft?.version ?? 0 };
});

route('PUT', '/api/drafts/:key', async (ctx) => {
  const user = ctx.need();
  const key = ctx.params.key ?? '';
  await draftAccess(user.id, key, true);
  const body = objectBody(ctx.body);
  if (typeof body.text !== 'string' || body.text.length > 10_000 || !isInt(body.version)) throw invalid({ text: 'Send the text and its version' });
  const saved =
    body.version === 0
      ? await one(pool, 'INSERT INTO drafts (user_id, key, text, version) VALUES ($1, $2, $3, 1) ON CONFLICT DO NOTHING RETURNING version', [user.id, key, body.text])
      : await one(pool, 'UPDATE drafts SET text = $3, version = version + 1 WHERE user_id = $1 AND key = $2 AND version = $4 RETURNING version', [user.id, key, body.text, body.version]);
  if (!saved) {
    const current = (await one<{ text: string; version: number }>(pool, 'SELECT text, version FROM drafts WHERE user_id = $1 AND key = $2', [user.id, key])) ?? { text: '', version: 0 };
    throw conflict('draft_newer', { current });
  }
  return { text: body.text, version: body.version + 1 };
});

async function draftAccess(userId: number, key: string, writing: boolean): Promise<void> {
  const match = /^(comment|tag):(\d+)$/.exec(key);
  if (!match) throw notFound();
  const { role } = await spriteAccess(userId, Number(match[2]));
  if (writing && match[1] === 'tag' && role === 'reviewer') throw forbidden("Reviewers can't change artwork");
}
