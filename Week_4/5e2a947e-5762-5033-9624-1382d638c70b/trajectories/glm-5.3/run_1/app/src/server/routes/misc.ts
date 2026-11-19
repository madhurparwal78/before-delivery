import { randomUUID } from 'node:crypto';
import type { Services } from '../services.js';
import type { Ctx } from '../ctx.js';
import { ApiError, NOTICES } from '../errors.js';
import { json, noContent, requireUser, setCookie } from '../api.js';
import { may } from '../../shared/permissions.js';
import { loadMapState } from '../context.js';
import { now, nowIso } from '../clock.js';
import type { TopicNode } from '../../shared/types.js';

import { storageCall, exportKey, attachmentKey } from '../storage.js';
import { roleOnMap, loadComments, asTopicNode } from './maps.js';

/**
 * Share links, comments, presentations, attachments, exports and the
 * clipboard — the routes that live outside /api/maps/:id.
 */

export async function shareRoutes(ctx: Ctx, svc: Services): Promise<void> {
  const p = ctx.path;
  const method = ctx.method;
  const code = p.split('/')[3] ?? '';
  const join = p.endsWith('/join');
  const link = await svc.db.one<{ id: string; map_id: string; code: string; role: string; expires_at: Date | null; state: string }>(
    'SELECT id, map_id, code, role, expires_at, state FROM share_links WHERE code = $1', [code],
  );
  if (!link) throw new ApiError('not_found', NOTICES.unknownMap);
  // expiry is evaluated on server time
  if (link.state === 'active' && link.expires_at && link.expires_at.getTime() <= now().getTime()) {
    await svc.db.query("UPDATE share_links SET state = 'expired' WHERE id = $1", [link.id]);
    link.state = 'expired';
  }
  if (link.state === 'expired') throw new ApiError('link_expired', NOTICES.expiredLink);
  if (link.state === 'revoked') throw new ApiError('link_revoked', NOTICES.turnedOff);
  if (!join && method === 'GET') {
    const map = await svc.db.one<{ id: string; title: string }>('SELECT id, title FROM maps WHERE id = $1', [link.map_id]);
    json(ctx.res, 200, {
      map_id: link.map_id,
      map_title: map?.title ?? '',
      role: link.role,
      expires_at: link.expires_at?.toISOString() ?? null,
      state: 'active',
    });
    return;
  }
  if (join && method === 'POST') {
    const body = ctx.body as { display_name?: string };
    const name = (body.display_name ?? '').trim();
    if (name.length < 1 || [...name].length > 30) throw new ApiError('invalid', 'Invalid name.', { fields: { display_name: 'Name must be 1 to 30 characters.' } });
    const token = randomUUID();
    await svc.db.query('INSERT INTO guests (token, map_id, username, role, link_id) VALUES ($1,$2,$3,$4,$5)', [
      token, link.map_id, name, link.role, link.id,
    ]);
    setCookie(ctx.res, 'sprig_guest', token, null);
    json(ctx.res, 200, { map_id: link.map_id, role: link.role });
    return;
  }
  throw new ApiError('not_found', NOTICES.unknownPage);
}

export async function commentRoutes(ctx: Ctx, svc: Services, id: string, action: string): Promise<void> {
  const u = await requireUser(ctx);
  const thread = await svc.db.one<{ map_id: string; topic_id: string; resolved: boolean }>(
    'SELECT map_id, topic_id, resolved FROM comments WHERE id = $1', [id],
  );
  if (!thread) throw new ApiError('not_found', NOTICES.unknownMap);
  const role = await roleOnMap(svc, thread.map_id, u.username);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  if (!may(role, 'comment')) throw new ApiError('forbidden', NOTICES.readOnly);
  const to = action === 'resolve';
  if (thread.resolved === to) throw new ApiError('invalid_transition', 'The thread is already in that state.');
  await svc.db.query('UPDATE comments SET resolved = $2 WHERE id = $1', [id, to]);
  const threads = await loadComments(svc, thread.map_id, thread.topic_id);
  const t = threads.find((x) => x.id === id);
  svc.hub.broadcast(thread.map_id, 'comment', { topic_id: thread.topic_id, threads });
  json(ctx.res, 200, { thread: t });
}

