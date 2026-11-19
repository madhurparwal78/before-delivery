import { randomUUID } from 'node:crypto';
import { copy, sentence } from '../../shared/copy.js';
import { ApiError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { hiddenSet } from '../../shared/tree.js';
import { requireActor } from '../auth.js';
import { publish } from '../bus.js';
import { now } from '../clock.js';
import { db } from '../db.js';
import { readJson, route } from '../http.js';
import { membersOf, requireRole } from '../mapstore.js';

interface CommentRow {
  id: string;
  topic_id: string;
  author: string;
  body: string;
  resolved: boolean;
  reply_to: string | null;
  created_at: Date;
}

function threadsFrom(rows: CommentRow[]): unknown[] {
  const heads = rows.filter((row) => row.reply_to === null);
  return heads.map((head) => ({
    id: head.id,
    author: head.author,
    body: head.body,
    resolved: head.resolved,
    created_at: head.created_at.toISOString(),
    replies: rows
      .filter((row) => row.reply_to === head.id)
      .map((reply) => ({
        id: reply.id,
        author: reply.author,
        body: reply.body,
        created_at: reply.created_at.toISOString(),
      })),
  }));
}

route('GET', '/api/maps/:id/topics/:topic/comments', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  const hidden = hiddenSet(map.doc, can(role, 'see_restricted'));
  if (!map.doc.topics[ctx.params.topic] || hidden.has(ctx.params.topic)) {
    throw new ApiError('not_found', copy.missingTopic);
  }
  const rows = await db.query<CommentRow>(
    'select * from comments where map_id = $1 and topic_id = $2 order by created_at asc',
    [map.id, ctx.params.topic],
  );
  return { status: 200, json: { threads: threadsFrom(rows.rows) } };
});

route('POST', '/api/maps/:id/topics/:topic/comments', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  const hidden = hiddenSet(map.doc, can(role, 'see_restricted'));
  const topic = map.doc.topics[ctx.params.topic];
  if (!topic || hidden.has(ctx.params.topic)) throw new ApiError('not_found', copy.missingTopic);
  if (!can(role, 'comment')) throw new ApiError('forbidden', copy.readOnly);
  const body = readJson(ctx);
  const text = typeof body.body === 'string' ? body.body : '';
  if (text.length < 1 || text.length > 2000) {
    throw new ApiError('invalid', 'A comment is 1 to 2,000 characters.');
  }
  const replyTo = body.reply_to ?? null;
  if (replyTo !== null) {
    const parent = await db.query<{ reply_to: string | null }>(
      'select reply_to from comments where id = $1 and map_id = $2',
      [replyTo, map.id],
    );
    const found = parent.rows[0];
    if (!found) throw new ApiError('not_found', 'That thread is gone.');
    if (found.reply_to !== null) throw new ApiError('invalid', 'Replies cannot carry replies.');
  }
  const id = randomUUID();
  await db.query(
    `insert into comments (id, map_id, topic_id, author, body, resolved, reply_to, created_at)
     values ($1, $2, $3, $4, $5, false, $6, $7)`,
    [id, map.id, ctx.params.topic, actor.name, text, replyTo, now()],
  );
  const members = await membersOf(db, map);
  const mentioned = new Set(
    [...text.matchAll(/@([a-z0-9_]{3,24})/g)].map((match) => match[1]).filter((name) => members.has(name)),
  );
  for (const username of mentioned) {
    if (username === actor.name) continue;
    await db.query(
      `insert into mentions (id, map_id, topic_id, comment_id, username, by_user, read, created_at)
       values ($1, $2, $3, $4, $5, $6, false, $7)`,
      [randomUUID(), map.id, ctx.params.topic, id, username, actor.name, now()],
    );
  }
  await publish(map.id, {
    type: 'comment',
    topics: [ctx.params.topic],
    payload: {
      topic_id: ctx.params.topic,
      comment: {
        id,
        author: actor.name,
        body: text,
        resolved: false,
        reply_to: replyTo,
        created_at: now().toISOString(),
      },
      sentence: sentence.comment(actor.name, topic.title),
      mentions: [...mentioned],
    },
  });
  return {
    status: 201,
    json: {
      comment: {
        id,
        author: actor.name,
        body: text,
        resolved: false,
        reply_to: replyTo,
        created_at: now().toISOString(),
      },
    },
  };
});

