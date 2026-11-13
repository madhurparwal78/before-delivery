import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { fail, validation } from '../errors.js';
import { hub, roomChannel } from '../events.js';
import { empty, json, route, type Ctx } from '../http.js';
import { Input, UUID } from '../validate.js';
import { assertNotHeldByOther } from '../domain/locks.js';
import { assertEditable, emitNodes, emitRoom, findPlacement, findRoom, reloadRoom, toNode, toPlacement, userName, type NodeRow, type PlacementRow, type RoomRow } from '../domain/rooms.js';
import { opIdOf, recordChange, replayOf, validOpId } from '../domain/changes.js';
import type { Placement, PlacementKind } from '../../shared/types.js';

const KINDS: PlacementKind[] = ['door', 'box', 'cylinder', 'prop'];
const MIN_SIZE = 10;

/** The placement fields an update can change, with their columns, in the order the undo copy names them. */
const FIELDS = [
  { key: 'xMm', column: 'x_mm', group: 'position' },
  { key: 'yMm', column: 'y_mm', group: 'position' },
  { key: 'zMm', column: 'z_mm', group: 'position' },
  { key: 'rotationDeg', column: 'rotation_deg', group: 'rotation' },
  { key: 'widthMm', column: 'width_mm', group: 'size' },
  { key: 'depthMm', column: 'depth_mm', group: 'size' },
  { key: 'heightMm', column: 'height_mm', group: 'size' },
  { key: 'label', column: 'label', group: 'label' },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];
type Changes = Partial<Record<FieldKey, number | string>>;

const GROUP_ORDER = ['position', 'rotation', 'size', 'label'] as const;

/** The undo copy's word for what an update changed: the first of position, rotation, size, label. */
function undoWord(changed: FieldKey[]): string | null {
  const groups = new Set(FIELDS.filter((f) => changed.includes(f.key)).map((f) => f.group));
  return GROUP_ORDER.find((group) => groups.has(group)) ?? null;
}

function readFields(input: Input, room: RoomRow, forCreate: boolean): Changes {
  const bound = { xMm: room.width_mm, yMm: room.height_mm, zMm: room.depth_mm, widthMm: room.width_mm, depthMm: room.depth_mm, heightMm: room.height_mm };
  const out: Changes = {};
  for (const [key, max] of Object.entries(bound) as [keyof typeof bound, number][]) {
    const min = key.startsWith('x') || key.startsWith('y') || key.startsWith('z') ? 0 : MIN_SIZE;
    if (input.has(key)) out[key] = input.int(key, min, max);
  }
  if (input.has('rotationDeg')) out.rotationDeg = input.int('rotationDeg', 0, 359);
  if (input.has('label') || forCreate) out.label = input.text('label', 1, 60, { trim: true });
  return out;
}

const placementEvent = (roomId: string, placement: Placement) => hub.publish(roomChannel(roomId), 'placement', { placement });

async function publishChanged(roomId: string, placements: Placement[]): Promise<void> {
  for (const placement of placements) await placementEvent(roomId, placement);
  await emitRoom(db, roomId);
}

/** Entry is held by one door; setting it clears the room's other doors. */
async function claimEntry(ctx: Ctx, roomId: string, placementId: string): Promise<Placement[]> {
  const cleared = await ctx.db.query<PlacementRow>(
    `UPDATE placements SET entry = false, version = version + 1 WHERE room_id = $1 AND id <> $2 AND entry AND deleted_at IS NULL RETURNING *`,
    [roomId, placementId],
  );
  return cleared.rows.map(toPlacement);
}

async function deletedConflict(ctx: Ctx, row: PlacementRow): Promise<void> {
  if (!row.deleted_at) return;
  const by = row.deleted_by ? { userId: row.deleted_by, displayName: await userName(ctx.db, row.deleted_by) } : null;
  throw fail(410, 'placement_deleted', { label: row.label, deletedBy: by });
}

interface Loaded {
  room: RoomRow;
  placement: PlacementRow;
}

async function loadPlacement(ctx: Ctx): Promise<Loaded> {
  const room = await findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, true);
  return { room, placement: await findPlacement(ctx.db, room.id, ctx.params.placementId!, true) };
}

