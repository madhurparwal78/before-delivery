/** Reading missions, tracks, transcripts, events, landmarks and passes in their published shapes. */

import { isoInstant } from "../../shared/doy.js";
import { formatMetLabel } from "../../shared/met.js";
import { snapIndex } from "../../shared/frames.js";
import type {
  Landmark,
  Mission,
  MissionEvent,
  Pass,
  Perilune,
  Reference,
  Sample,
  ShareLink,
  Speaker,
  Subscriber,
  TranscriptLine,
} from "../../shared/model.js";
import type { FrameSample } from "../../shared/frames.js";
import type { DistanceUnit, SpeedUnit } from "../../shared/units.js";
import { pool, type Queryable } from "../db/pool.js";
import { shareUrlPath } from "./share.js";

export type MissionRow = {
  id: string;
  name: string;
  epoch_ms: number;
  distance_unit: DistanceUnit;
  speed_unit: SpeedUnit;
  reference_target: string | null;
  reference_state: "fetching" | "ready" | "unavailable" | null;
  reference_fetched_ms: number | null;
  reference_etag: string | null;
  reference_etag_url: string | null;
  change_version: number;
  created_ms: number;
};

const MISSION_COLUMNS = `id, name, epoch_ms, distance_unit, speed_unit, reference_target,
  reference_state, reference_fetched_ms, reference_etag, reference_etag_url, change_version, created_ms`;

export async function findMissionRow(
  query: Queryable,
  missionId: string,
): Promise<MissionRow | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(missionId)) {
    return null;
  }
  const result = await query.query<MissionRow>(
    `select ${MISSION_COLUMNS} from missions where id = $1`,
    [missionId],
  );
  return result.rows[0] ?? null;
}

export async function listMissionRows(query: Queryable): Promise<MissionRow[]> {
  const result = await query.query<MissionRow>(
    `select ${MISSION_COLUMNS} from missions order by seq`,
  );
  return result.rows;
}

export function metOf(row: MissionRow, utcMs: number): number {
  return Math.floor((utcMs - row.epoch_ms) / 1000);
}

type SampleRow = {
  pass_id: string;
  met: number;
  utc_ms: number;
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
  residual_m: number | null;
};

export async function loadTrack(query: Queryable, missionId: string): Promise<Sample[]> {
  const result = await query.query<SampleRow>(
    `select pass_id, met, utc_ms, lat_deg, lon_deg, altitude_m, speed_m_s, residual_m
     from samples where mission_id = $1 order by met, upload_seq, line_no`,
    [missionId],
  );
  return result.rows.map((row, index) => ({
    index,
    pass_id: row.pass_id,
    met: row.met,
    met_label: formatMetLabel(row.met),
    utc: isoInstant(row.utc_ms),
    lat_deg: row.lat_deg,
    lon_deg: row.lon_deg,
    altitude_m: row.altitude_m,
    speed_m_s: row.speed_m_s,
    residual_m: row.residual_m,
  }));
}

export async function loadFrameSamples(
  query: Queryable,
  missionId: string,
): Promise<FrameSample[]> {
  const result = await query.query<FrameSample & { met: number }>(
    `select met, x_m, y_m, z_m, vx_m_s, vy_m_s, vz_m_s, lat_deg, lon_deg, altitude_m, speed_m_s
     from samples where mission_id = $1 order by met, upload_seq, line_no`,
    [missionId],
  );
  return result.rows;
}

export async function loadTranscript(
  query: Queryable,
  missionId: string,
): Promise<TranscriptLine[]> {
  const result = await query.query<{
    id: string;
    pass_id: string;
    met: number;
    speaker: string;
    text: string;
  }>(
    `select id, pass_id, met, speaker, text from transcript_lines
     where mission_id = $1 order by met, upload_seq, line_no`,
    [missionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    pass_id: row.pass_id,
    met: row.met,
    met_label: formatMetLabel(row.met),
    speaker: row.speaker,
    text: row.text,
  }));
}

