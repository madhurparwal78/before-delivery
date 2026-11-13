import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { errors } from '../errors.js';
import { length } from '../../shared/units.js';
import type {
  ChainFigures,
  NodeKind,
  PackBody,
  PlacementKind,
  RoomVersion,
  VersionState,
} from '../../shared/types.js';
import { rowOne, rows, tx } from '../services/db.js';
import { deleteObject, putObject, getObject } from '../services/storage.js';
import {
  chainFigures,
  livePlacements,
  orderedNodes,
  roomColumns,
  sceneOrder,
} from '../repo/rooms.js';
import type { RoomRow } from '../repo/rooms.js';

export interface FrozenPlacement {
  id: string;
  kind: PlacementKind;
  label: string;
  propId: string | null;
  entry: boolean;
  xMm: number;
  yMm: number;
  zMm: number;
  rotationDeg: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface FrozenNode {
  id: string;
  title: string;
  kind: NodeKind;
  placementId: string | null;
  answer: string | null;
  prerequisites: string[];
}

export interface FrozenProp {
  id: string;
  name: string;
  bytes: number;
  sha256: string;
  contentType: string;
}

export interface VersionRow {
  id: string;
  room_id: string;
  number: number;
  label: string;
  state: VersionState;
  superseded_by: number | null;
  frozen_at: Date;
  stats: ChainFigures;
  link_token: string | null;
  snapshot_key: string;
  room_snapshot: { name: string; widthMm: number; depthMm: number; heightMm: number };
  placements: FrozenPlacement[];
  nodes: FrozenNode[];
  props: FrozenProp[];
  scene_order: string[];
}

export const versionColumns = `id, room_id, number, label, state, superseded_by, frozen_at,
  stats, link_token, snapshot_key, room_snapshot, placements, nodes, props, scene_order`;

export function packUrlOf(token: string | null): string | null {
  return token === null ? null : `${config.publicOrigin}/pack/${token}`;
}

export function toVersion(row: VersionRow): RoomVersion {
  return {
    id: row.id,
    roomId: row.room_id,
    number: row.number,
    label: row.label,
    state: row.state,
    supersededBy: row.superseded_by,
    frozenAt: row.frozen_at.toISOString(),
    stats: row.stats,
    packUrl: packUrlOf(row.link_token),
  };
}

export function fileExtension(contentType: string): string {
  return contentType === 'model/gltf-binary' ? 'glb' : 'gltf';
}

export function propKey(propId: string, contentType: string): string {
  return `props/${propId}.${fileExtension(contentType)}`;
}

export function versionPropKey(
  versionId: string,
  propId: string,
  contentType: string,
): string {
  return `versions/${versionId}/props/${propId}.${fileExtension(contentType)}`;
}

export function snapshotKey(versionId: string): string {
  return `versions/${versionId}/snapshot.json`;
}

export function packBody(row: VersionRow): PackBody {
  const labels = new Map(row.placements.map((placement) => [placement.id, placement.label]));
  const titles = new Map(row.nodes.map((node) => [node.id, node.title]));
  return {
    version: {
      number: row.number,
      label: row.label,
      state: row.state,
      frozenAt: row.frozen_at.toISOString(),
      supersededBy: row.superseded_by,
    },
    room: {
      name: row.room_snapshot.name,
      width: length(row.room_snapshot.widthMm),
      depth: length(row.room_snapshot.depthMm),
      height: length(row.room_snapshot.heightMm),
    },
    placements: row.placements.map((placement) => ({
      id: placement.id,
      kind: placement.kind,
      label: placement.label,
      propId: placement.propId,
      entry: placement.entry,
      x: length(placement.xMm),
      y: length(placement.yMm),
      z: length(placement.zMm),
      width: length(placement.widthMm),
      depth: length(placement.depthMm),
      height: length(placement.heightMm),
      rotationDeg: placement.rotationDeg,
    })),
    nodes: row.nodes.map((node) => ({
      title: node.title,
      kind: node.kind,
      needs: node.prerequisites.map((id) => titles.get(id) ?? ''),
      linkedPlacement: node.placementId === null ? null : labels.get(node.placementId) ?? null,
      answer: node.answer,
    })),
    props: row.props.map((prop) => ({
      id: prop.id,
      name: prop.name,
      bytes: prop.bytes,
      sha256: prop.sha256,
      downloadPath: `/api/pack/${row.link_token ?? ''}/props/${prop.id}`,
    })),
    stats: row.stats,
  };
}

export function newLinkToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface FreezeResult {
  version: RoomVersion;
  superseded: RoomVersion | null;
}

/**
 * Writes the version records, the snapshot object, a copy of every placed prop
 * file and the build-pack link together, or writes none of them.
 */
export async function freezeRoom(roomId: string, label: string): Promise<FreezeResult> {
  const versionId = randomUUID();
  const written: string[] = [];
  try {
    return await tx(async (client) => {
      const room = await rowOne<RoomRow>(
        client,
        `select ${roomColumns} from rooms where id = $1 for update`,
        [roomId],
      );
      if (!room) throw errors.notFound();
      const placements = await livePlacements(client, roomId);
      const nodes = await orderedNodes(client, roomId);
      const order = await sceneOrder(client, roomId);
      const stats = await chainFigures(client, roomId);
      const highest = await rowOne<{ number: number }>(
        client,
        `select coalesce(max(number), 0) as number from room_versions where room_id = $1`,
        [roomId],
      );
      const number = (highest ? highest.number : 0) + 1;
      const token = newLinkToken();
      const frozenAt = new Date();

      const frozenPlacements: FrozenPlacement[] = placements.map((placement) => ({
        id: placement.id,
        kind: placement.kind,
        label: placement.label,
        propId: placement.prop_id,
        entry: placement.entry,
        xMm: placement.x_mm,
        yMm: placement.y_mm,
        zMm: placement.z_mm,
        rotationDeg: placement.rotation_deg,
        widthMm: placement.width_mm,
        depthMm: placement.depth_mm,
        heightMm: placement.height_mm,
      }));
      const frozenNodes: FrozenNode[] = nodes.map((node) => ({
        id: node.id,
        title: node.title,
        kind: node.kind,
        placementId: node.placementId,
        answer: node.answer,
        prerequisites: node.prerequisites,
      }));
      const propIds = [
        ...new Set(
          placements
            .filter((placement) => placement.prop_id !== null)
            .map((placement) => placement.prop_id as string),
        ),
      ];
      const propRows =
        propIds.length === 0
          ? []
          : await rows<{
              id: string;
              name: string;
              bytes: number;
              sha256: string;
              content_type: string;
            }>(
              client,
              `select id, name, bytes, sha256, content_type from props where id = any($1::text[])`,
              [propIds],
            );
      const frozenProps: FrozenProp[] = propRows.map((prop) => ({
        id: prop.id,
        name: prop.name,
        bytes: prop.bytes,
        sha256: prop.sha256,
        contentType: prop.content_type,
      }));

      const row: VersionRow = {
        id: versionId,
        room_id: roomId,
        number,
        label,
        state: 'frozen',
        superseded_by: null,
        frozen_at: frozenAt,
        stats,
        link_token: token,
        snapshot_key: snapshotKey(versionId),
        room_snapshot: {
          name: room.name,
          widthMm: room.width_mm,
          depthMm: room.depth_mm,
          heightMm: room.height_mm,
        },
        placements: frozenPlacements,
        nodes: frozenNodes,
        props: frozenProps,
        scene_order: order,
      };

      for (const prop of frozenProps) {
        const bytes = await getObject(propKey(prop.id, prop.contentType));
        if (bytes === null) throw errors.storageUnavailable();
        const key = versionPropKey(versionId, prop.id, prop.contentType);
        await putObject(key, bytes, prop.contentType);
        written.push(key);
      }
      const snapshot = Buffer.from(JSON.stringify(packBody(row)), 'utf8');
      await putObject(row.snapshot_key, snapshot, 'application/json');
      written.push(row.snapshot_key);

      const previous = await rowOne<VersionRow>(
        client,
        `update room_versions set state = 'superseded', superseded_by = $2
           where room_id = $1 and state = 'frozen' returning ${versionColumns}`,
        [roomId, number],
      );
      await client.query(
        `insert into room_versions (id, room_id, number, label, state, superseded_by, frozen_at,
           stats, link_token, snapshot_key, room_snapshot, placements, nodes, props, scene_order)
         values ($1,$2,$3,$4,'frozen',null,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          versionId,
          roomId,
          number,
          label,
          frozenAt,
          JSON.stringify(stats),
          token,
          row.snapshot_key,
          JSON.stringify(row.room_snapshot),
          JSON.stringify(frozenPlacements),
          JSON.stringify(frozenNodes),
          JSON.stringify(frozenProps),
          JSON.stringify(order),
        ],
      );
      return {
        version: toVersion(row),
        superseded: previous ? toVersion({ ...previous, superseded_by: number }) : null,
      };
    });
  } catch (error) {
    for (const key of written) {
      await deleteObject(key).catch(() => undefined);
    }
    throw error;
  }
}
