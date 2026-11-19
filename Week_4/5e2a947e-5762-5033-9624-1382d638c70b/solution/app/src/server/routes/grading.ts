import { ApiError } from '../../shared/errors.ts';
import { emptyDoc, newTopic } from '../../shared/engine.ts';
import type { Boundary, DocTopic, Link, MapDoc, Role, TaskFields } from '../../shared/model.ts';
import { placeAmong } from '../../shared/tree.ts';
import { SESSION_COOKIE, createSession, createUser, findUser, sessionCookie } from '../auth.ts';
import { advanceClock, serverIso, serverNow, toIso } from '../clock.ts';
import { config, instanceId } from '../config.ts';
import { database, query } from '../db.ts';
import { bodyObject, execute, json, route, type Ctx } from '../http.ts';
import { randomId } from '../ids.ts';
import { createShareLink } from '../links.ts';
import { accessMap } from '../mapStore.ts';
import { createPresentation } from '../presentations.ts';
import { setStorageDown } from '../s3.ts';
import { runTick } from '../tick.ts';
import { saveVersion } from '../versions.ts';
import { opsRoute } from './ops.ts';

const gate = (): void => {
  if (!config.grading) throw new ApiError('not_found', 'Not found.');
};

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(record) : []);
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

function addNode(doc: MapDoc, node: Json, parentId: string | null, floating: boolean): DocTopic {
  const topic = newTopic(doc, str(node.id), parentId, str(node.title));
  topic.note = str(node.note);
  topic.icon = typeof node.icon === 'string' ? node.icon : null;
  topic.colour = typeof node.colour === 'string' ? node.colour : null;
  topic.shape = typeof node.shape === 'string' ? (node.shape as DocTopic['shape']) : null;
  topic.side_pin = node.side_pin === 'left' || node.side_pin === 'right' ? node.side_pin : null;
  topic.task = node.task ? (node.task as TaskFields) : null;
  topic.restricted = node.restricted === true;
  topic.locked_by = typeof node.locked_by === 'string' ? node.locked_by : null;
  if (floating) {
    topic.floating = true;
    topic.x = Number(node.x ?? 0);
    topic.y = Number(node.y ?? 0);
  }
  doc.topics[topic.id] = topic;
  if (parentId) placeAmong(doc.topics, parentId, topic, 'last');
  for (const child of list(node.children)) addNode(doc, child, topic.id, false);
  return topic;
}

function generate(doc: MapDoc, topics: number, fanout: number): void {
  for (let i = 0; i < topics; i += 1) {
    const parent = i === 0 ? null : Math.floor((i - 1) / fanout);
    const topic = newTopic(doc, `g${i}`, parent === null ? null : `g${parent}`, i === 0 ? 'Generated map' : `Topic ${i}`);
    doc.topics[topic.id] = topic;
    if (parent !== null) placeAmong(doc.topics, `g${parent}`, topic, 'last');
  }
}

async function userIds(names: string[]): Promise<Map<string, string>> {
  const rows = await query<{ id: string; username: string }>(database(), 'SELECT id, username FROM users WHERE username = ANY($1)', [names]);
  return new Map(rows.map((r) => [r.username, r.id]));
}

