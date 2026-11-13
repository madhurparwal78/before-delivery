// JSON shapes of the API, shared by the server serialisers and the browser.
import type { Cone, Rotation, Shape, Stage } from "./rules";

export type Role = "owner" | "tech" | "member";
export type Plan = "bisque_and_glaze" | "bisque_only" | "glaze_only";
export type Unit = "in" | "cm";

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

export type FiringStatus = "building" | "firing" | "cooling" | "unloadable" | "unloaded";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  member_number: string | null;
}

export interface Clay {
  id: string;
  name: string;
  max_cone: Cone;
}

export interface Segment {
  rate_f_per_hour: number;
  target_f: number;
  hold_minutes: number;
}

export interface Profile {
  id: string;
  name: string;
  stage: Stage;
  cone: Cone;
  segments: Segment[];
  cool_down_hours: number;
  firing_hours: string;
}

export interface Kiln {
  id: string;
  name: string;
  shelf_diameter_in: string;
  layers: number;
  post_height_in: string;
  usable_cubic_inches: number;
  posts: { x: string; y: string; size_in: string }[];
  profiles: Profile[];
  current_firing_id: number | null;
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

export interface Sides {
  length?: string;
  width?: string;
  diameter?: string;
  height: string;
}

export interface Quote {
  sides_in: Sides;
  cubic_inches: string;
  rate_per_cubic_inch: string;
  discount_percent: number;
  order_minimum_cents: number;
  minimum_applied: boolean;
  fee_cents: number;
  rate_set_id: number;
}

export interface PieceOwner {
  kind: "member" | "guest";
  name: string;
  email: string;
  member_number: string | null;
}

export interface Placement {
  firing_id: number;
  layer: number;
  x: string;
  y: string;
  rotation: Rotation;
}

export interface HistoryEntry {
  at: string;
  at_label: string;
  actor: string;
  action: string;
}

export interface Piece {
  number: string;
  owner: PieceOwner;
  shape: Shape;
  sides_in: Sides;
  cubic_inches: string;
  fee_cents: number;
  rate_set_id: number;
  plan: Plan;
  stage: Stage | null;
  cone: Cone | null;
  clay_id: string;
  status: PieceStatus;
  status_label: string;
  pickup_shelf: string | null;
  intake_photo_id: string;
  accepted_at: string;
  accepted_at_label: string;
  ready_at: string | null;
  ready_at_label: string | null;
  days_on_shelf: number | null;
  placement: Placement | null;
  history: HistoryEntry[];
}

export interface Dropoff {
  piece: Piece;
  amount_due_cents: number;
  payment_status: "owed";
  tracking_url: string;
}

export interface PlacedFootprint {
  piece_number: string;
  shape: Shape;
  x: string;
  y: string;
  rotation: Rotation;
  width_in: string;
  depth_in: string;
  height_in: string;
}

export interface Layer {
  layer: number;
  height_in: string | null;
  placements: PlacedFootprint[];
}

export interface Firing {
  id: number;
  kiln_id: string;
  profile: Profile;
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
  layers: Layer[];
}

export interface PlacementResult {
  placement: Placement;
  fill_percent: number;
  layer_height_in: string;
}

export interface DamageReport {
  id: number;
  piece_number: string;
  kind: "glaze_run" | "crack";
  note: string;
  status: "reported" | "charged" | "waived";
  intake_photo_id: string;
  unload_photo_id: string;
  account_name: string;
  amount_cents: number | null;
  reported_by: string;
  reported_at: string;
  reported_at_label: string;
}

export interface StudioSummary {
  awaiting_pickup: number;
  open_damage_reports: number;
  kilns: { kiln_id: string; firing_id: number | null; fill_percent: number | null }[];
}

export interface OwedAccount {
  kind: "member" | "guest";
  member_number: string | null;
  piece_number: string | null;
  name: string;
  owed_cents: number;
}

export interface Owed {
  accounts: OwedAccount[];
  total_owed_cents: number;
}

export interface Tracking {
  piece_number: string;
  status: PieceStatus;
  status_label: string;
  pickup_shelf: string | null;
}

export interface PhotoUpload {
  photo_id: string;
  content_type: string;
  bytes: number;
  sha256: string;
}

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
  step?: "photo" | "charge" | "receipt";
  reason?: string;
  cool_until?: string;
  cool_until_label?: string;
}
