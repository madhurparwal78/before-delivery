export type Role = 'owner' | 'tech' | 'member';
export type Shape = 'round' | 'rectangular' | 'plate';
export type Unit = 'in' | 'cm';
export type Plan = 'bisque_and_glaze' | 'bisque_only' | 'glaze_only';
export type Stage = 'bisque' | 'glaze';
export type Cone = '06' | '04' | '02' | '6' | '10';
export type GlazeCone = '06' | '6';
export type Rotation = 0 | 90 | 180 | 270;

export type PieceStatus =
  | 'awaiting_payment'
  | 'queued'
  | 'loaded'
  | 'firing'
  | 'cooling'
  | 'unloadable'
  | 'ready'
  | 'collected'
  | 'uncollected';

export type FiringStatus = 'building' | 'firing' | 'cooling' | 'unloadable' | 'unloaded';

export type DamageKind = 'glaze_run' | 'crack';
export type DamageStatus = 'reported' | 'charged' | 'waived';
export type PaymentStatus = 'owed' | 'paid';

export type PlacementReason = 'stage' | 'clay' | 'cone' | 'height' | 'edge' | 'post' | 'overlap';

export interface User {
  id: string;
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

export interface RateSet {
  id: number;
  bisque_rate: string;
  glaze_rate: string;
  member_discount_percent: number;
  order_minimum_cents: number;
  effective_date: string;
  created_at: string;
}

/** Rounded sides in inches, one decimal, keyed by the field that holds them. */
export interface SidesIn {
  length?: string;
  width?: string;
  diameter?: string;
  height: string;
}

export interface Quote {
  sides_in: SidesIn;
  cubic_inches: string;
  rate_per_cubic_inch: string;
  discount_percent: number;
  order_minimum_cents: number;
  minimum_applied: boolean;
  fee_cents: number;
  rate_set_id: number;
}

export interface PieceOwner {
  kind: 'member' | 'guest';
  name: string;
  email: string;
  member_number: string | null;
}

export interface PiecePlacement {
  firing_id: string;
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
  sides_in: SidesIn;
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
  payment_status: PaymentStatus | null;
  placement: PiecePlacement | null;
  history: HistoryEntry[];
}

export interface Post {
  x: string;
  y: string;
  size_in: string;
}

export interface ProfileSegment {
  rate_f_per_hour: number;
  target_f: number;
  hold_minutes: number;
}

export interface KilnProfile {
  id: string;
  name: string;
  stage: Stage;
  cone: Cone;
  segments: ProfileSegment[];
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
  posts: Post[];
  profiles: KilnProfile[];
  current_firing_id: string | null;
}

export interface LayerPlacement {
  piece_number: string;
  shape: Shape;
  x: string;
  y: string;
  rotation: Rotation;
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
  id: string;
  kiln_id: string;
  profile: KilnProfile;
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
  id: string;
  piece_number: string;
  kind: DamageKind;
  note: string;
  status: DamageStatus;
  intake_photo_id: string | null;
  unload_photo_id: string | null;
  account_name: string;
  amount_cents: number | null;
  reported_by: string;
  reported_at: string;
  reported_at_label: string;
}

export interface StudioSummary {
  awaiting_pickup: number;
  open_damage_reports: number;
  kilns: { kiln_id: string; firing_id: string | null; fill_percent: number }[];
}

export interface OwedAccount {
  kind: 'member' | 'guest';
  member_number: string | null;
  piece_number: string | null;
  name: string;
  owed_cents: number;
}

export interface OwedSummary {
  accounts: OwedAccount[];
  total_owed_cents: number;
}

export interface TrackingView {
  piece_number: string;
  status: PieceStatus;
  status_label: string;
  pickup_shelf: string | null;
}

export interface PhotoReceipt {
  photo_id: string;
  content_type: string;
  bytes: number;
  sha256: string;
}

export interface DropoffResult {
  piece: Piece;
  amount_due_cents: number;
  payment_status: PaymentStatus;
  tracking_url: string;
}

export interface PlacementResult {
  placement: PiecePlacement & { piece_number: string };
  fill_percent: number;
  layer_height_in: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  reason?: PlacementReason;
  step?: 'photo' | 'charge' | 'receipt';
  cool_until?: string;
  cool_until_label?: string;
}
