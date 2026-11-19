// The one HTTP client. Every call carries the device header; a call that never reaches the server reports the
// unreachable copy once and throws, so typed input is never lost by the caller.

interface Repair { id: string; method: string; note: string; source: string; proposal_id: string | null; recorded_at: string }
export interface Still { id: string; content_type: string; size_bytes: number; sha256: string; file_name: string }
interface Lock { device_id: string; device_name: string; expires_in_s: number }
export type DefectType = "hole" | "tear" | "chafe" | "fouling";
export interface Defect {
  id: string; pen_id: string; type: DefectType; bearing_deg: number; depth_m: number; chart_x_m: number; chart_y_m: number;
  cell: string; size: Record<string, number>; area_cm2: number | null; patch_area_m2: number | null; note: string;
  private_note: string; status: "open" | "repaired"; removed: false; version: number; repairs: Repair[]; stills: Still[];
  lock: Lock | null; updated_at: string;
}
interface Placeholder { id: string; pen_id: string; removed: true; label: string }
export type AnyDefect = Defect | Placeholder;
export interface Grid { columns: number; rows: number; panel_width_m: number; panel_height_m: number }
export interface Grade { letter: string; label: string }
export interface Pen {
  id: string; farm_id: string; farm_name: string; site_code: string; site_name: string; pen_no: number; name: string;
  circumference_m: number; net_depth_m: number; grid: Grid; grade: Grade; open_defects: number; max_fouling_cover_pct: number;
  panels?: { cell: string; fouling_cover_pct: number }[]; defects?: AnyDefect[]; latest_revision: { number: number; published_at: string } | null;
}
export interface Device { id: string; name: string; online: boolean }
export interface Farm {
  id: string; name: string; day_rate: { amount: number; currency: string };
  sites: { code: string; name: string; latitude: number; longitude: number }[]; pen_ids: string[];
}
interface Clearance {
  result: string; message: string; checked_at: string; issued_at: string | null;
  hours: { time: string; current_m_s: number; wave_m: number; within_limits: boolean }[];
}
export interface Dive {
  id: string; pen_id: string; status: "planned" | "cleared" | "started" | "recorded"; planned_start: string; planned_minutes: number;
  diver_certificate_no: string; clearance: Clearance | null; started_at: string | null; finished_at: string | null;
  elapsed_s: number | null; track: { t_s: number; bearing_deg: number; depth_m: number }[];
  sonar: { id: string; content_type: string; size_bytes: number; sha256: string; file_name: string }[];
}
export interface ImportRecord {
  id: string; farm_id: string; file_name: string; sha256: string; size_bytes: number; imported_at: string; rows: number;
  created: { row: number; defect_id: string }[]; merged: { row: number; defect_id: string }[];
  already_imported: { row: number; defect_id: string }[]; orphans: { row: number; site_code: string; pen_no: string }[];
  invalid: { row: number; reason: string }[];
}
export interface Revision { number: number; published_at: string; sha256: string; size_bytes: number; grade: Grade; open_defects: number }
export interface LinkRecord {
  id: string; pen_id: string; token: string; path: string; url: string; status: "active" | "revoked" | "expired";
  created_at: string; expires_at: string; expires_in_s: number;
}
export interface Proposal { id: string; defect_id: string; method: string; note: string; status: string }
export interface Answer {
  id: string; question: string; text: string; focus: string[]; dropped_ids: string[];
  rejected_calls: { tool_call_id: string; reason: string }[]; proposals: Proposal[];
}

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public details?: Record<string, unknown>) {
    super(message);
  }
}

export class Unreachable extends Error {
  constructor() {
    super("Pensight server unreachable — changes are not saved");
  }
}

const DEVICE_KEY = "pensight.device";
let onUnreachable: (() => void) | null = null;

export const setUnreachableHandler = (fn: () => void) => { onUnreachable = fn; };
export const getDevice = (): string => localStorage.getItem(DEVICE_KEY) || "DEV-1";
export const setDevice = (id: string) => localStorage.setItem(DEVICE_KEY, id);

interface Options { raw?: BodyInit; headers?: Record<string, string>; silent?: boolean }

export async function call<T = unknown>(method: string, path: string, body?: unknown, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Pensight-Device": getDevice(), ...options.headers };
  let payload: BodyInit | undefined = options.raw;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload });
  } catch {
    if (!options.silent) onUnreachable?.();
    throw new Unreachable();
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = (data as { error?: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> } } | null)?.error;
    throw new ApiFailure(response.status, error?.code ?? "error", error?.message ?? `Request failed (${response.status})`, error?.fields, error?.details);
  }
  return data as T;
}

export const get = <T>(path: string, options?: Options) => call<T>("GET", path, undefined, options);
export const post = <T>(path: string, body?: unknown, options?: Options) => call<T>("POST", path, body, options);
export const patch = <T>(path: string, body: unknown) => call<T>("PATCH", path, body);
export const del = <T>(path: string, body?: unknown) => call<T>("DELETE", path, body);
export const upload = <T>(path: string, file: File, fallbackType: string) =>
  call<T>("POST", path, undefined, { raw: file, headers: { "Content-Type": file.type || fallbackType, "X-Filename": file.name } });

export const isDefect = (d: AnyDefect): d is Defect => !d.removed;
