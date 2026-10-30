// The JSON shapes of the API, exactly the fields the brief lists, shared by the server's serializers
// and the browser.

import type { Weekday } from "./calendar.js";

export type Role = "member" | "volunteer" | "founder";
export type HoldStatus = "requested" | "ready" | "collected" | "expired" | "cancelled";
export type LoanStatus = "out" | "overdue" | "returned" | "inspected" | "settled";
export type SpanStatus = "held" | "out" | "overdue";
export type PhotoStage = "checkout" | "return";
export type InspectionOutcome = "ok" | "damaged";
export type LedgerKind = "deposit_hold" | "deposit_release" | "damage_charge" | "extra_damage" | "late_fee";

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Ref {
  id: string;
  name: string;
}

export interface Item {
  id: string;
  name: string;
  category: string;
  deposit_cents: number;
  replacement_cents: number;
  unit_count: number;
  units_free_today: number;
}

export interface Unit {
  id: string;
  label: string;
  lane_index: number;
}

export interface Span {
  start_date: string;
  end_date: string;
  status: SpanStatus;
  back_on: string | null;
  mine: boolean;
  borrower?: { name: string };
  record?: { type: "hold" | "loan"; id: string };
}

export interface Lane {
  lane_index: number;
  unit_id: string;
  label: string;
  busy_for_range: boolean | null;
  spans: Span[];
}

export interface Lanes {
  item_id: string;
  from: string;
  to: string;
  unit_count: number;
  units_free: number | null;
  lanes: Lane[];
}

export interface Hold {
  id: string;
  item: Ref;
  unit: Unit;
  member: Ref;
  status: HoldStatus;
  start_date: string;
  end_date: string;
  ready_at: string | null;
  pickup_deadline: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  stage: PhotoStage;
  content_type: string;
  size_bytes: number;
  url: string;
}

export interface Inspection {
  outcome: InspectionOutcome;
  note: string;
  inspected_at: string;
}

export interface Settlement {
  loan_id: string;
  deposit_cents: number;
  released_cents: number;
  damage_cents: number;
  damage_from_deposit_cents: number;
  extra_damage_cents: number;
  late_days: number;
  late_fee_cents: number;
  total_charged_cents: number;
  settled_at: string;
}

export interface Loan {
  id: string;
  item: Ref;
  unit: Unit;
  member: Ref;
  hold_id: string | null;
  status: LoanStatus;
  checked_out_at: string;
  due_date: string;
  due_at: string;
  renewed_at: string | null;
  returned_at: string | null;
  on_time: boolean | null;
  late_days: number | null;
  deposit_cents: number;
  replacement_cents: number;
  inspection: Inspection | null;
  settlement: Settlement | null;
  photos: Photo[];
}

export interface Receipt extends Settlement {
  item: Ref;
  unit: Unit;
  member: Ref;
}

export interface LedgerEntry {
  id: string;
  loan_id: string;
  item: Ref;
  kind: LedgerKind;
  amount_cents: number;
  created_at: string;
}

export interface LateFeeRate {
  effective_from: string;
  cents_per_day: number;
}

export interface LibrarySettings {
  name: string;
  time_zone: string;
  open_days: Weekday[];
  closed_dates: string[];
  opening_time: string;
  closing_time: string;
  late_fee_schedule: LateFeeRate[];
  late_fee_cents_per_day: number;
  max_active_per_member: number;
  pickup_window_seconds: number;
}

export interface CounterStatus {
  billing: "up" | "down";
  photo_storage: "up" | "down";
  checked_at: string;
}

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface HoldCreated {
  hold: Hold;
  units_free: number;
  unit_count: number;
}

export interface HoldPage {
  holds: Hold[];
  next_cursor: string | null;
}

export interface LoanPage {
  loans: Loan[];
  next_cursor: string | null;
}

export interface LedgerView {
  entries: LedgerEntry[];
  deposits_held_cents: number;
}
