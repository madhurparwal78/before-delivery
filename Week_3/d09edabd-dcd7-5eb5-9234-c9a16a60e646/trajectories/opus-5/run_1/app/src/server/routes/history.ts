import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { requireMember, requireOwner } from '../domain/session.js';
import { asRecord, opIdOf } from '../domain/validate.js';
import { undoFieldWord } from './placements.js';
import {
  livePlacements,
  loadRoom,
  orderedNodes,
  placementColumns,
  recordChange,
  sceneOrder,
  toPlacement,
} from '../repo/rooms.js';
import type { PlacementRow } from '../repo/rooms.js';
import { rowOne, rows, tx } from '../services/db.js';
import { versionColumns } from '../domain/versions.js';
import type { VersionRow } from '../domain/versions.js';
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

const placementFields: Record<string, string> = {
  xMm: 'x_mm',
  yMm: 'y_mm',
  zMm: 'z_mm',
  rotationDeg: 'rotation_deg',
  widthMm: 'width_mm',
  depthMm: 'depth_mm',
  heightMm: 'height_mm',
  label: 'label',
};

export const historyRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/placements/:placementId/scene-move',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      const placementId = ctx.params.placementId;
      const raw = opIdHeader(ctx);
      const body = asRecord(ctx.body);
      const known = await tx((client) =>
        rowOne<{ id: string }>(client, `select id from placements where id = $1 and room_id = $2`, [
          placementId,
          room.id,
        ]),
      );
      if (!known) throw errors.notFound();
      const stored = await replayOf(member, room.id, 'move', placementId, raw);
      if (stored) return reply(stored.status, stored.response);
      const deleted = await tx((client) => deletedPlacement(client, room.id, placementId));
      if (deleted) throw errors.placementDeleted(deleted.label, deleted.deletedBy);
      await assertNotHeldByOther(room.id, 'placement', placementId, member);
      return tx(async (client) => {
        await assertNoRunningPlaytest(client, room.id);
        const opId = opIdOf(raw);
        const direction = body.direction;
        if (direction !== 'up' && direction !== 'down') {
          throw errors.field('direction', 'must be up or down');
        }
        const order = await sceneOrder(client, room.id);
        const index = order.indexOf(placementId);
        if (direction === 'up' && index === 0) throw errors.field('direction', 'already first');
        if (direction === 'down' && index === order.length - 1) {
          throw errors.field('direction', 'already last');
        }
        const swapWith = direction === 'up' ? index - 1 : index + 1;
        const next = [...order];
        next[index] = order[swapWith];
        next[swapWith] = order[index];
        for (let position = 0; position < next.length; position += 1) {
          await client.query(`update placements set scene_pos = $2 where id = $1`, [
            next[position],
            position,
          ]);
        }
        const revision = await recordChange(client, member.workspaceId, room.id, {
          kind: 'move',
          placementId,
          opId,
          userId: member.id,
          status: 200,
          response: { sceneOrder: next, revision: 0 },
        });
        await client.query(
          `update room_changes set response = $2 where room_id = $1 and revision = $3`,
          [room.id, JSON.stringify({ sceneOrder: next, revision }), revision],
        );
        publishRoom(room.id, 'room', { room: await loadRoom(client, room.id) });
        return { sceneOrder: next, revision };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/undo',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      for (;;) {
        const entry = await tx((client) =>
          rowOne<{ id: string; placement_id: string; before_fields: Record<string, unknown> }>(
            client,
            `select id, placement_id, before_fields from undo_entries
               where room_id = $1 and user_id = $2 order by created_seq desc limit 1`,
            [room.id, member.id],
          ),
        );
        if (!entry) throw errors.nothingToUndo();
        const deleted = await tx((client) =>
          deletedPlacement(client, room.id, entry.placement_id),
        );
        if (deleted) {
          await tx((client) =>
            client.query(`delete from undo_entries where id = $1`, [entry.id]).then(() => undefined),
          );
          throw errors.undoConflict(deleted.label, deleted.deletedBy);
        }
        await assertNotHeldByOther(room.id, 'placement', entry.placement_id, member);
        const result = await tx(async (client) => {
          await assertNoRunningPlaytest(client, room.id);
          const still = await rowOne<{ id: string }>(
            client,
            `select id from undo_entries where id = $1`,
            [entry.id],
          );
          if (!still) return null;
          const fields = Object.keys(entry.before_fields).filter(
            (field) => field in placementFields,
          );
          const assignments = fields
            .map((field, index) => `${placementFields[field]} = $${index + 2}`)
            .join(', ');
          const row = await rowOne<PlacementRow>(
            client,
            `update placements set ${assignments}${fields.length > 0 ? ',' : ''}
               version = version + 1 where id = $1 returning ${placementColumns}`,
            [entry.placement_id, ...fields.map((field) => entry.before_fields[field])],
          );
          if (!row) throw errors.notFound();
          await client.query(`delete from undo_entries where id = $1`, [entry.id]);
          const placement = toPlacement(row);
          const revision = await recordChange(client, member.workspaceId, room.id, {
            kind: 'undo',
            placementId: entry.placement_id,
            opId: null,
            userId: member.id,
            status: 200,
            response: null,
          });
          const answer = {
            undone: {
              placementId: entry.placement_id,
              label: row.label,
              field: undoFieldWord(fields),
            },
            placement,
            revision,
          };
          await client.query(
            `update room_changes set response = $2 where room_id = $1 and revision = $3`,
            [room.id, JSON.stringify(answer), revision],
          );
          publishRoom(room.id, 'placement', { placement });
          return answer;
        });
        if (result !== null) return result;
      }
    },
  },
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/restore',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      requireOwner(member);
      const body = asRecord(ctx.body);
      return tx(async (client) => {
        await assertNoRunningPlaytest(client, room.id);
        const versionId = typeof body.versionId === 'string' ? body.versionId : '';
        const version = await rowOne<VersionRow>(
          client,
          `select ${versionColumns} from room_versions where id = $1 and room_id = $2`,
          [versionId, room.id],
        );
        if (!version) throw errors.field('versionId', 'unknown version');
        const propIds = [
          ...new Set(
            version.placements
              .filter((placement) => placement.propId !== null)
              .map((placement) => placement.propId as string),
          ),
        ];
        if (propIds.length > 0) {
          const present = await rows<{ id: string }>(
            client,
            `select id from props where id = any($1::text[]) and workspace_id = $2`,
            [propIds, member.workspaceId],
          );
          if (present.length !== propIds.length) throw errors.propMissing();
        }
        await client.query(
          `update rooms set width_mm = $2, depth_mm = $3, height_mm = $4, version = version + 1
             where id = $1`,
          [room.id, version.room_snapshot.widthMm, version.room_snapshot.depthMm, version.room_snapshot.heightMm],
        );
        const keep = new Set(version.placements.map((placement) => placement.id));
        for (const live of await livePlacements(client, room.id)) {
          if (!keep.has(live.id)) {
            await client.query(
              `update placements set deleted_at = now(), deleted_by = $2 where id = $1`,
              [live.id, member.id],
            );
          }
        }
        const positions = new Map(version.scene_order.map((id, index) => [id, index]));
        for (const placement of version.placements) {
          const existing = await rowOne<{ id: string }>(
            client,
            `select id from placements where id = $1`,
            [placement.id],
          );
          const scenePos = positions.get(placement.id) ?? 0;
          if (existing) {
            await client.query(
              `update placements set kind = $2, label = $3, prop_id = $4, entry = $5, x_mm = $6,
                 y_mm = $7, z_mm = $8, rotation_deg = $9, width_mm = $10, depth_mm = $11,
                 height_mm = $12, scene_pos = $13, deleted_at = null, deleted_by = null,
                 version = version + 1 where id = $1`,
              [
                placement.id,
                placement.kind,
                placement.label,
                placement.propId,
                placement.entry,
                placement.xMm,
                placement.yMm,
                placement.zMm,
                placement.rotationDeg,
                placement.widthMm,
                placement.depthMm,
                placement.heightMm,
                scenePos,
              ],
            );
          } else {
            await client.query(
              `insert into placements (id, room_id, kind, label, prop_id, entry, x_mm, y_mm, z_mm,
                 rotation_deg, width_mm, depth_mm, height_mm, scene_pos, version)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1)`,
              [
                placement.id,
                room.id,
                placement.kind,
                placement.label,
                placement.propId,
                placement.entry,
                placement.xMm,
                placement.yMm,
                placement.zMm,
                placement.rotationDeg,
                placement.widthMm,
                placement.depthMm,
                placement.heightMm,
                scenePos,
              ],
            );
          }
        }
        const keepNodes = version.nodes.map((node) => node.id);
        await client.query(
          `delete from trigger_nodes where room_id = $1 and not (id = any($2::text[]))`,
          [room.id, keepNodes],
        );
        for (const node of version.nodes) {
          const existing = await rowOne<{ id: string }>(
            client,
            `select id from trigger_nodes where id = $1`,
            [node.id],
          );
          if (existing) {
            await client.query(
              `update trigger_nodes set title = $2, kind = $3, placement_id = $4, answer = $5,
                 prerequisites = $6, version = version + 1 where id = $1`,
              [
                node.id,
                node.title,
                node.kind,
                node.placementId,
                node.answer,
                JSON.stringify(node.prerequisites),
              ],
            );
          } else {
            await client.query(
              `insert into trigger_nodes (id, room_id, title, kind, placement_id, answer,
                 prerequisites, version)
               values ($1,$2,$3,$4,$5,$6,$7,1)`,
              [
                node.id,
                room.id,
                node.title,
                node.kind,
                node.placementId,
                node.answer,
                JSON.stringify(node.prerequisites),
              ],
            );
          }
        }
        await client.query(`delete from undo_entries where room_id = $1`, [room.id]);
        const revision = await recordChange(client, member.workspaceId, room.id, {
          kind: 'restore',
          placementId: null,
          opId: null,
          userId: member.id,
          status: 200,
          response: null,
        });
        const restored = {
          room: await loadRoom(client, room.id),
          placements: (await livePlacements(client, room.id)).map(toPlacement),
          nodes: await orderedNodes(client, room.id),
          sceneOrder: await sceneOrder(client, room.id),
          revision,
        };
        await client.query(
          `update room_changes set response = $2 where room_id = $1 and revision = $3`,
          [room.id, JSON.stringify(restored), revision],
        );
        publishRoom(room.id, 'restore', restored);
        return restored;
      });
    },
  },
];
