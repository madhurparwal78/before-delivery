// The API shapes used by the browser, mirroring the server's public shapes.

import type { DistanceUnit, SpeedUnit } from "../shared/format.js";

export interface ApiSample {
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

export interface ApiLine {
  id: string;
  pass_id: string;
  met: number;
  met_label: string;
  speaker: string;
  text: string;
}

export interface ApiEvent {
  id: string;
  pass_id: string;
  met: number;
  met_label: string;
  title: string;
  note?: string;
  sample: {
    lat_deg: number;
    lon_deg: number;
    altitude_m: number;
    speed_m_s: number;
    residual_m: number | null;
  } | null;
}

export interface ApiLandmark {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
  created_at: string;
}

export interface ApiPerilune {
  met: number;
  met_label: string;
  altitude_m: number;
  lat_deg: number;
  lon_deg: number;
  residual_m: number | null;
}

export interface ApiReference {
  target: string;
  state: "fetching" | "ready" | "unavailable";
  fetched_at: string | null;
  vector_count: number;
}

export interface ApiPass {
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
  created_at: string;
}

export interface ApiMission {
  id?: string;
  name: string;
  epoch_utc: string;
  distance_unit: DistanceUnit;
  speed_unit: SpeedUnit;
  sample_count: number;
  total_bytes: number;
  perilune: ApiPerilune | null;
  passes: ApiPass[];
  landmarks: ApiLandmark[];
  reference: ApiReference | null;
  share: { token: string; url: string; created_at: string; expires_utc: string } | null;
  change_version: number;
  created_at?: string;
  expires_utc?: string;
}

export interface ApiShareMission {
  mission: Omit<ApiMission, "passes" | "landmarks">;
  passes: ApiPass[];
  landmarks: ApiLandmark[];
  expires_utc: string;
}

export interface ApiFrame {
  k: number;
  met_ms: number;
  altitude_m: number;
  lat_deg: number;
  lon_deg: number;
  speed_m_s: number;
}

export interface ApiSearchResult {
  query: string;
  count: number;
  hits: Array<{
    kind: "line" | "event";
    met: number;
    met_label: string;
    speaker: string | null;
    text: string;
  }>;
}

export interface ApiSpeaker {
  name: string;
  lines: number;
}
