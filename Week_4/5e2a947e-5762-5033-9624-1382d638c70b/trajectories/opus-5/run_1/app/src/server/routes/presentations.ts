import { randomBytes, randomUUID } from 'node:crypto';
import { copy } from '../../shared/copy.js';
import { deriveAll } from '../../shared/derive.js';
import { ApiError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { canPresentationMove } from '../../shared/states.js';
import { branchIds, hiddenSet } from '../../shared/tree.js';
import type { ApiTopic, PresentationState } from '../../shared/types.js';
import { apiTopicFrom, emptyCounts } from '../../shared/api.js';
import { optionalActor, requireActor } from '../auth.js';
import { audienceFor, publish, sendToAudience } from '../bus.js';
import { isoNow, now, serverDate } from '../clock.js';
import { db } from '../db.js';
import { readJson, route } from '../http.js';
import { loadMap, requireRole, type MapRow } from '../mapstore.js';

export interface PresentationRow {
  id: string;
  map_id: string;
  code: string;
  state: PresentationState;
  slide_index: number;
  presenter: string;
}

export function presentationJson(row: PresentationRow, followers: number): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    state: row.state,
    slide_index: row.slide_index,
    followers,
  };
}

export async function presentationById(id: string): Promise<PresentationRow> {
  const rows = await db.query<PresentationRow>(
    'select id, map_id, code, state, slide_index, presenter from presentations where id = $1',
    [id],
  );
  const row = rows.rows[0];
  if (!row) throw new ApiError('not_found', 'That presentation is gone.');
  return row;
}

export async function presentationByCode(code: string): Promise<PresentationRow> {
  const rows = await db.query<PresentationRow>(
    'select id, map_id, code, state, slide_index, presenter from presentations where code = $1',
    [code],
  );
  const row = rows.rows[0];
  if (!row) throw new ApiError('not_found', 'That presentation is gone.');
  return row;
}

export function followerCount(code: string): number {
  return audienceFor(code).length;
}

/** The slides an audience may see, with the reason each skipped slide is skipped. */
export function slideStatus(map: MapRow): { id: string; skip: 'deleted' | 'restricted' | null }[] {
  const hidden = hiddenSet(map.doc, false);
  return map.doc.slides.map((id) => {
    if (!map.doc.topics[id]) return { id, skip: 'deleted' as const };
    if (hidden.has(id)) return { id, skip: 'restricted' as const };
    return { id, skip: null };
  });
}

export function resolveStep(
  map: MapRow,
  current: number,
  requested: number,
): { index: number; skipped: { index: number; reason: 'deleted' | 'restricted' }[] } {
  const slides = slideStatus(map);
  const forward = requested > current;
  const skipped: { index: number; reason: 'deleted' | 'restricted' }[] = [];
  let index = requested;
  while (index >= 0 && index < slides.length) {
    const slide = slides[index];
    if (slide.skip === null) return { index, skipped };
    skipped.push({ index, reason: slide.skip });
    index = forward ? index + 1 : index - 1;
  }
  return { index: current, skipped };
}

export function slidePayload(map: MapRow, index: number): Record<string, unknown> | null {
  const slides = slideStatus(map);
  const slide = slides[index];
  if (!slide || slide.skip !== null) return null;
  const hidden = hiddenSet(map.doc, false);
  const view = { doc: map.doc, collapsed: new Set<string>(), hidden };
  const derived = deriveAll({ ...view, theme: map.doc.theme, today: serverDate() });
  const counts = emptyCounts();
  const ids = branchIds(map.doc, slide.id).filter((id) => !hidden.has(id));
  const topics: ApiTopic[] = ids.map((id) => {
    const stored = map.doc.topics[id];
    const parent = stored.parent_id;
    const rank = parent ? (map.doc.topics[parent]?.children.indexOf(id) ?? 0) : 0;
    const api = apiTopicFrom(stored, rank, false, counts, derived.get(id) as never);
    return { ...api, note: '' };
  });
  return { topic_id: slide.id, topics };
}

export async function audiencePayload(code: string): Promise<Record<string, unknown>> {
  const row = await presentationByCode(code);
  const map = await loadMap(db, row.map_id);
  if (!map) throw new ApiError('not_found', copy.unknownMap);
  const slides = slideStatus(map);
  return {
    state: row.state,
    slide_index: row.slide_index,
    slide_count: slides.length,
    presenter: row.presenter,
    followers: followerCount(code),
    server_time: isoNow(),
    slide: slidePayload(map, row.slide_index),
  };
}