export async function presentationRoutes(ctx: Ctx, svc: Services, idOrCode: string, action: 'state' | 'step' | null): Promise<void> {
  const method = ctx.method;
  if (action === null && method === 'GET') return presentationByCode(ctx, svc, idOrCode);
  const pres = await svc.db.one<{ id: string; map_id: string; state: string; slide_index: number; presenter: string }>(
    'SELECT id, map_id, state, slide_index, presenter FROM presentations WHERE id = $1', [idOrCode],
  );
  if (!pres) throw new ApiError('not_found', NOTICES.unknownPage);
  const u = await requireUser(ctx);
  const role = await roleOnMap(svc, pres.map_id, u.username);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  if (!may(role, 'present')) throw new ApiError('forbidden', NOTICES.readOnly);
  if (pres.state === 'ended') throw new ApiError('session_ended', 'This presentation has ended.');
  if (action === 'state') {
    const body = ctx.body as { to?: string };
    const to = body.to;
    const allowed: Record<string, string[]> = {
      waiting: ['live', 'ended'],
      live: ['paused', 'ended'],
      paused: ['live', 'ended'],
    };
    if (!to || !allowed[pres.state]?.includes(to)) throw new ApiError('invalid_transition', 'That transition is not allowed.');
    await svc.db.query('UPDATE presentations SET state = $2, last_presenter_seen = $3 WHERE id = $1', [pres.id, to, nowIso()]);
    if (to === 'live') {
      // go live steps forward from slide 1, skipping skipped slides
      await stepPresentation(svc, pres.id, 0);
    }
    const fresh = await loadPresentation(svc, pres.id);
    svc.hub.broadcast(pres.map_id, 'presentation', { presentation: fresh });
    json(ctx.res, 200, { presentation: fresh });
    return;
  }
  if (action === 'step') {
    if (pres.state !== 'live') throw new ApiError('invalid_transition', 'Steps are allowed only while live.');
    const body = ctx.body as { index?: number };
    if (typeof body.index !== 'number' || body.index < 0) throw new ApiError('invalid', 'Invalid index.');
    const skipped = await stepPresentation(svc, pres.id, body.index);
    const fresh = await loadPresentation(svc, pres.id);
    svc.hub.broadcast(pres.map_id, 'presentation', { presentation: fresh, skipped });
    json(ctx.res, 200, { presentation: fresh, skipped });
    return;
  }
  throw new ApiError('not_found', NOTICES.unknownPage);
}

interface SkippedSlide { index: number; reason: 'deleted' | 'restricted' }

async function stepPresentation(svc: Services, presId: string, requested: number): Promise<SkippedSlide[]> {
  const pres = await svc.db.one<{ id: string; map_id: string; state: string; slide_index: number }>(
    'SELECT id, map_id, state, slide_index FROM presentations WHERE id = $1', [presId],
  );
  if (!pres) return [];
  const loaded = await loadMapState(svc.db, pres.map_id);
  const state = loaded.state;
  const slides = state.slides;
  if (slides.length === 0) return [];
  const forward = requested >= pres.slide_index;
  const skipped: SkippedSlide[] = [];
  let target = requested;
  const visible = (id: string): 'ok' | 'deleted' | 'restricted' => {
    const t = state.topics.get(id);
    if (!t) return 'deleted';
    if (t.restricted) return 'restricted';
    return 'ok';
  };
  const allSkipped = slides.every((s) => visible(s) !== 'ok');
  if (allSkipped && pres.state !== 'live') {
    return [];
  }
  while (target < slides.length && visible(slides[target]) !== 'ok') {
    skipped.push({ index: target, reason: visible(slides[target]) as 'deleted' | 'restricted' });
    target += forward ? 1 : -1;
    if (target < 0) break;
  }
  if (target >= slides.length || target < 0) {
    // no such slide remains in the stepping direction: stay put
    return skipped.filter((s) => forward ? s.index >= pres.slide_index : s.index <= pres.slide_index);
  }
  await svc.db.query('UPDATE presentations SET slide_index = $2 WHERE id = $1', [presId, target]);
  return skipped;
}

