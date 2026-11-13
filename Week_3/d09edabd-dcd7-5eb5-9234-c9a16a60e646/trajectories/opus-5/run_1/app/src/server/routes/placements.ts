import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { requireMember } from '../domain/session.js';
import {
  FieldCollector,
  asRecord,
  boolish,
  has,
  integer,
  opIdOf,
  text,
} from '../domain/validate.js';
import {
  loadRoom,
  nodeColumns,
  placementColumns,
  recordChange,
  toNode,
  toPlacement,
} from '../repo/rooms.js';
import type { NodeRow, PlacementRow, RoomRow } from '../repo/rooms.js';
import { rowOne, rows, tx } from '../services/db.js';
import {
  assertNoRunningPlaytest,
  assertNotHeldByOther,
  deletedPlacement,
  memberRoom,
  opIdHeader,
  publishRoom,
  replayOf,
  reply,
} from './support.js';

const undoableFields: [string, string][] = [
  ['xMm', 'position'],
  ['yMm', 'position'],
  ['zMm', 'position'],
  ['rotationDeg', 'rotation'],
  ['widthMm', 'size'],
  ['depthMm', 'size'],
  ['heightMm', 'size'],
  ['label', 'label'],
];

export function undoFieldWord(fields: string[]): string {
  const order = ['position', 'rotation', 'size', 'label'];
  const words = new Set(
    fields.map((field) => undoableFields.find(([name]) => name === field)?.[1]).filter(Boolean),
  );
  return order.find((word) => words.has(word)) ?? 'position';
}

async function loadLive(
  client: PoolClient,
  roomId: string,
  placementId: string,
): Promise<PlacementRow | null> {
  return rowOne<PlacementRow>(
    client,
    `select ${placementColumns} from placements
       where id = $1 and room_id = $2 and deleted_at is null`,
    [placementId, roomId],
  );
}

async function assertKnownPlacement(
  client: PoolClient,
  roomId: string,
  placementId: string,
): Promise<void> {
  const known = await rowOne<{ id: string }>(
    client,
    `select id from placements where id = $1 and room_id = $2`,
    [placementId, roomId],
  );
  if (!known) throw errors.notFound();
}

function boundsCheck(
  room: RoomRow,
  values: {
    xMm: number;
    yMm: number;
    zMm: number;
    widthMm: number;
    depthMm: number;
    heightMm: number;
    rotationDeg: number;
  },
  collector: FieldCollector,
): void {
  if (values.xMm < 0 || values.xMm > room.width_mm) {
    collector.add('xMm', `must be 0 to ${room.width_mm}`);
  }
  if (values.zMm < 0 || values.zMm > room.depth_mm) {
    collector.add('zMm', `must be 0 to ${room.depth_mm}`);
  }
  if (values.yMm < 0 || values.yMm > room.height_mm) {
    collector.add('yMm', `must be 0 to ${room.height_mm}`);
  }
  if (values.widthMm < 10 || values.widthMm > room.width_mm) {
    collector.add('widthMm', `must be 10 to ${room.width_mm}`);
  }
  if (values.depthMm < 10 || values.depthMm > room.depth_mm) {
    collector.add('depthMm', `must be 10 to ${room.depth_mm}`);
  }
  if (values.heightMm < 10 || values.heightMm > room.height_mm) {
    collector.add('heightMm', `must be 10 to ${room.height_mm}`);
  }
  if (values.rotationDeg < 0 || values.rotationDeg > 359) {
    collector.add('rotationDeg', 'must be 0 to 359');
  }
}

async function nextScenePos(client: PoolClient, roomId: string): Promise<number> {
  const row = await rowOne<{ next: number }>(
    client,
    `select coalesce(max(scene_pos), -1) + 1 as next from placements
       where room_id = $1 and deleted_at is null`,
    [roomId],
  );
  return row ? row.next : 0;
}

