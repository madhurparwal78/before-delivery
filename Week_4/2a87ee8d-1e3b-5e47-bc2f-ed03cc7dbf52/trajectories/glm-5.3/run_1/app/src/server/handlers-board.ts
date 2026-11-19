/** Board endpoints: board reads, stream, presence, search, and the board writes. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FIELD_MESSAGES as FM } from './errors.js';
import { ApiError, sendJson, unknownKeyFields } from './http.js';
import { newId } from './ids.js';
import { bumpVersion } from './versions.js';
import { isPastPurge } from './purge.js';
import { validOpId, opIdError, withReplay, bodyHashOf, RATE_CLASSES, takeRateSlot, type ActorType } from './ops.js';
import { loadBoard, shapeBoard, canSeeText, noteVisible, dotsRemaining, notesThisRound, frameCounts, clusterNoteIds } from './board.js';
import { sniffImageType, readDimensions, stripPng, stripJpeg, stripWebp, contentTypeOf } from './images.js';
import { imageKey, readRawBody } from './imageupload.js';
import { requireWorkshopAccess, requireFacilitator, type Ctx, ipOf, readJsonBody } from './context.js';
import type { Note, Frame, Cluster, Workshop } from './db.js';

export async function handleBoardGet(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const { workshop, viewer, session } = await requireWorkshopAccess(req, ctx.db, workshopId);
  const state = await ctx.db.tx((c) => loadBoard(c, workshopId));
  if (!state) throw new ApiError(404, 'not_found');
  const shaped = shapeBoard(state, viewer, {
    dotsRemainingValue: viewer.role === 'participant' && workshop.dot_budget !== null
      ? dotsRemaining(state.dots, viewer.participantId ?? '', workshop.dot_budget)
      : null,
  });
  shaped.serverTime = new Date().toISOString();
  if (viewer.role === 'facilitator') {
    const { facilitatorWorkshopObject } = await import('./context.js');
    const fac = session.facilitator!;
    shaped.workshop = await facilitatorWorkshopObject(ctx.db, ctx.cfg, workshop, fac);
    const visibleFrameIds = new Set(state.frames.filter((f) => f.trashed_at === null).map((f) => f.id));
    shaped.participants = state.participants.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      notesThisRound: notesThisRound(state.notes, p.id, workshop.round_number, visibleFrameIds),
      active: !p.session_ended,
    }));
  }
  sendJson(res, 200, shaped);
}

export async function handleStream(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const { viewer, session } = await requireWorkshopAccess(req, ctx.db, workshopId);
  void viewer;
  const workshop = await ctx.db.row<{ version: number }>('select version from workshops where id = $1', [workshopId]);
  const lastEventId = Number(req.headers['last-event-id'] ?? '0') || 0;
  const currentVersion = workshop?.version ?? 1;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const viewerKey = session.role === 'facilitator' ? `f:${session.facilitator?.id}` : `p:${session.participant?.id}`;
  ctx.hub.add(res, workshopId, viewerKey, lastEventId, currentVersion, true);
}

interface PresenceState { [workshopId: string]: Map<string, { x: number; y: number; hue: number; name?: string }> }
const presenceMemory: PresenceState = {};

export async function handlePresence(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const { workshop, session } = await requireWorkshopAccess(req, ctx.db, workshopId);
  const body = await readJsonBody(req);
  const limited = await ctx.db.tx((c) => takeRateSlot(c, RATE_CLASSES.presence, session.role === 'participant' ? session.participant?.id ?? 'p' : session.facilitator?.id ?? 'f', RATE_CLASSES.presence.windowSeconds));
  if (!limited.allowed) {
    res.writeHead(429, {
      'Retry-After': String(limited.reset),
      'RateLimit-Limit': String(RATE_CLASSES.presence.limit),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(limited.reset),
    });
    res.end();
    return;
  }
  const x = Number(body.x);
  const y = Number(body.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -100000 || x > 100000 || y < -100000 || y > 100000) {
    throw new ApiError(422, 'validation', { fields: { x: FM.fallback } });
  }
  const key = session.role === 'participant' ? session.participant?.id ?? '' : session.facilitator?.id ?? '';
  const hue = session.role === 'participant' ? (session.participant?.hue ?? 0) : 40;
  const name = session.role === 'participant' ? session.participant?.display_name : session.facilitator?.name;
  const map = presenceMemory[workshopId] ?? new Map();
  presenceMemory[workshopId] = map;
  map.set(key, { x, y, hue, name });
  const silentRoundForParticipants = workshop.status === 'silent_round';
  const cursorId = key; // opaque and stable for the session (participant id is never exposed as cursorId directly)
  ctx.hub.pushPresence(workshopId, { cursorId, hue, x, y, name: session.role === 'facilitator' ? name : undefined }, key, silentRoundForParticipants);
  res.writeHead(204, {
    'RateLimit-Limit': String(RATE_CLASSES.presence.limit),
    'RateLimit-Remaining': String(limited.remaining),
    'RateLimit-Reset': String(limited.reset),
  });
  res.end();
}

export async function handleSearch(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const { workshop, viewer } = await requireWorkshopAccess(req, ctx.db, workshopId);
  void workshop;
  const q = (new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? '').trim();
  if (q.length < 1 || q.length > 100) throw new ApiError(422, 'validation', { fields: { q: FM.q } });
  const state = await ctx.db.tx((c) => loadBoard(c, workshopId));
  if (!state) throw new ApiError(404, 'not_found');
  const visibleFrames = new Set(state.frames.filter((f) => f.trashed_at === null && !isPastPurge(f)).map((f) => f.id));
  // full-text match on the words, ranked by cover density; nobody finds another person's unrevealed note (DP-60)
  const candidates = state.notes.filter((n) => {
    if (n.kind !== 'text' || n.text === null) return false;
    if (!visibleFrames.has(n.frame_id)) return false;
    if (n.facilitator_only && viewer.role !== 'facilitator') return false;
    if (!n.revealed) {
      if (viewer.role === 'facilitator') return n.author_facilitator;
      return n.author_participant_id === viewer.participantId;
    }
    return true;
  });
  const lower = q.toLowerCase();
  const terms = lower.split(/\s+/).filter((t) => t.length > 0);
  const scored = candidates
    .map((n) => {
      const text = (n.text ?? '').toLowerCase();
      let score = 0;
      for (const t of terms) {
        let idx = text.indexOf(t);
        let hits = 0;
        while (idx !== -1 && hits < 5) { hits += 1; idx = text.indexOf(t, idx + 1); }
        score += hits;
      }
      return { note: n, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.note.created_at.getTime() - b.note.created_at.getTime() || (a.note.id < b.note.id ? -1 : 1))
    .slice(0, 20);
  sendJson(res, 200, {
    results: scored.map((s) => ({ noteId: s.note.id, frameId: s.note.frame_id, text: s.note.text })),
  });
}

// ---- board writes: the accepted-keys rule (DP-71) applies in each writer

const BOARD_WRITE_KEYS: Record<string, string[]> = {
  'POST /frames': ['clientOpId', 'title', 'x', 'y', 'width', 'height'],
  'PATCH /frames': ['clientOpId', 'title', 'x', 'y', 'width', 'height'],
  'POST /frames/trash': ['clientOpId'],
  'POST /trash/restore': ['clientOpId'],
  'POST /notes': ['clientOpId', 'frameId', 'kind', 'text', 'imageId', 'x', 'y', 'facilitatorOnly'],
  'PATCH /notes': ['clientOpId', 'position', 'text', 'placement', 'facilitatorOnly'],
  'DELETE /notes': [],
  'POST /clusters': ['clientOpId', 'frameId', 'title', 'x', 'y'],
  'PATCH /clusters': ['clientOpId', 'title', 'x', 'y'],
  'DELETE /clusters': [],
  'POST /connectors': ['clientOpId', 'fromNoteId', 'toNoteId'],
  'DELETE /connectors': [],
  'POST /dots': ['clientOpId'],
  'POST /dots/return': ['clientOpId'],
  'POST /versions/restore': ['clientOpId'],
};

function unknownKeysOf(body: Record<string, unknown>, endpoint: string, nested: string[][]): Record<string, string> {
  const allowed = new Set(BOARD_WRITE_KEYS[endpoint] ?? []);
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) fields[key] = FM.unknownKey;
  }
  for (const [parent, keys] of nested) {
    const value = body[parent];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sub = value as Record<string, unknown>;
      const subAllowed = new Set(keys);
      for (const k of Object.keys(sub)) if (!subAllowed.has(k)) fields[`${parent}.${k}`] = FM.unknownKey;
    }
  }
  return fields;
}

async function actorForBoardWrite(req: IncomingMessage, ctx: Ctx, workshopId: string): Promise<{ actorType: ActorType; actorId: string; body: Record<string, unknown>; workshop: Workshop; viewer: Awaited<ReturnType<typeof requireWorkshopAccess>>['viewer']; session: Awaited<ReturnType<typeof requireWorkshopAccess>>['session'] }> {
  const access = await requireWorkshopAccess(req, ctx.db, workshopId);
  const body = await readJsonBody(req);
  return {
    actorType: access.session.role,
    actorId: access.session.role === 'facilitator' ? access.session.facilitator?.id ?? '' : access.session.participant?.id ?? '',
    body, workshop: access.workshop, viewer: access.viewer, session: access.session,
  };
}

function rateLimitBoardWrite(): void {
  // counted per actor inside each writer via takeRateSlot
}

function phaseWriteError(workshop: Workshop): ApiError {
  if (workshop.status === 'closed' || workshop.status === 'archived') return new ApiError(409, 'workshop_closed');
  return new ApiError(409, 'phase_locked', { message: `That isn't available while the workshop is ${label(workshop.status)}` });
}

function label(status: string): string {
  return ({ draft: 'Draft', open: 'Open', silent_round: 'Silent round', revealed: 'Revealed', voting: 'Voting', closed: 'Closed', archived: 'Archived' } as Record<string, string>)[status] ?? status;
}

async function takeBoardWriteSlot(ctx: Ctx, actorType: ActorType, actorId: string): Promise<void> {
  const slot = await ctx.db.tx((c) => takeRateSlot(c, RATE_CLASSES.boardWrite, `${actorType}:${actorId}`, RATE_CLASSES.boardWrite.windowSeconds));
  if (!slot.allowed) {
    throw new ApiError(429, 'rate_limited', {
      retryAfter: slot.reset,
      rateHeaders: { limit: RATE_CLASSES.boardWrite.limit, remaining: 0, reset: slot.reset },
    });
  }
}

export async function handleCreateFrame(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await requireFacilitator(req, ctx.db);
  const body = await readJsonBody(req);
  const a = await actorForBoardWrite(req, ctx, workshopId);
  if (a.session.role !== 'facilitator') throw new ApiError(403, 'forbidden');
  if (!validOpId(body.clientOpId)) throw opIdError();
  const unknown = unknownKeysOf(body, 'POST /frames', []);
  const fields = { ...unknown };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 60) fields.title = FM.fallback;
  const nums = ['x', 'y', 'width', 'height'].map((k) => body[k]);
  for (const n of nums) if (typeof n !== 'number' || !Number.isFinite(n)) fields.x = fields.x ?? FM.fallback;
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  await takeBoardWriteSlot(ctx, 'facilitator', fac.id);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: 'facilitator', actorId: fac.id, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/workshops/${workshopId}/frames`, bodyHash: bodyHashOf(body),
  }, workshopId, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [workshopId])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    const frameId = newId('fr');
    const pos = (await c.query('select coalesce(max(position),-1)+1 as p from frames where workshop_id = $1', [workshopId])).rows[0] as { p: number };
    await c.query('insert into frames (id, workshop_id, title, x, y, width, height, position) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [frameId, workshopId, title, body.x as number, body.y as number, body.width as number, body.height as number, pos.p]);
    await bumpVersion(c, workshopId);
    return { status: 201, body: { frame: { id: frameId, title, x: body.x, y: body.y, width: body.width, height: body.height, position: pos.p } } };
  }));
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  sendJson(res, result.status, result.body);
}

async function currentVersion(ctx: Ctx, workshopId: string): Promise<number> {
  const row = await ctx.db.row<{ version: number }>('select version from workshops where id = $1', [workshopId]);
  return row?.version ?? 1;
}

export async function handleFramePatch(req: IncomingMessage, res: ServerResponse, ctx: Ctx, frameId: string): Promise<void> {
  const body = await readJsonBody(req);
  const frame = await ctx.db.row<Frame>('select * from frames where id = $1', [frameId]);
  if (!frame) throw new ApiError(404, 'not_found');
  if (!validOpId(body.clientOpId)) throw opIdError();
  const a = await actorForBoardWrite(req, ctx, frame.workshop_id);
  if (a.session.role !== 'facilitator') throw new ApiError(403, 'forbidden');
  const unknown = unknownKeysOf(body, 'PATCH /frames', []);
  const fields = { ...unknown };
  const allowed = ['title', 'x', 'y', 'width', 'height'];
  let any = false;
  for (const k of allowed) if (body[k] !== undefined) { any = true; if (k === 'title' && (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > 60)) fields.title = FM.fallback; else if (k !== 'title' && typeof body[k] !== 'number') fields[k] = FM.fallback; }
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  if (!any) throw new ApiError(422, 'validation', { fields: { title: FM.fallback } });
  await takeBoardWriteSlot(ctx, 'facilitator', a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: 'facilitator', actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'PATCH', path: `/api/frames/${frameId}`, bodyHash: bodyHashOf(body),
  }, frame.workshop_id, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [frame.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of allowed) {
      if (body[k] === undefined) continue;
      params.push(k === 'title' ? (body.title as string).trim() : body[k]);
      sets.push(`${k} = $${params.length}`);
    }
    params.push(frameId);
    await c.query(`update frames set ${sets.join(', ')} where id = $${params.length}`, params);
    await bumpVersion(c, frame.workshop_id);
    const updated = (await c.query('select * from frames where id = $1', [frameId])).rows[0] as Frame;
    return { status: 200, body: { frame: { id: updated.id, title: updated.title, x: updated.x, y: updated.y, width: updated.width, height: updated.height, position: updated.position } } };
  }));
  ctx.hub.pushBoardEvent(frame.workshop_id, await currentVersion(ctx, frame.workshop_id));
  sendJson(res, result.status, result.body);
}

export async function handleFrameTrash(req: IncomingMessage, res: ServerResponse, ctx: Ctx, frameId: string): Promise<void> {
  const body = await readJsonBody(req);
  const frame = await ctx.db.row<Frame>('select * from frames where id = $1', [frameId]);
  if (!frame || frame.trashed_at !== null) throw new ApiError(404, 'not_found');
  if (!validOpId(body.clientOpId)) throw opIdError();
  const a = await actorForBoardWrite(req, ctx, frame.workshop_id);
  if (a.session.role !== 'facilitator') throw new ApiError(403, 'forbidden');
  await takeBoardWriteSlot(ctx, 'facilitator', a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: 'facilitator', actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/frames/${frameId}/trash`, bodyHash: bodyHashOf(body),
  }, frame.workshop_id, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [frame.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    const now = new Date();
    const purgeAt = new Date(now.getTime() + ctx.cfg.trashPurgeSeconds * 1000);
    await c.query('update frames set trashed_at = $2, purge_at = $3 where id = $1', [frameId, now, purgeAt]);
    await bumpVersion(c, frame.workshop_id);
    const count = (await c.query('select count(*)::int as n from notes where frame_id = $1 and deleted = false and facilitator_only = false', [frameId])).rows[0] as { n: number };
    await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator','frame.trashed',$3)`,
      [newId('act'), a.actorId, frame.workshop_id]);
    return { status: 200, body: { trashItem: { id: frameId, kind: 'frame', title: frame.title, deletedAt: now.toISOString(), purgeAt: purgeAt.toISOString(), noteCount: count.n } } };
  }));
  ctx.hub.pushBoardEvent(frame.workshop_id, await currentVersion(ctx, frame.workshop_id));
  sendJson(res, result.status, result.body);
}

export { rateLimitBoardWrite };

export async function handleImageUpload(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const { session } = await requireWorkshopAccess(req, ctx.db, workshopId);
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(ct)) throw new ApiError(415, 'unsupported_media_type');
  const body = await readRawBody(req);
  if (!body.ok) {
    if (body.tooLarge) throw new ApiError(413, 'too_large');
    throw new ApiError(422, 'validation', { fields: { image: FM.imageDimensions } });
  }
  const actorType: ActorType = session.role;
  const actorId = actorType === 'facilitator' ? session.facilitator?.id ?? '' : session.participant?.id ?? '';
  const slot = await ctx.db.tx((c) => takeRateSlot(c, RATE_CLASSES.upload, `${actorType}:${actorId}`, RATE_CLASSES.upload.windowSeconds));
  if (!slot.allowed) {
    throw new ApiError(429, 'rate_limited', {
      retryAfter: slot.reset,
      rateHeaders: { limit: RATE_CLASSES.upload.limit, remaining: 0, reset: slot.reset },
    });
  }
  const kind = sniffImageType(body.buf);
  if (!kind || contentTypeOf(kind) !== ct) throw new ApiError(415, 'unsupported_media_type');
  const dims = readDimensions(body.buf, kind);
  if (!dims || dims.width > 8000 || dims.height > 8000) {
    throw new ApiError(422, 'validation', { fields: { image: FM.imageDimensions } });
  }
  const cleaned = kind === 'png' ? stripPng(body.buf) : kind === 'jpeg' ? stripJpeg(body.buf) : stripWebp(body.buf);
  const imageId = newId('img');
  try {
    await ctx.s3.putObject(imageKey(workshopId, imageId), cleaned, contentTypeOf(kind));
  } catch {
    throw new ApiError(503, 'storage_unavailable');
  }
  await ctx.db.tx(async (c) => {
    await c.query('insert into images (id, workshop_id, uploader_type, uploader_id, content_type, width, height, stored) values ($1,$2,$3,$4,$5,$6,$7,true)',
      [imageId, workshopId, actorType, actorId, contentTypeOf(kind), dims.width, dims.height]);
    await bumpVersion(c, workshopId);
  });
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  sendJson(res, 201, { imageId, width: dims.width, height: dims.height });
}

export async function handleCreateNote(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const a = await actorForBoardWrite(req, ctx, workshopId);
  const body = a.body;
  if (!validOpId(body.clientOpId)) throw opIdError();
  const unknown = unknownKeysOf(body, 'POST /notes', []);
  const fields: Record<string, string> = { ...unknown };
  const frameId = typeof body.frameId === 'string' ? body.frameId : '';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const x = body.x, y = body.y;
  if (!frameId) fields.frameId = FM.fallback;
  if (kind !== 'text' && kind !== 'image') fields.kind = FM.fallback;
  if (typeof x !== 'number' || typeof y !== 'number' || Math.abs(x) > 100000 || Math.abs(y) > 100000) fields.x = FM.fallback;
  let text: string | null = null;
  let imageId: string | null = null;
  if (kind === 'text') {
    text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 1 || text.length > 280) fields.text = FM.fallback;
  } else if (kind === 'image') {
    imageId = typeof body.imageId === 'string' ? body.imageId : '';
    if (!imageId) fields.imageId = FM.imageId;
  }
  const facilitatorOnly = body.facilitatorOnly === true;
  if (facilitatorOnly && a.session.role !== 'facilitator') throw new ApiError(403, 'forbidden');
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  await takeBoardWriteSlot(ctx, a.actorType, a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: a.actorType, actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/workshops/${workshopId}/notes`, bodyHash: bodyHashOf(body),
  }, workshopId, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [workshopId])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    const frame = (await c.query('select * from frames where id = $1 and trashed_at is null', [frameId])).rows[0] as Frame | undefined;
    if (!frame) throw new ApiError(404, 'not_found');
    const role = a.session.role;
    // per-state writes (Business rules)
    if (role === 'participant') {
      if (workshop.status === 'open' || workshop.status === 'draft') throw phaseWriteError(workshop);
      if (workshop.status === 'voting' || workshop.status === 'revealed') {
        if (workshop.status === 'voting') throw phaseWriteError(workshop);
      }
      if (workshop.status === 'silent_round' && workshop.round_ends_at && Date.now() >= workshop.round_ends_at.getTime()) {
        throw new ApiError(409, 'deadline_passed');
      }
    }
    if (role === 'facilitator' && workshop.status === 'voting') {
      throw phaseWriteError(workshop);
    }
    // image reference rule
    if (kind === 'image' && imageId) {
      const img = (await c.query('select * from images where id = $1 for update', [imageId])).rows[0] as
        { id: string; workshop_id: string; uploader_type: string; uploader_id: string; stored: boolean } | undefined;
      if (!img || img.workshop_id !== workshopId || img.uploader_id !== a.actorId || img.uploader_type !== a.actorType || !img.stored) {
        throw new ApiError(422, 'validation', { fields: { imageId: FM.imageId } });
      }
    }
    const noteId = newId('nt');
    const revealed = workshop.status !== 'silent_round' || role === 'facilitator';
    const authorFacilitator = role === 'facilitator';
    const authorName = role === 'facilitator' ? a.session.facilitator?.name ?? '' : a.session.participant?.display_name ?? '';
    await c.query(
      `insert into notes (id, workshop_id, frame_id, cluster_id, kind, text, image_id, x, y, revealed, facilitator_only,
         author_participant_id, author_facilitator, author_name, round_number, placement_index)
       values ($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0)`,
      [noteId, workshopId, frameId, kind, text, imageId, x, y,
        facilitatorOnly ? true : revealed, facilitatorOnly,
        authorFacilitator ? null : a.actorId, authorFacilitator, authorName, workshop.round_number]);
    await bumpVersion(c, workshopId);
    const shaped = shapeNoteResponse((await c.query('select * from notes where id = $1', [noteId])).rows[0] as Note, a.viewer);
    return { status: 201, body: { note: shaped } };
  }));
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  sendJson(res, result.status, result.body);
}

function shapeNoteResponse(note: Note, viewer: { role: 'facilitator' | 'participant'; participantId?: string; facilitatorName?: string }): Record<string, unknown> {
  const mine = viewer.role === 'facilitator' ? note.author_facilitator : note.author_participant_id === viewer.participantId;
  const out: Record<string, unknown> = {
    id: note.id, frameId: note.frame_id, clusterId: note.cluster_id, kind: note.kind,
    text: note.text, imageUrl: note.kind === 'image' ? `/api/notes/${note.id}/image` : null,
    x: note.x, y: note.y, revealed: note.revealed, mine,
  };
  if (viewer.role === 'facilitator') {
    out.authorName = note.author_name;
    out.facilitatorOnly = note.facilitator_only;
  } else {
    out.authorName = mine ? note.author_name : undefined;
  }
  return out;
}

export { noteVisible, canSeeText, clusterNoteIds, frameCounts };
