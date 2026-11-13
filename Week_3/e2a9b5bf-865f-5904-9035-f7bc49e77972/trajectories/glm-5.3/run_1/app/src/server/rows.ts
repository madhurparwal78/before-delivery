// Row mapping helpers: Postgres rows to API shapes.
import type { Observation, Packet, SessionSummary, SketchInfo } from "#shared/api.js";
import type { DerivedOptics, TrainId } from "#shared/optics.js";
import type { MeasuredPair } from "#shared/pair.js";
import type { Pool } from "pg";

export interface SessionRow {
  readonly id: string;
  readonly site_id: string;
  readonly site_name: string;
  readonly time_zone: string;
  readonly started_at_text: string;
  readonly evening_date: string;
  readonly local_start: string;
  readonly local_start_offset: string;
  readonly telescope_id: string | null;
  readonly eyepiece_id: string | null;
  readonly barlow_id: string | null;
  readonly train: string;
  readonly derived: DerivedOptics;
  readonly observation_count: number;
}

export interface ObservationRow {
  readonly id: string;
  readonly session_id: string;
  readonly object_id: string;
  readonly designation: string;
  readonly kind: string;
  readonly observed_at_text: string | null;
  readonly local_time: string | null;
  readonly local_offset: string | null;
  readonly evening_date: string;
  readonly site_id: string;
  readonly site_name: string;
  readonly time_zone: string;
  readonly seeing: number | null;
  readonly transparency_nelm: number | null;
  readonly concentration_class: string | null;
  readonly pair_primary: [number, number] | null;
  readonly pair_secondary: [number, number] | null;
  readonly pair_separation: number | null;
  readonly pair_pa: number | null;
  readonly description: string;
  readonly telescope_id: string | null;
  readonly eyepiece_id: string | null;
  readonly barlow_id: string | null;
  readonly train: string;
  readonly derived: DerivedOptics;
  readonly strokes_sha256: string | null;
  readonly strokes_size: number | null;
  readonly raster_sha256: string | null;
  readonly version: number;
}

export const SESSION_SELECT = `
  SELECT s.id, si.id AS site_id, si.name AS site_name, si.time_zone,
         s.started_at_text, s.evening_date, s.local_start, s.local_start_offset,
         s.telescope_id, s.eyepiece_id, s.barlow_id, s.train, s.derived,
         (SELECT count(*)::int FROM observations o WHERE o.session_id = s.id AND o.deleted = false) AS observation_count
  FROM observing_sessions s JOIN sites si ON si.id = s.site_id`;

export const OBSERVATION_SELECT = `
  SELECT o.id, o.session_id, o.object_id, ob.designation, ob.kind,
         o.observed_at_text, o.local_time, o.local_offset, o.evening_date,
         si.id AS site_id, si.name AS site_name, si.time_zone,
         o.seeing, o.transparency_nelm, o.concentration_class,
         o.pair_primary, o.pair_secondary, o.pair_separation, o.pair_pa,
         o.description, o.telescope_id, o.eyepiece_id, o.barlow_id, o.train, o.derived,
         o.strokes_sha256, o.strokes_size, o.raster_sha256, o.version
  FROM observations o
  JOIN observing_sessions s ON s.id = o.session_id
  JOIN sites si ON si.id = s.site_id
  JOIN objects ob ON ob.id = o.object_id`;

export function sessionFromRow(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    site: { id: row.site_id, name: row.site_name, time_zone: row.time_zone },
    started_at: row.started_at_text,
    evening_date: row.evening_date,
    local_start: row.local_start,
    local_start_offset: row.local_start_offset,
    optics: {
      telescope_id: row.telescope_id ?? "",
      eyepiece_id: row.eyepiece_id ?? "",
      barlow_id: row.barlow_id,
      train: row.train as TrainId,
    },
    derived: row.derived,
    observation_count: row.observation_count,
  };
}

export function observationFromRow(row: ObservationRow): Observation {
  const sketch: SketchInfo | null = row.strokes_sha256
    ? { strokes_sha256: row.strokes_sha256, strokes_size: row.strokes_size ?? 0, has_raster: row.raster_sha256 !== null }
    : null;
  let pair: MeasuredPair | null = null;
  if (row.pair_primary && row.pair_secondary) {
    pair = {
      primary: row.pair_primary,
      secondary: row.pair_secondary,
      separation_arcmin: Number(row.pair_separation ?? 0),
      position_angle_deg: Number(row.pair_pa ?? 0),
    };
  }
  return {
    id: row.id,
    session_id: row.session_id,
    object_id: row.object_id,
    designation: row.designation,
    kind: row.kind as Observation["kind"],
    observed_at: row.observed_at_text,
    local_time: row.local_time,
    local_offset: row.local_offset,
    evening_date: row.evening_date,
    site: { id: row.site_id, name: row.site_name, time_zone: row.time_zone },
    seeing: row.seeing,
    transparency_nelm: Number(row.transparency_nelm ?? 0) || null,
    concentration_class: row.concentration_class,
    pair,
    description: row.description,
    optics: {
      telescope_id: row.telescope_id ?? "",
      eyepiece_id: row.eyepiece_id ?? "",
      barlow_id: row.barlow_id,
      train: row.train as TrainId,
    },
    derived: row.derived,
    sketch,
    version: row.version,
  };
}

export interface PacketRowRecord {
  readonly id: string;
  readonly number: number;
  readonly program_id: string;
  readonly state: string;
  readonly revision: number;
  readonly observation_ids: string[];
  readonly rows: Packet["rows"];
  readonly pdf: Packet["pdf"];
  readonly failure: Packet["failure"];
  readonly sent_at_text: string | null;
  readonly returned_to_draft: boolean;
  readonly created_at_text: string;
}

export function packetFromRow(row: PacketRowRecord, label: string): Packet {
  return {
    id: row.id,
    number: row.number,
    program_id: row.program_id,
    state: row.state as Packet["state"],
    label,
    revision: row.revision,
    observation_ids: row.observation_ids,
    rows: row.rows,
    pdf: row.pdf,
    failure: row.failure,
    sent_at: row.sent_at_text,
    returned_to_draft: row.returned_to_draft,
    created_at: row.created_at_text,
  };
}

export const PACKET_SELECT = "SELECT id, number, program_id, state, revision, observation_ids, rows, pdf, failure, sent_at_text, returned_to_draft, created_at_text FROM packets";
