/* Swathdeck browser app: typed SPA, no framework, no external requests. */

export interface Position { easting: number; northing: number }

export interface User {
  id: string; name: string; email: string;
  role: 'principal_surveyor' | 'launch_technician' | 'client_reviewer';
  client_org_id: string | null;
  units: 'metric' | 'imperial';
}

export interface Vessel {
  id: string; name: string; version: number;
  link_state: 'Live' | 'Stale' | 'Lost';
  last_fix_received_at: string | null;
  last_fix: FixData | null;
  afloat: boolean; mission_id: string | null; running_line_id: string | null;
  thruster_hours_total: number; hours_since_service: number;
  service_interval_h: number; service_overdue: boolean;
}

export interface FixData {
  t: string; received_at?: string;
  position: Position; heading_deg: number; speed_mps: number;
  battery_pct: number; depth_m: number;
}

export interface LineFile {
  state: 'Awaiting upload' | 'Stored';
  name: string | null; size_bytes: number | null;
  sha256: string | null; stored_at: string | null;
}

export interface Line {
  id: string; mission_id: string; label: string;
  kind: 'planned' | 'crossline' | 'infill';
  status: 'Pending' | 'Assigned' | 'Running' | 'Surveyed' | 'Delivered' | 'Superseded';
  rerun_of: string | null;
  vessel_id: string | null; vessel_name: string | null;
  start: Position; end: Position;
  length_m: number; covered_m: number;
  holiday_id: string | null;
  file: LineFile | null;
}

export interface CrosslineAgreement {
  compared: number; within: number; pct: number | null; meets_order: boolean | null;
}

export interface Mission {
  id: string; name: string; client_org_id: string; client_name: string;
  survey_date: string; status: string;
  survey_order: 'special' | '1a';
  survey_area: Position[]; geofence: Position[];
  planned_depth_m: number; swath_ratio: number; overlap_pct: number;
  line_azimuth_deg: number; planned_speed_mps: number;
  swath_width_m: number; line_spacing_m: number;
  line_count: number; crossline_count: number; estimated_duration_s: number;
  counters: { coverage_pct: number; open_holidays: number; lines_remaining: number };
  crossline_agreement: CrosslineAgreement;
  vessels: { id: string; name: string; link_state: string | null }[];
  report: { state: string };
  owner_id: string; owner_name: string;
  version: number;
  hold: { reason: string; since: string; by: string } | null;
  created_at: string; launched_at: string | null; completed_at: string | null;
}

export interface Holiday {
  id: string; label: string; status: 'Open' | 'Queued' | 'Closed';
  area_m2: number; cell_count: number; centroid: Position;
  cells: number[][];
  nearest_vessel: { id: string; name: string } | null;
  infill_line_id: string | null;
}

export interface Alert {
  id: string; kind: string; state: 'Active' | 'Acknowledged' | 'Rectified' | 'Closed';
  heading: string; vessel_id: string; vessel_name: string; mission_id: string;
  raised_at: string; rectified_at: string | null;
  position: Position | null;
  acknowledged_at: string | null; acknowledged_by: string | null;
  email: string; escalation: string;
  history: { state: string; at: string; by: string }[];
}

export interface Flag {
  id: string; mission_id: string; mission_name: string;
  line_id: string; line_label: string;
  comment: string; by: string; at: string;
  state: 'Open' | 'Answered'; reply: string | null;
  client_name: string;
}

export type Units = 'metric' | 'imperial';

// ---------- units display ----------

export function roundHalfAway(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON * Math.abs(n) * f) / f;
}

export function fmtLength(m: number, units: Units): string {
  const v = units === 'metric' ? m : m / 0.3048;
  return `${roundHalfAway(v, 1).toLocaleString('en-GB', { maximumFractionDigits: 1 })} ${units === 'metric' ? 'm' : 'ft'}`;
}

export function fmtSpeed(mps: number, units: Units): string {
  const v = units === 'metric' ? mps : mps * 3600 / 1852;
  return `${roundHalfAway(v, 1).toLocaleString('en-GB', { maximumFractionDigits: 1 })} ${units === 'metric' ? 'm/s' : 'kn'}`;
}

export function fmtArea(m2: number, units: Units): string {
  const v = units === 'metric' ? m2 : m2 / 0.09290304;
  return `${Math.round(roundHalfAway(v, 0)).toLocaleString('en-GB')} ${units === 'metric' ? 'm²' : 'ft²'}`;
}

export function fmtHours(h: number): string {
  return `${roundHalfAway(h, 1).toLocaleString('en-GB', { maximumFractionDigits: 1 })} h`;
}

export function fmtPct(p: number): string {
  return `${roundHalfAway(p, 1).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
}

export function fmtPos(p: Position, units: Units): string {
  const e = units === 'metric' ? p.easting : p.easting / 0.3048;
  const n = units === 'metric' ? p.northing : p.northing / 0.3048;
  return `E ${roundHalfAway(e, 1).toLocaleString('en-GB', { maximumFractionDigits: 1 })} N ${roundHalfAway(n, 1).toLocaleString('en-GB', { maximumFractionDigits: 1 })}`;
}

export function toMetricLength(v: number, units: Units): number {
  return units === 'metric' ? v : v * 0.3048;
}

export function toMetricSpeed(v: number, units: Units): number {
  return units === 'metric' ? v : v * 1852 / 3600;
}

export function fmtTimeUTC(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(11, 19) + ' UTC';
}

export function fmtDateTimeUTC(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10) + ' ' + iso.slice(11, 19) + ' UTC';
}
