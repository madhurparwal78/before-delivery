import type { PoolClient } from 'pg';
import type { Services } from '../services.js';
import type { Ctx } from '../ctx.js';
import { ApiError, NOTICES } from '../errors.js';
import { json, noContent, requireUser, rateLimit } from '../api.js';
import { may } from '../../shared/permissions.js';
import { loadMapState, type LoadedMap } from '../context.js';
import { applyGroupPipeline, randomUUID } from '../groups.js';
import { computeRollups, computeBlocked } from '../../shared/tasks.js';
import { resolveColour, resolveShape, textColourForFill, BRANCH_COLOURS } from '../../shared/style.js';
import { publicSettings } from '../../shared/settings.js';
import { nowIso, serverDate, now } from '../clock.js';
import type {
  MapPayload, MapMeta, Role, Topic, TopicNode, CrossLink, Boundary, Derived, Operation, CommentThread, VersionInfo, VersionSnapshot,
} from '../../shared/types.js';
import { descendantsOf, type MapState, type StoreTopic } from '../engine.js';
import { serialiseOutline, topicsToOutline, parseOutline, type OutlineTopic } from '../../shared/outline.js';
import { layoutMap } from '../../shared/layout.js';
import { storageCall, attachmentKey, exportKey, versionKey, importKey, sha256 } from '../storage.js';

/**
 * Everything under /api/maps/:id. The permission table gates each
 * action, and every error goes through the one writer.
 */

export async function roleOnMap(svc: Services, mapId: string, username: string | null, guestToken?: string | null): Promise<Role | null> {
  const owner = await svc.db.one<{ owner_id: string; username: string }>(
    'SELECT m.owner_id, u.username FROM maps m JOIN users u ON u.id = m.owner_id WHERE m.id = $1', [mapId],
  );
  if (!owner) return null;
  if (username && owner.username === username) return 'owner';
  if (guestToken) {
    const g = await svc.db.one<{ role: string }>('SELECT role FROM guests WHERE token = $1 AND map_id = $2', [guestToken, mapId]);
    if (g) return g.role as Role;
  }
  if (username) {
    const m = await svc.db.one<{ role: string }>('SELECT role FROM members WHERE map_id = $1 AND username = $2', [mapId, username]);
    if (m) return m.role as Role;
  }
  return null;
}

