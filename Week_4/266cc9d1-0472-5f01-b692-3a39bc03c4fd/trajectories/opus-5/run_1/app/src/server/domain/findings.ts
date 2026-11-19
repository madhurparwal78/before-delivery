/**
 * Findings: validation, geometry derivation, label assignment and terrain
 * re-resolution. Positions are held as unrounded float64 ECEF metres.
 */

import { LIMITS } from "../config.js";
import { query, queryOne, withTransaction, type Tx } from "../db.js";
import { FIELD_MESSAGES, conflict, notFound, validationFailed, type FieldErrors } from "../errors.js";
import { newId } from "../ids.js";
import {
  deriveClearance,
  positionFromChainage,
  projectOntoCentreline,
  type CorridorGeometry,
} from "../../shared/corridor.js";
import { toEcef } from "../../shared/geodesy.js";
import { findingLabel, spanLabel } from "../../shared/format.js";

export interface FindingRow {
  id: string;
  set_id: string;
  label_n: number;
  chainage_m: number;
  offset_m: number;
  lon_deg: number;
  lat_deg: number;
  ecef_x: number;
  ecef_y: number;
  ecef_z: number;
  ground_height_m: number;
  terrain_level: number | null;
  canopy_height_m: number;
  canopy_top_height_m: number;
  canopy_radius_m: number;
  span_from: number;
  span_to: number;
  clearance_m: number;
  status: "violation" | "clear";
  comment: string;
  updated_at: Date;
}

