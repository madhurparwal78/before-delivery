/**
 * Projects, room placements and the light-pool figures the server and the browser
 * must agree on. Only the owner and the collaborators can see a project; any other
 * caller gets the not-found answer.
 */

import type { PoolClient } from "pg";
import { query, queryOne, row, rows } from "../db/pool.js";
import { centreLux, ownLux, poolDiameterMm, type LitFitting } from "../../shared/lightpool.js";
import type { Collaborator, Placement, Project, ProjectLine, ProjectSummary } from "../../shared/types.js";

export interface ProjectRow {
  id: string;
  name: string;
  client_name: string | null;
  owner_id: string;
  ceiling_height_mm: number;
  room_width_mm: number;
  room_depth_mm: number;
  cover_key: string | null;
  created_at: Date;
}

interface PlacementRow {
  id: string;
  variant_code: string;
  ordinal: number;
  x_mm: number;
  y_mm: number;
  beam_deg: number;
  cct_k: number;
  candela: number;
}

interface LineRow {
  variant_code: string;
  product_name: string;
  quantity: number;
}

const PLACEMENT_SQL = `
  SELECT pl.id, pl.variant_code, pl.ordinal, pl.x_mm, pl.y_mm, v.beam_deg, v.cct_k, v.candela
  FROM placements pl JOIN variants v ON v.code = pl.variant_code
  WHERE pl.project_id = $1
  ORDER BY pl.variant_code, pl.ordinal
`;

const LINE_SQL = `
  SELECT pl.variant_code, p.name AS product_name, pl.quantity
  FROM project_lines pl
  JOIN variants v ON v.code = pl.variant_code
  JOIN products p ON p.slug = v.product_slug
  WHERE pl.project_id = $1
  ORDER BY pl.added_at, pl.variant_code
`;

const COLLABORATOR_SQL = `
  SELECT u.id AS user_id, u.name, u.email
  FROM project_collaborators pc JOIN users u ON u.id = pc.user_id
  WHERE pc.project_id = $1
  ORDER BY pc.created_at
`;

/** Returns the project when the caller owns it or collaborates on it, else null. */
export async function findVisibleProject(projectId: string, userId: string): Promise<ProjectRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  return queryOne<ProjectRow>(
    `SELECT p.* FROM projects p
     WHERE p.id = $1 AND (
       p.owner_id = $2 OR EXISTS (
         SELECT 1 FROM project_collaborators pc WHERE pc.project_id = p.id AND pc.user_id = $2
       )
     )`,
    [projectId, userId],
  );
}