async function setResolved(
  commentId: string,
  actorKeyName: string,
  resolved: boolean,
): Promise<unknown> {
  const row = await db.query<CommentRow & { map_id: string }>(
    'select * from comments where id = $1 order by created_at desc limit 1',
    [commentId],
  );
  const found = row.rows[0];
  if (!found || found.reply_to !== null) throw new ApiError('not_found', 'That thread is gone.');
  if (found.resolved === resolved) {
    throw new ApiError('invalid_transition', 'That thread is already in that state.');
  }
  await db.query('update comments set resolved = $2 where id = $1 and map_id = $3', [
    commentId,
    resolved,
    found.map_id,
  ]);
  const rows = await db.query<CommentRow>(
    'select * from comments where map_id = $1 and topic_id = $2 order by created_at asc',
    [found.map_id, found.topic_id],
  );
  await publish(found.map_id, {
    type: 'comment',
    topics: [found.topic_id],
    payload: { topic_id: found.topic_id, resolved, thread_id: commentId, by: actorKeyName },
  });
  const threads = threadsFrom(rows.rows) as { id: string }[];
  return threads.find((thread) => thread.id === commentId);
}

route('POST', '/api/comments/:id/resolve', async (ctx) => {
  const actor = await requireActor(ctx);
  const row = await db.query<{ map_id: string }>(
    'select map_id from comments where id = $1 order by created_at desc limit 1',
    [ctx.params.id],
  );
  const mapId = row.rows[0]?.map_id;
  if (!mapId) throw new ApiError('not_found', 'That thread is gone.');
  const { role } = await requireRole(db, mapId, actor);
  if (!can(role, 'comment')) throw new ApiError('forbidden', copy.readOnly);
  return { status: 200, json: { thread: await setResolved(ctx.params.id, actor.name, true) } };
});

route('POST', '/api/comments/:id/reopen', async (ctx) => {
  const actor = await requireActor(ctx);
  const row = await db.query<{ map_id: string }>(
    'select map_id from comments where id = $1 order by created_at desc limit 1',
    [ctx.params.id],
  );
  const mapId = row.rows[0]?.map_id;
  if (!mapId) throw new ApiError('not_found', 'That thread is gone.');
  const { role } = await requireRole(db, mapId, actor);
  if (!can(role, 'comment')) throw new ApiError('forbidden', copy.readOnly);
  return { status: 200, json: { thread: await setResolved(ctx.params.id, actor.name, false) } };
});

route('PUT', '/api/maps/:id/topics/:topic/vote', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  const hidden = hiddenSet(map.doc, can(role, 'see_restricted'));
  const topic = map.doc.topics[ctx.params.topic];
  if (!topic || hidden.has(ctx.params.topic)) throw new ApiError('not_found', copy.missingTopic);
  if (!can(role, 'comment')) throw new ApiError('forbidden', copy.readOnly);
  const body = readJson(ctx);
  if (body.voted === true) {
    await db.query(
      'insert into votes (map_id, topic_id, actor) values ($1, $2, $3) on conflict do nothing',
      [map.id, ctx.params.topic, actor.key],
    );
  } else {
    await db.query('delete from votes where map_id = $1 and topic_id = $2 and actor = $3', [
      map.id,
      ctx.params.topic,
      actor.key,
    ]);
  }
  const total = await db.query<{ total: string }>(
    'select count(*)::text as total from votes where map_id = $1 and topic_id = $2',
    [map.id, ctx.params.topic],
  );
  const voteCount = Number(total.rows[0].total);
  await publish(map.id, {
    type: 'vote',
    topics: [ctx.params.topic],
    payload: {
      topic_id: ctx.params.topic,
      vote_count: voteCount,
      by: actor.name,
      sentence: sentence.vote(actor.name, topic.title),
    },
  });
  return { status: 200, json: { vote_count: voteCount, voted: body.voted === true } };
});

route('GET', '/api/inbox', async (ctx) => {
  const actor = await requireActor(ctx);
  const rows = await db.query<{
    id: string;
    map_id: string;
    topic_id: string;
    comment_id: string;
    by_user: string;
    read: boolean;
  }>(
    'select id, map_id, topic_id, comment_id, by_user, read from mentions where username = $1 order by created_at desc',
    [actor.name],
  );
  return {
    status: 200,
    json: {
      mentions: rows.rows.map((row) => ({
        id: row.id,
        map_id: row.map_id,
        topic_id: row.topic_id,
        comment_id: row.comment_id,
        by: row.by_user,
        read: row.read,
      })),
      unread: rows.rows.filter((row) => !row.read).length,
    },
  };
});

route('POST', '/api/inbox/:id/read', async (ctx) => {
  const actor = await requireActor(ctx);
  await db.query('update mentions set read = true where id = $1 and username = $2', [
    ctx.params.id,
    actor.name,
  ]);
  const unread = await db.query<{ total: string }>(
    'select count(*)::text as total from mentions where username = $1 and not read',
    [actor.name],
  );
  return { status: 200, json: { unread: Number(unread.rows[0].total) } };
});