function codePointCompare(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index].codePointAt(0) as number) - (b[index].codePointAt(0) as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
}

export async function loadSpeakers(query: Queryable, missionId: string): Promise<Speaker[]> {
  const result = await query.query<{ name: string; lines: number }>(
    `select speaker as name, count(*)::int as lines from transcript_lines
     where mission_id = $1 group by speaker`,
    [missionId],
  );
  return result.rows.sort(
    (left, right) => right.lines - left.lines || codePointCompare(left.name, right.name),
  );
}

export async function loadEvents(
  query: Queryable,
  missionId: string,
  samples: readonly Sample[],
  withNote: boolean,
): Promise<MissionEvent[]> {
  const result = await query.query<{
    id: string;
    pass_id: string;
    met: number;
    title: string;
    note: string | null;
  }>(
    `select id, pass_id, met, title, note from events
     where mission_id = $1 order by met, created_ms, seq`,
    [missionId],
  );
  return result.rows.map((row) => {
    const sample = samples.length > 0 ? samples[snapIndex(samples, row.met)] : null;
    const event: MissionEvent = {
      id: row.id,
      pass_id: row.pass_id,
      met: row.met,
      met_label: formatMetLabel(row.met),
      title: row.title,
      sample: {
        lat_deg: sample?.lat_deg ?? 0,
        lon_deg: sample?.lon_deg ?? 0,
        altitude_m: sample?.altitude_m ?? 0,
        speed_m_s: sample?.speed_m_s ?? 0,
        residual_m: sample?.residual_m ?? null,
      },
    };
    if (withNote) {
      event.note = row.note;
    }
    return event;
  });
}

export async function loadLandmarks(query: Queryable, missionId: string): Promise<Landmark[]> {
  const result = await query.query<{
    id: string;
    name: string;
    lat_deg: number;
    lon_deg: number;
    created_ms: number;
  }>(
    `select id, name, lat_deg, lon_deg, created_ms from landmarks
     where mission_id = $1 order by seq`,
    [missionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat_deg: row.lat_deg,
    lon_deg: row.lon_deg,
    created_at: isoInstant(row.created_ms),
  }));
}

export async function loadSubscribers(
  query: Queryable,
  missionId: string,
): Promise<Subscriber[]> {
  const result = await query.query<{ id: string; url: string; created_ms: number }>(
    "select id, url, created_ms from subscribers where mission_id = $1 order by seq",
    [missionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    created_at: isoInstant(row.created_ms),
  }));
}

export type PassRow = {
  id: string;
  mission_id: string;
  filename: string;
  state: Pass["state"] | "deleted";
  size_bytes: number;
  sha256: string;
  sample_count: number;
  transcript_line_count: number;
  rejected_line: number | null;
  rejected_reason: Pass["rejected_reason"];
  is_seed: boolean;
  created_ms: number;
};

export const PASS_COLUMNS = `id, mission_id, filename, state, size_bytes, sha256, sample_count,
  transcript_line_count, rejected_line, rejected_reason, is_seed, created_ms`;

export function toPass(row: PassRow): Pass {
  return {
    id: row.id,
    mission_id: row.mission_id,
    filename: row.filename,
    state: row.state as Pass["state"],
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    sample_count: row.sample_count,
    transcript_line_count: row.transcript_line_count,
    rejected_line: row.rejected_line,
    rejected_reason: row.rejected_reason,
    created_at: isoInstant(row.created_ms),
  };
}

export async function loadPassRows(
  query: Queryable,
  missionId: string,
): Promise<PassRow[]> {
  const result = await query.query<PassRow>(
    `select ${PASS_COLUMNS} from passes
     where mission_id = $1 and state <> 'deleted' order by upload_seq`,
    [missionId],
  );
  return result.rows;
}

