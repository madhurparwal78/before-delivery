// Mission, pass, sample, event, landmark and reference data access. Shapes
// are built here and shared by author and share routes.

import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { epochMsToIso, formatMetLabel, type DistanceUnit, type SpeedUnit } from "../shared/format.js";

export interface MissionRow {
  id: string;
  name: string;
  epoch_utc: string;
  epoch_ms: number;
  distance_unit: DistanceUnit;
  speed_unit: SpeedUnit;
  reference_target: string | null;
  reference_state: string | null;
  reference_etag: string | null;
  reference_fetched_at: string | null;
  reference_vector_count: number | null;
  change_version: number;
  created_at: string;
}

export interface PassRow {
  id: string;
  mission_id: string;
  filename: string;
  state: "uploading" | "stored" | "parsed" | "rejected";
  size_bytes: number;
  sha256: string;
  sample_count: number;
  transcript_line_count: number;
  rejected_line: number | null;
  rejected_reason: string | null;
  upload_order: number;
  created_at: string;
}

export interface LandmarkRow {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  created_at: string;
}

export interface SubscriberRow {
  id: string;
  url: string;
  created_at: string;
}

export interface SampleRow {
  index: number;
  pass_id: string;
  met: number;
  met_label: string;
  utc: string;
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
  residual_m: number | null;
}

export interface LineRow {
  id: string;
  pass_id: string;
  met: number;
  met_label: string;
  speaker: string;
  text: string;
}

export interface EventRow {
  id: string;
  pass_id: string;
  met: number;
  met_label: string;
  title: string;
  note: string;
  sample_met: number;
}

export interface Perilune {
  met: number;
  met_label: string;
  altitude_m: number;
  lat_deg: number;
  lon_deg: number;
  residual_m: number | null;
}

export interface ReferenceInfo {
  target: string;
  state: "fetching" | "ready" | "unavailable";
  fetched_at: string | null;
  vector_count: number;
}

export interface ShareLinkInfo {
  token: string;
  created_at: string;
  expires_utc: string;
}

export interface MissionApiShape {
  id: string;
  name: string;
  epoch_utc: string;
  distance_unit: DistanceUnit;
  speed_unit: SpeedUnit;
  sample_count: number;
  total_bytes: number;
  perilune: Perilune | null;
  passes: Array<PassApiShape>;
  landmarks: Array<LandmarkApiShape>;
  reference: ReferenceInfo | null;
  share: ShareLinkInfo | null;
  change_version: number;
  created_at: string;
}

export interface PassApiShape {
  id: string;
  mission_id: string;
  filename: string;
  state: PassRow["state"];
  size_bytes: number;
  sha256: string;
  sample_count: number;
  transcript_line_count: number;
  rejected_line: number | null;
  rejected_reason: string | null;
  created_at: string;
}

export interface LandmarkApiShape {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  created_at: string;
}

export function passApiShape(row: PassRow): PassApiShape {
  return {
    id: row.id,
    mission_id: row.mission_id,
    filename: row.filename,
    state: row.state,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    sample_count: row.sample_count,
    transcript_line_count: row.transcript_line_count,
    rejected_line: row.rejected_line,
    rejected_reason: row.rejected_reason,
    created_at: row.created_at,
  };
}

export function landmarkApiShape(row: {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  created_at: string;
}): LandmarkApiShape {
  return {
    id: row.id,
    name: row.name,
    lat_deg: row.lat_deg,
    lon_deg: row.lon_deg,
    created_at: row.created_at,
  };
}