export async function lockProject(client: PoolClient, projectId: string): Promise<ProjectRow | null> {
  return row<ProjectRow>(client, "SELECT * FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
}

/** Builds the published placement objects, with every light-pool figure. */
export function toPlacements(placementRows: readonly PlacementRow[], ceilingHeightMm: number): Placement[] {
  const all: LitFitting[] = placementRows.map((p) => ({
    x_mm: p.x_mm,
    y_mm: p.y_mm,
    beam_deg: p.beam_deg,
    candela: p.candela,
  }));

  return placementRows.map((placement, index) => ({
    id: placement.id,
    variant_code: placement.variant_code,
    ordinal: placement.ordinal,
    x_mm: placement.x_mm,
    y_mm: placement.y_mm,
    beam_deg: placement.beam_deg,
    cct_k: placement.cct_k,
    candela: placement.candela,
    pool_diameter_mm: poolDiameterMm(placement.beam_deg, ceilingHeightMm),
    own_lux: ownLux(placement.candela, ceilingHeightMm),
    centre_lux: centreLux(all[index] as LitFitting, all, ceilingHeightMm),
  }));
}

export async function buildProject(record: ProjectRow, viewerId: string, live: boolean): Promise<Project> {
  const placementRows = await query<PlacementRow>(PLACEMENT_SQL, [record.id]);
  const lineRows = await query<LineRow>(LINE_SQL, [record.id]);
  const collaboratorRows = await query<Collaborator>(COLLABORATOR_SQL, [record.id]);

  const placements = toPlacements(placementRows, record.ceiling_height_mm);
  const placedCounts = new Map<string, number>();
  for (const placement of placementRows) {
    placedCounts.set(placement.variant_code, (placedCounts.get(placement.variant_code) ?? 0) + 1);
  }

  const lines: ProjectLine[] = lineRows.map((line) => ({
    variant_code: line.variant_code,
    product_name: line.product_name,
    quantity: line.quantity,
    placed: placedCounts.get(line.variant_code) ?? 0,
  }));

  return {
    id: record.id,
    name: record.name,
    client_name: record.client_name,
    owner_id: record.owner_id,
    is_owner: record.owner_id === viewerId,
    ceiling_height_mm: record.ceiling_height_mm,
    room_width_mm: record.room_width_mm,
    room_depth_mm: record.room_depth_mm,
    cover: record.cover_key ? { status: "ready", url: `/api/projects/${record.id}/cover` } : null,
    lines,
    placements,
    collaborators: collaboratorRows,
    live,
  };
}

export async function buildProjectSummary(
  record: ProjectRow,
  viewerId: string,
  live: boolean,
): Promise<ProjectSummary> {
  const { placements: _placements, ...summary } = await buildProject(record, viewerId, live);
  return summary;
}

/** The trade buyer's own projects and the ones they collaborate on. */
export async function listProjectsFor(userId: string): Promise<ProjectRow[]> {
  return query<ProjectRow>(
    `SELECT p.* FROM projects p
     WHERE p.owner_id = $1 OR EXISTS (
       SELECT 1 FROM project_collaborators pc WHERE pc.project_id = p.id AND pc.user_id = $1
     )
     ORDER BY p.created_at DESC`,
    [userId],
  );
}

export async function countPlacements(client: PoolClient, projectId: string, variantCode: string): Promise<number> {
  const result = await row<{ count: number }>(
    client,
    "SELECT COUNT(*)::int AS count FROM placements WHERE project_id = $1 AND variant_code = $2",
    [projectId, variantCode],
  );
  return result?.count ?? 0;
}

export async function lineQuantity(client: PoolClient, projectId: string, variantCode: string): Promise<number> {
  const result = await row<{ quantity: number }>(
    client,
    "SELECT quantity FROM project_lines WHERE project_id = $1 AND variant_code = $2",
    [projectId, variantCode],
  );
  return result?.quantity ?? 0;
}

/** Ordinals count a variant's placements from 1 and are never reused in a project. */
export async function nextOrdinal(client: PoolClient, projectId: string, variantCode: string): Promise<number> {
  const result = await row<{ next_ordinal: number }>(
    client,
    `INSERT INTO project_variant_ordinals (project_id, variant_code, next_ordinal)
     VALUES ($1,$2,2)
     ON CONFLICT (project_id, variant_code)
       DO UPDATE SET next_ordinal = project_variant_ordinals.next_ordinal + 1
     RETURNING next_ordinal - 1 AS next_ordinal`,
    [projectId, variantCode],
  );
  if (!result) throw new Error("failed to allocate a placement ordinal");
  return result.next_ordinal;
}

export function isInsideRoom(record: ProjectRow, xMm: number, yMm: number): boolean {
  return xMm >= 0 && xMm <= record.room_width_mm && yMm >= 0 && yMm <= record.room_depth_mm;
}

export async function placementsOutside(
  client: PoolClient,
  projectId: string,
  widthMm: number,
  depthMm: number,
): Promise<number> {
  const result = await row<{ count: number }>(
    client,
    `SELECT COUNT(*)::int AS count FROM placements
     WHERE project_id = $1 AND (x_mm > $2 OR y_mm > $3)`,
    [projectId, widthMm, depthMm],
  );
  return result?.count ?? 0;
}

export async function singlePlacement(
  client: PoolClient,
  projectId: string,
  placementId: string,
): Promise<PlacementRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(placementId)) return null;
  const found = await rows<PlacementRow>(
    client,
    `SELECT pl.id, pl.variant_code, pl.ordinal, pl.x_mm, pl.y_mm, v.beam_deg, v.cct_k, v.candela
     FROM placements pl JOIN variants v ON v.code = pl.variant_code
     WHERE pl.project_id = $1 AND pl.id = $2`,
    [projectId, placementId],
  );
  return found[0] ?? null;
}

/** Recomputes one placement's figures against every other placement in the project. */
export async function placementDto(
  client: PoolClient,
  projectId: string,
  placementId: string,
  ceilingHeightMm: number,
): Promise<Placement> {
  const all = await rows<PlacementRow>(client, PLACEMENT_SQL, [projectId]);
  const built = toPlacements(all, ceilingHeightMm);
  const found = built.find((placement) => placement.id === placementId);
  if (!found) throw new Error("the placement disappeared while it was being read");
  return found;
}