export const placementRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/placements',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const body = asRecord(ctx.body);
      return tx(async (client) => {
        await assertNoRunningPlaytest(client, room.id);
        const collector = new FieldCollector();
        const kind = text(body, 'kind', 3, 8, collector);
        if (kind !== null && !['door', 'box', 'cylinder', 'prop'].includes(kind)) {
          collector.add('kind', 'must be door, box, cylinder or prop');
        }
        const label = text(body, 'label', 1, 60, collector);
        let prop: { width_mm: number; depth_mm: number; height_mm: number } | null = null;
        if (kind === 'prop') {
          const propId = typeof body.propId === 'string' ? body.propId : null;
          prop =
            propId === null
              ? null
              : await rowOne<{ width_mm: number; depth_mm: number; height_mm: number }>(
                  client,
                  `select width_mm, depth_mm, height_mm from props
                     where id = $1 and workspace_id = $2`,
                  [propId, member.workspaceId],
                );
          if (prop === null) collector.add('propId', 'unknown prop');
        } else if (has(body, 'propId') && body.propId !== null) {
          collector.add('propId', 'only a prop placement has a prop');
        }
        const values = {
          xMm: integer(body, 'xMm', -1, 1_000_000, collector) ?? 0,
          yMm: integer(body, 'yMm', -1, 1_000_000, collector) ?? 0,
          zMm: integer(body, 'zMm', -1, 1_000_000, collector) ?? 0,
          rotationDeg: integer(body, 'rotationDeg', -1, 100_000, collector) ?? 0,
          widthMm:
            (has(body, 'widthMm') ? integer(body, 'widthMm', -1, 1_000_000, collector) : null) ??
            prop?.width_mm ??
            0,
          depthMm:
            (has(body, 'depthMm') ? integer(body, 'depthMm', -1, 1_000_000, collector) : null) ??
            prop?.depth_mm ??
            0,
          heightMm:
            (has(body, 'heightMm') ? integer(body, 'heightMm', -1, 1_000_000, collector) : null) ??
            prop?.height_mm ??
            0,
        };
        boundsCheck(room, values, collector);
        const entry = has(body, 'entry') ? boolish(body, 'entry', collector) : false;
        if (entry === true && kind !== 'door') {
          collector.add('entry', 'only a door can be the entry');
        }
        collector.throwIfAny();
        if (entry === true) {
          await client.query(
            `update placements set entry = false where room_id = $1 and kind = 'door'`,
            [room.id],
          );
        }
        const id = randomUUID();
        await client.query(
          `insert into placements (id, room_id, kind, label, prop_id, entry, x_mm, y_mm, z_mm,
             rotation_deg, width_mm, depth_mm, height_mm, scene_pos)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            id,
            room.id,
            kind,
            label,
            kind === 'prop' ? body.propId : null,
            entry === true,
            values.xMm,
            values.yMm,
            values.zMm,
            values.rotationDeg,
            values.widthMm,
            values.depthMm,
            values.heightMm,
            await nextScenePos(client, room.id),
          ],
        );
        const row = await loadLive(client, room.id, id);
        if (!row) throw errors.notFound();
        const placement = toPlacement(row);
        await recordChange(client, member.workspaceId, room.id, {
          kind: 'create',
          placementId: id,
          opId: null,
          userId: member.id,
          status: 201,
          response: { placement },
        });
        publishRoom(room.id, 'placement', { placement });
        publishRoom(room.id, 'room', { room: await loadRoom(client, room.id) });
        return reply(201, { placement });
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/rooms/:roomId/placements/:placementId',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const placementId = ctx.params.placementId;
      const raw = opIdHeader(ctx);
      const body = asRecord(ctx.body);
      await tx((client) => assertKnownPlacement(client, room.id, placementId));
      const stored = await replayOf(member, room.id, 'update', placementId, raw);
      if (stored) return reply(stored.status, stored.response);
      const deleted = await tx((client) => deletedPlacement(client, room.id, placementId));
      if (deleted) throw errors.placementDeleted(deleted.label, deleted.deletedBy);
      await assertNotHeldByOther(room.id, 'placement', placementId, member);
      return tx(async (client) => {
        await assertNoRunningPlaytest(client, room.id);
        const current = await loadLive(client, room.id, placementId);
        if (!current) throw errors.notFound();
        if (body.version !== current.version) {
          throw errors.staleVersion(toPlacement(current));
        }
        const opId = opIdOf(raw);
        const collector = new FieldCollector();
        const label = has(body, 'label') ? text(body, 'label', 1, 60, collector) : null;
        const values = {
          xMm: has(body, 'xMm')
            ? (integer(body, 'xMm', -1, 1_000_000, collector) ?? current.x_mm)
            : current.x_mm,
          yMm: has(body, 'yMm')
            ? (integer(body, 'yMm', -1, 1_000_000, collector) ?? current.y_mm)
            : current.y_mm,
          zMm: has(body, 'zMm')
            ? (integer(body, 'zMm', -1, 1_000_000, collector) ?? current.z_mm)
            : current.z_mm,
          rotationDeg: has(body, 'rotationDeg')
            ? (integer(body, 'rotationDeg', -1, 100_000, collector) ?? current.rotation_deg)
            : current.rotation_deg,
          widthMm: has(body, 'widthMm')
            ? (integer(body, 'widthMm', -1, 1_000_000, collector) ?? current.width_mm)
            : current.width_mm,
          depthMm: has(body, 'depthMm')
            ? (integer(body, 'depthMm', -1, 1_000_000, collector) ?? current.depth_mm)
            : current.depth_mm,
          heightMm: has(body, 'heightMm')
            ? (integer(body, 'heightMm', -1, 1_000_000, collector) ?? current.height_mm)
            : current.height_mm,
        };
        boundsCheck(room, values, collector);
        const entry = has(body, 'entry') ? boolish(body, 'entry', collector) : null;
        if (entry === true && current.kind !== 'door') {
          collector.add('entry', 'only a door can be the entry');
        }
        collector.throwIfAny();
        if (entry === true) {
          await client.query(
            `update placements set entry = false where room_id = $1 and kind = 'door'`,
            [room.id],
          );
        }
        const changedFields = undoableFields
          .map(([field]) => field)
          .filter((field) => has(body, field));
        const before: Record<string, unknown> = {};
        const beforeValues = toPlacement(current) as unknown as Record<string, unknown>;
        for (const field of changedFields) before[field] = beforeValues[field];
        await client.query(
          `update placements set label = $2, x_mm = $3, y_mm = $4, z_mm = $5, rotation_deg = $6,
             width_mm = $7, depth_mm = $8, height_mm = $9, entry = $10, version = version + 1
           where id = $1`,
          [
            placementId,
            label ?? current.label,
            values.xMm,
            values.yMm,
            values.zMm,
            values.rotationDeg,
            values.widthMm,
            values.depthMm,
            values.heightMm,
            entry === null ? current.entry : entry,
          ],
        );
        if (changedFields.length > 0) {
          await client.query(
            `insert into undo_entries (id, room_id, user_id, placement_id, before_fields)
             values ($1,$2,$3,$4,$5)`,
            [randomUUID(), room.id, member.id, placementId, JSON.stringify(before)],
          );
        }
        const row = await loadLive(client, room.id, placementId);
        if (!row) throw errors.notFound();
        const placement = toPlacement(row);
        await recordChange(client, member.workspaceId, room.id, {
          kind: 'update',
          placementId,
          opId,
          userId: member.id,
          status: 200,
          response: { placement },
        });
        publishRoom(room.id, 'placement', { placement });
        return { placement };
      });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/rooms/:roomId/placements/:placementId',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const placementId = ctx.params.placementId;
      const raw = opIdHeader(ctx);
      await tx((client) => assertKnownPlacement(client, room.id, placementId));
      const stored = await replayOf(member, room.id, 'delete', placementId, raw);
      if (stored) return reply(stored.status, stored.response);
      const deleted = await tx((client) => deletedPlacement(client, room.id, placementId));
      if (deleted) throw errors.placementDeleted(deleted.label, deleted.deletedBy);
      await assertNotHeldByOther(room.id, 'placement', placementId, member);
      await tx(async (client) => {
        await assertNoRunningPlaytest(client, room.id);
        const opId = opIdOf(raw);
        await client.query(
          `update placements set deleted_at = now(), deleted_by = $2 where id = $1`,
          [placementId, member.id],
        );
        const unlinked = await rows<NodeRow>(
          client,
          `update trigger_nodes set placement_id = null, version = version + 1
             where room_id = $1 and placement_id = $2 returning ${nodeColumns}`,
          [room.id, placementId],
        );
        await recordChange(client, member.workspaceId, room.id, {
          kind: 'delete',
          placementId,
          opId,
          userId: member.id,
          status: 204,
          response: null,
        });
        publishRoom(room.id, 'placement', { deletedId: placementId });
        for (const node of unlinked) publishRoom(room.id, 'node', { node: toNode(node) });
        publishRoom(room.id, 'room', { room: await loadRoom(client, room.id) });
      });
      return undefined;
    },
  },
];
