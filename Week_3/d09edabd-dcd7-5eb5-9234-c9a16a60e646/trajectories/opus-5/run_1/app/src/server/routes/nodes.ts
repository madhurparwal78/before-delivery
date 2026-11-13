import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { hasCycle } from '../../shared/chain.js';
import type { NodeKind } from '../../shared/types.js';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { requireMember } from '../domain/session.js';
import { FieldCollector, asRecord, has, text } from '../domain/validate.js';
import { loadRoom, nodeColumns, recordChange, roomNodes, toNode } from '../repo/rooms.js';
import type { NodeRow } from '../repo/rooms.js';
import { rowOne, tx } from '../services/db.js';
import {
  assertNoRunningPlaytest,
  assertNotHeldByOther,
  memberRoom,
  publishRoom,
  reply,
} from './support.js';

const kinds: NodeKind[] = ['puzzle', 'lock', 'cue', 'exit'];

async function nodeOf(
  client: PoolClient,
  roomId: string,
  nodeId: string,
): Promise<NodeRow | null> {
  return rowOne<NodeRow>(
    client,
    `select ${nodeColumns} from trigger_nodes where id = $1 and room_id = $2`,
    [nodeId, roomId],
  );
}

async function validatePrerequisites(
  client: PoolClient,
  roomId: string,
  nodeId: string | null,
  raw: unknown,
  collector: FieldCollector,
): Promise<string[]> {
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
    collector.add('prerequisites', 'must be a list of node ids of this room');
    return [];
  }
  const ids = raw as string[];
  const existing = await roomNodes(client, roomId);
  const known = new Set(existing.map((node) => node.id));
  if (ids.some((id) => !known.has(id) || id === nodeId)) {
    collector.add('prerequisites', 'must be a list of node ids of this room');
    return [];
  }
  const graph = existing
    .filter((node) => node.id !== nodeId)
    .map((node) => ({ id: node.id, prerequisites: node.prerequisites }));
  graph.push({ id: nodeId ?? 'new-node', prerequisites: ids });
  if (hasCycle(graph)) collector.add('prerequisites', 'would create a loop');
  return ids;
}

async function validateLinkedPlacement(
  client: PoolClient,
  roomId: string,
  raw: unknown,
  collector: FieldCollector,
): Promise<string | null> {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    collector.add('placementId', 'must be a placement of this room');
    return null;
  }
  const row = await rowOne<{ id: string }>(
    client,
    `select id from placements where id = $1 and room_id = $2 and deleted_at is null`,
    [raw, roomId],
  );
  if (!row) collector.add('placementId', 'must be a placement of this room');
  return row ? raw : null;
}

function validateAnswer(
  body: Record<string, unknown>,
  kind: NodeKind,
  collector: FieldCollector,
): string | null {
  if (!has(body, 'answer') || body.answer === null) return null;
  const value = body.answer;
  if (typeof value !== 'string' || value.length < 1 || value.length > 40) {
    collector.add('answer', 'must be 1 to 40 characters');
    return null;
  }
  if (kind !== 'puzzle' && kind !== 'exit') {
    collector.add('answer', 'only a puzzle or exit node has an answer');
    return null;
  }
  return value;
}

