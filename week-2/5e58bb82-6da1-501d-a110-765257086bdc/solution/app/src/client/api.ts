// Same-origin API calls. Every call belongs to a session epoch; a response that resolves after sign-out
// (a newer epoch) is discarded, so the next account never sees the previous account's data.

export type Role = "principal_surveyor" | "launch_technician" | "client_reviewer";
export type Units = "metric" | "imperial";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  client_org_id: string | null;
  units: Units;
}

export interface Position {
  easting: number;
  northing: number;
}

export interface Fix {
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
  link_state: "Live" | "Stale" | "Lost";
  last_fix: Fix | null;
  afloat: boolean;
  mission_id: string | null;
  running_line_id: string | null;
  thruster_hours_total: number;
  hours_since_service: number;
  service_interval_h: number;
  service_overdue: boolean;
}

interface Counters {
  coverage_pct: number;
  open_holidays: number;
  lines_remaining: number;
}

interface Agreement {
  compared: number;
  within: number;
  pct: number | null;
  meets_order: boolean | null;
}

export interface Mission {
  id: string;
  name: string;
  client_org_id: string;
  client_name: string;
  survey_date: string;
  status: string;
  survey_order: "special" | "1a";
  survey_area: Position[];
  geofence: Position[];
  planned_depth_m: number;
  swath_ratio: number;
  line_azimuth_deg: number;
  swath_width_m: number;
  line_spacing_m: number;
  line_count: number;
  crossline_count: number;
  estimated_duration_s: number;
  counters: Counters;
  crossline_agreement: Agreement;
  vessels: { id: string; name: string; link_state: string | null }[];
  report: { state: "None" | "Pending" | "Ready" };
  owner_id: string;
  owner_name: string;
  version: number;
  hold: { reason: string; since: string; by: string } | null;
}

export interface MissionSummary {
  id: string;
  name: string;
  client_org_id: string;
  client_name: string;
  survey_date: string;
  status: string;
  counters: Counters;
}

interface LineFile {
  state: "Awaiting upload" | "Stored";
  name: string | null;
  size_bytes: number | null;
  sha256: string | null;
}

export interface Line {
  id: string;
  mission_id: string;
  label: string;
  kind: "planned" | "crossline" | "infill";
  status: string;
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
  status: "Open" | "Queued" | "Closed";
  area_m2: number;
  cell_count: number;
  centroid: Position;
  cells: [number, number][];
  nearest_vessel: { id: string; name: string } | null;
  infill_line_id: string | null;
}

export interface Coverage {
  cell_size_m: number;
  origin: Position;
  cols: number;
  rows: number;
  overlap: number[][];
  counters: Counters;
}

export interface Track {
  line_id: string;
  label: string;
  vessel_id: string;
  points: { t: string; easting: number; northing: number; depth_m: number; swath_m: number }[];
}

export interface Alert {
  id: string;
  kind: string;
  state: "Active" | "Acknowledged" | "Rectified" | "Closed";
  heading: string;
  vessel_id: string;
  vessel_name: string;
  mission_id: string;
  raised_at: string;
  rectified_at: string | null;
  position: Position | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  email: "Queued" | "Emailed";
  history: { state: string; at: string; by: string }[];
}

export interface ApiError {
  error: string;
  message: string;
  errors?: Record<string, string>;
  [extra: string]: unknown;
}

interface Result<T> {
  status: number;
  ok: boolean;
  data: T;
  error: ApiError | null;
}

/** The request never got an HTTP response. */
export class NoResponse extends Error {}
/** The response belongs to a previous session epoch and must be ignored. */
export class Stale extends Error {}

let epoch = 0;
let onSessionEnded: (() => void) | null = null;

export const currentEpoch = () => epoch;
export function newEpoch(): void {
  epoch += 1;
}
export function whenSessionEnds(handler: () => void): void {
  onSessionEnded = handler;
}

interface Options {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** A 401 is the caller's to handle (sign-in, the upload dialog). */
  own401?: boolean;
}

export async function api<T = unknown>(path: string, options: Options = {}): Promise<Result<T>> {
  const started = epoch;
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
    });
  } catch {
    if (started !== epoch) throw new Stale();
    throw new NoResponse();
  }
  let data: unknown = null;
  if ((response.headers.get("content-type") ?? "").includes("json")) data = await response.json().catch(() => null);
  else await response.arrayBuffer().catch(() => undefined);
  if (started !== epoch) throw new Stale();
  if (response.status === 401 && !options.own401) onSessionEnded?.();
  const ok = response.ok;
  return { status: response.status, ok, data: data as T, error: ok ? null : (data as ApiError) };
}

/** Runs `work`, ignoring results from a previous session epoch. */
export function quietly(work: Promise<unknown>): void {
  work.catch((error) => {
    if (!(error instanceof Stale) && !(error instanceof NoResponse)) throw error;
  });
}

export function idempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