export async function loadMission(client: PoolClient | import("pg").PoolClient, id: string): Promise<MissionRow | null> {
  const result = await client.query(
    `SELECT id, name, epoch_utc, epoch_ms, distance_unit, speed_unit,
            reference_target, reference_state, reference_etag, reference_fetched_at,
            reference_vector_count, change_version, created_at
     FROM missions WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    epoch_utc: row.epoch_utc,
    epoch_ms: Number(row.epoch_ms),
    distance_unit: row.distance_unit,
    speed_unit: row.speed_unit,
    reference_target: row.reference_target,
    reference_state: row.reference_state,
    reference_etag: row.reference_etag,
    reference_fetched_at: row.reference_fetched_at,
    reference_vector_count: row.reference_vector_count === null ? null : Number(row.reference_vector_count),
    change_version: Number(row.change_version),
    created_at: row.created_at,
  };
}

export async function listPasses(
  client: PoolClient,
  missionId: string,
  includeDeleted: boolean,
): Promise<PassRow[]> {
  const result = await client.query(
    `SELECT id, mission_id, filename, state, size_bytes, sha256, sample_count,
            transcript_line_count, rejected_line, rejected_reason, upload_order, created_at
     FROM passes WHERE mission_id = $1 ${includeDeleted ? "" : "AND deleted = FALSE"}
     ORDER BY upload_order`,
    [missionId],
  );
  return result.rows.map(mapPassRow);
}

function mapPassRow(row: Record<string, unknown>): PassRow {
  return {
    id: row.id as string,
    mission_id: row.mission_id as string,
    filename: row.filename as string,
    state: row.state as PassRow["state"],
    size_bytes: Number(row.size_bytes),
    sha256: row.sha256 as string,
    sample_count: Number(row.sample_count),
    transcript_line_count: Number(row.transcript_line_count),
    rejected_line: row.rejected_line === null ? null : Number(row.rejected_line),
    rejected_reason: row.rejected_reason as string | null,
    upload_order: Number(row.upload_order),
    created_at: row.created_at as string,
  };
}

export async function loadPass(client: PoolClient, passId: string): Promise<PassRow | null> {
  const result = await client.query(
    `SELECT id, mission_id, filename, state, size_bytes, sha256, sample_count,
            transcript_line_count, rejected_line, rejected_reason, upload_order, created_at, deleted
     FROM passes WHERE id = $1`,
    [passId],
  );
  if (result.rows.length === 0) return null;
  if (result.rows[0].deleted) return null;
  return mapPassRow(result.rows[0]);
}

export interface TrackSample {
  pass_id: string;
  met: number;
  utc_ms: number;
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
  residual_m: number | null;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export async function loadTrack(
  client: PoolClient,
  missionId: string,
): Promise<TrackSample[]> {
  const result = await client.query(
    `SELECT s.pass_id, s.met, s.utc_ms, s.lat_deg, s.lon_deg, s.altitude_m, s.speed_m_s,
            s.residual_m, s.x, s.y, s.z, s.vx, s.vy, s.vz, p.upload_order, s.seq
     FROM samples s JOIN passes p ON p.id = s.pass_id
     WHERE s.mission_id = $1 AND p.deleted = FALSE
     ORDER BY s.met, p.upload_order, s.seq`,
    [missionId],
  );
  return result.rows.map((row) => ({
    pass_id: row.pass_id,
    met: Number(row.met),
    utc_ms: Number(row.utc_ms),
    lat_deg: row.lat_deg,
    lon_deg: row.lon_deg,
    altitude_m: row.altitude_m,
    speed_m_s: row.speed_m_s,
    residual_m: row.residual_m === null ? null : row.residual_m,
    x: row.x,
    y: row.y,
    z: row.z,
    vx: row.vx,
    vy: row.vy,
    vz: row.vz,
  }));
}

export function sampleApiShape(
  sample: TrackSample,
  index: number,
): SampleRow {
  return {
    index,
    pass_id: sample.pass_id,
    met: sample.met,
    met_label: formatMetLabel(sample.met),
    utc: epochMsToIso(sample.utc_ms),
    lat_deg: sample.lat_deg,
    lon_deg: sample.lon_deg,
    altitude_m: sample.altitude_m,
    speed_m_s: sample.speed_m_s,
    residual_m: sample.residual_m,
  };
}

export async function loadLines(
  client: PoolClient,
  missionId: string,
): Promise<Array<LineRow & { utc_ms: number; seq: number; order: number }>> {
  const result = await client.query(
    `SELECT l.id, l.pass_id, l.utc_ms, l.met, l.speaker, l.text, l.seq, p.upload_order
     FROM transcript_lines l JOIN passes p ON p.id = l.pass_id
     WHERE l.mission_id = $1 AND p.deleted = FALSE
     ORDER BY l.met, p.upload_order, l.seq`,
    [missionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    pass_id: row.pass_id,
    utc_ms: Number(row.utc_ms),
    met: Number(row.met),
    met_label: formatMetLabel(Number(row.met)),
    speaker: row.speaker,
    text: row.text,
    seq: Number(row.seq),
    order: Number(row.upload_order),
  }));
}

export async function loadEvents(
  client: PoolClient,
  missionId: string,
): Promise<Array<EventRow & { created_at: string; order: number }>> {
  const result = await client.query(
    `SELECT e.id, e.pass_id, e.met, e.title, e.note, e.sample_met, e.created_at, p.upload_order
     FROM events e JOIN passes p ON p.id = e.pass_id
     WHERE e.mission_id = $1 AND p.deleted = FALSE
     ORDER BY e.met, e.created_at, p.upload_order`,
    [missionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    pass_id: row.pass_id,
    met: Number(row.met),
    met_label: formatMetLabel(Number(row.met)),
    title: row.title,
    note: row.note,
    sample_met: Number(row.sample_met),
    created_at: row.created_at,
    order: Number(row.upload_order),
  }));
}

export async function loadLandmarks(
  client: PoolClient,
  missionId: string,
): Promise<LandmarkRow[]> {
  const result = await client.query(
    "SELECT id, name, lat_deg, lon_deg, created_at FROM landmarks WHERE mission_id = $1 ORDER BY order_n",
    [missionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat_deg: row.lat_deg,
    lon_deg: row.lon_deg,
    created_at: row.created_at,
  }));
}

export async function loadSubscribers(
  client: PoolClient,
  missionId: string,
): Promise<SubscriberRow[]> {
  const result = await client.query(
    "SELECT id, url, created_at FROM subscribers WHERE mission_id = $1 ORDER BY order_n",
    [missionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    created_at: row.created_at,
  }));
}

export async function computePerilune(
  client: PoolClient,
  missionId: string,
): Promise<Perilune | null> {
  const result = await client.query(
    `SELECT s.met, s.altitude_m, s.lat_deg, s.lon_deg, s.residual_m, s.pass_id, s.seq, p.upload_order
     FROM samples s JOIN passes p ON p.id = s.pass_id
     WHERE s.mission_id = $1 AND p.deleted = FALSE AND s.pass_id IN (SELECT id FROM passes WHERE state = 'parsed' AND deleted = FALSE)
     ORDER BY s.altitude_m, s.met, p.upload_order, s.seq
     LIMIT 1`,
    [missionId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    met: Number(row.met),
    met_label: formatMetLabel(Number(row.met)),
    altitude_m: row.altitude_m,
    lat_deg: row.lat_deg,
    lon_deg: row.lon_deg,
    residual_m: row.residual_m === null ? null : row.residual_m,
  };
}

export async function activeShareLink(
  client: PoolClient,
  missionId: string,
  nowMs: number,
): Promise<ShareLinkInfo | null> {
  const result = await client.query(
    `SELECT token, created_at, expires_utc FROM share_links
     WHERE mission_id = $1 AND revoked = FALSE AND expires_utc > $2
     ORDER BY created_at DESC LIMIT 1`,
    [missionId, epochMsToIso(nowMs)],
  );
  if (result.rows.length === 0) return null;
  return {
    token: result.rows[0].token,
    created_at: result.rows[0].created_at,
    expires_utc: result.rows[0].expires_utc,
  };
}

export async function missionSampleCount(client: PoolClient, missionId: string): Promise<number> {
  const result = await client.query(
    `SELECT COUNT(*)::int AS n FROM samples s JOIN passes p ON p.id = s.pass_id
     WHERE s.mission_id = $1 AND p.deleted = FALSE`,
    [missionId],
  );
  return result.rows[0].n;
}

export async function missionTotalBytes(client: PoolClient, missionId: string): Promise<number> {
  const result = await client.query(
    "SELECT COALESCE(SUM(size_bytes), 0) AS n FROM passes WHERE mission_id = $1 AND deleted = FALSE",
    [missionId],
  );
  return Number(result.rows[0].n);
}

export async function usedBytesAll(client: PoolClient): Promise<number> {
  const result = await client.query(
    "SELECT COALESCE(SUM(size_bytes), 0) AS n FROM passes WHERE deleted = FALSE",
  );
  return Number(result.rows[0].n);
}

export async function nextOrder(
  client: PoolClient,
  table: "passes" | "landmarks" | "subscribers",
  missionId: string,
): Promise<number> {
  const column = table === "passes" ? "upload_order" : "order_n";
  const result = await client.query(
    `SELECT COALESCE(MAX(${column}), 0) AS n FROM ${table} WHERE mission_id = $1`,
    [missionId],
  );
  return Number(result.rows[0].n) + 1;
}

export function referenceApiShape(mission: MissionRow): ReferenceInfo | null {
  if (!mission.reference_target) return null;
  return {
    target: mission.reference_target,
    state: (mission.reference_state ?? "fetching") as ReferenceInfo["state"],
    fetched_at: mission.reference_fetched_at,
    vector_count: mission.reference_vector_count ?? 0,
  };
}

export async function missionApiShape(
  client: PoolClient,
  mission: MissionRow,
  nowMs: number,
): Promise<MissionApiShape> {
  const passes = await listPasses(client, mission.id, false);
  const landmarks = await loadLandmarks(client, mission.id);
  const perilune = await computePerilune(client, mission.id);
  const share = await activeShareLink(client, mission.id, nowMs);
  const sampleCount = await missionSampleCount(client, mission.id);
  const totalBytes = await missionTotalBytes(client, mission.id);
  return {
    id: mission.id,
    name: mission.name,
    epoch_utc: mission.epoch_utc,
    distance_unit: mission.distance_unit,
    speed_unit: mission.speed_unit,
    sample_count: sampleCount,
    total_bytes: totalBytes,
    perilune,
    passes: passes.map(passApiShape),
    landmarks: landmarks.map(landmarkApiShape),
    reference: referenceApiShape(mission),
    share,
    change_version: mission.change_version,
    created_at: mission.created_at,
  };
}

export function newId(): string {
  return randomUUID();
}
