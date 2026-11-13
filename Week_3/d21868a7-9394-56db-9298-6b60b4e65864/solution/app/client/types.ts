// The API's records as the client receives them (brief: API, Records).
import type { Role } from "../shared/roles.ts";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  operator_code: string | null;
}

export type WindowStatus = "upcoming" | "open" | "closing" | "closed";

export interface DeliveryWindow {
  id: string;
  channel_id: string;
  channel_name: string;
  label: string;
  opens_at: string;
  closes_at: string;
  hours: number;
  status: WindowStatus;
  orderable: boolean;
  table_cap_ml_day: string;
  restriction_cap_ml_day: string | null;
  restriction_effective_at: string | null;
  restriction_id: number | null;
  effective_cap_ml_day: string;
  cap_volume_ml: string;
  committed_ml: string;
  remaining_ml: string;
  delivered_ml: string;
  channel_flow_ml_day: string;
  rostered_operator: string;
}

export type OrderStatus = "requested" | "scheduled" | "running" | "delivered" | "closed";

export interface Order {
  number: string;
  grower_id: number;
  grower_name: string;
  turnout: string;
  window_id: string;
  requested_ml: string;
  volume_ml: string;
  rate_ml_day: string;
  status: OrderStatus;
  holder_code: string;
  standby_code: string | null;
  conflict: "restriction" | "lapsed" | null;
  closed_after_flow: boolean;
  rationed: boolean;
  scheduled_at: string | null;
}

export interface GateCard {
  id: number;
  order_number: string;
  turnout: string;
  channel_id: string;
  window_id: string;
  window_status: WindowStatus;
  grower_name: string;
  kind: "start" | "finish";
  state: "open" | "waiting-for-store" | "spent";
  holder_code: string;
  handed_over: boolean;
  from_ml_day: string;
  to_ml_day: string;
  stroke: { key: string; committed_at: string; confirmed_at: string | null; operator_code: string } | null;
}

export interface Allocation {
  allocation_ml: string;
  debited_ml: string;
  remaining_ml: string;
}

export interface Channel {
  id: string;
  name: string;
  capacity_revision: number;
}

export interface Operator {
  code: string;
  kind: "district" | "contractor";
  name: string | null;
}

export interface Restriction {
  id: number;
  window_id: string;
  cap_ml_day: string;
  reason: string;
  effective_at: string;
}

export interface Pack {
  id: string;
  number: string;
  from: string;
  to: string;
  signatory: string;
  state: "building" | "stored" | "mailed" | "withdrawn";
  stalled_on: "store" | "mail" | null;
  key: string;
  sha256: string | null;
  created_at: string;
  mailed_at: string | null;
}

export interface Notice {
  kind: "conflict" | "restriction" | "ration" | "lapse";
  grower_id: number;
  grower_name: string;
  subject: string;
  state: "queued" | "sent";
  created_at: string;
}

export interface CapacityCell {
  window_id: string;
  cap_ml_day: string;
}

export interface Totals {
  channels: {
    channel_id: string;
    cap_volume_ml: string;
    committed_ml: string;
    delivered_ml: string;
    remaining_ml: string;
    windows: { window_id: string; label: string; cap_volume_ml: string; committed_ml: string; delivered_ml: string; remaining_ml: string }[];
  }[];
}

export interface Suggestion {
  kind: "channel" | "turnout" | "grower" | "operator";
  label: string;
  detail: string;
  href: string;
}
