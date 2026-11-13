export type Role = 'director' | 'juror' | 'studio';

export type FeeTier = 'early_bird' | 'standard';

export type EntryState =
  | 'draft'
  | 'submitted'
  | 'screened'
  | 'disqualified'
  | 'withdrawn'
  | 'round_1'
  | 'shortlisted'
  | 'eliminated'
  | 'final_round'
  | 'winner'
  | 'finalist'
  | 'honourable_mention'
  | 'published';

export type Award = 'winner' | 'finalist' | 'honourable_mention';

export type RoundState = 'scheduled' | 'open' | 'closed' | 'normalised' | 'published';

export type RoundKind = 'round_1' | 'final';

export interface UserRow {
  id: string;
  role: Role;
  name: string;
  email: string;
  password_hash: string;
  studio_id: string | null;
}

export interface Actor {
  id: string;
  role: Role;
  name: string;
  email: string;
  studioId: string | null;
}

export interface ProgramRow {
  id: string;
  name: string;
  year: number;
  time_zone: string;
  early_bird_date: string;
  deadline_date: string;
  early_bird_fee_cents: number;
  standard_fee_cents: number;
}

export interface CategoryRow {
  id: string;
  program_id: string;
  name: string;
  shortlist_size: number;
  finalist_count: number;
  published: boolean;
  embargo_at: Date | null;
}

export interface RoundRow {
  id: string;
  category_id: string;
  name: string;
  kind: RoundKind;
  state: RoundState;
  ballot_deadline: string | null;
  opened_at: Date | null;
  closed_at: Date | null;
}

export interface EntryRow {
  id: string;
  program_id: string;
  category_id: string;
  studio_id: string;
  entry_number: number;
  title: string;
  summary: string;
  site_url: string;
  credits: string;
  state: EntryState;
  disqualify_reason: string | null;
  award: Award | null;
  fee_tier: FeeTier | null;
  fee_cents: number | null;
  invoice_id: string | null;
  invoice_item_id: string | null;
  payment_id: string | null;
  paid_at: Date | null;
  refund_amount_cents: number | null;
  refunded_at: Date | null;
  charge_attempts: number;
  submitted_at: Date | null;
}

export interface AssetRow {
  id: string;
  entry_id: string;
  storage_key: string;
  name: string;
  content_type: string;
  width: number;
  height: number;
  bytes: number;
}
