import { randomUUID } from 'node:crypto';
import type { Services } from './services.js';
import type { Ctx } from './ctx.js';
import { ApiError, NOTICES } from './errors.js';
import { json, setCookie } from './api.js';
import { advanceClock, now, nowIso } from './clock.js';
import { hashPassword } from './passwords.js';
import { applyGroupPipeline } from './groups.js';
import { roleOnMap } from './routes/maps.js';
import type { Operation, Role } from '../shared/types.js';
import { may } from '../shared/permissions.js';
import { loadMapState } from './context.js';

/**
 * The grading routes. They exist only while SPRIG_GRADING is 1 and
 * apply through the same rules as the public routes.
 */

interface SeedTopic {
  id: string;
  title: string;
  note?: string;
  icon?: string | null;
  colour?: string | null;
  shape?: string | null;
  side_pin?: string | null;
  task?: Record<string, unknown> | null;
  restricted?: boolean;
  locked_by?: string | null;
  children?: SeedTopic[];
}

interface SeedMap {
  key: string;
  owner: string;
  layout?: string;
  theme?: string;
  root?: SeedTopic;
  generate?: { topics: number; fanout: number } | null;
  floating?: { id: string; title: string; x: number; y: number; children?: SeedTopic[] }[];
  links?: { id: string; from: string; to: string; label?: string; type?: string }[];
  boundaries?: { id: string; topic_id: string; label?: string }[];
  roles?: { username: string; role: string }[];
  comments?: { id: string; topic_id: string; author: string; body: string; resolved?: boolean; replies?: { id: string; author: string; body: string }[] }[];
  votes?: { topic_id: string; username: string }[];
  share_links?: { role: string; expires_in_ms: number }[];
  versions?: { name: string; by: string }[];
  slides?: string[];
  presentation?: { state: string } | null;
}

export async function seedRoutes(ctx: Ctx, svc: Services): Promise<void> {
  const p = ctx.path;
  const method = ctx.method;

  if (p === '/api/grading/seed' && method === 'POST') return seed(ctx, svc);
  if (p === '/api/grading/session' && method === 'POST') return session(ctx, svc);
  if (p === '/api/grading/clock' && method === 'POST') return clock(ctx, svc);
  if (p === '/api/grading/storage' && method === 'POST') return storage(ctx, svc);
  const om = p.match(/^\/api\/grading\/maps\/([^/]+)\/ops$/);
  if (om && method === 'POST') return opsAs(ctx, svc, om[1]);
  throw new ApiError('not_found', NOTICES.unknownPage);
}

