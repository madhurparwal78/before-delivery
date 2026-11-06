/** The wire shapes the API returns, shared by the server and the browser app. */

import type { LocalDate } from '../domain/calendar.js';
import type { HoldStatus, LoanStatus } from '../domain/states.js';
import type { SpanStatus } from '../domain/occupancy.js';

export type Role = 'member' | 'volunteer' | 'founder';

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface LibrarySettings {
  name: string;
  time_zone: string;
  open_days: string[];
  closed_dates: LocalDate[];
  opening_time: string;
  closing_time: string;
  late_fee_schedule: Array<{ effective_from: LocalDate; cents_per_day: number }>;
  late_fee_cents_per_day: number;
  max_active_per_member: number;
  pickup_window_seconds: number;
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
  start_date: LocalDate;
  end_date: LocalDate;
  status: SpanStatus;
  back_on: LocalDate | null;
  mine: boolean;
  borrower?: { name: string };
  record?: { type: 'hold' | 'loan'; id: string };
}

export interface Lane {
  lane_index: number;
  unit_id: string;
  label: string;
  busy_for_range: boolean | null;
  spans: Span[];
}

export interface LanesResponse {
  item_id: string;
  from: LocalDate;
  to: LocalDate;
  unit_count: number;
  units_free: number | null;
  lanes: Lane[];
}

export interface Hold {
  id: string;
  item: { id: string; name: string };
  unit: Unit;
  member: { id: string; name: string };
  status: HoldStatus;
  start_date: LocalDate;
  end_date: LocalDate;
  ready_at: string | null;
  pickup_deadline: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  stage: 'checkout' | 'return';
  content_type: string;
  size_bytes: number;
  url: string;
}

export interface Inspection {
  outcome: 'ok' | 'damaged';
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
  item: { id: string; name: string };
  unit: Unit;
  member: { id: string; name: string };
  hold_id: string | null;
  status: LoanStatus;
  checked_out_at: string;
  due_date: LocalDate;
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

export type LedgerKind =
  | 'deposit_hold'
  | 'deposit_release'
  | 'damage_charge'
  | 'extra_damage'
  | 'late_fee';

export interface LedgerEntry {
  id: string;
  loan_id: string;
  item: { id: string; name: string };
  kind: LedgerKind;
  amount_cents: number;
  created_at: string;
}

export interface Receipt extends Settlement {
  item: { id: string; name: string };
  unit: Unit;
  member: { id: string; name: string };
}

export interface CounterStatus {
  billing: 'up' | 'down';
  photo_storage: 'up' | 'down';
  checked_at: string;
}

export interface HoldsPage {
  holds: Hold[];
  next_cursor: string | null;
}

export interface LoansPage {
  loans: Loan[];
  next_cursor: string | null;
}