export interface FindingPayload {
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

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function findingPayload(row: FindingRow): FindingPayload {
  return {
    id: row.id,
    set_id: row.set_id,
    label: findingLabel(row.label_n),
    chainage_m: round(row.chainage_m, 1),
    offset_m: round(row.offset_m, 2),
    lon_deg: round(row.lon_deg, 7),
    lat_deg: round(row.lat_deg, 7),
    ecef_m: [row.ecef_x, row.ecef_y, row.ecef_z],
    ground_height_m: round(row.ground_height_m, 2),
    terrain_level: row.terrain_level,
    canopy_height_m: round(row.canopy_height_m, 2),
    canopy_top_height_m: round(row.canopy_top_height_m, 2),
    canopy_radius_m: round(row.canopy_radius_m, 2),
    span: {
      from_tower: row.span_from,
      to_tower: row.span_to,
      label: spanLabel(row.span_from, row.span_to),
    },
    clearance_m: round(row.clearance_m, 2),
    status: row.status,
    comment: row.comment,
    updated_at: row.updated_at.toISOString(),
  };
}

interface LocationInput {
  chainageM: number;
  offsetM: number;
  lonDeg: number;
  latDeg: number;
  groundHeightM: number;
  terrainLevel: number | null;
}

export interface FindingInput {
  location: LocationInput | null;
  canopyHeightM?: number;
  canopyRadiusM?: number;
  comment?: string;
}

function asRecord(body: unknown): Record<string, unknown> {
  return (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateLocation(
  record: Record<string, unknown>,
  corridor: CorridorGeometry,
  fields: FieldErrors,
): LocationInput | null {
  const hasChainage = record.chainage_m !== undefined || record.offset_m !== undefined;
  const hasLonLat = record.lon_deg !== undefined || record.lat_deg !== undefined;

  if (hasChainage === hasLonLat) {
    fields.position = FIELD_MESSAGES.position;
    return null;
  }

  let chainageM: number | null = null;
  let offsetM: number | null = null;

  if (hasChainage) {
    chainageM = finiteNumber(record.chainage_m);
    offsetM = finiteNumber(record.offset_m);
    if (chainageM === null || offsetM === null) {
      fields.position = FIELD_MESSAGES.position;
      return null;
    }
    if (chainageM < 0 || chainageM > corridor.lengthM) {
      fields.chainage_m = FIELD_MESSAGES.chainage(corridor.lengthM);
    }
    if (offsetM < -60 || offsetM > 60) fields.offset_m = FIELD_MESSAGES.offset;
  } else {
    const lonDeg = finiteNumber(record.lon_deg);
    const latDeg = finiteNumber(record.lat_deg);
    if (lonDeg === null || latDeg === null) {
      fields.position = FIELD_MESSAGES.position;
      return null;
    }
    const projection = projectOntoCentreline(corridor, lonDeg, latDeg);
    chainageM = projection.chainageM;
    offsetM = projection.offsetM;
    if (chainageM < 0 || chainageM > corridor.lengthM) {
      fields.chainage_m = FIELD_MESSAGES.chainage(corridor.lengthM);
    } else if (offsetM < -60 || offsetM > 60) {
      fields.offset_m = FIELD_MESSAGES.offset;
    }
  }

  const groundHeightM = finiteNumber(record.ground_height_m);
  if (groundHeightM === null || groundHeightM < -500 || groundHeightM > 9000) {
    fields.ground_height_m = FIELD_MESSAGES.groundHeight;
  }

  const rawLevel = record.terrain_level;
  let terrainLevel: number | null = null;
  if (rawLevel === null || rawLevel === undefined) {
    terrainLevel = null;
  } else if (typeof rawLevel === "number" && Number.isInteger(rawLevel) && rawLevel >= 0 && rawLevel <= 24) {
    terrainLevel = rawLevel;
  } else {
    fields.terrain_level = FIELD_MESSAGES.terrainLevel;
  }

  if (Object.keys(fields).length > 0) return null;

  const point = hasChainage
    ? positionFromChainage(corridor, chainageM!, offsetM!)
    : { lonDeg: finiteNumber(record.lon_deg)!, latDeg: finiteNumber(record.lat_deg)! };

  return {
    chainageM: chainageM!,
    offsetM: offsetM!,
    lonDeg: point.lonDeg,
    latDeg: point.latDeg,
    groundHeightM: groundHeightM!,
    terrainLevel,
  };
}

/** Validates a create body, where the location is required. */
export function validateCreate(body: unknown, corridor: CorridorGeometry): FindingInput {
  const record = asRecord(body);
  const fields: FieldErrors = {};
  const location = validateLocation(record, corridor, fields);

  const canopyHeightM = finiteNumber(record.canopy_height_m);
  if (canopyHeightM === null || canopyHeightM < 0.5 || canopyHeightM > 80) {
    fields.canopy_height_m = FIELD_MESSAGES.canopyHeight;
  }

  const canopyRadiusM = record.canopy_radius_m === undefined ? 3.0 : finiteNumber(record.canopy_radius_m);
  if (canopyRadiusM === null || canopyRadiusM < 0.5 || canopyRadiusM > 20) {
    fields.canopy_radius_m = FIELD_MESSAGES.canopyRadius;
  }

  const comment = record.comment === undefined ? "" : record.comment;
  if (typeof comment !== "string" || comment.length > LIMITS.maxCommentChars) {
    fields.comment = FIELD_MESSAGES.comment;
  }

  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return {
    location,
    canopyHeightM: canopyHeightM!,
    canopyRadiusM: canopyRadiusM!,
    comment: comment as string,
  };
}

/** Validates a patch body, where a location change must arrive complete. */
export function validatePatch(body: unknown, corridor: CorridorGeometry): FindingInput {
  const record = asRecord(body);
  const fields: FieldErrors = {};
  const locationKeys = [
    "chainage_m",
    "offset_m",
    "lon_deg",
    "lat_deg",
    "ground_height_m",
    "terrain_level",
  ];
  const touchesLocation = locationKeys.some((key) => record[key] !== undefined);
  const location = touchesLocation ? validateLocation(record, corridor, fields) : null;

  let canopyHeightM: number | undefined;
  if (record.canopy_height_m !== undefined) {
    const value = finiteNumber(record.canopy_height_m);
    if (value === null || value < 0.5 || value > 80) {
      fields.canopy_height_m = FIELD_MESSAGES.canopyHeight;
    } else {
      canopyHeightM = value;
    }
  }

  let canopyRadiusM: number | undefined;
  if (record.canopy_radius_m !== undefined) {
    const value = finiteNumber(record.canopy_radius_m);
    if (value === null || value < 0.5 || value > 20) {
      fields.canopy_radius_m = FIELD_MESSAGES.canopyRadius;
    } else {
      canopyRadiusM = value;
    }
  }

  let comment: string | undefined;
  if (record.comment !== undefined) {
    if (typeof record.comment !== "string" || record.comment.length > LIMITS.maxCommentChars) {
      fields.comment = FIELD_MESSAGES.comment;
    } else {
      comment = record.comment;
    }
  }

  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return { location, canopyHeightM, canopyRadiusM, comment };
}

interface DerivedGeometry {
  lonDeg: number;
  latDeg: number;
  ecef: { x: number; y: number; z: number };
  canopyTopHeightM: number;
  clearanceM: number;
  status: "violation" | "clear";
  spanFrom: number;
  spanTo: number;
}

function derive(
  corridor: CorridorGeometry,
  values: {
    chainageM: number;
    lonDeg: number;
    latDeg: number;
    groundHeightM: number;
    canopyHeightM: number;
  },
): DerivedGeometry {
  const clearance = deriveClearance(corridor, values);
  return {
    lonDeg: values.lonDeg,
    latDeg: values.latDeg,
    ecef: toEcef(values.lonDeg, values.latDeg, values.groundHeightM),
    canopyTopHeightM: clearance.canopyTopHeightM,
    clearanceM: clearance.clearanceM,
    status: clearance.status,
    spanFrom: clearance.span.fromTower,
    spanTo: clearance.span.toTower,
  };
}

const SELECT_FINDING = "SELECT * FROM findings WHERE id = $1";

export async function findFinding(findingId: string): Promise<FindingRow | null> {
  return queryOne<FindingRow>(SELECT_FINDING, [findingId]);
}

export async function listFindings(setId: string): Promise<FindingRow[]> {
  return query<FindingRow>(
    "SELECT * FROM findings WHERE set_id = $1 ORDER BY chainage_m, label_n",
    [setId],
  );
}

async function requireDraft(tx: Tx, setId: string): Promise<void> {
  const set = await tx.queryOne<{ state: string }>(
    "SELECT state FROM findings_sets WHERE id = $1 FOR UPDATE",
    [setId],
  );
  if (!set) throw notFound();
  if (set.state !== "draft") {
    throw conflict("set_not_draft", "This findings set is no longer a draft.");
  }
}

export async function createFinding(
  setId: string,
  corridor: CorridorGeometry,
  input: FindingInput,
  findingId = newId("fnd"),
): Promise<FindingRow> {
  const location = input.location!;
  const geometry = derive(corridor, {
    chainageM: location.chainageM,
    lonDeg: location.lonDeg,
    latDeg: location.latDeg,
    groundHeightM: location.groundHeightM,
    canopyHeightM: input.canopyHeightM!,
  });

  return withTransaction(async (tx) => {
    await requireDraft(tx, setId);
    const sequence = await tx.queryOne<{ label_seq: number }>(
      "UPDATE findings_sets SET label_seq = label_seq + 1 WHERE id = $1 RETURNING label_seq",
      [setId],
    );
    const row = await tx.queryOne<FindingRow>(
      `INSERT INTO findings (
         id, set_id, label_n, chainage_m, offset_m, lon_deg, lat_deg,
         ecef_x, ecef_y, ecef_z, ground_height_m, terrain_level,
         canopy_height_m, canopy_top_height_m, canopy_radius_m,
         span_from, span_to, clearance_m, status, comment, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())
       RETURNING *`,
      [
        findingId,
        setId,
        sequence!.label_seq,
        location.chainageM,
        location.offsetM,
        geometry.lonDeg,
        geometry.latDeg,
        geometry.ecef.x,
        geometry.ecef.y,
        geometry.ecef.z,
        location.groundHeightM,
        location.terrainLevel,
        input.canopyHeightM!,
        geometry.canopyTopHeightM,
        input.canopyRadiusM!,
        geometry.spanFrom,
        geometry.spanTo,
        geometry.clearanceM,
        geometry.status,
        input.comment ?? "",
      ],
    );
    return row!;
  });
}

export async function patchFinding(
  finding: FindingRow,
  corridor: CorridorGeometry,
  input: FindingInput,
): Promise<FindingRow> {
  return withTransaction(async (tx) => {
    await requireDraft(tx, finding.set_id);
    const current = await tx.queryOne<FindingRow>(`${SELECT_FINDING} FOR UPDATE`, [finding.id]);
    if (!current) throw notFound();

    const chainageM = input.location ? input.location.chainageM : current.chainage_m;
    const offsetM = input.location ? input.location.offsetM : current.offset_m;
    const lonDeg = input.location ? input.location.lonDeg : current.lon_deg;
    const latDeg = input.location ? input.location.latDeg : current.lat_deg;
    const groundHeightM = input.location ? input.location.groundHeightM : current.ground_height_m;
    const terrainLevel = input.location ? input.location.terrainLevel : current.terrain_level;
    const canopyHeightM = input.canopyHeightM ?? current.canopy_height_m;
    const canopyRadiusM = input.canopyRadiusM ?? current.canopy_radius_m;
    const comment = input.comment ?? current.comment;

    const geometry = derive(corridor, {
      chainageM,
      lonDeg,
      latDeg,
      groundHeightM,
      canopyHeightM,
    });

    const row = await tx.queryOne<FindingRow>(
      `UPDATE findings SET
         chainage_m = $2, offset_m = $3, lon_deg = $4, lat_deg = $5,
         ecef_x = $6, ecef_y = $7, ecef_z = $8,
         ground_height_m = $9, terrain_level = $10,
         canopy_height_m = $11, canopy_top_height_m = $12, canopy_radius_m = $13,
         span_from = $14, span_to = $15, clearance_m = $16, status = $17,
         comment = $18, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        finding.id,
        chainageM,
        offsetM,
        geometry.lonDeg,
        geometry.latDeg,
        geometry.ecef.x,
        geometry.ecef.y,
        geometry.ecef.z,
        groundHeightM,
        terrainLevel,
        canopyHeightM,
        geometry.canopyTopHeightM,
        canopyRadiusM,
        geometry.spanFrom,
        geometry.spanTo,
        geometry.clearanceM,
        geometry.status,
        comment,
      ],
    );
    return row!;
  });
}

export async function deleteFinding(finding: FindingRow): Promise<void> {
  await withTransaction(async (tx) => {
    await requireDraft(tx, finding.set_id);
    await tx.query("DELETE FROM decisions WHERE finding_id = $1", [finding.id]);
    await tx.query("DELETE FROM findings WHERE id = $1", [finding.id]);
  });
}

export interface TerrainInput {
  groundHeightM: number;
  terrainLevel: number;
}

export function validateTerrain(body: unknown): TerrainInput {
  const record = asRecord(body);
  const fields: FieldErrors = {};
  const groundHeightM = finiteNumber(record.ground_height_m);
  if (groundHeightM === null || groundHeightM < -500 || groundHeightM > 9000) {
    fields.ground_height_m = FIELD_MESSAGES.groundHeight;
  }
  const terrainLevel = record.terrain_level;
  if (
    typeof terrainLevel !== "number" ||
    !Number.isInteger(terrainLevel) ||
    terrainLevel < 0 ||
    terrainLevel > 24
  ) {
    fields.terrain_level = FIELD_MESSAGES.terrainLevel;
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return { groundHeightM: groundHeightM!, terrainLevel: terrainLevel as number };
}

export interface TerrainResult {
  finding: FindingRow;
  previous: { ground_height_m: number; terrain_level: number | null; clearance_m: number };
}

/**
 * Accepted only when the level is strictly greater than the one stored at the
 * moment it commits, so the stored level only ever increases.
 */
export async function reResolveTerrain(
  finding: FindingRow,
  corridor: CorridorGeometry,
  input: TerrainInput,
): Promise<TerrainResult> {
  return withTransaction(async (tx) => {
    await requireDraft(tx, finding.set_id);
    const current = await tx.queryOne<FindingRow>(`${SELECT_FINDING} FOR UPDATE`, [finding.id]);
    if (!current) throw notFound();
    if (current.terrain_level !== null && input.terrainLevel <= current.terrain_level) {
      throw conflict(
        "coarser_terrain",
        "That terrain level is not finer than the level already stored.",
      );
    }

    const geometry = derive(corridor, {
      chainageM: current.chainage_m,
      lonDeg: current.lon_deg,
      latDeg: current.lat_deg,
      groundHeightM: input.groundHeightM,
      canopyHeightM: current.canopy_height_m,
    });
    const row = await tx.queryOne<FindingRow>(
      `UPDATE findings SET
         ground_height_m = $2, terrain_level = $3,
         ecef_x = $4, ecef_y = $5, ecef_z = $6,
         canopy_top_height_m = $7, clearance_m = $8, status = $9, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        finding.id,
        input.groundHeightM,
        input.terrainLevel,
        geometry.ecef.x,
        geometry.ecef.y,
        geometry.ecef.z,
        geometry.canopyTopHeightM,
        geometry.clearanceM,
        geometry.status,
      ],
    );
    return {
      finding: row!,
      previous: {
        ground_height_m: round(current.ground_height_m, 2),
        terrain_level: current.terrain_level,
        clearance_m: round(current.clearance_m, 2),
      },
    };
  });
}
