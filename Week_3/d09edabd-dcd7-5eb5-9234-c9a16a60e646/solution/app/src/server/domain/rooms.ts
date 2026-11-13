import type { Queryable } from '../db.js';
import { fail, notFound } from '../errors.js';
import { hub, roomChannel } from '../events.js';
import type { Placement, PlacementKind, Room, TriggerNode, NodeKind } from '../../shared/types.js';
import { RUNNING } from '../../shared/playtest.js';
import { chainOrder, chainStats } from './chain.js';

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
  scene_order: string[];
  thumbnail_at: Date | null;
}

export interface PlacementRow {
  id: string;
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
  deleted_at: Date | null;
  deleted_by: string | null;
}

export interface NodeRow {
  id: string;
  title: string;
  kind: NodeKind;
  placement_id: string | null;
  answer: string | null;
  prerequisites: string[];
  version: number;
}

export async function findRoom(db: Queryable, workspaceId: string, roomId: string, lock = false): Promise<RoomRow> {
  const found = await db.query<RoomRow>(`SELECT * FROM rooms WHERE id = $1 AND workspace_id = $2${lock ? ' FOR UPDATE' : ''}`, [roomId, workspaceId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

export const toPlacement = (row: PlacementRow): Placement => ({
  id: row.id, kind: row.kind, label: row.label, propId: row.prop_id, entry: row.entry,
  xMm: row.x_mm, yMm: row.y_mm, zMm: row.z_mm, rotationDeg: row.rotation_deg,
  widthMm: row.width_mm, depthMm: row.depth_mm, heightMm: row.height_mm, version: row.version,
});

export const toNode = (row: NodeRow): TriggerNode => ({
  id: row.id, title: row.title, kind: row.kind, placementId: row.placement_id, answer: row.answer,
  prerequisites: row.prerequisites, version: row.version,
});

/** Live placements in creation order. */
export async function listPlacements(db: Queryable, roomId: string): Promise<Placement[]> {
  const found = await db.query<PlacementRow>(`SELECT * FROM placements WHERE room_id = $1 AND deleted_at IS NULL ORDER BY seq`, [roomId]);
  return found.rows.map(toPlacement);
}

/** The room's nodes in chain order. */
export async function listNodes(db: Queryable, roomId: string): Promise<TriggerNode[]> {
  const found = await db.query<NodeRow>(`SELECT * FROM nodes WHERE room_id = $1 ORDER BY seq`, [roomId]);
  return chainOrder(found.rows.map(toNode));
}

export async function findPlacement(db: Queryable, roomId: string, placementId: string, lock = false): Promise<PlacementRow> {
  const found = await db.query<PlacementRow>(`SELECT * FROM placements WHERE id = $1 AND room_id = $2${lock ? ' FOR UPDATE' : ''}`, [placementId, roomId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

export async function findNode(db: Queryable, roomId: string, nodeId: string): Promise<TriggerNode> {
  const found = await db.query<NodeRow>(`SELECT * FROM nodes WHERE id = $1 AND room_id = $2 FOR UPDATE`, [nodeId, roomId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return toNode(row);
}

export async function userName(db: Queryable, userId: string): Promise<string> {
  const found = await db.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [userId]);
  return found.rows[0]?.display_name ?? 'Someone';
}

/** The nodes solved in the room's latest session that reached running. */
async function solvedNodeIds(db: Queryable, roomId: string): Promise<Set<string>> {
  const found = await db.query<{ node_id: string }>(
    `SELECT s.node_id FROM solves s WHERE s.playtest_id =
       (SELECT id FROM playtests WHERE room_id = $1 AND started_at IS NOT NULL ORDER BY started_at DESC, created_at DESC LIMIT 1)`,
    [roomId],
  );
  return new Set(found.rows.map((row) => row.node_id));
}

/** The room's props: its live placements that are not doors. */
export async function propCount(db: Queryable, roomId: string): Promise<number> {
  const found = await db.query<{ n: string }>(`SELECT count(*) AS n FROM placements WHERE room_id = $1 AND deleted_at IS NULL AND kind <> 'door'`, [roomId]);
  return Number(found.rows[0]!.n);
}

export async function roomStats(db: Queryable, roomId: string): Promise<Room['stats']> {
  return chainStats(await listNodes(db, roomId), await solvedNodeIds(db, roomId), await propCount(db, roomId));
}

export async function toRoom(db: Queryable, row: RoomRow): Promise<Room> {
  return {
    id: row.id, name: row.name, starter: row.starter,
    widthMm: row.width_mm, depthMm: row.depth_mm, heightMm: row.height_mm,
    version: row.version, revision: row.revision, stats: await roomStats(db, row.id),
    thumbnailUrl: row.thumbnail_at ? `/api/rooms/${row.id}/thumbnail?v=${row.thumbnail_at.getTime()}` : null,
  };
}

export async function reloadRoom(db: Queryable, roomId: string): Promise<Room> {
  const found = await db.query<RoomRow>(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
  return toRoom(db, found.rows[0]!);
}

/** Any session of the room running blocks every edit. */
export async function assertEditable(db: Queryable, roomId: string): Promise<void> {
  const running = await db.query(`SELECT 1 FROM playtests WHERE room_id = $1 AND state = $2`, [roomId, RUNNING]);
  if (running.rows.length > 0) throw fail(409, 'playtest_running');
}

export async function emitRoom(db: Queryable, roomId: string): Promise<void> {
  await hub.publish(roomChannel(roomId), 'room', { room: await reloadRoom(db, roomId) });
}

export async function emitNodes(db: Queryable, roomId: string, nodes: TriggerNode[]): Promise<void> {
  const chainOrderIds = (await listNodes(db, roomId)).map((node) => node.id);
  for (const node of nodes) await hub.publish(roomChannel(roomId), 'node', { node, chainOrder: chainOrderIds });
}
