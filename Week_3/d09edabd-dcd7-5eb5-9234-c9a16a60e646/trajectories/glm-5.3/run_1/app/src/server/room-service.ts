import { pool } from './db.js';
import { chainOrder, figuresFor, type NodeLike } from '../shared/chain.js';
import type { ChainFigures, Placement, TriggerNode } from '../shared/types.js';

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
}

export interface PlacementRow extends Omit<Placement, 'kind'> {
  kind: Placement['kind'];
  room_id: string;
  created_at: Date;
}

export interface NodeRow extends Omit<TriggerNode, 'kind'> {
  kind: TriggerNode['kind'];
  room_id: string;
  created_at: Date;
}

export function placementJson(row: Record<string, unknown>): Placement {
  return {
    id: row.id as string,
    kind: row.kind as Placement['kind'],
    label: row.label as string,
    propId: (row.prop_id as string | null) ?? null,
    entry: !!row.entry,
    xMm: row.x_mm as number,
    yMm: row.y_mm as number,
    zMm: row.z_mm as number,
    rotationDeg: row.rotation_deg as number,
    widthMm: row.width_mm as number,
    depthMm: row.depth_mm as number,
    heightMm: row.height_mm as number,
    version: row.version as number,
  };
}

export function nodeJson(row: Record<string, unknown>): TriggerNode {
  return {
    id: row.id as string,
    title: row.title as string,
    kind: row.kind as TriggerNode['kind'],
    placementId: (row.placement_id as string | null) ?? null,
    answer: (row.answer as string | null) ?? null,
    prerequisites: row.prerequisites as string[],
    version: row.version as number,
  };
}

export function asNodeLike(rows: Record<string, unknown>[]): NodeLike[] {
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    kind: r.kind as TriggerNode['kind'],
    placementId: (r.placement_id as string | null) ?? null,
    answer: (r.answer as string | null) ?? null,
    prerequisites: r.prerequisites as string[],
    createdAt: r.created_at as Date,
  }));
}

export async function roomPlacements(roomId: string): Promise<PlacementRow[]> {
  const r = await pool.query(
    `SELECT * FROM placements WHERE room_id = $1 AND deleted_at IS NULL ORDER BY created_at, id`,
    [roomId]
  );
  return r.rows as unknown as PlacementRow[];
}

export async function roomNodes(roomId: string): Promise<NodeRow[]> {
  const r = await pool.query(
    `SELECT * FROM trigger_nodes WHERE room_id = $1 ORDER BY created_at, id`,
    [roomId]
  );
  return r.rows as unknown as NodeRow[];
}

export function chainSorted(nodes: Record<string, unknown>[]): NodeRow[] {
  // Order by the shared chain rule, keeping the full rows.
  const ordered = chainOrder(asNodeLike(nodes)).map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id as string, n]));
  return ordered.map((id) => byId.get(id) as unknown as NodeRow);
}

/** The room's chain figures, computed in this one place. */
export async function roomStats(roomId: string): Promise<ChainFigures> {
  const [placements, nodes, latest] = await Promise.all([
    roomPlacements(roomId),
    roomNodes(roomId),
    pool.query(
      `SELECT s.id FROM sessions s WHERE s.room_id = $1 AND s.state IN ('running','ended') ORDER BY
         CASE WHEN s.state = 'running' THEN 0 ELSE 1 END, s.started_at DESC NULLS LAST, s.created_at DESC
       LIMIT 1`,
      [roomId]
    ),
  ]);
  let solved = 0;
  const sessionId = latest.rows[0]?.id as string | undefined;
  if (sessionId) {
    const r = await pool.query(`SELECT count(DISTINCT node_id) AS n FROM session_solves WHERE session_id = $1`, [sessionId]);
    solved = Number(r.rows[0].n);
  }
  return figuresFor(
    asNodeLike(nodes as unknown as Record<string, unknown>[]),
    placements.filter((p) => p.kind !== 'door').length,
    solved
  );
}

export function roomJson(row: Record<string, unknown>, stats: ChainFigures): import('../shared/types.js').Room {
  return {
    id: row.id as string,
    name: row.name as string,
    starter: !!row.starter,
    widthMm: row.width_mm as number,
    depthMm: row.depth_mm as number,
    heightMm: row.height_mm as number,
    version: row.version as number,
    revision: row.revision as number,
    stats,
    thumbnailUrl: row.has_thumbnail ? `/api/rooms/${row.id}/thumbnail` : null,
  };
}
