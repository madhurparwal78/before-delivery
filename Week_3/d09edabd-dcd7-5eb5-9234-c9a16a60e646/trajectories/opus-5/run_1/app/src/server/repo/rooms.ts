import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { chainOrder, longestRun } from '../../shared/chain.js';
import type {
  ChainFigures,
  ChangeKind,
  Placement,
  PlacementKind,
  Room,
  NodeKind,
  TriggerNode,
} from '../../shared/types.js';
import { rowOne, rows } from '../services/db.js';
import type { StarterRoom } from '../../shared/starter.js';

export interface RoomRow {
  id: string;
  workspace_id: string;
  name: string;
  starter: boolean;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  version: number;
  revision: number;
  has_thumbnail: boolean;
}

export interface PlacementRow {
  id: string;
  room_id: string;
  kind: PlacementKind;
  label: string;
  prop_id: string | null;
  entry: boolean;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  rotation_deg: number;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  version: number;
  scene_pos: number;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export interface NodeRow {
  id: string;
  room_id: string;
  title: string;
  kind: NodeKind;
  placement_id: string | null;
  answer: string | null;
  prerequisites: string[];
  version: number;
}

export const roomColumns = `id, workspace_id, name, starter, width_mm, depth_mm, height_mm,
  version, revision, has_thumbnail`;
export const placementColumns = `id, room_id, kind, label, prop_id, entry, x_mm, y_mm, z_mm,
  rotation_deg, width_mm, depth_mm, height_mm, version, scene_pos, deleted_at, deleted_by`;
export const nodeColumns = `id, room_id, title, kind, placement_id, answer, prerequisites, version`;

export function toPlacement(row: PlacementRow): Placement {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    propId: row.prop_id,
    entry: row.entry,
    xMm: row.x_mm,
    yMm: row.y_mm,
    zMm: row.z_mm,
    rotationDeg: row.rotation_deg,
    widthMm: row.width_mm,
    depthMm: row.depth_mm,
    heightMm: row.height_mm,
    version: row.version,
  };
}

export function toNode(row: NodeRow): TriggerNode {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    placementId: row.placement_id,
    answer: row.answer,
    prerequisites: row.prerequisites,
    version: row.version,
  };
}

export function toRoom(row: RoomRow, stats: ChainFigures): Room {
  return {
    id: row.id,
    name: row.name,
    starter: row.starter,
    widthMm: row.width_mm,
    depthMm: row.depth_mm,
    heightMm: row.height_mm,
    version: row.version,
    revision: row.revision,
    stats,
    thumbnailUrl: row.has_thumbnail ? `/api/rooms/${row.id}/thumbnail` : null,
  };
}

export async function livePlacements(client: PoolClient, roomId: string): Promise<PlacementRow[]> {
  return rows<PlacementRow>(
    client,
    `select ${placementColumns} from placements
      where room_id = $1 and deleted_at is null order by created_seq`,
    [roomId],
  );
}

export async function roomNodes(client: PoolClient, roomId: string): Promise<NodeRow[]> {
  return rows<NodeRow>(
    client,
    `select ${nodeColumns} from trigger_nodes where room_id = $1 order by created_seq`,
    [roomId],
  );
}

export async function sceneOrder(client: PoolClient, roomId: string): Promise<string[]> {
  const list = await rows<{ id: string }>(
    client,
    `select id from placements where room_id = $1 and deleted_at is null
       order by scene_pos, created_seq`,
    [roomId],
  );
  return list.map((row) => row.id);
}

/** The latest session of the room that reached `running` decides the solved figure. */
export async function solvedCount(
  client: PoolClient,
  roomId: string,
  nodeIds: string[],
): Promise<number> {
  const session = await rowOne<{ id: string }>(
    client,
    `select id from playtests where room_id = $1 and started_at is not null
       order by started_at desc limit 1`,
    [roomId],
  );
  if (!session || nodeIds.length === 0) return 0;
  const row = await rowOne<{ count: string }>(
    client,
    `select count(*)::text as count from solves where session_id = $1 and node_id = any($2::text[])`,
    [session.id, nodeIds],
  );
  return row ? Number(row.count) : 0;
}

