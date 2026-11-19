import type pg from 'pg';
import { ApiError } from '../../shared/errors.ts';
import type { CommentInfo, MentionInfo, Role, ThreadInfo } from '../../shared/model.ts';
import { COPY, LIMITS, can } from '../../shared/rules.ts';
import { isRestricted } from '../../shared/tree.ts';
import { requirePrincipal } from '../auth.ts';
import { serverNow, toIso } from '../clock.ts';
import { database, query, withMapLock, type Db } from '../db.ts';
import { Effects, emitEvent } from '../groups.ts';
import type { Audience } from '../hub.ts';
import { bodyObject, json, route, type Ctx, type Principal } from '../http.ts';
import { randomId } from '../ids.ts';
import { accessMap, loadCounts, loadMap, type MapRow } from '../mapStore.ts';
import { resolveMap, scopeOf } from './maps.ts';

interface CommentRow {
  id: string;
  map_id: string;
  topic_id: string;
  author: string;
  body: string;
  reply_to: string | null;
  resolved: boolean;
  created_at: Date;
}

type NewComment = Pick<CommentRow, 'id' | 'topic_id' | 'author' | 'body'>;

const COLUMNS = 'id, map_id, topic_id, author, body, reply_to, resolved, created_at';

const commentInfo = (row: CommentRow): CommentInfo => ({ id: row.id, author: row.author, body: row.body, created_at: toIso(row.created_at.getTime()) });

/** The threads of one topic, oldest first, each with its replies. */
async function threadsOf(db: Db, mapId: string, topicId: string): Promise<ThreadInfo[]> {
  const rows = await query<CommentRow>(db, `SELECT ${COLUMNS} FROM comments WHERE map_id = $1 AND topic_id = $2 ORDER BY created_at, id`, [mapId, topicId]);
  return rows
    .filter((row) => row.reply_to === null)
    .map((root) => ({
      ...commentInfo(root),
      resolved: root.resolved,
      replies: rows.filter((row) => row.reply_to === root.id).map(commentInfo),
    }));
}

async function threadOf(db: Db, mapId: string, topicId: string, rootId: string): Promise<ThreadInfo> {
  const found = (await threadsOf(db, mapId, topicId)).find((thread) => thread.id === rootId);
  if (!found) throw new ApiError('not_found', 'That thread no longer exists.');
  return found;
}

async function unreadMentions(db: Db, personId: string): Promise<number> {
  const rows = await query<{ n: string }>(db, 'SELECT count(*) AS n FROM mentions WHERE user_id = $1 AND NOT read', [personId]);
  return Number(rows[0]?.n ?? 0);
}

/** A topic is absent for anyone who may not see it: deleted, or inside a restricted branch. */
function requireVisible(map: MapRow, role: Role, topicId: string): void {
  const topics = map.doc.topics;
  if (!topics[topicId] || (!can(role, 'see_restricted') && isRestricted(topics, topicId))) {
    throw new ApiError('not_found', COPY.missing_topic);
  }
}

/** Comments and votes on a topic reach everyone, or only those who may see restricted branches. */
const audienceFor = (map: MapRow, topicId: string): Audience => (isRestricted(map.doc.topics, topicId) ? 'privileged' : 'all');

const resolveTopic = async (ctx: Ctx): Promise<void> => {
  await resolveMap(ctx);
  const { map, role } = scopeOf(ctx);
  requireVisible(map, role, ctx.params.tid ?? '');
};

const authorizeComment = (ctx: Ctx): void => {
  if (!can(scopeOf(ctx).role, 'comment')) throw new ApiError('forbidden', 'Your role cannot comment or vote.');
};

/** The map as the transaction sees it, with the topic still on it. */
async function mapWithTopic(client: pg.PoolClient, mapId: string, topicId: string): Promise<MapRow> {
  const map = await loadMap(client, mapId);
  if (!map?.doc.topics[topicId]) throw new ApiError('not_found', COPY.missing_topic);
  return map;
}

/** Comments are counted in unresolved threads, so every change to a thread sends the topic's fresh count. */
async function emitComment(client: pg.PoolClient, map: MapRow, thread: ThreadInfo, topicId: string, by: Principal, fx: Effects): Promise<void> {
  const counts = await loadCounts(client, map.id, by.id);
  const message = { type: 'comment', topic_id: topicId, comment_count: counts.comments.get(topicId) ?? 0, thread, by: by.name } as const;
  await emitEvent(client, map.id, message, audienceFor(map, topicId), null, fx);
}

// ----------------------------------------------------------------- mentions

/** `@username` tokens, in the shape of a username. */
const MENTION = /@([a-z0-9_]{3,24})/g;

const mentionedNames = (body: string): string[] => [...new Set([...body.matchAll(MENTION)].flatMap((found) => (found[1] ? [found[1]] : [])))];