async function seed(ctx: Ctx, svc: Services): Promise<void> {
  const body = ctx.body as {
    users?: { username: string; password: string }[];
    maps?: SeedMap[];
  };
  const users = body.users ?? [];
  const maps = body.maps ?? [];
  const userIds = new Map<string, string>();
  for (const u of users) {
    const existing = await svc.db.one<{ id: string }>('SELECT id FROM users WHERE username = $1', [u.username]);
    const id = existing?.id ?? randomUUID();
    userIds.set(u.username, id);
    const hash = await hashPassword(u.password);
    if (existing) {
      await svc.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
    } else {
      await svc.db.query('INSERT INTO users (id, username, password_hash) VALUES ($1,$2,$3)', [id, u.username, hash]);
    }
  }
  const outMaps: Record<string, { id: string; links: Record<string, string>; versions: string[]; presentation: { id: string; code: string } | null }> = {};
  // A reseed replaces the previous state for the same users wholesale.
  const seededUsernames = users.map((u) => u.username);
  const previous = await svc.db.query<{ id: string }>(
    'SELECT m.id FROM maps m JOIN users u ON u.id = m.owner_id WHERE u.username = ANY($1)', [seededUsernames],
  );
  for (const row of previous.rows) {
    await svc.db.query('DELETE FROM maps WHERE id = $1', [row.id]);
  }
  for (const m of maps) {
    const id = randomUUID();
    const ownerId = userIds.get(m.owner);
    if (!ownerId) throw new ApiError('invalid', `Seed user ${m.owner} not in users list.`);
    await svc.db.query(
      'INSERT INTO maps (id, title, layout, theme, owner_id, revision) VALUES ($1,$2,$3,$4,$5,1)',
      [id, m.key, m.layout ?? 'map', m.theme ?? 'daylight', ownerId],
    );
    const topics: { id: string; parentId: string | null; rank: number; floating: boolean; x: number | null; y: number | null; t: SeedTopic }[] = [];
    if (m.generate) {
      const n = m.generate.topics;
      const k = m.generate.fanout;
      for (let i = 0; i < n; i += 1) {
        const parentId = i === 0 ? null : `g${Math.floor((i - 1) / k)}`;
        const rank = i === 0 ? 0 : (i - 1) % k;
        topics.push({ id: `g${i}`, parentId, rank, floating: false, x: null, y: null, t: { id: `g${i}`, title: i === 0 ? 'Generated map' : `Topic ${i}` } });
      }
    } else if (m.root) {
      const walk = (t: SeedTopic, parentId: string | null, rank: number) => {
        topics.push({ id: t.id, parentId, rank, floating: false, x: null, y: null, t });
        (t.children ?? []).forEach((c, i) => walk(c, t.id, i));
      };
      walk(m.root, null, 0);
    }
    for (const f of m.floating ?? []) {
      topics.push({ id: f.id, parentId: null, rank: topics.length, floating: true, x: f.x, y: f.y, t: { id: f.id, title: f.title, note: '', children: f.children ?? [] } });
    }
    for (const row of topics) {
      const t = row.t;
      await svc.db.query(
        `INSERT INTO topics (map_id, id, parent_id, rank, floating, x, y, title, note, icon, colour, shape, side_pin, task, locked_by, restricted, attachments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,'[]')`,
        [id, row.id, row.parentId, row.rank, row.floating, row.x, row.y, t.title, t.note ?? '', t.icon ?? null, t.colour ?? null, t.shape ?? null, t.side_pin ?? null, JSON.stringify(t.task ?? null), t.locked_by ?? null, Boolean(t.restricted)],
      );
    }
    for (const l of m.links ?? []) {
      await svc.db.query('INSERT INTO cross_links (map_id, id, "from", "to", label, type) VALUES ($1,$2,$3,$4,$5,$6)', [
        id, l.id, l.from, l.to, l.label ?? '', l.type ?? 'related',
      ]);
    }
    for (const b of m.boundaries ?? []) {
      await svc.db.query('INSERT INTO boundaries (map_id, id, topic_id, label) VALUES ($1,$2,$3,$4)', [id, b.id, b.topic_id, b.label ?? '']);
    }
    for (const r of m.roles ?? []) {
      await svc.db.query('INSERT INTO members (map_id, username, role) VALUES ($1,$2,$3) ON CONFLICT (map_id, username) DO UPDATE SET role = $3', [id, r.username, r.role]);
    }
    for (const c of m.comments ?? []) {
      await svc.db.query('INSERT INTO comments (id, map_id, topic_id, author, body, reply_to, resolved) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
        c.id, id, c.topic_id, c.author, c.body, null, Boolean(c.resolved),
      ]);
      for (const r of c.replies ?? []) {
        await svc.db.query('INSERT INTO comments (id, map_id, topic_id, author, body, reply_to) VALUES ($1,$2,$3,$4,$5,$6)', [
          r.id, id, c.topic_id, r.author, r.body, c.id,
        ]);
      }
    }
    for (const v of m.votes ?? []) {
      await svc.db.query('INSERT INTO votes (map_id, topic_id, username) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, v.topic_id, v.username]);
    }
    const links: Record<string, string> = {};
    for (const sl of m.share_links ?? []) {
      const linkId = randomUUID();
      const code = randomUUID().replace(/-/g, '').slice(0, 16);
      const expires = new Date(now().getTime() + sl.expires_in_ms);
      await svc.db.query('INSERT INTO share_links (id, map_id, code, role, expires_at, state) VALUES ($1,$2,$3,$4,$5,$6)', [
        linkId, id, code, sl.role, expires.toISOString(), 'active',
      ]);
      links[sl.role] = code;
    }
    const versions: string[] = [];
    for (const v of m.versions ?? []) {
      const num = await svc.db.one<{ n: string }>('SELECT coalesce(max(number),0)+1 AS n FROM versions WHERE map_id = $1', [id]);
      const vid = randomUUID();
      const loaded = await loadMapState(svc.db, id);
      const snap = {
        format: 'sprigmap-version-1', map_id: id, version: Number(num?.n ?? 1), revision: loaded.state.revision,
        layout: loaded.state.layout, theme: loaded.state.theme,
        topics: [...loaded.state.topics.values()], links: [...loaded.state.links.values()],
        boundaries: [...loaded.state.boundaries.values()], slides: [...loaded.state.slides],
      };
      const { storageCall, versionKey } = await import('./storage.js');
      const stored = await storageCall({ s3: svc.s3, down: svc.storageDown }, (s3) => s3.put(versionKey(id, vid), Buffer.from(JSON.stringify(snap), 'utf8'), 'application/json'));
      if (stored?.ok) {
        await svc.db.query('INSERT INTO versions (id, map_id, number, name, kind, "by", revision, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
          vid, id, Number(num?.n ?? 1), v.name, 'named', v.by, loaded.state.revision, nowIso(),
        ]);
        versions.push(vid);
      }
    }
    let presentation: { id: string; code: string } | null = null;
    for (let i = 0; i < (m.slides ?? []).length; i += 1) {
      await svc.db.query('INSERT INTO slides (map_id, position, topic_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, i, m.slides![i]]);
    }
    if (m.presentation) {
      const pid = randomUUID();
      const code = randomUUID().replace(/-/g, '').slice(0, 16);
      await svc.db.query("INSERT INTO presentations (id, map_id, code, state, slide_index, presenter, last_presenter_seen) VALUES ($1,$2,$3,$4,0,$5,$6)", [
        pid, id, code, m.presentation.state, m.owner, nowIso(),
      ]);
      presentation = { id: pid, code };
    }
    outMaps[m.key] = { id, links, versions, presentation };
  }
  json(ctx.res, 201, { users: Object.fromEntries([...userIds.entries()].map(([k, v]) => [k, v])), maps: outMaps });
}

