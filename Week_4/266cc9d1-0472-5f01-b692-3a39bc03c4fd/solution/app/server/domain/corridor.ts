// Corridors, their towers and spans, and the inspection-due (overdue) rule.
import type { Db } from "../db.js";
import { fail } from "../http/errors.js";
import { spanAt } from "../../shared/corridorLine.js";
import { spanLabel } from "../../shared/text.js";
import { toEcef, type Centreline, type Ecef } from "../../shared/geodesy.js";

interface Tower {
  number: number;
  chainageM: number;
  lonDeg: number;
  latDeg: number;
  baseHeightM: number;
}

export interface CorridorRecord {
  id: string;
  tenantId: string;
  name: string;
  voltageKv: number;
  thresholdM: number;
  inspectionDue: string;
  attachmentHeightM: number;
  line: Centreline;
  towers: Tower[];
  lengthM: number;
  utility: { id: string; name: string; timeZone: string; foresterName: string; foresterEmail: string };
}

interface Span {
  fromTower: number;
  toTower: number;
  label: string;
}

/** A corridor is overdue when today's date in its utility's time zone is later than the due date. */
function isOverdue(inspectionDue: string, timeZone: string, now: Date = new Date()): boolean {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return today > inspectionDue;
}

export function spanOf(corridor: CorridorRecord, chainageM: number): Span {
  const { fromTower, toTower } = spanAt(corridor.towers, chainageM);
  return { fromTower, toTower, label: spanLabel(fromTower, toTower) };
}

export function attachmentPoint(corridor: CorridorRecord, towerNumber: number): Ecef {
  const tower = corridor.towers.find((t) => t.number === towerNumber);
  if (tower === undefined) throw new Error(`Corridor ${corridor.id} has no tower ${towerNumber}`);
  return toEcef(tower.lonDeg, tower.latDeg, tower.baseHeightM + corridor.attachmentHeightM);
}

interface CorridorRow {
  id: string;
  tenant_id: string;
  name: string;
  voltage_kv: number;
  clearance_threshold_m: number;
  inspection_due: string;
  tower1_lat_deg: number;
  tower1_lon_deg: number;
  azimuth_deg: number;
  attachment_height_m: number;
  utility_id: string;
  utility_name: string;
  time_zone: string;
  forester_name: string;
  forester_email: string;
}

const geometryCache = new Map<string, Tower[]>();

async function towersOf(db: Db, corridorId: string): Promise<Tower[]> {
  const cached = geometryCache.get(corridorId);
  if (cached !== undefined) return cached;
  const found = await db.query<{ number: number; chainage_m: number; lon_deg: number; lat_deg: number; base_height_m: number }>(
    "SELECT number, chainage_m, lon_deg, lat_deg, base_height_m FROM towers WHERE corridor_id = $1 ORDER BY number",
    [corridorId],
  );
  const towers = found.rows.map((r) => ({
    number: r.number,
    chainageM: r.chainage_m,
    lonDeg: r.lon_deg,
    latDeg: r.lat_deg,
    baseHeightM: r.base_height_m,
  }));
  geometryCache.set(corridorId, towers);
  return towers;
}

async function toRecord(db: Db, row: CorridorRow): Promise<CorridorRecord> {
  const towers = await towersOf(db, row.id);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    voltageKv: row.voltage_kv,
    thresholdM: row.clearance_threshold_m,
    inspectionDue: row.inspection_due,
    attachmentHeightM: row.attachment_height_m,
    line: { origin: { lonDeg: row.tower1_lon_deg, latDeg: row.tower1_lat_deg }, azimuthDeg: row.azimuth_deg },
    towers,
    lengthM: towers[towers.length - 1]?.chainageM ?? 0,
    utility: {
      id: row.utility_id,
      name: row.utility_name,
      timeZone: row.time_zone,
      foresterName: row.forester_name,
      foresterEmail: row.forester_email,
    },
  };
}

const CORRIDOR_SELECT = `
  SELECT c.id, c.tenant_id, c.name, c.voltage_kv, c.clearance_threshold_m, c.inspection_due::text AS inspection_due,
         c.tower1_lat_deg, c.tower1_lon_deg, c.azimuth_deg, c.attachment_height_m,
         u.id AS utility_id, u.name AS utility_name, u.time_zone, u.forester_name, u.forester_email
    FROM corridors c JOIN utilities u ON u.id = c.utility_id`;

/** The caller's tenant's corridor; another tenant's corridor answers 404 like an unknown one. */
export async function loadCorridor(db: Db, tenantId: string, corridorId: string): Promise<CorridorRecord> {
  const found = await db.query<CorridorRow>(`${CORRIDOR_SELECT} WHERE c.id = $1 AND c.tenant_id = $2`, [corridorId, tenantId]);
  const row = found.rows[0];
  if (row === undefined) throw fail.notFound();
  return toRecord(db, row);
}

export async function listCorridors(db: Db, tenantId: string): Promise<CorridorRecord[]> {
  const found = await db.query<CorridorRow>(`${CORRIDOR_SELECT} WHERE c.tenant_id = $1 ORDER BY c.name, c.id`, [tenantId]);
  return Promise.all(found.rows.map((row) => toRecord(db, row)));
}

interface CurrentSet {
  id: string;
  revision: number;
  state: string;
}

/** The corridor's set that is not closed, else its most recent closed set, else null. */
async function currentSet(db: Db, corridorId: string): Promise<CurrentSet | null> {
  const found = await db.query<CurrentSet>(
    `SELECT id, revision, state FROM findings_sets WHERE corridor_id = $1
      ORDER BY (state <> 'closed') DESC, revision DESC LIMIT 1`,
    [corridorId],
  );
  return found.rows[0] ?? null;
}

export async function corridorJson(db: Db, corridor: CorridorRecord): Promise<Record<string, unknown>> {
  return {
    id: corridor.id,
    name: corridor.name,
    voltage_kv: corridor.voltageKv,
    clearance_threshold_m: corridor.thresholdM,
    length_m: corridor.lengthM,
    tower_count: corridor.towers.length,
    utility: {
      id: corridor.utility.id,
      name: corridor.utility.name,
      time_zone: corridor.utility.timeZone,
      forester_name: corridor.utility.foresterName,
      forester_email: corridor.utility.foresterEmail,
    },
    inspection_due: corridor.inspectionDue,
    overdue: isOverdue(corridor.inspectionDue, corridor.utility.timeZone),
    current_set: await currentSet(db, corridor.id),
  };
}

export function towersJson(corridor: CorridorRecord): Record<string, unknown>[] {
  return corridor.towers.map((t) => ({
    number: t.number,
    label: `T${t.number}`,
    chainage_m: t.chainageM,
    lon_deg: t.lonDeg,
    lat_deg: t.latDeg,
    base_height_m: t.baseHeightM,
    attachment_height_m: corridor.attachmentHeightM,
  }));
}

export function chainageMessage(corridor: CorridorRecord): string {
  return `Chainage must be between 0 and ${corridor.lengthM.toFixed(1)} metres.`;
}