function randomToken(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function linkRowToPayload(r: { id: string; code: string; role: string; expires_at: string | null; state: string }): { id: string; code: string; role: string; expires_at: string | null; state: string; url: string } {
  return { id: r.id, code: r.code, role: r.role, expires_at: r.expires_at, state: r.state, url: `/s/${r.code}` };
}

function versionRow(r: { id: string; number: number; name: string; kind: string; by: string; revision: string | number; created_at: Date }): VersionInfo {
  return {
    id: r.id, number: Number(r.number), name: r.name, kind: r.kind as VersionInfo['kind'],
    by: r.by, revision: Number(r.revision), created_at: r.created_at.toISOString(),
  };
}

/** Narrow a stored topic row to the published TopicNode shape. */
export function asTopicNode(t: StoreTopic): TopicNode {
  return {
    ...t,
    icon: t.icon as TopicNode['icon'],
    shape: t.shape as TopicNode['shape'],
    side_pin: t.side_pin as TopicNode['side_pin'],
    task: t.task as TopicNode['task'],
    lock_inherited: false,
    comment_count: 0,
    vote_count: 0,
    voted: false,
    attachments: t.attachments.map((a) => ({ ...a, state: 'stored' as const })),
  };
}

export async function mapRoutes(ctx: Ctx, svc: Services, mapId: string, rest: string): Promise<void> {
  const method = ctx.method;
  const u = ctx.user;

  if (rest === '' && method === 'GET') {
    const role = await roleOnMap(svc, mapId, u?.username ?? null, ctx.guest?.token ?? null);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    const loaded = await loadMapState(svc.db, mapId);
    json(ctx.res, 200, await mapPayloadFor(loaded, role, svc, u?.username ?? ctx.guest?.username ?? null));
    return;
  }
  if (rest === '' && method === 'DELETE') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'delete_map')) throw new ApiError('forbidden', NOTICES.readOnly);
    await svc.db.query('DELETE FROM maps WHERE id = $1', [mapId]);
    return noContent(ctx.res);
  }
  if (rest === '/ops' && method === 'POST') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'edit')) throw new ApiError('forbidden', NOTICES.readOnly);
    await rateLimit(svc, 'op', `${user.username}:${mapId}`);
    const body = ctx.body as { group_id?: string; base_revision?: number; ops?: Operation[] };
    if (!body.group_id || typeof body.base_revision !== 'number' || !Array.isArray(body.ops)) {
      throw new ApiError('invalid', 'Invalid group.');
    }
    const beforeState = (await loadMapState(svc.db, mapId)).state;
    const out = await applyGroupPipeline({
      svc, mapId, user: user.username, role, groupId: body.group_id,
      baseRevision: body.base_revision, ops: body.ops,
    });
    if (out.response.status === 'applied' || out.response.status === 'merged') {
      const inverse = inverseOf(body.ops, beforeState);
      svc.hub.broadcast(mapId, 'op', {
        author: user.username,
        revision: out.newRevision,
        ops: body.ops,
        sentence: out.sentence,
        group_id: body.group_id,
      });
      if (inverse && may(role, 'edit')) {
        await pushUndoEntry(svc, mapId, user.username, body.ops, inverse);
      }
    }
    json(ctx.res, 200, out.response);
    return;
  }
  if (rest === '/undo' && method === 'POST') return undoRedo(ctx, svc, mapId, 'undo');
  if (rest === '/redo' && method === 'POST') return undoRedo(ctx, svc, mapId, 'redo');
  if (rest === '/collapse' && method === 'PUT') {
    const who = ctx.user?.username ?? ctx.guest?.username;
    if (!who) throw new ApiError('unauthenticated', 'Sign in to continue.');
    const role = await roleOnMap(svc, mapId, ctx.user?.username ?? null, ctx.guest?.token ?? null);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    const body = ctx.body as { topic_id?: string; collapsed?: boolean };
    if (!body.topic_id) throw new ApiError('not_found', NOTICES.unknownMap);
    const loaded = await loadMapState(svc.db, mapId);
    if (!loaded.state.topics.has(body.topic_id)) throw new ApiError('not_found', NOTICES.unknownMap);
    if (body.collapsed) {
      await svc.db.query('INSERT INTO collapsed (map_id, username, topic_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [mapId, who, body.topic_id]);
    } else {
      await svc.db.query('DELETE FROM collapsed WHERE map_id = $1 AND username = $2 AND topic_id = $3', [mapId, who, body.topic_id]);
    }
    return noContent(ctx.res);
  }
  if (rest === '/activity' && method === 'GET') {
    const role = await roleOnMap(svc, mapId, ctx.user?.username ?? null, ctx.guest?.token ?? null);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    const person = ctx.query.get('person');
    const rows = person
      ? await svc.db.query('SELECT seq, "user", sentence, topic_id, created_at FROM activity WHERE map_id = $1 AND "user" = $2 ORDER BY seq DESC LIMIT 200', [mapId, person])
      : await svc.db.query('SELECT seq, "user", sentence, topic_id, created_at FROM activity WHERE map_id = $1 ORDER BY seq DESC LIMIT 200', [mapId]);
    json(ctx.res, 200, {
      entries: rows.rows.map((r) => ({ seq: Number(r.seq), user: r.user, sentence: r.sentence, topic_id: r.topic_id, at: r.created_at.toISOString() })),
    });
    return;
  }
  if (rest === '/members' && method === 'GET') {
    const role = await roleOnMap(svc, mapId, ctx.user?.username ?? null, ctx.guest?.token ?? null);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    const rows = await svc.db.query<{ username: string; role: string }>(
      'SELECT username, role FROM members WHERE map_id = $1 ORDER BY username', [mapId],
    );
    const owner = await svc.db.one<{ username: string }>('SELECT u.username FROM maps m JOIN users u ON u.id = m.owner_id WHERE m.id = $1', [mapId]);
    const members = [{ username: owner?.username ?? '', role: 'owner' }];
    for (const r of rows.rows) members.push({ username: r.username, role: r.role });
    json(ctx.res, 200, { members });
    return;
  }
  if (rest.startsWith('/members/') && method === 'PUT') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'manage')) throw new ApiError('forbidden', NOTICES.readOnly);
    const target = decodeURIComponent(rest.split('/')[2]);
    const body = ctx.body as { role?: string };
    if (!body.role || !['editor', 'commenter', 'viewer'].includes(body.role)) {
      throw new ApiError('invalid', 'Invalid role.', { fields: { role: 'Role must be editor, commenter or viewer.' } });
    }
    const owner = await svc.db.one<{ username: string }>('SELECT u.username FROM maps m JOIN users u ON u.id = m.owner_id WHERE m.id = $1', [mapId]);
    if (target === owner?.username) throw new ApiError('invalid', 'The owner cannot be downgraded.');
    const exists = await svc.db.one('SELECT id FROM users WHERE username = $1', [target]);
    if (!exists) throw new ApiError('invalid', 'Unknown user.', { fields: { username: 'No such user.' } });
    await svc.db.query(
      'INSERT INTO members (map_id, username, role) VALUES ($1,$2,$3) ON CONFLICT (map_id, username) DO UPDATE SET role = $3',
      [mapId, target, body.role],
    );
    svc.hub.broadcast(mapId, 'role', { username: target, role: body.role });
    json(ctx.res, 200, { member: { username: target, role: body.role } });
    return;
  }
  if (rest.startsWith('/members/') && method === 'DELETE') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'manage')) throw new ApiError('forbidden', NOTICES.readOnly);
    const target = decodeURIComponent(rest.split('/')[2]);
    await svc.db.query('DELETE FROM members WHERE map_id = $1 AND username = $2', [mapId, target]);
    svc.hub.broadcast(mapId, 'access_removed', { username: target });
    return noContent(ctx.res);
  }
  if (rest === '/links' && method === 'POST') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'manage')) throw new ApiError('forbidden', NOTICES.readOnly);
    const body = ctx.body as { role?: string; expires_at?: string | null };
    if (!body.role || !['editor', 'commenter', 'viewer'].includes(body.role)) {
      throw new ApiError('invalid', 'Invalid role.', { fields: { role: 'Role must be editor, commenter or viewer.' } });
    }
    if (body.expires_at) {
      const d = new Date(body.expires_at);
      if (Number.isNaN(d.getTime()) || d.getTime() <= now().getTime()) {
        throw new ApiError('invalid', 'Invalid expiry.', { fields: { expires_at: 'Expiry must be a future instant.' } });
      }
    }
    const id = randomUUID();
    const code = randomToken();
    await svc.db.query('INSERT INTO share_links (id, map_id, code, role, expires_at, state) VALUES ($1,$2,$3,$4,$5,$6)', [
      id, mapId, code, body.role, body.expires_at ?? null, 'active',
    ]);
    json(ctx.res, 201, { link: linkRowToPayload({ id, code, role: body.role, expires_at: body.expires_at ?? null, state: 'active' }) });
    return;
  }
  if (rest === '/links' && method === 'GET') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'manage')) throw new ApiError('forbidden', NOTICES.readOnly);
    const rows = await svc.db.query<{ id: string; code: string; role: string; expires_at: string | null; state: string }>('SELECT id, code, role, expires_at, state FROM share_links WHERE map_id = $1 ORDER BY created_at', [mapId]);
    json(ctx.res, 200, { links: rows.rows.map(linkRowToPayload) });
    return;
  }
  const lr = rest.match(/^\/links\/([^/]+)(\/regenerate)?$/);
  if (lr) {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'manage')) throw new ApiError('forbidden', NOTICES.readOnly);
    const lid = lr[1];
    const link = await svc.db.one<{ id: string; code: string; role: string; expires_at: string | null; state: string }>(
      'SELECT id, code, role, expires_at, state FROM share_links WHERE id = $1 AND map_id = $2', [lid, mapId],
    );
    if (!link) throw new ApiError('not_found', NOTICES.unknownMap);
    if (method === 'POST' && lr[2] === '/regenerate') {
      if (link.state !== 'active') throw new ApiError('invalid_transition', 'The link has already ended.');
      const code = randomToken();
      await svc.db.query("UPDATE share_links SET state = 'revoked' WHERE id = $1", [lid]);
      const id2 = randomUUID();
      await svc.db.query('INSERT INTO share_links (id, map_id, code, role, expires_at, state) VALUES ($1,$2,$3,$4,$5,$6)', [
        id2, mapId, code, link.role, link.expires_at, 'active',
      ]);
      svc.hub.broadcast(mapId, 'link_expired', { code: link.code, reason: 'link_revoked' });
      await svc.db.query('DELETE FROM guests WHERE link_id = $1', [lid]);
      json(ctx.res, 200, { link: linkRowToPayload({ ...link, id: id2, code, state: 'active' }) });
      return;
    }
    if (method === 'DELETE') {
      if (link.state !== 'active') throw new ApiError('invalid_transition', 'The link has already ended.');
      await svc.db.query("UPDATE share_links SET state = 'revoked' WHERE id = $1", [lid]);
      svc.hub.broadcast(mapId, 'link_expired', { code: link.code, reason: 'link_revoked' });
      await svc.db.query('DELETE FROM guests WHERE link_id = $1', [lid]);
      return noContent(ctx.res);
    }
  }
  if (rest === '/presentations' && method === 'POST') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'present')) throw new ApiError('forbidden', NOTICES.readOnly);
    const existing = await svc.db.one<{ id: string }>("SELECT id FROM presentations WHERE map_id = $1 AND state IN ('waiting','live','paused')", [mapId]);
    if (existing) throw new ApiError('already_presenting', 'A session is already running.');
    const id = randomUUID();
    const code = randomToken();
    await svc.db.query("INSERT INTO presentations (id, map_id, code, state, slide_index, presenter, last_presenter_seen) VALUES ($1,$2,$3,'waiting',0,$4,$5)", [
      id, mapId, code, user.username, nowIso(),
    ]);
    json(ctx.res, 201, { presentation: { id, code, state: 'waiting', slide_index: 0, followers: 0, map_id: mapId } });
    return;
  }
  if (rest === '/versions' && method === 'GET') {
    const role = await roleOnMap(svc, mapId, ctx.user?.username ?? null, ctx.guest?.token ?? null);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    const rows = await svc.db.query<{ id: string; number: number; name: string; kind: string; by: string; revision: string; created_at: Date }>('SELECT id, number, name, kind, "by", revision, created_at FROM versions WHERE map_id = $1 ORDER BY number', [mapId]);
    json(ctx.res, 200, { versions: rows.rows.map(versionRow) });
    return;
  }
  if (rest === '/versions' && method === 'POST') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'save_version')) throw new ApiError('forbidden', NOTICES.readOnly);
    const body = ctx.body as { name?: string };
    const name = (body.name ?? '').trim();
    if (name.length < 1 || [...name].length > 60) throw new ApiError('invalid', 'Invalid name.', { fields: { name: 'Name must be 1 to 60 characters.' } });
    const version = await saveVersion(svc, mapId, user.username, name, 'named');
    if (!version) throw new ApiError('storage_unavailable', NOTICES.versionOutage);
    svc.hub.broadcast(mapId, 'version', { version });
    json(ctx.res, 201, { version });
    return;
  }
  if (rest === '/versions/diff' && method === 'GET') {
    const role = await roleOnMap(svc, mapId, ctx.user?.username ?? null, ctx.guest?.token ?? null);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    const from = ctx.query.get('from');
    const to = ctx.query.get('to');
    if (!from || !to) throw new ApiError('invalid', 'Missing version ids.');
    json(ctx.res, 200, await versionDiff(svc, mapId, from, to));
    return;
  }
  const vr = rest.match(/^\/versions\/([^/?]+)$/);
  if (vr && method === 'GET') {
    const role = await roleOnMap(svc, mapId, ctx.user?.username ?? null, ctx.guest?.token ?? null);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    const row = await svc.db.one<{ id: string; number: number; name: string; kind: string; by: string; revision: string; created_at: Date }>('SELECT id, number, name, kind, "by", revision, created_at FROM versions WHERE map_id = $1 AND id = $2', [mapId, vr[1]]);
    if (!row) throw new ApiError('not_found', NOTICES.unknownMap);
    const snapshot = await loadSnapshot(svc, mapId, row.id);
    json(ctx.res, 200, { version: versionRow(row), snapshot });
    return;
  }
  const rr = rest.match(/^\/versions\/([^/]+)\/restore$/);
  if (rr && method === 'POST') {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    if (!may(role, 'restore')) throw new ApiError('forbidden', NOTICES.readOnly);
    return restoreVersion(ctx, svc, mapId, rr[1], user.username);
  }
  const tr = rest.match(/^\/topics\/([^/]+)\/(comments|vote|attachments)$/);
  if (tr) {
    return topicRoutes(ctx, svc, mapId, tr[1], tr[2]);
  }
  const recv = rest.match(/^\/recovered\/([^/]+)(\/reapply)?$/);
  if (recv) {
    const user = await requireUser(ctx);
    const role = await roleOnMap(svc, mapId, user.username);
    if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
    const entry = await svc.db.one<{ id: string; text: string; kind: string; from_title: string; parent_id: string; username: string }>(
      'SELECT id, text, kind, from_title, parent_id, username FROM recovered WHERE id = $1 AND map_id = $2 AND username = $3',
      [recv[1], mapId, user.username],
    );
    if (!entry) throw new ApiError('not_found', NOTICES.unknownMap);
    if (method === 'DELETE') {
      await svc.db.query('DELETE FROM recovered WHERE id = $1', [entry.id]);
      return noContent(ctx.res);
    }
    if (method === 'POST' && recv[2] === '/reapply') {
      if (!may(role, 'edit')) throw new ApiError('forbidden', NOTICES.readOnly);
      const loaded = await loadMapState(svc.db, mapId);
      let parent: string | null = entry.parent_id;
      while (parent !== null && !loaded.state.topics.has(parent)) {
        parent = loaded.state.topics.get(parent)?.parent_id ?? null;
      }
      if (parent === null || !loaded.state.topics.has(parent)) {
        const root = [...loaded.state.topics.values()].find((t) => t.parent_id === null && !t.floating);
        parent = root?.id ?? null;
      }
      if (parent === null) throw new ApiError('not_found', NOTICES.unknownMap);
      const topicId = `t-${randomUUID().slice(0, 8)}`;
      const ops: Operation[] = [{
        op_id: `o-${randomUUID()}`, kind: 'add',
        topic_id: topicId, parent_id: parent, after: null,
        title: entry.kind === 'note' ? 'Recovered note' : entry.text,
      }];
      if (entry.kind === 'note') {
        ops.push({ op_id: `o-${randomUUID()}`, kind: 'note', topic_id: topicId, text: entry.text });
      }
      const out = await applyGroupPipeline({
        svc, mapId, user: user.username, role, groupId: `g-${randomUUID()}`,
        baseRevision: loaded.state.revision, ops,
        sentenceKind: 're-apply', sentenceExtra: { otherTitle: loaded.state.topics.get(parent)?.title ?? '' },
      });
      await svc.db.query('DELETE FROM recovered WHERE id = $1', [entry.id]);
      svc.hub.broadcast(mapId, 'op', { author: user.username, revision: out.newRevision, ops, sentence: out.sentence, group_id: out.response.group_id });
      json(ctx.res, 200, out.response);
      return;
    }
  }
  if (rest === '/imports' && method === 'POST') {
    return importOutline(ctx, svc, mapId);
  }
  const ir = rest.match(/^\/imports\/([^/]+)\/graft$/);
  if (ir && method === 'POST') {
    return graftImport(ctx, svc, mapId, ir[1]);
  }
  if (rest === '/paste' && method === 'POST') {
    return pasteTopics(ctx, svc, mapId);
  }
  if (rest === '/exports' && method === 'POST') {
    return createExport(ctx, svc, mapId);
  }
  throw new ApiError('not_found', NOTICES.unknownPage);
}

