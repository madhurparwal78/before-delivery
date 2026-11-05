export type Role = "owner" | "tech" | "member";

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
  member_number: string | null;
  email: string;
}

export type Shape = "round" | "rectangular" | "plate";
export type Plan = "bisque_and_glaze" | "bisque_only" | "glaze_only";
export type Stage = "bisque" | "glaze";
export type Cone = "06" | "04" | "02" | "6" | "10";
export type GlazeCone = "06" | "6";

export type PieceStatus =
  | "awaiting_payment"
  | "queued"
  | "loaded"
  | "firing"
  | "cooling"
  | "unloadable"
  | "ready"
  | "collected"
  | "uncollected";

export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  awaiting_payment: "Awaiting payment",
  queued: "Waiting for kiln",
  loaded: "Loaded in kiln",
  firing: "Firing",
  cooling: "Kiln still cooling",
  unloadable: "Cooled, waiting to unload",
  ready: "Ready on pickup shelf",
  collected: "Collected",
  uncollected: "Uncollected"
};

export type FiringStatus = "building" | "firing" | "cooling" | "unloadable" | "unloaded";

export const FIRING_STATUS_LABELS: Record<FiringStatus, string> = {
  building: "Building load",
  firing: "Firing",
  cooling: "Kiln still cooling",
  unloadable: "Ready to unload",
  unloaded: "Unloaded"
};

export interface Sides {
  length?: string;
  width?: string;
  diameter?: string;
  height: string;
}

export interface QuoteResult {
  sides_in: Sides;
  cubic_inches: string;
  rate_per_cubic_inch: string;
  discount_percent: number;
  order_minimum_cents: number;
  minimum_applied: boolean;
  fee_cents: number;
  rate_set_id: number;
}

export interface PieceOwnerInfo {
  kind: "member" | "guest";
  name: string;
  member_number: string | null;
}

export interface PieceHistoryEntry {
  at: string;
  at_label: string;
  actor: string;
  action: string;
}

export interface PlacementInfo {
  firing_id: number;
  layer: number;
  x: string;
  y: string;
  rotation: number;
}

export interface Piece {
  number: number;
  owner: PieceOwnerInfo;
  shape: Shape;
  sides_in: Sides;
  cubic_inches: string;
  fee_cents: number;
  rate_set_id: number;
  plan: Plan;
  stage: Stage | null;
  cone: GlazeCone | null;
  clay_id: string;
  status: PieceStatus;
  status_label: string;
  pickup_shelf: string | null;
  intake_photo_id: string | null;
  accepted_at: string;
  accepted_at_label: string;
  ready_at: string | null;
  ready_at_label: string | null;
  days_on_shelf: number | null;
  placement: PlacementInfo | null;
  history: PieceHistoryEntry[];
}

export interface ProfileSegment {
  rate_f_per_hour: number;
  target_f: number;
  hold_minutes: number;
}

export interface KilnProfile {
  id: number;
  kiln_id: string;
  name: string;
  stage: Stage;
  cone: Cone;
  segments: ProfileSegment[];
  cool_down_hours: number;
  firing_hours: string;
}

export interface Post {
  x: number;
  y: number;
  size_in: number;
}

export interface Kiln {
  id: string;
  name: string;
  shelf_diameter_in: number;
  layers: number;
  post_height_in: string;
  usable_cubic_inches: number;
  posts: Post[];
  profiles: KilnProfile[];
  current_firing_id: number | null;
}

export interface LayerPlacement {
  piece_number: number;
  shape: Shape;
  x: string;
  y: string;
  rotation: number;
  width_in: string;
  depth_in: string;
  height_in: string;
}

export interface FiringLayer {
  layer: number;
  height_in: string | null;
  placements: LayerPlacement[];
}

export interface Firing {
  id: number;
  kiln_id: string;
  profile: {
    id: number;
    name: string;
    stage: Stage;
    cone: Cone;
    segments: ProfileSegment[];
    cool_down_hours: number;
    firing_hours: string;
  };
  status: FiringStatus;
  status_label: string;
  started_at: string | null;
  started_at_label: string | null;
  firing_ends_at: string | null;
  firing_ends_at_label: string | null;
  cool_until: string | null;
  cool_until_label: string | null;
  server_now: string;
  server_now_label: string;
  fill_percent: number;
  layers: FiringLayer[];
}

export interface DamageReport {
  id: number;
  piece_number: number;
  kind: "glaze_run" | "crack";
  note: string | null;
  status: "reported" | "charged" | "waived";
  intake_photo_id: string | null;
  unload_photo_id: string;
  account_name: string;
  amount_cents: number | null;
  reported_by: string;
  reported_at: string;
  reported_at_label: string;
}

export interface RateSet {
  id: number;
  bisque_rate: string;
  glaze_rate: string;
  member_discount_percent: number;
  order_minimum_cents: number;
  effective_date: string;
  created_at: string;
  created_at_label: string;
}

export interface Clay {
  id: string;
  name: string;
  max_cone: Cone;
}