async function broadcastPresentation(row: PresentationRow): Promise<void> {
  const payload = await audiencePayload(row.code);
  sendToAudience(row.code, { seq: 0, type: 'presentation', ...payload });
  await publish(row.map_id, {
    type: 'presentation',
    payload: {
      presentation: presentationJson(row, followerCount(row.code)),
      slide: payload.slide,
      slide_count: payload.slide_count,
    },
  });
}

route('POST', '/api/maps/:id/presentations', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner presents this map.');
  const open = await db.query<{ id: string }>(
    "select id from presentations where map_id = $1 and state <> 'ended'",
    [map.id],
  );
  if (open.rows.length > 0) {
    throw new ApiError('already_presenting', 'This map is already being presented.');
  }
  const row: PresentationRow = {
    id: randomUUID(),
    map_id: map.id,
    code: randomBytes(9).toString('base64url'),
    state: 'waiting',
    slide_index: 0,
    presenter: actor.name,
  };
  await db.query(
    `insert into presentations (id, map_id, code, state, slide_index, presenter, created_at)
     values ($1, $2, $3, 'waiting', 0, $4, $5)`,
    [row.id, row.map_id, row.code, row.presenter, now()],
  );
  await broadcastPresentation(row);
  return { status: 201, json: { presentation: presentationJson(row, 0) } };
});

route('POST', '/api/presentations/:pid/state', async (ctx) => {
  const actor = await requireActor(ctx);
  const row = await presentationById(ctx.params.pid);
  const { role } = await requireRole(db, row.map_id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner presents this map.');
  const body = readJson(ctx);
  const to = body.to;
  if (to !== 'live' && to !== 'ended') throw new ApiError('invalid', 'A show goes live or ends.');
  if (row.state === 'ended') throw new ApiError('session_ended', copy.audienceEnded);
  if (!canPresentationMove(row.state, to)) {
    throw new ApiError('invalid_transition', 'That change is not allowed from the current state.');
  }
  let slideIndex = row.slide_index;
  let skipped: { index: number; reason: 'deleted' | 'restricted' }[] = [];
  if (to === 'live') {
    const map = await loadMap(db, row.map_id);
    if (map) {
      const resolved = resolveStep(map, -1, row.state === 'waiting' ? 0 : row.slide_index);
      slideIndex = resolved.index < 0 ? 0 : resolved.index;
      skipped = resolved.skipped;
    }
  }
  await db.query('update presentations set state = $2, slide_index = $3, disconnected_at = null where id = $1', [
    row.id,
    to,
    slideIndex,
  ]);
  const updated: PresentationRow = { ...row, state: to, slide_index: slideIndex };
  await broadcastPresentation(updated);
  return {
    status: 200,
    json: { presentation: presentationJson(updated, followerCount(row.code)), skipped },
  };
});

route('POST', '/api/presentations/:pid/step', async (ctx) => {
  const actor = await requireActor(ctx);
  const row = await presentationById(ctx.params.pid);
  const { role } = await requireRole(db, row.map_id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner presents this map.');
  if (row.state === 'ended') throw new ApiError('session_ended', copy.audienceEnded);
  if (row.state !== 'live') throw new ApiError('invalid_transition', 'Steps need a live show.');
  const body = readJson(ctx);
  if (typeof body.index !== 'number' || !Number.isInteger(body.index) || body.index < 0) {
    throw new ApiError('invalid', 'A step names a slide by its index.');
  }
  const map = await loadMap(db, row.map_id);
  if (!map) throw new ApiError('not_found', copy.unknownMap);
  if (body.index >= map.doc.slides.length) {
    throw new ApiError('invalid', 'There is no slide at that index.');
  }
  const resolved = resolveStep(map, row.slide_index, body.index);
  await db.query('update presentations set slide_index = $2 where id = $1', [row.id, resolved.index]);
  const updated: PresentationRow = { ...row, slide_index: resolved.index };
  await broadcastPresentation(updated);
  return {
    status: 200,
    json: {
      presentation: presentationJson(updated, followerCount(row.code)),
      skipped: resolved.skipped,
    },
  };
});

route('GET', '/api/presentations/by-code/:code', async (ctx) => {
  await optionalActor(ctx).catch(() => null);
  return { status: 200, json: await audiencePayload(ctx.params.code) };
});