/** Give each named role holder, other than the author, an unread inbox item and tell them live. */
async function recordMentions(client: pg.PoolClient, map: MapRow, comment: NewComment, authorId: string, fx: Effects): Promise<void> {
  const names = mentionedNames(comment.body);
  if (names.length === 0) return;
  const hidden = isRestricted(map.doc.topics, comment.topic_id);
  const people = await query<{ id: string; role: Role | null }>(
    client,
    `SELECT u.id, CASE WHEN u.id = $1 THEN 'owner' ELSE x.role END AS role
     FROM users u LEFT JOIN members x ON x.user_id = u.id AND x.map_id = $2
     WHERE u.username = ANY($3)`,
    [map.owner_id, map.id, names],
  );
  for (const person of people) {
    if (!person.role || person.id === authorId || (hidden && !can(person.role, 'see_restricted'))) continue;
    await client.query(
      'INSERT INTO mentions (id, user_id, map_id, topic_id, comment_id, by_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [randomId(), person.id, map.id, comment.topic_id, comment.id, comment.author, toIso(serverNow())],
    );
    await emitEvent(client, map.id, { type: 'inbox', unread: await unreadMentions(client, person.id) }, 'user', person.id, fx);
  }
}

// ----------------------------------------------------------------- comments

route('GET', '/api/maps/:id/topics/:tid/comments', {
  stages: { authenticate: requirePrincipal, resolve: resolveTopic },
  handle: async (ctx) => json(200, { threads: await threadsOf(database(), scopeOf(ctx).map.id, ctx.params.tid ?? '') }),
});

/** The comment text a request carries: 1 to 2,000 characters. */
function requestedBody(ctx: Ctx): string {
  const value = bodyObject(ctx).body;
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 1 || Array.from(text).length > LIMITS.comment_chars) {
    throw new ApiError('invalid', 'A comment is 1 to 2,000 characters.', { fields: { body: 'A comment is 1 to 2,000 characters.' } });
  }
  return text;
}

/** The thread a request replies to, or null for a new thread. Replies to replies are refused. */
async function requestedThread(ctx: Ctx): Promise<string | null> {
  const target = bodyObject(ctx).reply_to;
  if (target === null || target === undefined) return null;
  const rows =
    typeof target === 'string'
      ? await query<CommentRow>(database(), `SELECT ${COLUMNS} FROM comments WHERE id = $1 AND map_id = $2 AND topic_id = $3`, [target, ctx.params.id, ctx.params.tid])
      : [];
  const thread = rows[0];
  if (!thread) throw new ApiError('invalid', 'That thread does not exist on this topic.', { fields: { reply_to: 'That thread does not exist on this topic.' } });
  if (thread.reply_to !== null) throw new ApiError('invalid', 'A reply cannot be replied to.', { fields: { reply_to: 'A reply cannot be replied to.' } });
  return thread.id;
}

route('POST', '/api/maps/:id/topics/:tid/comments', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveTopic,
    authorize: authorizeComment,
    validate: async (ctx) => {
      requestedBody(ctx);
      ctx.scope.replyTo = await requestedThread(ctx);
    },
  },
  handle: async (ctx) => {
    const principal = ctx.principal as Principal;
    const topicId = ctx.params.tid ?? '';
    const replyTo = ctx.scope.replyTo as string | null;
    const fx = new Effects();
    const comment = await withMapLock(scopeOf(ctx).map.id, async (client) => {
      const map = await mapWithTopic(client, scopeOf(ctx).map.id, topicId);
      const created: CommentInfo = { id: randomId(), author: principal.name, body: requestedBody(ctx), created_at: toIso(serverNow()) };
      await client.query('INSERT INTO comments (id, map_id, topic_id, author_id, author, body, reply_to, resolved, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)', [
        created.id,
        map.id,
        topicId,
        principal.id,
        created.author,
        created.body,
        replyTo,
        created.created_at,
      ]);
      const thread = await threadOf(client, map.id, topicId, replyTo ?? created.id);
      await emitComment(client, map, thread, topicId, principal, fx);
      await recordMentions(client, map, { ...created, topic_id: topicId }, principal.id, fx);
      return replyTo === null ? thread : created;
    });
    fx.run();
    return json(201, { comment });
  },
});

