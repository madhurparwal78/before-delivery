import { pool } from '../db/pool.js';
import { AppError, FIELD_MESSAGES } from '../errors.js';
import { newId } from '../ids.js';
import { alreadySent, json, noContent, type RouteDefinition } from '../http/pipeline.js';
import { readImageBody } from '../http/context.js';
import { sendBytes } from '../http/respond.js';
import {
  MAX_IMAGE_SIDE,
  readImageDimensions,
  sniffImageType,
  stripImageMetadata,
} from '../domain/images.js';
import { projectCluster, projectNote, receivesNote } from '../domain/views.js';
import { clusterDotTotal, clusterMyDots, clusterNoteIds } from '../domain/counts.js';
import type { WorkshopStatus } from '../domain/states.js';
import type { Actor } from '../auth/sessions.js';
import { findNoteById, loadBoard, type WorkshopRow } from '../board/repository.js';
import { boardResponse, viewerOf } from '../board/serialize.js';
import { publishPresence } from '../board/events.js';
import {
  assertMayChangeNote,
  assertMayDeleteNote,
  assertReceivesNote,
  createCluster,
  createConnector,
  createFrame,
  createNote,
  deleteCluster,
  deleteConnector,
  deleteNote,
  patchCluster,
  patchFrame,
  patchNote,
  returnDot,
  spendDot,
  uploaderKey,
  viewerFor,
} from '../board/writes.js';
import { getObject, objectKeys, putObject, StorageUnavailable, storageError } from '../services/s3.js';
import { searchNotes } from '../board/search.js';
import { serveStream } from './stream.js';
import { workshopIdOfResource } from './workshops.js';

function required(workshop: WorkshopRow | null): WorkshopRow {
  if (workshop === null) throw new AppError('not_found');
  return workshop;
}

const noteWorkshop = { kind: 'lookup' as const, find: workshopIdOfResource('notes', 'id') };
const clusterWorkshop = { kind: 'lookup' as const, find: workshopIdOfResource('clusters', 'id') };
const connectorWorkshop = { kind: 'lookup' as const, find: workshopIdOfResource('connectors', 'id') };
const frameWorkshop = { kind: 'lookup' as const, find: workshopIdOfResource('frames', 'id') };

const boardWriteLimit = { limitClass: 'board_write' as const, key: 'actor' as const };

