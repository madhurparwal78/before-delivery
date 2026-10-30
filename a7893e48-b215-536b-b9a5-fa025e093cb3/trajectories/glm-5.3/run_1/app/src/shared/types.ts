export type Role = "renter" | "front_desk" | "manager";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  operator_id: string;
  site_ids: string[];
  renter_id: string | null;
}

export type BookingStatus =
  | "confirmed" | "checked_in" | "overrun_billed" | "checked_out" | "settled"
  | "cancelled_refunded" | "cancelled_forfeit" | "unpaid_cancelled";

export interface PolicyVersion {
  version_id: string;
  notice_hours: number;
  effective_from: string;
}

export interface Booking {
  id: string;
  hold_id: string;
  site_id: string;
  station_id: string;
  station_name: string;
  renter_id: string;
  renter_business: string;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  local_start: string;
  local_end: string;
  minutes: number;
  pack_minutes: number;
  card_minutes: number;
  card_cents: number;
  deposit_cents: number;
  paid: boolean;
  balance_due_cents: number;
  balance_due_by: string | null;
  policy: PolicyVersion;
  confirmed_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  overrun_minutes: number;
  overrun_cents: number;
  cleaning_fee_cents: number;
  terms: string;
}

export type HoldStatus = "held" | "expired" | "confirmed";

export interface Occurrence {
  date: string;
  start: string;
  end: string;
  start_at: string;
  end_at: string;
  minutes: number;
}

export interface Quote {
  pack_minutes_available: number | null;
  pack_minutes: number;
  card_minutes: number;
  card_cents: number;
  deposit_cents: number;
}

export interface Hold {
  id: string;
  status: HoldStatus;
  station_id: string;
  site_id: string;
  renter_id: string;
  created_at: string;
  expires_at: string;
  occurrences: Occurrence[];
  quote: Quote;
}

export type SegmentState = "booked" | "held" | "yours_booked" | "yours_held";

export interface Segment {
  start_at: string;
  end_at: string;
  state: SegmentState;
  label: string;
  booking_id: string | null;
  hold_id: string | null;
  renter_business: string | null;
}

export const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
export const hours = (minutes: number): string => (minutes / 60).toFixed(2);
export const termsLine = (notice: number): string =>
  `Free cancellation until ${notice} hours before start. Later cancellations keep the time charge and the deposit.`;