async function topicRoutes(ctx: Ctx, svc: Services, mapId: string, topicId: string, action: string): Promise<void> {
  const method = ctx.method;
  const u = ctx.user;
  const role = await roleOnMap(svc, mapId, u?.username ?? null, ctx.guest?.token ?? null);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  const loaded = await loadMapState(svc.db, mapId);
  const t = loaded.state.topics.get(topicId);
  if (!t || (t.restricted && !may(role, 'see_restricted'))) throw new ApiError('not_found', NOTICES.unknownMap);

  if (action === 'comments' && method === 'GET') {
    json(ctx.res, 200, { threads: await loadComments(svc, mapId, topicId) });
    return;
  }
  if (action === 'comments' && method === 'POST') {
    const user = await requireUser(ctx);
    if (!may(role, 'comment')) throw new ApiError('forbidden', NOTICES.readOnly);
    const body = ctx.body as { body?: string; reply_to?: string | null };
    const text = body.body ?? '';
    if (text.length < 1 || text.length > 2000) throw new ApiError('invalid', 'Invalid comment.', { fields: { body: 'Comment must be 1 to 2,000 characters.' } });
    if (body.reply_to) {
      const parent = await svc.db.one<{ reply_to: string | null }>('SELECT reply_to FROM comments WHERE id = $1', [body.reply_to]);
      if (!parent) throw new ApiError('not_found', NOTICES.unknownMap);
      if (parent.reply_to !== null) throw new ApiError('invalid', 'Replies to replies are not allowed.', { fields: { reply_to: 'Threads have one level of replies.' } });
    }
    const id = randomUUID();
    await svc.db.query('INSERT INTO comments (id, map_id, topic_id, author, body, reply_to) VALUES ($1,$2,$3,$4,$5,$6)', [
      id, mapId, topicId, user.username, text, body.reply_to ?? null,
    ]);
    const mentioned = [...text.matchAll(/@([a-z0-9_]{3,24})/g)].map((m) => m[1]);
    const members = await svc.db.query<{ username: string }>('SELECT username FROM members WHERE map_id = $1', [mapId]);
    const owner = await svc.db.one<{ username: string }>('SELECT u.username FROM maps m JOIN users u ON u.id = m.owner_id WHERE m.id = $1', [mapId]);
    const names = new Set([...members.rows.map((r) => r.username), owner?.username ?? '']);
    for (const name of mentioned) {
      if (!names.has(name) || name === user.username) continue;
      await svc.db.query('INSERT INTO mentions (id, map_id, topic_id, comment_id, "by", username) VALUES ($1,$2,$3,$4,$5,$6)', [
        randomUUID(), mapId, topicId, id, user.username, name,
      ]);
    }
    const threads = await loadComments(svc, mapId, topicId);
    svc.hub.broadcast(mapId, 'comment', { topic_id: topicId, threads });
    const foundThread = threads.find((th) => th.id === id);
    const foundReply = threads.flatMap((th) => th.replies).find((r) => r.id === id);
    json(ctx.res, 201, { comment: foundReply ?? foundThread ?? null });
    return;
  }
  if (action === 'vote' && method === 'PUT') {
    const user = await requireUser(ctx);
    if (!may(role, 'vote')) throw new ApiError('forbidden', NOTICES.readOnly);
    const body = ctx.body as { voted?: boolean };
    if (body.voted) {
      await svc.db.query('INSERT INTO votes (map_id, topic_id, username) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [mapId, topicId, user.username]);
    } else {
      await svc.db.query('DELETE FROM votes WHERE map_id = $1 AND topic_id = $2 AND username = $3', [mapId, topicId, user.username]);
    }
    const count = await voteCount(svc, mapId, topicId);
    svc.hub.broadcast(mapId, 'vote', { topic_id: topicId, vote_count: count });
    json(ctx.res, 200, { vote_count: count, voted: Boolean(body.voted) });
    return;
  }
  if (action === 'attachments' && method === 'POST') {
    const user = await requireUser(ctx);
    if (!may(role, 'attach')) throw new ApiError('forbidden', NOTICES.readOnly);
    const bytes = ctx.rawBody ?? Buffer.alloc(0);
    if (bytes.length > svc.settings.attach_max_bytes) throw new ApiError('too_large', NOTICES.attachTooLarge(svc.settings.attach_max_bytes));
    const type = sniffImage(bytes);
    if (!type) throw new ApiError('wrong_type', NOTICES.attachWrongType);
    const sha = sha256(bytes);
    const existing = await svc.db.one<{ n: string }>(
      `SELECT COALESCE(sum(bytes),0)::text AS n FROM (SELECT DISTINCT ON (sha256) sha256, bytes FROM attachments WHERE map_id = $1 AND state='stored') d`,
      [mapId],
    );
    if (Number(existing?.n ?? 0) + bytes.length > svc.settings.map_quota_bytes) {
      throw new ApiError('quota_exceeded', NOTICES.attachQuota(svc.settings.map_quota_bytes));
    }
    const id = randomUUID();
    const key = attachmentKey(mapId, sha, type);
    const stored = await storageCall({ s3: svc.s3, down: svc.storageDown }, (s3) => s3.put(key, bytes, type === 'png' ? 'image/png' : 'image/jpeg'));
    if (!stored?.ok) throw new ApiError('storage_unavailable', NOTICES.storageOutageFiles);
    await svc.db.query("INSERT INTO attachments (id, map_id, topic_id, sha256, bytes, type, state) VALUES ($1,$2,$3,$4,$5,$6,'stored')", [
      id, mapId, topicId, sha, bytes.length, type,
    ]);
    json(ctx.res, 201, { attachment: { id, sha256: sha, bytes: bytes.length, type, state: 'stored' } });
    return;
  }
  throw new ApiError('not_found', NOTICES.unknownPage);
}

function sniffImage(bytes: Buffer): 'png' | 'jpg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

export async function voteCount(svc: Services, mapId: string, topicId: string): Promise<number> {
  const r = await svc.db.one<{ n: string }>('SELECT count(*)::text AS n FROM votes WHERE map_id = $1 AND topic_id = $2', [mapId, topicId]);
  return Number(r?.n ?? 0);
}

export async function loadComments(svc: Services, mapId: string, topicId: string): Promise<CommentThread[]> {
  const rows = await svc.db.query<{ id: string; author: string; body: string; resolved: boolean; created_at: Date; reply_to: string | null }>(
    'SELECT id, author, body, resolved, created_at, reply_to FROM comments WHERE map_id = $1 AND topic_id = $2 AND reply_to IS NULL ORDER BY created_at',
    [mapId, topicId],
  );
  const replies = await svc.db.query<{ id: string; author: string; body: string; created_at: Date; reply_to: string }>(
    'SELECT id, author, body, created_at, reply_to FROM comments WHERE map_id = $1 AND topic_id = $2 AND reply_to IS NOT NULL ORDER BY created_at',
    [mapId, topicId],
  );
  const byParent = new Map<string, typeof replies.rows>();
  for (const r of replies.rows) {
    const arr = byParent.get(r.reply_to) ?? [];
    arr.push(r);
    byParent.set(r.reply_to, arr);
  }
  return rows.rows.map((r) => ({
    id: r.id, author: r.author, body: r.body, resolved: r.resolved, created_at: r.created_at.toISOString(),
    replies: (byParent.get(r.id) ?? []).map((x) => ({ id: x.id, author: x.author, body: x.body, created_at: x.created_at.toISOString() })),
  }));
}

// ---- payload construction ----------------------------------------------


export interface MapPayloadOut { map: MapMeta; topics: Topic[]; links: CrossLink[]; boundaries: Boundary[]; collapsed: string[]; slides: string[]; recovered: unknown[]; server_time: string; server_date: string; settings: Record<string, number> }

export async function mapPayloadFor(
  loaded: LoadedMap,
  role: Role,
  svc: Services,
  viewer: string | null,
): Promise<MapPayloadOut> {
  const { state } = loaded;
  const canSeeRestricted = may(role, 'see_restricted');
  const visible = new Set<string>();
  for (const t of state.topics.values()) {
    if (t.restricted && !canSeeRestricted) continue;
    visible.add(t.id);
  }
  const topics: TopicNode[] = [...state.topics.values()]
    .filter((t) => visible.has(t.id))
    .map(asTopicNode);
  const links = [...state.links.values()].filter((l) => visible.has(l.from) && visible.has(l.to));
  const boundaries = [...state.boundaries.values()].filter((b) => visible.has(b.topic_id));
  // Comment and vote counts are recomputed from current data on every read.
  const commentRows = await svc.db.query<{ topic_id: string; n: string }>(
    `SELECT c.topic_id, count(*)::text AS n FROM comments c
     WHERE c.map_id = $1 AND c.resolved = FALSE
     AND NOT EXISTS (SELECT 1 FROM comments r WHERE r.reply_to = c.id AND r.resolved = TRUE)
     GROUP BY c.topic_id`,
    [loaded.meta.id],
  );
  const commentCounts = new Map(commentRows.rows.map((r) => [r.topic_id, Number(r.n)]));
  const voteRows = await svc.db.query<{ topic_id: string; username: string }>(
    'SELECT topic_id, username FROM votes WHERE map_id = $1', [loaded.meta.id],
  );
  const voteCounts = new Map<string, number>();
  const votes = new Set<string>();
  for (const r of voteRows.rows) {
    voteCounts.set(r.topic_id, (voteCounts.get(r.topic_id) ?? 0) + 1);
    votes.add(`${r.topic_id}:${r.username}`);
  }
  const derived = deriveAll(topics, links, state.layout, state.theme, serverDate());
  const withDerived: Topic[] = topics.map((t) => ({
    ...t,
    derived: derived.get(t.id)!,
    comment_count: commentCounts.get(t.id) ?? 0,
    vote_count: voteCounts.get(t.id) ?? 0,
    voted: viewer !== null && votes.has(`${t.id}:${viewer}`),
  }));
  const ownerRow = await svc.db.one<{ username: string }>(
    'SELECT u.username FROM maps m JOIN users u ON u.id = m.owner_id WHERE m.id = $1', [loaded.meta.id],
  );
  const owner = ownerRow?.username ?? '';
  const collapsed = viewer !== null
    ? (await svc.db.query<{ topic_id: string }>('SELECT topic_id FROM collapsed WHERE map_id = $1 AND username = $2', [loaded.meta.id, viewer])).rows.map((r) => r.topic_id)
    : [];
  const recoveredRows = viewer !== null
    ? (await svc.db.query('SELECT id, text, kind, from_title, parent_id FROM recovered WHERE map_id = $1 AND username = $2 ORDER BY created_at', [loaded.meta.id, viewer])).rows
    : [];
  return {
    map: {
      id: loaded.meta.id, title: loaded.meta.title, revision: state.revision,
      layout: state.layout, theme: state.theme, owner, role,
      custom_colours: state.customColours,
    },
    topics: withDerived,
    links,
    boundaries,
    collapsed,
    slides: state.slides.filter((s) => visible.has(s)),
    recovered: recoveredRows,
    server_time: nowIso(),
    server_date: serverDate(),
    settings: publicSettings(svc.settings) as unknown as Record<string, number>,
  };
}

/** Compute derived values for the visible topic set. */
export function deriveAll(
  topics: TopicNode[],
  links: CrossLink[],
  layout: string,
  theme: 'daylight' | 'paper' | 'dusk',
  today: string,
): Map<string, Derived> {
  void layout;
  const { percent, earliestDue } = computeRollups(topics);
  const { blockedBy, blockedCount } = computeBlocked(topics, links);
  const byId = new Map(topics.map((t) => [t.id, t]));
  const byParent = new Map<string, TopicNode[]>();
  for (const t of topics) {
    const arr = byParent.get(t.parent_id ?? '') ?? [];
    arr.push(t);
    byParent.set(t.parent_id ?? '', arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.rank - b.rank);
  const mainRoot = topics.find((t) => t.parent_id === null && !t.floating);
  const rootKids = byParent.get(mainRoot?.id ?? '') ?? [];
  const branchColour = new Map<string, string>();
  rootKids.forEach((k, i) => { branchColour.set(k.id, BRANCH_COLOURS[i % 8]); });
  const floaters = topics.filter((t) => t.floating);
  const out = new Map<string, Derived>();
  const walk = (t: TopicNode, ancestors: TopicNode[], floaterIndex: number | null): void => {
    const level2 = findLevel2(t, byId);
    let colour: string;
    if (t.parent_id === null) {
      colour = t.floating ? BRANCH_COLOURS[(floaterIndex ?? 0) % 8] : 'accent';
    } else {
      colour = resolveColour(t, ancestors, branchColour.get(level2?.id ?? '') ?? null, floaterIndex);
    }
    const shape = resolveShape(t, ancestors, theme);
    const text = (shape === 'filled' || shape === 'rounded') ? textColourForFill(colour) : 'ink';
    const subtopics = descendantsCount(t.id, byParent);
    const due = earliestDue.get(t.id) ?? null;
    out.set(t.id, {
      colour, shape, text,
      percent: percent.get(t.id) ?? null,
      earliest_due: due,
      overdue: due !== null && due < today,
      blocked_by: blockedBy.get(t.id) ?? [],
      blocked_count: blockedCount.get(t.id) ?? 0,
      subtopics,
    });
    for (const c of byParent.get(t.id) ?? []) walk(c, [...ancestors, t], floaterIndex);
  };
  if (mainRoot) walk(mainRoot, [], null);
  floaters.forEach((f, i) => walk(f, [], i));
  return out;
}

function findLevel2(t: TopicNode, byId: Map<string, TopicNode>): TopicNode | null {
  let cur: TopicNode | null = t;
  while (cur && cur.parent_id !== null) {
    const parent = byId.get(cur.parent_id);
    if (!parent) return null;
    if (parent.parent_id === null && !parent.floating) return cur;
    cur = parent;
  }
  return null;
}

function descendantsCount(id: string, byParent: Map<string, TopicNode[]>): number {
  let n = 0;
  const walk = (tid: string) => {
    for (const c of byParent.get(tid) ?? []) { n += 1; walk(c.id); }
  };
  walk(id);
  return n;
}

// ---- undo / redo --------------------------------------------------------

interface UndoEntry {
  ops: Operation[];
  inverse: Operation[];
  at: string;
}

async function undoRedo(ctx: Ctx, svc: Services, mapId: string, dir: 'undo' | 'redo'): Promise<void> {
  const user = await requireUser(ctx);
  const role = await roleOnMap(svc, mapId, user.username);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  if (!may(role, 'edit')) throw new ApiError('forbidden', NOTICES.readOnly);
  const stackRow = await svc.db.one<{ position: number; entries: UndoEntry[]; redo: UndoEntry[] }>(
    'SELECT position, entries, redo FROM undo_stack WHERE map_id = $1 AND username = $2',
    [mapId, user.username],
  );
  const entries = (stackRow?.entries ?? []) as UndoEntry[];
  const redo = (stackRow?.redo ?? []) as UndoEntry[];
  let position = stackRow?.position ?? entries.length;

  if (dir === 'undo') {
    if (position === 0 || entries.length === 0) {
      const cur = (await loadMapState(svc.db, mapId)).state.revision;
      json(ctx.res, 200, { status: 'empty', revision: cur, focus_topic_id: null, notice: NOTICES.nothingToUndo });
      return;
    }
    let skippedNotice: string | null = null;
    while (position > 0) {
      const entry = entries[position - 1];
      const skip = await someoneElseTouched(svc, mapId, user.username, entry);
      if (skip) {
        skippedNotice = NOTICES.undoSkipped(skip.user, skip.title);
        entries.splice(position - 1, 1);
        position -= 1;
        continue;
      }
      const loaded = await loadMapState(svc.db, mapId);
      const out = await applyGroupPipeline({
        svc, mapId, user: user.username, role, groupId: `g-${randomUUID()}`,
        baseRevision: loaded.state.revision, ops: entry.inverse, skipLocks: true,
        sentenceKind: 'undo', sentenceExtra: { otherTitle: '' },
      });
      if (out.response.status === 'rejected' || out.response.status === 'recovered') {
        json(ctx.res, 200, { status: 'skipped', revision: out.response.revision, focus_topic_id: null, notice: out.response.notice });
        return;
      }
      entries.splice(position - 1, 1);
      redo.push(entry);
      position -= 1;
      await persistStack(svc, mapId, user.username, entries, redo, position);
      svc.hub.broadcast(mapId, 'op', { author: user.username, revision: out.newRevision, ops: entry.inverse, sentence: out.sentence, group_id: out.response.group_id });
      json(ctx.res, 200, { status: 'undone', revision: out.newRevision, focus_topic_id: out.topicId, notice: NOTICES.undoDone });
      return;
    }
    const cur = (await loadMapState(svc.db, mapId)).state.revision;
    await persistStack(svc, mapId, user.username, entries, redo, entries.length);
    json(ctx.res, 200, { status: 'empty', revision: cur, focus_topic_id: null, notice: skippedNotice ?? NOTICES.nothingToUndo });
    return;
  }

  const entry = redo.pop();
  if (!entry) {
    const cur = (await loadMapState(svc.db, mapId)).state.revision;
    json(ctx.res, 200, { status: 'empty', revision: cur, focus_topic_id: null, notice: NOTICES.nothingToRedo });
    return;
  }
  const redoOps = reId(entry.ops);
  const skip = await someoneElseTouched(svc, mapId, user.username, entry);
  if (skip) {
    const cur = (await loadMapState(svc.db, mapId)).state.revision;
    await persistStack(svc, mapId, user.username, entries, redo, entries.length);
    json(ctx.res, 200, { status: 'skipped', revision: cur, focus_topic_id: null, notice: NOTICES.redoSkipped(skip.user, skip.title) });
    return;
  }
  const loaded = await loadMapState(svc.db, mapId);
  const out = await applyGroupPipeline({
    svc, mapId, user: user.username, role, groupId: `g-${randomUUID()}`,
    baseRevision: loaded.state.revision, ops: redoOps, skipLocks: true,
    sentenceKind: 'redo', sentenceExtra: { otherTitle: '' },
  });
  entries.push(entry);
  await persistStack(svc, mapId, user.username, entries, redo, entries.length);
  svc.hub.broadcast(mapId, 'op', { author: user.username, revision: out.newRevision, ops: redoOps, sentence: out.sentence, group_id: out.response.group_id });
  json(ctx.res, 200, { status: 'redone', revision: out.newRevision, focus_topic_id: out.topicId, notice: NOTICES.redoDone });
}

/** Fresh operation ids for a replayed group, so it is not read as a resend. */
function reId(ops: Operation[]): Operation[] {
  return ops.map((op) => ({ ...op, op_id: `o-${randomUUID()}` }));
}

async function someoneElseTouched(svc: Services, mapId: string, me: string, entry: UndoEntry): Promise<{ user: string; title: string } | null> {
  const ids = new Set(entry.ops.map((o) => o.topic_id ?? o.parent_id).filter((x): x is string => Boolean(x)));
  if (ids.size === 0) return null;
  const state = (await loadMapState(svc.db, mapId)).state;
  const titles = new Map<string, string>();
  for (const t of state.topics.values()) titles.set(t.id, t.title);
  const log = await svc.db.query<{ ops: Operation[]; author: string }>(
    'SELECT ops, author FROM op_log WHERE map_id = $1 AND author <> $2 ORDER BY seq DESC LIMIT 500',
    [mapId, me],
  );
  const lastMine = entry.at;
  for (const row of log.rows) {
    for (const op of row.ops) {
      if (!op.topic_id || !ids.has(op.topic_id)) continue;
      if (op.kind === 'title' || op.kind === 'note' || op.kind === 'task' || op.kind === 'move') {
        void lastMine;
        return { user: row.author, title: titles.get(op.topic_id) ?? op.topic_id };
      }
    }
  }
  return null;
}

async function persistStack(svc: Services, mapId: string, username: string, entries: UndoEntry[], redo: UndoEntry[], position: number): Promise<void> {
  const trimmed = entries.slice(-svc.settings.undo_depth);
  await svc.db.query(
    `INSERT INTO undo_stack (map_id, username, position, entries, redo) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (map_id, username) DO UPDATE SET position = $3, entries = $4, redo = $5`,
    [mapId, username, Math.min(position, trimmed.length), JSON.stringify(trimmed), JSON.stringify(redo)],
  );
}

/** Record an undoable group onto the author's stack (and clears redo). */
export async function pushUndoEntry(svc: Services, mapId: string, username: string, ops: Operation[], inverse: Operation[]): Promise<void> {
  const row = await svc.db.one<{ position: number; entries: UndoEntry[]; redo: UndoEntry[] }>(
    'SELECT position, entries, redo FROM undo_stack WHERE map_id = $1 AND username = $2', [mapId, username],
  );
  const entries = (row?.entries ?? []) as UndoEntry[];
  const trimmed = [...entries, { ops, inverse, at: nowIso() }].slice(-svc.settings.undo_depth);
  await persistStack(svc, mapId, username, trimmed, [], trimmed.length);
}

/** Build the inverse of a group where possible; null for kinds that are not undoable through inverse ops. */
export function inverseOf(ops: Operation[], beforeState: MapState): Operation[] | null {
  const out: Operation[] = [];
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    switch (op.kind) {
      case 'add': case 'add_floating': {
        out.push({ op_id: `o-${randomUUID()}`, kind: 'delete', topic_id: op.topic_id });
        break;
      }
      case 'delete': {
        const t = beforeState.topics.get(op.topic_id!);
        if (!t) return null;
        out.push({ op_id: `o-${randomUUID()}`, kind: t.floating ? 'add_floating' : 'add', topic_id: t.id, parent_id: t.parent_id, after: null, title: t.title, x: t.x ?? undefined, y: t.y ?? undefined });
        break;
      }
      case 'title': {
        const t = beforeState.topics.get(op.topic_id!);
        if (!t) return null;
        const chars = [...t.title];
        out.push({ op_id: `o-${randomUUID()}`, kind: 'title', topic_id: op.topic_id, offset: op.offset!, delete: [...op.insert!].length, insert: chars.slice(op.offset!, op.offset! + op.delete!).join('') });
        break;
      }
      case 'note': {
        const t = beforeState.topics.get(op.topic_id!);
        if (!t) return null;
        out.push({ op_id: `o-${randomUUID()}`, kind: 'note', topic_id: op.topic_id, text: t.note });
        break;
      }
      case 'move': {
        const t = beforeState.topics.get(op.topic_id!);
        if (!t) return null;
        const sibs = [...beforeState.topics.values()].filter((x) => x.parent_id === t.parent_id && x.rank < t.rank).sort((a, b) => a.rank - b.rank);
        out.push({ op_id: `o-${randomUUID()}`, kind: 'move', topic_id: op.topic_id, parent_id: t.parent_id, after: sibs.at(-1)?.id ?? null });
        break;
      }
      case 'task': {
        const t = beforeState.topics.get(op.topic_id!);
        if (!t) return null;
        out.push({ op_id: `o-${randomUUID()}`, kind: 'task', topic_id: op.topic_id, task: t.task as Operation['task'] });
        break;
      }
      case 'style': {
        const t = beforeState.topics.get(op.topic_id!);
        if (!t) return null;
        out.push({ op_id: `o-${randomUUID()}`, kind: 'style', topic_id: op.topic_id, colour: t.colour, shape: t.shape as Operation['shape'], icon: t.icon as Operation['icon'] });
        break;
      }
      case 'pin': {
        const t = beforeState.topics.get(op.topic_id!);
        if (!t) return null;
        out.push({ op_id: `o-${randomUUID()}`, kind: 'pin', topic_id: op.topic_id, side: t.side_pin as 'left' | 'right' | null });
        break;
      }
      case 'layout': {
        out.push({ op_id: `o-${randomUUID()}`, kind: 'layout', layout: beforeState.layout });
        break;
      }
      case 'theme': {
        out.push({ op_id: `o-${randomUUID()}`, kind: 'theme', theme: beforeState.theme });
        break;
      }
      case 'link_add': {
        out.push({ op_id: `o-${randomUUID()}`, kind: 'link_remove', link_id: op.link_id });
        break;
      }
      case 'link_remove': {
        const l = beforeState.links.get(op.link_id!);
        if (!l) return null;
        out.push({ op_id: `o-${randomUUID()}`, kind: 'link_add', link_id: l.id, from: l.from, to: l.to, label: l.label, type: l.type });
        break;
      }
      case 'boundary_add': {
        out.push({ op_id: `o-${randomUUID()}`, kind: 'boundary_remove', boundary_id: op.boundary_id });
        break;
      }
      case 'boundary_remove': {
        const b = beforeState.boundaries.get(op.boundary_id!);
        if (!b) return null;
        out.push({ op_id: `o-${randomUUID()}`, kind: 'boundary_add', boundary_id: b.id, topic_id: b.topic_id, label: b.label });
        break;
      }
      case 'slides': {
        out.push({ op_id: `o-${randomUUID()}`, kind: 'slides', order: [...beforeState.slides] });
        break;
      }
      case 'float_move': {
        const t = beforeState.topics.get(op.topic_id!);
        if (!t) return null;
        out.push({ op_id: `o-${randomUUID()}`, kind: 'float_move', topic_id: op.topic_id, x: t.x ?? 0, y: t.y ?? 0 });
        break;
      }
      case 'lock': case 'unlock': case 'restrict': case 'custom_colour': {
        return null; // not undoable
      }
      default: return null;
    }
  }
  return out;
}

// ---- versions -----------------------------------------------------------

export async function saveVersion(svc: Services, mapId: string, by: string, name: string, kind: 'auto' | 'named' | 'restore'): Promise<VersionInfo | null> {
  const loaded = await loadMapState(svc.db, mapId);
  const state = loaded.state;
  const topics: TopicNode[] = [...state.topics.values()].map(asTopicNode);
  const num = await svc.db.one<{ n: string }>('SELECT coalesce(max(number),0)+1 AS n FROM versions WHERE map_id = $1', [mapId]);
  const number = Number(num?.n ?? 1);
  const id = randomUUID();
  const snapshot: VersionSnapshot = {
    format: 'sprigmap-version-1',
    map_id: mapId,
    version: number,
    revision: state.revision,
    layout: state.layout,
    theme: state.theme,
    topics,
    links: [...state.links.values()],
    boundaries: [...state.boundaries.values()],
    slides: [...state.slides],
  };
  const key = versionKey(mapId, id);
  const stored = await storageCall({ s3: svc.s3, down: svc.storageDown }, (s3) => s3.put(key, Buffer.from(JSON.stringify(snapshot), 'utf8'), 'application/json'));
  if (!stored?.ok) return null;
  await svc.db.query('INSERT INTO versions (id, map_id, number, name, kind, "by", revision, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    id, mapId, number, name, kind, by, state.revision, nowIso(),
  ]);
  return { id, number, name, kind, by, revision: state.revision, created_at: nowIso() };
}

