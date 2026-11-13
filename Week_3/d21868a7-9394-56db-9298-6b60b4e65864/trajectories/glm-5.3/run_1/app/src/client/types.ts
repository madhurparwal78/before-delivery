// Domain terms for the browser: window records, order records, status labels,
// and the shapes the API returns.

export type WindowRecord = {
  id: string;
  channel_id: string;
  channel_name: string;
  label: string;
  opens_at: string;
  closes_at: string;
  hours: number;
  status: "upcoming" | "open" | "closing" | "closed";
  orderable: boolean;
  table_cap_ml_day: string;
  restriction_cap_ml_day: string | null;
  restriction_effective_at: string | null;
  effective_cap_ml_day: string;
  cap_volume_ml: string;
  committed_ml: string;
  remaining_ml: string;
  delivered_ml: string;
  channel_flow_ml_day: string;
  rostered_operator: string;
};

export type OrderRecord = {
  number: string;
  grower_id: number;
  turnout: string;
  window_id: string;
  requested_ml: string;
  volume_ml: string;
  rate_ml_day: string;
  status: "requested" | "scheduled" | "running" | "delivered" | "closed";
  holder_code: string | null;
  standby_code: string | null;
  conflict: null | "restriction" | "lapsed";
  rationed: boolean;
  closed_after_flow: boolean;
  scheduled_at: string | null;
};

export type CardRecord = {
  id: number;
  order_number: string;
  turnout: string;
  channel_id: string;
  window_id: string;
  window_status: "upcoming" | "open" | "closing" | "closed";
  kind: "start" | "finish";
  state: "open" | "waiting-for-store" | "spent";
  holder_code: string;
  from_ml_day: string;
  to_ml_day: string;
  stroke: { key: string; committed_at: string; confirmed_at: string | null; operator_code: string } | null;
};

export type UserRecord = {
  id: number;
  name: string;
  email: string;
  role: "grower" | "operator" | "dispatcher" | "clerk" | "reviewer";
  operator_code: string | null;
};

export type AllocationRecord = { allocation_ml: string; debited_ml: string; remaining_ml: string };

export type StatusCounts = "requested" | "scheduled" | "running" | "delivered" | "closed";

export const WINDOW_STATUS_LABEL: Record<WindowRecord["status"], string> = {
  upcoming: "Not yet open",
  open: "Open",
  closing: "Closing: final 30 minutes",
  closed: "Closed",
};

export const ORDER_STATUS_LABEL: Record<StatusCounts, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  running: "Running",
  delivered: "Delivered",
  closed: "Closed",
};

export type TurnoutRecord = { code: string; channel_id: string; grower_id: number; max_rate_ml_day: string };
export type OperatorRecord = { code: string; kind: "district" | "contractor"; name: string | null; erased: boolean };
export type ChannelRecord = { id: string; name: string; capacity_revision: number };
export type Suggestion = { kind: "turnout" | "grower" | "channel" | "operator"; label: string; detail: string; href: string };
export type PackRecord = {
  id: string; number: string; from: string; to: string; signatory: string;
  state: "building" | "stored" | "mailed" | "withdrawn";
  stalled_on: null | "store" | "mail";
  key: string | null; sha256: string | null; created_at: string; mailed_at: string | null;
};
export type ContractorRecord = { code: string; name: string | null; phone: string | null; erased: boolean };
export type RevisionRecord = { revision: number; saved_at: string; saved_by: string; restored_from: number | null };
export type CapacityCell = { window_id: string; cap_ml_day: string };
export type NoticeRecord = {
  kind: "conflict" | "restriction" | "ration" | "lapse";
  grower_id: number; grower_name: string; subject: string; state: "queued" | "sent"; created_at: string;
};
export type RestrictionRecord = { id: number; window_id: string; cap_ml_day: string; reason: string; effective_at: string };
export type TotalsChannel = {
  channel_id: string; cap_volume_ml: string; committed_ml: string; delivered_ml: string; remaining_ml: string;
  windows: Array<{ window_id: string; label: string; cap_volume_ml: string; committed_ml: string; delivered_ml: string; remaining_ml: string }>;
};
