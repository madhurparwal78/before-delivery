import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { fail } from '../errors.js';
import { empty, json, route, type Ctx } from '../http.js';
import { wouldLoop } from '../domain/chain.js';
import { assertNotHeldByOther } from '../domain/locks.js';
import { assertEditable, emitNodes, emitRoom, findNode, findRoom, listNodes, toNode, type NodeRow, type RoomRow } from '../domain/rooms.js';
import { recordChange } from '../domain/changes.js';
import { hub, roomChannel } from '../events.js';
import { UUID } from '../validate.js';
import type { NodeKind, TriggerNode } from '../../shared/types.js';

const KINDS: NodeKind[] = ['puzzle', 'lock', 'cue', 'exit'];
const ANSWER_KINDS: NodeKind[] = ['puzzle', 'exit'];

interface NodeFields {
  title: string;
  kind: NodeKind;
  placementId: string | null;
  answer: string | null;
  prerequisites: string[];
}

/** Validates a node's fields against the room (the whole node: `base` fills what the request leaves out). */
async function readNode(ctx: Ctx, room: RoomRow, existing: TriggerNode | null): Promise<NodeFields> {
  const input = ctx.input();
  const base: NodeFields = existing ?? { title: '', kind: 'puzzle', placementId: null, answer: null, prerequisites: [] };
  const out = { ...base };
  if (existing) input.int('version', 0, 2_147_483_647);
  if (input.has('title') || !existing) out.title = input.text('title', 1, 60, { trim: true }) ?? '';
  if (input.has('kind') || !existing) out.kind = input.oneOf('kind', KINDS) ?? 'puzzle';
  if (input.has('answer')) {
    if (input.body.answer === null) out.answer = null;
    else out.answer = input.text('answer', 1, 40) ?? null;
  }
  if (input.has('placementId')) {
    const id = input.body.placementId;
    if (id === null) out.placementId = null;
    else {
      const found = typeof id === 'string' && UUID.test(id) ? await ctx.db.query(`SELECT 1 FROM placements WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`, [id, room.id]) : null;
      if (found && found.rows.length > 0) out.placementId = id as string;
      else input.fields.add('placementId', 'unknown placement');
    }
  }
  if (out.answer !== null && !ANSWER_KINDS.includes(out.kind)) input.fields.add('answer', 'only a puzzle or an exit has an answer');
  if (input.has('prerequisites')) {
    const given = input.body.prerequisites;
    const siblings = await ctx.db.query<{ id: string }>(`SELECT id FROM nodes WHERE room_id = $1`, [room.id]);
    const known = new Set(siblings.rows.map((r) => r.id));
    if (!Array.isArray(given) || !given.every((id) => typeof id === 'string' && known.has(id) && id !== existing?.id)) {
      input.fields.add('prerequisites', 'must be other nodes of this room');
    } else {
      out.prerequisites = [...new Set(given as string[])];
      const all = (await listNodes(ctx.db, room.id)) as { id: string; prerequisites: string[] }[];
      if (existing && wouldLoop(all, existing.id, out.prerequisites)) input.fields.add('prerequisites', 'would create a loop');
    }
  }
  if (out.kind === 'exit') {
    const other = await ctx.db.query(`SELECT 1 FROM nodes WHERE room_id = $1 AND kind = 'exit' AND id IS DISTINCT FROM $2`, [room.id, existing?.id ?? null]);
    if (other.rows.length > 0) input.fields.add('kind', 'room already has an exit');
  }
  input.fields.check();
  return out;
}

const publishNodes = (roomId: string, nodes: TriggerNode[]) => async (): Promise<void> => {
  await emitNodes(db, roomId, nodes);
  await emitRoom(db, roomId);
};

export function nodeRoutes(): void {
  route('POST', '/api/rooms/:roomId/nodes', {
    auth: 'member',
    transaction: true,
    load: (ctx) => findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, true),
    conflict: (ctx, room) => assertEditable(ctx.db, room.id),
    validate: (ctx, room) => readNode(ctx, room, null),
    run: async (ctx, room, fields) => {
      const id = randomUUID();
      const inserted = await ctx.db.query<NodeRow>(
        `INSERT INTO nodes (id, room_id, title, kind, placement_id, answer, prerequisites) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, room.id, fields.title, fields.kind, fields.placementId, fields.answer, fields.prerequisites],
      );
      const node = toNode(inserted.rows[0]!);
      await recordChange(ctx, room, { kind: 'create', placementId: null, scope: `node:${id}`, status: 201, response: () => ({ node }) });
      ctx.after.push(publishNodes(room.id, [node]));
      return json(201, { node });
    },
  });

  const nodeLoader = async (ctx: Ctx): Promise<{ room: RoomRow; node: TriggerNode }> => {
    const room = await findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, true);
    return { room, node: await findNode(ctx.db, room.id, ctx.params.nodeId!) };
  };

  route('PATCH', '/api/rooms/:roomId/nodes/:nodeId', {
    auth: 'member',
    transaction: true,
    load: nodeLoader,
    conflict: async (ctx, { room, node }) => {
      await assertEditable(ctx.db, room.id);
      await assertNotHeldByOther(ctx.db, room.id, 'node', node.id, ctx.actor.userId);
      const version = (ctx.body as { version?: unknown } | undefined)?.version;
      if (typeof version === 'number' && version !== node.version) throw fail(412, 'stale_version', { current: node });
    },
    validate: (ctx, { room, node }) => readNode(ctx, room, node),
    run: async (ctx, { room, node }, fields) => {
      const updated = await ctx.db.query<NodeRow>(
        `UPDATE nodes SET title = $2, kind = $3, placement_id = $4, answer = $5, prerequisites = $6, version = version + 1 WHERE id = $1 RETURNING *`,
        [node.id, fields.title, fields.kind, fields.placementId, fields.answer, fields.prerequisites],
      );
      const after = toNode(updated.rows[0]!);
      await recordChange(ctx, room, { kind: 'update', placementId: null, scope: `node:${node.id}`, status: 200, response: () => ({ node: after }) });
      ctx.after.push(publishNodes(room.id, [after]));
      return json(200, { node: after });
    },
  });

  route('DELETE', '/api/rooms/:roomId/nodes/:nodeId', {
    auth: 'member',
    transaction: true,
    load: nodeLoader,
    conflict: async (ctx, { room, node }) => {
      await assertEditable(ctx.db, room.id);
      await assertNotHeldByOther(ctx.db, room.id, 'node', node.id, ctx.actor.userId);
    },
    run: async (ctx, { room, node }) => {
      await ctx.db.query(`DELETE FROM nodes WHERE id = $1`, [node.id]);
      const dependants = await ctx.db.query<NodeRow>(
        `UPDATE nodes SET prerequisites = array_remove(prerequisites, $2::uuid), version = version + 1 WHERE room_id = $1 AND $2::uuid = ANY(prerequisites) RETURNING *`,
        [room.id, node.id],
      );
      await recordChange(ctx, room, { kind: 'delete', placementId: null, scope: `node:${node.id}`, status: 204, response: () => undefined });
      ctx.after.push(async () => {
        await hub.publish(roomChannel(room.id), 'node', { deletedId: node.id, chainOrder: (await listNodes(db, room.id)).map((n) => n.id) });
        await publishNodes(room.id, dependants.rows.map(toNode))();
      });
      return empty(204);
    },
  });
}
