import type { Role } from '../domain/routes.ts';
import type { OrderConflict, OrderStatus } from '../domain/orders.ts';
import type { WindowStatus } from '../domain/time.ts';

/** The API records as the browser receives them. */

export interface User {
  id: number;
  name: string | null;
  email: string;
  role: Role;
  operator_code: string | null;
}

export interface WindowRecord {
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
  restriction_id: string | null;
  effective_cap_ml_day: string;
  cap_volume_ml: string;
  committed_ml: string;
  remaining_ml: string;
  delivered_ml: string;
  channel_flow_ml_day: string;
  rostered_operator: string;
}

export interface OrderRecord {
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
  conflict: OrderConflict;
  rationed: boolean;
  closed_after_flow: boolean;
  scheduled_at: string | null;
}

export interface CardRecord {
  id: string;
  order_number: string;
  turnout: string;
  channel_id: string;
  window_id: string;
  window_status: WindowStatus;
  kind: 'start' | 'finish';
  state: 'open' | 'waiting-for-store' | 'spent';
  holder_code: string;
  from_ml_day: string;
  to_ml_day: string;
  stroke: {
    key: string;
    committed_at: string;
    confirmed_at: string | null;
    operator_code: string;
  } | null;
}

export interface PackRecord {
  id: string;
  number: string;
  from: string;
  to: string;
  signatory: string;
  state: 'building' | 'stored' | 'mailed' | 'withdrawn';
  stalled_on: 'store' | 'mail' | null;
  key: string;
  sha256: string | null;
  created_at: string;
  mailed_at: string | null;
}

export interface Allocation {
  allocation_ml: string;
  debited_ml: string;
  remaining_ml: string;
}

export interface ChannelRecord {
  id: string;
  name: string;
  capacity_revision: number;
}

export interface TurnoutRecord {
  code: string;
  channel_id: string;
  grower_id: number;
  max_rate_ml_day: string;
}

export interface OperatorRecord {
  code: string;
  kind: 'district' | 'contractor';
  name: string | null;
}

export interface Suggestion {
  kind: 'turnout' | 'grower' | 'channel' | 'operator';
  label: string;
  detail: string;
  href: string;
}

export interface NoticeRecord {
  kind: 'conflict' | 'restriction' | 'ration' | 'lapse';
  grower_id: number;
  grower_name: string;
  subject: string;
  state: 'queued' | 'sent';
  created_at: string;
}

export interface RestrictionRecord {
  id: string;
  window_id: string;
  cap_ml_day: string;
  reason: string;
  effective_at: string;
}

export interface CapacityRevision {
  revision: number;
  saved_at: string;
  saved_by: string;
  restored_from: number | null;
}

export interface CapacityTable {
  revision: number;
  cells: { window_id: string; cap_ml_day: string }[];
  revisions: CapacityRevision[];
}

export interface TotalsChannel {
  channel_id: string;
  cap_volume_ml: string;
  committed_ml: string;
  delivered_ml: string;
  remaining_ml: string;
  windows: {
    window_id: string;
    label: string;
    cap_volume_ml: string;
    committed_ml: string;
    delivered_ml: string;
    remaining_ml: string;
  }[];
}

export interface ContractorRecord {
  code: string;
  name: string | null;
  phone: string | null;
  erased: boolean;
}