async function loadPresentation(svc: Services, id: string): Promise<{ id: string; code: string; state: string; slide_index: number; followers: number; map_id: string }> {
  const p = await svc.db.one<{ id: string; code: string; state: string; slide_index: number; followers: number; map_id: string }>(
    'SELECT id, code, state, slide_index, followers, map_id FROM presentations WHERE id = $1', [id],
  );
  return p!;
}

async function presentationByCode(ctx: Ctx, svc: Services, code: string): Promise<void> {
  const pres = await svc.db.one<{ id: string; map_id: string; state: string; slide_index: number; presenter: string; followers: number }>(
    'SELECT id, map_id, state, slide_index, presenter, followers FROM presentations WHERE code = $1', [code],
  );
  if (!pres) throw new ApiError('not_found', NOTICES.unknownPage);
  const loaded = await loadMapState(svc.db, pres.map_id);
  const state = loaded.state;
  // Audience view: no restricted topic and no notes.
  const canSee = (id: string): boolean => {
    const t = state.topics.get(id);
    return Boolean(t) && !t!.restricted;
  };
  const slideTopicId = state.slides[pres.slide_index] ?? null;
  let branch: TopicNode[] = [];
  if (slideTopicId && canSee(slideTopicId)) {
    const desc = new Set([slideTopicId]);
    const collect = (id: string) => {
      for (const t of state.topics.values()) if (t.parent_id === id && canSee(t.id)) { desc.add(t.id); collect(t.id); }
    };
    collect(slideTopicId);
    branch = [...state.topics.values()].filter((t) => desc.has(t.id)).map((t) => ({ ...asTopicNode(t), note: '' }));
  }
  json(ctx.res, 200, {
    state: pres.state,
    slide_index: pres.slide_index,
    slide_count: state.slides.length,
    presenter: pres.presenter,
    followers: Number(pres.followers),
    server_time: nowIso(),
    slide: slideTopicId ? { topic_id: slideTopicId, topics: branch } : null,
  });
}

export async function fileRoutes(ctx: Ctx, svc: Services): Promise<void> {
  const p = ctx.path;
  const method = ctx.method;
  const at = p.match(/^\/api\/attachments\/([^/]+)$/);
  if (at) {
    const id = at[1];
    const row = await svc.db.one<{ id: string; map_id: string; topic_id: string; sha256: string; type: string; state: string }>(
      'SELECT id, map_id, topic_id, sha256, type, state FROM attachments WHERE id = $1', [id],
    );
    if (!row) throw new ApiError('not_found', NOTICES.unknownPage);
    if (method === 'GET') {
      const got = await storageCall({ s3: svc.s3, down: svc.storageDown }, (s3) => s3.get(attachmentKey(row.map_id, row.sha256, row.type as 'png' | 'jpg')));
      if (!got?.ok || !got.bytes) throw new ApiError('storage_unavailable', NOTICES.storageOutageFiles);
      ctx.res.writeHead(200, {
        'content-type': row.type === 'png' ? 'image/png' : 'image/jpeg',
        'content-length': String(got.bytes.length),
      });
      ctx.res.end(got.bytes);
      return;
    }
    if (method === 'DELETE') {
      const u = await requireUser(ctx);
      const role = await roleOnMap(svc, row.map_id, u.username);
      if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
      if (!may(role, 'attach')) throw new ApiError('forbidden', NOTICES.readOnly);
      await svc.db.query('DELETE FROM attachments WHERE id = $1', [id]);
      return noContent(ctx.res);
    }
  }
  const ex = p.match(/^\/api\/exports\/([^/]+)(\/download|\/retry)?$/);
  if (ex) {
    const id = ex[1];
    const row = await svc.db.one<{ id: string; map_id: string; state: string; progress: number; format: string; topic_id: string | null }>(
      'SELECT id, map_id, state, progress, format, topic_id FROM exports WHERE id = $1', [id],
    );
    if (!row) throw new ApiError('not_found', NOTICES.unknownPage);
    if (method === 'GET' && !ex[2]) {
      json(ctx.res, 200, {
        export: {
          id: row.id, state: row.state, progress: Number(row.progress), format: row.format,
          download_url: row.state === 'ready' ? `/api/exports/${id}/download` : null,
        },
      });
      return;
    }
    if (method === 'POST' && ex[2] === '/retry') {
      const u = await requireUser(ctx);
      const role = await roleOnMap(svc, row.map_id, u.username);
      if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
      if (row.state !== 'failed') throw new ApiError('invalid_transition', 'Retry is legal only from failed.');
      await svc.db.query("UPDATE exports SET state = 'running', progress = 80, next_step_at = $2 WHERE id = $1", [
        id, new Date(now().getTime() + svc.settings.export_step_ms).toISOString(),
      ]);
      json(ctx.res, 202, { export: { id, state: 'running', progress: 80, format: row.format, download_url: null } });
      return;
    }
    if (method === 'GET' && ex[2] === '/download') {
      if (row.state !== 'ready') throw new ApiError('not_ready', 'The export is not ready yet.');
      const got = await storageCall({ s3: svc.s3, down: svc.storageDown }, (s3) => s3.get(exportKey(row.map_id, id, row.format as 'sprig' | 'svg')));
      if (!got?.ok || !got.bytes) throw new ApiError('storage_unavailable', NOTICES.storageOutageFiles);
      const mapRow = await svc.db.one<{ title: string }>('SELECT title FROM maps WHERE id = $1', [row.map_id]);
      const safeTitle = (mapRow?.title ?? 'map').replace(/[^\w\- ]/g, '_');
      const name = row.format === 'sprig' ? `${safeTitle}.sprig.txt` : `${safeTitle}.svg`;
      ctx.res.writeHead(200, {
        'content-type': row.format === 'sprig' ? 'text/plain; charset=utf-8' : 'image/svg+xml',
        'content-disposition': `attachment; filename="${name}"`,
        'content-length': String(got.bytes.length),
      });
      ctx.res.end(got.bytes);
      return;
    }
  }
  throw new ApiError('not_found', NOTICES.unknownPage);
}

