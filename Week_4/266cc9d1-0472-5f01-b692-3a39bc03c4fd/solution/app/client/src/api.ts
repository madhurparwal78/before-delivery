// The API's types and one fetch helper that turns every answer into data or an ApiFailure.

type Role = "survey_processor" | "vegetation_analyst";
import type { SetState } from "../../shared/findingsSetRules";

export type AssetKind = "tileset" | "terrain" | "czml";
type AssetState = "pending" | "stored" | "rejected";

export interface Staff {
  id: string;
  name: string;
  role: Role;
  email: string;
  tenant_id: string;
  tenant_name: string;
}

interface Utility {
  id: string;
  name: string;
  time_zone: string;
  forester_name: string;
  forester_email: string;
}

export interface Corridor {
  id: string;
  name: string;
  voltage_kv: number;
  clearance_threshold_m: number;
  length_m: number;
  tower_count: number;
  utility: Utility;
  inspection_due: string;
  overdue: boolean;
  current_set: { id: string; revision: number; state: SetState } | null;
}

export interface Tower {
  number: number;
  label: string;
  chainage_m: number;
  lon_deg: number;
  lat_deg: number;
  base_height_m: number;
  attachment_height_m: number;
}

export interface Coverage {
  from_m: number;
  to_m: number;
}

export interface ActiveAssets {
  tileset: string | null;
  terrain: string | null;
  czml: string | null;
}

export interface CorridorDetail {
  corridor: Corridor;
  towers: Tower[];
  active_assets: ActiveAssets;
  coverage: Coverage[];
}

export interface Finding {
  id: string;
  set_id: string;
  label: string;
  chainage_m: number;
  offset_m: number;
  lon_deg: number;
  lat_deg: number;
  ecef_m: [number, number, number];
  ground_height_m: number;
  terrain_level: number | null;
  canopy_height_m: number;
  canopy_top_height_m: number;
  canopy_radius_m: number;
  span: { from_tower: number; to_tower: number; label: string };
  clearance_m: number;
  status: "violation" | "clear";
  comment: string;
  updated_at: string;
}

export interface ReviewLink {
  url: string;
  expires_at: string;
  status: "live" | "revoked" | "expired";
  email_state: "queued" | "sent";
}

export interface Decision {
  decision: "accept" | "dispute";
  note: string;
}

export interface FindingsSet {
  id: string;
  corridor_id: string;
  revision: number;
  state: SetState;
  previous_set_id: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  frozen: { finding_count: number; violation_count: number } | null;
  review_link: ReviewLink | null;
  decisions: Record<string, Decision>;
}

interface AssetFile {
  path: string;
  size_bytes: number;
  sha256: string;
  state: AssetState;
}

export interface Asset {
  id: string;
  corridor_id: string;
  kind: AssetKind;
  state: AssetState;
  rejected_reason: "checksum_mismatch" | "invalid_czml" | null;
  files: AssetFile[];
  created_at: string;
  stored_at: string | null;
}

export type FlightAnswer =
  | { chainage_m: number | null; time: string; covered: true; position: { lon_deg: number; lat_deg: number; height_m: number } }
  | { chainage_m: number | null; time: string | null; covered: false; label: string };

export interface ReviewData extends CorridorDetail {
  set: FindingsSet;
  findings: Finding[];
  contractor: { name: string };
  expires_at: string;
  read_only: boolean;
}

export interface ServiceStatus {
  storage: "ok" | "unreachable";
  mail: "ok" | "unreachable";
  checked_at: string;
}

/** A request that did not succeed: an HTTP error with the API's error body, or no answer at all (status 0). */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }

  get networkOrServer(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

export async function api<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: { body?: unknown; raw?: Blob; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.raw !== undefined) headers["Content-Type"] = "application/octet-stream";
  if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  } catch {
    throw new ApiFailure(0, "network", "The request did not reach Spanwise.");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = JSON.parse(text) as ErrorBody;
    } catch {
      body = {};
    }
    throw new ApiFailure(response.status, body.error?.code ?? "unknown", body.error?.message ?? response.statusText, body.error?.fields ?? {});
  }
  return JSON.parse(text) as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
