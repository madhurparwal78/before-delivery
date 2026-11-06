// Rows to the API shapes (brief: API, Shapes), and the reads every route shares.
import type { Db } from "./db.js";
import { ApiError, forbidden, notFound } from "./errors.js";
import { openHours, WEEKDAY_NAMES, type LuxStatus, type RunCalendar } from "./domain/lux.js";
import type { PlacementStatus } from "./domain/lifecycle.js";

export type Role = "curator" | "registrar" | "preparator";
export interface Staff {
  id: string;
  name: string;
  role: Role;
}

export interface Placement {
  id: string;
  objectId: string;
  objectTitle: string;
  objectNumber: string;
  lenderId: string | null;
  wallId: string;
  wallName: string;
  offsetMm: number;
  centreHeightMm: number;
  widthMm: number;
  heightMm: number;
  heightOverride: boolean;
  plannedLux: number;
  plannedLuxHours: number;
  luxLimit: number;
  luxHourBudget: number;
  luxStatus: LuxStatus;
  status: PlacementStatus;
  claimedBy: { id: string; name: string } | null;
  version: number;
}

export interface Wall {
  id: string;
  name: string;
  lengthMm: number;
  heightMm: number;
  plannedLux: number;
}

interface Exhibition extends RunCalendar {
  id: string;
  title: string;
  museum: string;
  timeZone: string;
}

const PLACEMENT_SELECT = `
SELECT p.id, p.object_id, o.title, o.object_number, o.lender_id, p.wall_id, w.name AS wall_name, p.offset_mm,
  p.centre_height_mm, o.width_mm, o.height_mm, p.height_override, p.planned_lux, p.planned_lux_hours, o.lux_limit,
  o.lux_hour_budget, p.lux_status, p.status, p.claimed_by, s.name AS claimed_name, p.version
FROM placements p JOIN objects o ON o.id = p.object_id JOIN walls w ON w.id = p.wall_id
LEFT JOIN staff s ON s.id = p.claimed_by`;

/** A placements row joined with its object, wall and holder, typed by the schema's columns and checks. */
interface PlacementRow {
  id: string;
  object_id: string;
  title: string;
  object_number: string;
  lender_id: string | null;
  wall_id: string;
  wall_name: string;
  offset_mm: number;
  centre_height_mm: number;
  width_mm: number;
  height_mm: number;
  height_override: boolean;
  planned_lux: number;
  planned_lux_hours: string;
  lux_limit: number;
  lux_hour_budget: string;
  lux_status: LuxStatus;
  status: PlacementStatus;
  claimed_by: string | null;
  claimed_name: string | null;
  version: number;
}

function toPlacement(r: PlacementRow): Placement {
  return {
    id: r.id,
    objectId: r.object_id,
    objectTitle: r.title,
    objectNumber: r.object_number,
    lenderId: r.lender_id,
    wallId: r.wall_id,
    wallName: r.wall_name,
    offsetMm: r.offset_mm,
    centreHeightMm: r.centre_height_mm,
    widthMm: r.width_mm,
    heightMm: r.height_mm,
    heightOverride: r.height_override,
    plannedLux: r.planned_lux,
    plannedLuxHours: Number(r.planned_lux_hours),
    luxLimit: r.lux_limit,
    luxHourBudget: Number(r.lux_hour_budget),
    luxStatus: r.lux_status,
    status: r.status,
    claimedBy: r.claimed_by && r.claimed_name ? { id: r.claimed_by, name: r.claimed_name } : null,
    version: r.version,
  };
}

export async function placementsWhere(db: Db, where: string, params: unknown[] = []): Promise<Placement[]> {
  const { rows } = await db.query<PlacementRow>(`${PLACEMENT_SELECT} WHERE ${where} ORDER BY w.position, p.offset_mm, p.id`, params);
  return rows.map(toPlacement);
}

export async function placementById(db: Db, id: string, lock = false): Promise<Placement> {
  if (lock) await db.query("SELECT 1 FROM placements WHERE id = $1 FOR UPDATE", [id]);
  const [found] = await placementsWhere(db, "p.id = $1", [id]);
  if (!found) throw notFound();
  return found;
}

export async function staffById(db: Db, id: string | undefined): Promise<Staff> {
  const unknown = new ApiError(401, "unknown_staff", "Choose who you are working as.");
  if (!id) throw unknown;
  const { rows } = await db.query<Staff>("SELECT id, name, role FROM staff WHERE id = $1", [id]);
  if (!rows[0]) throw unknown;
  return rows[0];
}

export function requireRole(staff: Staff, ...roles: Role[]): void {
  if (!roles.includes(staff.role)) throw forbidden();
}

export async function exhibition(db: Db): Promise<Exhibition> {
  const { rows } = await db.query(
    `SELECT id, title, museum, time_zone, to_char(run_start,'YYYY-MM-DD') AS run_start,
       to_char(run_end,'YYYY-MM-DD') AS run_end, open_hours_per_day, closed_weekdays FROM exhibitions LIMIT 1`,
  );
  const r = rows[0];
  return {
    id: r.id,
    title: r.title,
    museum: r.museum,
    timeZone: r.time_zone,
    runStart: r.run_start,
    runEnd: r.run_end,
    openHoursPerDay: r.open_hours_per_day,
    closedWeekdays: r.closed_weekdays,
  };
}