export async function loadSnapshot(svc: Services, mapId: string, versionId: string): Promise<VersionSnapshot | null> {
  const stored = await storageCall({ s3: svc.s3, down: svc.storageDown }, (s3) => s3.get(versionKey(mapId, versionId)));
  if (!stored?.ok || !stored.bytes) return null;
  try {
    return JSON.parse(stored.bytes.toString('utf8')) as VersionSnapshot;
  } catch {
    return null;
  }
}

async function versionDiff(svc: Services, mapId: string, fromId: string, toId: string): Promise<{ added: string[]; removed: string[]; moved: string[]; edited: string[]; summary: string }> {
  const rows = await svc.db.query<{ id: string; number: number }>('SELECT id, number FROM versions WHERE map_id = $1 AND id = ANY($2)', [mapId, [fromId, toId]]);
  const rowA = rows.rows.find((r) => r.id === fromId);
  const rowB = rows.rows.find((r) => r.id === toId);
  if (!rowA || !rowB) throw new ApiError('not_found', NOTICES.unknownMap);
  const a = rowA.number <= rowB.number ? rowA : rowB;
  const b = rowA.number <= rowB.number ? rowB : rowA;
  const snapA = await loadSnapshot(svc, mapId, a.id);
  const snapB = await loadSnapshot(svc, mapId, b.id);
  const idsA = new Map((snapA?.topics ?? []).map((t) => [t.id, t]));
  const idsB = new Map((snapB?.topics ?? []).map((t) => [t.id, t]));
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const edited: string[] = [];
  for (const [id, t] of idsB) {
    const prev = idsA.get(id);
    if (!prev) { added.push(id); continue; }
    const siblingsB = [...idsB.values()].filter((x) => x.parent_id === t.parent_id && idsA.has(x.id)).sort((x, y) => x.rank - y.rank);
    const siblingsA = [...idsA.values()].filter((x) => x.parent_id === prev.parent_id && idsB.has(x.id)).sort((x, y) => x.rank - y.rank);
    const rankB = siblingsB.findIndex((x) => x.id === id);
    const rankA = siblingsA.findIndex((x) => x.id === id);
    if (t.parent_id !== prev.parent_id || rankB !== rankA || t.x !== prev.x || t.y !== prev.y) moved.push(id);
    if (t.title !== prev.title || t.note !== prev.note || JSON.stringify(t.task) !== JSON.stringify(prev.task)
      || t.colour !== prev.colour || t.shape !== prev.shape || t.icon !== prev.icon) edited.push(id);
  }
  for (const id of idsA.keys()) if (!idsB.has(id)) removed.push(id);
  return {
    added, removed, moved, edited,
    summary: NOTICES.diffSummary(added.length, removed.length, moved.length, edited.length),
  };
}