export async function chainFigures(client: PoolClient, roomId: string): Promise<ChainFigures> {
  const placements = await livePlacements(client, roomId);
  const nodes = await roomNodes(client, roomId);
  const chainNodes = nodes.map((node) => ({ id: node.id, prerequisites: node.prerequisites }));
  return {
    solved: await solvedCount(
      client,
      roomId,
      nodes.map((node) => node.id),
    ),
    total: nodes.length,
    longestRun: longestRun(chainNodes),
    props: placements.filter((row) => row.kind !== 'door').length,
  };
}

export async function loadRoom(client: PoolClient, roomId: string): Promise<Room | null> {
  const row = await rowOne<RoomRow>(client, `select ${roomColumns} from rooms where id = $1`, [
    roomId,
  ]);
  if (!row) return null;
  return toRoom(row, await chainFigures(client, roomId));
}

export async function orderedNodes(client: PoolClient, roomId: string): Promise<TriggerNode[]> {
  const nodes = (await roomNodes(client, roomId)).map(toNode);
  return chainOrder(nodes);
}

export interface ChangeRecord {
  kind: ChangeKind;
  placementId: string | null;
  opId: string | null;
  userId: string;
  status: number;
  response: unknown;
}

/** Every accepted change adds exactly one to the revision and one log entry. */
export async function recordChange(
  client: PoolClient,
  workspaceId: string,
  roomId: string,
  change: ChangeRecord,
): Promise<number> {
  const room = await rowOne<{ revision: number }>(
    client,
    `update rooms set revision = revision + 1 where id = $1 returning revision`,
    [roomId],
  );
  const revision = room ? room.revision : 0;
  await client.query(
    `insert into room_changes
       (id, workspace_id, room_id, revision, op_id, kind, placement_id, user_id,
        response_status, response)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      workspaceId,
      roomId,
      revision,
      change.opId,
      change.kind,
      change.placementId,
      change.userId,
      change.status,
      JSON.stringify(change.response ?? null),
    ],
  );
  return revision;
}

export async function insertStarterRoom(
  client: PoolClient,
  workspaceId: string,
  template: StarterRoom,
): Promise<string> {
  const roomId = randomUUID();
  await client.query(
    `insert into rooms (id, workspace_id, name, name_lower, starter, width_mm, depth_mm, height_mm)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      roomId,
      workspaceId,
      template.name,
      template.name.toLowerCase(),
      template.starter,
      template.widthMm,
      template.depthMm,
      template.heightMm,
    ],
  );
  const placementIds = new Map<string, string>();
  let scenePos = 0;
  for (const placement of template.placements) {
    const id = randomUUID();
    placementIds.set(placement.label, id);
    await client.query(
      `insert into placements (id, room_id, kind, label, entry, x_mm, y_mm, z_mm, rotation_deg,
         width_mm, depth_mm, height_mm, scene_pos)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        roomId,
        placement.kind,
        placement.label,
        placement.entry === true,
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
    scenePos += 1;
  }
  const nodeIds = new Map<string, string>();
  for (const node of template.nodes) {
    nodeIds.set(node.title, randomUUID());
  }
  for (const node of template.nodes) {
    await client.query(
      `insert into trigger_nodes (id, room_id, title, kind, placement_id, answer, prerequisites)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        nodeIds.get(node.title),
        roomId,
        node.title,
        node.kind,
        node.placement ? (placementIds.get(node.placement) ?? null) : null,
        node.answer ?? null,
        JSON.stringify((node.needs ?? []).map((title) => nodeIds.get(title))),
      ],
    );
  }
  return roomId;
}
