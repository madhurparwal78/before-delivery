import { query, queryOne } from "../db.js";
import { notFound } from "../errors.js";
import { towerLabel } from "../../shared/format.js";
import type { CorridorGeometry } from "../../shared/corridor.js";

export interface UtilityRow {
  id: string;
  name: string;
  time_zone: string;
  forester_name: string;
  forester_email: string;
}

export interface CorridorRow {
  id: string;
  tenant_id: string;
  utility_id: string;
  name: string;
  voltage_kv: number;
  clearance_threshold_m: number;
  origin_lon_deg: number;
  origin_lat_deg: number;
  azimuth_deg: number;
  length_m: number;
  inspection_due: Date;
  utility_name: string;
  time_zone: string;
  forester_name: string;
  forester_email: string;
}

export interface TowerRow {
  number: number;
  chainage_m: number;
  base_height_m: number;
  attachment_height_m: number;
  lon_deg: number;
  lat_deg: number;
}

const SELECT_CORRIDOR = `
  SELECT c.*, u.name AS utility_name, u.time_zone, u.forester_name, u.forester_email
  FROM corridors c JOIN utilities u ON u.id = c.utility_id
`;

export async function listCorridors(tenantId: string): Promise<CorridorRow[]> {
  return query<CorridorRow>(`${SELECT_CORRIDOR} WHERE c.tenant_id = $1 ORDER BY c.name`, [tenantId]);
}

export async function findCorridor(corridorId: string): Promise<CorridorRow | null> {
  return queryOne<CorridorRow>(`${SELECT_CORRIDOR} WHERE c.id = $1`, [corridorId]);
}

/** A corridor the caller's tenant owns, or 404. */
export async function requireTenantCorridor(
  corridorId: string,
  tenantId: string,
): Promise<CorridorRow> {
  const corridor = await findCorridor(corridorId);
  if (!corridor || corridor.tenant_id !== tenantId) throw notFound();
  return corridor;
}

export async function listTowers(corridorId: string): Promise<TowerRow[]> {
  return query<TowerRow>(
    `SELECT number, chainage_m, base_height_m, attachment_height_m, lon_deg, lat_deg
     FROM towers WHERE corridor_id = $1 ORDER BY number`,
    [corridorId],
  );
}

const geometryCache = new Map<string, CorridorGeometry>();

/** Corridor geometry, cached because towers and the centreline never change. */
export async function corridorGeometry(corridor: CorridorRow): Promise<CorridorGeometry> {
  const cached = geometryCache.get(corridor.id);
  if (cached) return cached;
  const towers = await listTowers(corridor.id);
  const geometry: CorridorGeometry = {
    originLonDeg: corridor.origin_lon_deg,
    originLatDeg: corridor.origin_lat_deg,
    azimuthDeg: corridor.azimuth_deg,
    lengthM: corridor.length_m,
    clearanceThresholdM: corridor.clearance_threshold_m,
    towers: towers.map((t) => ({
      number: t.number,
      chainageM: t.chainage_m,
      lonDeg: t.lon_deg,
      latDeg: t.lat_deg,
      baseHeightM: t.base_height_m,
      attachmentHeightM: t.attachment_height_m,
    })),
  };
  geometryCache.set(corridor.id, geometry);
  return geometry;
}

export function isoDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's date in an IANA zone, as YYYY-MM-DD. */
export function todayInZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * A corridor is overdue when today's date in its utility's time zone is later
 * than the inspection due date. Decided on every read.
 */
export function isOverdue(inspectionDue: string, timeZone: string, now = new Date()): boolean {
  return todayInZone(timeZone, now) > inspectionDue;
}

export interface SetSummary {
  id: string;
  revision: number;
  state: string;
}

/** The set that is not closed, else the most recent closed set, else null. */
export async function currentSet(corridorId: string): Promise<SetSummary | null> {
  return queryOne<SetSummary>(
    `SELECT id, revision, state FROM findings_sets
     WHERE corridor_id = $1
     ORDER BY (state <> 'closed') DESC, revision DESC
     LIMIT 1`,
    [corridorId],
  );
}

export interface CorridorPayload {
  id: string;
  name: string;
  voltage_kv: number;
  clearance_threshold_m: number;
  length_m: number;
  tower_count: number;
  utility: {
    id: string;
    name: string;
    time_zone: string;
    forester_name: string;
    forester_email: string;
  };
  inspection_due: string;
  overdue: boolean;
  current_set: SetSummary | null;
}

export async function corridorPayload(corridor: CorridorRow): Promise<CorridorPayload> {
  const due = isoDate(corridor.inspection_due);
  const towers = await listTowers(corridor.id);
  return {
    id: corridor.id,
    name: corridor.name,
    voltage_kv: corridor.voltage_kv,
    clearance_threshold_m: corridor.clearance_threshold_m,
    length_m: corridor.length_m,
    tower_count: towers.length,
    utility: {
      id: corridor.utility_id,
      name: corridor.utility_name,
      time_zone: corridor.time_zone,
      forester_name: corridor.forester_name,
      forester_email: corridor.forester_email,
    },
    inspection_due: due,
    overdue: isOverdue(due, corridor.time_zone),
    current_set: await currentSet(corridor.id),
  };
}

export function towerPayload(towers: TowerRow[]): unknown[] {
  return towers.map((t) => ({
    number: t.number,
    label: towerLabel(t.number),
    chainage_m: t.chainage_m,
    lon_deg: t.lon_deg,
    lat_deg: t.lat_deg,
    base_height_m: t.base_height_m,
    attachment_height_m: t.attachment_height_m,
  }));
}