async function restoreVersion(ctx: Ctx, svc: Services, mapId: string, versionId: string, user: string): Promise<void> {
  const row = await svc.db.one<{ id: string; number: number; name: string }>('SELECT id, number, name FROM versions WHERE map_id = $1 AND id = $2', [mapId, versionId]);
  if (!row) throw new ApiError('not_found', NOTICES.unknownMap);
  const snap = await loadSnapshot(svc, mapId, versionId);
  if (!snap) throw new ApiError('storage_unavailable', NOTICES.restoreOutage);
  const loaded = await loadMapState(svc.db, mapId);
  const state = loaded.state;
  const ops: Operation[] = [];
  const snapById = new Map(snap.topics.map((t) => [t.id, t]));
  for (const t of state.topics.values()) {
    if (!snapById.has(t.id)) ops.push({ op_id: `o-${randomUUID()}`, kind: 'delete', topic_id: t.id });
  }
  for (const t of snap.topics) {
    const cur = state.topics.get(t.id);
    if (!cur) {
      ops.push({ op_id: `o-${randomUUID()}`, kind: t.floating ? 'add_floating' : 'add', topic_id: t.id, parent_id: t.parent_id, after: null, title: t.title, x: t.x ?? undefined, y: t.y ?? undefined });
    } else {
      if (cur.title !== t.title) {
        ops.push({ op_id: `o-${randomUUID()}`, kind: 'title', topic_id: t.id, offset: 0, delete: [...cur.title].length, insert: t.title });
      }
      if (cur.parent_id !== t.parent_id) {
        ops.push({ op_id: `o-${randomUUID()}`, kind: 'move', topic_id: t.id, parent_id: t.parent_id, after: null });
      }
      if (cur.note !== t.note) ops.push({ op_id: `o-${randomUUID()}`, kind: 'note', topic_id: t.id, text: t.note });
      if (JSON.stringify(cur.task) !== JSON.stringify(t.task)) ops.push({ op_id: `o-${randomUUID()}`, kind: 'task', topic_id: t.id, task: t.task as Operation['task'] });
      if (cur.colour !== t.colour || cur.shape !== t.shape || cur.icon !== t.icon) {
        ops.push({ op_id: `o-${randomUUID()}`, kind: 'style', topic_id: t.id, colour: t.colour, shape: t.shape as Operation['shape'], icon: t.icon as Operation['icon'] });
      }
    }
  }
  const byParentSnap = new Map<string, TopicNode[]>();
  for (const t of snap.topics) {
    const key = t.parent_id ?? '';
    const arr = byParentSnap.get(key) ?? [];
    arr.push(t);
    byParentSnap.set(key, arr);
  }
  for (const arr of byParentSnap.values()) {
    arr.sort((x, y) => x.rank - y.rank);
    for (let i = 1; i < arr.length; i += 1) {
      ops.push({ op_id: `o-${randomUUID()}`, kind: 'move', topic_id: arr[i].id, parent_id: arr[i].parent_id, after: arr[i - 1].id });
    }
  }
  for (const l of snap.links) {
    if (!state.links.has(l.id)) ops.push({ op_id: `o-${randomUUID()}`, kind: 'link_add', link_id: l.id, from: l.from, to: l.to, label: l.label, type: l.type });
  }
  for (const id of state.links.keys()) {
    if (!snap.links.some((l) => l.id === id)) ops.push({ op_id: `o-${randomUUID()}`, kind: 'link_remove', link_id: id });
  }
  for (const b of snap.boundaries) {
    if (!state.boundaries.has(b.id)) ops.push({ op_id: `o-${randomUUID()}`, kind: 'boundary_add', boundary_id: b.id, topic_id: b.topic_id, label: b.label });
  }
  for (const id of state.boundaries.keys()) {
    if (!snap.boundaries.some((b) => b.id === id)) ops.push({ op_id: `o-${randomUUID()}`, kind: 'boundary_remove', boundary_id: id });
  }
  if (state.layout !== snap.layout) ops.push({ op_id: `o-${randomUUID()}`, kind: 'layout', layout: snap.layout });
  if (state.theme !== snap.theme) ops.push({ op_id: `o-${randomUUID()}`, kind: 'theme', theme: snap.theme });
  if (JSON.stringify(state.slides) !== JSON.stringify(snap.slides)) {
    ops.push({ op_id: `o-${randomUUID()}`, kind: 'slides', order: snap.slides });
  }
  const out = await applyGroupPipeline({
    svc, mapId, user, role: 'owner', groupId: `g-${randomUUID()}`,
    baseRevision: state.revision, ops,
    sentenceKind: 'restore', sentenceExtra: { versionNumber: row.number },
    skipLocks: true,
  });
  if (out.response.status === 'rejected' || out.response.status === 'recovered') {
    throw new ApiError('invalid', out.response.notice ?? 'The restore was refused.');
  }
  const version = await saveVersion(svc, mapId, user, `Restored from version ${row.number}`, 'restore');
  svc.hub.broadcast(mapId, 'op', { author: user, revision: out.newRevision, ops, sentence: out.sentence, group_id: out.response.group_id });
  if (version) svc.hub.broadcast(mapId, 'version', { version });
  json(ctx.res, 200, { ...out.response, version });
}