for (const action of ['resolve', 'reopen'] as const) {
  /** Resolving needs an open thread and reopening a resolved one. */
  const resolving = action === 'resolve';
  const assertFlips = (row: CommentRow): void => {
    if (row.resolved === resolving) throw new ApiError('invalid_transition', resolving ? 'That thread is already resolved.' : 'That thread is already open.');
  };

  route('POST', `/api/comments/:id/${action}`, {
    stages: {
      authenticate: requirePrincipal,
      resolve: async (ctx) => {
        const principal = ctx.principal as Principal;
        const rows = await query<CommentRow>(database(), `SELECT ${COLUMNS} FROM comments WHERE id = $1 AND reply_to IS NULL`, [ctx.params.id]);
        const thread = rows[0];
        if (!thread) throw new ApiError('not_found', 'That thread no longer exists.');
        const access = await accessMap(database(), thread.map_id, principal);
        requireVisible(access.map, access.role, thread.topic_id);
        ctx.scope.access = access;
        ctx.scope.thread = thread;
      },
      authorize: authorizeComment,
      state: (ctx) => assertFlips(ctx.scope.thread as CommentRow),
    },
    handle: async (ctx) => {
      const principal = ctx.principal as Principal;
      const { map_id, topic_id, id } = ctx.scope.thread as CommentRow;
      const fx = new Effects();
      const thread = await withMapLock(map_id, async (client) => {
        const map = await mapWithTopic(client, map_id, topic_id);
        const current = (await query<CommentRow>(client, `SELECT ${COLUMNS} FROM comments WHERE id = $1 FOR UPDATE`, [id]))[0];
        if (!current) throw new ApiError('not_found', 'That thread no longer exists.');
        assertFlips(current);
        await client.query('UPDATE comments SET resolved = $2 WHERE id = $1', [id, resolving]);
        const changed = await threadOf(client, map_id, topic_id, id);
        await emitComment(client, map, changed, topic_id, principal, fx);
        return changed;
      });
      fx.run();
      return json(200, { thread });
    },
  });
}

// -------------------------------------------------------------------- votes

route('PUT', '/api/maps/:id/topics/:tid/vote', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveTopic,
    authorize: authorizeComment,
    validate: (ctx) => {
      if (typeof bodyObject(ctx).voted !== 'boolean') throw new ApiError('invalid', 'voted must be true or false.', { fields: { voted: 'voted must be true or false.' } });
    },
  },
  handle: async (ctx) => {
    const principal = ctx.principal as Principal;
    const topicId = ctx.params.tid ?? '';
    const voted = bodyObject(ctx).voted === true;
    const fx = new Effects();
    const voteCount = await withMapLock(scopeOf(ctx).map.id, async (client) => {
      const map = await mapWithTopic(client, scopeOf(ctx).map.id, topicId);
      const changed = voted
        ? await client.query('INSERT INTO votes (map_id, topic_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [map.id, topicId, principal.id])
        : await client.query('DELETE FROM votes WHERE map_id = $1 AND topic_id = $2 AND user_id = $3', [map.id, topicId, principal.id]);
      const count = (await loadCounts(client, map.id, principal.id)).votes.get(topicId) ?? 0;
      if ((changed.rowCount ?? 0) > 0) {
        await emitEvent(client, map.id, { type: 'vote', topic_id: topicId, vote_count: count, by: principal.name, voted_by_me: null }, audienceFor(map, topicId), null, fx);
      }
      return count;
    });
    fx.run();
    return json(200, { vote_count: voteCount, voted });
  },
});

// -------------------------------------------------------------------- inbox

route('GET', '/api/inbox', {
  stages: { authenticate: requirePrincipal },
  handle: async (ctx) => {
    const personId = ctx.principal?.id ?? '';
    const rows = await query<Omit<MentionInfo, 'by'> & { by_name: string }>(
      database(),
      'SELECT id, map_id, topic_id, comment_id, by_name, read FROM mentions WHERE user_id = $1 ORDER BY created_at DESC, id',
      [personId],
    );
    const mentions: MentionInfo[] = rows.map((row) => ({ id: row.id, map_id: row.map_id, topic_id: row.topic_id, comment_id: row.comment_id, by: row.by_name, read: row.read }));
    return json(200, { mentions, unread: await unreadMentions(database(), personId) });
  },
});

route('POST', '/api/inbox/:id/read', {
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      const rows = await query<{ map_id: string }>(database(), 'SELECT map_id FROM mentions WHERE id = $1 AND user_id = $2', [ctx.params.id, ctx.principal?.id]);
      if (!rows[0]) throw new ApiError('not_found', 'That inbox item no longer exists.');
      ctx.scope.mapId = rows[0].map_id;
    },
  },
  handle: async (ctx) => {
    const personId = ctx.principal?.id ?? '';
    const fx = new Effects();
    const unread = await withMapLock(ctx.scope.mapId as string, async (client) => {
      const changed = await client.query('UPDATE mentions SET read = true WHERE id = $1 AND user_id = $2 AND NOT read', [ctx.params.id, personId]);
      const count = await unreadMentions(client, personId);
      if ((changed.rowCount ?? 0) > 0) await emitEvent(client, ctx.scope.mapId as string, { type: 'inbox', unread: count }, 'user', personId, fx);
      return count;
    });
    fx.run();
    return json(200, { unread });
  },
});