export function placementRoutes(): void {
  route('POST', '/api/rooms/:roomId/placements', {
    auth: 'member',
    transaction: true,
    load: async (ctx) => {
      const room = await findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, true);
      const propId = (ctx.body as { propId?: unknown } | undefined)?.propId;
      const prop =
        typeof propId === 'string' && UUID.test(propId)
          ? (await ctx.db.query<{ width_mm: number; depth_mm: number; height_mm: number }>(`SELECT width_mm, depth_mm, height_mm FROM props WHERE id = $1 AND workspace_id = $2 FOR SHARE`, [propId, ctx.actor.workspaceId])).rows[0] ?? null
          : null;
      return { room, prop };
    },
    conflict: async (ctx, { room }) => assertEditable(ctx.db, room.id),
    validate: (ctx, { room, prop }) => {
      const input = ctx.input();
      const kind = input.oneOf('kind', KINDS);
      const given = readFields(input, room, true);
      const out = {
        kind,
        propId: null as string | null,
        entry: false,
        fields: { yMm: 0, rotationDeg: 0, ...given } as Changes,
      };
      if (kind === 'prop') {
        if (!prop) input.fields.add('propId', 'unknown prop');
        else out.propId = String(input.body.propId);
      } else if (input.has('propId')) {
        input.fields.add('propId', 'only a prop placement has a prop');
      }
      if (input.has('entry')) {
        const entry = input.bool('entry');
        if (entry && kind !== 'door') input.fields.add('entry', 'only a door can be the entry');
        out.entry = entry === true;
      }
      for (const [key, fromProp] of [['widthMm', prop?.width_mm], ['depthMm', prop?.depth_mm], ['heightMm', prop?.height_mm]] as const) {
        if (out.fields[key] === undefined && !input.fields.errors[key]) {
          if (fromProp !== undefined) out.fields[key] = fromProp;
          else input.fields.add(key, 'must be a whole number');
        }
      }
      for (const key of ['xMm', 'zMm'] as const) if (out.fields[key] === undefined) input.fields.add(key, 'must be a whole number');
      input.fields.check();
      return out as { kind: PlacementKind; propId: string | null; entry: boolean; fields: Required<Changes> };
    },
    run: async (ctx, { room }, input) => {
      const id = randomUUID();
      const f = input.fields;
      const inserted = await ctx.db.query<PlacementRow>(
        `INSERT INTO placements (id, room_id, kind, label, prop_id, entry, x_mm, y_mm, z_mm, rotation_deg, width_mm, depth_mm, height_mm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [id, room.id, input.kind, f.label, input.propId, input.entry, f.xMm, f.yMm, f.zMm, f.rotationDeg, f.widthMm, f.depthMm, f.heightMm],
      );
      const placement = toPlacement(inserted.rows[0]!);
      await ctx.db.query(`UPDATE rooms SET scene_order = scene_order || to_jsonb($2::text) WHERE id = $1`, [room.id, id]);
      const cleared = input.entry ? await claimEntry(ctx, room.id, id) : [];
      await recordChange(ctx, room, { kind: 'create', placementId: id, scope: `create:${room.id}:${id}`, status: 201, response: () => ({ placement }) });
      ctx.after.push(() => publishChanged(room.id, [placement, ...cleared]));
      return json(201, { placement });
    },
  });

  route('PATCH', '/api/rooms/:roomId/placements/:placementId', {
    auth: 'member',
    transaction: true,
    load: loadPlacement,
    replay: (ctx, { room, placement }) => replayOf(ctx, `update:${room.id}:${placement.id}`),
    conflict: async (ctx, { room, placement }) => {
      await assertEditable(ctx.db, room.id);
      await deletedConflict(ctx, placement);
      await assertNotHeldByOther(ctx.db, room.id, 'placement', placement.id, ctx.actor.userId);
      const version = (ctx.body as { version?: unknown } | undefined)?.version;
      if (typeof version === 'number' && version !== placement.version) throw fail(412, 'stale_version', { current: toPlacement(placement) });
    },
    validate: (ctx, { room, placement }) => {
      const input = ctx.input();
      if (!validOpId(opIdOf(ctx))) input.fields.add('opId', 'must be 8 to 64 letters, digits, - or _');
      input.int('version', 0, 2_147_483_647);
      const changes = readFields(input, room, false);
      let entry: boolean | undefined;
      if (input.has('entry')) {
        entry = input.bool('entry');
        if (entry && placement.kind !== 'door') input.fields.add('entry', 'only a door can be the entry');
      }
      input.fields.check();
      return { changes, entry };
    },
    run: async (ctx, { room, placement }, input) => {
      const row = placement as unknown as Record<string, unknown>;
      const changed = FIELDS.filter((f) => input.changes[f.key] !== undefined && input.changes[f.key] !== row[f.column]);
      const sets = FIELDS.filter((f) => input.changes[f.key] !== undefined);
      const params: unknown[] = [placement.id, input.entry ?? placement.entry];
      const assignments = sets.map((f) => `${f.column} = $${params.push(input.changes[f.key])}`);
      const updated = await ctx.db.query<PlacementRow>(
        `UPDATE placements SET entry = $2, version = version + 1${assignments.length ? ', ' + assignments.join(', ') : ''} WHERE id = $1 RETURNING *`,
        params,
      );
      const after = toPlacement(updated.rows[0]!);
      const word = undoWord(changed.map((f) => f.key));
      if (word) {
        const before = Object.fromEntries(changed.map((f) => [f.key, row[f.column]]));
        await ctx.db.query(`INSERT INTO undo_entries (room_id, user_id, placement_id, field, before) VALUES ($1,$2,$3,$4,$5)`, [
          room.id, ctx.actor.userId, placement.id, word, JSON.stringify(before),
        ]);
      }
      const cleared = input.entry ? await claimEntry(ctx, room.id, placement.id) : [];
      await recordChange(ctx, room, { kind: 'update', placementId: placement.id, scope: `update:${room.id}:${placement.id}`, status: 200, response: () => ({ placement: after }) });
      ctx.after.push(() => publishChanged(room.id, [after, ...cleared]));
      return json(200, { placement: after });
    },
  });

  route('DELETE', '/api/rooms/:roomId/placements/:placementId', {
    auth: 'member',
    transaction: true,
    load: loadPlacement,
    replay: (ctx, { room, placement }) => replayOf(ctx, `delete:${room.id}:${placement.id}`),
    conflict: async (ctx, { room, placement }) => {
      await assertEditable(ctx.db, room.id);
      await deletedConflict(ctx, placement);
      await assertNotHeldByOther(ctx.db, room.id, 'placement', placement.id, ctx.actor.userId);
    },
    validate: (ctx) => {
      if (!validOpId(opIdOf(ctx))) throw validation({ opId: 'must be 8 to 64 letters, digits, - or _' });
    },
    run: async (ctx, { room, placement }) => {
      await ctx.db.query(`UPDATE placements SET deleted_at = clock_timestamp(), deleted_by = $2 WHERE id = $1`, [placement.id, ctx.actor.userId]);
      await ctx.db.query(`UPDATE rooms SET scene_order = scene_order - $2::text WHERE id = $1`, [room.id, placement.id]);
      const unlinked = await ctx.db.query<NodeRow>(`UPDATE nodes SET placement_id = NULL, version = version + 1 WHERE room_id = $1 AND placement_id = $2 RETURNING *`, [room.id, placement.id]);
      await recordChange(ctx, room, { kind: 'delete', placementId: placement.id, scope: `delete:${room.id}:${placement.id}`, status: 204, response: () => undefined });
      ctx.after.push(async () => {
        await hub.publish(roomChannel(room.id), 'placement', { deletedId: placement.id });
        await emitNodes(db, room.id, unlinked.rows.map(toNode));
        await emitRoom(db, room.id);
      });
      return empty(204);
    },
  });

  route('POST', '/api/rooms/:roomId/placements/:placementId/scene-move', {
    auth: 'member',
    transaction: true,
    load: loadPlacement,
    replay: (ctx, { room, placement }) => replayOf(ctx, `move:${room.id}:${placement.id}`),
    conflict: async (ctx, { room, placement }) => {
      await assertEditable(ctx.db, room.id);
      await deletedConflict(ctx, placement);
    },
    validate: (ctx, { room, placement }) => {
      const input = ctx.input();
      if (!validOpId(opIdOf(ctx))) input.fields.add('opId', 'must be 8 to 64 letters, digits, - or _');
      const direction = input.oneOf('direction', ['up', 'down'] as const);
      input.fields.check();
      const index = room.scene_order.indexOf(placement.id);
      if (direction === 'up' && index === 0) input.fields.add('direction', 'already first');
      if (direction === 'down' && index === room.scene_order.length - 1) input.fields.add('direction', 'already last');
      input.fields.check();
      return direction!;
    },
    run: async (ctx, { room, placement }, direction) => {
      const order = [...room.scene_order];
      const index = order.indexOf(placement.id);
      const other = direction === 'up' ? index - 1 : index + 1;
      [order[index], order[other]] = [order[other]!, order[index]!];
      await ctx.db.query(`UPDATE rooms SET scene_order = $2 WHERE id = $1`, [room.id, JSON.stringify(order)]);
      const revision = await recordChange(ctx, room, {
        kind: 'move', placementId: placement.id, scope: `move:${room.id}:${placement.id}`, status: 200, response: (rev) => ({ sceneOrder: order, revision: rev }),
      });
      ctx.after.push(async () => {
        await hub.publish(roomChannel(room.id), 'room', { room: await reloadRoom(db, room.id), sceneOrder: order });
      });
      return json(200, { sceneOrder: order, revision });
    },
  });

  route('POST', '/api/rooms/:roomId/undo', {
    auth: 'member',
    transaction: true,
    load: async (ctx) => findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, true),
    conflict: async (ctx, room) => {
      await assertEditable(ctx.db, room.id);
      const entry = (await ctx.db.query<{ id: string; placement_id: string }>(
        `SELECT id, placement_id FROM undo_entries WHERE room_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1`, [room.id, ctx.actor.userId],
      )).rows[0];
      if (!entry) throw fail(409, 'nothing_to_undo');
      const placement = await findPlacement(ctx.db, room.id, entry.placement_id);
      if (placement.deleted_at) {
        await db.query(`DELETE FROM undo_entries WHERE id = $1`, [entry.id]);
        const by = placement.deleted_by ? { userId: placement.deleted_by, displayName: await userName(ctx.db, placement.deleted_by) } : null;
        throw fail(409, 'undo_conflict', { label: placement.label, deletedBy: by });
      }
      await assertNotHeldByOther(ctx.db, room.id, 'placement', placement.id, ctx.actor.userId);
    },
    run: async (ctx, room) => {
      const entry = (await ctx.db.query<{ id: string; placement_id: string; field: string; before: Changes }>(
        `SELECT id, placement_id, field, before FROM undo_entries WHERE room_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1 FOR UPDATE`, [room.id, ctx.actor.userId],
      )).rows[0]!;
      const params: unknown[] = [entry.placement_id];
      const assignments = FIELDS.filter((f) => entry.before[f.key] !== undefined).map((f) => `${f.column} = $${params.push(entry.before[f.key])}`);
      const updated = await ctx.db.query<PlacementRow>(`UPDATE placements SET version = version + 1, ${assignments.join(', ')} WHERE id = $1 RETURNING *`, params);
      await ctx.db.query(`DELETE FROM undo_entries WHERE id = $1`, [entry.id]);
      const placement = toPlacement(updated.rows[0]!);
      const undone = { placementId: placement.id, label: placement.label, field: entry.field };
      const revision = await recordChange(ctx, room, {
        kind: 'undo', placementId: placement.id, scope: `undo:${room.id}`, status: 200, response: (rev) => ({ undone, placement, revision: rev }),
      });
      ctx.after.push(() => publishChanged(room.id, [placement]));
      return json(200, { undone, placement, revision });
    },
  });
}