// ---- imports, paste, exports -------------------------------------------

async function importOutline(ctx: Ctx, svc: Services, mapId: string): Promise<void> {
  const user = await requireUser(ctx);
  const role = await roleOnMap(svc, mapId, user.username);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  if (!may(role, 'import')) throw new ApiError('forbidden', NOTICES.readOnly);
  const bytes = ctx.rawBody ?? Buffer.alloc(0);
  if (bytes.length > svc.settings.outline_max_bytes) throw new ApiError('too_large', `This file is larger than ${svc.settings.outline_max_bytes} bytes.`);
  const text = bytes.toString('utf8');
  if (text.includes('\uFFFD')) throw new ApiError('invalid_outline', 'The file is not UTF-8 text.', { lines: ['The file is not UTF-8 text.'] });
  const parsed = parseOutline(bytes);
  if (!parsed.ok) {
    throw new ApiError('invalid_outline', NOTICES.importErrorHeading, { lines: parsed.errors.map((e) => e.message) });
  }
  const sha = sha256(bytes);
  const id = randomUUID();
  const stored = await storageCall({ s3: svc.s3, down: svc.storageDown }, (s3) => s3.put(importKey(mapId, sha), bytes, 'text/plain; charset=utf-8'));
  if (!stored?.ok) throw new ApiError('storage_unavailable', NOTICES.storageOutageFiles);
  const count = countOutline(parsed.topics);
  await svc.db.query('INSERT INTO imports (id, map_id, sha256, bytes, topic_count, preview) VALUES ($1,$2,$3,$4,$5,$6)', [
    id, mapId, sha, bytes.length, count, JSON.stringify(parsed.topics),
  ]);
  json(ctx.res, 201, { import: { id, sha256: sha, bytes: bytes.length, topic_count: count }, preview: parsed.topics });
}