export async function findPassRow(
  query: Queryable,
  passId: string,
): Promise<PassRow | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(passId)) {
    return null;
  }
  const result = await query.query<PassRow>(`select ${PASS_COLUMNS} from passes where id = $1`, [
    passId,
  ]);
  return result.rows[0] ?? null;
}

export type PerilunePlate = Perilune & { speed_m_s: number; utc_ms: number };

/** The lowest-altitude sample, earliest by MET on a tie. */
export async function loadPerilunePlate(
  query: Queryable,
  missionId: string,
): Promise<PerilunePlate | null> {
  const result = await query.query<{
    met: number;
    utc_ms: number;
    altitude_m: number;
    lat_deg: number;
    lon_deg: number;
    speed_m_s: number;
    residual_m: number | null;
  }>(
    `select met, utc_ms, altitude_m, lat_deg, lon_deg, speed_m_s, residual_m from samples
     where mission_id = $1 order by altitude_m, met, upload_seq, line_no limit 1`,
    [missionId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    met: row.met,
    met_label: formatMetLabel(row.met),
    altitude_m: row.altitude_m,
    lat_deg: row.lat_deg,
    lon_deg: row.lon_deg,
    residual_m: row.residual_m,
    speed_m_s: row.speed_m_s,
    utc_ms: row.utc_ms,
  };
}

export async function loadPerilune(
  query: Queryable,
  missionId: string,
): Promise<Perilune | null> {
  const plate = await loadPerilunePlate(query, missionId);
  if (!plate) {
    return null;
  }
  return {
    met: plate.met,
    met_label: plate.met_label,
    altitude_m: plate.altitude_m,
    lat_deg: plate.lat_deg,
    lon_deg: plate.lon_deg,
    residual_m: plate.residual_m,
  };
}

export async function loadReference(
  query: Queryable,
  row: MissionRow,
): Promise<Reference | null> {
  if (!row.reference_target || !row.reference_state) {
    return null;
  }
  const result = await query.query<{ count: number }>(
    "select count(*)::int as count from reference_vectors where mission_id = $1",
    [row.id],
  );
  return {
    target: row.reference_target,
    state: row.reference_state,
    fetched_at: row.reference_fetched_ms === null ? null : isoInstant(row.reference_fetched_ms),
    vector_count: row.reference_state === "ready" ? result.rows[0].count : 0,
  };
}

export async function loadActiveShareLink(
  query: Queryable,
  missionId: string,
  nowMs: number,
): Promise<ShareLink | null> {
  const result = await query.query<{
    token: string;
    created_ms: number;
    expires_ms: number;
  }>(
    `select token, created_ms, expires_ms from share_links
     where mission_id = $1 and revoked = false and expires_ms > $2
     order by created_ms desc limit 1`,
    [missionId, nowMs],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    token: row.token,
    url: shareUrlPath(row.token),
    created_at: isoInstant(row.created_ms),
    expires_utc: isoInstant(row.expires_ms),
  };
}

export async function loadMission(row: MissionRow, nowMs: number): Promise<Mission> {
  const [passRows, landmarks, perilune, reference, share, counts] = await Promise.all([
    loadPassRows(pool, row.id),
    loadLandmarks(pool, row.id),
    loadPerilune(pool, row.id),
    loadReference(pool, row),
    loadActiveShareLink(pool, row.id, nowMs),
    pool.query<{ sample_count: number }>(
      "select count(*)::int as sample_count from samples where mission_id = $1",
      [row.id],
    ),
  ]);
  return {
    id: row.id,
    name: row.name,
    epoch_utc: isoInstant(row.epoch_ms),
    distance_unit: row.distance_unit,
    speed_unit: row.speed_unit,
    sample_count: counts.rows[0].sample_count,
    total_bytes: passRows.reduce((sum, pass) => sum + pass.size_bytes, 0),
    perilune,
    passes: passRows.map(toPass),
    landmarks,
    reference,
    share,
    change_version: row.change_version,
    created_at: isoInstant(row.created_ms),
  };
}
