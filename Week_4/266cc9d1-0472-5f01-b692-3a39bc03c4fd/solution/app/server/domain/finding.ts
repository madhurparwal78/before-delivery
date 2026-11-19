// Findings: input validation, the clearance and status derivation, label assignment and the
// terrain-level ordering.
import { firstRow, type Db } from "../db.js";
import { findingLabel } from "../../shared/text.js";
import { attachmentPoint, chainageMessage, spanOf, type CorridorRecord } from "./corridor.js";
import { distanceToSegment, pointAt, project, toEcef } from "../../shared/geodesy.js";

export interface FindingRow {
  id: string;
  set_id: string;
  label_number: number;
  chainage_m: number;
  offset_m: number;
  lon_deg: number;
  lat_deg: number;
  ground_height_m: number;
  terrain_level: number | null;
  canopy_height_m: number;
  canopy_radius_m: number;
  comment: string;
  updated_at: Date;
}

export const FINDING_COLUMNS = `id, set_id, label_number, chainage_m, offset_m, lon_deg, lat_deg, ground_height_m,
  terrain_level, canopy_height_m, canopy_radius_m, comment, updated_at`;

export const MESSAGES = {
  position: "Give either chainage and offset or longitude and latitude.",
  offset: "Offset must be between -60 and 60 metres.",
  ground: "Ground height must be between -500 and 9,000 metres.",
  level: "Terrain level must be a whole number from 0 to 24, or empty.",
  canopy: "Canopy height must be between 0.5 and 80 metres.",
  radius: "Canopy radius must be between 0.5 and 20 metres.",
  comment: "Comment must be 2,000 characters or fewer.",
  decision: "Choose accept or dispute.",
  disputeNote: "Add a note explaining the dispute.",
} as const;

export const COMMENT_MAX = 2000;

interface Location {
  chainageM: number;
  offsetM: number;
  lonDeg: number;
  latDeg: number;
  groundHeightM: number;
  terrainLevel: number | null;
}

interface NewFinding {
  location: Location;
  canopyHeightM: number;
  canopyRadiusM: number;
  comment: string;
}

interface FindingEdit {
  location: Location | null;
  canopyHeightM: number | null;
  canopyRadiusM: number | null;
  comment: string | null;
}

type Fields = Record<string, string>;

function numberIn(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** A ground height within -500 to 9,000 metres, or null. */
export function readGroundHeight(value: unknown): number | null {
  return numberIn(value, -500, 9000);
}

/** A terrain level is a whole number from 0 to 24; null means hand-entered. */
export function terrainLevelOf(value: unknown): { ok: true; level: number | null } | { ok: false } {
  if (value === null) return { ok: true, level: null };
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24) return { ok: true, level: value };
  return { ok: false };
}

function readLocation(json: Record<string, unknown>, corridor: CorridorRecord, fields: Fields): Location | null {
  const chainageForm = "chainage_m" in json || "offset_m" in json;
  const lonLatForm = "lon_deg" in json || "lat_deg" in json;
  const complete = chainageForm
    ? "chainage_m" in json && "offset_m" in json
    : "lon_deg" in json && "lat_deg" in json;
  let placed: { chainageM: number; offsetM: number; lonDeg: number; latDeg: number } | null = null;

  if (chainageForm === lonLatForm || !complete) {
    fields.position = MESSAGES.position;
  } else if (chainageForm) {
    const chainage = numberIn(json.chainage_m, 0, corridor.lengthM);
    const offset = numberIn(json.offset_m, -60, 60);
    if (chainage === null) fields.chainage_m = chainageMessage(corridor);
    if (offset === null) fields.offset_m = MESSAGES.offset;
    if (chainage !== null && offset !== null) {
      const point = pointAt(corridor.line, chainage, offset);
      placed = { chainageM: chainage, offsetM: offset, lonDeg: point.lonDeg, latDeg: point.latDeg };
    }
  } else {
    const lon = numberIn(json.lon_deg, -180, 180);
    const lat = numberIn(json.lat_deg, -90, 90);
    if (lon === null || lat === null) {
      fields.position = MESSAGES.position;
    } else {
      const { chainageM, offsetM } = project(corridor.line, { lonDeg: lon, latDeg: lat });
      if (chainageM < 0 || chainageM > corridor.lengthM) fields.chainage_m = chainageMessage(corridor);
      else if (Math.abs(offsetM) > 60) fields.offset_m = MESSAGES.offset;
      else placed = { chainageM, offsetM, lonDeg: lon, latDeg: lat };
    }
  }

  const ground = readGroundHeight(json.ground_height_m);
  if (ground === null) fields.ground_height_m = MESSAGES.ground;
  const level = terrainLevelOf("terrain_level" in json ? json.terrain_level : null);
  if (!level.ok) fields.terrain_level = MESSAGES.level;
  if (placed === null || ground === null || !level.ok) return null;
  return { ...placed, groundHeightM: ground, terrainLevel: level.level };
}