export function exhibitionView(ex: Exhibition) {
  const hours = openHours(ex);
  return {
    id: ex.id,
    title: ex.title,
    museum: ex.museum,
    timeZone: ex.timeZone,
    runStart: ex.runStart,
    runEnd: ex.runEnd,
    openHoursPerDay: ex.openHoursPerDay,
    closedWeekdays: ex.closedWeekdays.map((d) => WEEKDAY_NAMES[d]),
    openDays: hours / ex.openHoursPerDay,
    openHours: hours,
  };
}

export async function walls(db: Db): Promise<Wall[]> {
  const { rows } = await db.query(
    "SELECT id, name, length_mm, height_mm, planned_lux FROM walls ORDER BY position",
  );
  return rows.map((r) => ({ id: r.id, name: r.name, lengthMm: r.length_mm, heightMm: r.height_mm, plannedLux: r.planned_lux }));
}

export async function wallById(db: Db, id: string, lock = false): Promise<Wall | null> {
  const { rows } = await db.query(
    `SELECT id, name, length_mm, height_mm, planned_lux FROM walls WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, name: r.name, lengthMm: r.length_mm, heightMm: r.height_mm, plannedLux: r.planned_lux } : null;
}

interface Photo {
  id: string;
  objectId: string;
  key: string;
  bytes: number;
  sha256: string;
  contentType: string;
  attachedAt: string;
}

/** A photos row, typed by the schema's columns. */
export interface PhotoRow {
  id: string;
  object_id: string;
  key: string;
  bytes: number;
  sha256: string;
  content_type: string;
  attached_at: Date;
}

export function toPhoto(r: PhotoRow): Photo {
  return {
    id: r.id,
    objectId: r.object_id,
    key: r.key,
    bytes: r.bytes,
    sha256: r.sha256,
    contentType: r.content_type,
    attachedAt: r.attached_at.toISOString(),
  };
}

interface ObjectRecord {
  id: string;
  objectNumber: string;
  title: string;
  medium: string;
  lenderId: string | null;
  lenderName: string | null;
  widthMm: number;
  heightMm: number;
  luxLimit: number;
  luxHourBudget: number;
  insuranceValueGbp: number;
  registrarNote: string;
  conditionRecorded: boolean;
  photos: Photo[];
  placementId: string | null;
  placementStatus: PlacementStatus | null;
}

export const OBJECT_SELECT = `
SELECT o.id, o.object_number, o.title, o.medium, o.lender_id, l.name AS lender_name, o.width_mm, o.height_mm,
  o.lux_limit, o.lux_hour_budget, o.insurance_value_gbp, o.registrar_note, p.id AS placement_id, p.status AS placement_status
FROM objects o LEFT JOIN lenders l ON l.id = o.lender_id
LEFT JOIN placements p ON p.object_id = o.id AND p.status <> 'removed'`;

/** An objects row joined with its lender and live placement (OBJECT_SELECT), typed by the schema. */
export interface ObjectRow {
  id: string;
  object_number: string;
  title: string;
  medium: string;
  lender_id: string | null;
  lender_name: string | null;
  width_mm: number;
  height_mm: number;
  lux_limit: number;
  lux_hour_budget: string;
  insurance_value_gbp: string;
  registrar_note: string;
  placement_id: string | null;
  placement_status: PlacementStatus | null;
}

export async function objectsFrom(db: Db, rows: ObjectRow[]): Promise<ObjectRecord[]> {
  const ids = rows.map((r) => r.id);
  const photos = ids.length
    ? (await db.query<PhotoRow>("SELECT * FROM photos WHERE object_id = ANY($1) ORDER BY attached_at, id", [ids])).rows.map(toPhoto)
    : [];
  return rows.map((r) => {
    const own = photos.filter((p) => p.objectId === r.id);
    return {
      id: r.id,
      objectNumber: r.object_number,
      title: r.title,
      medium: r.medium,
      lenderId: r.lender_id,
      lenderName: r.lender_name,
      widthMm: r.width_mm,
      heightMm: r.height_mm,
      luxLimit: r.lux_limit,
      luxHourBudget: Number(r.lux_hour_budget),
      insuranceValueGbp: Number(r.insurance_value_gbp),
      registrarNote: r.registrar_note,
      conditionRecorded: own.length > 0,
      photos: own,
      placementId: r.placement_id,
      placementStatus: r.placement_status,
    };
  });
}

export async function objectById(db: Db, id: string, lock = false): Promise<ObjectRecord> {
  if (lock) await db.query("SELECT 1 FROM objects WHERE id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query<ObjectRow>(`${OBJECT_SELECT} WHERE o.id = $1`, [id]);
  if (!rows[0]) throw notFound();
  const [record] = await objectsFrom(db, rows);
  return record;
}