async function session(ctx: Ctx, svc: Services): Promise<void> {
  const body = ctx.body as { username?: string };
  const row = await svc.db.one<{ id: string; username: string }>('SELECT id, username FROM users WHERE username = $1', [body.username ?? '']);
  if (!row) throw new ApiError('not_found', NOTICES.unknownMap);
  const sessionId = randomUUID();
  const expires = new Date(now().getTime() + svc.settings.session_ttl_ms);
  await svc.db.query('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)', [
    sessionId, row.id, nowIso(), expires.toISOString(),
  ]);
  setCookie(ctx.res, 'sprig_session', sessionId, null);
  json(ctx.res, 200, { user: { id: row.id, username: row.username } });
}

async function clock(ctx: Ctx, svc: Services): Promise<void> {
  const body = ctx.body as { advance_ms?: number };
  if (typeof body.advance_ms !== 'number') throw new ApiError('invalid', 'advance_ms must be a number.');
  advanceClock(body.advance_ms);
  await applyDeadlines(svc);
  json(ctx.res, 200, { server_time: nowIso() });
}

async function storage(ctx: Ctx, svc: Services): Promise<void> {
  const body = ctx.body as { down?: boolean };
  svc.storageDown = Boolean(body.down);
  json(ctx.res, 200, { storage: svc.storageDown ? 'down' : 'up' });
}

async function opsAs(ctx: Ctx, svc: Services, mapId: string): Promise<void> {
  const body = ctx.body as { as?: string; group_id?: string; base_revision?: number; ops?: Operation[] };
  if (!body.as || !body.group_id || typeof body.base_revision !== 'number' || !Array.isArray(body.ops)) {
    throw new ApiError('invalid', 'Invalid grading ops payload.');
  }
  const role = await roleOnMap(svc, mapId, body.as);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  const out = await applyGroupPipeline({
    svc, mapId, user: body.as, role, groupId: body.group_id,
    baseRevision: body.base_revision, ops: body.ops,
  });
  if (out.response.status === 'applied' || out.response.status === 'merged') {
    svc.hub.broadcast(mapId, 'op', {
      author: body.as, revision: out.newRevision, ops: body.ops,
      sentence: out.sentence, group_id: body.group_id,
    });
  }
  json(ctx.res, 200, out.response);
}

/**
 * Apply every deadline that has passed: link expiry, session expiry
 * and presenter pause, then broadcast the results live.
 */
export async function applyDeadlines(svc: Services): Promise<void> {
  const t = now().getTime();
  // links
  const links = await svc.db.query<{ id: string; map_id: string; code: string; state: string }>(
    "SELECT id, map_id, code, state FROM share_links WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at <= $1",
    [new Date(t).toISOString()],
  );
  for (const l of links.rows) {
    await svc.db.query("UPDATE share_links SET state = 'expired' WHERE id = $1", [l.id]);
    svc.hub.broadcast(l.map_id, 'link_expired', { code: l.code, reason: 'link_expired' });
    await svc.db.query('DELETE FROM guests WHERE link_id = $1', [l.id]);
  }
  // sessions
  const sessions = await svc.db.query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM sessions WHERE expires_at <= $1', [new Date(t).toISOString()],
  );
  for (const s of sessions.rows) {
    const user = await svc.db.one<{ username: string }>('SELECT username FROM users WHERE id = $1', [s.user_id]);
    await svc.db.query('DELETE FROM sessions WHERE id = $1', [s.id]);
    if (user) {
      for (const c of svc.hub.clients) {
        if (c.username === user.username) {
          svc.hub.send(c, { seq: 0, type: 'session_expired' });
        }
      }
    }
  }
  // presenter grace -> paused
  const pres = await svc.db.query<{ id: string; map_id: string; state: string; last_presenter_seen: Date }>(
    "SELECT id, map_id, state, last_presenter_seen FROM presentations WHERE state = 'live'",
  );
  for (const p of pres.rows) {
    const seen = p.last_presenter_seen?.getTime() ?? 0;
    const hasPresenterSocket = [...svc.hub.clients].some((c) => c.mapId === p.map_id && (c.role === 'owner'));
    if (!hasPresenterSocket && t - seen >= svc.settings.presenter_grace_ms) {
      await svc.db.query("UPDATE presentations SET state = 'paused' WHERE id = $1", [p.id]);
      svc.hub.broadcast(p.map_id, 'presentation', { presentation: { id: p.id, state: 'paused' } });
    }
  }
}
