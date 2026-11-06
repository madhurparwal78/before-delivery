export type Role = 'principal_surveyor' | 'launch_technician' | 'client_reviewer';
export type Units = 'metric' | 'imperial';
export type SurveyOrder = 'special' | '1a';
export type LinkState = 'Live' | 'Stale' | 'Lost';
export type MissionStatus =
  | 'Planned'
  | 'Launched'
  | 'Surveying'
  | 'Recovering'
  | 'Complete'
  | 'Aborted';
export type LineKind = 'planned' | 'crossline' | 'infill';
export type LineStatus =
  | 'Pending'
  | 'Assigned'
  | 'Running'
  | 'Surveyed'
  | 'Delivered'
  | 'Superseded';
export type HolidayStatus = 'Open' | 'Queued' | 'Closed';
export type AlertKind = 'geofence_breach' | 'link_lost' | 'service_overdue';
export type AlertState = 'Active' | 'Acknowledged' | 'Rectified' | 'Closed';
export type ReportState = 'None' | 'Pending' | 'Ready';
export type FileState = 'Awaiting upload' | 'Stored';

export interface Position {
  easting: number;
  northing: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  client_org_id: string | null;
  units: Units;
}

export interface ClientOrg {
  id: string;
  name: string;
  time_zone: string;
}

export interface VesselFix {
  t: string;
  position: Position;
  heading_deg: number;
  speed_mps: number;
  battery_pct: number;
  depth_m: number;
}

export interface Vessel {
  id: string;
  name: string;
  version: number;
  link_state: LinkState;
  last_fix_received_at: string | null;
  last_fix: VesselFix | null;
  afloat: boolean;
  mission_id: string | null;
  running_line_id: string | null;
  thruster_hours_total: number;
  hours_since_service: number;
  service_interval_h: number;
  service_overdue: boolean;
}

export interface RecentFix extends VesselFix {
  received_at: string;
}

export interface Counters {
  coverage_pct: number;
  open_holidays: number;
  lines_remaining: number;
}

export interface CrosslineAgreement {
  compared: number;
  within: number;
  pct: number | null;
  meets_order: boolean | null;
}

export interface MissionHold {
  reason: string;
  since: string;
  by: string;
}

export interface MissionVessel {
  id: string;
  name: string;
  link_state: LinkState | null;
}

export interface Mission {
  id: string;
  name: string;
  client_org_id: string;
  client_name: string;
  survey_date: string;
  status: MissionStatus;
  survey_order: SurveyOrder;
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
  counters: Counters;
  crossline_agreement: CrosslineAgreement;
  vessels: MissionVessel[];
  report: { state: ReportState };
  owner_id: string;
  owner_name: string;
  version: number;
  hold: MissionHold | null;
  created_at: string;
  launched_at: string | null;
  completed_at: string | null;
}

export interface MissionSummary {
  id: string;
  name: string;
  client_org_id: string;
  client_name: string;
  survey_date: string;
  status: MissionStatus;
  counters: Counters;
}

export interface LineFile {
  state: FileState;
  name: string | null;
  size_bytes: number | null;
  sha256: string | null;
  stored_at: string | null;
}

export interface Line {
  id: string;
  mission_id: string;
  label: string;
  kind: LineKind;
  status: LineStatus;
  rerun_of: string | null;
  vessel_id: string | null;
  vessel_name: string | null;
  start: Position;
  end: Position;
  length_m: number;
  covered_m: number;
  holiday_id: string | null;
  file: LineFile | null;
}

export interface Holiday {
  id: string;
  label: string;
  status: HolidayStatus;
  area_m2: number;
  cell_count: number;
  centroid: Position;
  cells: [number, number][];
  nearest_vessel: { id: string; name: string } | null;
  infill_line_id: string | null;
}

export interface AlertHistoryEntry {
  state: AlertState;
  at: string;
  by: string;
}

export interface Alert {
  id: string;
  kind: AlertKind;
  state: AlertState;
  heading: string;
  vessel_id: string;
  vessel_name: string;
  mission_id: string;
  raised_at: string;
  rectified_at: string | null;
  position: Position | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  email: 'Queued' | 'Emailed';
  escalation: 'None' | 'Queued' | 'Emailed';
  history: AlertHistoryEntry[];
}

export interface CoverageGrid {
  cell_size_m: 5;
  origin: Position;
  cols: number;
  rows: number;
  overlap: number[][];
  counters: Counters;
}

export interface TrackPoint {
  t: string;
  easting: number;
  northing: number;
  depth_m: number;
  swath_m: number;
}

export interface Track {
  line_id: string;
  label: string;
  vessel_id: string;
  points: TrackPoint[];
}

export interface ServiceEntry {
  id: string;
  vessel_id: string;
  logged_at: string;
  logged_by: string;
  hours_at_service: number;
  note: string;
}

export interface PlanPreview {
  swath_width_m: number;
  line_spacing_m: number;
  line_count: number;
  crossline_count: number;
  estimated_duration_s: number;
}

export interface StatusReport {
  storage: 'up' | 'down';
  mail: 'up' | 'down';
}

export type MissionEventKind =
  | 'created'
  | 'assignments'
  | 'status'
  | 'line'
  | 'file'
  | 'alert'
  | 'infill'
  | 'owner'
  | 'hold'
  | 'geofence'
  | 'rerun';

export interface MissionEvent {
  seq: number;
  at: string;
  kind: MissionEventKind;
  actor: string;
  summary: string;
}

export interface Flag {
  id: string;
  line_label: string;
  comment: string;
  by: string;
  at: string;
  state: 'Open' | 'Answered';
  reply: string | null;
}

export interface StaffFlag extends Flag {
  mission_id: string;
  mission_name: string;
  client_name: string;
  line_id: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  from?: string;
  to?: string;
  current?: unknown;
  index?: number;
  retry_at?: string;
  received_bytes?: number;
}
