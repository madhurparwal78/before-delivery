export type PieceStatus =
  | "logged"
  | "waiting_bisque"
  | "bisqued"
  | "waiting_glaze"
  | "glazed"
  | "ready_for_pickup"
  | "collected"
  | "uncollected";

export const PIECE_STATUSES: PieceStatus[] = [
  "logged",
  "waiting_bisque",
  "bisqued",
  "waiting_glaze",
  "glazed",
  "ready_for_pickup",
  "collected",
  "uncollected",
];

export const WAITING_STATUSES: PieceStatus[] = ["waiting_bisque", "waiting_glaze"];

export type LoadStatus = "planning" | "loaded" | "firing" | "cooling" | "unloaded" | "cancelled";

export const OPEN_LOAD_STATUSES: LoadStatus[] = ["planning", "loaded", "firing", "cooling"];

export type Role = "owner" | "kiln_tech" | "member";

export type Membership = "member" | "drop_off";

export type TicketRow = {
  id: string;
  title: string;
  status: PieceStatus;
  clay_body: string;
  length_in: number;
  width_in: number;
  height_in: number;
  photo_url: string | null;
  owner_handle: string;
  waiting_since: Date | null;
};

export type PieceRow = {
  id: string;
  studio_id: string;
  owner_id: string;
  title: string;
  clay_body_id: string;
  status: PieceStatus;
  length_in: number;
  width_in: number;
  height_in: number;
  rounded_l_half: number;
  rounded_w_half: number;
  rounded_h_half: number;
  cubic_eighths: number;
  membership: Membership | null;
  bisque_rate_cents: number;
  glaze_rate_cents: number;
  rates_effective_from: string;
  quoted_at: Date;
  waiting_since: Date | null;
  pickup_deadline: string | null;
  bisque_outcome: string | null;
  glaze_outcome: string | null;
  photo_key: string | null;
  photo_content_type: string | null;
  created_at: Date;
};

export type StudioRow = {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  pickup_window_days: number;
};

export type PersonRow = {
  id: string;
  studio_id: string;
  email: string;
  name: string;
  handle: string;
  role: Role;
  membership: Membership | null;
  card_status: "none" | "on_file";
  active: boolean;
  created_at: Date;
};

export type LoadRow = {
  id: string;
  studio_id: string;
  kiln_id: string;
  firing: "bisque" | "glaze";
  status: LoadStatus;
  created_at: Date;
  unloaded_at: Date | null;
};

export type KilnRow = {
  id: string;
  studio_id: string;
  name: string;
  stack_height_in: number;
  shelf_area_sq_in: number;
};

export type ChargeRow = {
  id: string;
  studio_id: string;
  member_id: string;
  piece_id: string;
  firing: "bisque" | "glaze" | "storage";
  storage_day: string | null;
  cubic_eighths: number | null;
  rate_cents: number;
  fee_cents: number;
  status: "pending" | "settled" | "refund_pending" | "refunded";
  funding: "credit" | "card" | null;
  created_at: Date;
  settled_at: Date | null;
  refunded_at: Date | null;
  last_kb_call_ms: number | null;
};

export type LedgerEntryRow = {
  id: string;
  movement_id: string;
  account: "member_credit" | "card_receipts" | "firing_revenue" | "adjustments";
  amount_cents: number;
  kind: "opening" | "pack" | "firing_fee" | "storage_fee" | "refund" | "adjustment";
  charge_id: string | null;
  movement_member_id: string;
  created_at: Date;
};

export type MovementRow = {
  id: string;
  studio_id: string;
  member_id: string;
  kind: "opening" | "pack" | "firing_fee" | "storage_fee" | "refund" | "adjustment";
  amount_cents: number;
  charge_id: string | null;
  purchase_id: string | null;
  created_at: Date;
};

export type PackAttemptRow = {
  id: string;
  studio_id: string;
  member_id: string;
  idempotency_key: string;
  pack_id: string;
  amount_cents: number;
  studio_day: string;
  state: "held" | "pending" | "completed" | "released";
  created_at: Date;
  last_kb_call_ms: number | null;
};
