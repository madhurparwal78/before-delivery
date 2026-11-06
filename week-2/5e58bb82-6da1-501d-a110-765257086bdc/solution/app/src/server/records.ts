// Database records as pg returns them: NUMERIC and INT8 as number, timestamptz as Date, jsonb parsed.
// Columns that are set together are typed together, so a narrowed record needs no assertion.
import type { Position } from "./geometry.js";
import type { Role } from "./landing.js";

export interface ClientOrgRecord {
  id: string;
  name: string;
  time_zone: string;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: Role;
  client_org_id: string | null;
  units: string;
  password_hash: string;
  last_screen: string | null;
}

/** The signed-in user of a request: the user record and the session it came with. */
export interface SessionUser extends UserRecord {
  token_hash: string;
}

export interface SignInAttemptRecord {
  email: string;
  failures: number;
  window_started_at: Date | null;
  locked_until: Date | null;
}

/** The last fix columns are written together by ingest, so either all are set or none is. */
type LastFix =
  | { last_fix_t: Date; last_easting: number; last_northing: number; last_heading: number; last_speed: number; last_battery: number; last_depth: number }
  | { last_fix_t: null; last_easting: null; last_northing: null; last_heading: null; last_speed: null; last_battery: null; last_depth: null };

export type VesselRecord = LastFix & {
  id: string;
  name: string;
  seed_order: number;
  ingest_key: string;
  version: number;
  afloat: boolean;
  thruster_hours_total: number;
  hours_since_service: number;
  service_interval_h: number;
  last_fix_received_at: Date | null;
  last_fix_line_id: string | null;
  link_observed: string;
  lost_spell_alerted: Date | null;
  overdue_alerted: boolean;
};

/** A vessel with its placement: the open mission it holds lines on, and its running line. */
export type PlacedVessel = VesselRecord & { mission_id: string | null; running_line_id: string | null };

/** The report columns move together: Pending on completion, Ready once the bytes are stored. */
type MissionReport =
  | { report_state: "None"; completed_at: null; report_sha256: null; report_stored_at: null }
  | { report_state: "Pending"; completed_at: Date; report_sha256: null; report_stored_at: null }
  | { report_state: "Ready"; completed_at: Date; report_sha256: string; report_stored_at: Date };

export type MissionRecord = MissionReport & {
  id: string;
  name: string;
  client_org_id: string;
  survey_date: string;
  status: string;
  survey_order: string;
  survey_area: Position[];
  geofence: Position[];
  planned_depth_m: number;
  swath_ratio: number;
  overlap_pct: number;
  line_azimuth_deg: number;
  planned_speed_mps: number;
  swath_width_m: number;
  line_spacing_m: number;
  line_count: number;
  crossline_count: number;
  estimated_duration_s: number;
  owner_id: string;
  version: number;
  hold_reason: string | null;
  hold_since: Date | null;
  hold_by: string | null;
  created_at: Date;
  launched_at: Date | null;
};

export interface MissionCoverageRecord {
  mission_id: string;
  coverage_pct: number;
  compared: number;
  within: number;
}

export type LineKind = "planned" | "crossline" | "infill";

/** The file columns are written together when storage confirms the file. */
type LineFile =
  | { file_state: "Stored"; file_name: string; file_size: number; file_sha256: string; file_stored_at: Date }
  | { file_state: "Awaiting upload" | null; file_name: null; file_size: null; file_sha256: null; file_stored_at: null };

export type LineRecord = LineFile & {
  id: string;
  mission_id: string;
  label: string;
  kind: LineKind;
  sort_key: string;
  status: string;
  rerun_of: string | null;
  vessel_id: string | null;
  start_e: number;
  start_n: number;
  end_e: number;
  end_n: number;
  length_m: number;
  offset_m: number | null;
  holiday_id: string | null;
  queue_pos: number | null;
};

/** A line as the lines endpoint reads it: with its vessel's name and covered length. */
export type LineView = LineRecord & { vessel_name: string | null; covered_m: number };

export interface FixRecord {
  vessel_id: string;
  t: Date;
  received_at: Date;
  easting: number;
  northing: number;
  heading_deg: number;
  speed_mps: number;
  battery_pct: number;
  depth_m: number;
  line_id: string | null;
}

export interface SweepRecord {
  id: number;
  mission_id: string;
  line_id: string;
  ax: number;
  ay: number;
  bx: number;
  by_: number;
  half_width: number;
  depth_m: number;
  length_m: number;
}

/** A 5 m grid cell as [column, row]. */
export type Cell = [number, number];

/** A Queued holiday always names its infill line. */
type HolidayState = { status: "Queued"; infill_line_id: string } | { status: "Open" | "Closed"; infill_line_id: string | null };

export type HolidayRecord = HolidayState & {
  id: string;
  mission_id: string;
  label_no: number;
  cells: Cell[];
};

export interface ExcursionRecord {
  id: number;
  vessel_id: string;
  mission_id: string;
  alert_id: string;
  ended_at: Date | null;
}

export type AlertKind = "geofence_breach" | "link_lost" | "service_overdue";

export interface AlertHistoryEntry {
  state: string;
  at: string;
  by: string;
}

/** An alert's position is stored whole or not at all. */
type AlertPosition = { easting: number; northing: number } | { easting: null; northing: null };

export type AlertRecord = AlertPosition & {
  id: string;
  seq: number;
  kind: AlertKind;
  state: string;
  heading: string;
  vessel_id: string;
  mission_id: string;
  raised_at: Date;
  rectified_at: Date | null;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  email_state: string;
  escalation_state: string;
  history: AlertHistoryEntry[];
};

/** An alert with its vessel's name, as the alerts board and emails show it. */
export type AlertView = AlertRecord & { vessel_name: string };

export interface ServiceLogRecord {
  id: string;
  seq: number;
  vessel_id: string;
  logged_at: Date;
  logged_by: string;
  hours_at_service: number;
  note: string;
}

export interface IdempotencyKeyRecord {
  user_id: string;
  endpoint: string;
  key: string;
  fingerprint: string;
  status: number | null;
  response: unknown;
  created_at: Date;
}

export interface OutboxRecord {
  id: number;
  dedupe: string;
  ref_kind: string;
  ref_id: string;
  recipient: string;
  recipient_name: string;
  subject: string;
  body: string;
  created_at: Date;
  sent_at: Date | null;
}

export interface MissionEventRecord {
  seq: number;
  mission_id: string;
  at: Date;
  kind: string;
  actor: string;
  summary: string;
}

/** A reply's columns are written together. */
type FlagReply = { reply_text: null; reply_by: null; reply_at: null } | { reply_text: string; reply_by: string; reply_at: Date };

export type FlagRecord = FlagReply & {
  id: string;
  seq: number;
  mission_id: string;
  line_id: string;
  line_label: string;
  comment: string;
  by_user_id: string;
  by_name: string;
  at: Date;
  state: string;
};

/** A flag with its mission's and client's names. */
export type FlagView = FlagRecord & { mission_name: string; client_name: string };

export interface UploadRecord {
  id: string;
  line_id: string;
  size_bytes: number;
  sha256: string;
  received_bytes: number;
  open: boolean;
  created_at: Date;
}