function countOutline(topics: OutlineTopic[]): number {
  let n = 0;
  for (const t of topics) n += 1 + countOutline(t.children);
  return n;
}

async function graftImport(ctx: Ctx, svc: Services, mapId: string, importId: string): Promise<void> {
  const user = await requireUser(ctx);
  const role = await roleOnMap(svc, mapId, user.username);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  if (!may(role, 'import')) throw new ApiError('forbidden', NOTICES.readOnly);
  const row = await svc.db.one<{ id: string; preview: OutlineTopic[] }>('SELECT id, preview FROM imports WHERE id = $1 AND map_id = $2', [importId, mapId]);
  if (!row) throw new ApiError('not_found', NOTICES.unknownMap);
  const body = ctx.body as { parent_id?: string; group_id?: string; base_revision?: number };
  if (!body.parent_id || !body.group_id || typeof body.base_revision !== 'number') throw new ApiError('invalid', 'Invalid graft.');
  const loaded = await loadMapState(svc.db, mapId);
  const parent = loaded.state.topics.get(body.parent_id);
  if (!parent) throw new ApiError('not_found', NOTICES.unknownMap);
  const ops: Operation[] = [];
  const addTree = (t: OutlineTopic, parentId: string, after: string | null): { id: string; last: string | null } => {
    const id = `t-${randomUUID().slice(0, 12)}`;
    ops.push({ op_id: `o-${randomUUID()}`, kind: 'add', topic_id: id, parent_id: parentId, after, title: t.title });
    if (t.note) ops.push({ op_id: `o-${randomUUID()}`, kind: 'note', topic_id: id, text: t.note });
    if (t.task) {
      const task: Record<string, unknown> = { percent: t.task.percent };
      if (t.task.weight !== 1) task.weight = t.task.weight;
      if (t.task.state !== 'open') task.state = t.task.state;
      if (t.task.priority !== 'normal') task.priority = t.task.priority;
      if (t.task.due) task.due = t.task.due;
      if (t.task.assignee) task.assignee = t.task.assignee;
      ops.push({ op_id: `o-${randomUUID()}`, kind: 'task', topic_id: id, task: task as Operation['task'] });
    }
    if (t.icon || t.colour) ops.push({ op_id: `o-${randomUUID()}`, kind: 'style', topic_id: id, colour: t.colour, shape: null, icon: t.icon as Operation['icon'] });
    let prev: string | null = null;
    for (const c of t.children) {
      const res = addTree(c, id, prev);
      prev = res.last ?? prev;
    }
    return { id, last: id };
  };
  let topAfter: string | null = null;
  const graftedRoots: string[] = [];
  for (const top of row.preview) {
    const res = addTree(top, body.parent_id, topAfter);
    topAfter = res.last;
    graftedRoots.push(res.id);
  }
  const total = countOutline(row.preview);
  const out = await applyGroupPipeline({
    svc, mapId, user: user.username, role, groupId: body.group_id,
    baseRevision: body.base_revision, ops,
    sentenceKind: 'graft', sentenceExtra: { count: total, otherTitle: parent.title },
  });
  svc.hub.broadcast(mapId, 'op', { author: user.username, revision: out.newRevision, ops, sentence: out.sentence, group_id: body.group_id });
  json(ctx.res, 200, { ...out.response, grafted_roots: graftedRoots });
}

