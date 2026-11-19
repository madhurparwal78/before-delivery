import { membersOf, openSprite, requireOwner, requirePerson } from '../access.js';
import { recordActivity } from '../activity.js';
import { instant } from '../clock.js';
import { one, query, transact } from '../db.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import type { Route } from '../http.js';
import { publishSprite } from '../live.js';
import { clearStacks, recordOperation, spriteTransaction } from '../ops.js';
import { captureSnapshot, compareSnapshots, restoreSnapshot, type SnapshotPayload } from '../snapshots.js';
import { idParam, text } from '../validate.js';
import { roleIn } from '../access.js';
import type { PoolClient } from 'pg';
import { rows } from '../db.js';

interface CommentRow {
  id: number;
  sprite_id: number;
  author_id: number;
  frame: number;
  x: number;
  y: number;
  text: string;
  state: string;
  idempotency_key: string | null;
}

async function commentBody(client: PoolClient, commentId: number): Promise<Record<string, unknown>> {
  const comment = await rows<CommentRow & { author_name: string }>(
    client,
    `SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
    [commentId],
  );
  const row = comment[0];
  const mentions = await rows<{ name: string; state: string }>(
    client,
    `SELECT u.name, m.state FROM comment_mentions m JOIN users u ON u.id = m.user_id
      WHERE m.comment_id = $1 ORDER BY m.id`,
    [commentId],
  );
  return {
    id: row.id,
    frame: row.frame,
    x: row.x,
    y: row.y,
    text: row.text,
    state: row.state,
    author: row.author_name,
    mentions,
  };
}

/** Mentions match a member's name case-insensitively, longest name first. */
export function findMentions(body: string, names: string[]): string[] {
  const found: string[] = [];
  const lower = body.toLowerCase();
  for (const name of [...names].sort((l, r) => r.length - l.length)) {
    const needle = `@${name.toLowerCase()}`;
    if (lower.includes(needle) && !found.includes(name)) found.push(name);
  }
  return found;
}

export const commentRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/sprites/:id/comments',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      return transact(async (client) => {
        const list = await rows<{ id: number }>(
          client,
          'SELECT id FROM comments WHERE sprite_id = $1 ORDER BY id',
          [sprite.id],
        );
        const comments: Record<string, unknown>[] = [];
        for (const row of list) comments.push(await commentBody(client, row.id));
        return { status: 200, body: { comments } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/comments',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      const key = ctx.req.headers['idempotency-key'];
      const idempotencyKey = typeof key === 'string' && key !== '' ? key : null;
      if (idempotencyKey !== null) {
        const existing = await one<CommentRow>(
          'SELECT * FROM comments WHERE sprite_id = $1 AND author_id = $2 AND idempotency_key = $3',
          [sprite.id, access.person.id, idempotencyKey],
        );
        if (existing !== null) {
          const sameBody =
            existing.text === String(ctx.body.text ?? '').trim() &&
            existing.frame === Number(ctx.body.frame) &&
            existing.x === Number(ctx.body.x) &&
            existing.y === Number(ctx.body.y);
          if (!sameBody) throw conflict({ error: 'idempotency_conflict' });
          return transact(async (client) => ({
            status: 201,
            body: { ...(await commentBody(client, existing.id)), seq: sprite.seq },
          }));
        }
      }
      const body = text(ctx, 'text', { max: 2000, label: 'Write a comment first' });
      const frame = Number(ctx.body.frame);
      const x = Number(ctx.body.x);
      const y = Number(ctx.body.y);
      if (!Number.isInteger(frame) || frame < 1) throw unprocessable({ frame: 'Pin this to a frame' });
      if (!Number.isInteger(x) || x < 0 || x >= sprite.width) {
        throw unprocessable({ x: 'Pin this inside the sprite' });
      }
      if (!Number.isInteger(y) || y < 0 || y >= sprite.height) {
        throw unprocessable({ y: 'Pin this inside the sprite' });
      }
      const members = await membersOf(sprite.project_id);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const made = await rows<{ id: number }>(
          opCtx.client,
          `INSERT INTO comments (sprite_id, author_id, frame, x, y, text, state, idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8) RETURNING id`,
          [sprite.id, access.person.id, frame, x, y, body, idempotencyKey, opCtx.at],
        );
        const commentId = made[0].id;
        for (const name of findMentions(body, members.map((member) => member.name))) {
          const member = members.find((entry) => entry.name === name);
          if (member === undefined) continue;
          const mention = await rows<{ id: number }>(
            opCtx.client,
            "INSERT INTO comment_mentions (comment_id, user_id, state) VALUES ($1, $2, 'pending') RETURNING id",
            [commentId, member.id],
          );
          await opCtx.client.query(
            'INSERT INTO mail_outbox (to_email, subject, body, mention_id, created_at) VALUES ($1, $2, $3, $4, $5)',
            [
              member.email,
              `Mentioned on ${sprite.name}, frame ${frame}`,
              [`From: ${access.person.name}`, `Comment: ${body}`].join('\n'),
              mention[0].id,
              opCtx.at,
            ],
          );
        }
        await recordActivity(opCtx.client, {
          projectId: sprite.project_id,
          kind: 'comment',
          userId: access.person.id,
          userName: access.person.name,
          spriteId: sprite.id,
          spriteName: sprite.name,
          at: opCtx.at,
        });
        const seq = await recordOperation(opCtx, {
          type: 'comment',
          data: { action: 'post', comment: commentId, frame },
        });
        opCtx.events.push({ type: 'activity' });
        opCtx.events.push({ type: 'op', seq, op: 'comment', by: access.person.name });
        return {
          status: 201,
          body: { ...(await commentBody(opCtx.client, commentId)), seq },
        };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/comments/:id/resolve',
    handler: async (ctx) => changeCommentState(ctx, 'resolved'),
  },
  {
    method: 'POST',
    pattern: '/api/comments/:id/reopen',
    handler: async (ctx) => changeCommentState(ctx, 'open'),
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id/snapshots',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      const list = await query<{ id: number; name: string; seq: number; at: Date }>(
        'SELECT id, name, seq, at FROM snapshots WHERE sprite_id = $1 ORDER BY id DESC',
        [sprite.id],
      );
      return {
        status: 200,
        body: {
          snapshots: list.map((row) => ({
            id: row.id,
            name: row.name,
            seq: row.seq,
            at: instant(row.at),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/snapshots',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireOwner(access);
      const name = text(ctx, 'name', { max: 120, label: 'Name this snapshot' });
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const taken = await rows<{ id: number }>(
          opCtx.client,
          'SELECT id FROM snapshots WHERE sprite_id = $1 AND name = $2 AND NOT automatic',
          [sprite.id, name],
        );
        if (taken.length > 0) throw unprocessable({ name: 'That name is taken' });
        const payload = await captureSnapshot(opCtx.client, sprite);
        const seq = await recordOperation(opCtx, { type: 'snapshot', data: { name } });
        const made = await rows<{ id: number; at: Date }>(
          opCtx.client,
          `INSERT INTO snapshots (sprite_id, name, seq, at, automatic, payload)
           VALUES ($1, $2, $3, $4, false, $5) RETURNING id, at`,
          [sprite.id, name, seq, opCtx.at, JSON.stringify(payload)],
        );
        opCtx.events.push({ type: 'op', seq, op: 'snapshot', by: access.person.name });
        return {
          status: 201,
          body: { id: made[0].id, name, seq, at: instant(made[0].at) },
        };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id/snapshots/compare',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      const fromId = Number(ctx.url.searchParams.get('from'));
      const toId = Number(ctx.url.searchParams.get('to'));
      const pair = await query<{ id: number; payload: SnapshotPayload }>(
        'SELECT id, payload FROM snapshots WHERE sprite_id = $1 AND id = ANY($2::int[])',
        [sprite.id, [fromId, toId]],
      );
      const from = pair.find((row) => row.id === fromId);
      const to = pair.find((row) => row.id === toId);
      if (from === undefined || to === undefined) throw notFound();
      return { status: 200, body: { frames: compareSnapshots(from.payload, to.payload) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/snapshots/:id/restore',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      const snapshot = await one<{ id: number; sprite_id: number; name: string; payload: SnapshotPayload }>(
        'SELECT id, sprite_id, name, payload FROM snapshots WHERE id = $1',
        [idParam(ctx, 'id')],
      );
      if (snapshot === null) throw notFound();
      const { sprite, access } = await openSprite(ctx, snapshot.sprite_id);
      requireOwner(access);
      return spriteTransaction(sprite.id, person, async (opCtx) => {
        const before = await captureSnapshot(opCtx.client, sprite);
        const beforeSeq = sprite.seq;
        const beforeRow = await rows<{ id: number }>(
          opCtx.client,
          `INSERT INTO snapshots (sprite_id, name, seq, at, automatic, payload)
           VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
          [sprite.id, `Before restore ${snapshot.name}`, beforeSeq, opCtx.at, JSON.stringify(before)],
        );
        await restoreSnapshot(opCtx.client, sprite, snapshot.payload);
        await clearStacks(opCtx);
        await recordActivity(opCtx.client, {
          projectId: sprite.project_id,
          kind: 'restore',
          userId: person.id,
          userName: person.name,
          spriteId: sprite.id,
          spriteName: sprite.name,
          detail: snapshot.name,
          at: opCtx.at,
        });
        const seq = await recordOperation(opCtx, {
          type: 'restore',
          data: { snapshot: snapshot.id, name: snapshot.name },
        });
        opCtx.events.push({ type: 'activity' });
        opCtx.events.push({
          type: 'op',
          seq,
          op: 'restore',
          by: person.name,
          data: { name: snapshot.name },
        });
        return { status: 200, body: { seq, before_snapshot: beforeRow[0].id } };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/drafts/:key',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      const draft = await one<{ text: string; version: number }>(
        'SELECT text, version FROM drafts WHERE user_id = $1 AND key = $2',
        [person.id, ctx.params.key],
      );
      return { status: 200, body: draft ?? { text: '', version: 0 } };
    },
  },
  {
    method: 'PUT',
    pattern: '/api/drafts/:key',
    handler: async (ctx) => {
      const person = requirePerson(ctx);
      const body = typeof ctx.body.text === 'string' ? ctx.body.text : '';
      const version = Number(ctx.body.version);
      if (!Number.isInteger(version) || version < 0) {
        throw unprocessable({ version: 'Send the version you read' });
      }
      const current = await one<{ text: string; version: number }>(
        'SELECT text, version FROM drafts WHERE user_id = $1 AND key = $2',
        [person.id, ctx.params.key],
      );
      const now = current?.version ?? 0;
      if (now !== version) {
        throw conflict({
          error: 'draft_newer',
          current: { text: current?.text ?? '', version: now },
        });
      }
      const next = version + 1;
      await query(
        `INSERT INTO drafts (user_id, key, text, version) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key) DO UPDATE SET text = $3, version = $4`,
        [person.id, ctx.params.key, body, next],
      );
      return { status: 200, body: { text: body, version: next } };
    },
  },
];

async function changeCommentState(
  ctx: Parameters<Route['handler']>[0],
  to: 'open' | 'resolved',
): Promise<{ status: number; body: unknown }> {
  const person = requirePerson(ctx);
  const comment = await one<CommentRow>('SELECT * FROM comments WHERE id = $1', [idParam(ctx, 'id')]);
  if (comment === null) throw notFound();
  const sprite = await one<{ id: number; project_id: number }>(
    'SELECT id, project_id FROM sprites WHERE id = $1',
    [comment.sprite_id],
  );
  if (sprite === null) throw notFound();
  const role = await roleIn(sprite.project_id, person.id);
  if (role === null) throw notFound();
  if (comment.state === to) {
    throw conflict({
      error: 'comment_state',
      message: to === 'resolved' ? 'Already resolved' : 'Already open',
    });
  }
  await query('UPDATE comments SET state = $2 WHERE id = $1', [comment.id, to]);
  publishSprite(sprite.id, { type: 'comments' });
  return transact(async (client) => ({ status: 200, body: await commentBody(client, comment.id) }));
}