export async function clipboardRoutes(ctx: Ctx, svc: Services): Promise<void> {
  const u = await requireUser(ctx);
  const body = ctx.body as { map_id?: string; topic_ids?: string[] };
  if (!body.map_id || !Array.isArray(body.topic_ids)) throw new ApiError('invalid', 'Invalid clipboard payload.');
  const role = await roleOnMap(svc, body.map_id, u.username);
  if (!role) throw new ApiError('not_found', NOTICES.unknownMap);
  const loaded = await loadMapState(svc.db, body.map_id);
  const state = loaded.state;
  const canSee = may(role, 'see_restricted');
  const trees: ClipTreeRow[] = [];
  const copy = (id: string): ClipTreeRow | null => {
    const t = state.topics.get(id);
    if (!t) return null;
    if (t.restricted && !canSee) return null;
    const children: ClipTreeRow[] = [];
    for (const c of state.topics.values()) if (c.parent_id === id) {
      const sub = copy(c.id);
      if (sub) children.push(sub);
    }
    return {
      id: t.id, title: t.title, note: t.note, icon: t.icon, colour: t.colour,
      task: t.task as Record<string, unknown> | null, children,
      attachments: t.attachments.map((a) => ({ sha256: a.sha256, bytes: a.bytes, type: a.type })),
    };
  };
  for (const id of body.topic_ids) {
    const tree = copy(id);
    if (tree) trees.push(tree);
  }
  if (trees.length === 0) throw new ApiError('not_found', NOTICES.unknownMap);
  await svc.db.query(
    `INSERT INTO clipboards (username, topics, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (username) DO UPDATE SET topics = $2, updated_at = $3`,
    [u.username, JSON.stringify(trees), nowIso()],
  );
  json(ctx.res, 200, { topics: countClip(trees) });
}

export interface ClipTreeRow {
  id: string;
  title: string;
  note: string;
  icon: string | null;
  colour: string | null;
  task: Record<string, unknown> | null;
  children: ClipTreeRow[];
  attachments: { sha256: string; bytes: number; type: string }[];
}

function countClip(trees: ClipTreeRow[]): number {
  let n = 0;
  for (const t of trees) n += 1 + countClip(t.children);
  return n;
}