export interface ClipTree {
  id: string;
  title: string;
  note: string;
  icon: string | null;
  colour: string | null;
  task: Record<string, unknown> | null;
  children: ClipTree[];
}

async function pasteTopics(ctx: Ctx, svc: Services, mapId: string): Promise<void> {
  const user = await requireUser(ctx);
  const role = await roleOnMap(svc, mapId, user.username);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  if (!may(role, 'paste')) throw new ApiError('forbidden', NOTICES.readOnly);
  const body = ctx.body as { parent_id?: string; group_id?: string; base_revision?: number };
  if (!body.parent_id || !body.group_id || typeof body.base_revision !== 'number') throw new ApiError('invalid', 'Invalid paste.');
  const clip = await svc.db.one<{ topics: ClipTree[] }>('SELECT topics FROM clipboards WHERE username = $1', [user.username]);
  if (!clip || clip.topics.length === 0) throw new ApiError('clipboard_empty', NOTICES.nothingToPaste);
  const loaded = await loadMapState(svc.db, mapId);
  const parent = loaded.state.topics.get(body.parent_id);
  if (!parent) throw new ApiError('not_found', NOTICES.unknownMap);
  const ops: Operation[] = [];
  const addTree = (t: ClipTree, parentId: string): void => {
    const id = `t-${randomUUID().slice(0, 12)}`;
    ops.push({ op_id: `o-${randomUUID()}`, kind: 'add', topic_id: id, parent_id: parentId, after: null, title: t.title });
    if (t.note) ops.push({ op_id: `o-${randomUUID()}`, kind: 'note', topic_id: id, text: t.note });
    if (t.task) ops.push({ op_id: `o-${randomUUID()}`, kind: 'task', topic_id: id, task: t.task as Operation['task'] });
    if (t.icon || t.colour) ops.push({ op_id: `o-${randomUUID()}`, kind: 'style', topic_id: id, colour: t.colour, shape: null, icon: t.icon as Operation['icon'] });
    for (const c of t.children) addTree(c, id);
  };
  for (const t of clip.topics) addTree(t, body.parent_id);
  const total = ops.filter((o) => o.kind === 'add').length;
  const out = await applyGroupPipeline({
    svc, mapId, user: user.username, role, groupId: body.group_id,
    baseRevision: body.base_revision, ops,
    sentenceKind: 'paste', sentenceExtra: { count: total, otherTitle: parent.title },
  });
  svc.hub.broadcast(mapId, 'op', { author: user.username, revision: out.newRevision, ops, sentence: out.sentence, group_id: body.group_id });
  json(ctx.res, 200, out.response);
}

async function createExport(ctx: Ctx, svc: Services, mapId: string): Promise<void> {
  const role = await roleOnMap(svc, mapId, ctx.user?.username ?? null, ctx.guest?.token ?? null);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  const body = ctx.body as { format?: string; topic_id?: string | null };
  if (body.format !== 'sprig' && body.format !== 'svg') throw new ApiError('invalid', 'Invalid format.', { fields: { format: 'Format must be sprig or svg.' } });
  const id = randomUUID();
  await svc.db.query("INSERT INTO exports (id, map_id, state, progress, format, topic_id, next_step_at) VALUES ($1,$2,'queued',0,$3,$4,$5)", [
    id, mapId, body.format, body.topic_id ?? null, new Date(now().getTime() + svc.settings.export_step_ms).toISOString(),
  ]);
  json(ctx.res, 202, { export: { id, state: 'queued', progress: 0, format: body.format, download_url: null } });
}

export { randomToken, versionRow, linkRowToPayload, countOutline };
