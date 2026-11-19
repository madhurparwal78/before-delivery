/** Note, cluster, connector, dot, trash-restore and version-restore handlers. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FIELD_MESSAGES as FM } from './errors.js';
import { ApiError, sendJson } from './http.js';
import { newId } from './ids.js';
import { bumpVersion, restoreVersion, versionsOf, VERSION_REASON_LABELS } from './versions.js';
import { isPastPurge } from './purge.js';
import { validOpId, opIdError, withReplay, bodyHashOf, RATE_CLASSES, takeRateSlot, type ActorType } from './ops.js';
import { loadBoard, canSeeText, dotsRemaining, dotTotals } from './board.js';
import { imageKey } from './s3.js';
import { requireWorkshopAccess, readJsonBody, type Ctx } from './context.js';
import type { Note, Frame, Cluster, Workshop, Connector } from './db.js';

function label(status: string): string {
  return ({ draft: 'Draft', open: 'Open', silent_round: 'Silent round', revealed: 'Revealed', voting: 'Voting', closed: 'Closed', archived: 'Archived' } as Record<string, string>)[status] ?? status;
}

function phaseError(workshop: Workshop): ApiError {
  if (workshop.status === 'closed' || workshop.status === 'archived') return new ApiError(409, 'workshop_closed');
  return new ApiError(409, 'phase_locked', { message: `That isn't available while the workshop is ${label(workshop.status)}` });
}

async function currentVersion(ctx: Ctx, workshopId: string): Promise<number> {
  const row = await ctx.db.row<{ version: number }>('select version from workshops where id = $1', [workshopId]);
  return row?.version ?? 1;
}

async function takeWriteSlot(ctx: Ctx, actorType: ActorType, actorId: string): Promise<void> {
  const slot = await ctx.db.tx((c) => takeRateSlot(c, RATE_CLASSES.boardWrite, `${actorType}:${actorId}`, RATE_CLASSES.boardWrite.windowSeconds));
  if (!slot.allowed) {
    throw new ApiError(429, 'rate_limited', {
      retryAfter: slot.reset,
      rateHeaders: { limit: RATE_CLASSES.boardWrite.limit, remaining: 0, reset: slot.reset },
    });
  }
}

interface Access {
  actorType: ActorType;
  actorId: string;
  workshop: Workshop;
  facilitator: boolean;
  participantId: string | null;
}

async function accessFor(req: IncomingMessage, ctx: Ctx, workshopId: string): Promise<Access> {
  const a = await requireWorkshopAccess(req, ctx.db, workshopId);
  return {
    actorType: a.session.role,
    actorId: a.session.role === 'facilitator' ? a.session.facilitator?.id ?? '' : a.session.participant?.id ?? '',
    workshop: a.workshop,
    facilitator: a.session.role === 'facilitator',
    participantId: a.session.role === 'participant' ? a.session.participant?.id ?? '' : null,
  };
}

// ---- notes

const NOTE_PATCH_KEYS = ['clientOpId', 'position', 'text', 'placement', 'facilitatorOnly'];

export async function handleNotePatch(req: IncomingMessage, res: ServerResponse, ctx: Ctx, noteId: string): Promise<void> {
  const note = await ctx.db.row<Note>('select * from notes where id = $1 and deleted = false', [noteId]);
  if (!note) throw new ApiError(404, 'not_found');
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const unknown: Record<string, string> = {};
  for (const key of Object.keys(body)) if (!NOTE_PATCH_KEYS.includes(key)) unknown[key] = FM.unknownKey;
  const position = body.position as Record<string, unknown> | undefined;
  if (position !== undefined) {
    if (typeof position !== 'object' || position === null || Array.isArray(position)) {
      unknown.position = FM.fallback;
    } else {
      for (const k of Object.keys(position)) if (k !== 'x' && k !== 'y') unknown[`position.${k}`] = FM.unknownKey;
      const px = position.x, py = position.y;
      if (typeof px !== 'number' || typeof py !== 'number' || Math.abs(px) > 100000 || Math.abs(py) > 100000) unknown.position = unknown.position ?? FM.fallback;
    }
  }
  const placement = body.placement as Record<string, unknown> | undefined;
  if (placement !== undefined) {
    if (typeof placement !== 'object' || placement === null || Array.isArray(placement)) {
      unknown.placement = FM.fallback;
    } else {
      for (const k of Object.keys(placement)) if (!['frameId', 'clusterId', 'index'].includes(k)) unknown[`placement.${k}`] = FM.unknownKey;
    }
  }
  if (typeof body.text === 'string') {
    const t = body.text.trim();
    if (t.length < 1 || t.length > 280) unknown.text = FM.fallback;
  }
  const fields: Record<string, string> = { ...unknown };
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  const hasAny = position !== undefined || body.text !== undefined || placement !== undefined || body.facilitatorOnly !== undefined;
  if (!hasAny) throw new ApiError(422, 'validation', { fields: { position: FM.fallback } });
  const a = await accessFor(req, ctx, note.workshop_id);
  // a card back (someone else's unrevealed note) answers 403 from anyone
  const viewerCanSee = a.facilitator ? canSeeText(note, { role: 'facilitator' }) : canSeeText(note, { role: 'participant', participantId: a.participantId ?? '' });
  const isOwnUnrevealed = !note.revealed && (a.facilitator ? note.author_facilitator : note.author_participant_id === a.participantId);
  if (!viewerCanSee && !isOwnUnrevealed) throw new ApiError(403, 'forbidden');
  if (body.facilitatorOnly !== undefined && !a.facilitator) throw new ApiError(403, 'forbidden');
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: a.actorType, actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'PATCH', path: `/api/notes/${noteId}`, bodyHash: bodyHashOf(body),
  }, note.workshop_id, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [note.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    const cur = (await c.query('select * from notes where id = $1 and deleted = false for update', [noteId])).rows[0] as Note | undefined;
    if (!cur) throw new ApiError(404, 'not_found');
    const own = a.facilitator ? cur.author_facilitator : cur.author_participant_id === a.participantId;
    const readable = a.facilitator || cur.revealed || own;
    if (!readable) throw new ApiError(403, 'forbidden');
    if (a.facilitator) {
      if (workshop.status === 'voting') throw phaseError(workshop);
    } else {
      if (workshop.status === 'silent_round') {
        if (workshop.round_ends_at && Date.now() >= workshop.round_ends_at.getTime()) throw new ApiError(409, 'deadline_passed');
        if (cur.revealed) throw new ApiError(403, 'forbidden');
        if (placement !== undefined) throw phaseError(workshop);
        if (body.facilitatorOnly !== undefined) throw new ApiError(403, 'forbidden');
      } else if (workshop.status === 'voting') {
        throw phaseError(workshop);
      } else if (workshop.status === 'revealed') {
        if (!own && (cur.facilitator_only ? true : false)) throw new ApiError(403, 'forbidden');
      } else if (workshop.status === 'draft' || workshop.status === 'open') {
        throw phaseError(workshop);
      }
    }
    // per-field groups: position, text, placement, facilitatorOnly
    if (position) {
      await c.query('update notes set x = $2, y = $3 where id = $1', [noteId, (position as { x: number }).x, (position as { y: number }).y]);
    }
    if (typeof body.text === 'string') {
      await c.query('update notes set text = $2 where id = $1', [noteId, (body.text as string).trim()]);
    }
    if (placement) {
      const frameId = typeof placement.frameId === 'string' ? placement.frameId : cur.frame_id;
      const clusterId = placement.clusterId === null ? null : typeof placement.clusterId === 'string' ? placement.clusterId : cur.cluster_id;
      const index = typeof placement.index === 'number' ? placement.index : undefined;
      const frame = (await c.query('select * from frames where id = $1', [frameId])).rows[0] as Frame | undefined;
      if (!frame || frame.trashed_at !== null) throw new ApiError(404, 'not_found');
      if (clusterId !== null) {
        const cluster = (await c.query('select * from clusters where id = $1', [clusterId])).rows[0] as Cluster | undefined;
        if (!cluster || cluster.frame_id !== frameId) throw new ApiError(422, 'validation', { fields: { 'placement.clusterId': FM.fallback } });
        if (!cur.revealed || cur.facilitator_only) throw new ApiError(422, 'validation', { fields: { 'placement.clusterId': FM.fallback } });
      }
      const members = (await c.query('select id from notes where cluster_id = $2 and deleted = false and id <> $1 order by placement_index, created_at', [noteId, clusterId ?? ''])).rows as Array<{ id: string }>;
      let at = index === undefined ? members.length : Math.max(0, Math.min(index, members.length));
      at = Math.min(at, members.length);
      // shift the others so the order stays gap-free
      for (let i = 0; i < members.length; i++) {
        await c.query('update notes set placement_index = $2 where id = $1', [members[i].id, i < at ? i : i + 1]);
      }
      await c.query('update notes set frame_id = $2, cluster_id = $3, placement_index = $4 where id = $1',
        [noteId, frameId, clusterId, at]);
    }
    if (body.facilitatorOnly !== undefined && a.facilitator) {
      const flag = body.facilitatorOnly === true;
      await c.query('update notes set facilitator_only = $2, cluster_id = case when $2 then null else cluster_id end, revealed = case when $2 then true else revealed end where id = $1', [noteId, flag]);
      await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator','note.facilitator_only_changed',$3)`,
        [newId('act'), a.actorId, cur.workshop_id]);
    }
    await bumpVersion(c, note.workshop_id);
    const updated = (await c.query('select * from notes where id = $1', [noteId])).rows[0] as Note;
    return { status: 200, body: { note: shapeNote(updated, a) } };
  }));
  ctx.hub.pushBoardEvent(note.workshop_id, await currentVersion(ctx, note.workshop_id));
  sendJson(res, result.status, result.body);
}

function shapeNote(note: Note, a: { facilitator: boolean; participantId: string | null }): Record<string, unknown> {
  const mine = a.facilitator ? note.author_facilitator : note.author_participant_id === a.participantId;
  const out: Record<string, unknown> = {
    id: note.id, frameId: note.frame_id, clusterId: note.cluster_id, kind: note.kind,
    text: note.text, imageUrl: note.kind === 'image' ? `/api/notes/${note.id}/image` : null,
    x: note.x, y: note.y, revealed: note.revealed, mine,
  };
  if (a.facilitator) {
    out.authorName = note.author_name;
    out.facilitatorOnly = note.facilitator_only;
  } else if (mine) {
    out.authorName = note.author_name;
  }
  return out;
}

export async function handleNoteDelete(req: IncomingMessage, res: ServerResponse, ctx: Ctx, noteId: string): Promise<void> {
  const note = await ctx.db.row<Note>('select * from notes where id = $1 and deleted = false', [noteId]);
  if (!note) throw new ApiError(404, 'not_found');
  const a = await accessFor(req, ctx, note.workshop_id);
  const readable = a.facilitator || note.revealed || (a.facilitator ? note.author_facilitator : note.author_participant_id === a.participantId);
  if (!readable) throw new ApiError(403, 'forbidden');
  if (!a.facilitator && note.author_participant_id !== a.participantId) throw new ApiError(403, 'forbidden');
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  await ctx.db.tx(async (c) => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [note.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    if (a.facilitator) {
      if (workshop.status === 'voting') throw phaseError(workshop);
    } else {
      if (workshop.status === 'silent_round') {
        if (workshop.round_ends_at && Date.now() >= workshop.round_ends_at.getTime()) throw new ApiError(409, 'deadline_passed');
      } else if (workshop.status === 'revealed') {
        if (note.author_participant_id !== a.participantId) throw new ApiError(403, 'forbidden');
      } else {
        throw phaseError(workshop);
      }
    }
    await c.query('update notes set deleted = true where id = $1', [noteId]);
    await c.query('delete from connectors where from_note_id = $1 or to_note_id = $1', [noteId]);
    await bumpVersion(c, note.workshop_id);
    // queue the image object for deletion when nothing references it
    if (note.image_id) {
      const stillReferenced = (await c.query(
        `select 1 from notes n where n.image_id = $2 and n.deleted = false and n.id <> $1
         union all select 1 from notes n join frames f on f.id = n.frame_id
           where n.image_id = $2 and f.trashed_at is not null and f.purge_at > now()
         limit 1`, [noteId, note.image_id])).rows.length > 0;
      const inVersions = (await c.query(
        `select 1 from versions v where v.workshop_id = $1 and v.snapshot::text like '%' || $2 || '%' limit 1`,
        [note.workshop_id, note.image_id])).rows.length > 0;
      if (!stillReferenced && !inVersions) {
        await c.query('insert into image_deletes (id, image_id) values ($1,$2) on conflict do nothing', [newId('del'), note.image_id]);
      }
    }
  });
  ctx.hub.pushBoardEvent(note.workshop_id, await currentVersion(ctx, note.workshop_id));
  res.writeHead(204);
  res.end();
}

export async function handleNoteImage(req: IncomingMessage, res: ServerResponse, ctx: Ctx, noteId: string): Promise<void> {
  const note = await ctx.db.row<Note>('select * from notes where id = $1 and deleted = false', [noteId]);
  if (!note || note.kind !== 'image' || !note.image_id) throw new ApiError(404, 'not_found');
  const a = await requireWorkshopAccess(req, ctx.db, note.workshop_id);
  const viewer = a.viewer;
  const mine = viewer.role === 'facilitator' ? note.author_facilitator : note.author_participant_id === viewer.participantId;
  if (!note.revealed && !mine && !note.facilitator_only) throw new ApiError(404, 'not_found');
  if (note.facilitator_only && viewer.role !== 'facilitator') throw new ApiError(404, 'not_found');
  let bytes: Buffer;
  try {
    bytes = (await ctx.s3.getObject(imageKey(note.workshop_id, note.image_id))) ?? Buffer.alloc(0);
  } catch {
    throw new ApiError(503, 'storage_unavailable');
  }
  if (bytes.length === 0) throw new ApiError(404, 'not_found');
  const { sniffImageType, contentTypeOf } = await import('./images.js');
  const kind = sniffImageType(bytes) ?? 'png';
  res.writeHead(200, {
    'Content-Type': contentTypeOf(kind),
    'Content-Length': String(bytes.length),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=60',
  });
  res.end(bytes);
}

// ---- clusters

export async function handleCreateCluster(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const a = await accessFor(req, ctx, workshopId);
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) if (!['clientOpId', 'frameId', 'title', 'x', 'y'].includes(key)) fields[key] = FM.unknownKey;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 60) fields.title = FM.fallback;
  const frameId = typeof body.frameId === 'string' ? body.frameId : '';
  if (!frameId) fields.frameId = FM.fallback;
  if (typeof body.x !== 'number' || typeof body.y !== 'number' || Math.abs(body.x) > 100000 || Math.abs(body.y) > 100000) fields.x = FM.fallback;
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: a.actorType, actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/workshops/${workshopId}/clusters`, bodyHash: bodyHashOf(body),
  }, workshopId, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [workshopId])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    // clusters exist from revealed on
    if (workshop.status !== 'revealed' && workshop.status !== 'voting') throw phaseError(workshop);
    const frame = (await c.query('select * from frames where id = $1 and trashed_at is null', [frameId])).rows[0] as Frame | undefined;
    if (!frame) throw new ApiError(404, 'not_found');
    const clusterId = newId('cl');
    await c.query('insert into clusters (id, workshop_id, frame_id, title, x, y) values ($1,$2,$3,$4,$5,$6)',
      [clusterId, workshopId, frameId, title, body.x, body.y]);
    await bumpVersion(c, workshopId);
    return { status: 201, body: { cluster: { id: clusterId, frameId, title, x: body.x, y: body.y, noteIds: [], noteCount: 0 } } };
  }));
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  sendJson(res, result.status, result.body);
}

export async function handleClusterPatch(req: IncomingMessage, res: ServerResponse, ctx: Ctx, clusterId: string): Promise<void> {
  const cluster = await ctx.db.row<Cluster>('select * from clusters where id = $1', [clusterId]);
  if (!cluster) throw new ApiError(404, 'not_found');
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) if (!['clientOpId', 'title', 'x', 'y'].includes(key)) fields[key] = FM.unknownKey;
  if (typeof body.title === 'string' && (body.title.trim().length < 1 || body.title.trim().length > 60)) fields.title = FM.fallback;
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  const a = await accessFor(req, ctx, cluster.workshop_id);
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: a.actorType, actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'PATCH', path: `/api/clusters/${clusterId}`, bodyHash: bodyHashOf(body),
  }, cluster.workshop_id, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [cluster.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    if (workshop.status !== 'revealed' && workshop.status !== 'voting') throw phaseError(workshop);
    if (typeof body.title === 'string') await c.query('update clusters set title = $2 where id = $1', [clusterId, body.title.trim()]);
    if (typeof body.x === 'number') await c.query('update clusters set x = $2 where id = $1', [clusterId, body.x]);
    if (typeof body.y === 'number') await c.query('update clusters set y = $2 where id = $1', [clusterId, body.y]);
    await bumpVersion(c, cluster.workshop_id);
    const updated = (await c.query('select * from clusters where id = $1', [clusterId])).rows[0] as Cluster;
    return { status: 200, body: { cluster: { id: updated.id, frameId: updated.frame_id, title: updated.title, x: updated.x, y: updated.y, noteIds: [], noteCount: 0 } } };
  }));
  ctx.hub.pushBoardEvent(cluster.workshop_id, await currentVersion(ctx, cluster.workshop_id));
  sendJson(res, result.status, result.body);
}

export async function handleClusterDelete(req: IncomingMessage, res: ServerResponse, ctx: Ctx, clusterId: string): Promise<void> {
  const cluster = await ctx.db.row<Cluster>('select * from clusters where id = $1', [clusterId]);
  if (!cluster) throw new ApiError(404, 'not_found');
  const a = await accessFor(req, ctx, cluster.workshop_id);
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  await ctx.db.tx(async (c) => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [cluster.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    if (workshop.status !== 'revealed' && workshop.status !== 'voting') throw phaseError(workshop);
    // one return for every uncancelled spend, in the same transaction (DP-69)
    const uncancelled = (await c.query(
      `select d.id from dot_ledger d
       where d.cluster_id = $1 and d.kind = 'spend'
         and not exists (select 1 from dot_ledger r where r.kind = 'return' and r.cancels_id = d.id)
       for update`, [clusterId])).rows as Array<{ id: string }>;
    for (const d of uncancelled) {
      await c.query(
        `insert into dot_ledger (id, workshop_id, participant_id, cluster_id, kind, cancels_id)
         select $1, workshop_id, participant_id, cluster_id, 'return', $2 from dot_ledger where id = $2`,
        [newId('dot'), d.id]);
    }
    await c.query('update notes set cluster_id = null where cluster_id = $1', [clusterId]);
    await c.query('delete from clusters where id = $1', [clusterId]);
    await bumpVersion(c, cluster.workshop_id);
  });
  ctx.hub.pushBoardEvent(cluster.workshop_id, await currentVersion(ctx, cluster.workshop_id));
  res.writeHead(204);
  res.end();
}

// ---- connectors

export async function handleCreateConnector(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const a = await accessFor(req, ctx, workshopId);
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) if (!['clientOpId', 'fromNoteId', 'toNoteId'].includes(key)) fields[key] = FM.unknownKey;
  const fromNoteId = typeof body.fromNoteId === 'string' ? body.fromNoteId : '';
  const toNoteId = typeof body.toNoteId === 'string' ? body.toNoteId : '';
  if (!fromNoteId) fields.fromNoteId = FM.fallback;
  if (!toNoteId) fields.toNoteId = FM.fallback;
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation', { fields });
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: a.actorType, actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/workshops/${workshopId}/connectors`, bodyHash: bodyHashOf(body),
  }, workshopId, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [workshopId])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    if (workshop.status !== 'revealed' && workshop.status !== 'voting') throw phaseError(workshop);
    const from = (await c.query('select * from notes where id = $1 and deleted = false', [fromNoteId])).rows[0] as Note | undefined;
    const to = (await c.query('select * from notes where id = $1 and deleted = false', [toNoteId])).rows[0] as Note | undefined;
    if (!from || !to) throw new ApiError(422, 'validation', { fields: { toNoteId: FM.fallback } });
    if (from.id === to.id) throw new ApiError(422, 'validation', { fields: { toNoteId: FM.fallback } });
    if (from.facilitator_only || to.facilitator_only) {
      if (!a.facilitator) throw new ApiError(422, 'validation', { fields: { toNoteId: FM.fallback } });
    }
    const dup = (await c.query('select 1 from connectors where workshop_id = $1 and ((from_note_id = $2 and to_note_id = $3) or (from_note_id = $3 and to_note_id = $2))', [workshopId, from.id, to.id])).rows.length > 0;
    if (dup) throw new ApiError(422, 'validation', { fields: { toNoteId: FM.fallback } });
    const connectorId = newId('cn');
    await c.query('insert into connectors (id, workshop_id, from_note_id, to_note_id) values ($1,$2,$3,$4)',
      [connectorId, workshopId, from.id, to.id]);
    await bumpVersion(c, workshopId);
    return { status: 201, body: { connector: { id: connectorId, fromNoteId: from.id, toNoteId: to.id } } };
  }));
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  sendJson(res, result.status, result.body);
}

export async function handleConnectorDelete(req: IncomingMessage, res: ServerResponse, ctx: Ctx, connectorId: string): Promise<void> {
  const connector = await ctx.db.row<Connector>('select * from connectors where id = $1', [connectorId]);
  if (!connector) throw new ApiError(404, 'not_found');
  const a = await accessFor(req, ctx, connector.workshop_id);
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  await ctx.db.tx(async (c) => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [connector.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    if (workshop.status !== 'revealed' && workshop.status !== 'voting') throw phaseError(workshop);
    await c.query('delete from connectors where id = $1', [connectorId]);
    await bumpVersion(c, connector.workshop_id);
  });
  ctx.hub.pushBoardEvent(connector.workshop_id, await currentVersion(ctx, connector.workshop_id));
  res.writeHead(204);
  res.end();
}

// ---- dots

export async function handleDotSpend(req: IncomingMessage, res: ServerResponse, ctx: Ctx, clusterId: string): Promise<void> {
  const cluster = await ctx.db.row<Cluster>('select * from clusters where id = $1', [clusterId]);
  if (!cluster) throw new ApiError(404, 'not_found');
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const a = await accessFor(req, ctx, cluster.workshop_id);
  if (a.facilitator) throw new ApiError(403, 'forbidden');
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: a.actorType, actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/clusters/${clusterId}/dots`, bodyHash: bodyHashOf(body),
  }, cluster.workshop_id, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [cluster.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    if (workshop.status !== 'voting') throw phaseError(workshop);
    if (workshop.voting_ends_at && Date.now() >= workshop.voting_ends_at.getTime()) throw new ApiError(409, 'deadline_passed');
    const cl = (await c.query('select * from clusters where id = $1 for update', [clusterId])).rows[0] as Cluster | undefined;
    if (!cl) throw new ApiError(404, 'not_found');
    const dots = (await c.query('select * from dot_ledger where workshop_id = $1', [cluster.workshop_id])).rows;
    const remaining = dotsRemaining(dots as never, a.actorId, workshop.dot_budget ?? 0);
    if (remaining <= 0) throw new ApiError(409, 'budget_exhausted');
    const dotId = newId('dot');
    await c.query(`insert into dot_ledger (id, workshop_id, participant_id, cluster_id, kind) values ($1,$2,$3,$4,'spend')`,
      [dotId, cluster.workshop_id, a.actorId, clusterId]);
    await bumpVersion(c, cluster.workshop_id);
    const dotsAfter = (await c.query('select * from dot_ledger where workshop_id = $1', [cluster.workshop_id])).rows;
    const remainingAfter = dotsRemaining(dotsAfter as never, a.actorId, workshop.dot_budget ?? 0);
    return { status: 201, body: { dot: { id: dotId, clusterId }, dotsRemaining: remainingAfter } };
  }));
  ctx.hub.pushBoardEvent(cluster.workshop_id, await currentVersion(ctx, cluster.workshop_id));
  sendJson(res, result.status, result.body);
}

export async function handleDotReturn(req: IncomingMessage, res: ServerResponse, ctx: Ctx, clusterId: string): Promise<void> {
  const cluster = await ctx.db.row<Cluster>('select * from clusters where id = $1', [clusterId]);
  if (!cluster) throw new ApiError(404, 'not_found');
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const a = await accessFor(req, ctx, cluster.workshop_id);
  if (a.facilitator) throw new ApiError(403, 'forbidden');
  await takeWriteSlot(ctx, a.actorType, a.actorId);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: a.actorType, actorId: a.actorId, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/clusters/${clusterId}/dots/return`, bodyHash: bodyHashOf(body),
  }, cluster.workshop_id, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [cluster.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    if (workshop.status !== 'voting') throw phaseError(workshop);
    if (workshop.voting_ends_at && Date.now() >= workshop.voting_ends_at.getTime()) throw new ApiError(409, 'deadline_passed');
    const latest = (await c.query(
      `select d.id from dot_ledger d
       where d.cluster_id = $1 and d.participant_id = $2 and d.kind = 'spend'
         and not exists (select 1 from dot_ledger r where r.kind = 'return' and r.cancels_id = d.id)
       order by d.created_at desc, d.id desc limit 1 for update`,
      [clusterId, a.actorId])).rows[0] as { id: string } | undefined;
    if (!latest) throw new ApiError(409, 'no_dot_to_return');
    await c.query(
      `insert into dot_ledger (id, workshop_id, participant_id, cluster_id, kind, cancels_id)
       select $1, workshop_id, participant_id, cluster_id, 'return', $2 from dot_ledger where id = $2`,
      [newId('dot'), latest.id]);
    await bumpVersion(c, cluster.workshop_id);
    const dots = (await c.query('select * from dot_ledger where workshop_id = $1', [cluster.workshop_id])).rows;
    const remaining = dotsRemaining(dots as never, a.actorId, workshop.dot_budget ?? 0);
    return { status: 200, body: { clusterId, dotsRemaining: remaining } };
  }));
  ctx.hub.pushBoardEvent(cluster.workshop_id, await currentVersion(ctx, cluster.workshop_id));
  sendJson(res, result.status, result.body);
}

// ---- trash and versions

export async function handleTrashList(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await (await import('./context.js')).requireFacilitator(req, ctx.db);
  await (await import('./context.js')).workshopForFacilitator(ctx.db, workshopId, fac);
  const frames = await ctx.db.rows<Frame>('select * from frames where workshop_id = $1 and trashed_at is not null order by trashed_at desc', [workshopId]);
  const items = [];
  for (const f of frames) {
    if (isPastPurge(f)) continue; // purge-at-read
    const count = await ctx.db.row<{ n: string }>('select count(*)::text as n from notes where frame_id = $1 and deleted = false and facilitator_only = false', [f.id]);
    items.push({
      id: f.id, kind: 'frame', title: f.title,
      deletedAt: f.trashed_at?.toISOString(), purgeAt: f.purge_at?.toISOString(),
      noteCount: Number(count?.n ?? 0),
    });
  }
  sendJson(res, 200, { items });
}

export async function handleTrashRestore(req: IncomingMessage, res: ServerResponse, ctx: Ctx, frameId: string): Promise<void> {
  const frame = await ctx.db.row<Frame>('select * from frames where id = $1', [frameId]);
  if (!frame) throw new ApiError(404, 'not_found');
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  const fac = await (await import('./context.js')).requireFacilitator(req, ctx.db);
  await takeWriteSlot(ctx, 'facilitator', fac.id);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: 'facilitator', actorId: fac.id, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/trash/${frameId}/restore`, bodyHash: bodyHashOf(body),
  }, frame.workshop_id, async () => {
    const workshop = (await c.query('select * from workshops where id = $1 for update', [frame.workshop_id])).rows[0] as Workshop | undefined;
    if (!workshop) throw new ApiError(404, 'not_found');
    if (workshop.status === 'closed' || workshop.status === 'archived') throw new ApiError(409, 'workshop_closed');
    const f = (await c.query('select * from frames where id = $1 for update', [frameId])).rows[0] as Frame | undefined;
    if (!f || f.trashed_at === null) throw new ApiError(404, 'not_found');
    if (isPastPurge(f)) throw new ApiError(404, 'not_found');
    await c.query('update frames set trashed_at = null, purge_at = null where id = $1', [frameId]);
    await bumpVersion(c, frame.workshop_id);
    const counts = (await c.query(
      `select
        (select count(*)::int from notes where frame_id = $1 and deleted = false) as notes,
        (select count(*)::int from clusters where frame_id = $1) as clusters,
        (select count(*)::int from connectors c where exists (select 1 from notes n where n.frame_id = $1 and (n.id = c.from_note_id or n.id = c.to_note_id))) as connectors,
        (select count(*)::int from dot_ledger where cluster_id in (select id from clusters where frame_id = $1)) as dots`,
      [frameId])).rows[0] as { notes: number; clusters: number; connectors: number; dots: number };
    await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator','frame.restored',$3)`,
      [newId('act'), fac.id, frame.workshop_id]);
    const restored = (await c.query('select * from frames where id = $1', [frameId])).rows[0] as Frame;
    return {
      status: 200,
      body: {
        frame: { id: restored.id, title: restored.title, x: restored.x, y: restored.y, width: restored.width, height: restored.height, position: restored.position },
        restored: { notes: counts.notes, clusters: counts.clusters, connectors: counts.connectors, dots: counts.dots },
      },
    };
  }));
  ctx.hub.pushBoardEvent(frame.workshop_id, await currentVersion(ctx, frame.workshop_id));
  sendJson(res, result.status, result.body);
}

export async function handleVersionsList(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string): Promise<void> {
  const fac = await (await import('./context.js')).requireFacilitator(req, ctx.db);
  await (await import('./context.js')).workshopForFacilitator(ctx.db, workshopId, fac);
  const versions = await ctx.db.tx((c) => versionsOf(c, workshopId));
  sendJson(res, 200, {
    versions: versions.map((v) => ({
      id: v.id, version: v.version, reason: v.reason,
      createdAt: v.created_at.toISOString(), noteCount: v.note_count,
    })),
  });
  void VERSION_REASON_LABELS;
}

export async function handleVersionRestore(req: IncomingMessage, res: ServerResponse, ctx: Ctx, workshopId: string, versionId: string): Promise<void> {
  const fac = await (await import('./context.js')).requireFacilitator(req, ctx.db);
  await (await import('./context.js')).workshopForFacilitator(ctx.db, workshopId, fac);
  const body = await readJsonBody(req);
  if (!validOpId(body.clientOpId)) throw opIdError();
  await takeWriteSlot(ctx, 'facilitator', fac.id);
  const result = await ctx.db.tx(async (c) => withReplay(c, {
    actorType: 'facilitator', actorId: fac.id, clientOpId: body.clientOpId as string,
    method: 'POST', path: `/api/workshops/${workshopId}/versions/${versionId}/restore`, bodyHash: bodyHashOf(body),
  }, workshopId, async () => {
    const outcome = await restoreVersion(c, workshopId, versionId, ctx.cfg.trashPurgeSeconds);
    await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'facilitator','version.restored',$3)`,
      [newId('act'), fac.id, workshopId]);
    const w = (await c.query('select * from workshops where id = $1', [workshopId])).rows[0] as Workshop;
    return { status: 200, body: { workshop: { id: w.id, version: w.version }, restoredFrom: outcome.restoredFrom, saved: outcome.saved } };
  }));
  ctx.hub.pushBoardEvent(workshopId, await currentVersion(ctx, workshopId));
  sendJson(res, result.status, result.body);
}

export { loadBoard, dotTotals };
