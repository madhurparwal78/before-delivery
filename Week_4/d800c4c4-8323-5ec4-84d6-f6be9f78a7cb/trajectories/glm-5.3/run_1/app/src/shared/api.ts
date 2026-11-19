// API resource shapes shared between server and browser.

export type Role = 'coordinator' | 'volunteer' | 'member';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Membership {
  status: 'pending-payment' | 'active' | 'lapsed';
  tier: 'pay-what-you-can' | 'standard' | 'supporter';
  active_until: string | null;
  ends_at_term: boolean;
}

export interface MemberSummary {
  id: number;
  name: string;
  email: string;
  membership_status: 'pending-payment' | 'active' | 'lapsed';
}

export type PartShape = 'drill' | 'saw' | 'ladder' | 'hammer' | 'wrench' | 'case' | 'battery' | 'cable' | 'blade' | 'generic';

export interface Part {
  id: number;
  item_id: number;
  name: string;
  shape: PartShape;
  col: number;
  row: number;
  width: number;
  height: number;
  state: 'hung' | 'out' | 'missing';
}

export type ItemStatus = 'on-wall' | 'reserved' | 'out' | 'pending-photo' | 'incomplete' | 'held';

export interface Item {
  id: number;
  tag: string;
  name: string;
  replacement_cost_cents: number;
  status: ItemStatus;
  due_date: string | null;
  hold_queue_length: number;
  parts: Part[];
}

export interface Counts {
  on_wall: number;
  out: number;
  missing: number;
}

export interface Board {
  counts: Counts;
  columns: 10;
  rows: number;
  items: Item[];
}

export interface Photo {
  id: number;
  event: 'checkout' | 'checkin';
  content_type: string;
  byte_size: number;
  sha256: string;
  captured_at: string;
  received_at: string;
  url: string;
}

export interface FeeRules {
  late_fee_cents: number;
  damage_fee_cents: number;
  replacement_costs_cents: Record<string, number>;
}

export type LoanStatus = 'reserved' | 'out' | 'pending-photo' | 'returned-partial' | 'returned-complete';

export interface LoanItem {
  id: number;
  tag: string;
  name: string;
  grade: 'good' | 'worn' | 'damaged' | null;
}

export interface Loan {
  id: number;
  ref: string;
  member_id: number;
  member_name: string;
  status: LoanStatus;
  checked_out_at: string | null;
  due_date: string | null;
  due_by: string | null;
  fee_rules: FeeRules | null;
  open_days_late: number | null;
  late_fee_so_far_cents: number | null;
  returned_at: string | null;
  items: LoanItem[];
  parts: Part[];
  missing_parts: string[];
  photos: Photo[];
  fee_id: number | null;
}

export type FeeStatus = 'raised' | 'settled' | 'waived-by-coordinator';

export interface FeeLine {
  item_id: number;
  kind: 'late' | 'damage';
  open_days: number | null;
  amount_cents: number;
  description: string;
}

export interface Fee {
  id: number;
  loan_id: number;
  loan_ref: string;
  member_id: number;
  status: FeeStatus;
  total_cents: number;
  lines: FeeLine[];
  killbill_invoice_id: string;
  waiver:
    | {
        status: 'requested' | 'approved' | 'declined';
        reason: string;
        requested_at: string;
        decided_at: string | null;
      }
    | null;
}

export type HoldStatus = 'queued' | 'ready' | 'collected' | 'cancelled';

export interface Hold {
  id: number;
  item_id: number;
  member_id: number;
  status: HoldStatus;
  position: number | null;
  placed_at: string;
}

export interface CalendarHours {
  weekday: string;
  opens: string;
  closes: string;
}

export interface CalendarView {
  time_zone: string;
  hours: CalendarHours[];
  closures: { date: string; reason: string }[];
  next_open_days: string[];
}

export interface Settings {
  time_zone: string;
  late_fee_cents: number;
  damage_fee_cents: number;
  loan_period_days: number;
}

export interface HoldQueueEntry {
  position: number;
  member_name: string;
  status: HoldStatus;
}

export interface ServiceStatus {
  storage: 'up' | 'down';
  billing: 'up' | 'down';
}

export interface LoanView {
  loan: Loan;
}

export interface FeeView {
  fee: Fee;
  photos: Photo[];
}

export interface HoldView {
  hold: Hold;
}