async function seedMap(entry: Json, ids: Map<string, string>): Promise<Json> {
  const owner = str(entry.owner);
  const ownerId = ids.get(owner);
  if (!ownerId) throw new ApiError('invalid', `Unknown owner ${owner}.`);
  const doc = emptyDoc();
  doc.layout = entry.layout === 'org' || entry.layout === 'list' ? entry.layout : 'map';
  doc.theme = entry.theme === 'paper' || entry.theme === 'dusk' ? entry.theme : 'daylight';
  const gen = record(entry.generate);
  if (typeof gen.topics === 'number') generate(doc, gen.topics, Number(gen.fanout ?? 2));
  else addNode(doc, record(entry.root), null, false);
  for (const floating of list(entry.floating)) addNode(doc, floating, null, true);
  doc.links = list(entry.links).map((l): Link => ({ id: str(l.id), from: str(l.from), to: str(l.to), label: str(l.label), type: l.type === 'depends' ? 'depends' : 'related' }));
  doc.boundaries = list(entry.boundaries).map((b): Boundary => ({ id: str(b.id), topic_id: str(b.topic_id), label: str(b.label) }));
  doc.slides = Array.isArray(entry.slides) ? entry.slides.map(String) : [];
  const mapId = randomId();
  const now = toIso(serverNow());
  const title = doc.topics[Object.values(doc.topics).find((t) => t.parent_id === null && !t.floating)?.id ?? '']?.title ?? 'Map';
  await query(database(), 'INSERT INTO maps (id, title, owner_id, revision, seq, doc, version_baseline, created_at, updated_at, home) VALUES ($1, $2, $3, 1, 0, $4, $5, $5, $5, $6)', [mapId, title, ownerId, JSON.stringify(doc), now, instanceId]);
  for (const role of list(entry.roles)) {
    const uid = ids.get(str(role.username));
    if (uid) await query(database(), 'INSERT INTO members (map_id, user_id, role) VALUES ($1, $2, $3)', [mapId, uid, str(role.role)]);
  }
  for (const c of list(entry.comments)) {
    const author = str(c.author);
    await query(database(), 'INSERT INTO comments (id, map_id, topic_id, author_id, author, body, reply_to, resolved, created_at) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)', [`${mapId}.${str(c.id)}`, mapId, str(c.topic_id), ids.get(author) ?? author, author, str(c.body), c.resolved === true, now]);
    for (const r of list(c.replies)) {
      const replier = str(r.author);
      await query(database(), 'INSERT INTO comments (id, map_id, topic_id, author_id, author, body, reply_to, resolved, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)', [`${mapId}.${str(r.id)}`, mapId, str(c.topic_id), ids.get(replier) ?? replier, replier, str(r.body), `${mapId}.${str(c.id)}`, now]);
    }
  }
  for (const v of list(entry.votes)) {
    const voter = str(v.username);
    await query(database(), 'INSERT INTO votes (map_id, topic_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [mapId, str(v.topic_id), ids.get(voter) ?? voter]);
  }
  const links: Record<string, string> = {};
  for (const link of list(entry.share_links)) {
    const role = str(link.role) as 'editor' | 'commenter' | 'viewer';
    const made = await createShareLink(database(), { mapId, role, expiresAt: typeof link.expires_in_ms === 'number' ? serverNow() + link.expires_in_ms : null });
    links[role] = made.code;
  }
  const versions: string[] = [];
  for (const v of list(entry.versions)) {
    const made = await saveVersion({ mapId, name: str(v.name, 'Seeded'), kind: 'named', by: str(v.by, owner), doc, revision: 1 });
    versions.push(made.id);
  }
  const presenting = entry.presentation ? await createPresentation(database(), { mapId, presenterId: ownerId, presenterName: owner }) : null;
  return { id: mapId, links, versions, presentation: presenting };
}

route('POST', '/api/grading/seed', {
  body: 'json',
  stages: { resolve: gate, validate: (ctx) => void bodyObject(ctx) },
  handle: async (ctx) => {
    const body = bodyObject(ctx);
    const users: Record<string, string> = {};
    for (const u of list(body.users)) {
      const name = str(u.username);
      const row = (await findUser(name)) ?? (await createUser(name, str(u.password)));
      users[name] = row.id;
    }
    const ids = await userIds([...Object.keys(users), ...list(body.maps).map((m) => str(m.owner))]);
    const maps: Record<string, Json> = {};
    for (const entry of list(body.maps)) maps[str(entry.key)] = await seedMap(entry, ids);
    return json(201, { users, maps });
  },
});

route('POST', '/api/grading/session', {
  body: 'json',
  stages: { resolve: gate, validate: (ctx) => void bodyObject(ctx) },
  handle: async (ctx) => {
    const user = await findUser(str(bodyObject(ctx).username));
    if (!user) throw new ApiError('not_found', 'Unknown user.');
    const session = await createSession(user.id);
    return json(200, { user: { id: user.id, username: user.username } }, { 'set-cookie': sessionCookie(SESSION_COOKIE, session.token, config.sessionTtlMs) });
  },
});

route('POST', '/api/grading/clock', {
  body: 'json',
  stages: {
    resolve: gate,
    validate: (ctx) => {
      if (typeof bodyObject(ctx).advance_ms !== 'number') throw new ApiError('invalid', 'advance_ms must be a number.');
    },
  },
  handle: async (ctx) => {
    advanceClock(Number(bodyObject(ctx).advance_ms));
    await runTick();
    return json(200, { server_time: serverIso() });
  },
});

route('POST', '/api/grading/storage', {
  body: 'json',
  stages: {
    resolve: gate,
    validate: (ctx) => {
      if (typeof bodyObject(ctx).down !== 'boolean') throw new ApiError('invalid', 'down must be true or false.');
    },
  },
  handle: async (ctx) => {
    const down = bodyObject(ctx).down === true;
    setStorageDown(down);
    return json(200, { storage: down ? 'down' : 'up' });
  },
});

route('POST', '/api/grading/maps/:id/ops', {
  body: 'json',
  stages: { resolve: gate, validate: (ctx) => void bodyObject(ctx) },
  handle: async (ctx) => {
    const body = bodyObject(ctx);
    const user = await findUser(str(body.as));
    if (!user) throw new ApiError('not_found', 'Unknown user.');
    const principal: NonNullable<Ctx['principal']> = { id: user.id, name: user.username, guest: false, guestMap: null, guestRole: null, expiresAt: null };
    const inner: Ctx = { ...ctx, principal, scope: {}, body: { group_id: body.group_id, base_revision: body.base_revision, ops: body.ops } };
    const { map, role } = await accessMap(database(), ctx.params.id ?? '', principal);
    inner.scope.access = { map, role: role as Role };
    return execute(opsRoute, inner, true);
  },
});
