/** The API shapes, shared by the server, the browser and the dossier. */

import type { DistanceUnit, SpeedUnit } from "./units.js";

export type PassState = "uploading" | "stored" | "parsed" | "rejected" | "deleted";

export type RejectionReason =
  | "line_too_long"
  | "unknown_record"
  | "too_many_samples"
  | "bad_field"
  | "out_of_order"
  | "no_samples"
  | "parser_failed";

export type Pass = {
  id: string;
  mission_id: string;
  filename: string;
  state: Exclude<PassState, "deleted">;
  size_bytes: number;
  sha256: string;
  sample_count: number;
  transcript_line_count: number;
  rejected_line: number | null;
  rejected_reason: RejectionReason | null;
  created_at: string;
};

export type SharePass = {
  id: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  sample_count: number;
  transcript_line_count: number;
};

export type Sample = {
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
};

export type TranscriptLine = {
  id: string;
  pass_id: string;
  met: number;
  met_label: string;
  speaker: string;
  text: string;
};

export type EventSample = {
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
  residual_m: number | null;
};

export type MissionEvent = {
  id: string;
  pass_id: string;
  met: number;
  met_label: string;
  title: string;
  note?: string | null;
  sample: EventSample;
};

export type Landmark = {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  created_at: string;
};

export type Subscriber = { id: string; url: string; created_at: string };

export type Reference = {
  target: string;
  state: "fetching" | "ready" | "unavailable";
  fetched_at: string | null;
  vector_count: number;
};

export type Vector = {
  unix_ms: number;
  x_m: number;
  y_m: number;
  z_m: number;
  vx_m_s: number;
  vy_m_s: number;
  vz_m_s: number;
};

export type ShareLink = {
  token: string;
  url: string;
  created_at: string;
  expires_utc: string;
};

export type Perilune = {
  met: number;
  met_label: string;
  altitude_m: number;
  lat_deg: number;
  lon_deg: number;
  residual_m: number | null;
};

export type Mission = {
  id: string;
  name: string;
  epoch_utc: string;
  distance_unit: DistanceUnit;
  speed_unit: SpeedUnit;
  sample_count: number;
  total_bytes: number;
  perilune: Perilune | null;
  passes: Pass[];
  landmarks: Landmark[];
  reference: Reference | null;
  share: ShareLink | null;
  change_version: number;
  created_at: string;
};

export type ShareMission = {
  mission: {
    name: string;
    epoch_utc: string;
    distance_unit: DistanceUnit;
    speed_unit: SpeedUnit;
    sample_count: number;
    perilune: Perilune | null;
    reference: Reference | null;
    change_version: number;
  };
  passes: SharePass[];
  landmarks: Landmark[];
  expires_utc: string;
};

export type PlanId = "archive-free" | "archive-1" | "archive-10-annual";

export type Plan = {
  plan: PlanId;
  label: string;
  price_cents: number;
  period: "month" | "year";
  quota_bytes: number;
  used_bytes: number;
  next_billing_date: string | null;
  balance_cents: number | null;
  billing: "up" | "down";
};

export type SearchHit = {
  kind: "line" | "event";
  met: number;
  met_label: string;
  speaker: string | null;
  text: string;
};

export type SearchResponse = { query: string; count: number; hits: SearchHit[] };

export type Speaker = { name: string; lines: number };

export type AuditEntry = {
  seq: number;
  at: string;
  kind: string;
  data: Record<string, unknown>;
  prev: string;
  hash: string;
};

export type ServiceStatus = {
  storage: "up" | "down";
  search: "up" | "down";
  queue: "up" | "down";
  cache: "up" | "down";
  billing: "up" | "down";
  webhooks: "up" | "down";
};