export const boardRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/workshops/:id/board',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    handle: async ({ actor, workshop, nowMs }) => {
      const target = required(workshop);
      const board = await loadBoard(pool, target.id);
      return json(200, await boardResponse(pool, { workshop: target, actor, board, nowMs }));
    },
  },
  {
    method: 'GET',
    path: '/api/workshops/:id/stream',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    handle: async ({ actor, context, workshop }) => {
      // The response is written and closed by the stream itself.
      await serveStream(context, actor, required(workshop));
      return alreadySent;
    },
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/presence',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'param', name: 'id' },
    rateLimit: { limitClass: 'presence', key: 'session' },
    handle: async ({ actor, body, workshop }) => {
      const target = required(workshop);
      const x = body.x;
      const y = body.y;
      const valid = (value: unknown): value is number =>
        typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000;
      if (!valid(x) || !valid(y)) {
        throw new AppError('validation', {
          fields: { ...(valid(x) ? {} : { x: FIELD_MESSAGES.generic }), ...(valid(y) ? {} : { y: FIELD_MESSAGES.generic }) },
        });
      }
      await publishPresence({
        workshopId: target.id,
        cursorId: actor.kind === 'participant' ? actor.cursorId : `facilitator:${actor.facilitatorId}`,
        hue: actor.kind === 'participant' ? actor.hue : 18,
        x,
        y,
        name: actor.kind === 'participant' ? actor.displayName : actor.name,
        sourceParticipantId: actor.kind === 'participant' ? actor.participantId : null,
      });
      return noContent;
    },
  },
  {
    method: 'GET',
    path: '/api/workshops/:id/search',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    handle: async ({ actor, context, workshop }) => {
      const target = required(workshop);
      const raw = context.query.get('q') ?? '';
      const query = raw.trim();
      if (query.length < 1 || query.length > 100) {
        throw new AppError('validation', { fields: { q: FIELD_MESSAGES.query } });
      }
      return json(200, { results: await searchNotes(target.id, query, viewerOf(actor)) });
    },
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/frames',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    handle: async ({ actor, body, workshop }) => {
      const target = required(workshop);
      const frameId = await createFrame(actor, target, body);
      const frame = await pool.query(
        'SELECT id, title, x, y, width, height, position FROM frames WHERE id = $1',
        [frameId],
      );
      return json(201, { frame: frame.rows[0] });
    },
  },
  {
    method: 'PATCH',
    path: '/api/frames/:id',
    auth: 'session',
    body: 'json',
    workshop: frameWorkshop,
    facilitatorOnly: true,
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    handle: async ({ actor, body, context, workshop }) => {
      const target = required(workshop);
      const frameId = context.params.id as string;
      await patchFrame(actor, target, frameId, body);
      const frame = await pool.query(
        'SELECT id, title, x, y, width, height, position FROM frames WHERE id = $1',
        [frameId],
      );
      return json(200, { frame: frame.rows[0] });
    },
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/images',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    requiresWritableWorkspace: true,
    rateLimit: { limitClass: 'upload', key: 'actor' },
    handle: async ({ actor, context, workshop }) => {
      const target = required(workshop);
      const body = await readImageBody(context);
      // The type is decided from the bytes, not the declared type.
      const sniffed = sniffImageType(body.bytes);
      if (sniffed === null || sniffed !== body.declaredType) throw new AppError('unsupported_media_type');
      const dimensions = readImageDimensions(body.bytes, sniffed);
      if (dimensions === null) throw new AppError('validation', { fields: { image: FIELD_MESSAGES.imageSide } });
      if (dimensions.width > MAX_IMAGE_SIDE || dimensions.height > MAX_IMAGE_SIDE) {
        throw new AppError('validation', { fields: { image: FIELD_MESSAGES.imageSide } });
      }

      const cleaned = stripImageMetadata(body.bytes, sniffed);
      const imageId = newId('im');
      const objectKey = objectKeys.image(target.id, imageId);
      try {
        await putObject(objectKey, cleaned, sniffed);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageError();
        throw error;
      }
      await pool.query(
        `INSERT INTO images (id, workshop_id, uploader_key, object_key, content_type, width, height)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [imageId, target.id, uploaderKey(actor), objectKey, sniffed, dimensions.width, dimensions.height],
      );
      return json(201, { imageId, width: dimensions.width, height: dimensions.height });
    },
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/notes',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'param', name: 'id' },
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    preflight: async ({ actor, body }) => {
      if (actor.kind === 'participant' && body.facilitatorOnly !== undefined) throw new AppError('forbidden');
    },
    handle: async ({ actor, body, workshop }) => {
      const target = required(workshop);
      const noteId = await createNote(actor, target, body);
      return json(201, { note: await noteView(noteId, actor) });
    },
  },
  {
    method: 'PATCH',
    path: '/api/notes/:id',
    auth: 'session',
    body: 'json',
    workshop: noteWorkshop,
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    preflight: async ({ actor, body, context }) => {
      const note = assertReceivesNote(
        await findNoteById(pool, context.params.id as string),
        viewerFor(actor),
      );
      assertMayChangeNote(note, actor, body);
    },
    handle: async ({ actor, body, context, workshop }) => {
      const target = required(workshop);
      const noteId = context.params.id as string;
      await patchNote(actor, target, noteId, body);
      return json(200, { note: await noteView(noteId, actor) });
    },
  },
  {
    method: 'DELETE',
    path: '/api/notes/:id',
    auth: 'session',
    workshop: noteWorkshop,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    preflight: async ({ actor, context }) => {
      const note = assertReceivesNote(
        await findNoteById(pool, context.params.id as string),
        viewerFor(actor),
      );
      assertMayDeleteNote(note, actor);
    },
    handle: async ({ actor, context, workshop }) => {
      await deleteNote(actor, required(workshop), context.params.id as string);
      return noContent;
    },
  },
  {
    method: 'GET',
    path: '/api/notes/:id/image',
    auth: 'session',
    workshop: noteWorkshop,
    handle: async ({ actor, context }) => {
      const note = await findNoteById(pool, context.params.id as string);
      // A note the caller may not see, or one already deleted, answers 404.
      if (note === null || note.imageId === null || !receivesNote(note, viewerFor(actor))) {
        throw new AppError('not_found');
      }
      const stored = await pool.query<{ object_key: string }>(
        'SELECT object_key FROM images WHERE id = $1',
        [note.imageId],
      );
      const objectKey = stored.rows[0]?.object_key;
      if (objectKey === undefined) throw new AppError('not_found');
      let object;
      try {
        object = await getObject(objectKey);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageError();
        throw error;
      }
      if (object === null) throw new AppError('not_found');
      const contentType = sniffImageType(object.bytes) ?? 'application/octet-stream';
      sendBytes(context, 200, object.bytes, contentType, {
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      });
      return alreadySent;
    },
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/clusters',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'param', name: 'id' },
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    handle: async ({ actor, body, workshop }) => {
      const target = required(workshop);
      const clusterId = await createCluster(actor, target, body);
      return json(201, { cluster: await clusterView(clusterId, actor, target.status) });
    },
  },
  {
    method: 'PATCH',
    path: '/api/clusters/:id',
    auth: 'session',
    body: 'json',
    workshop: clusterWorkshop,
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    handle: async ({ actor, body, context, workshop }) => {
      const clusterId = context.params.id as string;
      const target = required(workshop);
      await patchCluster(actor, target, clusterId, body);
      return json(200, { cluster: await clusterView(clusterId, actor, target.status) });
    },
  },
  {
    method: 'DELETE',
    path: '/api/clusters/:id',
    auth: 'session',
    workshop: clusterWorkshop,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    handle: async ({ actor, context, workshop }) => {
      await deleteCluster(actor, required(workshop), context.params.id as string);
      return noContent;
    },
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/connectors',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'param', name: 'id' },
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    handle: async ({ actor, body, workshop }) => {
      const connectorId = await createConnector(actor, required(workshop), body);
      const connector = await pool.query(
        'SELECT id, from_note_id AS "fromNoteId", to_note_id AS "toNoteId" FROM connectors WHERE id = $1',
        [connectorId],
      );
      return json(201, { connector: connector.rows[0] });
    },
  },
  {
    method: 'DELETE',
    path: '/api/connectors/:id',
    auth: 'session',
    workshop: connectorWorkshop,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    handle: async ({ actor, context, workshop }) => {
      await deleteConnector(actor, required(workshop), context.params.id as string);
      return noContent;
    },
  },
  {
    method: 'POST',
    path: '/api/clusters/:id/dots',
    auth: 'session',
    body: 'json',
    workshop: clusterWorkshop,
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    preflight: async ({ actor }) => {
      // The facilitator never spends dots.
      if (actor.kind === 'facilitator') throw new AppError('forbidden');
    },
    handle: async ({ actor, context, workshop }) => {
      const clusterId = context.params.id as string;
      const result = await spendDot(actor, required(workshop), clusterId);
      return json(201, {
        dot: { id: result.dotId, clusterId },
        dotsRemaining: result.dotsRemaining,
      });
    },
  },
  {
    method: 'POST',
    path: '/api/clusters/:id/dots/return',
    auth: 'session',
    body: 'json',
    workshop: clusterWorkshop,
    operation: true,
    requiresWritableWorkspace: true,
    rateLimit: boardWriteLimit,
    preflight: async ({ actor }) => {
      if (actor.kind === 'facilitator') throw new AppError('forbidden');
    },
    handle: async ({ actor, context, workshop }) => {
      const clusterId = context.params.id as string;
      const result = await returnDot(actor, required(workshop), clusterId);
      return json(200, { clusterId, dotsRemaining: result.dotsRemaining });
    },
  },
];

async function noteView(noteId: string, actor: Actor): Promise<Record<string, unknown>> {
  const note = await findNoteById(pool, noteId);
  if (note === null) throw new AppError('not_found');
  const view = projectNote(note, viewerFor(actor));
  if (view === null) throw new AppError('not_found');
  return view;
}

/** A freshly created or renamed cluster holds no notes and no dots yet. */
async function clusterView(clusterId: string, actor: Actor, status: WorkshopStatus): Promise<Record<string, unknown>> {
  const result = await pool.query<{ id: string; frameId: string; title: string; x: number; y: number }>(
    'SELECT id, frame_id AS "frameId", title, x, y FROM clusters WHERE id = $1',
    [clusterId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('not_found');
  const board = await loadBoard(pool, (await findWorkshopOfCluster(clusterId)) ?? '');
  const viewer = viewerFor(actor);
  return projectCluster(
    { ...row, workshopId: '' },
    {
      noteIds: clusterNoteIds(clusterId, board.notes),
      dotTotal: clusterDotTotal(clusterId, board.ledger),
      myDots: clusterMyDots(clusterId, viewer.participantId, board.ledger),
    },
    viewer,
    status,
  );
}

async function findWorkshopOfCluster(clusterId: string): Promise<string | null> {
  const result = await pool.query<{ workshop_id: string }>(
    'SELECT workshop_id FROM clusters WHERE id = $1',
    [clusterId],
  );
  return result.rows[0]?.workshop_id ?? null;
}
