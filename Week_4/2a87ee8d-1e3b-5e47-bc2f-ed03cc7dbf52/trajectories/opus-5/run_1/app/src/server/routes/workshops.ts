import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireFacilitator } from '../auth/sessions.js';
import { json, type RouteDefinition } from '../http/pipeline.js';
import {
  findWorkshop,
  joinLinkExpiresAtMs,
  listWorkshopsForFacilitator,
  type WorkshopRow,
} from '../board/repository.js';
import { facilitatorWorkshopObject, findRecap, recapObject } from '../board/serialize.js';
import { isoTimestamp } from '../domain/schedule.js';
import {
  addInvites,
  applyTransition,
  createWorkshop,
  readCreateInput,
  readInviteBatch,
  readTransitionTarget,
  rotateJoinLink,
  turnOffJoinLink,
} from '../workshops/service.js';
import { listTrash, restoreTrashItem, trashFrame } from '../workshops/trash.js';
import { listVersions, restoreVersion } from '../workshops/versions.js';

async function workshopOf(workshop: WorkshopRow | null): Promise<WorkshopRow> {
  if (workshop === null) throw new AppError('not_found');
  return workshop;
}

/** Finds the workshop a frame, trash item, cluster, note or connector belongs to. */
export function workshopIdOfResource(table: string, column: string) {
  return async (context: { params: Readonly<Record<string, string>> }): Promise<string | null> => {
    const id = context.params[column];
    if (id === undefined) return null;
    const result = await pool.query<{ workshop_id: string }>(
      `SELECT workshop_id FROM ${table} WHERE id = $1`,
      [id],
    );
    return result.rows[0]?.workshop_id ?? null;
  };
}

export const workshopRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/workshops',
    auth: 'session',
    facilitatorOnly: true,
    handle: async ({ actor, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const workshops = await listWorkshopsForFacilitator(facilitator.facilitatorId);
      return json(200, {
        workshops: await Promise.all(
          workshops.map((workshop) => facilitatorWorkshopObject(pool, workshop, nowMs)),
        ),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/workshops',
    auth: 'session',
    body: 'json',
    facilitatorOnly: true,
    requiresWritableWorkspace: true,
    handle: async ({ actor, body, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const input = readCreateInput(body, facilitator.timeZone);
      const workshop = await createWorkshop(facilitator, input, nowMs);
      return json(201, { workshop: await facilitatorWorkshopObject(pool, workshop, nowMs) });
    },
  },
  {
    method: 'GET',
    path: '/api/workshops/:id',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    handle: async ({ workshop, nowMs }) =>
      json(200, { workshop: await facilitatorWorkshopObject(pool, await workshopOf(workshop), nowMs) }),
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/transitions',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    operation: true,
    requiresWritableWorkspace: true,
    handle: async ({ actor, body, workshop, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const target = await workshopOf(workshop);
      const to = readTransitionTarget(body);
      const updated = await applyTransition(facilitator, target.id, to, body, nowMs);
      return json(200, { workshop: await facilitatorWorkshopObject(pool, updated, nowMs) });
    },
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/join-link/rotate',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    requiresWritableWorkspace: true,
    handle: async ({ actor, workshop }) => {
      const facilitator = requireFacilitator(actor);
      const target = await workshopOf(workshop);
      const joinUrl = await rotateJoinLink(facilitator, target.id);
      return json(200, { joinUrl, joinLinkExpiresAt: isoTimestamp(joinLinkExpiresAtMs(target)) });
    },
  },
  {
    method: 'DELETE',
    path: '/api/workshops/:id/join-link',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    requiresWritableWorkspace: true,
    handle: async ({ actor, workshop }) => {
      const facilitator = requireFacilitator(actor);
      await turnOffJoinLink(facilitator, (await workshopOf(workshop)).id);
      return json(200, { joinUrl: null });
    },
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/invites',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    requiresWritableWorkspace: true,
    handle: async ({ actor, body, workshop, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const target = await workshopOf(workshop);
      const addresses = readInviteBatch(body);
      const invites = await addInvites(facilitator, target, addresses, nowMs);
      return json(202, { invites });
    },
  },
  {
    method: 'GET',
    path: '/api/workshops/:id/trash',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    handle: async ({ workshop }) =>
      json(200, { items: await listTrash(pool, (await workshopOf(workshop)).id) }),
  },
  {
    method: 'GET',
    path: '/api/workshops/:id/versions',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    handle: async ({ workshop }) =>
      json(200, { versions: await listVersions(pool, (await workshopOf(workshop)).id) }),
  },
  {
    method: 'POST',
    path: '/api/workshops/:id/versions/:versionId/restore',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    operation: true,
    requiresWritableWorkspace: true,
    handle: async ({ actor, context, workshop, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const target = await workshopOf(workshop);
      const versionId = context.params.versionId as string;
      const result = await restoreVersion(facilitator, target.id, versionId, nowMs);
      const updated = await findWorkshop(pool, target.id);
      return json(200, {
        workshop: await facilitatorWorkshopObject(pool, await workshopOf(updated), nowMs),
        restoredFrom: result.restoredFrom,
        saved: result.saved,
      });
    },
  },
  {
    method: 'GET',
    path: '/api/workshops/:id/recap',
    auth: 'session',
    workshop: { kind: 'param', name: 'id' },
    facilitatorOnly: true,
    handle: async ({ workshop }) => {
      const target = await workshopOf(workshop);
      if (target.status !== 'closed' && target.status !== 'archived') throw new AppError('not_closed');
      const recap = await findRecap(pool, target.id);
      if (recap === null) throw new AppError('not_closed');
      return json(200, recapObject(recap));
    },
  },
  {
    method: 'POST',
    path: '/api/frames/:id/trash',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'lookup', find: workshopIdOfResource('frames', 'id') },
    facilitatorOnly: true,
    operation: true,
    requiresWritableWorkspace: true,
    handle: async ({ actor, context, workshop }) => {
      const facilitator = requireFacilitator(actor);
      const target = await workshopOf(workshop);
      const trashItem = await trashFrame(facilitator, target.id, context.params.id as string);
      return json(200, { trashItem });
    },
  },
  {
    method: 'POST',
    path: '/api/trash/:id/restore',
    auth: 'session',
    body: 'json',
    workshop: { kind: 'lookup', find: workshopIdOfResource('frames', 'id') },
    facilitatorOnly: true,
    operation: true,
    requiresWritableWorkspace: true,
    handle: async ({ actor, context, workshop, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const target = await workshopOf(workshop);
      const result = await restoreTrashItem(facilitator, target.id, context.params.id as string);
      const frame = await pool.query<{
        id: string;
        title: string;
        x: number;
        y: number;
        width: number;
        height: number;
        position: number;
      }>('SELECT id, title, x, y, width, height, position FROM frames WHERE id = $1', [result.frameId]);
      void nowMs;
      return json(200, { frame: frame.rows[0] ?? null, restored: result.restored });
    },
  },
];