export const nodeRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/nodes',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const body = asRecord(ctx.body);
      return tx(async (client) => {
        await assertNoRunningPlaytest(client, room.id);
        const collector = new FieldCollector();
        const title = text(body, 'title', 1, 60, collector);
        const kindText = typeof body.kind === 'string' ? body.kind : '';
        const kind = kinds.includes(kindText as NodeKind) ? (kindText as NodeKind) : null;
        if (kind === null) collector.add('kind', 'must be puzzle, lock, cue or exit');
        if (kind === 'exit') {
          const other = await rowOne<{ id: string }>(
            client,
            `select id from trigger_nodes where room_id = $1 and kind = 'exit' limit 1`,
            [room.id],
          );
          if (other) collector.add('kind', 'room already has an exit');
        }
        const prerequisites = has(body, 'prerequisites')
          ? await validatePrerequisites(client, room.id, null, body.prerequisites, collector)
          : [];
        const placementId = await validateLinkedPlacement(
          client,
          room.id,
          body.placementId,
          collector,
        );
        const answer = validateAnswer(body, kind ?? 'puzzle', collector);
        collector.throwIfAny();
        const id = randomUUID();
        await client.query(
          `insert into trigger_nodes (id, room_id, title, kind, placement_id, answer,
             prerequisites)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [id, room.id, title, kind, placementId, answer, JSON.stringify(prerequisites)],
        );
        const row = await nodeOf(client, room.id, id);
        if (!row) throw errors.notFound();
        const node = toNode(row);
        await recordChange(client, member.workspaceId, room.id, {
          kind: 'create',
          placementId: null,
          opId: null,
          userId: member.id,
          status: 201,
          response: { node },
        });
        publishRoom(room.id, 'node', { node });
        publishRoom(room.id, 'room', { room: await loadRoom(client, room.id) });
        return reply(201, { node });
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/rooms/:roomId/nodes/:nodeId',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const nodeId = ctx.params.nodeId;
      const body = asRecord(ctx.body);
      const known = await tx((client) => nodeOf(client, room.id, nodeId));
      if (!known) throw errors.notFound();
      await assertNotHeldByOther(room.id, 'node', nodeId, member);
      return tx(async (client) => {
        await assertNoRunningPlaytest(client, room.id);
        const current = await nodeOf(client, room.id, nodeId);
        if (!current) throw errors.notFound();
        if (body.version !== current.version) throw errors.staleVersion(toNode(current));
        const collector = new FieldCollector();
        const title = has(body, 'title') ? text(body, 'title', 1, 60, collector) : null;
        let kind = current.kind;
        if (has(body, 'kind')) {
          const kindText = typeof body.kind === 'string' ? body.kind : '';
          if (!kinds.includes(kindText as NodeKind)) {
            collector.add('kind', 'must be puzzle, lock, cue or exit');
          } else {
            kind = kindText as NodeKind;
            if (kind === 'exit' && current.kind !== 'exit') {
              const other = await rowOne<{ id: string }>(
                client,
                `select id from trigger_nodes where room_id = $1 and kind = 'exit' limit 1`,
                [room.id],
              );
              if (other) collector.add('kind', 'room already has an exit');
            }
          }
        }
        const prerequisites = has(body, 'prerequisites')
          ? await validatePrerequisites(client, room.id, nodeId, body.prerequisites, collector)
          : current.prerequisites;
        const placementId = has(body, 'placementId')
          ? await validateLinkedPlacement(client, room.id, body.placementId, collector)
          : current.placement_id;
        const answer = has(body, 'answer')
          ? validateAnswer(body, kind, collector)
          : kind === 'puzzle' || kind === 'exit'
            ? current.answer
            : null;
        collector.throwIfAny();
        await client.query(
          `update trigger_nodes set title = $2, kind = $3, placement_id = $4, answer = $5,
             prerequisites = $6, version = version + 1 where id = $1`,
          [
            nodeId,
            title ?? current.title,
            kind,
            placementId,
            answer,
            JSON.stringify(prerequisites),
          ],
        );
        const row = await nodeOf(client, room.id, nodeId);
        if (!row) throw errors.notFound();
        const node = toNode(row);
        await recordChange(client, member.workspaceId, room.id, {
          kind: 'update',
          placementId: null,
          opId: null,
          userId: member.id,
          status: 200,
          response: { node },
        });
        publishRoom(room.id, 'node', { node });
        publishRoom(room.id, 'room', { room: await loadRoom(client, room.id) });
        return { node };
      });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/rooms/:roomId/nodes/:nodeId',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const nodeId = ctx.params.nodeId;
      const known = await tx((client) => nodeOf(client, room.id, nodeId));
      if (!known) throw errors.notFound();
      await assertNotHeldByOther(room.id, 'node', nodeId, member);
      await tx(async (client) => {
        await assertNoRunningPlaytest(client, room.id);
        await client.query(`delete from trigger_nodes where id = $1`, [nodeId]);
        const dependants = await client.query<NodeRow>(
          `update trigger_nodes set prerequisites = prerequisites - $2, version = version + 1
             where room_id = $1 and prerequisites ? $2 returning ${nodeColumns}`,
          [room.id, nodeId],
        );
        await recordChange(client, member.workspaceId, room.id, {
          kind: 'delete',
          placementId: null,
          opId: null,
          userId: member.id,
          status: 204,
          response: null,
        });
        publishRoom(room.id, 'node', { deletedId: nodeId });
        for (const row of dependants.rows) publishRoom(room.id, 'node', { node: toNode(row) });
        publishRoom(room.id, 'room', { room: await loadRoom(client, room.id) });
      });
      return undefined;
    },
  },
];