function readComment(value: unknown, fields: Fields): string | null {
  if (typeof value === "string" && [...value].length <= COMMENT_MAX) return value;
  fields.comment = MESSAGES.comment;
  return null;
}

function readNumber(json: Record<string, unknown>, key: string, min: number, max: number, message: string, fields: Fields): number | null {
  const value = numberIn(json[key], min, max);
  if (value === null) fields[key] = message;
  return value;
}

const LOCATION_KEYS = ["chainage_m", "offset_m", "lon_deg", "lat_deg", "ground_height_m", "terrain_level"];

/** A new finding: a position, ground height and level, canopy height, and optional radius and comment. */
export function validateNewFinding(json: Record<string, unknown>, corridor: CorridorRecord): { input: NewFinding } | { fields: Fields } {
  const fields: Fields = {};
  const location = readLocation(json, corridor, fields);
  const canopyHeightM = readNumber(json, "canopy_height_m", 0.5, 80, MESSAGES.canopy, fields);
  const canopyRadiusM = "canopy_radius_m" in json ? readNumber(json, "canopy_radius_m", 0.5, 20, MESSAGES.radius, fields) : 3.0;
  const comment = "comment" in json ? readComment(json.comment, fields) : "";
  if (location === null || canopyHeightM === null || canopyRadiusM === null || comment === null) return { fields };
  return { input: { location, canopyHeightM, canopyRadiusM, comment } };
}

/** An edit: any of canopy height, radius and comment, or a whole new location. */
export function validateFindingEdit(json: Record<string, unknown>, corridor: CorridorRecord): { input: FindingEdit } | { fields: Fields } {
  const fields: Fields = {};
  const location = LOCATION_KEYS.some((k) => k in json) ? readLocation(json, corridor, fields) : null;
  const canopyHeightM = "canopy_height_m" in json ? readNumber(json, "canopy_height_m", 0.5, 80, MESSAGES.canopy, fields) : null;
  const canopyRadiusM = "canopy_radius_m" in json ? readNumber(json, "canopy_radius_m", 0.5, 20, MESSAGES.radius, fields) : null;
  const comment = "comment" in json ? readComment(json.comment, fields) : null;
  if (Object.keys(fields).length > 0) return { fields };
  return { input: { location, canopyHeightM, canopyRadiusM, comment } };
}

export interface Finding {
  id: string;
  set_id: string;
  label: string;
  chainage_m: number;
  offset_m: number;
  lon_deg: number;
  lat_deg: number;
  ecef_m: [number, number, number];
  ground_height_m: number;
  terrain_level: number | null;
  canopy_height_m: number;
  canopy_top_height_m: number;
  canopy_radius_m: number;
  span: { from_tower: number; to_tower: number; label: string };
  clearance_m: number;
  status: "violation" | "clear";
  comment: string;
  updated_at: string;
}

/** The finding as the API publishes it: ECEF, span, canopy top, clearance and status. */
export function deriveFinding(row: FindingRow, corridor: CorridorRecord): Finding {
  const span = spanOf(corridor, row.chainage_m);
  const canopyTop = row.ground_height_m + row.canopy_height_m;
  const clearance = distanceToSegment(
    toEcef(row.lon_deg, row.lat_deg, canopyTop),
    attachmentPoint(corridor, span.fromTower),
    attachmentPoint(corridor, span.toTower),
  );
  return {
    id: row.id,
    set_id: row.set_id,
    label: findingLabel(row.label_number),
    chainage_m: row.chainage_m,
    offset_m: row.offset_m,
    lon_deg: row.lon_deg,
    lat_deg: row.lat_deg,
    ecef_m: toEcef(row.lon_deg, row.lat_deg, row.ground_height_m),
    ground_height_m: row.ground_height_m,
    terrain_level: row.terrain_level,
    canopy_height_m: row.canopy_height_m,
    canopy_top_height_m: canopyTop,
    canopy_radius_m: row.canopy_radius_m,
    span: { from_tower: span.fromTower, to_tower: span.toTower, label: span.label },
    clearance_m: clearance,
    status: clearance < corridor.thresholdM ? "violation" : "clear",
    comment: row.comment,
    updated_at: row.updated_at.toISOString(),
  };
}

/** Findings in rail order: chainage, then label number. */
export async function findingsOf(db: Db, setId: string): Promise<FindingRow[]> {
  const found = await db.query<FindingRow>(
    `SELECT ${FINDING_COLUMNS} FROM findings WHERE set_id = $1 ORDER BY chainage_m, label_number`,
    [setId],
  );
  return found.rows;
}

/**
 * The next label number in a set: one more than the highest ever assigned. The set row's lock
 * serialises concurrent creates, and a rolled-back create returns its number with the transaction.
 */
export async function nextLabelNumber(db: Db, setId: string): Promise<number> {
  const found = await db.query<{ last_label_number: number }>(
    "UPDATE findings_sets SET last_label_number = last_label_number + 1 WHERE id = $1 RETURNING last_label_number",
    [setId],
  );
  return firstRow(found).last_label_number;
}
