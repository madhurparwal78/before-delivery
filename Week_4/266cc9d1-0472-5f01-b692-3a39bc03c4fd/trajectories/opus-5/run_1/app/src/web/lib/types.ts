export type SetState =
  | "draft"
  | "submitted"
  | "under_review"
  | "accepted"
  | "disputed"
  | "closed";

export interface Staff {
  id: string;
  name: string;
  role: "survey_processor" | "vegetation_analyst";
  email: string;
  tenant_id: string;
  tenant_name: string;
}

export interface Corridor {
  id: string;
  name: string;
  voltage_kv: number;
  clearance_threshold_m: number;
  length_m: number;
  tower_count: number;
  utility: {
    id: string;
    name: string;
    time_zone: string;
    forester_name: string;
    forester_email: string;
  };
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

export interface CoverageRange {
  from_m: number;
  to_m: number;
}

export interface ActiveAssets {
  tileset: string | null;
  terrain: string | null;
  czml: string | null;
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
  decisions: Record<string, { decision: "accept" | "dispute"; note: string }>;
}

export interface AssetFile {
  path: string;
  size_bytes: number;
  sha256: string;
  state: "pending" | "stored" | "rejected";
}

export interface Asset {
  id: string;
  corridor_id: string;
  kind: "tileset" | "terrain" | "czml";
  state: "pending" | "stored" | "rejected";
  rejected_reason: string | null;
  files: AssetFile[];
  created_at: string;
  stored_at: string | null;
}

export interface FlightAnswer {
  chainage_m: number | null;
  time: string | null;
  covered: boolean;
  position?: { lon_deg: number; lat_deg: number; height_m: number };
  label?: string;
}

export interface CorridorDetail {
  corridor: Corridor;
  towers: Tower[];
  active_assets: ActiveAssets;
  coverage: CoverageRange[];
}

export interface ReviewPayload {
  set: FindingsSet;
  corridor: Corridor;
  towers: Tower[];
  active_assets: ActiveAssets;
  coverage: CoverageRange[];
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

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    from?: string;
    action?: string;
  };
}
